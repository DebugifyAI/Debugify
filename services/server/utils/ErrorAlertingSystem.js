const { ErrorClassification } = require('./ErrorClassification');

/**
 * Error Alerting System
 * Handles notifications and alerts for critical failures and system issues
 */
class ErrorAlertingSystem {
  constructor(options = {}) {
    this.config = {
      // Alert thresholds
      criticalErrorThreshold: 1, // Alert immediately for critical errors
      highErrorThreshold: 3, // Alert after 3 high severity errors in window
      mediumErrorThreshold: 10, // Alert after 10 medium severity errors in window
      errorRateThreshold: 0.1, // Alert if error rate exceeds 10%
      
      // Time windows (in milliseconds)
      alertWindow: 300000, // 5 minutes
      rateLimitWindow: 60000, // 1 minute for rate limiting alerts
      
      // Alert channels
      enableConsoleAlerts: true,
      enableEmailAlerts: process.env.ENABLE_EMAIL_ALERTS === 'true',
      enableSlackAlerts: process.env.ENABLE_SLACK_ALERTS === 'true',
      enableWebhookAlerts: process.env.ENABLE_WEBHOOK_ALERTS === 'true',
      
      // Rate limiting
      maxAlertsPerMinute: 5,
      
      ...options,
    };

    // Alert tracking
    this.alertHistory = new Map();
    this.errorCounts = new Map();
    this.lastAlertTimes = new Map();
    
    // Initialize alert channels
    this.initializeAlertChannels();
  }

  /**
   * Initialize alert channels based on configuration
   */
  initializeAlertChannels() {
    this.alertChannels = [];

    if (this.config.enableConsoleAlerts) {
      this.alertChannels.push(this.createConsoleChannel());
    }

    if (this.config.enableEmailAlerts) {
      this.alertChannels.push(this.createEmailChannel());
    }

    if (this.config.enableSlackAlerts) {
      this.alertChannels.push(this.createSlackChannel());
    }

    if (this.config.enableWebhookAlerts) {
      this.alertChannels.push(this.createWebhookChannel());
    }

    console.log(`🚨 Initialized ${this.alertChannels.length} alert channels`);
  }

  /**
   * Process an error and determine if alerting is needed
   * @param {Error} error - Error to process
   * @param {Object} context - Error context
   * @returns {Promise<Object>} Alert result
   */
  async processError(error, context = {}) {
    try {
      // Classify the error
      const classification = ErrorClassification.classifyError(error, context);
      
      // Track error occurrence
      this.trackError(classification, context);
      
      // Determine if alert is needed
      const shouldAlert = this.shouldSendAlert(classification, context);
      
      if (shouldAlert.alert) {
        const alertResult = await this.sendAlert({
          error,
          classification,
          context,
          reason: shouldAlert.reason,
          severity: shouldAlert.severity,
        });

        return {
          alerted: true,
          classification,
          alertResult,
          reason: shouldAlert.reason,
        };
      }

      return {
        alerted: false,
        classification,
        reason: shouldAlert.reason,
      };

    } catch (alertError) {
      console.error('❌ Error in alerting system:', alertError);
      
      // Fallback alert for alerting system failure
      await this.sendFallbackAlert(error, alertError);
      
      return {
        alerted: false,
        error: alertError.message,
      };
    }
  }

  /**
   * Track error occurrence for pattern analysis
   * @param {Object} classification - Error classification
   * @param {Object} context - Error context
   */
  trackError(classification, context) {
    const now = Date.now();
    const category = classification.category;
    const severity = classification.classification.severity;
    
    // Initialize tracking for this category if needed
    if (!this.errorCounts.has(category)) {
      this.errorCounts.set(category, {
        total: 0,
        bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
        recentErrors: [],
        firstSeen: now,
        lastSeen: now,
      });
    }

    const categoryStats = this.errorCounts.get(category);
    
    // Update counts
    categoryStats.total++;
    categoryStats.bySeverity[severity]++;
    categoryStats.lastSeen = now;
    
    // Track recent errors (within alert window)
    categoryStats.recentErrors.push({
      timestamp: now,
      severity,
      context: {
        jobId: context.jobId,
        artifactId: context.artifactId,
        workerType: context.workerType,
      },
    });

    // Clean up old errors outside the window
    const windowStart = now - this.config.alertWindow;
    categoryStats.recentErrors = categoryStats.recentErrors.filter(
      err => err.timestamp > windowStart
    );

    this.errorCounts.set(category, categoryStats);
  }

  /**
   * Determine if an alert should be sent
   * @param {Object} classification - Error classification
   * @param {Object} context - Error context
   * @returns {Object} Alert decision
   */
  shouldSendAlert(classification, context) {
    const { category, classification: classInfo } = classification;
    const severity = classInfo.severity;
    
    // Always alert for critical errors
    if (severity === 'critical') {
      return {
        alert: true,
        reason: 'Critical error detected',
        severity: 'critical',
      };
    }

    // Check if alerting is required by classification
    if (classInfo.alertRequired) {
      return {
        alert: true,
        reason: 'Error classification requires alerting',
        severity: severity,
      };
    }

    // Check rate limiting
    if (this.isRateLimited(category)) {
      return {
        alert: false,
        reason: 'Rate limited - too many recent alerts for this category',
      };
    }

    // Check error count thresholds
    const categoryStats = this.errorCounts.get(category);
    if (categoryStats) {
      const recentCount = categoryStats.recentErrors.length;
      
      if (severity === 'high' && recentCount >= this.config.highErrorThreshold) {
        return {
          alert: true,
          reason: `High error threshold exceeded: ${recentCount} errors in ${this.config.alertWindow / 1000}s`,
          severity: 'high',
        };
      }
      
      if (severity === 'medium' && recentCount >= this.config.mediumErrorThreshold) {
        return {
          alert: true,
          reason: `Medium error threshold exceeded: ${recentCount} errors in ${this.config.alertWindow / 1000}s`,
          severity: 'medium',
        };
      }
    }

    // Check error rate (if we have success metrics)
    const errorRate = this.calculateErrorRate(category);
    if (errorRate > this.config.errorRateThreshold) {
      return {
        alert: true,
        reason: `Error rate threshold exceeded: ${(errorRate * 100).toFixed(1)}%`,
        severity: 'high',
      };
    }

    return {
      alert: false,
      reason: 'No alert thresholds exceeded',
    };
  }

  /**
   * Check if alerts for a category are rate limited
   * @param {string} category - Error category
   * @returns {boolean} True if rate limited
   */
  isRateLimited(category) {
    const now = Date.now();
    const lastAlertTime = this.lastAlertTimes.get(category);
    
    if (!lastAlertTime) {
      return false;
    }

    return (now - lastAlertTime) < this.config.rateLimitWindow;
  }

  /**
   * Calculate error rate for a category
   * @param {string} category - Error category
   * @returns {number} Error rate (0-1)
   */
  calculateErrorRate(category) {
    // This would be enhanced with actual success/failure metrics
    // For now, return a placeholder calculation
    const categoryStats = this.errorCounts.get(category);
    
    if (!categoryStats || categoryStats.recentErrors.length === 0) {
      return 0;
    }

    // Simplified calculation - in production this would use actual metrics
    const recentErrors = categoryStats.recentErrors.length;
    const estimatedTotal = recentErrors * 2; // Assume 50% error rate as threshold
    
    return recentErrors / estimatedTotal;
  }

  /**
   * Send alert through all configured channels
   * @param {Object} alertData - Alert data
   * @returns {Promise<Object>} Alert results
   */
  async sendAlert(alertData) {
    const { error, classification, context, reason, severity } = alertData;
    
    console.log(`🚨 Sending ${severity} alert: ${reason}`);
    
    // Update rate limiting
    this.lastAlertTimes.set(classification.category, Date.now());
    
    // Create alert message
    const alertMessage = this.createAlertMessage(alertData);
    
    // Send through all channels
    const channelResults = await Promise.allSettled(
      this.alertChannels.map(channel => 
        channel.send(alertMessage, severity)
      )
    );

    // Track alert
    this.trackAlert(alertData, channelResults);

    return {
      message: alertMessage,
      channels: channelResults.map((result, index) => ({
        channel: this.alertChannels[index].name,
        success: result.status === 'fulfilled',
        error: result.status === 'rejected' ? result.reason : null,
      })),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Create alert message
   * @param {Object} alertData - Alert data
   * @returns {Object} Alert message
   */
  createAlertMessage(alertData) {
    const { error, classification, context, reason, severity } = alertData;
    
    return {
      title: `🚨 ${severity.toUpperCase()} Error Alert`,
      summary: reason,
      details: {
        error: {
          message: error.message,
          name: error.name,
          category: classification.category,
        },
        context: {
          jobId: context.jobId,
          artifactId: context.artifactId,
          workerType: context.workerType,
          timestamp: context.timestamp || new Date().toISOString(),
        },
        classification: {
          category: classification.category,
          severity: classification.classification.severity,
          retryable: classification.classification.retryable,
        },
        system: {
          environment: process.env.NODE_ENV || 'development',
          service: 'file-processing-pipeline',
          version: process.env.APP_VERSION || '1.0.0',
        },
      },
      timestamp: new Date().toISOString(),
      alertId: this.generateAlertId(),
    };
  }

  /**
   * Track sent alert
   * @param {Object} alertData - Alert data
   * @param {Array} channelResults - Channel results
   */
  trackAlert(alertData, channelResults) {
    const alertId = this.generateAlertId();
    
    this.alertHistory.set(alertId, {
      ...alertData,
      channelResults,
      sentAt: new Date().toISOString(),
    });

    // Keep only recent alerts (last 1000)
    if (this.alertHistory.size > 1000) {
      const oldestKey = this.alertHistory.keys().next().value;
      this.alertHistory.delete(oldestKey);
    }
  }

  /**
   * Generate unique alert ID
   * @returns {string} Alert ID
   */
  generateAlertId() {
    return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Send fallback alert when alerting system fails
   * @param {Error} originalError - Original error
   * @param {Error} alertError - Alerting system error
   */
  async sendFallbackAlert(originalError, alertError) {
    try {
      console.error('🚨 CRITICAL: Alerting system failure!', {
        originalError: originalError.message,
        alertingError: alertError.message,
        timestamp: new Date().toISOString(),
      });

      // Try to send a simple console alert at minimum
      console.error('🚨 FALLBACK ALERT:', {
        message: 'Both primary error and alerting system failed',
        originalError: originalError.message,
        alertingError: alertError.message,
      });

    } catch (fallbackError) {
      // Last resort - just log to console
      console.error('🚨 TOTAL ALERTING FAILURE:', fallbackError);
    }
  }

  /**
   * Create console alert channel
   * @returns {Object} Console channel
   */
  createConsoleChannel() {
    return {
      name: 'console',
      async send(message, severity) {
        const emoji = {
          critical: '🔥',
          high: '🚨',
          medium: '⚠️',
          low: 'ℹ️',
        }[severity] || '📢';

        console.error(`${emoji} ALERT [${severity.toUpperCase()}]: ${message.title}`);
        console.error('Summary:', message.summary);
        console.error('Details:', JSON.stringify(message.details, null, 2));
        
        return { success: true };
      },
    };
  }

  /**
   * Create email alert channel
   * @returns {Object} Email channel
   */
  createEmailChannel() {
    return {
      name: 'email',
      async send(message, severity) {
        // This would integrate with an email service like SendGrid, SES, etc.
        console.log(`📧 Would send email alert: ${message.title}`);
        
        // Placeholder implementation
        return { success: true, placeholder: true };
      },
    };
  }

  /**
   * Create Slack alert channel
   * @returns {Object} Slack channel
   */
  createSlackChannel() {
    return {
      name: 'slack',
      async send(message, severity) {
        // This would integrate with Slack webhook or API
        console.log(`💬 Would send Slack alert: ${message.title}`);
        
        // Placeholder implementation
        return { success: true, placeholder: true };
      },
    };
  }

  /**
   * Create webhook alert channel
   * @returns {Object} Webhook channel
   */
  createWebhookChannel() {
    return {
      name: 'webhook',
      async send(message, severity) {
        // This would send HTTP POST to configured webhook URL
        console.log(`🔗 Would send webhook alert: ${message.title}`);
        
        // Placeholder implementation
        return { success: true, placeholder: true };
      },
    };
  }

  /**
   * Get alerting statistics
   * @returns {Object} Statistics
   */
  getStatistics() {
    const now = Date.now();
    const windowStart = now - this.config.alertWindow;
    
    // Calculate recent alerts
    const recentAlerts = Array.from(this.alertHistory.values())
      .filter(alert => new Date(alert.sentAt).getTime() > windowStart);

    // Calculate error statistics
    const errorStats = {};
    for (const [category, stats] of this.errorCounts.entries()) {
      errorStats[category] = {
        total: stats.total,
        recent: stats.recentErrors.length,
        bySeverity: stats.bySeverity,
        firstSeen: new Date(stats.firstSeen).toISOString(),
        lastSeen: new Date(stats.lastSeen).toISOString(),
      };
    }

    return {
      alerts: {
        total: this.alertHistory.size,
        recent: recentAlerts.length,
        byChannel: this.alertChannels.map(channel => ({
          name: channel.name,
          enabled: true,
        })),
      },
      errors: errorStats,
      config: {
        alertWindow: this.config.alertWindow,
        thresholds: {
          critical: this.config.criticalErrorThreshold,
          high: this.config.highErrorThreshold,
          medium: this.config.mediumErrorThreshold,
          errorRate: this.config.errorRateThreshold,
        },
      },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get recent alerts
   * @param {number} limit - Maximum number of alerts to return
   * @returns {Array} Recent alerts
   */
  getRecentAlerts(limit = 10) {
    return Array.from(this.alertHistory.values())
      .sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime())
      .slice(0, limit)
      .map(alert => ({
        alertId: alert.alertId,
        severity: alert.severity,
        reason: alert.reason,
        category: alert.classification.category,
        sentAt: alert.sentAt,
        channels: alert.channelResults?.map(result => ({
          channel: result.channel,
          success: result.success,
        })),
      }));
  }

  /**
   * Test alert system
   * @param {string} severity - Test severity level
   * @returns {Promise<Object>} Test result
   */
  async testAlerts(severity = 'medium') {
    console.log(`🧪 Testing alert system with ${severity} severity`);
    
    const testError = ErrorClassification.createError(
      'SYSTEM',
      'Test alert from error alerting system',
      { test: true }
    );

    return this.processError(testError, {
      test: true,
      severity,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Clear alert history and error counts
   */
  clearHistory() {
    this.alertHistory.clear();
    this.errorCounts.clear();
    this.lastAlertTimes.clear();
    
    console.log('🧹 Cleared alert history and error counts');
  }
}

module.exports = ErrorAlertingSystem;