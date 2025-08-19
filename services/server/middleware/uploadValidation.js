const rateLimit = require('express-rate-limit');

// Rate limiting configuration for uploads
const uploadRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // Limit each IP to 50 upload requests per windowMs
  message: {
    message: 'Too many upload requests from this IP, please try again later',
    code: 'RATE_LIMIT_EXCEEDED',
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req, res) => {
    // Use user ID if authenticated, otherwise fall back to IP
    return req.user?.id ? `user:${req.user.id}` : req.ip;
  },
});

// More restrictive rate limiting for multipart uploads
const multipartRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // Limit each user to 10 multipart uploads per hour
  message: {
    message: 'Too many multipart upload requests, please try again later',
    code: 'MULTIPART_RATE_LIMIT_EXCEEDED',
  },
  keyGenerator: (req, res) => `multipart:${req.user?.id || req.ip}`,
});

/**
 * Validate upload request middleware
 */
const validateUploadRequest = (req, res, next) => {
  const { filename, contentType, fileSize } = req.body || {};

  // Check required fields
  if (filename === undefined || contentType === undefined) {
    return res.status(400).json({
      message: 'filename and contentType are required',
      code: 'MISSING_REQUIRED_FIELDS',
    });
  }

  // Validate filename
  if (typeof filename !== 'string' || filename.length === 0 || filename.length > 255) {
    return res.status(400).json({
      message: 'filename must be a non-empty string with maximum 255 characters',
      code: 'INVALID_FILENAME',
    });
  }

  // Validate content type
  if (typeof contentType !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9!#$&\-\^_]*\/[a-zA-Z0-9][a-zA-Z0-9!#$&\-^_.]*$/.test(contentType)) {
    return res.status(400).json({
      message: 'contentType must be a valid MIME type',
      code: 'INVALID_CONTENT_TYPE',
    });
  }

  // Validate file size if provided
  if (fileSize !== undefined) {
    if (typeof fileSize !== 'number' || fileSize < 0 || fileSize > 1024 * 1024 * 1024) { // 1GB max
      return res.status(400).json({
        message: 'fileSize must be a number between 0 and 1GB',
        code: 'INVALID_FILE_SIZE',
      });
    }
  }

  return next();
};

/**
 * Validate multipart upload request middleware
 */
const validateMultipartRequest = (req, res, next) => {
  const { uploadId, key, partNumbers } = req.body || {};

  if (!uploadId || typeof uploadId !== 'string') {
    return res.status(400).json({
      message: 'uploadId must be a non-empty string',
      code: 'INVALID_UPLOAD_ID',
    });
  }

  if (!key || typeof key !== 'string') {
    return res.status(400).json({
      message: 'key must be a non-empty string',
      code: 'INVALID_KEY',
    });
  }

  if (partNumbers && !Array.isArray(partNumbers)) {
    return res.status(400).json({
      message: 'partNumbers must be an array',
      code: 'INVALID_PART_NUMBERS',
    });
  }

  if (partNumbers && partNumbers.length > 100) {
    return res.status(400).json({
      message: 'Maximum 100 parts allowed per request',
      code: 'TOO_MANY_PARTS',
    });
  }

  return next();
};

/**
 * Validate batch upload confirmation request middleware
 */
const validateBatchUploadRequest = (req, res, next) => {
  const { uploads } = req.body || {};

  if (!Array.isArray(uploads)) {
    return res.status(400).json({
      message: 'uploads must be an array',
      code: 'INVALID_UPLOADS_FORMAT',
    });
  }

  if (uploads.length === 0) {
    return res.status(400).json({
      message: 'uploads array cannot be empty',
      code: 'EMPTY_UPLOADS_ARRAY',
    });
  }

  if (uploads.length > 50) {
    return res.status(400).json({
      message: 'Maximum 50 uploads allowed per batch',
      code: 'TOO_MANY_UPLOADS',
    });
  }

  // Validate each upload object
  for (let i = 0; i < uploads.length; i += 1) {
    const upload = uploads[i];
    
    if (!upload || typeof upload !== 'object') {
      return res.status(400).json({
        message: `Upload ${i} must be an object`,
        code: 'INVALID_UPLOAD_OBJECT',
      });
    }

    if (!upload.bucket || typeof upload.bucket !== 'string') {
      return res.status(400).json({
        message: `Upload ${i}: bucket is required and must be a string`,
        code: 'INVALID_BUCKET',
      });
    }

    if (!upload.key || typeof upload.key !== 'string') {
      return res.status(400).json({
        message: `Upload ${i}: key is required and must be a string`,
        code: 'INVALID_KEY',
      });
    }
  }

  return next();
};

/**
 * Check user quota middleware
 */
const checkUserQuota = async (req, res, next) => {
  try {
    // This is a placeholder for quota checking logic
    // In a real implementation, you would check against user/team quotas
    const { fileSize } = req.body || {};
    
    // Example: Check if user has exceeded daily upload quota
    const dailyQuotaBytes = 10 * 1024 * 1024 * 1024; // 10GB per day
    const userDailyUsage = 0; // This would be fetched from database
    
    if (fileSize && (userDailyUsage + fileSize) > dailyQuotaBytes) {
      return res.status(429).json({
        message: 'Daily upload quota exceeded',
        code: 'QUOTA_EXCEEDED',
        quotaInfo: {
          dailyLimit: dailyQuotaBytes,
          currentUsage: userDailyUsage,
          remaining: Math.max(0, dailyQuotaBytes - userDailyUsage),
        },
      });
    }

    return next();
  } catch (error) {
    console.error('Error checking user quota:', error);
    return res.status(500).json({
      message: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
  }
};

/**
 * Security headers middleware for uploads
 */
const setUploadSecurityHeaders = (req, res, next) => {
  // Prevent caching of upload responses
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Surrogate-Control': 'no-store',
  });

  return next();
};

module.exports = {
  uploadRateLimit,
  multipartRateLimit,
  validateUploadRequest,
  validateMultipartRequest,
  validateBatchUploadRequest,
  checkUserQuota,
  setUploadSecurityHeaders,
};