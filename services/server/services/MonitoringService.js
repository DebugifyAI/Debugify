const { MetricsCollectionService } = require('./MetricsCollectionService');
const { AlertingService, EmailNotificationChannel, WebhookNotificationChannel } = require('./AlertingService');

class MonitoringService {
  constructor(config = {}) {
    this.metricsService = new MetricsCollectionService();
    this.alertingService = new AlertingService();
    
    this.config = {
      alertCheckInterval: config.alertCheckInterval || 60000, // 1 minute
      metricsCleanupInterval: config.metricsCleanupInterval || 24 * 60 * 60 * 1000, // 24 hours
      alertHistoryCleanupInterval: config.alertHistoryCleanupInterval || 7 * 24 * 60 * 60 * 1000, // 7 days
      ...config
    };
    
    this.intervals = [];
    this.isRunning = false;
    
    this.setupNotificationChannels();
  }

  // Setup notification channels based on configuration
  setupNotificationChannels() {
    if (process.env.ALERT_EMAIL_ENABLED === 'true') {
      const emailChannel = new EmailNotificationChannel({
        to: process.env.ALERT_EMAIL_TO,
        from: process.env.ALERT_EMAIL_FROM,
        service: process.env.EMAIL_SERVICE || 'sendgrid',
        apiKey: process.env.EMAIL_API_KEY
      });
      this.alertingService.addNotificationChannel(emailChannel);
    }

    if (process.env.ALERT_WEBHOOK_ENABLED === 'true') {
      const webhookChannel = new WebhookNotificationChannel({
        url: process.env.ALERT_WEBHOOK_URL,
        headers: {
          'Authorization': process.env.ALERT_WEBHOOK_AUTH,
          'Content-Type': 'application/json'
        }
      });
      this.alertingService.addNotificationChannel(webhookChannel);
    }

    // Add Slack channel if configured
    if (process.env.ALERT_SLACK_ENABLED === 'true') {
      const SlackNotificationChannel = require('./AlertingService').SlackNotificationChannel;
      const slackChannel = new SlackNotificationChannel({
        webhookUrl: process.env.SLACK_WEBHOOK_URL,
        channel: process.env.SLACK_CHANNEL || '#alerts',
        username: process.env.SLACK_USERNAME || 'MonitoringBot'
      });
      this.alertingService.addNotificationChannel(slackChannel);
    }
  }

  // Start the monitoring service
  start() {
    if (this.isRunning) {
      console.log('Monitoring service is already running');
      return;
    }

    console.log('Starting monitoring service...');
    this.isRunning = true;

    // Start alert checking
    const alertInterval = setInterval(async () => {
      try {
        await this.checkAlerts();
      } catch (error) {
        console.error('Error during alert check:', error);
      }
    }, this.config.alertCheckInterval);

    // Start metrics cleanup
    const metricsCleanupInterval = setInterval(() => {
      try {
        this.metricsService.clearOldMetrics(this.config.metricsCleanupInterval);
        console.log('Cleaned up old metrics');
      } catch (error) {
        console.error('Error during metrics cleanup:', error);
      }
    }, this.config.metricsCleanupInterval);

    // Start alert history cleanup
    const alertCleanupInterval = setInterval(() => {
      try {
        this.alertingService.clearOldAlerts(this.config.alertHistoryCleanupInterval);
        console.log('Cleaned up old alert history');
      } catch (error) {
        console.error('Error during alert history cleanup:', error);
      }
    }, this.config.alertHistoryCleanupInterval);

    // Store intervals for cleanup
    this.intervals = [alertInterval, metricsCleanupInterval, alertCleanupInterval];

    console.log('Monitoring service started successfully');
    console.log(`- Alert checks every ${this.config.alertCheckInterval / 1000} seconds`);
    console.log(`- Metrics cleanup every ${this.config.metricsCleanupInterval / (60 * 60 * 1000)} hours`);
    console.log(`- Alert history cleanup every ${this.config.alertHistoryCleanupInterval / (24 * 60 * 60 * 1000)} days`);
  }

  // Stop the monitoring service
  stop() {
    if (!this.isRunning) {
      console.log('Monitoring service is not running');
      return;
    }

    console.log('Stopping monitoring service...');
    
    // Clear all intervals
    this.intervals.forEach(interval => clearInterval(interval));
    this.intervals = [];
    
    this.isRunning = false;
    console.log('Monitoring service stopped');
  }

  // Check alerts and process them
  async checkAlerts() {
    try {
      const alerts = await this.alertingService.checkAlerts();
      
      if (alerts.length > 0) {
        console.log(`Processed ${alerts.length} new alerts`);
        
        // Record alert metrics
        this.metricsService.recordMetric('alerts', 'new_alerts_count', alerts.length);
        
        // Count alerts by severity
        const severityCounts = alerts.reduce((counts, alert) => {
          counts[alert.severity] = (counts[alert.severity] || 0) + 1;
          return counts;
        }, {});
        
        Object.entries(severityCounts).forEach(([severity, count]) => {
          this.metricsService.recordMetric('alerts', `${severity}_alerts`, count);
        });
      }
      
      return alerts;
    } catch (error) {
      console.error('Error checking alerts:', error);
      
      // Record the error as a metric
      this.metricsService.recordMetric('monitoring', 'alert_check_errors', 1, {
        error: error.message,
        timestamp: new Date().toISOString()
      });
      
      throw error;
    }
  }

  // Get monitoring service status
  getStatus() {
    return {
      isRunning: this.isRunning,
      config: this.config,
      activeAlerts: this.alertingService.getActiveAlerts().length,
      notificationChannels: this.alertingService.notificationChannels.length,
      uptime: this.isRunning ? Date.now() - this.startTime : 0,
      lastAlertCheck: this.lastAlertCheck,
      intervals: this.intervals.length
    };
  }

  // Record custom application metrics
  recordApplicationMetric(category, key, value, metadata = {}) {
    this.metricsService.recordMetric(category, key, value, {
      ...metadata,
      source: 'application',
      recordedAt: new Date().toISOString()
    });
  }

  // Get metrics for external consumption
  getMetrics(category) {
    return this.metricsService.getMetrics(category);
  }

  // Get system health summary
  async getHealthSummary() {
    try {
      const systemHealth = await this.metricsService.getSystemHealthMetrics();
      const activeAlerts = this.alertingService.getActiveAlerts();
      const alertHistory = this.alertingService.getAlertHistory(10); // Last 10 alerts
      
      return {
        systemHealth,
        activeAlerts: activeAlerts.length,
        criticalAlerts: activeAlerts.filter(a => a.severity === 'critical').length,
        warningAlerts: activeAlerts.filter(a => a.severity === 'warning').length,
        recentAlerts: alertHistory,
        monitoringServiceStatus: this.getStatus(),
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error getting health summary:', error);
      return {
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  // Update alert thresholds
  updateAlertThresholds(thresholds) {
    this.alertingService.updateThresholds(thresholds);
    console.log('Alert thresholds updated:', thresholds);
  }

  // Force an immediate alert check
  async forceAlertCheck() {
    console.log('Forcing immediate alert check...');
    return await this.checkAlerts();
  }

  // Get performance metrics for the monitoring service itself
  getMonitoringPerformance() {
    const alertMetrics = this.metricsService.getMetrics('alerts');
    const monitoringMetrics = this.metricsService.getMetrics('monitoring');
    
    return {
      alertsProcessed: Array.from(alertMetrics.entries()),
      monitoringErrors: Array.from(monitoringMetrics.entries()),
      serviceStatus: this.getStatus()
    };
  }

  // Graceful shutdown
  async shutdown() {
    console.log('Shutting down monitoring service gracefully...');
    
    try {
      // Perform final alert check
      await this.checkAlerts();
      
      // Clean up old data
      this.metricsService.clearOldMetrics(this.config.metricsCleanupInterval);
      this.alertingService.clearOldAlerts(this.config.alertHistoryCleanupInterval);
      
      // Stop the service
      this.stop();
      
      console.log('Monitoring service shutdown complete');
    } catch (error) {
      console.error('Error during monitoring service shutdown:', error);
      this.stop(); // Force stop even if there's an error
    }
  }
}

// Singleton instance for global use
let monitoringServiceInstance = null;

function getMonitoringService(config) {
  if (!monitoringServiceInstance) {
    monitoringServiceInstance = new MonitoringService(config);
  }
  return monitoringServiceInstance;
}

// Graceful shutdown handling
process.on('SIGTERM', async () => {
  if (monitoringServiceInstance) {
    await monitoringServiceInstance.shutdown();
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  if (monitoringServiceInstance) {
    await monitoringServiceInstance.shutdown();
  }
  process.exit(0);
});

module.exports = { MonitoringService, getMonitoringService };