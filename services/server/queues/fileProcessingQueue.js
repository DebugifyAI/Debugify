const { Queue, Worker } = require('bullmq');
const aws = require('aws-sdk');

// Redis connection configuration for Docker environment
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

// Create a queue for processing bug report files
const fileProcessingQueue = new Queue('fileProcessing', {
  connection: redisConfig,
});

// Worker to process file processing jobs by artifact IDs
const Artifact = require('../models/Artifact');

// Initialize S3 client once per worker
const s3 = new aws.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1',
});

// Helper to read a limited amount of data from S3 as Buffer
const readS3Object = async ({ bucket, key, maxBytes = 2 * 1024 * 1024 }) => {
  // For very large objects you can use Range header to cap bytes
  // Example: Range: bytes=0-(maxBytes-1)
  const range = `bytes=0-${Math.max(0, maxBytes - 1)}`;
  try {
    const res = await s3
      .getObject({ Bucket: bucket, Key: key, Range: range })
      .promise();
    const body = Buffer.isBuffer(res.Body) ? res.Body : Buffer.from(res.Body || '');
    return { body, contentType: res.ContentType || null, contentLength: res.ContentLength || body.length, etag: res.ETag || null };
  } catch (err) {
    // If Range not supported, fallback to full get (careful for large files)
    if (err && err.code === 'InvalidRange') {
      const res = await s3.getObject({ Bucket: bucket, Key: key }).promise();
      const body = Buffer.isBuffer(res.Body) ? res.Body : Buffer.from(res.Body || '');
      return { body, contentType: res.ContentType || null, contentLength: res.ContentLength || body.length, etag: res.ETag || null };
    }
    throw err;
  }
};
const fileProcessingWorker = new Worker('fileProcessing', async job => {
  const { bugReportId, artifactIds } = job.data;
  
  console.log(`Starting file processing for bug report ${bugReportId} with ${artifactIds.length} artifacts`);
  
  const results = [];
  
  try {
    let index = 0;
    // eslint-disable-next-line no-restricted-syntax
    for (const artifactId of artifactIds) {
      const artifact = await Artifact.findById(artifactId);
      if (!artifact) {
        console.warn(`Artifact ${artifactId} not found, skipping`);
        index += 1;
        await job.updateProgress(Math.round((index / artifactIds.length) * 100));
        continue;
      }

      // mark processing
      await Artifact.update(artifactId, { status: 'processing' });

      console.log(`Processing artifact ${artifactId} s3://${artifact.s3_bucket}/${artifact.s3_key}`);

      // Fetch a capped slice of the object to prepare LLM input or parsers
      let s3Data = null;
      try {
        s3Data = await readS3Object({ bucket: artifact.s3_bucket, key: artifact.s3_key });
      } catch (readErr) {
        console.error(`Failed to read artifact ${artifactId} from S3:`, readErr);
        await Artifact.update(artifactId, { status: 'failed' });
        index += 1;
        await job.updateProgress(Math.round((index / artifactIds.length) * 100));
        continue;
      }

      // Placeholder: perform analysis / LLM prep here using s3Data.body
      // e.g., text extraction for text/* mimetypes, image OCR, etc.
      // Keep time-bounded; avoid blocking the event loop for large files.

      await Artifact.update(artifactId, { status: 'processed', processed_at: new Date().toISOString() });

      results.push({
        artifactId,
        s3Bucket: artifact.s3_bucket,
        s3Key: artifact.s3_key,
        contentType: artifact.content_type || s3Data?.contentType || null,
        sizeBytes: artifact.size_bytes || s3Data?.contentLength || null,
        processedAt: new Date().toISOString(),
        status: 'processed',
      });

      index += 1;
      await job.updateProgress(Math.round((index / artifactIds.length) * 100));
    }
    
    console.log(`Completed processing ${results.length} artifacts for bug report ${bugReportId}`);
    
    return { 
      bugReportId,
      processedArtifacts: results,
      totalProcessed: results.length,
      completedAt: new Date().toISOString()
    };
  } catch (error) {
    console.error(`Error processing artifacts for bug report ${bugReportId}:`, error);
    throw error;
  }
}, { 
  connection: redisConfig,
  concurrency: 5, // Process up to 5 jobs concurrently
  removeOnComplete: 10, // Keep last 10 completed jobs
  removeOnFail: 50, // Keep last 50 failed jobs
});

// Function to add a job to the queue by artifact IDs
const enqueueFileProcessingJob = async (bugReportId, artifactIds) => {
  try {
    const job = await fileProcessingQueue.add('processFiles', {
      bugReportId,
      artifactIds,
    }, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
      removeOnComplete: 10,
      removeOnFail: 50,
      delay: 0, // Process immediately
      priority: 0, // Normal priority
    });
    console.log(`Enqueued file processing job ${job.id} for bug report ${bugReportId}`);
    return job.id;
  } catch (error) {
    console.error(`Failed to enqueue file processing job for bug report ${bugReportId}:`, error);
    throw error;
  }
};

// Function to get job status
const getJobStatus = async (jobId) => {
  try {
    const job = await fileProcessingQueue.getJob(jobId);
    if (!job) {
      return null;
    }
    return {
      id: job.id,
      progress: job.progress,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
      failedReason: job.failedReason,
      returnvalue: job.returnvalue,
      data: job.data
    };
  } catch (error) {
    console.error(`Failed to get job status for ${jobId}:`, error);
    throw error;
  }
};

// Add event listeners for monitoring
fileProcessingWorker.on('completed', (job) => {
  console.log(`Job ${job.id} completed successfully`);
});

fileProcessingWorker.on('failed', (job, err) => {
  console.error(`Job ${job?.id} failed:`, err);
});

fileProcessingWorker.on('progress', (job, progress) => {
  console.log(`Job ${job.id} progress: ${progress}%`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down worker gracefully...');
  await fileProcessingWorker.close();
  process.exit(0);
});

module.exports = {
  fileProcessingQueue,
  fileProcessingWorker,
  enqueueFileProcessingJob,
  getJobStatus,
  redisConfig
};
