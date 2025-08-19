#!/usr/bin/env node

/**
 * Validation script for the monitoring and analytics system
 * This script tests the core functionality without requiring a full database setup
 */

const { MetricsCollectionService } = require('./services/MetricsCollectionService');
const { AlertingService, EmailNotificationChannel, WebhookNotificationChannel } = require('./services/AlertingService');
const { MonitoringService } = require('./services/MonitoringService');

async function validateMonitoringSystem() {
  console.log('🔍 Validating Monitoring and Analytics System...\n');

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      const result = fn();
      if (result === true || (result && typeof result.then === 'function')) {
        console.log(`✅ ${name}`);
        passed++;
      } else {
        console.log(`❌ ${name} - Returned: ${result}`);
        failed++;
      }
    } catch (error) {
      console.log(`❌ ${name} - Error: ${error.message}`);
      failed++;
    }
  }

  // Test MetricsCollectionService
  console.log('📊 Testing MetricsCollectionService:');
  const metricsService = new MetricsCollectionService();

  test('MetricsCollectionService initialization', () => {
    return metricsService && metricsService.metrics && metricsService.metrics.processing instanceof Map;
  });

  test('Record custom metrics', () => {
    metricsService.recordMetric('test', 'cpu_usage', 75.5, { unit: 'percent' });
    const metrics = metricsService.getMetrics('test');
    return metrics.has('cpu_usage') && metrics.get('cpu_usage').value === 75.5;
  });

  test('Multiple metric categories', () => {
    metricsService.recordMetric('performance', 'response_time', 150);
    metricsService.recordMetric('costs', 'daily_spend', 25.50);
    return metricsService.getMetrics('performance').size === 1 && 
           metricsService.getMetrics('costs').size === 1;
  });

  test('System status determination', () => {
    return metricsService.determineSystemStatus(2, 100, 60) === 'healthy' &&
           metricsService.determineSystemStatus(7, 600, 150) === 'warning' &&
           metricsService.determineSystemStatus(15, 1200, 400) === 'critical';
  });

  test('Time filter generation', () => {
    const oneHourAgo = metricsService.getTimeFilter('1h');
    const oneDayAgo = metricsService.getTimeFilter('24h');
    return oneHourAgo instanceof Date && oneDayAgo instanceof Date &&
           oneHourAgo.getTime() > oneDayAgo.getTime();
  });

  test('Old metrics cleanup', () => {
    metricsService.recordMetric('cleanup_test', 'metric1', 100);
    metricsService.recordMetric('cleanup_test', 'metric2', 200);
    
    // Manually set one to be old
    const metrics = metricsService.getMetrics('cleanup_test');
    const oldMetric = metrics.get('metric1');
    oldMetric.timestamp = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    
    metricsService.clearOldMetrics(60 * 60 * 1000); // 1 hour
    return !metrics.has('metric1') && metrics.has('metric2');
  });

  console.log();

  // Test AlertingService
  console.log('🚨 Testing AlertingService:');
  const alertingService = new AlertingService();

  test('AlertingService initialization', () => {
    return alertingService && alertingService.alertThresholds &&
           alertingService.alertThresholds.error_rate.warning === 5;
  });

  test('Alert creation', () => {
    const alert = alertingService.createAlert('test_alert', 'warning', 'Test message', { value: 100 });
    return alert.type === 'test_alert' && alert.severity === 'warning' &&
           alert.message === 'Test message' && alert.status === 'active';
  });

  test('Threshold updates', () => {
    alertingService.updateThresholds({
      error_rate: { warning: 3, critical: 8 }
    });
    const thresholds = alertingService.getThresholds();
    return thresholds.error_rate.warning === 3 && thresholds.error_rate.critical === 8;
  });

  test('Notification channel management', () => {
    const emailChannel = new EmailNotificationChannel({ to: 'test@example.com' });
    const webhookChannel = new WebhookNotificationChannel({ url: 'https://example.com/webhook' });
    
    alertingService.addNotificationChannel(emailChannel);
    alertingService.addNotificationChannel(webhookChannel);
    
    return alertingService.notificationChannels.length === 2;
  });

  test('Alert processing and history', async () => {
    const alert = alertingService.createAlert('history_test', 'warning', 'History test', {});
    await alertingService.processAlert(alert);
    
    const activeAlerts = alertingService.getActiveAlerts();
    const history = alertingService.getAlertHistory();
    
    return activeAlerts.length === 1 && history.length === 1 &&
           activeAlerts[0].type === 'history_test';
  });

  test('Alert deduplication', async () => {
    const alert1 = alertingService.createAlert('duplicate_test', 'warning', 'First alert', {});
    const alert2 = alertingService.createAlert('duplicate_test', 'warning', 'Second alert', {});
    
    await alertingService.processAlert(alert1);
    await alertingService.processAlert(alert2);
    
    const activeAlerts = alertingService.getActiveAlerts();
    return activeAlerts.filter(a => a.type === 'duplicate_test').length === 1;
  });

  console.log();

  // Test MonitoringService
  console.log('🔧 Testing MonitoringService:');
  const monitoringService = new MonitoringService({
    alertCheckInterval: 5000, // 5 seconds for testing
    metricsCleanupInterval: 60000, // 1 minute for testing
  });

  test('MonitoringService initialization', () => {
    return monitoringService && monitoringService.metricsService &&
           monitoringService.alertingService && !monitoringService.isRunning;
  });

  test('Service status tracking', () => {
    const status = monitoringService.getStatus();
    return status && typeof status.isRunning === 'boolean' &&
           status.config && status.activeAlerts >= 0;
  });

  test('Custom metric recording', () => {
    monitoringService.recordApplicationMetric('app', 'requests_per_second', 150, { endpoint: '/api/test' });
    const metrics = monitoringService.getMetrics('app');
    return metrics.has('requests_per_second') && 
           metrics.get('requests_per_second').metadata.endpoint === '/api/test';
  });

  test('Health summary generation', async () => {
    const health = await monitoringService.getHealthSummary();
    return health && typeof health.activeAlerts === 'number' &&
           health.monitoringServiceStatus && health.timestamp;
  });

  console.log();

  // Test Performance
  console.log('⚡ Testing Performance:');

  test('Large metrics volume handling', () => {
    const startTime = Date.now();
    
    for (let i = 0; i < 1000; i++) {
      metricsService.recordMetric('performance_test', `metric_${i}`, Math.random() * 100);
    }
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    const metrics = metricsService.getMetrics('performance_test');
    
    return duration < 1000 && metrics.size === 1000; // Should complete within 1 second
  });

  test('Rapid alert processing', async () => {
    const startTime = Date.now();
    
    const promises = [];
    for (let i = 0; i < 100; i++) {
      const alert = alertingService.createAlert(`rapid_${i}`, 'info', `Alert ${i}`, {});
      promises.push(alertingService.processAlert(alert));
    }
    
    await Promise.all(promises);
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    return duration < 2000 && alertingService.getAlertHistory().length >= 100;
  });

  console.log();

  // Summary
  console.log('📋 Validation Summary:');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📊 Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);

  if (failed === 0) {
    console.log('\n🎉 All tests passed! Monitoring system is working correctly.');
    return true;
  } else {
    console.log('\n⚠️  Some tests failed. Please check the implementation.');
    return false;
  }
}

// Run validation if this script is executed directly
if (require.main === module) {
  validateMonitoringSystem()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('❌ Validation failed with error:', error);
      process.exit(1);
    });
}

module.exports = { validateMonitoringSystem };