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

// Create queues for specialized processing
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
  },
});

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
      priority: options.priority || 0,
      delay: options.delay || 0,
    });

    console.log(`🖼️  Enqueued image processing job ${job.id} for artifact ${artifactId}`);
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
        provider: options.provider || 'openai',
        model: options.model,
        analysisType: options.analysisType,
        maxTokens: options.maxTokens,
        temperature: options.temperature || 0.1,
        ...options,
      },
    }, {
      priority: options.priority || 0,
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
 * Enqueue complete processing pipeline (image + LLM)
 * @param {number} artifactId - Artifact ID to process
 * @param {Object} options - Processing options
 * @returns {Object} Job IDs for both stages
 */
const enqueueCompleteProcessing = async (artifactId, options = {}) => {
  try {
    const imageJobId = await enqueueImageProcessingJob(artifactId, options.image);
    
    // Schedule LLM analysis to run after image processing with delay
    const llmJobId = await enqueueLLMAnalysisJob(artifactId, {
      ...options.llm,
      delay: 30000, // 30 second delay to allow image processing to complete
    });

    console.log(`📋 Enqueued complete processing pipeline for artifact ${artifactId}: image=${imageJobId}, llm=${llmJobId}`);
    
    return {
      imageJobId,
      llmJobId,
      artifactId,
    };

  } catch (error) {
    console.error(`Failed to enqueue complete processing for artifact ${artifactId}:`, error);
    throw error;
  }
};

/**
 * Get job status from any queue
 * @param {string} jobId - Job ID
 * @param {string} queueType - Queue type ('image' or 'llm')
 * @returns {Object} Job status
 */
const getJobStatus = async (jobId, queueType = 'image') => {
  try {
    const queue = queueType === 'llm' ? llmAnalysisQueue : imageProcessingQueue;
    const job = await queue.getJob(jobId);
    
    if (!job) {
      return null;
    }

    return {
      id: job.id,
      name: job.name,
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
 * Get queue statistics
 * @param {string} queueType - Queue type ('image' or 'llm')
 * @returns {Object} Queue statistics
 */
const getQueueStats = async (queueType = 'image') => {
  try {
    const queue = queueType === 'llm' ? llmAnalysisQueue : imageProcessingQueue;
    
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaiting(),
      queue.getActive(),
      queue.getCompleted(),
      queue.getFailed(),
      queue.getDelayed(),
    ]);

    return {
      queueType,
      counts: {
        waiting: waiting.length,
        active: active.length,
        completed: completed.length,
        failed: failed.length,
        delayed: delayed.length,
      },
      jobs: {
        waiting: waiting.slice(0, 10).map(job => ({ id: job.id, data: job.data })),
        active: active.slice(0, 10).map(job => ({ id: job.id, progress: job.progress, data: job.data })),
        failed: failed.slice(0, 10).map(job => ({ id: job.id, failedReason: job.failedReason, data: job.data })),
      },
    };

  } catch (error) {
    console.error(`Failed to get queue stats for ${queueType}:`, error);
    throw error;
  }
};

/**
 * Clean up old jobs from queues
 * @param {Object} options - Cleanup options
 */
const cleanupQueues = async (options = {}) => {
  try {
    const {
      maxAge = 24 * 60 * 60 * 1000, // 24 hours
      maxCount = 100,
    } = options;

    const queues = [imageProcessingQueue, llmAnalysisQueue];
    
    for (const queue of queues) {
      await queue.clean(maxAge, maxCount, 'completed');
      await queue.clean(maxAge, maxCount, 'failed');
      console.log(`🧹 Cleaned up old jobs from ${queue.name} queue`);
    }

  } catch (error) {
    console.error('Failed to cleanup queues:', error);
    throw error;
  }
};

/**
 * Pause/resume queue processing
 * @param {string} queueType - Queue type ('image' or 'llm')
 * @param {boolean} pause - True to pause, false to resume
 */
const toggleQueueProcessing = async (queueType, pause = true) => {
  try {
    const queue = queueType === 'llm' ? llmAnalysisQueue : imageProcessingQueue;
    
    if (pause) {
      await queue.pause();
      console.log(`⏸️  Paused ${queueType} queue processing`);
    } else {
      await queue.resume();
      console.log(`▶️  Resumed ${queueType} queue processing`);
    }

  } catch (error) {
    console.error(`Failed to ${pause ? 'pause' : 'resume'} ${queueType} queue:`, error);
    throw error;
  }
};

// Event listeners for monitoring
imageProcessingQueue.on('error', (error) => {
  console.error('🖼️  Image processing queue error:', error);
});

llmAnalysisQueue.on('error', (error) => {
  console.error('🤖 LLM analysis queue error:', error);
});

// Graceful shutdown
const closeQueues = async () => {
  console.log('📋 Closing processing queues...');
  await Promise.all([
    imageProcessingQueue.close(),
    llmAnalysisQueue.close(),
  ]);
  console.log('📋 Processing queues closed successfully');
};

process.on('SIGTERM', closeQueues);
process.on('SIGINT', closeQueues);

module.exports = {
  imageProcessingQueue,
  llmAnalysisQueue,
  enqueueImageProcessingJob,
  enqueueLLMAnalysisJob,
  enqueueCompleteProcessing,
  getJobStatus,
  getQueueStats,
  cleanupQueues,
  toggleQueueProcessing,
  closeQueues,
  redisConfig,
};