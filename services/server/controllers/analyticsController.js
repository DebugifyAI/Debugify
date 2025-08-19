const { MetricsCollectionService } = require('../services/MetricsCollectionService');
const { AlertingService } = require('../services/AlertingService');

class AnalyticsController {
  constructor() {
    this.metricsService = new MetricsCollectionService();
    this.alertingService = new AlertingService();
  }

  // Get dashboard overview
  async getDashboardOverview(req, res) {
    try {
      const timeRange = req.query.timeRange || '24h';
      
      const [
        processingMetrics,
        imageMetrics,
        costMetrics,
        performanceMetrics,
        errorMetrics,
        systemHealth
      ] = await Promise.all([
        this.metricsService.collectProcessingMetrics(timeRange),
        this.metricsService.collectImageProcessingMetrics(timeRange),
        this.metricsService.collectCostMetrics(timeRange),
        this.metricsService.collectPerformanceMetrics(timeRange),
        this.metricsService.collectErrorMetrics(timeRange),
        this.metricsService.getSystemHealthMetrics()
      ]);

      const overview = {
        timeRange,
        systemHealth,
        processing: processingMetrics,
        imageProcessing: imageMetrics,
        costs: costMetrics,
        performance: performanceMetrics,
        errors: errorMetrics,
        timestamp: new Date().toISOString()
      };

      res.json(overview);
    } catch (error) {
      console.error('Error getting dashboard overview:', error);
      res.status(500).json({ error: 'Failed to get dashboard overview' });
    }
  }

  // Get processing statistics
  async getProcessingStats(req, res) {
    try {
      const timeRange = req.query.timeRange || '24h';
      const jobType = req.query.jobType;

      let metrics = await this.metricsService.collectProcessingMetrics(timeRange);
      
      if (jobType) {
        metrics = metrics.filter(m => m.job_type === jobType);
      }

      // Calculate additional statistics
      const totalJobs = metrics.reduce((sum, m) => sum + parseInt(m.total_jobs), 0);
      const totalCompleted = metrics.reduce((sum, m) => sum + parseInt(m.completed_jobs), 0);
      const totalFailed = metrics.reduce((sum, m) => sum + parseInt(m.failed_jobs), 0);
      
      const stats = {
        timeRange,
        jobType: jobType || 'all',
        summary: {
          totalJobs,
          completedJobs: totalCompleted,
          failedJobs: totalFailed,
          successRate: totalJobs > 0 ? ((totalCompleted / totalJobs) * 100).toFixed(2) : 0,
          failureRate: totalJobs > 0 ? ((totalFailed / totalJobs) * 100).toFixed(2) : 0
        },
        byJobType: metrics,
        timestamp: new Date().toISOString()
      };

      res.json(stats);
    } catch (error) {
      console.error('Error getting processing stats:', error);
      res.status(500).json({ error: 'Failed to get processing statistics' });
    }
  }

  // Get image processing analytics
  async getImageAnalytics(req, res) {
    try {
      const timeRange = req.query.timeRange || '24h';
      
      const imageMetrics = await this.metricsService.collectImageProcessingMetrics(timeRange);
      
      // Calculate derived metrics
      const ocrSuccessRate = imageMetrics.total_images > 0 
        ? ((imageMetrics.ocr_processed / imageMetrics.total_images) * 100).toFixed(2)
        : 0;
        
      const variantGenerationRate = imageMetrics.total_images > 0
        ? ((imageMetrics.variants_generated / imageMetrics.total_images) * 100).toFixed(2)
        : 0;

      const analytics = {
        timeRange,
        summary: {
          totalImages: imageMetrics.total_images || 0,
          ocrProcessed: imageMetrics.ocr_processed || 0,
          variantsGenerated: imageMetrics.variants_generated || 0,
          visualElementsDetected: imageMetrics.visual_elements_detected || 0,
          sensitiveDataDetected: imageMetrics.sensitive_data_detected || 0,
          ocrSuccessRate: parseFloat(ocrSuccessRate),
          variantGenerationRate: parseFloat(variantGenerationRate)
        },
        ocrMetrics: {
          averageConfidence: imageMetrics.avg_ocr_confidence || 0,
          highConfidenceCount: imageMetrics.high_confidence_ocr || 0,
          lowConfidenceCount: imageMetrics.low_confidence_ocr || 0,
          averageTextLength: imageMetrics.avg_ocr_text_length || 0
        },
        timestamp: new Date().toISOString()
      };

      res.json(analytics);
    } catch (error) {
      console.error('Error getting image analytics:', error);
      res.status(500).json({ error: 'Failed to get image analytics' });
    }
  }

  // Get cost analytics
  async getCostAnalytics(req, res) {
    try {
      const timeRange = req.query.timeRange || '24h';
      
      const costMetrics = await this.metricsService.collectCostMetrics(timeRange);
      
      // Calculate cost breakdown percentages
      const totalCost = costMetrics.total_estimated_cost;
      const costBreakdown = {
        s3Storage: {
          cost: costMetrics.estimated_costs.s3_storage,
          percentage: totalCost > 0 ? ((costMetrics.estimated_costs.s3_storage / totalCost) * 100).toFixed(2) : 0
        },
        llmTokens: {
          cost: costMetrics.estimated_costs.llm_tokens,
          percentage: totalCost > 0 ? ((costMetrics.estimated_costs.llm_tokens / totalCost) * 100).toFixed(2) : 0
        },
        visionApi: {
          cost: costMetrics.estimated_costs.vision_api,
          percentage: totalCost > 0 ? ((costMetrics.estimated_costs.vision_api / totalCost) * 100).toFixed(2) : 0
        }
      };

      const analytics = {
        timeRange,
        totalEstimatedCost: totalCost,
        costBreakdown,
        storage: {
          totalBytes: costMetrics.storage.total_storage_bytes || 0,
          totalFiles: costMetrics.storage.total_files || 0,
          imageBytes: costMetrics.storage.image_storage_bytes || 0,
          averageFileSize: costMetrics.storage.total_files > 0 
            ? (costMetrics.storage.total_storage_bytes / costMetrics.storage.total_files).toFixed(2)
            : 0
        },
        llmUsage: {
          totalCalls: costMetrics.llm.total_llm_calls || 0,
          totalTokens: costMetrics.llm.total_tokens || 0,
          promptTokens: costMetrics.llm.prompt_tokens || 0,
          completionTokens: costMetrics.llm.completion_tokens || 0,
          visionApiCalls: costMetrics.llm.vision_api_calls || 0,
          averageTokensPerCall: costMetrics.llm.total_llm_calls > 0
            ? (costMetrics.llm.total_tokens / costMetrics.llm.total_llm_calls).toFixed(2)
            : 0
        },
        timestamp: new Date().toISOString()
      };

      res.json(analytics);
    } catch (error) {
      console.error('Error getting cost analytics:', error);
      res.status(500).json({ error: 'Failed to get cost analytics' });
    }
  }

  // Get performance metrics
  async getPerformanceMetrics(req, res) {
    try {
      const timeRange = req.query.timeRange || '24h';
      
      const performanceMetrics = await this.metricsService.collectPerformanceMetrics(timeRange);
      
      const metrics = {
        timeRange,
        queueMetrics: performanceMetrics.queue_metrics,
        processingTimes: {
          median: performanceMetrics.processing_times.median_time || 0,
          p95: performanceMetrics.processing_times.p95_time || 0,
          p99: performanceMetrics.processing_times.p99_time || 0
        },
        throughput: {
          totalJobsProcessed: performanceMetrics.queue_metrics.reduce((sum, m) => sum + parseInt(m.jobs_processed), 0),
          averageJobsPerHour: performanceMetrics.queue_metrics.reduce((sum, m) => sum + parseFloat(m.jobs_per_hour || 0), 0)
        },
        timestamp: new Date().toISOString()
      };

      res.json(metrics);
    } catch (error) {
      console.error('Error getting performance metrics:', error);
      res.status(500).json({ error: 'Failed to get performance metrics' });
    }
  }

  // Get error analytics
  async getErrorAnalytics(req, res) {
    try {
      const timeRange = req.query.timeRange || '24h';
      
      const errorMetrics = await this.metricsService.collectErrorMetrics(timeRange);
      
      const analytics = {
        timeRange,
        errorRates: errorMetrics.error_rates,
        errorPatterns: errorMetrics.error_patterns,
        summary: {
          totalJobs: errorMetrics.error_rates.reduce((sum, m) => sum + parseInt(m.total_jobs), 0),
          totalFailures: errorMetrics.error_rates.reduce((sum, m) => sum + parseInt(m.failed_jobs), 0),
          averageErrorRate: errorMetrics.error_rates.length > 0
            ? (errorMetrics.error_rates.reduce((sum, m) => sum + parseFloat(m.error_rate), 0) / errorMetrics.error_rates.length).toFixed(2)
            : 0,
          totalRetries: errorMetrics.error_rates.reduce((sum, m) => sum + parseInt(m.retried_jobs), 0)
        },
        timestamp: new Date().toISOString()
      };

      res.json(analytics);
    } catch (error) {
      console.error('Error getting error analytics:', error);
      res.status(500).json({ error: 'Failed to get error analytics' });
    }
  }

  // Get system health status
  async getSystemHealth(req, res) {
    try {
      const health = await this.metricsService.getSystemHealthMetrics();
      const activeAlerts = this.alertingService.getActiveAlerts();
      
      const response = {
        ...health,
        activeAlerts: activeAlerts.length,
        alerts: activeAlerts
      };

      res.json(response);
    } catch (error) {
      console.error('Error getting system health:', error);
      res.status(500).json({ error: 'Failed to get system health' });
    }
  }

  // Get alerts
  async getAlerts(req, res) {
    try {
      const includeHistory = req.query.includeHistory === 'true';
      const limit = parseInt(req.query.limit) || 50;
      
      const response = {
        activeAlerts: this.alertingService.getActiveAlerts(),
        thresholds: this.alertingService.getThresholds()
      };

      if (includeHistory) {
        response.alertHistory = this.alertingService.getAlertHistory(limit);
      }

      res.json(response);
    } catch (error) {
      console.error('Error getting alerts:', error);
      res.status(500).json({ error: 'Failed to get alerts' });
    }
  }

  // Update alert thresholds
  async updateAlertThresholds(req, res) {
    try {
      const { thresholds } = req.body;
      
      if (!thresholds || typeof thresholds !== 'object') {
        return res.status(400).json({ error: 'Invalid thresholds provided' });
      }

      this.alertingService.updateThresholds(thresholds);
      
      res.json({ 
        message: 'Alert thresholds updated successfully',
        thresholds: this.alertingService.getThresholds()
      });
    } catch (error) {
      console.error('Error updating alert thresholds:', error);
      res.status(500).json({ error: 'Failed to update alert thresholds' });
    }
  }

  // Trigger manual alert check
  async checkAlerts(req, res) {
    try {
      const alerts = await this.alertingService.checkAlerts();
      
      res.json({
        message: 'Alert check completed',
        newAlerts: alerts.length,
        alerts
      });
    } catch (error) {
      console.error('Error checking alerts:', error);
      res.status(500).json({ error: 'Failed to check alerts' });
    }
  }

  // Get custom metrics
  async getCustomMetrics(req, res) {
    try {
      const { category } = req.params;
      
      if (!category) {
        return res.status(400).json({ error: 'Category parameter is required' });
      }

      const metrics = this.metricsService.getMetrics(category);
      const metricsArray = Array.from(metrics.entries()).map(([key, value]) => ({
        key,
        ...value
      }));

      res.json({
        category,
        metrics: metricsArray,
        count: metricsArray.length,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error getting custom metrics:', error);
      res.status(500).json({ error: 'Failed to get custom metrics' });
    }
  }

  // Record custom metric
  async recordCustomMetric(req, res) {
    try {
      const { category } = req.params;
      const { key, value, metadata } = req.body;
      
      if (!category || !key || value === undefined) {
        return res.status(400).json({ error: 'Category, key, and value are required' });
      }

      this.metricsService.recordMetric(category, key, value, metadata);
      
      res.json({
        message: 'Metric recorded successfully',
        category,
        key,
        value,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error recording custom metric:', error);
      res.status(500).json({ error: 'Failed to record custom metric' });
    }
  }
}

module.exports = { AnalyticsController };