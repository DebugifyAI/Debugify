const ValidationWorker = require('./ValidationWorker');
const ParsingWorker = require('./ParsingWorker');
const ImageWorker = require('./ImageWorker');
const LLMWorker = require('./LLMWorker');
const CleanupWorker = require('./CleanupWorker');
const ErrorRecoveryManager = require('../utils/ErrorRecoveryManager');

/**
 * Centralized worker management system
 * Coordinates all specialized workers with proper lifecycle management
 */
class WorkerManager {
  constructor(redisConfig) {
    this.redisConfig = redisConfig;
    this.workers = {};
    this.isRunning = false;
    
    // Initialize error recovery manager
    this.errorRecoveryManager = new ErrorRecoveryManager(redisConfig, {
      enableRetries: true,
      enableDeadLetterQueue: true,
      enableAlerting: true,
      enableRecoveryStrategies: true,
    });
    
    // Worker configuration with concurrency limits
    this.workerConfig = {
      validation: {
        enabled: process.env.ENABLE_VALIDATION_WORKER !== 'false',
        concurrency: parseInt(process.env.VALIDATION_WORKER_CONCURRENCY, 10) || 10,
      },
      parsing: {
        enabled: process.env.ENABLE_PARSING_WORKER !== 'false',
        concurrency: parseInt(process.env.PARSING_WORKER_CONCURRENCY, 10) || 5,
      },
      imageProcessing: {
        enabled: process.env.ENABLE_IMAGE_WORKER !== 'false',
        concurrency: parseInt(process.env.IMAGE_WORKER_CONCURRENCY, 10) || 2,
      },
      llmAnalysis: {
        enabled: process.env.ENABLE_LLM_WORKER !== 'false',
        concurrency: parseInt(process.env.LLM_WORKER_CONCURRENCY, 10) || 2,
      },
      cleanup: {
        enabled: process.env.ENABLE_CLEANUP_WORKER !== 'false',
        concurrency: parseInt(process.env.CLEANUP_WORKER_CONCURRENCY, 10) || 3,
      },
    };
  }

  /**
   * Initialize and start all enabled workers
   */
  async start() {
    if (this.isRunning) {
      console.warn('WorkerManager is already running');
      return;
    }

    console.log('🚀 Starting WorkerManager with specialized workers...');
    
    try {
      // Initialize workers based on configuration
      if (this.workerConfig.validation.enabled) {
        console.log('🔍 Initializing ValidationWorker...');
        this.workers.validation = new ValidationWorker(this.redisConfig);
      }

      if (this.workerConfig.parsing.enabled) {
        console.log('📄 Initializing ParsingWorker...');
        this.workers.parsing = new ParsingWorker(this.redisConfig);
      }

      if (this.workerConfig.imageProcessing.enabled) {
        console.log('🖼️ Initializing ImageWorker...');
        this.workers.imageProcessing = new ImageWorker(this.redisConfig);
      }

      if (this.workerConfig.llmAnalysis.enabled) {
        console.log('🤖 Initializing LLMWorker...');
        this.workers.llmAnalysis = new LLMWorker(this.redisConfig);
      }

      if (this.workerConfig.cleanup.enabled) {
        console.log('🧹 Initializing CleanupWorker...');
        this.workers.cleanup = new CleanupWorker(this.redisConfig);
      }

      // Setup global error handling
      this.setupGlobalErrorHandling();

      // Setup health monitoring
      this.setupHealthMonitoring();

      this.isRunning = true;
      
      console.log(`✅ WorkerManager started successfully with ${Object.keys(this.workers).length} workers`);
      this.logWorkerStatus();

    } catch (error) {
      console.error('❌ Failed to start WorkerManager:', error);
      await this.stop();
      throw error;
    }
  }

  /**
   * Stop all workers gracefully
   */
  async stop() {
    if (!this.isRunning) {
      console.warn('WorkerManager is not running');
      return;
    }

    console.log('🛑 Stopping WorkerManager...');
    
    try {
      // Stop all workers in parallel
      const stopPromises = Object.entries(this.workers).map(async ([workerType, worker]) => {
        try {
          console.log(`🛑 Stopping ${workerType} worker...`);
          await worker.close();
          console.log(`✅ ${workerType} worker stopped successfully`);
        } catch (error) {
          console.error(`❌ Failed to stop ${workerType} worker:`, error);
        }
      });

      await Promise.all(stopPromises);

      // Clear health monitoring
      if (this.healthMonitorInterval) {
        clearInterval(this.healthMonitorInterval);
        this.healthMonitorInterval = null;
      }

      // Close error recovery manager
      if (this.errorRecoveryManager) {
        await this.errorRecoveryManager.close();
      }

      this.workers = {};
      this.isRunning = false;
      
      console.log('✅ WorkerManager stopped successfully');

    } catch (error) {
      console.error('❌ Error during WorkerManager shutdown:', error);
      throw error;
    }
  }

  /**
   * Restart all workers
   */
  async restart() {
    console.log('🔄 Restarting WorkerManager...');
    await this.stop();
    await this.start();
  }

  /**
   * Get status of all workers
   * @returns {Object} Worker status information
   */
  getStatus() {
    const status = {
      isRunning: this.isRunning,
      workers: {},
      summary: {
        total: Object.keys(this.workers).length,
        enabled: Object.values(this.workerConfig).filter(config => config.enabled).length,
        running: Object.keys(this.workers).length,
      },
      timestamp: new Date().toISOString(),
    };

    // Get individual worker status
    Object.entries(this.workers).forEach(([workerType, worker]) => {
      status.workers[workerType] = {
        enabled: this.workerConfig[workerType]?.enabled || false,
        concurrency: this.workerConfig[workerType]?.concurrency || 1,
        capabilities: worker.getCapabilities ? worker.getCapabilities() : {},
        isActive: true,
      };
    });

    return status;
  }

  /**
   * Get capabilities of all workers
   * @returns {Object} Combined worker capabilities
   */
  getCapabilities() {
    const capabilities = {
      workerManager: {
        version: '1.0.0',
        totalWorkers: Object.keys(this.workers).length,
        supportedQueues: Object.keys(this.workers),
        errorRecovery: {
          enabled: !!this.errorRecoveryManager,
          strategies: this.errorRecoveryManager ? 
            Array.from(this.errorRecoveryManager.recoveryStrategies.keys()) : [],
        },
      },
      workers: {},
      errorHandling: this.errorRecoveryManager ? 
        this.errorRecoveryManager.getStatistics() : null,
    };

    Object.entries(this.workers).forEach(([workerType, worker]) => {
      if (worker.getCapabilities) {
        capabilities.workers[workerType] = worker.getCapabilities();
      }
    });

    return capabilities;
  }

  /**
   * Setup global error handling for all workers
   */
  setupGlobalErrorHandling() {
    // Handle uncaught exceptions
    process.on('uncaughtException', async (error) => {
      console.error('🚨 Uncaught Exception in WorkerManager:', error);
      
      // Use error recovery manager to handle critical errors
      try {
        await this.errorRecoveryManager.handleError(error, {
          source: 'uncaught_exception',
          workerManager: true,
          timestamp: new Date().toISOString(),
        });
      } catch (recoveryError) {
        console.error('❌ Error recovery failed for uncaught exception:', recoveryError);
      }
      
      // Don't exit immediately, log and continue
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', async (reason, promise) => {
      console.error('🚨 Unhandled Rejection in WorkerManager:', reason);
      console.error('Promise:', promise);
      
      // Use error recovery manager to handle promise rejections
      try {
        const error = reason instanceof Error ? reason : new Error(String(reason));
        await this.errorRecoveryManager.handleError(error, {
          source: 'unhandled_rejection',
          workerManager: true,
          promise: promise.toString(),
          timestamp: new Date().toISOString(),
        });
      } catch (recoveryError) {
        console.error('❌ Error recovery failed for unhandled rejection:', recoveryError);
      }
    });

    // Setup graceful shutdown handlers
    const gracefulShutdown = async (signal) => {
      console.log(`\n🛑 Received ${signal}, initiating graceful shutdown...`);
      
      try {
        await this.stop();
        console.log('✅ Graceful shutdown completed');
        process.exit(0);
      } catch (error) {
        console.error('❌ Error during graceful shutdown:', error);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  }

  /**
   * Setup health monitoring for workers
   */
  setupHealthMonitoring() {
    const monitorInterval = parseInt(process.env.WORKER_HEALTH_MONITOR_INTERVAL, 10) || 60000; // 1 minute
    
    if (process.env.ENABLE_WORKER_HEALTH_MONITORING !== 'false') {
      this.healthMonitorInterval = setInterval(() => {
        this.performHealthCheck();
      }, monitorInterval);
      
      console.log(`💓 Health monitoring enabled (interval: ${monitorInterval}ms)`);
    }
  }

  /**
   * Perform health check on all workers
   */
  async performHealthCheck() {
    try {
      const healthStatus = {
        timestamp: new Date().toISOString(),
        overall: 'healthy',
        workers: {},
      };

      // Check each worker
      Object.entries(this.workers).forEach(([workerType, worker]) => {
        try {
          // Basic health check - worker exists and has expected methods
          const isHealthy = worker && 
                           typeof worker.getWorker === 'function' && 
                           typeof worker.close === 'function';
          
          healthStatus.workers[workerType] = {
            status: isHealthy ? 'healthy' : 'unhealthy',
            lastCheck: new Date().toISOString(),
          };

          if (!isHealthy) {
            healthStatus.overall = 'degraded';
          }
        } catch (error) {
          healthStatus.workers[workerType] = {
            status: 'error',
            error: error.message,
            lastCheck: new Date().toISOString(),
          };
          healthStatus.overall = 'degraded';
        }
      });

      // Log health status if there are issues
      if (healthStatus.overall !== 'healthy') {
        console.warn('⚠️ Worker health check detected issues:', healthStatus);
      }

      return healthStatus;

    } catch (error) {
      console.error('❌ Health check failed:', error);
      return {
        timestamp: new Date().toISOString(),
        overall: 'error',
        error: error.message,
      };
    }
  }

  /**
   * Log current worker status
   */
  logWorkerStatus() {
    const status = this.getStatus();
    
    console.log('\n📊 Worker Status Summary:');
    console.log(`   Total Workers: ${status.summary.total}`);
    console.log(`   Running: ${status.summary.running}`);
    console.log(`   Enabled: ${status.summary.enabled}`);
    
    console.log('\n🔧 Individual Workers:');
    Object.entries(status.workers).forEach(([workerType, workerStatus]) => {
      const emoji = this.getWorkerEmoji(workerType);
      console.log(`   ${emoji} ${workerType}: concurrency=${workerStatus.concurrency}, enabled=${workerStatus.enabled}`);
    });
    
    console.log('');
  }

  /**
   * Get emoji for worker type
   * @param {string} workerType - Worker type
   * @returns {string} Emoji
   */
  getWorkerEmoji(workerType) {
    const emojis = {
      validation: '🔍',
      parsing: '📄',
      imageProcessing: '🖼️',
      llmAnalysis: '🤖',
      cleanup: '🧹',
    };
    
    return emojis[workerType] || '⚙️';
  }

  /**
   * Enable or disable a specific worker type
   * @param {string} workerType - Worker type to control
   * @param {boolean} enabled - Enable or disable
   */
  async setWorkerEnabled(workerType, enabled) {
    if (!this.workerConfig[workerType]) {
      throw new Error(`Unknown worker type: ${workerType}`);
    }

    const wasEnabled = this.workerConfig[workerType].enabled;
    this.workerConfig[workerType].enabled = enabled;

    if (this.isRunning) {
      if (enabled && !wasEnabled) {
        // Start the worker
        console.log(`🔄 Starting ${workerType} worker...`);
        await this.startWorker(workerType);
      } else if (!enabled && wasEnabled) {
        // Stop the worker
        console.log(`🛑 Stopping ${workerType} worker...`);
        await this.stopWorker(workerType);
      }
    }

    console.log(`${enabled ? '✅' : '❌'} ${workerType} worker ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Start a specific worker
   * @param {string} workerType - Worker type to start
   */
  async startWorker(workerType) {
    if (this.workers[workerType]) {
      console.warn(`${workerType} worker is already running`);
      return;
    }

    try {
      switch (workerType) {
        case 'validation':
          this.workers.validation = new ValidationWorker(this.redisConfig);
          break;
        case 'parsing':
          this.workers.parsing = new ParsingWorker(this.redisConfig);
          break;
        case 'imageProcessing':
          this.workers.imageProcessing = new ImageWorker(this.redisConfig);
          break;
        case 'llmAnalysis':
          this.workers.llmAnalysis = new LLMWorker(this.redisConfig);
          break;
        case 'cleanup':
          this.workers.cleanup = new CleanupWorker(this.redisConfig);
          break;
        default:
          throw new Error(`Unknown worker type: ${workerType}`);
      }

      console.log(`✅ ${workerType} worker started successfully`);

    } catch (error) {
      console.error(`❌ Failed to start ${workerType} worker:`, error);
      throw error;
    }
  }

  /**
   * Stop a specific worker
   * @param {string} workerType - Worker type to stop
   */
  async stopWorker(workerType) {
    const worker = this.workers[workerType];
    
    if (!worker) {
      console.warn(`${workerType} worker is not running`);
      return;
    }

    try {
      await worker.close();
      delete this.workers[workerType];
      console.log(`✅ ${workerType} worker stopped successfully`);

    } catch (error) {
      console.error(`❌ Failed to stop ${workerType} worker:`, error);
      throw error;
    }
  }

  /**
   * Get worker instance by type
   * @param {string} workerType - Worker type
   * @returns {Object} Worker instance
   */
  getWorker(workerType) {
    return this.workers[workerType] || null;
  }

  /**
   * Check if WorkerManager is running
   * @returns {boolean} True if running
   */
  isManagerRunning() {
    return this.isRunning;
  }

  /**
   * Get Redis configuration
   * @returns {Object} Redis configuration
   */
  getRedisConfig() {
    return { ...this.redisConfig };
  }

  /**
   * Update worker concurrency
   * @param {string} workerType - Worker type
   * @param {number} concurrency - New concurrency level
   */
  setWorkerConcurrency(workerType, concurrency) {
    if (!this.workerConfig[workerType]) {
      throw new Error(`Unknown worker type: ${workerType}`);
    }

    this.workerConfig[workerType].concurrency = concurrency;
    console.log(`🔧 Updated ${workerType} worker concurrency to ${concurrency}`);
    
    // Note: Changing concurrency requires worker restart to take effect
    if (this.workers[workerType]) {
      console.log(`ℹ️ Restart ${workerType} worker for concurrency change to take effect`);
    }
  }

  /**
   * Handle worker error through error recovery system
   * @param {Error} error - Error that occurred
   * @param {Object} context - Error context
   * @param {Function} operation - Operation to retry (optional)
   * @returns {Promise<Object>} Recovery result
   */
  async handleWorkerError(error, context = {}, operation = null) {
    if (!this.errorRecoveryManager) {
      console.error('❌ Error recovery manager not available');
      throw error;
    }

    const enhancedContext = {
      ...context,
      workerManager: true,
      timestamp: new Date().toISOString(),
    };

    try {
      const result = await this.errorRecoveryManager.handleError(
        error, 
        enhancedContext, 
        operation
      );

      console.log(`🔧 Worker error handled: ${result.success ? 'recovered' : 'failed'}`);
      return result;

    } catch (recoveryError) {
      console.error('❌ Worker error recovery failed:', recoveryError);
      throw recoveryError;
    }
  }

  /**
   * Get error recovery statistics
   * @returns {Promise<Object>} Error recovery statistics
   */
  async getErrorRecoveryStatistics() {
    if (!this.errorRecoveryManager) {
      return { error: 'Error recovery manager not available' };
    }

    try {
      const [
        recoveryStats,
        deadLetterStats,
        alertingStats,
      ] = await Promise.all([
        this.errorRecoveryManager.getStatistics(),
        this.errorRecoveryManager.getDeadLetterStatistics(),
        Promise.resolve(this.errorRecoveryManager.getAlertingStatistics()),
      ]);

      return {
        recovery: recoveryStats,
        deadLetter: deadLetterStats,
        alerting: alertingStats,
        timestamp: new Date().toISOString(),
      };

    } catch (error) {
      console.error('Failed to get error recovery statistics:', error);
      return { error: error.message };
    }
  }

  /**
   * Test error recovery system
   * @param {string} errorType - Type of error to test
   * @returns {Promise<Object>} Test result
   */
  async testErrorRecovery(errorType = 'NETWORK') {
    if (!this.errorRecoveryManager) {
      throw new Error('Error recovery manager not available');
    }

    console.log(`🧪 Testing error recovery system with ${errorType} error`);
    
    return this.errorRecoveryManager.testRecovery(errorType);
  }
}

module.exports = WorkerManager;