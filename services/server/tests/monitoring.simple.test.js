const { MetricsCollectionService } = require('../services/MetricsCollectionService');
const { AlertingService } = require('../services/AlertingService');

describe('Monitoring System - Simple Tests', () => {
  let metricsService;
  let alertingService;

  beforeEach(() => {
    metricsService = new MetricsCollectionService();
    alertingService = new AlertingService();
  });

  describe('MetricsCollectionService - Basic Functionality', () => {
    test('should initialize correctly', () => {
      expect(metricsService).toBeDefined();
      expect(metricsService.metrics).toBeDefined();
      expect(metricsService.metrics.processing).toBeInstanceOf(Map);
    });

    test('should record custom metrics', () => {
      metricsService.recordMetric('test', 'cpu_usage', 75.5, { unit: 'percent' });
      
      const metrics = metricsService.getMetrics('test');
      expect(metrics.has('cpu_usage')).toBe(true);
      
      const cpuMetric = metrics.get('cpu_usage');
      expect(cpuMetric.value).toBe(75.5);
      expect(cpuMetric.metadata.unit).toBe('percent');
      expect(cpuMetric.timestamp).toBeDefined();
    });

    test('should handle different metric categories', () => {
      metricsService.recordMetric('performance', 'response_time', 150);
      metricsService.recordMetric('costs', 'daily_spend', 25.50);
      metricsService.recordMetric('errors', 'error_count', 3);
      
      expect(metricsService.getMetrics('performance').size).toBe(1);
      expect(metricsService.getMetrics('costs').size).toBe(1);
      expect(metricsService.getMetrics('errors').size).toBe(1);
    });

    test('should determine system status correctly', () => {
      // Healthy system
      expect(metricsService.determineSystemStatus(2, 100, 60)).toBe('healthy');
      
      // Warning conditions
      expect(metricsService.determineSystemStatus(7, 600, 150)).toBe('warning');
      
      // Critical conditions
      expect(metricsService.determineSystemStatus(15, 1200, 400)).toBe('critical');
    });

    test('should get correct time filters', () => {
      const now = new Date();
      
      const oneHourAgo = metricsService.getTimeFilter('1h');
      const oneDayAgo = metricsService.getTimeFilter('24h');
      
      expect(oneHourAgo).toBeInstanceOf(Date);
      expect(oneDayAgo).toBeInstanceOf(Date);
      expect(oneHourAgo.getTime()).toBeGreaterThan(oneDayAgo.getTime());
    });

    test('should clear old metrics', () => {
      // Add some metrics
      metricsService.recordMetric('test', 'metric1', 100);
      metricsService.recordMetric('test', 'metric2', 200);
      
      // Manually set one to be old
      const metrics = metricsService.getMetrics('test');
      const oldMetric = metrics.get('metric1');
      oldMetric.timestamp = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2 hours ago
      
      // Clear metrics older than 1 hour
      metricsService.clearOldMetrics(60 * 60 * 1000);
      
      expect(metrics.has('metric1')).toBe(false);
      expect(metrics.has('metric2')).toBe(true);
    });
  });

  describe('AlertingService - Basic Functionality', () => {
    test('should initialize with default thresholds', () => {
      expect(alertingService).toBeDefined();
      expect(alertingService.alertThresholds).toBeDefined();
      expect(alertingService.alertThresholds.error_rate.warning).toBe(5);
      expect(alertingService.alertThresholds.error_rate.critical).toBe(10);
    });

    test('should create alerts correctly', () => {
      const alert = alertingService.createAlert('test_alert', 'warning', 'Test message', { value: 100 });
      
      expect(alert).toMatchObject({
        type: 'test_alert',
        severity: 'warning',
        message: 'Test message',
        data: { value: 100 },
        status: 'active'
      });
      expect(alert.id).toBeDefined();
      expect(alert.timestamp).toBeDefined();
    });

    test('should update thresholds correctly', () => {
      const newThresholds = {
        error_rate: {
          warning: 3,
          critical: 8
        },
        custom_metric: {
          warning: 50,
          critical: 100
        }
      };
      
      alertingService.updateThresholds(newThresholds);
      
      const thresholds = alertingService.getThresholds();
      expect(thresholds.error_rate.warning).toBe(3);
      expect(thresholds.error_rate.critical).toBe(8);
      expect(thresholds.custom_metric.warning).toBe(50);
      expect(thresholds.queue_backlog.warning).toBe(500); // Should preserve existing
    });

    test('should manage active alerts', async () => {
      const alert1 = alertingService.createAlert('alert1', 'warning', 'First alert', {});
      const alert2 = alertingService.createAlert('alert2', 'critical', 'Second alert', {});
      
      await alertingService.processAlert(alert1);
      await alertingService.processAlert(alert2);
      
      const activeAlerts = alertingService.getActiveAlerts();
      expect(activeAlerts).toHaveLength(2);
      expect(activeAlerts.find(a => a.type === 'alert1')).toBeDefined();
      expect(activeAlerts.find(a => a.type === 'alert2')).toBeDefined();
    });

    test('should maintain alert history', async () => {
      const alert = alertingService.createAlert('history_test', 'warning', 'History test', {});
      await alertingService.processAlert(alert);
      
      const history = alertingService.getAlertHistory();
      expect(history).toHaveLength(1);
      expect(history[0].type).toBe('history_test');
    });

    test('should not duplicate alerts of same type and severity', async () => {
      const alert1 = alertingService.createAlert('duplicate_test', 'warning', 'First alert', {});
      const alert2 = alertingService.createAlert('duplicate_test', 'warning', 'Second alert', {});
      
      await alertingService.processAlert(alert1);
      await alertingService.processAlert(alert2);
      
      const activeAlerts = alertingService.getActiveAlerts();
      expect(activeAlerts).toHaveLength(1);
      expect(activeAlerts[0].lastSeen).toBeDefined();
    });

    test('should clear old alert history', () => {
      // Add some alerts to history
      alertingService.alertHistory.push(
        {
          id: 'old1',
          timestamp: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(), // 8 days ago
          type: 'old_alert'
        },
        {
          id: 'recent1',
          timestamp: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(), // 1 hour ago
          type: 'recent_alert'
        }
      );
      
      // Clear alerts older than 7 days
      alertingService.clearOldAlerts(7 * 24 * 60 * 60 * 1000);
      
      expect(alertingService.alertHistory).toHaveLength(1);
      expect(alertingService.alertHistory[0].type).toBe('recent_alert');
    });
  });

  describe('Integration - Metrics and Alerts', () => {
    test('should work together for monitoring workflow', () => {
      // Record some metrics that might trigger alerts
      metricsService.recordMetric('system', 'error_rate', 12); // Above critical threshold
      metricsService.recordMetric('system', 'queue_size', 600); // Above warning threshold
      
      // Get the metrics
      const systemMetrics = metricsService.getMetrics('system');
      expect(systemMetrics.get('error_rate').value).toBe(12);
      expect(systemMetrics.get('queue_size').value).toBe(600);
      
      // These would normally trigger alerts in the full system
      expect(12).toBeGreaterThan(alertingService.alertThresholds.error_rate.critical);
      expect(600).toBeGreaterThan(alertingService.alertThresholds.queue_backlog.warning);
    });

    test('should handle edge cases gracefully', () => {
      // Test with undefined/null values
      expect(() => metricsService.recordMetric('test', 'null_test', null)).not.toThrow();
      expect(() => metricsService.recordMetric('test', 'undefined_test', undefined)).not.toThrow();
      
      // Test with empty category
      expect(() => metricsService.getMetrics('nonexistent')).not.toThrow();
      expect(metricsService.getMetrics('nonexistent')).toBeInstanceOf(Map);
      
      // Test alert creation with minimal data
      const minimalAlert = alertingService.createAlert('minimal', 'info', '');
      expect(minimalAlert.type).toBe('minimal');
      expect(minimalAlert.severity).toBe('info');
    });
  });

  describe('Performance and Scalability', () => {
    test('should handle large numbers of metrics efficiently', () => {
      const startTime = Date.now();
      
      // Record 1000 metrics
      for (let i = 0; i < 1000; i++) {
        metricsService.recordMetric('performance_test', `metric_${i}`, Math.random() * 100);
      }
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Should complete within reasonable time (adjust threshold as needed)
      expect(duration).toBeLessThan(1000); // 1 second
      
      const metrics = metricsService.getMetrics('performance_test');
      expect(metrics.size).toBe(1000);
    });

    test('should handle rapid alert processing', async () => {
      const startTime = Date.now();
      
      // Process 100 alerts rapidly
      const promises = [];
      for (let i = 0; i < 100; i++) {
        const alert = alertingService.createAlert(`rapid_${i}`, 'info', `Alert ${i}`, {});
        promises.push(alertingService.processAlert(alert));
      }
      
      await Promise.all(promises);
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Should complete within reasonable time
      expect(duration).toBeLessThan(2000); // 2 seconds
      expect(alertingService.getAlertHistory()).toHaveLength(100);
    });
  });
});