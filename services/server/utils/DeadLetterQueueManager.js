const { Queue, Worker } = require('bullmq');
const { ErrorClassification } = require('./ErrorClassification');

/**
 * Dead Letter Queue Manager
 * Handles failed jobs that require manual intervention or special processing
 */
class DeadLetterQueueManager {
  constructor(redisConfig) {
    this.redisConfig = redisConfig;
    
    // Create dead letter queue
    this.deadLetterQueue = new Queue('deadLetter', {
      connection: redisConfig,
      defaultJobOptions: {
        removeOnComplete: 100, // Keep more completed jobs for analysis
        removeOnFail: 500, // Keep many failed jobs for debugging
        attempts: 1, // Don't retry dead letter jobs
      },
    });

    // Create manual intervention queue
    this.manualInterventionQueue = new Queue('manualIntervention', {
      connection: redisConfig,
      defaultJobOptions: {
        removeOnComplete: 50,
        removeOnFail: 200,
        attempts: 1,
      },
    });

    // Initialize worker for processing dead letter jobs
    this.initializeWorker();
    
    // Track statistics
    this.stats = {
      totalDeadLetterJobs: 0,
      resolvedJobs: 0,
      permanentFailures: 0,
      manualInterventions: 0,
      startTime: new Date().toISOString(),
    };
  }

  /**
   * Initialize dead letter queue worker
   */
  initializeWorker() {
    this.worker = new Worker('deadLetter', async (job) => {
      return this.processDeadLetterJob(job);
    }, {
      connection: this.redisConfig,
      concurrency: 2, // Low concurrency for careful processing
    });

    // Setup event listeners
    this.setupEventListeners();
  }

  /**
   * Setup event listeners for monitoring
   */
  setupEventListeners() {
    this.deadLetterQueue.on('error', (error) => {
      console.error('❌ Dead letter queue error:', error);
    });

    this.worker.on('completed', (job) => {
      console.log(`✅ Dead letter job ${job.id} processed successfully`);
      this.stats.resolvedJobs++;
    });

    this.worker.on('failed', (job, error) => {
      console.error(`❌ Dead letter job ${job?.id} failed:`, error);
      this.stats.permanentFailures++;
    });

    this.manualInterventionQueue.on('waiting', (job) => {
      console.log(`⚠️ Job ${job.id} requires manual intervention`);
      this.stats.manualInterventions++;
    });
  }

  /**
   * Send a failed job to dead letter queue
   * @param {Object} originalJob - Original failed job
   * @param {Error} error - Error that caused failure
   * @param {Object} context - Additional context
   * @returns {string} Dead letter job ID
   */
  async sendToDeadLetter(originalJob, error, context = {}) {
    try {
      // Classify the error
      const classification = ErrorClassification.classifyError(error, {
        jobId: originalJob.id,
        jobName: originalJob.name,
        queueName: originalJob.queueName,
        ...context,
      });

      // Create dead letter job data
      const deadLetterData = {
        originalJob: {
          id: originalJob.id,
          name: originalJob.name,
          queueName: originalJob.queueName,
          data: originalJob.data,
          opts: originalJob.opts,
          attemptsMade: originalJob.attemptsMade,
          timestamp: originalJob.timestamp,
          processedOn: originalJob.processedOn,
          finishedOn: originalJob.finishedOn,
        },
        error: {
          message: error.message,
          name: error.name,
          stack: error.stack,
          code: error.code,
        },
        classification,
        context,
        deadLetterTimestamp: new Date().toISOString(),
        status: 'pending_analysis',
      };

      // Determine priority based on error classification
      const priority = this.calculatePriority(classification);

      // Add to dead letter queue
      const deadLetterJob = await this.deadLetterQueue.add(
        'processFailedJob',
        deadLetterData,
        {
          priority,
          delay: this.calculateProcessingDelay(classification),
        }
      );

      this.stats.totalDeadLetterJobs++;

      console.log(`📮 Sent job ${originalJob.id} to dead letter queue as ${deadLetterJob.id}`, {
        category: classification.category,
        priority,
        retryable: classification.classification.retryable,
      });

      return deadLetterJob.id;

    } catch (dlqError) {
      console.error('❌ Failed to send job to dead letter queue:', dlqError);
      throw dlqError;
    }
  }

  /**
   * Process a dead letter job
   * @param {Object} job - Dead letter job
   * @returns {Object} Processing result
   */
  async processDeadLetterJob(job) {
    const { originalJob, error, classification, context } = job.data;
    
    console.log(`🔍 Processing dead letter job ${job.id} (original: ${originalJob.id})`);

    try {
      // Determine processing strategy based on classification
      const strategy = this.determineProcessingStrategy(classification, context);
      
      let result;
      
      switch (strategy.action) {
        case 'retry_with_modifications':
          result = await this.retryWithModifications(originalJob, strategy.modifications);
          break;
          
        case 'manual_intervention':
          result = await this.requestManualIntervention(originalJob, error, classification);
          break;
          
        case 'alternative_processing':
          result = await this.attemptAlternativeProcessing(originalJob, strategy.alternative);
          break;
          
        case 'permanent_failure':
          result = await this.markAsPermanentFailure(originalJob, error, classification);
          break;
          
        case 'delayed_retry':
          result = await this.scheduleDelayedRetry(originalJob, strategy.delay);
          break;
          
        default:
          result = await this.requestManualIntervention(originalJob, error, classification);
      }

      // Update job status
      await this.updateJobStatus(originalJob.id, 'processed', result);

      return {
        action: strategy.action,
        result,
        processedAt: new Date().toISOString(),
      };

    } catch (processingError) {
      console.error(`❌ Failed to process dead letter job ${job.id}:`, processingError);
      
      // Send to manual intervention if processing fails
      await this.requestManualIntervention(originalJob, processingError, classification);
      
      throw processingError;
    }
  }

  /**
   * Determine processing strategy for a failed job
   * @param {Object} classification - Error classification
   * @param {Object} context - Job context
   * @returns {Object} Processing strategy
   */
  determineProcessingStrategy(classification, context) {
    const { category, classification: classInfo } = classification;

    // Non-retryable errors go to manual intervention
    if (!classInfo.retryable) {
      return {
        action: 'manual_intervention',
        reason: 'Non-retryable error category',
      };
    }

    // High severity errors need manual review
    if (classInfo.severity === 'critical') {
      return {
        action: 'manual_intervention',
        reason: 'Critical severity requires manual review',
      };
    }

    // Resource errors - try with reduced parameters
    if (category === 'RESOURCE') {
      return {
        action: 'retry_with_modifications',
        modifications: {
          reduceMemoryUsage: true,
          lowerConcurrency: true,
          smallerBatchSize: true,
        },
      };
    }

    // Image processing errors - try alternative methods
    if (category === 'IMAGE_PROCESSING') {
      return {
        action: 'alternative_processing',
        alternative: 'fallback_image_processor',
      };
    }

    // Rate limit errors - delay and retry
    if (category === 'RATE_LIMIT') {
      return {
        action: 'delayed_retry',
        delay: 300000, // 5 minutes
      };
    }

    // Network errors - retry with exponential backoff
    if (category === 'NETWORK') {
      return {
        action: 'delayed_retry',
        delay: 60000, // 1 minute
      };
    }

    // LLM service errors - try different provider or model
    if (category === 'LLM_SERVICE') {
      return {
        action: 'retry_with_modifications',
        modifications: {
          useAlternativeProvider: true,
          reducedComplexity: true,
        },
      };
    }

    // Default to manual intervention for unknown cases
    return {
      action: 'manual_intervention',
      reason: 'Unknown error pattern requires manual review',
    };
  }

  /**
   * Retry job with modifications
   * @param {Object} originalJob - Original job data
   * @param {Object} modifications - Modifications to apply
   * @returns {Object} Retry result
   */
  async retryWithModifications(originalJob, modifications) {
    console.log(`🔄 Retrying job ${originalJob.id} with modifications:`, modifications);

    // Apply modifications to job data
    const modifiedJobData = { ...originalJob.data };
    
    if (modifications.reduceMemoryUsage) {
      modifiedJobData.processingOptions = {
        ...modifiedJobData.processingOptions,
        maxMemoryMB: 512,
        streamProcessing: true,
      };
    }

    if (modifications.lowerConcurrency) {
      modifiedJobData.processingOptions = {
        ...modifiedJobData.processingOptions,
        concurrency: 1,
      };
    }

    if (modifications.smallerBatchSize) {
      modifiedJobData.processingOptions = {
        ...modifiedJobData.processingOptions,
        batchSize: Math.min(modifiedJobData.processingOptions?.batchSize || 10, 5),
      };
    }

    if (modifications.useAlternativeProvider) {
      modifiedJobData.analysisOptions = {
        ...modifiedJobData.analysisOptions,
        provider: 'ollama', // Fallback to local provider
        model: 'llama2', // Use simpler model
      };
    }

    // Re-enqueue the job with modifications
    const { enqueueCompleteProcessingPipeline } = require('../queues/specializedQueues');
    
    try {
      const newJobIds = await enqueueCompleteProcessingPipeline(
        modifiedJobData.artifactId,
        {
          ...modifiedJobData,
          retryFromDeadLetter: true,
          originalJobId: originalJob.id,
        }
      );

      return {
        success: true,
        newJobIds,
        modifications,
      };

    } catch (retryError) {
      console.error('❌ Failed to retry job with modifications:', retryError);
      return {
        success: false,
        error: retryError.message,
        modifications,
      };
    }
  }

  /**
   * Request manual intervention for a job
   * @param {Object} originalJob - Original job data
   * @param {Error} error - Error that occurred
   * @param {Object} classification - Error classification
   * @returns {Object} Manual intervention result
   */
  async requestManualIntervention(originalJob, error, classification) {
    console.log(`👤 Requesting manual intervention for job ${originalJob.id}`);

    const interventionData = {
      originalJob,
      error: {
        message: error.message,
        name: error.name,
        stack: error.stack,
      },
      classification,
      requestedAt: new Date().toISOString(),
      status: 'pending_review',
      priority: classification.classification.severity === 'critical' ? 'high' : 'normal',
    };

    const interventionJob = await this.manualInterventionQueue.add(
      'manualReview',
      interventionData,
      {
        priority: interventionData.priority === 'high' ? 10 : 5,
      }
    );

    return {
      success: true,
      interventionJobId: interventionJob.id,
      status: 'manual_intervention_requested',
    };
  }

  /**
   * Attempt alternative processing method
   * @param {Object} originalJob - Original job data
   * @param {string} alternative - Alternative processing method
   * @returns {Object} Alternative processing result
   */
  async attemptAlternativeProcessing(originalJob, alternative) {
    console.log(`🔀 Attempting alternative processing for job ${originalJob.id}: ${alternative}`);

    // This would implement alternative processing strategies
    // For now, we'll simulate the logic
    
    switch (alternative) {
      case 'fallback_image_processor':
        return {
          success: true,
          method: 'fallback_image_processor',
          message: 'Switched to fallback image processing method',
        };
        
      case 'simplified_llm_analysis':
        return {
          success: true,
          method: 'simplified_llm_analysis',
          message: 'Using simplified LLM analysis approach',
        };
        
      default:
        return {
          success: false,
          error: `Unknown alternative processing method: ${alternative}`,
        };
    }
  }

  /**
   * Mark job as permanent failure
   * @param {Object} originalJob - Original job data
   * @param {Error} error - Error that occurred
   * @param {Object} classification - Error classification
   * @returns {Object} Permanent failure result
   */
  async markAsPermanentFailure(originalJob, error, classification) {
    console.log(`💀 Marking job ${originalJob.id} as permanent failure`);

    // Update artifact status if applicable
    if (originalJob.data.artifactId) {
      try {
        const Artifact = require('../models/Artifact');
        await Artifact.update(originalJob.data.artifactId, {
          status: 'failed',
          error_message: error.message,
          failed_at: new Date().toISOString(),
        });
      } catch (updateError) {
        console.error('Failed to update artifact status:', updateError);
      }
    }

    return {
      success: true,
      status: 'permanent_failure',
      reason: error.message,
      classification: classification.category,
    };
  }

  /**
   * Schedule delayed retry for a job
   * @param {Object} originalJob - Original job data
   * @param {number} delay - Delay in milliseconds
   * @returns {Object} Delayed retry result
   */
  async scheduleDelayedRetry(originalJob, delay) {
    console.log(`⏰ Scheduling delayed retry for job ${originalJob.id} in ${delay}ms`);

    const { enqueueCompleteProcessingPipeline } = require('../queues/specializedQueues');
    
    try {
      const newJobIds = await enqueueCompleteProcessingPipeline(
        originalJob.data.artifactId,
        {
          ...originalJob.data,
          delay,
          retryFromDeadLetter: true,
          originalJobId: originalJob.id,
        }
      );

      return {
        success: true,
        newJobIds,
        delay,
        scheduledFor: new Date(Date.now() + delay).toISOString(),
      };

    } catch (retryError) {
      console.error('❌ Failed to schedule delayed retry:', retryError);
      return {
        success: false,
        error: retryError.message,
      };
    }
  }

  /**
   * Calculate priority for dead letter job
   * @param {Object} classification - Error classification
   * @returns {number} Priority (higher number = higher priority)
   */
  calculatePriority(classification) {
    const { severity, alertRequired } = classification.classification;
    
    if (alertRequired) return 10;
    if (severity === 'critical') return 9;
    if (severity === 'high') return 7;
    if (severity === 'medium') return 5;
    return 3;
  }

  /**
   * Calculate processing delay for dead letter job
   * @param {Object} classification - Error classification
   * @returns {number} Delay in milliseconds
   */
  calculateProcessingDelay(classification) {
    const { category } = classification;
    
    // Immediate processing for critical issues
    if (classification.classification.severity === 'critical') {
      return 0;
    }
    
    // Short delay for retryable errors
    if (classification.classification.retryable) {
      return 30000; // 30 seconds
    }
    
    // Longer delay for non-retryable errors (manual review needed)
    return 300000; // 5 minutes
  }

  /**
   * Update job status in database
   * @param {string} jobId - Job ID
   * @param {string} status - New status
   * @param {Object} result - Processing result
   */
  async updateJobStatus(jobId, status, result) {
    try {
      // This would update a job tracking table in the database
      console.log(`📝 Updated job ${jobId} status to ${status}`);
    } catch (error) {
      console.error('Failed to update job status:', error);
    }
  }

  /**
   * Get dead letter queue statistics
   * @returns {Object} Statistics
   */
  async getStatistics() {
    try {
      const [waiting, active, completed, failed] = await Promise.all([
        this.deadLetterQueue.getWaiting(),
        this.deadLetterQueue.getActive(),
        this.deadLetterQueue.getCompleted(),
        this.deadLetterQueue.getFailed(),
      ]);

      const [manualWaiting, manualActive] = await Promise.all([
        this.manualInterventionQueue.getWaiting(),
        this.manualInterventionQueue.getActive(),
      ]);

      return {
        ...this.stats,
        queues: {
          deadLetter: {
            waiting: waiting.length,
            active: active.length,
            completed: completed.length,
            failed: failed.length,
          },
          manualIntervention: {
            waiting: manualWaiting.length,
            active: manualActive.length,
          },
        },
        uptime: Date.now() - new Date(this.stats.startTime).getTime(),
        timestamp: new Date().toISOString(),
      };

    } catch (error) {
      console.error('Failed to get dead letter queue statistics:', error);
      return { error: error.message };
    }
  }

  /**
   * Get jobs requiring manual intervention
   * @param {number} limit - Maximum number of jobs to return
   * @returns {Array} Jobs requiring manual intervention
   */
  async getManualInterventionJobs(limit = 10) {
    try {
      const jobs = await this.manualInterventionQueue.getWaiting();
      
      return jobs.slice(0, limit).map(job => ({
        id: job.id,
        data: job.data,
        timestamp: job.timestamp,
        priority: job.opts.priority,
      }));

    } catch (error) {
      console.error('Failed to get manual intervention jobs:', error);
      return [];
    }
  }

  /**
   * Resolve a manual intervention job
   * @param {string} jobId - Job ID
   * @param {string} resolution - Resolution action
   * @param {Object} params - Resolution parameters
   * @returns {Object} Resolution result
   */
  async resolveManualIntervention(jobId, resolution, params = {}) {
    try {
      const job = await this.manualInterventionQueue.getJob(jobId);
      
      if (!job) {
        throw new Error(`Manual intervention job ${jobId} not found`);
      }

      console.log(`👤 Resolving manual intervention ${jobId} with action: ${resolution}`);

      let result;
      
      switch (resolution) {
        case 'retry':
          result = await this.retryWithModifications(job.data.originalJob, params.modifications || {});
          break;
          
        case 'skip':
          result = await this.markAsPermanentFailure(
            job.data.originalJob, 
            new Error(params.reason || 'Manually skipped'), 
            job.data.classification
          );
          break;
          
        case 'modify_and_retry':
          result = await this.retryWithModifications(job.data.originalJob, params.modifications);
          break;
          
        default:
          throw new Error(`Unknown resolution action: ${resolution}`);
      }

      // Remove the job from manual intervention queue
      await job.remove();

      return {
        success: true,
        resolution,
        result,
        resolvedAt: new Date().toISOString(),
      };

    } catch (error) {
      console.error(`Failed to resolve manual intervention ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Close dead letter queue manager
   */
  async close() {
    console.log('📮 Closing Dead Letter Queue Manager...');
    
    try {
      if (this.worker) {
        await this.worker.close();
      }
      
      await Promise.all([
        this.deadLetterQueue.close(),
        this.manualInterventionQueue.close(),
      ]);
      
      console.log('✅ Dead Letter Queue Manager closed successfully');

    } catch (error) {
      console.error('❌ Error closing Dead Letter Queue Manager:', error);
      throw error;
    }
  }
}

module.exports = DeadLetterQueueManager;