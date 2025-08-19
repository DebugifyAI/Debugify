const { ProcessingJob } = require('../models/ProcessingJob');
const { Artifact } = require('../models/Artifact');
const { LlmOutput } = require('../models/LlmOutput');
const knex = require('../db/knex');

class MetricsCollectionService {
  constructor() {
    this.metrics = {
      processing: new Map(),
      costs: new Map(),
      performance: new Map(),
      errors: new Map(),
      imageProcessing: new Map()
    };
  }

  // Processing metrics collection
  async collectProcessingMetrics(timeRange = '24h') {
    const timeFilter = this.getTimeFilter(timeRange);
    
    const metrics = await knex('processing_jobs')
      .select(
        'job_type',
        knex.raw('COUNT(*) as total_jobs'),
        knex.raw('COUNT(CASE WHEN status = \'completed\' THEN 1 END) as completed_jobs'),
        knex.raw('COUNT(CASE WHEN status = \'failed\' THEN 1 END) as failed_jobs'),
        knex.raw('AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) as avg_processing_time'),
        knex.raw('MAX(EXTRACT(EPOCH FROM (completed_at - started_at))) as max_processing_time'),
        knex.raw('MIN(EXTRACT(EPOCH FROM (completed_at - started_at))) as min_processing_time')
      )
      .where('created_at', '>=', timeFilter)
      .groupBy('job_type');

    return metrics;
  }

  // Image processing specific metrics
  async collectImageProcessingMetrics(timeRange = '24h') {
    const timeFilter = this.getTimeFilter(timeRange);
    
    const imageMetrics = await knex('artifacts')
      .select(
        knex.raw('COUNT(*) as total_images'),
        knex.raw('COUNT(CASE WHEN ocr_text IS NOT NULL THEN 1 END) as ocr_processed'),
        knex.raw('COUNT(CASE WHEN image_variants IS NOT NULL THEN 1 END) as variants_generated'),
        knex.raw('COUNT(CASE WHEN visual_elements IS NOT NULL THEN 1 END) as visual_elements_detected'),
        knex.raw('AVG(CHAR_LENGTH(ocr_text)) as avg_ocr_text_length'),
        knex.raw('COUNT(CASE WHEN sensitive_data_flags IS NOT NULL THEN 1 END) as sensitive_data_detected')
      )
      .where('file_type', 'like', 'image/%')
      .where('created_at', '>=', timeFilter)
      .first();

    // OCR accuracy metrics (based on confidence scores in metadata)
    const ocrAccuracy = await knex('artifacts')
      .select(
        knex.raw('AVG(CAST(image_metadata->>\'ocr_confidence\' AS FLOAT)) as avg_ocr_confidence'),
        knex.raw('COUNT(CASE WHEN CAST(image_metadata->>\'ocr_confidence\' AS FLOAT) > 0.8 THEN 1 END) as high_confidence_ocr'),
        knex.raw('COUNT(CASE WHEN CAST(image_metadata->>\'ocr_confidence\' AS FLOAT) < 0.5 THEN 1 END) as low_confidence_ocr')
      )
      .where('file_type', 'like', 'image/%')
      .where('created_at', '>=', timeFilter)
      .whereNotNull('image_metadata')
      .first();

    return { ...imageMetrics, ...ocrAccuracy };
  }

  // Cost tracking metrics
  async collectCostMetrics(timeRange = '24h') {
    const timeFilter = this.getTimeFilter(timeRange);
    
    // S3 storage costs (estimated based on file sizes)
    const s3Costs = await knex('artifacts')
      .select(
        knex.raw('SUM(file_size) as total_storage_bytes'),
        knex.raw('COUNT(*) as total_files'),
        knex.raw('SUM(CASE WHEN file_type LIKE \'image/%\' THEN file_size ELSE 0 END) as image_storage_bytes')
      )
      .where('created_at', '>=', timeFilter)
      .first();

    // LLM usage costs (based on token usage)
    const llmCosts = await knex('llm_outputs')
      .select(
        knex.raw('SUM(CAST(token_usage->>\'total_tokens\' AS INTEGER)) as total_tokens'),
        knex.raw('SUM(CAST(token_usage->>\'prompt_tokens\' AS INTEGER)) as prompt_tokens'),
        knex.raw('SUM(CAST(token_usage->>\'completion_tokens\' AS INTEGER)) as completion_tokens'),
        knex.raw('COUNT(*) as total_llm_calls'),
        knex.raw('COUNT(CASE WHEN analysis_type = \'image_analysis\' THEN 1 END) as vision_api_calls')
      )
      .where('created_at', '>=', timeFilter)
      .first();

    // Calculate estimated costs (these rates should be configurable)
    const estimatedCosts = {
      s3_storage: (s3Costs.total_storage_bytes || 0) * 0.023 / (1024 * 1024 * 1024), // $0.023 per GB
      llm_tokens: (llmCosts.total_tokens || 0) * 0.002 / 1000, // $0.002 per 1K tokens
      vision_api: (llmCosts.vision_api_calls || 0) * 0.01 // $0.01 per vision API call
    };

    return {
      storage: s3Costs,
      llm: llmCosts,
      estimated_costs: estimatedCosts,
      total_estimated_cost: Object.values(estimatedCosts).reduce((sum, cost) => sum + cost, 0)
    };
  }

  // Performance monitoring
  async collectPerformanceMetrics(timeRange = '24h') {
    const timeFilter = this.getTimeFilter(timeRange);
    
    // Queue throughput metrics
    const queueMetrics = await knex('processing_jobs')
      .select(
        'job_type',
        knex.raw('COUNT(*) as jobs_processed'),
        knex.raw('COUNT(*) / EXTRACT(HOURS FROM (MAX(created_at) - MIN(created_at))) as jobs_per_hour'),
        knex.raw('AVG(progress) as avg_progress'),
        knex.raw('COUNT(CASE WHEN status = \'queued\' THEN 1 END) as queued_jobs'),
        knex.raw('COUNT(CASE WHEN status = \'processing\' THEN 1 END) as active_jobs')
      )
      .where('created_at', '>=', timeFilter)
      .groupBy('job_type');

    // Processing time distribution
    const processingTimes = await knex('processing_jobs')
      .select(
        knex.raw('PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at - started_at))) as median_time'),
        knex.raw('PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at - started_at))) as p95_time'),
        knex.raw('PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at - started_at))) as p99_time')
      )
      .where('created_at', '>=', timeFilter)
      .whereNotNull('completed_at')
      .first();

    return {
      queue_metrics: queueMetrics,
      processing_times: processingTimes
    };
  }

  // Error rate monitoring
  async collectErrorMetrics(timeRange = '24h') {
    const timeFilter = this.getTimeFilter(timeRange);
    
    const errorMetrics = await knex('processing_jobs')
      .select(
        'job_type',
        knex.raw('COUNT(*) as total_jobs'),
        knex.raw('COUNT(CASE WHEN status = \'failed\' THEN 1 END) as failed_jobs'),
        knex.raw('COUNT(CASE WHEN status = \'failed\' THEN 1 END) * 100.0 / COUNT(*) as error_rate'),
        knex.raw('COUNT(CASE WHEN retry_count > 0 THEN 1 END) as retried_jobs')
      )
      .where('created_at', '>=', timeFilter)
      .groupBy('job_type');

    // Common error patterns
    const errorPatterns = await knex('processing_jobs')
      .select(
        knex.raw('error_details->>\'type\' as error_type'),
        knex.raw('COUNT(*) as occurrence_count'),
        knex.raw('error_details->>\'message\' as sample_message')
      )
      .where('created_at', '>=', timeFilter)
      .where('status', 'failed')
      .whereNotNull('error_details')
      .groupBy('error_details->>\'type\'', 'error_details->>\'message\'')
      .orderBy('occurrence_count', 'desc')
      .limit(10);

    return {
      error_rates: errorMetrics,
      error_patterns: errorPatterns
    };
  }

  // System health metrics
  async getSystemHealthMetrics() {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    
    // Recent error rate
    const recentErrors = await knex('processing_jobs')
      .count('* as total')
      .count('* as failed')
      .where('created_at', '>=', oneHourAgo)
      .where('status', 'failed')
      .first();

    const totalRecent = await knex('processing_jobs')
      .count('* as total')
      .where('created_at', '>=', oneHourAgo)
      .first();

    const errorRate = totalRecent.total > 0 ? (recentErrors.failed / totalRecent.total) * 100 : 0;

    // Queue backlog
    const queueBacklog = await knex('processing_jobs')
      .count('* as queued')
      .where('status', 'queued')
      .first();

    // Average processing time trend
    const avgProcessingTime = await knex('processing_jobs')
      .avg(knex.raw('EXTRACT(EPOCH FROM (completed_at - started_at))'))
      .where('completed_at', '>=', oneHourAgo)
      .whereNotNull('completed_at')
      .first();

    return {
      error_rate: errorRate,
      queue_backlog: parseInt(queueBacklog.queued) || 0,
      avg_processing_time: parseFloat(avgProcessingTime.avg) || 0,
      timestamp: now.toISOString(),
      status: this.determineSystemStatus(errorRate, queueBacklog.queued, avgProcessingTime.avg)
    };
  }

  // Determine overall system status
  determineSystemStatus(errorRate, queueBacklog, avgProcessingTime) {
    if (errorRate > 10 || queueBacklog > 1000 || avgProcessingTime > 300) {
      return 'critical';
    } else if (errorRate > 5 || queueBacklog > 500 || avgProcessingTime > 120) {
      return 'warning';
    } else {
      return 'healthy';
    }
  }

  // Helper method to get time filter
  getTimeFilter(timeRange) {
    const now = new Date();
    const ranges = {
      '1h': 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000
    };
    
    const milliseconds = ranges[timeRange] || ranges['24h'];
    return new Date(now.getTime() - milliseconds);
  }

  // Record custom metrics
  recordMetric(category, key, value, metadata = {}) {
    if (!this.metrics[category]) {
      this.metrics[category] = new Map();
    }
    
    this.metrics[category].set(key, {
      value,
      metadata,
      timestamp: new Date().toISOString()
    });
  }

  // Get all metrics for a category
  getMetrics(category) {
    return this.metrics[category] || new Map();
  }

  // Clear old metrics (cleanup)
  clearOldMetrics(maxAge = 24 * 60 * 60 * 1000) { // 24 hours default
    const cutoff = new Date(Date.now() - maxAge);
    
    for (const [category, metrics] of Object.entries(this.metrics)) {
      for (const [key, metric] of metrics.entries()) {
        if (new Date(metric.timestamp) < cutoff) {
          metrics.delete(key);
        }
      }
    }
  }
}

module.exports = { MetricsCollectionService };