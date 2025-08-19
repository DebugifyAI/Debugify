const { MetricsCollectionService } = require('../services/MetricsCollectionService');
const { AlertingService, EmailNotificationChannel, WebhookNotificationChannel } = require('../services/AlertingService');
const { AnalyticsController } = require('../controllers/analyticsController');
const knex = require('../db/knex');

describe('Monitoring and Analytics System', () => {
  let metricsService;
  let alertingService;
  let analyticsController;

  beforeAll(async () => {
    // Ensure test database is clean
    await knex.migrate.latest();
  });

  beforeEach(() => {
    metricsService = new MetricsCollectionService();
    alertingService = new AlertingService();
    analyticsController = new AnalyticsController();
  });

  afterEach(async () => {
    // Clean up test data
    await knex('processing_jobs').del();
    await knex('artifacts').del();
    await knex('llm_outputs').del();
  });

  afterAll(async () => {
    await knex.destroy();
  });

  describe('MetricsCollectionService', () => {
    beforeEach(async () => {
      // Insert test data
      await knex('artifacts').insert([
        {
          id: 1,
          file_name: 'test1.jpg',
          file_type: 'image/jpeg',
          file_size: 1024000,
          s3_key: 'test1.jpg',
          created_at: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
          ocr_text: 'Sample OCR text',
          image_variants: JSON.stringify({ thumbnail: 'thumb1.jpg' }),
          image_metadata: JSON.stringify({ ocr_confidence: 0.85 }),
          visual_elements: JSON.stringify({ buttons: 2, text_blocks: 3 }),
          sensitive_data_flags: JSON.stringify({ pii_detected: false })
        },
        {
          id: 2,
          file_name: 'test2.png',
          file_type: 'image/png',
          file_size: 2048000,
          s3_key: 'test2.png',
          created_at: new Date(Date.now() - 1 * 60 * 60 * 1000), // 1 hour ago
          ocr_text: 'Another OCR text sample',
          image_variants: JSON.stringify({ thumbnail: 'thumb2.jpg', webp: 'test2.webp' }),
          image_metadata: JSON.stringify({ ocr_confidence: 0.92 }),
          visual_elements: JSON.stringify({ charts: 1, text_blocks: 5 })
        }
      ]);

      await knex('processing_jobs').insert([
        {
          id: 1,
          job_id: 'job1',
          artifact_id: 1,
          job_type: 'image_processing',
          status: 'completed',
          progress: 100,
          started_at: new Date(Date.now() - 2 * 60 * 60 * 1000),
          completed_at: new Date(Date.now() - 2 * 60 * 60 * 1000 + 30000), // 30 seconds processing
          created_at: new Date(Date.now() - 2 * 60 * 60 * 1000)
        },
        {
          id: 2,
          job_id: 'job2',
          artifact_id: 2,
          job_type: 'validation',
          status: 'failed',
          progress: 50,
          started_at: new Date(Date.now() - 1 * 60 * 60 * 1000),
          error_details: JSON.stringify({ type: 'validation_error', message: 'File too large' }),
          created_at: new Date(Date.now() - 1 * 60 * 60 * 1000)
        }
      ]);

      await knex('llm_outputs').insert([
        {
          id: 1,
          artifact_id: 1,
          analysis_type: 'image_analysis',
          output_text: 'This image contains UI elements',
          confidence_score: 0.88,
          processing_time_ms: 1500,
          token_usage: JSON.stringify({ total_tokens: 150, prompt_tokens: 50, completion_tokens: 100 }),
          created_at: new Date(Date.now() - 1 * 60 * 60 * 1000)
        }
      ]);
    });

    test('should collect processing metrics correctly', async () => {
      const metrics = await metricsService.collectProcessingMetrics('24h');
      
      expect(metrics).toHaveLength(2);
      expect(metrics.find(m => m.job_type === 'image_processing')).toMatchObject({
        job_type: 'image_processing',
        total_jobs: '1',
        completed_jobs: '1',
        failed_jobs: '0'
      });
      expect(metrics.find(m => m.job_type === 'validation')).toMatchObject({
        job_type: 'validation',
        total_jobs: '1',
        completed_jobs: '0',
        failed_jobs: '1'
      });
    });

    test('should collect image processing metrics correctly', async () => {
      const metrics = await metricsService.collectImageProcessingMetrics('24h');
      
      expect(metrics).toMatchObject({
        total_images: 2,
        ocr_processed: 2,
        variants_generated: 2,
        visual_elements_detected: 2,
        sensitive_data_detected: 0,
        avg_ocr_confidence: 0.885 // Average of 0.85 and 0.92
      });
    });

    test('should collect cost metrics correctly', async () => {
      const metrics = await metricsService.collectCostMetrics('24h');
      
      expect(metrics.storage).toMatchObject({
        total_storage_bytes: 3072000, // 1024000 + 2048000
        total_files: 2,
        image_storage_bytes: 3072000
      });
      
      expect(metrics.llm).toMatchObject({
        total_llm_calls: 1,
        total_tokens: 150,
        prompt_tokens: 50,
        completion_tokens: 100,
        vision_api_calls: 1
      });
      
      expect(metrics.estimated_costs).toHaveProperty('s3_storage');
      expect(metrics.estimated_costs).toHaveProperty('llm_tokens');
      expect(metrics.estimated_costs).toHaveProperty('vision_api');
      expect(metrics.total_estimated_cost).toBeGreaterThan(0);
    });

    test('should collect performance metrics correctly', async () => {
      const metrics = await metricsService.collectPerformanceMetrics('24h');
      
      expect(metrics.queue_metrics).toHaveLength(2);
      expect(metrics.processing_times).toHaveProperty('median_time');
      expect(metrics.processing_times).toHaveProperty('p95_time');
      expect(metrics.processing_times).toHaveProperty('p99_time');
    });

    test('should collect error metrics correctly', async () => {
      const metrics = await metricsService.collectErrorMetrics('24h');
      
      expect(metrics.error_rates).toHaveLength(2);
      expect(metrics.error_patterns).toHaveLength(1);
      expect(metrics.error_patterns[0]).toMatchObject({
        error_type: 'validation_error',
        occurrence_count: '1',
        sample_message: 'File too large'
      });
    });

    test('should get system health metrics correctly', async () => {
      const health = await metricsService.getSystemHealthMetrics();
      
      expect(health).toHaveProperty('error_rate');
      expect(health).toHaveProperty('queue_backlog');
      expect(health).toHaveProperty('avg_processing_time');
      expect(health).toHaveProperty('status');
      expect(health).toHaveProperty('timestamp');
      expect(['healthy', 'warning', 'critical']).toContain(health.status);
    });

    test('should record and retrieve custom metrics', () => {
      metricsService.recordMetric('custom', 'test_metric', 42, { unit: 'count' });
      
      const metrics = metricsService.getMetrics('custom');
      expect(metrics.has('test_metric')).toBe(true);
      expect(metrics.get('test_metric')).toMatchObject({
        value: 42,
        metadata: { unit: 'count' }
      });
    });

    test('should clear old metrics', () => {
      // Record an old metric
      metricsService.recordMetric('test', 'old_metric', 1);
      
      // Manually set old timestamp
      const metrics = metricsService.getMetrics('test');
      const oldMetric = metrics.get('old_metric');
      oldMetric.timestamp = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(); // 25 hours ago
      
      metricsService.clearOldMetrics(24 * 60 * 60 * 1000); // 24 hours
      
      expect(metrics.has('old_metric')).toBe(false);
    });
  });

  describe('AlertingService', () => {
    test('should create and process alerts correctly', async () => {
      // Mock metrics that would trigger alerts
      jest.spyOn(metricsService, 'getSystemHealthMetrics').mockResolvedValue({
        error_rate: 15, // Above critical threshold
        queue_backlog: 600, // Above warning threshold
        avg_processing_time: 60, // Below threshold
        timestamp: new Date().toISOString(),
        status: 'critical'
      });

      jest.spyOn(metricsService, 'collectCostMetrics').mockResolvedValue({
        total_estimated_cost: 150 // Above warning threshold
      });

      alertingService.metricsService = metricsService;
      
      const alerts = await alertingService.checkAlerts();
      
      expect(alerts).toHaveLength(3); // error_rate (critical), queue_backlog (warning), cost (warning)
      expect(alerts.find(a => a.type === 'error_rate')).toMatchObject({
        type: 'error_rate',
        severity: 'critical'
      });
      expect(alerts.find(a => a.type === 'queue_backlog')).toMatchObject({
        type: 'queue_backlog',
        severity: 'warning'
      });
    });

    test('should resolve alerts when conditions improve', async () => {
      // First, trigger an alert
      jest.spyOn(metricsService, 'getSystemHealthMetrics').mockResolvedValueOnce({
        error_rate: 15,
        queue_backlog: 100,
        avg_processing_time: 60,
        timestamp: new Date().toISOString(),
        status: 'critical'
      });

      jest.spyOn(metricsService, 'collectCostMetrics').mockResolvedValue({
        total_estimated_cost: 50
      });

      alertingService.metricsService = metricsService;
      
      await alertingService.checkAlerts();
      expect(alertingService.getActiveAlerts()).toHaveLength(1);

      // Then, improve conditions
      jest.spyOn(metricsService, 'getSystemHealthMetrics').mockResolvedValueOnce({
        error_rate: 2, // Below warning threshold
        queue_backlog: 100,
        avg_processing_time: 60,
        timestamp: new Date().toISOString(),
        status: 'healthy'
      });

      const resolvedAlerts = await alertingService.checkResolvedAlerts();
      expect(resolvedAlerts).toHaveLength(1);
      expect(alertingService.getActiveAlerts()).toHaveLength(0);
    });

    test('should manage notification channels correctly', async () => {
      const emailChannel = new EmailNotificationChannel({ to: 'admin@test.com' });
      const webhookChannel = new WebhookNotificationChannel({ url: 'https://webhook.test.com' });
      
      alertingService.addNotificationChannel(emailChannel);
      alertingService.addNotificationChannel(webhookChannel);
      
      expect(alertingService.notificationChannels).toHaveLength(2);
    });

    test('should update alert thresholds correctly', () => {
      const newThresholds = {
        error_rate: {
          warning: 3,
          critical: 8
        }
      };
      
      alertingService.updateThresholds(newThresholds);
      
      const thresholds = alertingService.getThresholds();
      expect(thresholds.error_rate.warning).toBe(3);
      expect(thresholds.error_rate.critical).toBe(8);
    });

    test('should maintain alert history correctly', async () => {
      const alert = alertingService.createAlert('test_alert', 'warning', 'Test message', {});
      await alertingService.processAlert(alert);
      
      const history = alertingService.getAlertHistory();
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        type: 'test_alert',
        severity: 'warning',
        message: 'Test message'
      });
    });
  });

  describe('AnalyticsController', () => {
    let req, res;

    beforeEach(() => {
      req = {
        query: {},
        params: {},
        body: {}
      };
      res = {
        json: jest.fn(),
        status: jest.fn().mockReturnThis()
      };
    });

    test('should get dashboard overview correctly', async () => {
      await analyticsController.getDashboardOverview(req, res);
      
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          timeRange: '24h',
          systemHealth: expect.any(Object),
          processing: expect.any(Array),
          imageProcessing: expect.any(Object),
          costs: expect.any(Object),
          performance: expect.any(Object),
          errors: expect.any(Object),
          timestamp: expect.any(String)
        })
      );
    });

    test('should get processing stats with filtering', async () => {
      req.query = { timeRange: '7d', jobType: 'image_processing' };
      
      await analyticsController.getProcessingStats(req, res);
      
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          timeRange: '7d',
          jobType: 'image_processing',
          summary: expect.objectContaining({
            totalJobs: expect.any(Number),
            completedJobs: expect.any(Number),
            failedJobs: expect.any(Number),
            successRate: expect.any(String),
            failureRate: expect.any(String)
          }),
          byJobType: expect.any(Array)
        })
      );
    });

    test('should handle errors gracefully', async () => {
      // Mock a database error
      jest.spyOn(analyticsController.metricsService, 'collectProcessingMetrics')
        .mockRejectedValue(new Error('Database error'));
      
      await analyticsController.getProcessingStats(req, res);
      
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Failed to get processing statistics'
      });
    });

    test('should record custom metrics correctly', async () => {
      req.params = { category: 'test_category' };
      req.body = { key: 'test_key', value: 100, metadata: { unit: 'ms' } };
      
      await analyticsController.recordCustomMetric(req, res);
      
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Metric recorded successfully',
          category: 'test_category',
          key: 'test_key',
          value: 100
        })
      );
    });

    test('should validate custom metric input', async () => {
      req.params = { category: 'test_category' };
      req.body = { key: 'test_key' }; // Missing value
      
      await analyticsController.recordCustomMetric(req, res);
      
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Category, key, and value are required'
      });
    });

    test('should update alert thresholds correctly', async () => {
      req.body = {
        thresholds: {
          error_rate: { warning: 3, critical: 8 }
        }
      };
      
      await analyticsController.updateAlertThresholds(req, res);
      
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Alert thresholds updated successfully',
          thresholds: expect.any(Object)
        })
      );
    });
  });

  describe('Integration Tests', () => {
    test('should provide end-to-end monitoring workflow', async () => {
      // 1. Record some processing activity
      await knex('artifacts').insert({
        id: 100,
        file_name: 'integration_test.jpg',
        file_type: 'image/jpeg',
        file_size: 1024000,
        s3_key: 'integration_test.jpg',
        created_at: new Date()
      });

      await knex('processing_jobs').insert({
        job_id: 'integration_job',
        artifact_id: 100,
        job_type: 'image_processing',
        status: 'completed',
        progress: 100,
        started_at: new Date(Date.now() - 60000),
        completed_at: new Date(),
        created_at: new Date()
      });

      // 2. Collect metrics
      const processingMetrics = await metricsService.collectProcessingMetrics('1h');
      expect(processingMetrics.length).toBeGreaterThan(0);

      // 3. Check system health
      const health = await metricsService.getSystemHealthMetrics();
      expect(health.status).toBeDefined();

      // 4. Check for alerts
      alertingService.metricsService = metricsService;
      const alerts = await alertingService.checkAlerts();
      expect(Array.isArray(alerts)).toBe(true);

      // 5. Get analytics through controller
      const req = { query: { timeRange: '1h' } };
      const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
      
      await analyticsController.getDashboardOverview(req, res);
      expect(res.json).toHaveBeenCalled();
    });

    test('should handle high-load scenarios', async () => {
      // Insert many jobs to simulate high load
      const jobs = [];
      for (let i = 0; i < 100; i++) {
        jobs.push({
          job_id: `load_test_${i}`,
          artifact_id: 1,
          job_type: 'validation',
          status: i % 10 === 0 ? 'failed' : 'completed', // 10% failure rate
          progress: 100,
          started_at: new Date(Date.now() - 60000),
          completed_at: new Date(),
          created_at: new Date()
        });
      }
      
      await knex('processing_jobs').insert(jobs);
      
      const metrics = await metricsService.collectProcessingMetrics('1h');
      const validationMetrics = metrics.find(m => m.job_type === 'validation');
      
      expect(parseInt(validationMetrics.total_jobs)).toBeGreaterThanOrEqual(100);
      expect(parseInt(validationMetrics.failed_jobs)).toBeGreaterThanOrEqual(10);
    });
  });
});