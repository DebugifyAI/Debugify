const { ErrorClassification } = require('./ErrorClassification');

/**
 * Retry Manager with Exponential Backoff and Jitter
 * Handles retry logic for different types of operations with intelligent backoff strategies
 */
class RetryManager {
  constructor(options = {}) {
    this.defaultOptions = {
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 300000, // 5 minutes
      backoffMultiplier: 2,
      jitterFactor: 0.1,
      enableJitter: true,
      retryCondition: null, // Custom retry condition function
      onRetry: null, // Callback for retry events
      onFailure: null, // Callback for final failure
      ...options,
    };
  }

  /**
   * Execute a function with retry logic
   * @param {Function} fn - Function to execute
   * @param {Object} options - Retry options
   * @param {Object} context - Execution context
   * @returns {Promise} Result of function execution
   */
  async executeWithRetry(fn, options = {}, context = {}) {
    const config = { ...this.defaultOptions, ...options };
    let lastError = null;
    let attempt = 0;

    while (attempt <= config.maxRetries) {
      try {
        // Execute the function
        const result = await fn(attempt, context);
        
        // Success - log if this was a retry
        if (attempt > 0) {
          console.log(`✅ Operation succeeded on attempt ${attempt + 1}/${config.maxRetries + 1}`);
          
          if (config.onRetry) {
            await config.onRetry({
              attempt,
              success: true,
              context,
              result,
            });
          }
        }
        
        return result;

      } catch (error) {
        lastError = error;
        attempt++;

        // Classify the error to determine retry strategy
        const classification = ErrorClassification.classifyError(error, {
          attempt,
          maxRetries: config.maxRetries,
          context,
        });

        console.error(`❌ Attempt ${attempt}/${config.maxRetries + 1} failed:`, {
          error: error.message,
          category: classification.category,
          retryable: classification.classification.retryable,
        });

        // Check if we should retry
        const shouldRetry = this.shouldRetry(error, attempt, config, classification);
        
        if (!shouldRetry || attempt > config.maxRetries) {
          // Final failure
          console.error(`🚫 Operation failed after ${attempt} attempts`);
          
          if (config.onFailure) {
            await config.onFailure({
              error: lastError,
              attempts: attempt,
              classification,
              context,
            });
          }
          
          throw this.createRetryExhaustedError(lastError, attempt, classification);
        }

        // Calculate delay for next retry
        const delay = this.calculateDelay(attempt, config, classification);
        
        console.log(`⏳ Retrying in ${delay}ms (attempt ${attempt + 1}/${config.maxRetries + 1})`);

        // Call retry callback
        if (config.onRetry) {
          await config.onRetry({
            attempt,
            error,
            delay,
            classification,
            context,
          });
        }

        // Wait before retry
        await this.sleep(delay);
      }
    }

    // This should never be reached, but just in case
    throw this.createRetryExhaustedError(lastError, attempt, null);
  }

  /**
   * Determine if an error should be retried
   * @param {Error} error - The error that occurred
   * @param {number} attempt - Current attempt number
   * @param {Object} config - Retry configuration
   * @param {Object} classification - Error classification
   * @returns {boolean} True if should retry
   */
  shouldRetry(error, attempt, config, classification) {
    // Check if we've exceeded max retries
    if (attempt > config.maxRetries) {
      return false;
    }

    // Use custom retry condition if provided
    if (config.retryCondition) {
      return config.retryCondition(error, attempt, classification);
    }

    // Use classification to determine retryability
    if (classification && classification.classification) {
      return classification.classification.retryable;
    }

    // Default: retry for most errors except validation/security
    const nonRetryablePatterns = [
      /validation/i,
      /unauthorized/i,
      /forbidden/i,
      /not found/i,
      /bad request/i,
    ];

    const errorMessage = error.message || '';
    return !nonRetryablePatterns.some(pattern => pattern.test(errorMessage));
  }

  /**
   * Calculate delay for next retry with exponential backoff and jitter
   * @param {number} attempt - Current attempt number (1-based)
   * @param {Object} config - Retry configuration
   * @param {Object} classification - Error classification
   * @returns {number} Delay in milliseconds
   */
  calculateDelay(attempt, config, classification) {
    // Use classification-specific delay if available
    let baseDelay = config.baseDelay;
    let maxDelay = config.maxDelay;
    let multiplier = config.backoffMultiplier;
    let jitterFactor = config.jitterFactor;

    if (classification && classification.config) {
      baseDelay = classification.config.baseDelay || baseDelay;
      maxDelay = classification.config.maxDelay || maxDelay;
      multiplier = classification.config.backoffMultiplier || multiplier;
      jitterFactor = classification.config.jitterFactor || jitterFactor;
    }

    // Calculate exponential backoff
    let delay = baseDelay * Math.pow(multiplier, attempt - 1);

    // Apply maximum delay limit
    delay = Math.min(delay, maxDelay);

    // Add jitter to prevent thundering herd
    if (config.enableJitter && jitterFactor > 0) {
      const jitter = delay * jitterFactor * (Math.random() * 2 - 1); // Random between -jitterFactor and +jitterFactor
      delay = Math.max(0, delay + jitter);
    }

    return Math.round(delay);
  }

  /**
   * Create a retry exhausted error
   * @param {Error} originalError - Original error
   * @param {number} attempts - Number of attempts made
   * @param {Object} classification - Error classification
   * @returns {Error} Retry exhausted error
   */
  createRetryExhaustedError(originalError, attempts, classification) {
    const error = new Error(`Operation failed after ${attempts} attempts: ${originalError.message}`);
    error.name = 'RetryExhaustedError';
    error.originalError = originalError;
    error.attempts = attempts;
    error.classification = classification;
    error.timestamp = new Date().toISOString();
    
    return error;
  }

  /**
   * Sleep for specified milliseconds
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise} Promise that resolves after delay
   */
  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Create a retry wrapper for a function
   * @param {Function} fn - Function to wrap
   * @param {Object} options - Retry options
   * @returns {Function} Wrapped function with retry logic
   */
  createRetryWrapper(fn, options = {}) {
    return async (...args) => {
      return this.executeWithRetry(
        async (attempt, context) => {
          return fn.apply(this, [...args, { attempt, context }]);
        },
        options,
        { args }
      );
    };
  }

  /**
   * Retry a specific operation type with predefined settings
   * @param {string} operationType - Type of operation
   * @param {Function} fn - Function to execute
   * @param {Object} context - Execution context
   * @returns {Promise} Result of function execution
   */
  async retryOperation(operationType, fn, context = {}) {
    const operationConfigs = {
      s3Upload: {
        maxRetries: 3,
        baseDelay: 2000,
        maxDelay: 60000,
        backoffMultiplier: 2,
        jitterFactor: 0.15,
      },
      s3Download: {
        maxRetries: 4,
        baseDelay: 1000,
        maxDelay: 30000,
        backoffMultiplier: 2,
        jitterFactor: 0.1,
      },
      databaseOperation: {
        maxRetries: 3,
        baseDelay: 1000,
        maxDelay: 15000,
        backoffMultiplier: 2,
        jitterFactor: 0.1,
      },
      llmRequest: {
        maxRetries: 3,
        baseDelay: 5000,
        maxDelay: 300000,
        backoffMultiplier: 2.5,
        jitterFactor: 0.2,
      },
      imageProcessing: {
        maxRetries: 2,
        baseDelay: 3000,
        maxDelay: 60000,
        backoffMultiplier: 2,
        jitterFactor: 0.1,
      },
      validation: {
        maxRetries: 1,
        baseDelay: 1000,
        maxDelay: 5000,
        backoffMultiplier: 1,
        jitterFactor: 0,
      },
      parsing: {
        maxRetries: 2,
        baseDelay: 2000,
        maxDelay: 30000,
        backoffMultiplier: 2,
        jitterFactor: 0.1,
      },
    };

    const config = operationConfigs[operationType] || {};
    
    return this.executeWithRetry(fn, config, { 
      ...context, 
      operationType 
    });
  }

  /**
   * Get retry statistics for monitoring
   * @returns {Object} Retry statistics
   */
  getRetryStats() {
    // This would be enhanced with actual tracking in a production system
    return {
      totalRetries: 0,
      successfulRetries: 0,
      failedRetries: 0,
      averageAttempts: 0,
      commonFailureReasons: [],
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Create a circuit breaker pattern for repeated failures
   * @param {Object} options - Circuit breaker options
   * @returns {Object} Circuit breaker instance
   */
  createCircuitBreaker(options = {}) {
    const config = {
      failureThreshold: 5,
      resetTimeout: 60000, // 1 minute
      monitoringPeriod: 300000, // 5 minutes
      ...options,
    };

    let state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    let failures = 0;
    let lastFailureTime = null;
    let successCount = 0;

    return {
      async execute(fn) {
        const now = Date.now();

        // Check if we should reset from OPEN to HALF_OPEN
        if (state === 'OPEN' && lastFailureTime && 
            (now - lastFailureTime) > config.resetTimeout) {
          state = 'HALF_OPEN';
          successCount = 0;
          console.log('🔄 Circuit breaker transitioning to HALF_OPEN');
        }

        // Reject immediately if circuit is OPEN
        if (state === 'OPEN') {
          throw ErrorClassification.createError(
            'SYSTEM',
            'Circuit breaker is OPEN - too many recent failures',
            { state, failures, lastFailureTime }
          );
        }

        try {
          const result = await fn();

          // Success - handle state transitions
          if (state === 'HALF_OPEN') {
            successCount++;
            if (successCount >= 3) {
              state = 'CLOSED';
              failures = 0;
              console.log('✅ Circuit breaker reset to CLOSED');
            }
          } else if (state === 'CLOSED') {
            failures = Math.max(0, failures - 1); // Gradually reduce failure count
          }

          return result;

        } catch (error) {
          failures++;
          lastFailureTime = now;

          if (failures >= config.failureThreshold) {
            state = 'OPEN';
            console.error(`🚫 Circuit breaker OPEN after ${failures} failures`);
          }

          throw error;
        }
      },

      getState() {
        return {
          state,
          failures,
          lastFailureTime,
          successCount,
          config,
        };
      },

      reset() {
        state = 'CLOSED';
        failures = 0;
        lastFailureTime = null;
        successCount = 0;
        console.log('🔄 Circuit breaker manually reset');
      },
    };
  }
}

module.exports = RetryManager;