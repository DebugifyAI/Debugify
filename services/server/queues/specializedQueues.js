const { Queue } = require('bullmq');

// Redis connection configuration
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT, 10) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
  retryDelayOnFailover: 100,
  enableReadyCheck: false,
  lazyConnect: true,
  connectTimeout: 60000,
  enableAutoPipelining: true,
  keepAlive: 1,
  noDelay: true,
};

// Create specialized queues with different priorities and configurations
const validationQueue = new Queue('validation', {
  connection: redisConfig,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    removeOnComplete: 25,
    removeOnFail: 100,
    priority: 10, // High priority for validation
  },
});

const parsingQueue = new Queue('parsing', {
  connection: redisConfig,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: 25,
    removeOnFail: 100,
    priority: 8, // Medium-high priority for parsing
  },
});

const imageProcessingQueue = new Queue('imageProcessing', {
  connection: redisConfig,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: 25,
    removeOnFail: 100,
    priority: 6, // Medium priority for image processing
  },
});

const llmAnalysisQueue = new Queue('llmAnalysis', {
  connection: redisConfig,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: 50,
    removeOnFail: 100,
    priority: 4, // Lower priority for LLM analysis (expensive)
  },
});

const cleanupQueue = new Queue('cleanup', {
  connection: redisConfig,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 10000,
    },
    removeOnComplete: 10,
    removeOnFail: 50,
    priority: 1, // Lowest priority for cleanup tasks
  },
});

/**
 * Enqueue validation job
 * @param {number} artifactId - Artifact ID to validate
 * @param {Object} options - Validation options
 * @returns {string} Job ID
 */
const enqueueValidationJob = async (artifactId, options = {}) => {
  try {
    const job = await validationQueue.add('validateArtifact', {
      artifactId,
      validationOptions: {
        performVirusScan: options.performVirusScan !== false,
        checkFileType: options.checkFileType !== false,
        validateSize: options.validateSize !== false,
        scanForMalware: options.scanForMalware !== false,
        ...options,
      },
    }, {
      priority: options.priority || 10,
      delay: options.delay || 0,
    });

    console.log(`🔍 Enqueued validation job ${job.id} for artifact ${artifactId}`);
    return job.id;

  } catch (error) {
    console.error(`Failed to enqueue validation job for artifact ${artifactId}:`, error);
    throw error;
  }
};

/**
 * Enqueue parsing job
 * @param {number} artifactId - Artifact ID to parse
 * @param {Object} options - Parsing options
 * @returns {string} Job ID
 */
const enqueueParsingJob = async (artifactId, options = {}) => {
  try {
    const job = await parsingQueue.add('parseContent', {
      artifactId,
      parsingOptions: {
        extractStructure: options.extractStructure !== false,
        logFormat: options.logFormat || 'auto',
        delimiter: options.delimiter,
        hasHeaders: options.hasHeaders,
        ...options,
      },
    }, {
      priority: options.priority || 8,
      delay: options.delay || 0,
    });

    console.log(`📄 Enqueued parsing job ${job.id} for artifact ${artifactId}`);
    return job.id;

  } catch (error) {
    console.error(`Failed to enqueue parsing job for artifact ${artifactId}:`, error);
    throw error;
  }
};

/**
 * Enqueue image processing job
 * @param {number} artifactId - Artifact ID to process
 * @param {Object} options - Processing options
 * @returns {string} Job ID
 */
const enqueueImageProcessingJob = async (artifactId, options = {}) => {
  try {
    const job = await imageProcessingQueue.add('processImage', {
      artifactId,
      processingOptions: {
        formats: options.formats || ['webp', 'jpeg'],
        languages: options.languages || ['eng'],
        generateVariants: options.generateVariants !== false,
        performOCR: options.performOCR !== false,
        detectSensitiveData: options.detectSensitiveData !== false,
        ...options,
      },
    }, {
      priority: options.priority || 6,
      delay: options.delay || 0,
    });

    console.log(`🖼️ Enqueued image processing job ${job.id} for artifact ${artifactId}`);
    return job.id;

  } catch (error) {
    console.error(`Failed to enqueue image processing job for artifact ${artifactId}:`, error);
    throw error;
  }
};

/**
 * Enqueue LLM analysis job
 * @param {number} artifactId - Artifact ID to analyze
 * @param {Object} options - Analysis options
 * @returns {string} Job ID
 */
const enqueueLLMAnalysisJob = async (artifactId, options = {}) => {
  try {
    const job = await llmAnalysisQueue.add('analyzeLLM', {
      artifactId,
      analysisOptions: {
        provider: options.provider || 'ollama', // Default to local Ollama
        model: options.model,
        analysisType: options.analysisType,
        maxTokens: options.maxTokens,
        temperature: options.temperature || 0.1,
        ...options,
      },
    }, {
      priority: options.priority || 4,
      delay: options.delay || 0,
    });

    console.log(`🤖 Enqueued LLM analysis job ${job.id} for artifact ${artifactId}`);
    return job.id;

  } catch (error) {
    console.error(`Failed to enqueue LLM analysis job for artifact ${artifactId}:`, error);
    throw error;
  }
};

/**
 * Enqueue cleanup job
 * @param {string} cleanupType - Type of cleanup to perform
 * @param {Object} options - Cleanup options
 * @returns {string} Job ID
 */
const enqueueCleanupJob = async (cleanupType, options = {}) => {
  try {
    const job = await cleanupQueue.add('cleanup', {
      cleanupType,
      options: {
        batchSize: options.batchSize || 100,
        maxAge: options.maxAge,
        dryRun: options.dryRun || false,
        ...options,
      },
    }, {
      priority: options.priority || 1,
      delay: options.delay || 0,
    });

    console.log(`🧹 Enqueued cleanup job ${job.id} for type ${cleanupType}`);
    return job.id;

  } catch (error) {
    console.error(`Failed to enqueue cleanup job for type ${cleanupType}:`, error);
    throw error;
  }
};

/**
 * Enqueue complete processing pipeline for an artifact
 * @param {number} artifactId - Artifact ID to process
 * @param {Object} options - Processing options
 * @returns {Object} Job IDs for all stages
 */
const enqueueCompleteProcessingPipeline = async (artifactId, options = {}) => {
  try {
    const jobIds = {};
    
    // Stage 1: Validation (immediate)
    jobIds.validation = await enqueueValidationJob(artifactId, options.validation);
    
    // Stage 2: Parsing (after validation, small delay)
    jobIds.parsing = await enqueueParsingJob(artifactId, {
      ...options.parsing,
      delay: 5000, // 5 second delay
    });
    
    // Stage 3: Image processing (if applicable, parallel with parsing)
    if (options.processImages !== false) {
      jobIds.imageProcessing = await enqueueImageProcessingJob(artifactId, {
        ...options.image,
        delay: 5000, // 5 second delay
      });
    }
    
    // Stage 4: LLM analysis (after parsing/image processing)
    if (options.performLLMAnalysis !== false) {
      jobIds.llmAnalysis = await enqueueLLMAnalysisJob(artifactId, {
        ...options.llm,
        delay: 30000, // 30 second delay to allow previous stages
      });
    }

    console.log(`📋 Enqueued complete processing pipeline for artifact ${artifactId}:`, jobIds);
    
    return {
      artifactId,
      ...jobIds,
    };

  } catch (error) {
    console.error(`Failed to enqueue complete processing for artifact ${artifactId}:`, error);
    throw error;
  }
};

/**
 * Get job status from any queue
 * @param {string} jobId - Job ID
 * @param {string} queueType - Queue type
 * @returns {Object} Job status
 */
const getJobStatus = async (jobId, queueType) => {
  try {
    let queue;
    
    switch (queueType) {
      case 'validation':
        queue = validationQueue;
        break;
      case 'parsing':
        queue = parsingQueue;
        break;
      case 'imageProcessing':
        queue = imageProcessingQueue;
        break;
      case 'llmAnalysis':
        queue = llmAnalysisQueue;
        break;
      case 'cleanup':
        queue = cleanupQueue;
        break;
      default:
        throw new Error(`Unknown queue type: ${queueType}`);
    }
    
    const job = await queue.getJob(jobId);
    
    if (!job) {
      return null;
    }

    return {
      id: job.id,
      name: job.name,
      queueType,
      progress: job.progress,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
      failedReason: job.failedReason,
      returnvalue: job.returnvalue,
      data: job.data,
      opts: job.opts,
      attemptsMade: job.attemptsMade,
      timestamp: job.timestamp,
    };

  } catch (error) {
    console.error(`Failed to get job status for ${jobId}:`, error);
    throw error;
  }
};

/**
 * Get queue statistics for all queues
 * @returns {Object} Statistics for all queues
 */
const getAllQueueStats = async () => {
  try {
    const queues = {
      validation: validationQueue,
      parsing: parsingQueue,
      imageProcessing: imageProcessingQueue,
      llmAnalysis: llmAnalysisQueue,
      cleanup: cleanupQueue,
    };
    
    const stats = {};
    
    for (const [queueName, queue] of Object.entries(queues)) {
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        queue.getWaiting(),
        queue.getActive(),
        queue.getCompleted(),
        queue.getFailed(),
        queue.getDelayed(),
      ]);

      stats[queueName] = {
        counts: {
          waiting: waiting.length,
          active: active.length,
          completed: completed.length,
          failed: failed.length,
          delayed: delayed.length,
        },
        recentJobs: {
          waiting: waiting.slice(0, 5).map(job => ({ 
            id: job.id, 
            data: job.data,
            timestamp: job.timestamp,
          })),
          active: active.slice(0, 5).map(job => ({ 
            id: job.id, 
            progress: job.progress, 
            data: job.data,
            processedOn: job.processedOn,
          })),
          failed: failed.slice(0, 5).map(job => ({ 
            id: job.id, 
            failedReason: job.failedReason, 
            data: job.data,
            finishedOn: job.finishedOn,
          })),
        },
      };
    }

    return {
      timestamp: new Date().toISOString(),
      queues: stats,
      summary: {
        totalWaiting: Object.values(stats).reduce((sum, q) => sum + q.counts.waiting, 0),
        totalActive: Object.values(stats).reduce((sum, q) => sum + q.counts.active, 0),
        totalCompleted: Object.values(stats).reduce((sum, q) => sum + q.counts.completed, 0),
        totalFailed: Object.values(stats).reduce((sum, q) => sum + q.counts.failed, 0),
      },
    };

  } catch (error) {
    console.error('Failed to get queue statistics:', error);
    throw error;
  }
};

/**
 * Clean up old jobs from all queues
 * @param {Object} options - Cleanup options
 */
const cleanupAllQueues = async (options = {}) => {
  try {
    const {
      maxAge = 24 * 60 * 60 * 1000, // 24 hours
      maxCount = 100,
    } = options;

    const queues = [
      validationQueue,
      parsingQueue,
      imageProcessingQueue,
      llmAnalysisQueue,
      cleanupQueue,
    ];
    
    const results = {};
    
    for (const queue of queues) {
      try {
        const completedCleaned = await queue.clean(maxAge, maxCount, 'completed');
        const failedCleaned = await queue.clean(maxAge, maxCount, 'failed');
        
        results[queue.name] = {
          completedCleaned,
          failedCleaned,
        };
        
        console.log(`🧹 Cleaned up ${completedCleaned + failedCleaned} old jobs from ${queue.name} queue`);
      } catch (error) {
        console.error(`Failed to cleanup ${queue.name} queue:`, error);
        results[queue.name] = { error: error.message };
      }
    }
    
    return results;

  } catch (error) {
    console.error('Failed to cleanup queues:', error);
    throw error;
  }
};

/**
 * Pause/resume queue processing
 * @param {string} queueType - Queue type to control
 * @param {boolean} pause - True to pause, false to resume
 */
const toggleQueueProcessing = async (queueType, pause = true) => {
  try {
    let queue;
    
    switch (queueType) {
      case 'validation':
        queue = validationQueue;
        break;
      case 'parsing':
        queue = parsingQueue;
        break;
      case 'imageProcessing':
        queue = imageProcessingQueue;
        break;
      case 'llmAnalysis':
        queue = llmAnalysisQueue;
        break;
      case 'cleanup':
        queue = cleanupQueue;
        break;
      case 'all':
        // Pause/resume all queues
        const queues = [validationQueue, parsingQueue, imageProcessingQueue, llmAnalysisQueue, cleanupQueue];
        for (const q of queues) {
          if (pause) {
            await q.pause();
          } else {
            await q.resume();
          }
        }
        console.log(`${pause ? '⏸️ Paused' : '▶️ Resumed'} all queue processing`);
        return;
      default:
        throw new Error(`Unknown queue type: ${queueType}`);
    }
    
    if (pause) {
      await queue.pause();
      console.log(`⏸️ Paused ${queueType} queue processing`);
    } else {
      await queue.resume();
      console.log(`▶️ Resumed ${queueType} queue processing`);
    }

  } catch (error) {
    console.error(`Failed to ${pause ? 'pause' : 'resume'} ${queueType} queue:`, error);
    throw error;
  }
};

// Event listeners for monitoring
const setupQueueEventListeners = () => {
  const queues = {
    validation: validationQueue,
    parsing: parsingQueue,
    imageProcessing: imageProcessingQueue,
    llmAnalysis: llmAnalysisQueue,
    cleanup: cleanupQueue,
  };

  Object.entries(queues).forEach(([queueName, queue]) => {
    queue.on('error', (error) => {
      console.error(`❌ ${queueName} queue error:`, error);
    });

    queue.on('waiting', (job) => {
      console.log(`⏳ ${queueName} job ${job.id} is waiting`);
    });

    queue.on('active', (job) => {
      console.log(`🔄 ${queueName} job ${job.id} started processing`);
    });

    queue.on('completed', (job) => {
      console.log(`✅ ${queueName} job ${job.id} completed`);
    });

    queue.on('failed', (job, err) => {
      console.error(`❌ ${queueName} job ${job?.id} failed:`, err.message);
    });

    queue.on('progress', (job, progress) => {
      console.log(`📊 ${queueName} job ${job.id} progress: ${progress}%`);
    });
  });
};

// Graceful shutdown
const closeAllQueues = async () => {
  console.log('📋 Closing all processing queues...');
  
  const queues = [
    validationQueue,
    parsingQueue,
    imageProcessingQueue,
    llmAnalysisQueue,
    cleanupQueue,
  ];
  
  await Promise.all(queues.map(queue => queue.close()));
  console.log('📋 All processing queues closed successfully');
};

// Setup event listeners
setupQueueEventListeners();

// Graceful shutdown handlers
process.on('SIGTERM', closeAllQueues);
process.on('SIGINT', closeAllQueues);

module.exports = {
  // Queues
  validationQueue,
  parsingQueue,
  imageProcessingQueue,
  llmAnalysisQueue,
  cleanupQueue,
  
  // Job enqueueing functions
  enqueueValidationJob,
  enqueueParsingJob,
  enqueueImageProcessingJob,
  enqueueLLMAnalysisJob,
  enqueueCleanupJob,
  enqueueCompleteProcessingPipeline,
  
  // Utility functions
  getJobStatus,
  getAllQueueStats,
  cleanupAllQueues,
  toggleQueueProcessing,
  closeAllQueues,
  
  // Configuration
  redisConfig,
};