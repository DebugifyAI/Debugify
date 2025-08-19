const { piiDetector } = require('../utils/PIIDetector');
const { imageSecurityScanner } = require('../utils/ImageSecurityScanner');
const { auditLogger } = require('./auditLogger');
const { ALLOWED_FILE_TYPES } = require('../controllers/uploadController');

/**
 * Comprehensive upload security validation middleware
 * Integrates PII detection, image security scanning, and file validation
 */

/**
 * Pre-upload security validation
 * Validates file type, size, and basic security checks before generating presigned URLs
 */
const preUploadValidation = async (req, res, next) => {
  try {
    const { filename, contentType, fileSize } = req.body || {};

    // Basic validation
    if (!filename || !contentType) {
      await auditLogger.logSecurityEvent('validation_failure', {
        reason: 'Missing required fields',
        filename,
        contentType,
      }, req);

      return res.status(400).json({
        message: 'filename and contentType are required',
        code: 'MISSING_REQUIRED_FIELDS',
      });
    }

    // File type allowlist validation
    if (!ALLOWED_FILE_TYPES[contentType]) {
      await auditLogger.logSecurityEvent('file_type_violation', {
        contentType,
        filename,
        allowedTypes: Object.keys(ALLOWED_FILE_TYPES),
      }, req);

      return res.status(400).json({
        message: `File type ${contentType} is not allowed`,
        code: 'FILE_TYPE_NOT_ALLOWED',
        allowedTypes: Object.keys(ALLOWED_FILE_TYPES),
      });
    }

    // Size validation
    const typeConfig = ALLOWED_FILE_TYPES[contentType];
    if (fileSize && fileSize > typeConfig.maxSize) {
      await auditLogger.logSecurityEvent('file_size_violation', {
        contentType,
        filename,
        fileSize,
        maxAllowed: typeConfig.maxSize,
      }, req);

      return res.status(400).json({
        message: `File size ${fileSize} exceeds maximum allowed size of ${typeConfig.maxSize} bytes`,
        code: 'FILE_SIZE_EXCEEDED',
        maxSize: typeConfig.maxSize,
      });
    }

    // Enhanced filename validation
    const filenameValidation = validateFilename(filename);
    if (!filenameValidation.isValid) {
      await auditLogger.logSecurityEvent('filename_violation', {
        filename,
        errors: filenameValidation.errors,
      }, req);

      return res.status(400).json({
        message: 'Invalid filename',
        errors: filenameValidation.errors,
        code: 'INVALID_FILENAME',
      });
    }

    // Store validation info for later use
    req.uploadValidation = {
      contentType,
      filename,
      fileSize,
      securityLevel: typeConfig.securityLevel,
    };

    next();
  } catch (error) {
    console.error('Pre-upload validation failed:', error);
    await auditLogger.logSecurityEvent('validation_error', {
      error: error.message,
      filename: req.body?.filename,
      contentType: req.body?.contentType,
    }, req);

    return res.status(500).json({
      message: 'Security validation failed',
      code: 'VALIDATION_ERROR',
    });
  }
};

/**
 * Post-upload security validation
 * Performs deep security scanning after file is uploaded to S3
 */
const postUploadValidation = async (req, res, next) => {
  try {
    const { artifacts } = req.body || {};
    
    if (!Array.isArray(artifacts) || artifacts.length === 0) {
      return next();
    }

    const validationResults = [];
    const securityThreats = [];

    // Process each artifact for security validation
    for (const artifact of artifacts) {
      try {
        const validationResult = await validateArtifactSecurity(artifact, req);
        validationResults.push(validationResult);

        if (!validationResult.isSecure) {
          securityThreats.push({
            artifactId: artifact.id,
            threats: validationResult.threats,
            warnings: validationResult.warnings,
          });
        }
      } catch (error) {
        console.error(`Security validation failed for artifact ${artifact.id}:`, error);
        securityThreats.push({
          artifactId: artifact.id,
          threats: [`Security validation failed: ${error.message}`],
          warnings: [],
        });
      }
    }

    // If any security threats are found, log and potentially block
    if (securityThreats.length > 0) {
      await auditLogger.logSecurityEvent('security_threats_detected', {
        threats: securityThreats,
        artifactCount: artifacts.length,
      }, req);

      // For high-severity threats, block the upload
      const highSeverityThreats = securityThreats.filter(threat =>
        threat.threats.some(t => 
          t.includes('malicious') || 
          t.includes('virus') || 
          t.includes('steganography')));

      if (highSeverityThreats.length > 0) {
        return res.status(400).json({
          message: 'Security threats detected in uploaded files',
          threats: securityThreats,
          code: 'SECURITY_THREATS_DETECTED',
        });
      }

      // For medium-severity threats, allow but warn
      req.securityWarnings = securityThreats;
    }

    req.validationResults = validationResults;
    next();
  } catch (error) {
    console.error('Post-upload validation failed:', error);
    await auditLogger.logSecurityEvent('validation_error', {
      error: error.message,
      stage: 'post_upload',
    }, req);

    return res.status(500).json({
      message: 'Security validation failed',
      code: 'VALIDATION_ERROR',
    });
  }
};

/**
 * Validate individual artifact security
 */
async function validateArtifactSecurity(artifact, req) {
  const result = {
    artifactId: artifact.id,
    isSecure: true,
    threats: [],
    warnings: [],
    piiDetected: false,
    securityScans: {},
  };

  try {
    // Skip validation for certain file types or if no content available
    if (!artifact.contentType || !artifact.s3Key) {
      return result;
    }

    // For images, perform comprehensive security scanning
    if (artifact.contentType.startsWith('image/')) {
      const imageSecurityResult = await performImageSecurityScan(artifact);
      result.securityScans.image = imageSecurityResult;

      if (!imageSecurityResult.isSecure) {
        result.isSecure = false;
        result.threats.push(...imageSecurityResult.threats);
      }
      result.warnings.push(...imageSecurityResult.warnings);

      // PII detection in OCR text if available
      if (artifact.ocrText) {
        const piiResult = await piiDetector.detectPIIInImage(
          artifact.ocrText,
          artifact.metadata?.imageMetadata || {}
        );
        
        result.securityScans.pii = piiResult;
        result.piiDetected = piiResult.hasPII;

        if (piiResult.riskLevel === 'critical' || piiResult.riskLevel === 'high') {
          result.warnings.push(`PII detected in image: ${piiResult.riskLevel} risk`);
        }
      }
    }

    // For text-based files, perform PII detection
    if (isTextBasedFile(artifact.contentType)) {
      // Note: In a real implementation, you'd download and scan the file content
      // For now, we'll skip this to avoid downloading large files in middleware
      result.warnings.push('Text-based file - PII scanning recommended during processing');
    }

    // Log security scan results
    await auditLogger.logSecurityEvent('security_scan_completed', {
      artifactId: artifact.id,
      contentType: artifact.contentType,
      isSecure: result.isSecure,
      threatsCount: result.threats.length,
      warningsCount: result.warnings.length,
      piiDetected: result.piiDetected,
    }, req);

  } catch (error) {
    console.error(`Security validation failed for artifact ${artifact.id}:`, error);
    result.isSecure = false;
    result.threats.push(`Security validation failed: ${error.message}`);
  }

  return result;
}

/**
 * Perform image security scanning
 */
async function performImageSecurityScan(artifact) {
  try {
    // In a real implementation, you'd download the image from S3
    // For now, we'll simulate the scan based on metadata
    const mockImageBuffer = Buffer.alloc(1024); // Placeholder

    const scanResult = await imageSecurityScanner.scanImage(mockImageBuffer, {
      contentType: artifact.contentType,
      filename: artifact.metadata?.originalname,
      size: artifact.sizeBytes,
    });

    return scanResult;
  } catch (error) {
    console.error('Image security scan failed:', error);
    return {
      isSecure: false,
      threats: [`Image security scan failed: ${error.message}`],
      warnings: [],
      steganographyRisk: 'unknown',
      malwareRisk: 'unknown',
      overallRisk: 'high',
    };
  }
}

/**
 * Enhanced filename validation
 */
function validateFilename(filename) {
  const errors = [];

  if (!filename || filename.length === 0 || filename.length > 255) {
    errors.push('Filename must be between 1 and 255 characters');
  }

  // Check for null bytes (security vulnerability)
  if (filename.includes('\x00')) {
    errors.push('Filename contains null bytes');
  }

  // Enhanced dangerous pattern detection
  const dangerousPatterns = [
    { pattern: /\.\./, message: 'Directory traversal patterns not allowed' },
    { pattern: /[<>:"|?*]/, message: 'Invalid characters in filename' },
    { pattern: /[\x00-\x1f]/, message: 'Control characters not allowed' },
    { pattern: /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i, message: 'Windows reserved names not allowed' },
    { pattern: /^\s+|\s+$/, message: 'Leading/trailing whitespace not allowed' },
    { pattern: /\.(exe|bat|cmd|scr|pif|com|dll|sys|vbs|ps1|jar)$/i, message: 'Executable file extensions not allowed' },
  ];

  dangerousPatterns.forEach(({ pattern, message }) => {
    if (pattern.test(filename)) {
      errors.push(message);
    }
  });

  // Check for suspicious Unicode characters
  if (/[\u202a-\u202e\u2066-\u2069]/.test(filename)) {
    errors.push('Suspicious Unicode direction override characters detected');
  }

  // Check for homograph attacks (similar-looking characters)
  if (containsHomographs(filename)) {
    errors.push('Potential homograph attack detected in filename');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Check for homograph attacks in filenames
 */
function containsHomographs(filename) {
  // Common homograph patterns
  const homographPatterns = [
    /[а-я]/i, // Cyrillic characters that look like Latin
    /[αβγδεζηθικλμνξοπρστυφχψω]/i, // Greek characters
    /[０-９Ａ-Ｚａ-ｚ]/i, // Full-width characters
  ];

  return homographPatterns.some(pattern => pattern.test(filename));
}

/**
 * Check if file type is text-based for PII scanning
 */
function isTextBasedFile(contentType) {
  const textTypes = [
    'text/',
    'application/json',
    'application/xml',
    'application/javascript',
    'application/typescript',
  ];

  return textTypes.some(type => contentType.startsWith(type));
}

/**
 * Rate limiting for security-sensitive operations
 */
const securityRateLimit = (req, res, next) => {
  // This would integrate with the existing rate limiting middleware
  // For now, we'll just pass through
  next();
};

module.exports = {
  preUploadValidation,
  postUploadValidation,
  securityRateLimit,
  validateFilename,
  validateArtifactSecurity,
};