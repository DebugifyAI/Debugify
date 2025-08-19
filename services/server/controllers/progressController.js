/**
 * Progress Controller
 * Handles API endpoints for job status and progress tracking
 */

const ProcessingJob = require('../models/ProcessingJob');
const Artifact = require('../models/Artifact');
const { Queue } = require('bullmq');
const { redisConfig } = require('../queues/specializedQueues');

class ProgressController {
  // Get detailed job status
  static async getJobStatus(req, res) {
    try {
      const { jobId } = req.params;
      
      const job = await ProcessingJob.findByJobId(jobId);
      if (!job) {
        return res.status(404).json({
          error: 'Job not found',
          jobId
        });
      }

      // Get additional details from BullMQ if job is still active
      let queueStatus = null;
      if (job.status === 'queued' || job.status === 'active') {
        try {
          const queue = new Queue(job.job_type, { connection: redisConfig });
          const bullJob = await queue.getJob(jobId);
          if (bullJob) {
            queueStatus = {
              progress: bullJob.progress,
              processedOn: bullJob.processedOn,
              finishedOn: bullJob.finishedOn,
              failedReason: bullJob.failedReason,
              attemptsMade: bullJob.attemptsMade,
              opts: bullJob.opts
            };
          }
        } catch (queueError) {
          console.warn(`Could not get queue status for job ${jobId}:`, queueError.message);
        }
      }

      const response = {
        jobId: job.job_id,
        artifactId: job.artifact_id,
        jobType: job.job_type,
        status: job.status,
        progress: job.progress,
        startedAt: job.started_at,
        completedAt: job.completed_at,
        errorDetails: job.error_details,
        resultData: job.result_data,
        createdAt: job.created_at,
        updatedAt: job.updated_at,
        queueStatus
      };

      res.json(response);
    } catch (error) {
      console.error('Error getting job status:', error);
      res.status(500).json({
        error: 'Failed to get job status',
        message: error.message
      });
    }
  }

  // Get jobs for a specific artifact
  static async getArtifactJobs(req, res) {
    try {
      const { artifactId } = req.params;
      const { status, jobType } = req.query;

      const artifact = await Artifact.findById(artifactId);
      if (!artifact) {
        return res.status(404).json({
          error: 'Artifact not found',
          artifactId
        });
      }

      const filters = { artifact_id: artifactId };
      if (status) filters.status = status;
      if (jobType) filters.job_type = jobType;

      const jobs = await ProcessingJob.findByFilters(filters);

      const response = {
        artifactId,
        totalJobs: jobs.length,
        jobs: jobs.map(job => ({
          jobId: job.job_id,
          jobType: job.job_type,
          status: job.status,
          progress: job.progress,
          startedAt: job.started_at,
          completedAt: job.completed_at,
          createdAt: job.created_at,
          hasError: !!job.error_details
        }))
      };

      res.json(response);
    } catch (error) {
      console.error('Error getting artifact jobs:', error);
      res.status(500).json({
        error: 'Failed to get artifact jobs',
        message: error.message
      });
    }
  }

  // Get jobs for a bug report (all artifacts)
  static async getBugReportJobs(req, res) {
    try {
      const { bugId } = req.params;
      const { status, jobType } = req.query;

      // Get all artifacts for this bug report
      const artifacts = await Artifact.findByBugReportId(bugId);
      if (!artifacts || artifacts.length === 0) {
        return res.json({
          bugId,
          totalJobs: 0,
          jobs: [],
          artifactSummary: []
        });
      }

      const artifactIds = artifacts.map(a => a.id);
      
      const filters = { artifact_ids: artifactIds };
      if (status) filters.status = status;
      if (jobType) filters.job_type = jobType;

      const jobs = await ProcessingJob.findByArtifactIds(artifactIds, filters);

      // Group jobs by artifact
      const jobsByArtifact = {};
      jobs.forEach(job => {
        if (!jobsByArtifact[job.artifact_id]) {
          jobsByArtifact[job.artifact_id] = [];
        }
        jobsByArtifact[job.artifact_id].push(job);
      });

      const artifactSummary = artifacts.map(artifact => {
        const artifactJobs = jobsByArtifact[artifact.id] || [];
        const completedJobs = artifactJobs.filter(j => j.status === 'completed').length;
        const failedJobs = artifactJobs.filter(j => j.status === 'failed').length;
        const activeJobs = artifactJobs.filter(j => j.status === 'active').length;
        const queuedJobs = artifactJobs.filter(j => j.status === 'queued').length;

        return {
          artifactId: artifact.id,
          filename: artifact.filename,
          contentType: artifact.content_type,
          totalJobs: artifactJobs.length,
          completedJobs,
          failedJobs,
          activeJobs,
          queuedJobs,
          overallProgress: artifactJobs.length > 0 
            ? Math.round(artifactJobs.reduce((sum, job) => sum + (job.progress || 0), 0) / artifactJobs.length)
            : 0
        };
      });

      const response = {
        bugId,
        totalJobs: jobs.length,
        jobs: jobs.map(job => ({
          jobId: job.job_id,
          artifactId: job.artifact_id,
          jobType: job.job_type,
          status: job.status,
          progress: job.progress,
          startedAt: job.started_at,
          completedAt: job.completed_at,
          createdAt: job.created_at,
          hasError: !!job.error_details
        })),
        artifactSummary
      };

      res.json(response);
    } catch (error) {
      console.error('Error getting bug report jobs:', error);
      res.status(500).json({
        error: 'Failed to get bug report jobs',
        message: error.message
      });
    }
  }

  // Get processing statistics
  static async getProcessingStats(req, res) {
    try {
      const { timeframe = '24h' } = req.query;
      
      let since;
      switch (timeframe) {
        case '1h':
          since = new Date(Date.now() - 60 * 60 * 1000);
          break;
        case '24h':
          since = new Date(Date.now() - 24 * 60 * 60 * 1000);
          break;
        case '7d':
          since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          break;
        default:
          since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      }

      const stats = await ProcessingJob.getStatsSince(since);

      const response = {
        timeframe,
        since: since.toISOString(),
        stats: {
          totalJobs: stats.total || 0,
          completedJobs: stats.completed || 0,
          failedJobs: stats.failed || 0,
          activeJobs: stats.active || 0,
          queuedJobs: stats.queued || 0,
          averageProcessingTime: stats.avgProcessingTime || 0,
          jobTypeBreakdown: stats.jobTypeBreakdown || {},
          successRate: stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0
        },
        timestamp: new Date().toISOString()
      };

      res.json(response);
    } catch (error) {
      console.error('Error getting processing stats:', error);
      res.status(500).json({
        error: 'Failed to get processing stats',
        message: error.message
      });
    }
  }

  // Retry a failed job
  static async retryJob(req, res) {
    try {
      const { jobId } = req.params;
      
      const job = await ProcessingJob.findByJobId(jobId);
      if (!job) {
        return res.status(404).json({
          error: 'Job not found',
          jobId
        });
      }

      if (job.status !== 'failed') {
        return res.status(400).json({
          error: 'Job is not in failed state',
          currentStatus: job.status
        });
      }

      // Get the artifact to re-enqueue processing
      const artifact = await Artifact.findById(job.artifact_id);
      if (!artifact) {
        return res.status(404).json({
          error: 'Associated artifact not found',
          artifactId: job.artifact_id
        });
      }

      // Re-enqueue the job based on job type
      const { enqueueSpecializedJob } = require('../queues/specializedQueues');
      const newJobId = await enqueueSpecializedJob(job.job_type, {
        artifactId: artifact.id,
        retryOf: jobId,
        priority: 1 // Higher priority for retries
      });

      // Mark original job as retried
      await ProcessingJob.updateStatus(jobId, 'retried', {
        retried_at: new Date(),
        retry_job_id: newJobId
      });

      res.json({
        message: 'Job retry initiated',
        originalJobId: jobId,
        newJobId,
        artifactId: artifact.id
      });
    } catch (error) {
      console.error('Error retrying job:', error);
      res.status(500).json({
        error: 'Failed to retry job',
        message: error.message
      });
    }
  }

  // Get queue health status
  static async getQueueHealth(req, res) {
    try {
      const queueNames = ['validation', 'parsing', 'image-processing', 'llm-analysis', 'cleanup'];
      const queueHealth = {};

      for (const queueName of queueNames) {
        try {
          const queue = new Queue(queueName, { connection: redisConfig });
          const [waiting, active, completed, failed] = await Promise.all([
            queue.getWaiting(),
            queue.getActive(),
            queue.getCompleted(),
            queue.getFailed()
          ]);

          queueHealth[queueName] = {
            waiting: waiting.length,
            active: active.length,
            completed: completed.length,
            failed: failed.length,
            healthy: true
          };
        } catch (error) {
          queueHealth[queueName] = {
            waiting: 0,
            active: 0,
            completed: 0,
            failed: 0,
            healthy: false,
            error: error.message
          };
        }
      }

      const overallHealth = Object.values(queueHealth).every(q => q.healthy);

      res.json({
        healthy: overallHealth,
        queues: queueHealth,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error getting queue health:', error);
      res.status(500).json({
        error: 'Failed to get queue health',
        message: error.message
      });
    }
  }
}

module.exports = ProgressController;