const aws = require('aws-sdk');
const Artifact = require('../models/Artifact');
const Team = require('../models/Team');
const BugReport = require('../models/BugReport');
const { enqueueFileProcessingJob } = require('../queues/fileProcessingQueue');
const { getAWSCredentials } = require('../utils/SecureCredentialManager');
const { auditLogger } = require('../middleware/auditLogger');
const { piiDetector } = require('../utils/PIIDetector');
const { imageSecurityScanner } = require('../utils/ImageSecurityScanner');

// Configure AWS S3 with secure credential management
let s3Instance = null;

const getS3Instance = async () => {
  if (!s3Instance) {
    try {
      const credentials = await getAWSCredentials();
      s3Instance = new aws.S3({
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        region: credentials.region,
        sessionToken: credentials.sessionToken,
      });
    } catch (error) {
      console.error('Failed to initialize S3 with secure credentials:', error);
      // Fallback to environment variables
      s3Instance = new aws.S3({
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        region: process.env.AWS_REGION || 'us-east-1',
      });
    }
  }
  return s3Instance;
};

// Enhanced file type allowlist with comprehensive security validation
const ALLOWED_FILE_TYPES = {
  // Images - Enhanced with security considerations
  'image/jpeg': {
    maxSize: 50 * 1024 * 1024,
    extensions: ['.jpg', '.jpeg'],
    magicNumbers: ['ffd8ff'],
    securityLevel: 'medium',
  },
  'image/png': {
    maxSize: 50 * 1024 * 1024,
    extensions: ['.png'],
    magicNumbers: ['89504e47'],
    securityLevel: 'medium',
  },
  'image/gif': {
    maxSize: 10 * 1024 * 1024,
    extensions: ['.gif'],
    magicNumbers: ['474946'],
    securityLevel: 'medium',
  },
  'image/webp': {
    maxSize: 50 * 1024 * 1024,
    extensions: ['.webp'],
    magicNumbers: ['52494646'],
    securityLevel: 'medium',
  },
  'image/bmp': {
    maxSize: 50 * 1024 * 1024,
    extensions: ['.bmp'],
    magicNumbers: ['424d'],
    securityLevel: 'low',
  },
  'image/tiff': {
    maxSize: 100 * 1024 * 1024,
    extensions: ['.tiff', '.tif'],
    magicNumbers: ['49492a00', '4d4d002a'],
    securityLevel: 'low',
  },
  'image/svg+xml': {
    maxSize: 5 * 1024 * 1024,
    extensions: ['.svg'],
    magicNumbers: [],
    securityLevel: 'high', // SVG can contain scripts
  },

  // Documents
  'application/pdf': {
    maxSize: 100 * 1024 * 1024,
    extensions: ['.pdf'],
    magicNumbers: ['25504446'],
    securityLevel: 'high',
  },
  'text/plain': {
    maxSize: 50 * 1024 * 1024,
    extensions: ['.txt', '.log'],
    magicNumbers: [],
    securityLevel: 'low',
  },
  'application/json': {
    maxSize: 50 * 1024 * 1024,
    extensions: ['.json'],
    magicNumbers: [],
    securityLevel: 'medium',
  },
  'application/xml': {
    maxSize: 50 * 1024 * 1024,
    extensions: ['.xml'],
    magicNumbers: [],
    securityLevel: 'medium',
  },
  'text/csv': {
    maxSize: 100 * 1024 * 1024,
    extensions: ['.csv'],
    magicNumbers: [],
    securityLevel: 'low',
  },

  // Archives - Require special handling
  'application/zip': {
    maxSize: 500 * 1024 * 1024,
    extensions: ['.zip'],
    magicNumbers: ['504b0304'],
    securityLevel: 'high',
  },
  'application/x-tar': {
    maxSize: 500 * 1024 * 1024,
    extensions: ['.tar'],
    magicNumbers: [],
    securityLevel: 'high',
  },
  'application/gzip': {
    maxSize: 500 * 1024 * 1024,
    extensions: ['.gz'],
    magicNumbers: ['1f8b'],
    securityLevel: 'high',
  },

  // Office documents - High security due to macro capabilities
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    maxSize: 100 * 1024 * 1024,
    extensions: ['.docx'],
    magicNumbers: ['504b0304'],
    securityLevel: 'high',
  },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    maxSize: 100 * 1024 * 1024,
    extensions: ['.xlsx'],
    magicNumbers: ['504b0304'],
    securityLevel: 'high',
  },

  // Code files - Medium security
  'text/javascript': {
    maxSize: 10 * 1024 * 1024,
    extensions: ['.js'],
    magicNumbers: [],
    securityLevel: 'medium',
  },
  'application/typescript': {
    maxSize: 10 * 1024 * 1024,
    extensions: ['.ts'],
    magicNumbers: [],
    securityLevel: 'medium',
  },
  'text/x-python': {
    maxSize: 10 * 1024 * 1024,
    extensions: ['.py'],
    magicNumbers: [],
    securityLevel: 'medium',
  },
};

// Large file threshold for multipart uploads
const MULTIPART_THRESHOLD = 100 * 1024 * 1024; // 100MB

/**
 * Validate file magic numbers against declared content type
 */
const validateMagicNumbers = (buffer, contentType) => {
  const typeConfig = ALLOWED_FILE_TYPES[contentType];
  if (!typeConfig || !typeConfig.magicNumbers || typeConfig.magicNumbers.length === 0) {
    return true; // Skip validation if no magic numbers defined
  }

  const headerHex = buffer.slice(0, 8).toString('hex').toLowerCase();

  return typeConfig.magicNumbers.some(magic =>
    headerHex.startsWith(magic.toLowerCase())
  );
};

/**
 * Enhanced file upload validation with security checks
 */
const validateUploadRequest = (filename, contentType, fileSize, fileBuffer = null) => {
  const errors = [];

  // Check if content type is allowed
  if (!ALLOWED_FILE_TYPES[contentType]) {
    errors.push(`File type ${contentType} is not allowed`);
  }

  // Check file size against type-specific limits
  const typeConfig = ALLOWED_FILE_TYPES[contentType];
  if (typeConfig && fileSize > typeConfig.maxSize) {
    errors.push(`File size ${fileSize} exceeds maximum allowed size of ${typeConfig.maxSize} bytes for ${contentType}`);
  }

  // Validate filename extension matches content type
  if (typeConfig) {
    const fileExtension = filename.toLowerCase().substring(filename.lastIndexOf('.'));
    if (!typeConfig.extensions.includes(fileExtension)) {
      errors.push(`File extension ${fileExtension} does not match content type ${contentType}`);
    }
  }

  // Enhanced filename validation
  if (!filename || filename.length === 0 || filename.length > 255) {
    errors.push('Invalid filename: must be between 1 and 255 characters');
  }

  // Check for null bytes (security vulnerability)
  if (filename.includes('\x00')) {
    errors.push('Filename contains null bytes');
  }

  // Enhanced dangerous pattern detection
  const dangerousPatterns = [
    /\.\./, // Directory traversal
    /[<>:"|?*]/, // Invalid characters
    /[\x00-\x1f]/, // Control characters
    /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i, // Windows reserved names
    /^\s+|\s+$/, // Leading/trailing whitespace
    /\.(exe|bat|cmd|scr|pif|com|dll|sys|vbs|ps1|jar)$/i, // Executable extensions
  ];

  if (dangerousPatterns.some((pattern) => pattern.test(filename))) {
    errors.push('Filename contains invalid or dangerous characters');
  }

  // Check for suspicious Unicode characters
  if (/[\u202a-\u202e\u2066-\u2069]/.test(filename)) {
    errors.push('Filename contains suspicious Unicode direction override characters');
  }

  // Validate file size is reasonable
  if (fileSize !== undefined) {
    if (fileSize < 0) {
      errors.push('File size cannot be negative');
    }
    if (fileSize > Number.MAX_SAFE_INTEGER) {
      errors.push('File size exceeds maximum safe integer value');
    }
  }

  // Validate magic numbers if file buffer is provided
  if (fileBuffer && !validateMagicNumbers(fileBuffer, contentType)) {
    errors.push(`File content does not match declared type ${contentType}`);
  }

  return errors;
};

/**
 * Generate S3 key for artifact
 */
const generateS3Key = (bugId, filename, userId) => {
  const timestamp = Date.now();
  const random = Math.round(Math.random() * 1e9);
  const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
  return `bug-reports/${bugId}/artifacts/${userId}/${timestamp}-${random}-${sanitizedFilename}`;
};

/**
 * Enhanced presigned upload with advanced validation
 */
exports.presignUpload = async (req, res) => {
  try {
    const { bugId } = req.params;
    const { filename, contentType, fileSize } = req.body || {};

    // Validate required fields
    if (!filename || !contentType) {
      return res.status(400).json({
        message: 'filename and contentType are required',
        code: 'MISSING_REQUIRED_FIELDS',
      });
    }

    // Validate file upload request
    const validationErrors = validateUploadRequest(filename, contentType, fileSize);
    if (validationErrors.length > 0) {
      return res.status(400).json({
        message: 'File validation failed',
        errors: validationErrors,
        code: 'VALIDATION_FAILED',
      });
    }

    // Verify bug report exists and user has access
    const bugReport = await BugReport.find(bugId);
    if (!bugReport) {
      return res.status(404).json({
        message: 'Bug report not found',
        code: 'BUG_NOT_FOUND',
      });
    }

    // Authorization: user must be in the team
    const teamMembers = await Team.getMembers(bugReport.team_id);
    const isMember = teamMembers.some((member) => member.user_id === req.user.id);
    if (!isMember) {
      return res.status(403).json({
        message: 'Access denied: not a team member',
        code: 'ACCESS_DENIED',
      });
    }

    const bucket = process.env.AWS_S3_BUCKET_NAME;
    const key = generateS3Key(bugId, filename, req.user.id);
    const s3 = await getS3Instance();

    // Log upload attempt for audit
    await auditLogger.logFileAccess('upload_request', {
      id: null,
      filename,
      size: fileSize,
      contentType,
      s3Key: key,
      bugId,
    }, req);

    // Determine if multipart upload is needed
    const useMultipart = fileSize && fileSize > MULTIPART_THRESHOLD;

    if (useMultipart) {
      // Create multipart upload
      const multipartParams = {
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
        Metadata: {
          'original-filename': filename,
          'uploader-id': req.user.id.toString(),
          'bug-id': bugId.toString(),
        },
      };

      const multipartUpload = await s3.createMultipartUpload(multipartParams).promise();

      return res.json({
        type: 'multipart',
        bucket,
        key,
        uploadId: multipartUpload.UploadId,
        partSize: 5 * 1024 * 1024, // 5MB parts
        metadata: {
          filename,
          contentType,
          fileSize,
        },
      });
    }

    // Standard presigned URL for smaller files
    const presignedUrl = s3.getSignedUrl('putObject', {
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
      Expires: 3600, // 1 hour
      Metadata: {
        'original-filename': filename,
        'uploader-id': req.user.id.toString(),
        'bug-id': bugId.toString(),
      },
    });

    return res.json({
      type: 'standard',
      bucket,
      key,
      url: presignedUrl,
      headers: {
        'Content-Type': contentType,
      },
      metadata: {
        filename,
        contentType,
        fileSize,
      },
    });
  } catch (error) {
    console.error('Error generating presigned upload URL:', error);
    return res.status(500).json({
      message: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
  }
};

/**
 * Generate presigned URLs for multipart upload parts
 */
exports.getMultipartUploadUrls = async (req, res) => {
  try {
    const { bugId } = req.params;
    const { uploadId, key, partNumbers } = req.body || {};

    if (!uploadId || !key || !Array.isArray(partNumbers)) {
      return res.status(400).json({
        message: 'uploadId, key, and partNumbers array are required',
        code: 'MISSING_REQUIRED_FIELDS',
      });
    }

    // Verify bug report exists and user has access
    const bugReport = await BugReport.find(bugId);
    if (!bugReport) {
      return res.status(404).json({
        message: 'Bug report not found',
        code: 'BUG_NOT_FOUND',
      });
    }

    // Authorization check
    const teamMembers = await Team.getMembers(bugReport.team_id);
    const isMember = teamMembers.some((member) => member.user_id === req.user.id);
    if (!isMember) {
      return res.status(403).json({
        message: 'Access denied: not a team member',
        code: 'ACCESS_DENIED',
      });
    }

    const bucket = process.env.AWS_S3_BUCKET_NAME;
    const urls = [];

    const s3 = await getS3Instance();

    // Generate presigned URLs for each part
    const urlPromises = partNumbers.map(async (partNumber) => {
      if (partNumber < 1 || partNumber > 10000) {
        throw new Error(`Invalid part number: ${partNumber}. Must be between 1 and 10000`);
      }

      const presignedUrl = s3.getSignedUrl('uploadPart', {
        Bucket: bucket,
        Key: key,
        PartNumber: partNumber,
        UploadId: uploadId,
        Expires: 3600, // 1 hour
      });

      return {
        partNumber,
        url: presignedUrl,
      };
    });

    try {
      const urls = await Promise.all(urlPromises);
      return res.json({ urls });
    } catch (error) {
      return res.status(400).json({
        message: error.message,
        code: 'INVALID_PART_NUMBER',
      });
    }

    return res.json({ urls });
  } catch (error) {
    console.error('Error generating multipart upload URLs:', error);
    return res.status(500).json({
      message: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
  }
};

/**
 * Complete multipart upload
 */
exports.completeMultipartUpload = async (req, res) => {
  try {
    const { bugId } = req.params;
    const { uploadId, key, parts, metadata } = req.body || {};

    if (!uploadId || !key || !Array.isArray(parts)) {
      return res.status(400).json({
        message: 'uploadId, key, and parts array are required',
        code: 'MISSING_REQUIRED_FIELDS',
      });
    }

    // Verify bug report exists and user has access
    const bugReport = await BugReport.find(bugId);
    if (!bugReport) {
      return res.status(404).json({
        message: 'Bug report not found',
        code: 'BUG_NOT_FOUND',
      });
    }

    // Authorization check
    const teamMembers = await Team.getMembers(bugReport.team_id);
    const isMember = teamMembers.some((member) => member.user_id === req.user.id);
    if (!isMember) {
      return res.status(403).json({
        message: 'Access denied: not a team member',
        code: 'ACCESS_DENIED',
      });
    }

    const bucket = process.env.AWS_S3_BUCKET_NAME;
    const s3 = await getS3Instance();

    // Complete the multipart upload
    const completeParams = {
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts.map((part) => ({
          ETag: part.etag,
          PartNumber: part.partNumber,
        })),
      },
    };

    const result = await s3.completeMultipartUpload(completeParams).promise();

    // Create artifact record
    const artifact = await Artifact.createForBug({
      bugReportId: Number(bugId),
      uploaderUserId: req.user.id,
      s3Bucket: bucket,
      s3Key: key,
      contentType: metadata?.contentType || null,
      sizeBytes: metadata?.fileSize || null,
      etag: result.ETag,
      status: 'uploaded',
      metadata: {
        originalname: metadata?.filename || null,
        uploadType: 'multipart',
        location: result.Location,
      },
    });

    // Enqueue for processing
    const jobId = await enqueueFileProcessingJob(Number(bugId), [artifact.id]);

    return res.json({
      message: 'Multipart upload completed successfully',
      artifact,
      jobId,
      location: result.Location,
    });
  } catch (error) {
    console.error('Error completing multipart upload:', error);

    // Try to abort the multipart upload on error
    if (req.body?.uploadId && req.body?.key) {
      try {
        await s3.abortMultipartUpload({
          Bucket: process.env.AWS_S3_BUCKET_NAME,
          Key: req.body.key,
          UploadId: req.body.uploadId,
        }).promise();
      } catch (abortError) {
        console.error('Error aborting multipart upload:', abortError);
      }
    }

    return res.status(500).json({
      message: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
  }
};

/**
 * Abort multipart upload
 */
exports.abortMultipartUpload = async (req, res) => {
  try {
    const { bugId } = req.params;
    const { uploadId, key } = req.body || {};

    if (!uploadId || !key) {
      return res.status(400).json({
        message: 'uploadId and key are required',
        code: 'MISSING_REQUIRED_FIELDS',
      });
    }

    // Verify bug report exists and user has access
    const bugReport = await BugReport.find(bugId);
    if (!bugReport) {
      return res.status(404).json({
        message: 'Bug report not found',
        code: 'BUG_NOT_FOUND',
      });
    }

    // Authorization check
    const teamMembers = await Team.getMembers(bugReport.team_id);
    const isMember = teamMembers.some((member) => member.user_id === req.user.id);
    if (!isMember) {
      return res.status(403).json({
        message: 'Access denied: not a team member',
        code: 'ACCESS_DENIED',
      });
    }

    const bucket = process.env.AWS_S3_BUCKET_NAME;
    const s3 = await getS3Instance();

    await s3.abortMultipartUpload({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
    }).promise();

    return res.json({
      message: 'Multipart upload aborted successfully',
    });
  } catch (error) {
    console.error('Error aborting multipart upload:', error);
    return res.status(500).json({
      message: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
  }
};

/**
 * Enhanced batch upload confirmation with image-specific metadata
 */
exports.confirmUploads = async (req, res) => {
  try {
    const { bugId } = req.params;
    const { uploads } = req.body || {};

    if (!Array.isArray(uploads) || uploads.length === 0) {
      return res.status(400).json({
        message: 'uploads array is required and must not be empty',
        code: 'MISSING_UPLOADS',
      });
    }

    // Verify bug report exists and user has access
    const bugReport = await BugReport.find(bugId);
    if (!bugReport) {
      return res.status(404).json({
        message: 'Bug report not found',
        code: 'BUG_NOT_FOUND',
      });
    }

    // Authorization check
    const teamMembers = await Team.getMembers(bugReport.team_id);
    const isMember = teamMembers.some((member) => member.user_id === req.user.id);
    if (!isMember) {
      return res.status(403).json({
        message: 'Access denied: not a team member',
        code: 'ACCESS_DENIED',
      });
    }

    const artifacts = [];
    const validationErrors = [];

    const s3 = await getS3Instance();

    // Process each upload
    const uploadPromises = uploads.map(async (upload, i) => {
      if (!upload.bucket || !upload.key) {
        throw new Error(`Upload ${i}: bucket and key are required`);
      }

      // Verify the file exists in S3
      await s3.headObject({
        Bucket: upload.bucket,
        Key: upload.key,
      }).promise();

      // Prepare artifact data with enhanced metadata
      const artifactData = {
        bugReportId: Number(bugId),
        uploaderUserId: req.user.id,
        s3Bucket: upload.bucket,
        s3Key: upload.key,
        contentType: upload.contentType || null,
        sizeBytes: upload.sizeBytes || null,
        etag: upload.etag || null,
        status: 'uploaded',
        metadata: {
          originalname: upload.originalName || null,
          uploadType: upload.uploadType || 'standard',
        },
      };

      // Add image-specific metadata if it's an image
      if (upload.contentType && upload.contentType.startsWith('image/')) {
        artifactData.metadata.imageMetadata = {
          dimensions: upload.dimensions || null,
          colorSpace: upload.colorSpace || null,
          hasAlpha: upload.hasAlpha || false,
          animated: upload.animated || false,
        };

        // Store image variants information if provided
        if (upload.variants) {
          artifactData.imageVariants = upload.variants;
        }
      }

      return Artifact.createForBug(artifactData);
    });

    // Process all uploads concurrently
    const results = await Promise.allSettled(uploadPromises);

    results.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        artifacts.push(result.value);
      } else {
        console.error(`Error processing upload ${i}:`, result.reason);
        validationErrors.push(`Upload ${i}: ${result.reason.message}`);
      }
    });

    // Return validation errors if any uploads failed
    if (validationErrors.length > 0) {
      return res.status(400).json({
        message: 'Some uploads failed validation',
        errors: validationErrors,
        successfulArtifacts: artifacts,
        code: 'PARTIAL_SUCCESS',
      });
    }

    // Enqueue processing for all successful artifacts
    let jobId = null;
    if (artifacts.length > 0) {
      const artifactIds = artifacts.map((artifact) => artifact.id);
      jobId = await enqueueFileProcessingJob(Number(bugId), artifactIds);
    }

    return res.json({
      message: 'All uploads confirmed successfully',
      artifacts,
      jobId,
      count: artifacts.length,
    });
  } catch (error) {
    console.error('Error confirming uploads:', error);
    return res.status(500).json({
      message: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
  }
};

/**
 * Get upload progress and status
 */
exports.getUploadProgress = async (req, res) => {
  try {
    const { bugId, uploadId } = req.params;

    // Verify bug report exists and user has access
    const bugReport = await BugReport.find(bugId);
    if (!bugReport) {
      return res.status(404).json({
        message: 'Bug report not found',
        code: 'BUG_NOT_FOUND',
      });
    }

    // Authorization check
    const teamMembers = await Team.getMembers(bugReport.team_id);
    const isMember = teamMembers.some((member) => member.user_id === req.user.id);
    if (!isMember) {
      return res.status(403).json({
        message: 'Access denied: not a team member',
        code: 'ACCESS_DENIED',
      });
    }

    // For multipart uploads, list the parts to determine progress
    try {
      const bucket = process.env.AWS_S3_BUCKET_NAME;
      const s3 = await getS3Instance();
      const parts = await s3.listParts({
        Bucket: bucket,
        Key: req.query.key,
        UploadId: uploadId,
      }).promise();

      const totalParts = parseInt(req.query.totalParts, 10) || 0;
      const completedParts = parts.Parts ? parts.Parts.length : 0;
      const progress = totalParts > 0 ? Math.round((completedParts / totalParts) * 100) : 0;

      return res.json({
        uploadId,
        progress,
        completedParts,
        totalParts,
        parts: parts.Parts || [],
        status: completedParts === totalParts ? 'ready_to_complete' : 'in_progress',
      });
    } catch (error) {
      // If listing parts fails, the upload might not exist or be completed
      return res.json({
        uploadId,
        progress: 0,
        status: 'not_found',
        error: 'Upload not found or already completed',
      });
    }
  } catch (error) {
    console.error('Error getting upload progress:', error);
    return res.status(500).json({
      message: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
  }
};

// Export ALLOWED_FILE_TYPES for use by security middleware
module.exports.ALLOWED_FILE_TYPES = ALLOWED_FILE_TYPES;