const rateLimit = require('express-rate-limit');
const { User } = require('../models/User');
const { Team } = require('../models/Team');
const Artifact = require('../models/Artifact');

/**
 * Enhanced rate limiting with user-specific quotas
 */

// Standard upload rate limiting
const uploadRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: async (req) => {
    // Dynamic limits based on user role/plan
    if (req.user?.role === 'admin') return 200;
    if (req.user?.role === 'premium') return 100;
    return 50; // Default for regular users
  },
  message: {
    message: 'Upload rate limit exceeded. Please try again later.',
    code: 'RATE_LIMIT_EXCEEDED',
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req, res) => {
    return req.user?.id ? `upload:${req.user.id}` : `upload:${req.ip}`;
  },
  skip: (req) => {
    // Skip rate limiting for health checks or admin endpoints
    return req.path.includes('/health') || req.user?.role === 'system';
  },
});

// Stricter rate limiting for high-security file types
const highSecurityRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // Very restrictive for archives, executables, etc.
  message: {
    message: 'High-security file upload limit exceeded. Please contact support if you need higher limits.',
    code: 'HIGH_SECURITY_RATE_LIMIT_EXCEEDED',
  },
  keyGenerator: (req, res) => `high-sec:${req.user?.id || req.ip}`,
});

// Multipart upload rate limiting
const multipartRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: async (req) => {
    if (req.user?.role === 'admin') return 50;
    if (req.user?.role === 'premium') return 20;
    return 5; // Default for regular users
  },
  message: {
    message: 'Multipart upload limit exceeded. Please try again later.',
    code: 'MULTIPART_RATE_LIMIT_EXCEEDED',
  },
  keyGenerator: (req, res) => `multipart:${req.user?.id || req.ip}`,
});

/**
 * User quota enforcement middleware
 */
const enforceUserQuota = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: 'Authentication required for quota enforcement',
        code: 'AUTH_REQUIRED',
      });
    }

    const { fileSize } = req.body || {};
    const userId = req.user.id;

    // Get user's current quota usage
    const quotaInfo = await getUserQuotaInfo(userId);
    
    // Check daily quota
    if (fileSize && (quotaInfo.dailyUsage + fileSize) > quotaInfo.dailyLimit) {
      return res.status(429).json({
        message: 'Daily upload quota exceeded',
        code: 'DAILY_QUOTA_EXCEEDED',
        quotaInfo: {
          dailyLimit: quotaInfo.dailyLimit,
          currentUsage: quotaInfo.dailyUsage,
          remaining: Math.max(0, quotaInfo.dailyLimit - quotaInfo.dailyUsage),
          resetTime: quotaInfo.dailyResetTime,
        },
      });
    }

    // Check monthly quota
    if (fileSize && (quotaInfo.monthlyUsage + fileSize) > quotaInfo.monthlyLimit) {
      return res.status(429).json({
        message: 'Monthly upload quota exceeded',
        code: 'MONTHLY_QUOTA_EXCEEDED',
        quotaInfo: {
          monthlyLimit: quotaInfo.monthlyLimit,
          currentUsage: quotaInfo.monthlyUsage,
          remaining: Math.max(0, quotaInfo.monthlyLimit - quotaInfo.monthlyUsage),
          resetTime: quotaInfo.monthlyResetTime,
        },
      });
    }

    // Check file count limits
    if (quotaInfo.dailyFileCount >= quotaInfo.dailyFileLimit) {
      return res.status(429).json({
        message: 'Daily file count limit exceeded',
        code: 'DAILY_FILE_LIMIT_EXCEEDED',
        quotaInfo: {
          dailyFileLimit: quotaInfo.dailyFileLimit,
          currentCount: quotaInfo.dailyFileCount,
          resetTime: quotaInfo.dailyResetTime,
        },
      });
    }

    // Store quota info in request for later use
    req.quotaInfo = quotaInfo;
    
    return next();
  } catch (error) {
    console.error('Error enforcing user quota:', error);
    return res.status(500).json({
      message: 'Internal server error during quota check',
      code: 'QUOTA_CHECK_ERROR',
    });
  }
};

/**
 * Team quota enforcement middleware
 */
const enforceTeamQuota = async (req, res, next) => {
  try {
    const { bugId } = req.params;
    if (!bugId || !req.user) {
      return next();
    }

    // Get team quota info
    const teamQuotaInfo = await getTeamQuotaInfo(bugId, req.user.id);
    
    if (!teamQuotaInfo) {
      return next(); // No team quota restrictions
    }

    const { fileSize } = req.body || {};

    // Check team storage quota
    if (fileSize && (teamQuotaInfo.currentUsage + fileSize) > teamQuotaInfo.storageLimit) {
      return res.status(429).json({
        message: 'Team storage quota exceeded',
        code: 'TEAM_QUOTA_EXCEEDED',
        quotaInfo: {
          storageLimit: teamQuotaInfo.storageLimit,
          currentUsage: teamQuotaInfo.currentUsage,
          remaining: Math.max(0, teamQuotaInfo.storageLimit - teamQuotaInfo.currentUsage),
        },
      });
    }

    req.teamQuotaInfo = teamQuotaInfo;
    return next();
  } catch (error) {
    console.error('Error enforcing team quota:', error);
    return next(); // Don't block on team quota errors
  }
};

/**
 * Security level enforcement based on file type
 */
const enforceSecurityLevel = (req, res, next) => {
  const { contentType } = req.body || {};
  
  if (!contentType) {
    return next();
  }

  // Import ALLOWED_FILE_TYPES from upload controller
  const ALLOWED_FILE_TYPES = require('../controllers/uploadController').ALLOWED_FILE_TYPES || {};
  const fileTypeConfig = ALLOWED_FILE_TYPES[contentType];
  
  if (fileTypeConfig?.securityLevel === 'high') {
    // Apply high security rate limiting
    return highSecurityRateLimit(req, res, next);
  }
  
  return next();
};

/**
 * Helper functions
 */

async function getUserQuotaInfo(userId) {
  try {
    // Get user info to determine quota limits
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    // Define quota limits based on user role/plan
    const quotaLimits = getQuotaLimits(user.role || 'user');
    
    // Calculate current usage
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    
    // Get daily usage
    const dailyUsage = await Artifact.query()
      .where('uploader_user_id', userId)
      .where('created_at', '>=', startOfDay.toISOString())
      .sum('size_bytes as total')
      .first();
    
    const dailyFileCount = await Artifact.query()
      .where('uploader_user_id', userId)
      .where('created_at', '>=', startOfDay.toISOString())
      .count('* as count')
      .first();
    
    // Get monthly usage
    const monthlyUsage = await Artifact.query()
      .where('uploader_user_id', userId)
      .where('created_at', '>=', startOfMonth.toISOString())
      .sum('size_bytes as total')
      .first();

    return {
      dailyLimit: quotaLimits.dailyBytes,
      dailyUsage: parseInt(dailyUsage?.total || 0, 10),
      dailyFileLimit: quotaLimits.dailyFiles,
      dailyFileCount: parseInt(dailyFileCount?.count || 0, 10),
      dailyResetTime: new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000),
      
      monthlyLimit: quotaLimits.monthlyBytes,
      monthlyUsage: parseInt(monthlyUsage?.total || 0, 10),
      monthlyResetTime: new Date(startOfMonth.getFullYear(), startOfMonth.getMonth() + 1, 1),
    };
  } catch (error) {
    console.error('Error getting user quota info:', error);
    // Return default quotas on error
    return getQuotaLimits('user');
  }
}

async function getTeamQuotaInfo(bugId, userId) {
  try {
    // This would be implemented based on your team/bug relationship model
    // For now, return null to indicate no team quota restrictions
    return null;
  } catch (error) {
    console.error('Error getting team quota info:', error);
    return null;
  }
}

function getQuotaLimits(userRole) {
  const limits = {
    admin: {
      dailyBytes: 50 * 1024 * 1024 * 1024, // 50GB
      dailyFiles: 1000,
      monthlyBytes: 1000 * 1024 * 1024 * 1024, // 1TB
    },
    premium: {
      dailyBytes: 10 * 1024 * 1024 * 1024, // 10GB
      dailyFiles: 500,
      monthlyBytes: 200 * 1024 * 1024 * 1024, // 200GB
    },
    user: {
      dailyBytes: 2 * 1024 * 1024 * 1024, // 2GB
      dailyFiles: 100,
      monthlyBytes: 20 * 1024 * 1024 * 1024, // 20GB
    },
  };

  return limits[userRole] || limits.user;
}

module.exports = {
  uploadRateLimit,
  highSecurityRateLimit,
  multipartRateLimit,
  enforceUserQuota,
  enforceTeamQuota,
  enforceSecurityLevel,
  getUserQuotaInfo,
};