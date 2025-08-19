const { MetricsCollectionService } = require('./MetricsCollectionService');

class AlertingService {
  constructor() {
    this.metricsService = new MetricsCollectionService();
    this.alertThresholds = {
      error_rate: {
        warning: 5, // 5%
        critical: 10 // 10%
      },
      queue_backlog: {
        warning: 500,
        critical: 1000
      },
      processing_time: {
        warning: 120, // 2 minutes
        critical: 300 // 5 minutes
      },
      storage_usage: {
        warning: 80, // 80% of quota
        critical: 95 // 95% of quota
      },
      cost_threshold: {
        warning: 100, // $100 daily
        critical: 200 // $200 daily
      }
    };
    
    this.activeAlerts = new Map();
    this.alertHistory = [];
    this.notificationChannels = [];
  }

  // Add notification channel (email, webhook, etc.)
  addNotificationChannel(channel) {
    this.notificationChannels.push(channel);
  }

  // Check all alert conditions
  async checkAlerts() {
    const healthMetrics = await this.metricsService.getSystemHealthMetrics();
    const costMetrics = await this.metricsService.collectCostMetrics('24h');
    
    const alerts = [];

    // Check error rate
    if (healthMetrics.error_rate >= this.alertThresholds.error_rate.critical) {
      alerts.push(this.createAlert('error_rate', 'critical', 
        `Error rate is ${healthMetrics.error_rate.toFixed(2)}%`, healthMetrics));
    } else if (healthMetrics.error_rate >= this.alertThresholds.error_rate.warning) {
      alerts.push(this.createAlert('error_rate', 'warning', 
        `Error rate is ${healthMetrics.error_rate.toFixed(2)}%`, healthMetrics));
    }

    // Check queue backlog
    if (healthMetrics.queue_backlog >= this.alertThresholds.queue_backlog.critical) {
      alerts.push(this.createAlert('queue_backlog', 'critical', 
        `Queue backlog is ${healthMetrics.queue_backlog} jobs`, healthMetrics));
    } else if (healthMetrics.queue_backlog >= this.alertThresholds.queue_backlog.warning) {
      alerts.push(this.createAlert('queue_backlog', 'warning', 
        `Queue backlog is ${healthMetrics.queue_backlog} jobs`, healthMetrics));
    }

    // Check processing time
    if (healthMetrics.avg_processing_time >= this.alertThresholds.processing_time.critical) {
      alerts.push(this.createAlert('processing_time', 'critical', 
        `Average processing time is ${healthMetrics.avg_processing_time.toFixed(2)} seconds`, healthMetrics));
    } else if (healthMetrics.avg_processing_time >= this.alertThresholds.processing_time.warning) {
      alerts.push(this.createAlert('processing_time', 'warning', 
        `Average processing time is ${healthMetrics.avg_processing_time.toFixed(2)} seconds`, healthMetrics));
    }

    // Check daily costs
    if (costMetrics.total_estimated_cost >= this.alertThresholds.cost_threshold.critical) {
      alerts.push(this.createAlert('cost_threshold', 'critical', 
        `Daily cost estimate is $${costMetrics.total_estimated_cost.toFixed(2)}`, costMetrics));
    } else if (costMetrics.total_estimated_cost >= this.alertThresholds.cost_threshold.warning) {
      alerts.push(this.createAlert('cost_threshold', 'warning', 
        `Daily cost estimate is $${costMetrics.total_estimated_cost.toFixed(2)}`, costMetrics));
    }

    // Process new alerts
    for (const alert of alerts) {
      await this.processAlert(alert);
    }

    // Check for resolved alerts
    await this.checkResolvedAlerts();

    return alerts;
  }

  // Create alert object
  createAlert(type, severity, message, data) {
    return {
      id: `${type}_${Date.now()}`,
      type,
      severity,
      message,
      data,
      timestamp: new Date().toISOString(),
      status: 'active'
    };
  }

  // Process a new alert
  async processAlert(alert) {
    const existingAlert = this.activeAlerts.get(alert.type);
    
    // If alert already exists and severity hasn't changed, don't spam
    if (existingAlert && existingAlert.severity === alert.severity) {
      existingAlert.lastSeen = alert.timestamp;
      return;
    }

    // Store the alert
    this.activeAlerts.set(alert.type, alert);
    this.alertHistory.push(alert);

    // Send notifications
    await this.sendNotifications(alert);

    console.log(`[ALERT] ${alert.severity.toUpperCase()}: ${alert.message}`);
  }

  // Check for resolved alerts
  async checkResolvedAlerts() {
    const healthMetrics = await this.metricsService.getSystemHealthMetrics();
    const resolvedAlerts = [];

    for (const [type, alert] of this.activeAlerts.entries()) {
      let isResolved = false;

      switch (type) {
        case 'error_rate':
          isResolved = healthMetrics.error_rate < this.alertThresholds.error_rate.warning;
          break;
        case 'queue_backlog':
          isResolved = healthMetrics.queue_backlog < this.alertThresholds.queue_backlog.warning;
          break;
        case 'processing_time':
          isResolved = healthMetrics.avg_processing_time < this.alertThresholds.processing_time.warning;
          break;
      }

      if (isResolved) {
        alert.status = 'resolved';
        alert.resolvedAt = new Date().toISOString();
        resolvedAlerts.push(alert);
        this.activeAlerts.delete(type);
        
        console.log(`[RESOLVED] Alert ${type} has been resolved`);
      }
    }

    return resolvedAlerts;
  }

  // Send notifications through configured channels
  async sendNotifications(alert) {
    for (const channel of this.notificationChannels) {
      try {
        await channel.send(alert);
      } catch (error) {
        console.error(`Failed to send alert through channel ${channel.name}:`, error);
      }
    }
  }

  // Get current active alerts
  getActiveAlerts() {
    return Array.from(this.activeAlerts.values());
  }

  // Get alert history
  getAlertHistory(limit = 100) {
    return this.alertHistory
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);
  }

  // Update alert thresholds
  updateThresholds(newThresholds) {
    this.alertThresholds = { ...this.alertThresholds, ...newThresholds };
  }

  // Get current thresholds
  getThresholds() {
    return this.alertThresholds;
  }

  // Clear old alert history
  clearOldAlerts(maxAge = 7 * 24 * 60 * 60 * 1000) { // 7 days default
    const cutoff = new Date(Date.now() - maxAge);
    this.alertHistory = this.alertHistory.filter(
      alert => new Date(alert.timestamp) >= cutoff
    );
  }
}

// Notification channel implementations
class EmailNotificationChannel {
  constructor(config) {
    this.name = 'email';
    this.config = config;
  }

  async send(alert) {
    // Implementation would integrate with email service (SendGrid, SES, etc.)
    console.log(`[EMAIL] Sending alert: ${alert.message}`);
    // Placeholder for actual email sending logic
  }
}

class WebhookNotificationChannel {
  constructor(config) {
    this.name = 'webhook';
    this.config = config;
  }

  async send(alert) {
    // Implementation would send HTTP POST to webhook URL
    console.log(`[WEBHOOK] Sending alert to ${this.config.url}: ${alert.message}`);
    // Placeholder for actual webhook sending logic
  }
}

class SlackNotificationChannel {
  constructor(config) {
    this.name = 'slack';
    this.config = config;
  }

  async send(alert) {
    // Implementation would integrate with Slack API
    console.log(`[SLACK] Sending alert: ${alert.message}`);
    // Placeholder for actual Slack integration
  }
}

module.exports = { 
  AlertingService, 
  EmailNotificationChannel, 
  WebhookNotificationChannel, 
  SlackNotificationChannel 
};