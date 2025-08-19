const Base = require('./BaseModel');

class ProcessingJob extends Base {
  static tableName = 'processing_jobs';

  /**
   * Create a new processing job
   */
  static async createJob({
    jobId,
    artifactId,
    jobType,
    status = 'queued',
    progress = 0,
    startedAt = null,
    completedAt = null,
    errorDetails = null,
    resultData = null,
  }) {
    return this.insert({
      job_id: jobId,
      artifact_id: artifactId,
      job_type: jobType,
      status,
      progress,
      started_at: startedAt,
      completed_at: completedAt,
      error_details: errorDetails,
      result_data: resultData,
    });
  }

  /**
   * Update job progress
   */
  async updateProgress(progress, status = null) {
    const updates = { progress };
    if (status) updates.status = status;
    
    return this.update(updates);
  }

  /**
   * Mark job as started
   */
  async markStarted() {
    return this.update({
      status: 'active',
      started_at: new Date(),
    });
  }

  /**
   * Mark job as completed successfully
   */
  async markCompleted(resultData = null) {
    return this.update({
      status: 'completed',
      progress: 100,
      completed_at: new Date(),
      result_data: resultData,
    });
  }

  /**
   * Mark job as failed
   */
  async markFailed(errorDetails) {
    return this.update({
      status: 'failed',
      completed_at: new Date(),
      error_details: errorDetails,
    });
  }

  /**
   * Get jobs by artifact ID
   */
  static async getByArtifactId(artifactId) {
    return this.findAll({ artifact_id: artifactId })
      .orderBy('created_at', 'desc');
  }

  /**
   * Get jobs by status
   */
  static async getByStatus(status) {
    return this.findAll({ status })
      .orderBy('created_at', 'asc');
  }

  /**
   * Get jobs by type and status
   */
  static async getByTypeAndStatus(jobType, status) {
    return this.findAll({ 
      job_type: jobType, 
      status: status 
    }).orderBy('created_at', 'asc');
  }

  /**
   * Get active jobs (queued or active status)
   */
  static async getActiveJobs() {
    return this.query()
      .whereIn('status', ['queued', 'active'])
      .orderBy('created_at', 'asc');
  }

  /**
   * Get failed jobs that can be retried
   */
  static async getFailedJobsForRetry(maxAge = 24) { // maxAge in hours
    const cutoffTime = new Date();
    cutoffTime.setHours(cutoffTime.getHours() - maxAge);

    return this.query()
      .where('status', 'failed')
      .where('completed_at', '>', cutoffTime)
      .orderBy('completed_at', 'desc');
  }

  /**
   * Get job statistics by type
   */
  static async getJobStatsByType() {
    return this.query()
      .select('job_type')
      .count('* as total')
      .countDistinct('status as status_count')
      .groupBy('job_type');
  }

  /**
   * Get processing time statistics
   */
  static async getProcessingTimeStats(jobType = null) {
    let query = this.query()
      .select(this.raw(`
        AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) as avg_duration_seconds,
        MIN(EXTRACT(EPOCH FROM (completed_at - started_at))) as min_duration_seconds,
        MAX(EXTRACT(EPOCH FROM (completed_at - started_at))) as max_duration_seconds,
        COUNT(*) as completed_jobs
      `))
      .whereNotNull('started_at')
      .whereNotNull('completed_at')
      .where('status', 'completed');

    if (jobType) {
      query = query.where('job_type', jobType);
    }

    return query.first();
  }

  /**
   * Clean up old completed jobs (older than specified days)
   */
  static async cleanupOldJobs(daysOld = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    return this.query()
      .where('status', 'completed')
      .where('completed_at', '<', cutoffDate)
      .delete();
  }

  /**
   * Get job duration in seconds (if completed)
   */
  getDurationSeconds() {
    if (!this.started_at || !this.completed_at) {
      return null;
    }
    
    return Math.round(
      (new Date(this.completed_at) - new Date(this.started_at)) / 1000
    );
  }

  /**
   * Check if job is in a terminal state
   */
  isTerminal() {
    return ['completed', 'failed'].includes(this.status);
  }

  /**
   * Check if job is currently active
   */
  isActive() {
    return ['queued', 'active'].includes(this.status);
  }

  /**
   * Find job by job ID
   */
  static async findByJobId(jobId) {
    return this.findOne({ job_id: jobId });
  }

  /**
   * Find jobs by filters
   */
  static async findByFilters(filters) {
    return this.findAll(filters).orderBy('created_at', 'desc');
  }

  /**
   * Find jobs by artifact IDs
   */
  static async findByArtifactIds(artifactIds, filters = {}) {
    let query = this.query().whereIn('artifact_id', artifactIds);
    
    Object.entries(filters).forEach(([key, value]) => {
      if (key !== 'artifact_ids') {
        query = query.where(key, value);
      }
    });

    return query.orderBy('created_at', 'desc');
  }

  /**
   * Create or update processing job
   */
  static async createOrUpdate(data) {
    const existing = await this.findByJobId(data.job_id);
    if (existing) {
      return existing.update(data);
    }
    return this.createJob(data);
  }

  /**
   * Update job progress with stage and metadata
   */
  static async updateProgress(jobId, progress, stage = null, metadata = {}) {
    const updates = { 
      progress,
      updated_at: new Date()
    };
    
    if (stage) {
      updates.current_stage = stage;
    }
    
    if (Object.keys(metadata).length > 0) {
      updates.stage_metadata = metadata;
    }

    return this.query()
      .where('job_id', jobId)
      .update(updates);
  }

  /**
   * Update job status with additional data
   */
  static async updateStatus(jobId, status, additionalData = {}) {
    const updates = {
      status,
      updated_at: new Date(),
      ...additionalData
    };

    return this.query()
      .where('job_id', jobId)
      .update(updates);
  }

  /**
   * Get statistics since a specific date
   */
  static async getStatsSince(since) {
    const stats = await this.query()
      .select(
        this.raw('COUNT(*) as total'),
        this.raw("COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed"),
        this.raw("COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed"),
        this.raw("COUNT(CASE WHEN status = 'active' THEN 1 END) as active"),
        this.raw("COUNT(CASE WHEN status = 'queued' THEN 1 END) as queued"),
        this.raw(`
          AVG(CASE 
            WHEN status = 'completed' AND started_at IS NOT NULL AND completed_at IS NOT NULL 
            THEN EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000 
          END) as avg_processing_time
        `)
      )
      .where('created_at', '>=', since)
      .first();

    const jobTypeBreakdown = await this.query()
      .select('job_type')
      .count('* as count')
      .where('created_at', '>=', since)
      .groupBy('job_type');

    return {
      ...stats,
      jobTypeBreakdown: jobTypeBreakdown.reduce((acc, item) => {
        acc[item.job_type] = parseInt(item.count, 10);
        return acc;
      }, {})
    };
  }
}

module.exports = ProcessingJob;