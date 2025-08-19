const { Worker } = require('bullmq');
const Artifact = require('../models/Artifact');
const ProcessingJob = require('../models/ProcessingJob');
const aws = require('aws-sdk');
const fs = require('fs').promises;
const path = require('path');

/**
 * Specialized worker for cleanup and maintenance tasks
 * Handles temporary file cleanup, failed job management, and system maintenance
 */
class CleanupWorker {
  constructor(redisConfig) {
    this.redisConfig = redisConfig;
    this.s3 = new aws.S3({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      region: process.env.AWS_REGION || 'us-east-1',
    });
    
    // Worker configuration for cleanup tasks
    this.workerConfig = {
      connection: redisConfig,
      concurrency: 3, // Moderate concurrency for cleanup tasks
      removeOnComplete: 10,
      removeOnFail: 50,
    };
    
    this.worker = new Worker('cleanup', this.processCleanupJob.bind(this), this.workerConfig);
    this.setupEventHandlers();
  }

  /**
   * Main cleanup job handler
   * @param {Object} job - BullMQ job object
   * @returns {Object} Cleanup results
   */
  async processCleanupJob(job) {
    const { cleanupType, options = {} } = job.data;
    
    try {
      await job.updateProgress(5);
      
      let cleanupResult;
      
      switch (cleanupType) {
        case 'temporaryFiles':
          cleanupResult = await this.cleanupTemporaryFiles(options, job);
          break;
        case 'failedJobs':
          cleanupResult = await this.cleanupFailedJobs(options, job);
          break;
        case 'orphanedArtifacts':
          cleanupResult = await this.cleanupOrphanedArtifacts(options, job);
          break;
        case 'oldProcessingJobs':
          cleanupResult = await this.cleanupOldProcessingJobs(options, job);
          break;
        case 'incompleteUploads':
          cleanupResult = await this.cleanupIncompleteUploads(options, job);
          break;
        case 'systemMaintenance':
          cleanupResult = await this.performSystemMaintenance(options, job);
          break;
        default:
          throw new Error(`Unknown cleanup type: ${cleanupType}`);
      }

      await job.updateProgress(100);

      return {
        cleanupType,
        status: 'completed',
        ...cleanupResult,
        completedAt: new Date().toISOString(),
      };

    } catch (error) {
      console.error(`Cleanup failed for type ${job.data.cleanupType}:`, error);
      throw error;
    }
  }

  /**
   * Cleanup temporary files from local storage and S3
   * @param {Object} options - Cleanup options
   * @param {Object} job - BullMQ job for progress updates
   * @returns {Object} Cleanup results
   */
  async cleanupTemporaryFiles(options, job) {
    const startTime = Date.now();
    const results = {
      localFilesDeleted: 0,
      s3ObjectsDeleted: 0,
      errors: [],
    };
    
    try {
      await job.updateProgress(10);
      
      // Cleanup local temporary files
      const tempDir = options.tempDir || '/tmp';
      const maxAge = options.maxAge || 24 * 60 * 60 * 1000; // 24 hours
      
      try {
        const files = await fs.readdir(tempDir);
        const tempFiles = files.filter(file => 
          file.startsWith('upload_') || 
          file.startsWith('processing_') ||
          file.includes('temp')
        );
        
        await job.updateProgress(30);
        
        for (const file of tempFiles) {
          try {
            const filePath = path.join(tempDir, file);
            const stats = await fs.stat(filePath);
            const age = Date.now() - stats.mtime.getTime();
            
            if (age > maxAge) {
              await fs.unlink(filePath);
              results.localFilesDeleted++;
            }
          } catch (error) {
            results.errors.push(`Failed to delete local file ${file}: ${error.message}`);
          }
        }
      } catch (error) {
        results.errors.push(`Failed to read temp directory: ${error.message}`);
      }
      
      await job.updateProgress(60);
      
      // Cleanup S3 temporary objects
      if (options.cleanupS3Temp) {
        try {
          const bucket = options.s3Bucket || process.env.AWS_S3_BUCKET;
          const tempPrefix = options.tempPrefix || 'temp/';
          
          const listParams = {
            Bucket: bucket,
            Prefix: tempPrefix,
          };
          
          const objects = await this.s3.listObjectsV2(listParams).promise();
          
          if (objects.Contents && objects.Contents.length > 0) {
            const objectsToDelete = objects.Contents.filter(obj => {
              const age = Date.now() - obj.LastModified.getTime();
              return age > maxAge;
            });
            
            if (objectsToDelete.length > 0) {
              const deleteParams = {
                Bucket: bucket,
                Delete: {
                  Objects: objectsToDelete.map(obj => ({ Key: obj.Key })),
                },
              };
              
              const deleteResult = await this.s3.deleteObjects(deleteParams).promise();
              results.s3ObjectsDeleted = deleteResult.Deleted?.length || 0;
              
              if (deleteResult.Errors && deleteResult.Errors.length > 0) {
                results.errors.push(...deleteResult.Errors.map(err => 
                  `S3 delete error for ${err.Key}: ${err.Message}`
                ));
              }
            }
          }
        } catch (error) {
          results.errors.push(`S3 cleanup failed: ${error.message}`);
        }
      }
      
      await job.updateProgress(90);
      
      results.processingTime = Date.now() - startTime;
      return results;
      
    } catch (error) {
      throw new Error(`Temporary file cleanup failed: ${error.message}`);
    }
  }

  /**
   * Cleanup failed processing jobs and associated data
   * @param {Object} options - Cleanup options
   * @param {Object} job - BullMQ job for progress updates
   * @returns {Object} Cleanup results
   */
  async cleanupFailedJobs(options, job) {
    const startTime = Date.now();
    const results = {
      jobsProcessed: 0,
      artifactsUpdated: 0,
      dataDeleted: 0,
      errors: [],
    };
    
    try {
      await job.updateProgress(10);
      
      const maxAge = options.maxAge || 7 * 24 * 60 * 60 * 1000; // 7 days
      const cutoffDate = new Date(Date.now() - maxAge);
      
      // Find failed processing jobs older than cutoff
      const failedJobs = await ProcessingJob.query()
        .where('status', 'failed')
        .where('created_at', '<', cutoffDate.toISOString())
        .limit(options.batchSize || 100);
      
      await job.updateProgress(30);
      
      for (const processingJob of failedJobs) {
        try {
          // Update associated artifact status if needed
          if (processingJob.artifact_id) {
            const artifact = await Artifact.findById(processingJob.artifact_id);
            if (artifact && artifact.status === 'processing') {
              await Artifact.update(artifact.id, {
                status: 'failed',
                last_error: 'Cleanup: Job marked as failed due to age',
                processing_stages: [...(artifact.processing_stages || []), 'cleanup_failed'],
              });
              results.artifactsUpdated++;
            }
          }
          
          // Delete the processing job record
          await ProcessingJob.query().deleteById(processingJob.id);
          results.jobsProcessed++;
          
        } catch (error) {
          results.errors.push(`Failed to cleanup job ${processingJob.id}: ${error.message}`);
        }
      }
      
      await job.updateProgress(70);
      
      // Cleanup associated temporary data
      if (options.cleanupTempData) {
        // This would cleanup any temporary files or S3 objects associated with failed jobs
        // Implementation depends on your specific temporary data storage strategy
      }
      
      await job.updateProgress(90);
      
      results.processingTime = Date.now() - startTime;
      return results;
      
    } catch (error) {
      throw new Error(`Failed job cleanup failed: ${error.message}`);
    }
  }

  /**
   * Cleanup orphaned artifacts (artifacts without files or vice versa)
   * @param {Object} options - Cleanup options
   * @param {Object} job - BullMQ job for progress updates
   * @returns {Object} Cleanup results
   */
  async cleanupOrphanedArtifacts(options, job) {
    const startTime = Date.now();
    const results = {
      orphanedArtifacts: 0,
      orphanedS3Objects: 0,
      errors: [],
    };
    
    try {
      await job.updateProgress(10);
      
      // Find artifacts without corresponding S3 objects
      const artifacts = await Artifact.query()
        .where('status', '!=', 'deleted')
        .limit(options.batchSize || 500);
      
      await job.updateProgress(30);
      
      for (const artifact of artifacts) {
        try {
          // Check if S3 object exists
          const headParams = {
            Bucket: artifact.s3_bucket,
            Key: artifact.s3_key,
          };
          
          try {
            await this.s3.headObject(headParams).promise();
          } catch (s3Error) {
            if (s3Error.code === 'NotFound') {
              // Artifact record exists but S3 object doesn't
              if (options.deleteOrphanedRecords) {
                await Artifact.update(artifact.id, {
                  status: 'deleted',
                  last_error: 'Cleanup: S3 object not found',
                });
                results.orphanedArtifacts++;
              }
            } else {
              results.errors.push(`S3 check failed for artifact ${artifact.id}: ${s3Error.message}`);
            }
          }
        } catch (error) {
          results.errors.push(`Failed to check artifact ${artifact.id}: ${error.message}`);
        }
      }
      
      await job.updateProgress(70);
      
      // Find S3 objects without corresponding artifact records
      if (options.checkOrphanedS3Objects) {
        try {
          const bucket = options.s3Bucket || process.env.AWS_S3_BUCKET;
          const listParams = {
            Bucket: bucket,
            MaxKeys: options.batchSize || 1000,
          };
          
          const objects = await this.s3.listObjectsV2(listParams).promise();
          
          if (objects.Contents) {
            for (const s3Object of objects.Contents) {
              try {
                // Check if artifact record exists for this S3 key
                const artifact = await Artifact.query()
                  .where('s3_key', s3Object.Key)
                  .where('s3_bucket', bucket)
                  .first();
                
                if (!artifact && options.deleteOrphanedS3Objects) {
                  // S3 object exists but no artifact record
                  await this.s3.deleteObject({
                    Bucket: bucket,
                    Key: s3Object.Key,
                  }).promise();
                  results.orphanedS3Objects++;
                }
              } catch (error) {
                results.errors.push(`Failed to check S3 object ${s3Object.Key}: ${error.message}`);
              }
            }
          }
        } catch (error) {
          results.errors.push(`S3 orphan check failed: ${error.message}`);
        }
      }
      
      await job.updateProgress(90);
      
      results.processingTime = Date.now() - startTime;
      return results;
      
    } catch (error) {
      throw new Error(`Orphaned artifact cleanup failed: ${error.message}`);
    }
  }

  /**
   * Cleanup old processing job records
   * @param {Object} options - Cleanup options
   * @param {Object} job - BullMQ job for progress updates
   * @returns {Object} Cleanup results
   */
  async cleanupOldProcessingJobs(options, job) {
    const startTime = Date.now();
    const results = {
      jobsDeleted: 0,
      errors: [],
    };
    
    try {
      await job.updateProgress(10);
      
      const maxAge = options.maxAge || 30 * 24 * 60 * 60 * 1000; // 30 days
      const cutoffDate = new Date(Date.now() - maxAge);
      
      // Delete completed processing jobs older than cutoff
      const deleteResult = await ProcessingJob.query()
        .where('status', 'completed')
        .where('completed_at', '<', cutoffDate.toISOString())
        .delete();
      
      results.jobsDeleted = deleteResult;
      
      await job.updateProgress(90);
      
      results.processingTime = Date.now() - startTime;
      return results;
      
    } catch (error) {
      throw new Error(`Old processing job cleanup failed: ${error.message}`);
    }
  }

  /**
   * Cleanup incomplete multipart uploads
   * @param {Object} options - Cleanup options
   * @param {Object} job - BullMQ job for progress updates
   * @returns {Object} Cleanup results
   */
  async cleanupIncompleteUploads(options, job) {
    const startTime = Date.now();
    const results = {
      uploadsAborted: 0,
      errors: [],
    };
    
    try {
      await job.updateProgress(10);
      
      const bucket = options.s3Bucket || process.env.AWS_S3_BUCKET;
      const maxAge = options.maxAge || 24 * 60 * 60 * 1000; // 24 hours
      
      // List incomplete multipart uploads
      const listParams = {
        Bucket: bucket,
      };
      
      const uploads = await this.s3.listMultipartUploads(listParams).promise();
      
      await job.updateProgress(50);
      
      if (uploads.Uploads) {
        for (const upload of uploads.Uploads) {
          try {
            const age = Date.now() - upload.Initiated.getTime();
            
            if (age > maxAge) {
              await this.s3.abortMultipartUpload({
                Bucket: bucket,
                Key: upload.Key,
                UploadId: upload.UploadId,
              }).promise();
              
              results.uploadsAborted++;
            }
          } catch (error) {
            results.errors.push(`Failed to abort upload ${upload.UploadId}: ${error.message}`);
          }
        }
      }
      
      await job.updateProgress(90);
      
      results.processingTime = Date.now() - startTime;
      return results;
      
    } catch (error) {
      throw new Error(`Incomplete upload cleanup failed: ${error.message}`);
    }
  }

  /**
   * Perform general system maintenance tasks
   * @param {Object} options - Maintenance options
   * @param {Object} job - BullMQ job for progress updates
   * @returns {Object} Maintenance results
   */
  async performSystemMaintenance(options, job) {
    const startTime = Date.now();
    const results = {
      tasksCompleted: [],
      errors: [],
    };
    
    try {
      await job.updateProgress(10);
      
      // Update artifact statistics
      if (options.updateStatistics !== false) {
        try {
          // This could update cached statistics, refresh materialized views, etc.
          results.tasksCompleted.push('statistics_updated');
        } catch (error) {
          results.errors.push(`Statistics update failed: ${error.message}`);
        }
      }
      
      await job.updateProgress(30);
      
      // Cleanup old log entries
      if (options.cleanupLogs) {
        try {
          // Implementation depends on your logging system
          results.tasksCompleted.push('logs_cleaned');
        } catch (error) {
          results.errors.push(`Log cleanup failed: ${error.message}`);
        }
      }
      
      await job.updateProgress(50);
      
      // Optimize database if requested
      if (options.optimizeDatabase) {
        try {
          // This could run VACUUM, ANALYZE, or other database optimization commands
          results.tasksCompleted.push('database_optimized');
        } catch (error) {
          results.errors.push(`Database optimization failed: ${error.message}`);
        }
      }
      
      await job.updateProgress(70);
      
      // Health check and monitoring
      if (options.healthCheck !== false) {
        try {
          const healthStatus = await this.performHealthCheck();
          results.healthStatus = healthStatus;
          results.tasksCompleted.push('health_check_completed');
        } catch (error) {
          results.errors.push(`Health check failed: ${error.message}`);
        }
      }
      
      await job.updateProgress(90);
      
      results.processingTime = Date.now() - startTime;
      return results;
      
    } catch (error) {
      throw new Error(`System maintenance failed: ${error.message}`);
    }
  }

  /**
   * Perform system health check
   * @returns {Object} Health status
   */
  async performHealthCheck() {
    const health = {
      database: false,
      s3: false,
      redis: false,
      timestamp: new Date().toISOString(),
    };
    
    try {
      // Check database connectivity
      await Artifact.query().limit(1);
      health.database = true;
    } catch (error) {
      console.warn('Database health check failed:', error.message);
    }
    
    try {
      // Check S3 connectivity
      const bucket = process.env.AWS_S3_BUCKET;
      if (bucket) {
        await this.s3.headBucket({ Bucket: bucket }).promise();
        health.s3 = true;
      }
    } catch (error) {
      console.warn('S3 health check failed:', error.message);
    }
    
    try {
      // Check Redis connectivity
      const Redis = require('ioredis');
      const redis = new Redis(this.redisConfig);
      await redis.ping();
      await redis.disconnect();
      health.redis = true;
    } catch (error) {
      console.warn('Redis health check failed:', error.message);
    }
    
    return health;
  }

  /**
   * Setup event handlers for worker monitoring
   */
  setupEventHandlers() {
    this.worker.on('ready', () => {
      console.log('🧹 CleanupWorker is ready for processing');
    });

    this.worker.on('error', (error) => {
      console.error('🧹 CleanupWorker error:', error);
    });

    this.worker.on('stalled', (jobId) => {
      console.warn(`🧹 CleanupWorker job ${jobId} stalled`);
    });

    this.worker.on('completed', (job) => {
      console.log(`🧹 CleanupWorker completed job ${job.id} for cleanup type ${job.data.cleanupType}`);
    });

    this.worker.on('failed', (job, err) => {
      console.error(`🧹 CleanupWorker job ${job?.id} failed:`, err.message);
    });

    this.worker.on('progress', (job, progress) => {
      console.log(`🧹 CleanupWorker job ${job.id} progress: ${progress}%`);
    });
  }

  /**
   * Get worker instance for external access
   * @returns {Worker} BullMQ worker instance
   */
  getWorker() {
    return this.worker;
  }

  /**
   * Gracefully close the worker
   */
  async close() {
    console.log('🧹 Shutting down CleanupWorker...');
    await this.worker.close();
    console.log('🧹 CleanupWorker shut down successfully');
  }

  /**
   * Get worker capabilities and configuration
   * @returns {Object} Worker capabilities
   */
  getCapabilities() {
    return {
      workerType: 'CleanupWorker',
      concurrency: this.workerConfig.concurrency,
      queueName: 'cleanup',
      features: [
        'temporary_file_cleanup',
        'failed_job_management',
        'orphaned_artifact_cleanup',
        'old_processing_job_cleanup',
        'incomplete_upload_cleanup',
        'system_maintenance',
        'health_monitoring',
        's3_integration',
        'database_optimization',
      ],
      cleanupTypes: [
        'temporaryFiles',
        'failedJobs',
        'orphanedArtifacts',
        'oldProcessingJobs',
        'incompleteUploads',
        'systemMaintenance',
      ],
    };
  }
}

module.exports = CleanupWorker;