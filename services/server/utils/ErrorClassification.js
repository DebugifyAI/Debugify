/**
 * Error Classification System
 * Categorizes different types of errors for appropriate handling and retry strategies
 */

/**
 * Error categories with specific handling strategies
 */
const ERROR_CATEGORIES = {
  // Transient errors that should be retried
  TRANSIENT: {
    name: 'TRANSIENT',
    description: 'Temporary errors that may resolve on retry',
    retryable: true,
    maxRetries: 5,
    baseDelay: 1000,
    maxDelay: 300000, // 5 minutes
    backoffMultiplier: 2,
    jitterFactor: 0.1,
  },
  
  // Rate limiting errors
  RATE_LIMIT: {
    name: 'RATE_LIMIT',
    description: 'Rate limiting or quota exceeded errors',
    retryable: true,
    maxRetries: 3,
    baseDelay: 5000,
    maxDelay: 600000, // 10 minutes
    backoffMultiplier: 3,
    jitterFactor: 0.2,
  },
  
  // Network and connectivity errors
  NETWORK: {
    name: 'NETWORK',
    description: 'Network connectivity and timeout errors',
    retryable: true,
    maxRetries: 4,
    baseDelay: 2000,
    maxDelay: 120000, // 2 minutes
    backoffMultiplier: 2,
    jitterFactor: 0.15,
  },
  
  // Resource exhaustion errors
  RESOURCE: {
    name: 'RESOURCE',
    description: 'Memory, disk, or other resource exhaustion',
    retryable: true,
    maxRetries: 2,
    baseDelay: 10000,
    maxDelay: 300000, // 5 minutes
    backoffMultiplier: 3,
    jitterFactor: 0.1,
  },
  
  // Image processing specific errors
  IMAGE_PROCESSING: {
    name: 'IMAGE_PROCESSING',
    description: 'Image format, size, or processing errors',
    retryable: true,
    maxRetries: 2,
    baseDelay: 3000,
    maxDelay: 60000, // 1 minute
    backoffMultiplier: 2,
    jitterFactor: 0.1,
  },
  
  // LLM service errors
  LLM_SERVICE: {
    name: 'LLM_SERVICE',
    description: 'LLM API and processing errors',
    retryable: true,
    maxRetries: 3,
    baseDelay: 5000,
    maxDelay: 300000, // 5 minutes
    backoffMultiplier: 2.5,
    jitterFactor: 0.2,
  },
  
  // Validation errors (not retryable)
  VALIDATION: {
    name: 'VALIDATION',
    description: 'Input validation and format errors',
    retryable: false,
    maxRetries: 0,
    baseDelay: 0,
    maxDelay: 0,
    backoffMultiplier: 1,
    jitterFactor: 0,
  },
  
  // Security errors (not retryable)
  SECURITY: {
    name: 'SECURITY',
    description: 'Security violations and malicious content',
    retryable: false,
    maxRetries: 0,
    baseDelay: 0,
    maxDelay: 0,
    backoffMultiplier: 1,
    jitterFactor: 0,
  },
  
  // Configuration errors (not retryable)
  CONFIGURATION: {
    name: 'CONFIGURATION',
    description: 'Configuration and setup errors',
    retryable: false,
    maxRetries: 0,
    baseDelay: 0,
    maxDelay: 0,
    backoffMultiplier: 1,
    jitterFactor: 0,
  },
  
  // System errors
  SYSTEM: {
    name: 'SYSTEM',
    description: 'Critical system and infrastructure errors',
    retryable: true,
    maxRetries: 2,
    baseDelay: 15000,
    maxDelay: 600000, // 10 minutes
    backoffMultiplier: 3,
    jitterFactor: 0.1,
  },
  
  // Unknown errors
  UNKNOWN: {
    name: 'UNKNOWN',
    description: 'Unclassified errors',
    retryable: true,
    maxRetries: 1,
    baseDelay: 5000,
    maxDelay: 60000, // 1 minute
    backoffMultiplier: 2,
    jitterFactor: 0.1,
  },
};

/**
 * Error patterns for automatic classification
 */
const ERROR_PATTERNS = {
  // Network and connectivity patterns
  NETWORK: [
    /ECONNREFUSED/i,
    /ENOTFOUND/i,
    /ETIMEDOUT/i,
    /ECONNRESET/i,
    /socket hang up/i,
    /network timeout/i,
    /connection refused/i,
    /dns lookup failed/i,
    /request timeout/i,
  ],
  
  // Rate limiting patterns
  RATE_LIMIT: [
    /rate limit/i,
    /quota exceeded/i,
    /too many requests/i,
    /429/,
    /throttled/i,
    /rate exceeded/i,
    /api limit/i,
  ],
  
  // Resource exhaustion patterns
  RESOURCE: [
    /out of memory/i,
    /memory limit/i,
    /disk full/i,
    /no space left/i,
    /resource exhausted/i,
    /heap out of memory/i,
    /maximum call stack/i,
    /ENOMEM/i,
    /ENOSPC/i,
  ],
  
  // Image processing patterns
  IMAGE_PROCESSING: [
    /invalid image/i,
    /unsupported format/i,
    /image too large/i,
    /corrupt image/i,
    /invalid jpeg/i,
    /invalid png/i,
    /image decode/i,
    /sharp/i,
    /tesseract/i,
    /ocr failed/i,
    /image processing/i,
  ],
  
  // LLM service patterns
  LLM_SERVICE: [
    /openai/i,
    /anthropic/i,
    /ollama/i,
    /llm/i,
    /model not found/i,
    /context length/i,
    /token limit/i,
    /inference failed/i,
    /model error/i,
  ],
  
  // Validation patterns
  VALIDATION: [
    /validation failed/i,
    /invalid input/i,
    /schema validation/i,
    /required field/i,
    /invalid format/i,
    /malformed/i,
    /parse error/i,
    /syntax error/i,
  ],
  
  // Security patterns
  SECURITY: [
    /virus detected/i,
    /malware/i,
    /security violation/i,
    /unauthorized/i,
    /forbidden/i,
    /access denied/i,
    /authentication failed/i,
    /invalid token/i,
    /permission denied/i,
  ],
  
  // Configuration patterns
  CONFIGURATION: [
    /config/i,
    /environment variable/i,
    /missing credential/i,
    /invalid configuration/i,
    /setup error/i,
    /initialization failed/i,
  ],
  
  // System patterns
  SYSTEM: [
    /database/i,
    /redis/i,
    /s3/i,
    /aws/i,
    /infrastructure/i,
    /service unavailable/i,
    /internal server error/i,
    /500/,
    /503/,
  ],
};

/**
 * Error Classification Service
 */
class ErrorClassification {
  /**
   * Classify an error based on its properties
   * @param {Error} error - Error to classify
   * @param {Object} context - Additional context
   * @returns {Object} Classification result
   */
  static classifyError(error, context = {}) {
    try {
      const errorInfo = {
        message: error.message || '',
        name: error.name || '',
        code: error.code || '',
        stack: error.stack || '',
        statusCode: error.statusCode || error.status || 0,
        ...context,
      };

      // Try to match against known patterns
      const category = this.matchErrorPatterns(errorInfo);
      const categoryConfig = ERROR_CATEGORIES[category] || ERROR_CATEGORIES.UNKNOWN;

      return {
        category: category,
        config: categoryConfig,
        errorInfo,
        classification: {
          retryable: categoryConfig.retryable,
          maxRetries: categoryConfig.maxRetries,
          severity: this.determineSeverity(category, errorInfo),
          alertRequired: this.shouldAlert(category, errorInfo),
        },
        timestamp: new Date().toISOString(),
      };

    } catch (classificationError) {
      console.error('Error during error classification:', classificationError);
      
      // Fallback to unknown category
      return {
        category: 'UNKNOWN',
        config: ERROR_CATEGORIES.UNKNOWN,
        errorInfo: { message: error.message || 'Unknown error' },
        classification: {
          retryable: true,
          maxRetries: 1,
          severity: 'medium',
          alertRequired: false,
        },
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Match error against known patterns
   * @param {Object} errorInfo - Error information
   * @returns {string} Category name
   */
  static matchErrorPatterns(errorInfo) {
    const searchText = `${errorInfo.message} ${errorInfo.name} ${errorInfo.code}`.toLowerCase();

    // Check each category's patterns
    for (const [category, patterns] of Object.entries(ERROR_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(searchText)) {
          return category;
        }
      }
    }

    // Check HTTP status codes
    if (errorInfo.statusCode) {
      if (errorInfo.statusCode === 429) return 'RATE_LIMIT';
      if (errorInfo.statusCode >= 500 && errorInfo.statusCode < 600) return 'SYSTEM';
      if (errorInfo.statusCode === 401 || errorInfo.statusCode === 403) return 'SECURITY';
      if (errorInfo.statusCode >= 400 && errorInfo.statusCode < 500) return 'VALIDATION';
    }

    return 'UNKNOWN';
  }

  /**
   * Determine error severity
   * @param {string} category - Error category
   * @param {Object} errorInfo - Error information
   * @returns {string} Severity level
   */
  static determineSeverity(category, errorInfo) {
    // Critical severity
    if (['SECURITY', 'SYSTEM'].includes(category)) {
      return 'critical';
    }

    // High severity
    if (['CONFIGURATION', 'RESOURCE'].includes(category)) {
      return 'high';
    }

    // Medium severity
    if (['NETWORK', 'LLM_SERVICE', 'IMAGE_PROCESSING'].includes(category)) {
      return 'medium';
    }

    // Low severity
    if (['VALIDATION', 'RATE_LIMIT', 'TRANSIENT'].includes(category)) {
      return 'low';
    }

    return 'medium';
  }

  /**
   * Determine if error requires alerting
   * @param {string} category - Error category
   * @param {Object} errorInfo - Error information
   * @returns {boolean} True if alert required
   */
  static shouldAlert(category, errorInfo) {
    // Always alert for critical categories
    if (['SECURITY', 'SYSTEM', 'CONFIGURATION'].includes(category)) {
      return true;
    }

    // Alert for resource issues
    if (category === 'RESOURCE') {
      return true;
    }

    // Alert for repeated failures (would need retry count context)
    if (errorInfo.retryCount && errorInfo.retryCount >= 3) {
      return true;
    }

    return false;
  }

  /**
   * Get all available error categories
   * @returns {Object} Error categories
   */
  static getCategories() {
    return { ...ERROR_CATEGORIES };
  }

  /**
   * Get category configuration
   * @param {string} category - Category name
   * @returns {Object} Category configuration
   */
  static getCategoryConfig(category) {
    return ERROR_CATEGORIES[category] || ERROR_CATEGORIES.UNKNOWN;
  }

  /**
   * Create a standardized error object
   * @param {string} category - Error category
   * @param {string} message - Error message
   * @param {Object} details - Additional details
   * @returns {Error} Standardized error
   */
  static createError(category, message, details = {}) {
    const error = new Error(message);
    error.category = category;
    error.details = details;
    error.timestamp = new Date().toISOString();
    
    const categoryConfig = ERROR_CATEGORIES[category];
    if (categoryConfig) {
      error.retryable = categoryConfig.retryable;
      error.maxRetries = categoryConfig.maxRetries;
    }

    return error;
  }
}

module.exports = {
  ErrorClassification,
  ERROR_CATEGORIES,
  ERROR_PATTERNS,
};