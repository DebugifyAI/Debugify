const { describe, it, expect, beforeEach, afterEach, jest } = require('@jest/globals');
const { ErrorClassification, ERROR_CATEGORIES } = require('../utils/ErrorClassification');
const RetryManager = require('../utils/RetryManager');
const DeadLetterQueueManager = require('../utils/DeadLetterQueueManager');
const ErrorAlertingSystem = require('../utils/ErrorAlertingSystem');
const ErrorRecoveryManager = require('../utils/ErrorRecoveryManager');

// Mock Redis configuration
const mockRedisConfig = {
  host: 'localhost',
  port: 6379,
  maxRetriesPerRequest: null,
};

describe('Error Handling System', () => {
  describe('ErrorClassification', () => {
    it('should classify network errors correctly', () => {
      const networkError = new Error('ECONNREFUSED connection refused');
      const classification = ErrorClassification.classifyError(networkError);

      expect(classification.category).toBe('NETWORK');
      expect(classification.classification.retryable).toBe(true);
      expect(classification.classification.severity).toBe('medium');
    });

    it('should classify rate limit errors correctly', () => {
      const rateLimitError = new Error('Rate limit exceeded');
      rateLimitError.statusCode = 429;
      const classification = ErrorClassification.classifyError(rateLimitError);

      expect(classification.category).toBe('RATE_LIMIT');
      expect(classification.classification.retryable).toBe(true);
    });

    it('should classify validation errors as non-retryable', () => {
      const validationError = new Error('Validation failed: invalid input');
      const classification = ErrorClassification.classifyError(validationError);

      expect(classification.category).toBe('VALIDATION');
      expect(classification.classification.retryable).toBe(false);
    });

    it('should classify security errors as critical and non-retryable', () => {
      const securityError = new Error('Virus detected in file');
      const classification = ErrorClassification.classifyError(securityError);

      expect(classification.category).toBe('SECURITY');
      expect(classification.classification.retryable).toBe(false);
      expect(classification.classification.severity).toBe('critical');
    });

    it('should classify image processing errors correctly', () => {
      const imageError = new Error('Invalid image format: corrupt JPEG');
      const classification = ErrorClassification.classifyError(imageError);

      expect(classification.category).toBe('IMAGE_PROCESSING');
      expect(classification.classification.retryable).toBe(true);
    });

    it('should classify LLM service errors correctly', () => {
      const llmError = new Error('OpenAI API error: model not found');
      const classification = ErrorClassification.classifyError(llmError);

      expect(classification.category).toBe('LLM_SERVICE');
      expect(classification.classification.retryable).toBe(true);
    });

    it('should classify resource exhaustion errors correctly', () => {
      const resourceError = new Error('Out of memory: heap limit exceeded');
      const classification = ErrorClassification.classifyError(resourceError);

      expect(classification.category).toBe('RESOURCE');
      expect(classification.classification.retryable).toBe(true);
      expect(classification.classification.severity).toBe('high');
    });

    it('should handle unknown errors with fallback classification', () => {
      const unknownError = new Error('Some unknown error occurred');
      const classification = ErrorClassification.classifyError(unknownError);

      expect(classification.category).toBe('UNKNOWN');
      expect(classification.classification.retryable).toBe(true);
    });

    it('should create standardized errors correctly', () => {
      const error = ErrorClassification.createError(
        'NETWORK',
        'Connection timeout',
        { timeout: 5000 }
      );

      expect(error.category).toBe('NETWORK');
      expect(error.message).toBe('Connection timeout');
      expect(error.details.timeout).toBe(5000);
      expect(error.retryable).toBe(true);
    });
  });

  describe('RetryManager', () => {
    let retryManager;

    beforeEach(() => {
      retryManager = new RetryManager();
    });

    it('should successfully execute operation on first try', async () => {
      const mockOperation = jest.fn().mockResolvedValue('success');
      
      const result = await retryManager.executeWithRetry(mockOperation);
      
      expect(result).toBe('success');
      expect(mockOperation).toHaveBeenCalledTimes(1);
    });

    it('should retry failed operations with exponential backoff', async () => {
      const mockOperation = jest.fn()
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockRejectedValueOnce(new Error('Another failure'))
        .mockResolvedValue('success');

      const result = await retryManager.executeWithRetry(mockOperation, {
        maxRetries: 3,
        baseDelay: 100,
      });

      expect(result).toBe('success');
      expect(mockOperation).toHaveBeenCalledTimes(3);
    });

    it('should respect maximum retry limit', async () => {
      const mockOperation = jest.fn().mockRejectedValue(new Error('Persistent failure'));

      await expect(
        retryManager.executeWithRetry(mockOperation, { maxRetries: 2 })
      ).rejects.toThrow('RetryExhaustedError');

      expect(mockOperation).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    it('should not retry non-retryable errors', async () => {
      const validationError = new Error('Validation failed');
      const mockOperation = jest.fn().mockRejectedValue(validationError);

      await expect(
        retryManager.executeWithRetry(mockOperation, {
          retryCondition: (error) => !error.message.includes('Validation'),
        })
      ).rejects.toThrow('Validation failed');

      expect(mockOperation).toHaveBeenCalledTimes(1);
    });

    it('should calculate delay with exponential backoff and jitter', () => {
      const delay1 = retryManager.calculateDelay(1, {
        baseDelay: 1000,
        backoffMultiplier: 2,
        jitterFactor: 0,
        enableJitter: false,
      });

      const delay2 = retryManager.calculateDelay(2, {
        baseDelay: 1000,
        backoffMultiplier: 2,
        jitterFactor: 0,
        enableJitter: false,
      });

      expect(delay1).toBe(1000);
      expect(delay2).toBe(2000);
    });

    it('should respect maximum delay limit', () => {
      const delay = retryManager.calculateDelay(10, {
        baseDelay: 1000,
        maxDelay: 5000,
        backoffMultiplier: 2,
        jitterFactor: 0,
        enableJitter: false,
      });

      expect(delay).toBe(5000);
    });

    it('should create retry wrapper function', async () => {
      const originalFunction = jest.fn()
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockResolvedValue('success');

      const wrappedFunction = retryManager.createRetryWrapper(originalFunction, {
        maxRetries: 2,
      });

      const result = await wrappedFunction('arg1', 'arg2');

      expect(result).toBe('success');
      expect(originalFunction).toHaveBeenCalledTimes(2);
    });

    it('should handle circuit breaker pattern', async () => {
      const circuitBreaker = retryManager.createCircuitBreaker({
        failureThreshold: 2,
        resetTimeout: 1000,
      });

      const failingOperation = jest.fn().mockRejectedValue(new Error('Service down'));

      // First failure
      await expect(circuitBreaker.execute(failingOperation)).rejects.toThrow('Service down');
      
      // Second failure - should open circuit
      await expect(circuitBreaker.execute(failingOperation)).rejects.toThrow('Service down');
      
      // Third attempt - should be rejected by circuit breaker
      await expect(circuitBreaker.execute(failingOperation)).rejects.toThrow('Circuit breaker is OPEN');

      expect(circuitBreaker.getState().state).toBe('OPEN');
    });
  });

  describe('ErrorAlertingSystem', () => {
    let alertingSystem;

    beforeEach(() => {
      alertingSystem = new ErrorAlertingSystem({
        enableConsoleAlerts: true,
        enableEmailAlerts: false,
        enableSlackAlerts: false,
      });
    });

    afterEach(() => {
      alertingSystem.clearHistory();
    });

    it('should alert immediately for critical errors', async () => {
      const criticalError = new Error('System database connection failed');
      
      const result = await alertingSystem.processError(criticalError, {
        severity: 'critical',
      });

      expect(result.alerted).toBe(true);
      expect(result.reason).toContain('Critical error');
    });

    it('should not alert for low severity errors below threshold', async () => {
      const lowError = new Error('Minor validation issue');
      
      const result = await alertingSystem.processError(lowError, {
        severity: 'low',
      });

      expect(result.alerted).toBe(false);
    });

    it('should alert when error count exceeds threshold', async () => {
      const mediumError = new Error('Processing timeout');
      
      // Send multiple errors to exceed threshold
      for (let i = 0; i < 10; i++) {
        await alertingSystem.processError(mediumError, {
          severity: 'medium',
          jobId: `job_${i}`,
        });
      }

      // The last one should trigger an alert
      const result = await alertingSystem.processError(mediumError, {
        severity: 'medium',
        jobId: 'job_final',
      });

      expect(result.alerted).toBe(true);
      expect(result.reason).toContain('threshold exceeded');
    });

    it('should rate limit alerts for the same category', async () => {
      const error = new Error('Network timeout');
      
      // First alert should go through
      const result1 = await alertingSystem.processError(error, {
        severity: 'critical',
      });
      expect(result1.alerted).toBe(true);

      // Second alert should be rate limited
      const result2 = await alertingSystem.processError(error, {
        severity: 'critical',
      });
      expect(result2.alerted).toBe(false);
      expect(result2.reason).toContain('Rate limited');
    });

    it('should track error statistics correctly', async () => {
      const networkError = new Error('Connection refused');
      const validationError = new Error('Invalid input format');

      await alertingSystem.processError(networkError);
      await alertingSystem.processError(validationError);
      await alertingSystem.processError(networkError);

      const stats = alertingSystem.getStatistics();
      
      expect(stats.errors.NETWORK.total).toBe(2);
      expect(stats.errors.VALIDATION.total).toBe(1);
    });

    it('should test alert system functionality', async () => {
      const testResult = await alertingSystem.testAlerts('high');
      
      expect(testResult.alerted).toBe(true);
      expect(testResult.classification.category).toBe('SYSTEM');
    });
  });

  describe('ErrorRecoveryManager', () => {
    let recoveryManager;

    beforeEach(() => {
      recoveryManager = new ErrorRecoveryManager(mockRedisConfig, {
        enableDeadLetterQueue: false, // Disable for unit tests
        enableAlerting: false,
      });
    });

    afterEach(async () => {
      await recoveryManager.close();
    });

    it('should handle retryable errors with recovery strategies', async () => {
      const networkError = new Error('ECONNREFUSED');
      const mockOperation = jest.fn()
        .mockRejectedValueOnce(networkError)
        .mockResolvedValue('recovered');

      const result = await recoveryManager.handleError(
        networkError,
        { networkRequest: true },
        mockOperation
      );

      expect(result.success).toBe(true);
      expect(result.strategy).toBe('network_operation');
    });

    it('should send non-retryable errors to dead letter queue', async () => {
      const validationError = new Error('Invalid file format');
      
      const result = await recoveryManager.handleError(
        validationError,
        { job: { id: 'test-job' } }
      );

      expect(result.strategy).toBe('dead_letter_queue');
    });

    it('should register and use custom recovery strategies', () => {
      recoveryManager.registerRecoveryStrategy('custom_operation', {
        maxRetries: 5,
        baseDelay: 2000,
        recoveryActions: ['custom_action'],
      });

      const strategies = recoveryManager.recoveryStrategies;
      expect(strategies.has('custom_operation')).toBe(true);
      expect(strategies.get('custom_operation').maxRetries).toBe(5);
    });

    it('should determine operation type from context', () => {
      const s3Context = { s3Operation: true, bucket: 'test-bucket' };
      const dbContext = { databaseOperation: true, table: 'users' };
      const imageContext = { imageProcessing: true, format: 'jpeg' };

      expect(recoveryManager.determineOperationType(s3Context)).toBe('s3_operation');
      expect(recoveryManager.determineOperationType(dbContext)).toBe('database_operation');
      expect(recoveryManager.determineOperationType(imageContext)).toBe('image_processing');
    });

    it('should execute switch provider recovery action', async () => {
      const mockOperation = jest.fn().mockResolvedValue('success with new provider');
      
      const result = await recoveryManager.executeSwitchProvider(mockOperation, {
        provider: 'openai',
      });

      expect(result.success).toBe(true);
      expect(result.modification).toBe('switched_provider');
      expect(mockOperation).toHaveBeenCalledWith(0, expect.objectContaining({
        provider: 'ollama',
        useAlternativeProvider: true,
      }));
    });

    it('should execute reduce complexity recovery action', async () => {
      const mockOperation = jest.fn().mockResolvedValue('success with reduced complexity');
      
      const result = await recoveryManager.executeReduceComplexity(mockOperation, {
        maxTokens: 2000,
      });

      expect(result.success).toBe(true);
      expect(result.modification).toBe('reduced_complexity');
      expect(mockOperation).toHaveBeenCalledWith(0, expect.objectContaining({
        complexity: 'low',
        maxTokens: 500,
        useSimplePrompt: true,
      }));
    });

    it('should track recovery statistics', async () => {
      const error = new Error('Test error');
      await recoveryManager.handleError(error, {}, null);

      const stats = recoveryManager.getStatistics();
      
      expect(stats.totalErrors).toBe(1);
      expect(stats.components.retryManager).toBe(true);
    });

    it('should test recovery system functionality', async () => {
      const testResult = await recoveryManager.testRecovery('NETWORK');
      
      expect(testResult.success).toBe(true);
    });
  });

  describe('Integration Tests', () => {
    let recoveryManager;

    beforeEach(() => {
      recoveryManager = new ErrorRecoveryManager(mockRedisConfig, {
        enableDeadLetterQueue: false,
        enableAlerting: true,
      });
    });

    afterEach(async () => {
      await recoveryManager.close();
    });

    it('should handle complete error recovery workflow', async () => {
      const imageProcessingError = new Error('Image too large for processing');
      let attemptCount = 0;

      const mockImageOperation = jest.fn().mockImplementation((attempt, context) => {
        attemptCount++;
        
        if (context.quality === 'low' && context.maxDimensions) {
          return Promise.resolve({
            success: true,
            processedImage: 'reduced_quality_image.jpg',
            modifications: context,
          });
        }
        
        throw imageProcessingError;
      });

      const result = await recoveryManager.handleError(
        imageProcessingError,
        { imageProcessing: true, format: 'jpeg' },
        mockImageOperation
      );

      expect(result.success).toBe(true);
      expect(result.strategy).toBe('image_processing');
      expect(result.action).toBe('reduce_quality');
    });

    it('should handle cascading failures with multiple recovery attempts', async () => {
      const networkError = new Error('Connection timeout');
      let attemptCount = 0;

      const mockNetworkOperation = jest.fn().mockImplementation((attempt, context) => {
        attemptCount++;
        
        // Fail first few attempts, succeed on retry with backoff
        if (attemptCount >= 3) {
          return Promise.resolve({ success: true, attempt: attemptCount });
        }
        
        throw networkError;
      });

      const result = await recoveryManager.handleError(
        networkError,
        { networkRequest: true, url: 'https://api.example.com' },
        mockNetworkOperation
      );

      expect(result.success).toBe(true);
      expect(attemptCount).toBeGreaterThanOrEqual(3);
    });

    it('should handle resource exhaustion with progressive degradation', async () => {
      const memoryError = new Error('Out of memory: heap limit exceeded');
      
      const mockResourceOperation = jest.fn().mockImplementation((attempt, context) => {
        if (context.batchSize <= 3) {
          return Promise.resolve({
            success: true,
            processedItems: context.batchSize,
          });
        }
        
        throw memoryError;
      });

      const result = await recoveryManager.handleError(
        memoryError,
        { batchSize: 100, processingType: 'batch' },
        mockResourceOperation
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe('reduce_batch_size');
    });
  });

  describe('Error Handling Edge Cases', () => {
    it('should handle null or undefined errors gracefully', () => {
      const classification1 = ErrorClassification.classifyError(null);
      const classification2 = ErrorClassification.classifyError(undefined);

      expect(classification1.category).toBe('UNKNOWN');
      expect(classification2.category).toBe('UNKNOWN');
    });

    it('should handle errors without message or stack trace', () => {
      const emptyError = new Error();
      emptyError.message = '';
      emptyError.stack = '';

      const classification = ErrorClassification.classifyError(emptyError);
      
      expect(classification.category).toBe('UNKNOWN');
      expect(classification.errorInfo.message).toBe('');
    });

    it('should handle circular reference errors', () => {
      const circularError = new Error('Circular reference error');
      circularError.circular = circularError;

      const classification = ErrorClassification.classifyError(circularError);
      
      expect(classification.category).toBeDefined();
      expect(classification.errorInfo.message).toBe('Circular reference error');
    });

    it('should handle very long error messages', () => {
      const longMessage = 'A'.repeat(10000);
      const longError = new Error(longMessage);

      const classification = ErrorClassification.classifyError(longError);
      
      expect(classification.category).toBeDefined();
      expect(classification.errorInfo.message).toBe(longMessage);
    });

    it('should handle errors with special characters', () => {
      const specialError = new Error('Error with 特殊字符 and émojis 🚨');
      
      const classification = ErrorClassification.classifyError(specialError);
      
      expect(classification.category).toBeDefined();
      expect(classification.errorInfo.message).toContain('特殊字符');
    });
  });
});

describe('Performance Tests', () => {
  it('should classify errors quickly', () => {
    const start = Date.now();
    
    for (let i = 0; i < 1000; i++) {
      const error = new Error(`Test error ${i}`);
      ErrorClassification.classifyError(error);
    }
    
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(1000); // Should complete in under 1 second
  });

  it('should handle high volume of retry operations', async () => {
    const retryManager = new RetryManager();
    const operations = [];

    for (let i = 0; i < 100; i++) {
      operations.push(
        retryManager.executeWithRetry(
          async () => `result_${i}`,
          { maxRetries: 1 }
        )
      );
    }

    const results = await Promise.all(operations);
    expect(results).toHaveLength(100);
    expect(results[0]).toBe('result_0');
    expect(results[99]).toBe('result_99');
  });
});