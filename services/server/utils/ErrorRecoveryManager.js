const RetryManager = require('./RetryManager');
const DeadLetterQueueManager = require('./DeadLetterQueueManager');
const ErrorAlertingSystem = require('./ErrorAlertingSystem');
const { ErrorClassification } = require('./ErrorClassification');

/**
 * Error Recovery Manager
 * Coordinates error handling, retry logic, dead letter queues, and alerting
 */
class ErrorRecoveryManager {
  constructor(redisConfig, options = {}) {
    this.redisConfig = redisConfig;
    this.options = {
      enableRetries: true,
      enableDeadLetterQueue: true,
      enableAlerting: true,
      enableRecoveryStrategies: true,
      ...options,
    };

    // Initialize components
    this.retryManager = new RetryManager();
    
    if (this.options.enableDeadLetterQueue) {
      this.deadLetterManager = new DeadLetterQueueManager(redisConfig);
    }
    
    if (this.options.enableAlerting) {
      this.alertingSystem = new ErrorAlertingSystem();
    }

    // Recovery statistics
    this.stats = {
      totalErrors: 0,
      recoveredErrors: 0,
      permanentFailures: 0,
      retriesAttempted: 0,
      alertsSent: 0,
      startTime: new Date().toISOString(),
    };

    // Recovery strategies registry
    this.recoveryStrategies = new Map();
    this.initializeDefaultStrategies();
  }

  /**
   * Initialize default recovery strategies
   */
  initializeDefaultStrategies() {
    // S3 operation recovery
    this.registerRecoveryStrategy('s3_operation', {
      maxRetries: 3,
      baseDelay: 2000,
      backoffMultiplier: 2,
      recoveryActions: ['retry_with_backoff', 'switch_region', 'use_alternative_endpoint'],
    });

    // Database operation recovery
    this.registerRecoveryStrategy('database_operation', {
      maxRetries: 3,
      baseDelay: 1000,
      backoffMultiplier: 2,
      recoveryActions: ['retry_with_backoff', 'use_read_replica', 'reduce_batch_size'],
    });

    // Image processing recovery
    this.registerRecoveryStrategy('image_processing', {
      maxRetries: 2,
      baseDelay: 3000,
      backoffMultiplier: 2,
      recoveryActions: ['reduce_quality', 'use_fallback_processor', 'skip_advanced_features'],
    });

    // LLM service recovery
    this.registerRecoveryStrategy('llm_service', {
      maxRetries: 3,
      baseDelay: 5000,
      backoffMultiplier: 2.5,
      recoveryActions: ['switch_provider', 'reduce_complexity', 'use_cached_result'],
    });

    // Network operation recovery
    this.registerRecoveryStrategy('network_operation', {
      maxRetries: 4,
      baseDelay: 2000,
      backoffMultiplier: 2,
      recoveryActions: ['retry_with_backoff', 'use_alternative_endpoint', 'reduce_timeout'],
    });
  }

  /**
   * Handle an error with comprehensive recovery logic
   * @param {Error} error - Error to handle
   * @param {Object} context - Error context
   * @param {Function} operation - Operation to retry
   * @returns {Promise<Object>} Recovery result
   */
  async handleError(error, context = {}, operation = null) {
    this.stats.totalErrors++;
    
    try {
      console.log(`🔧 Handling error: ${error.message}`);
      
      // Classify the error
      const classification = ErrorClassification.classifyError(error, context);
      
      // Process alert if needed
      if (this.options.enableAlerting) {
        const alertResult = await this.alertingSystem.processError(error, context);
        if (alertResult.alerted) {
          this.stats.alertsSent++;
        }
      }

      // Determine recovery strategy
      const recoveryPlan = this.createRecoveryPlan(classification, context, operation);
      
      // Execute recovery
      const recoveryResult = await this.executeRecovery(recoveryPlan, error, context);
      
      if (recoveryResult.success) {
        this.stats.recoveredErrors++;
        console.log(`✅ Error recovered successfully using strategy: ${recoveryResult.strategy}`);
      } else {
        this.stats.permanentFailures++;
        console.error(`❌ Error recovery failed: ${recoveryResult.reason}`);
      }

      return recoveryResult;

    } catch (recoveryError) {
      console.error('❌ Error in recovery manager:', recoveryError);
      
      // Fallback to dead letter queue
      if (this.options.enableDeadLetterQueue && context.job) {
        await this.deadLetterManager.sendToDeadLetter(context.job, error, context);
      }

      return {
        success: false,
        strategy: 'fallback_to_dead_letter',
        error: recoveryError.message,
      };
    }
  }

  /**
   * Create recovery plan based on error classification
   * @param {Object} classification - Error classification
   * @param {Object} context - Error context
   * @param {Function} operation - Operation to retry
   * @returns {Object} Recovery plan
   */
  createRecoveryPlan(classification, context, operation) {
    const { category, classification: classInfo } = classification;
    
    // Non-retryable errors go straight to dead letter queue
    if (!classInfo.retryable) {
      return {
        strategy: 'dead_letter_queue',
        reason: 'Error is not retryable',
        actions: ['send_to_dead_letter'],
      };
    }

    // Determine operation type for strategy selection
    const operationType = this.determineOperationType(context);
    const strategy = this.recoveryStrategies.get(operationType);

    if (!strategy) {
      return {
        strategy: 'default_retry',
        reason: 'No specific strategy found, using default retry',
        actions: ['retry_with_exponential_backoff'],
        maxRetries: classInfo.maxRetries,
        baseDelay: classInfo.baseDelay,
      };
    }

    // Create comprehensive recovery plan
    return {
      strategy: operationType,
      classification,
      maxRetries: strategy.maxRetries,
      baseDelay: strategy.baseDelay,
      backoffMultiplier: strategy.backoffMultiplier,
      actions: this.selectRecoveryActions(category, strategy.recoveryActions, context),
      operation,
      context,
    };
  }

  /**
   * Determine operation type from context
   * @param {Object} context - Error context
   * @returns {string} Operation type
   */
  determineOperationType(context) {
    if (context.s3Operation || context.bucket || context.key) {
      return 's3_operation';
    }
    
    if (context.databaseOperation || context.query || context.table) {
      return 'database_operation';
    }
    
    if (context.imageProcessing || context.imageFormat || context.ocr) {
      return 'image_processing';
    }
    
    if (context.llmProvider || context.model || context.analysis) {
      return 'llm_service';
    }
    
    if (context.networkRequest || context.url || context.api) {
      return 'network_operation';
    }

    return 'default_retry';
  }

  /**
   * Select appropriate recovery actions based on error category
   * @param {string} category - Error category
   * @param {Array} availableActions - Available recovery actions
   * @param {Object} context - Error context
   * @returns {Array} Selected actions
   */
  selectRecoveryActions(category, availableActions, context) {
    const actionPriority = {
      NETWORK: ['retry_with_backoff', 'use_alternative_endpoint', 'reduce_timeout'],
      RATE_LIMIT: ['retry_with_exponential_backoff', 'switch_provider', 'reduce_complexity'],
      RESOURCE: ['reduce_batch_size', 'reduce_quality', 'skip_advanced_features'],
      IMAGE_PROCESSING: ['reduce_quality', 'use_fallback_processor', 'skip_advanced_features'],
      LLM_SERVICE: ['switch_provider', 'reduce_complexity', 'use_cached_result'],
      SYSTEM: ['retry_with_backoff', 'use_alternative_endpoint', 'use_read_replica'],
    };

    const prioritizedActions = actionPriority[category] || ['retry_with_backoff'];
    
    // Return actions that are both prioritized and available
    return prioritizedActions.filter(action => availableActions.includes(action));
  }

  /**
   * Execute recovery plan
   * @param {Object} recoveryPlan - Recovery plan
   * @param {Error} originalError - Original error
   * @param {Object} context - Error context
   * @returns {Promise<Object>} Recovery result
   */
  async executeRecovery(recoveryPlan, originalError, context) {
    const { strategy, actions, operation } = recoveryPlan;
    
    console.log(`🔧 Executing recovery strategy: ${strategy}`, { actions });

    // Handle dead letter queue strategy
    if (strategy === 'dead_letter_queue') {
      if (this.options.enableDeadLetterQueue && context.job) {
        await this.deadLetterManager.sendToDeadLetter(context.job, originalError, context);
        return {
          success: true,
          strategy: 'dead_letter_queue',
          message: 'Sent to dead letter queue for manual intervention',
        };
      } else {
        return {
          success: false,
          strategy: 'dead_letter_queue',
          reason: 'Dead letter queue not available',
        };
      }
    }

    // Execute recovery actions in sequence
    for (const action of actions) {
      try {
        const actionResult = await this.executeRecoveryAction(
          action, 
          recoveryPlan, 
          originalError, 
          context,
        );

        if (actionResult.success) {
          return {
            success: true,
            strategy,
            action,
            result: actionResult.result,
          };
        }

        console.log(`⚠️ Recovery action ${action} failed, trying next action`);

      } catch (actionError) {
        console.error(`❌ Recovery action ${action} threw error:`, actionError);
        continue;
      }
    }

    // All recovery actions failed
    return {
      success: false,
      strategy,
      reason: 'All recovery actions failed',
      actions,
    };
  }

  /**
   * Execute a specific recovery action
   * @param {string} action - Recovery action to execute
   * @param {Object} recoveryPlan - Recovery plan
   * @param {Error} originalError - Original error
   * @param {Object} context - Error context
   * @returns {Promise<Object>} Action result
   */
  async executeRecoveryAction(action, recoveryPlan, originalError, context) {
    const { operation, maxRetries, baseDelay, backoffMultiplier } = recoveryPlan;

    switch (action) {
      case 'retry_with_backoff':
      case 'retry_with_exponential_backoff':
        return this.executeRetryWithBackoff(operation, {
          maxRetries,
          baseDelay,
          backoffMultiplier,
        }, context);

      case 'switch_provider':
        return this.executeSwitchProvider(operation, context);

      case 'reduce_complexity':
        return this.executeReduceComplexity(operation, context);

      case 'reduce_quality':
        return this.executeReduceQuality(operation, context);

      case 'use_fallback_processor':
        return this.executeUseFallbackProcessor(operation, context);

      case 'reduce_batch_size':
        return this.executeReduceBatchSize(operation, context);

      case 'use_alternative_endpoint':
        return this.executeUseAlternativeEndpoint(operation, context);

      case 'use_read_replica':
        return this.executeUseReadReplica(operation, context);

      case 'skip_advanced_features':
        return this.executeSkipAdvancedFeatures(operation, context);

      case 'use_cached_result':
        return this.executeUseCachedResult(operation, context);

      case 'reduce_timeout':
        return this.executeReduceTimeout(operation, context);

      default:
        throw new Error(`Unknown recovery action: ${action}`);
    }
  }

  /**
   * Execute retry with backoff
   */
  async executeRetryWithBackoff(operation, retryOptions, context) {
    if (!operation) {
      return { success: false, reason: 'No operation provided for retry' };
    }

    try {
      this.stats.retriesAttempted++;
      
      const result = await this.retryManager.executeWithRetry(
        operation,
        retryOptions,
        context,
      );

      return { success: true, result };

    } catch (retryError) {
      return { success: false, error: retryError.message };
    }
  }

  /**
   * Execute switch provider action
   */
  async executeSwitchProvider(operation, context) {
    // Modify context to use alternative provider
    const modifiedContext = {
      ...context,
      provider: context.provider === 'openai' ? 'ollama' : 'openai',
      useAlternativeProvider: true,
    };

    if (operation) {
      try {
        const result = await operation(0, modifiedContext);
        return { success: true, result, modification: 'switched_provider' };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }

    return { success: false, reason: 'No operation provided' };
  }

  /**
   * Execute reduce complexity action
   */
  async executeReduceComplexity(operation, context) {
    const modifiedContext = {
      ...context,
      complexity: 'low',
      maxTokens: Math.min(context.maxTokens || 1000, 500),
      temperature: 0.1,
      useSimplePrompt: true,
    };

    if (operation) {
      try {
        const result = await operation(0, modifiedContext);
        return { success: true, result, modification: 'reduced_complexity' };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }

    return { success: false, reason: 'No operation provided' };
  }

  /**
   * Execute reduce quality action
   */
  async executeReduceQuality(operation, context) {
    const modifiedContext = {
      ...context,
      quality: 'low',
      maxDimensions: { width: 800, height: 600 },
      compression: 0.7,
      skipAdvancedProcessing: true,
    };

    if (operation) {
      try {
        const result = await operation(0, modifiedContext);
        return { success: true, result, modification: 'reduced_quality' };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }

    return { success: false, reason: 'No operation provided' };
  }

  /**
   * Execute use fallback processor action
   */
  async executeUseFallbackProcessor(operation, context) {
    const modifiedContext = {
      ...context,
      processor: 'fallback',
      useFallbackMethod: true,
      skipAdvancedFeatures: true,
    };

    if (operation) {
      try {
        const result = await operation(0, modifiedContext);
        return { success: true, result, modification: 'used_fallback_processor' };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }

    return { success: false, reason: 'No operation provided' };
  }

  /**
   * Execute reduce batch size action
   */
  async executeReduceBatchSize(operation, context) {
    const modifiedContext = {
      ...context,
      batchSize: Math.min(context.batchSize || 10, 3),
      processIndividually: true,
    };

    if (operation) {
      try {
        const result = await operation(0, modifiedContext);
        return { success: true, result, modification: 'reduced_batch_size' };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }

    return { success: false, reason: 'No operation provided' };
  }

  /**
   * Execute use alternative endpoint action
   */
  async executeUseAlternativeEndpoint(operation, context) {
    const modifiedContext = {
      ...context,
      useAlternativeEndpoint: true,
      endpoint: context.alternativeEndpoint || context.endpoint,
    };

    if (operation) {
      try {
        const result = await operation(0, modifiedContext);
        return { success: true, result, modification: 'used_alternative_endpoint' };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }

    return { success: false, reason: 'No operation provided' };
  }

  /**
   * Execute use read replica action
   */
  async executeUseReadReplica(operation, context) {
    const modifiedContext = {
      ...context,
      useReadReplica: true,
      readOnly: true,
    };

    if (operation) {
      try {
        const result = await operation(0, modifiedContext);
        return { success: true, result, modification: 'used_read_replica' };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }

    return { success: false, reason: 'No operation provided' };
  }

  /**
   * Execute skip advanced features action
   */
  async executeSkipAdvancedFeatures(operation, context) {
    const modifiedContext = {
      ...context,
      skipAdvancedFeatures: true,
      basicProcessingOnly: true,
      disableOptimizations: true,
    };

    if (operation) {
      try {
        const result = await operation(0, modifiedContext);
        return { success: true, result, modification: 'skipped_advanced_features' };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }

    return { success: false, reason: 'No operation provided' };
  }

  /**
   * Execute use cached result action
   */
  async executeUseCachedResult(operation, context) {
    // This would check for cached results and return them if available
    console.log('🔍 Checking for cached result...');
    
    // Placeholder implementation
    return { success: false, reason: 'No cached result available' };
  }

  /**
   * Execute reduce timeout action
   */
  async executeReduceTimeout(operation, context) {
    const modifiedContext = {
      ...context,
      timeout: Math.min(context.timeout || 30000, 10000), // Reduce to 10 seconds max
      reduceTimeout: true,
    };

    if (operation) {
      try {
        const result = await operation(0, modifiedContext);
        return { success: true, result, modification: 'reduced_timeout' };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }

    return { success: false, reason: 'No operation provided' };
  }

  /**
   * Register a custom recovery strategy
   * @param {string} operationType - Operation type
   * @param {Object} strategy - Recovery strategy configuration
   */
  registerRecoveryStrategy(operationType, strategy) {
    this.recoveryStrategies.set(operationType, strategy);
    console.log(`📝 Registered recovery strategy for ${operationType}`);
  }

  /**
   * Get recovery statistics
   * @returns {Object} Recovery statistics
   */
  getStatistics() {
    const uptime = Date.now() - new Date(this.stats.startTime).getTime();
    
    return {
      ...this.stats,
      uptime,
      recoveryRate: this.stats.totalErrors > 0 ? 
        (this.stats.recoveredErrors / this.stats.totalErrors) : 0,
      components: {
        retryManager: !!this.retryManager,
        deadLetterManager: !!this.deadLetterManager,
        alertingSystem: !!this.alertingSystem,
      },
      strategies: Array.from(this.recoveryStrategies.keys()),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get dead letter queue statistics
   * @returns {Promise<Object>} Dead letter queue statistics
   */
  async getDeadLetterStatistics() {
    if (!this.deadLetterManager) {
      return { error: 'Dead letter queue not enabled' };
    }

    return this.deadLetterManager.getStatistics();
  }

  /**
   * Get alerting statistics
   * @returns {Object} Alerting statistics
   */
  getAlertingStatistics() {
    if (!this.alertingSystem) {
      return { error: 'Alerting system not enabled' };
    }

    return this.alertingSystem.getStatistics();
  }

  /**
   * Test error recovery system
   * @param {string} errorType - Type of error to simulate
   * @returns {Promise<Object>} Test result
   */
  async testRecovery(errorType = 'NETWORK') {
    console.log(`🧪 Testing error recovery for ${errorType} error`);
    
    const testError = ErrorClassification.createError(
      errorType,
      `Test ${errorType} error for recovery testing`,
      { test: true },
    );

    const testOperation = async (attempt, context) => {
      if (attempt < 2) {
        throw testError;
      }
      return { success: true, attempt, context };
    };

    return this.handleError(testError, {
      test: true,
      operationType: 'network_operation',
    }, testOperation);
  }

  /**
   * Close error recovery manager
   */
  async close() {
    console.log('🔧 Closing Error Recovery Manager...');
    
    try {
      if (this.deadLetterManager) {
        await this.deadLetterManager.close();
      }
      
      console.log('✅ Error Recovery Manager closed successfully');

    } catch (error) {
      console.error('❌ Error closing Error Recovery Manager:', error);
      throw error;
    }
  }
}

module.exports = ErrorRecoveryManager;