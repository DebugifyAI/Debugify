const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

/**
 * Comprehensive audit logging middleware for file operations and security events
 */

class AuditLogger {
  constructor() {
    this.logDir = process.env.AUDIT_LOG_DIR || path.join(__dirname, '../logs/audit');
    this.maxLogSize = 100 * 1024 * 1024; // 100MB per log file
    this.maxLogFiles = 10; // Keep 10 log files
    this.initializeLogDirectory();
  }

  async initializeLogDirectory() {
    try {
      await fs.mkdir(this.logDir, { recursive: true });
    } catch (error) {
      console.error('Failed to create audit log directory:', error);
    }
  }

  /**
   * Main audit logging middleware
   */
  auditFileOperation = (operationType) => {
    return async (req, res, next) => {
      const startTime = Date.now();
      const requestId = this.generateRequestId();
      
      // Store audit info in request for later use
      req.auditInfo = {
        requestId,
        operationType,
        startTime,
        userId: req.user?.id,
        userEmail: req.user?.email,
        ipAddress: this.getClientIP(req),
        userAgent: req.get('User-Agent'),
        sessionId: req.sessionID,
      };

      // Log the start of the operation
      await this.logEvent({
        ...req.auditInfo,
        event: 'operation_start',
        details: {
          method: req.method,
          url: req.originalUrl,
          params: this.sanitizeParams(req.params),
          query: this.sanitizeParams(req.query),
          body: this.sanitizeBody(req.body, operationType),
        },
      });

      // Override res.json to capture response
      const originalJson = res.json;
      res.json = function(data) {
        req.auditInfo.responseData = data;
        req.auditInfo.statusCode = res.statusCode;
        req.auditInfo.duration = Date.now() - startTime;
        
        // Log the completion asynchronously
        setImmediate(() => {
          req.app.locals.auditLogger.logOperationComplete(req.auditInfo);
        });
        
        return originalJson.call(this, data);
      };

      // Handle errors
      const originalSend = res.send;
      res.send = function(data) {
        if (res.statusCode >= 400) {
          req.auditInfo.error = {
            statusCode: res.statusCode,
            message: typeof data === 'string' ? data : JSON.stringify(data),
          };
          req.auditInfo.duration = Date.now() - startTime;
          
          setImmediate(() => {
            req.app.locals.auditLogger.logOperationError(req.auditInfo);
          });
        }
        
        return originalSend.call(this, data);
      };

      next();
    };
  };

  /**
   * Log successful operation completion
   */
  async logOperationComplete(auditInfo) {
    await this.logEvent({
      ...auditInfo,
      event: 'operation_complete',
      details: {
        statusCode: auditInfo.statusCode,
        duration: auditInfo.duration,
        responseSize: JSON.stringify(auditInfo.responseData || {}).length,
        success: auditInfo.statusCode < 400,
      },
    });
  }

  /**
   * Log operation errors
   */
  async logOperationError(auditInfo) {
    await this.logEvent({
      ...auditInfo,
      event: 'operation_error',
      severity: 'error',
      details: {
        statusCode: auditInfo.statusCode,
        duration: auditInfo.duration,
        error: auditInfo.error,
      },
    });
  }

  /**
   * Log security events
   */
  async logSecurityEvent(eventType, details, req) {
    const auditInfo = {
      requestId: this.generateRequestId(),
      operationType: 'security',
      userId: req?.user?.id,
      userEmail: req?.user?.email,
      ipAddress: this.getClientIP(req),
      userAgent: req?.get('User-Agent'),
      sessionId: req?.sessionID,
      timestamp: new Date().toISOString(),
    };

    await this.logEvent({
      ...auditInfo,
      event: eventType,
      severity: this.getSecurityEventSeverity(eventType),
      details,
    });
  }

  /**
   * Log file access events
   */
  async logFileAccess(action, fileInfo, req) {
    await this.logEvent({
      requestId: req.auditInfo?.requestId || this.generateRequestId(),
      operationType: 'file_access',
      event: action,
      userId: req.user?.id,
      userEmail: req.user?.email,
      ipAddress: this.getClientIP(req),
      timestamp: new Date().toISOString(),
      details: {
        action,
        fileId: fileInfo.id,
        fileName: fileInfo.filename,
        fileSize: fileInfo.size,
        contentType: fileInfo.contentType,
        s3Key: fileInfo.s3Key,
        bugId: fileInfo.bugId,
      },
    });
  }

  /**
   * Log validation failures
   */
  async logValidationFailure(validationType, errors, fileInfo, req) {
    await this.logEvent({
      requestId: req.auditInfo?.requestId || this.generateRequestId(),
      operationType: 'validation',
      event: 'validation_failure',
      severity: 'warning',
      userId: req.user?.id,
      userEmail: req.user?.email,
      ipAddress: this.getClientIP(req),
      timestamp: new Date().toISOString(),
      details: {
        validationType,
        errors,
        fileName: fileInfo?.filename,
        fileSize: fileInfo?.size,
        contentType: fileInfo?.contentType,
      },
    });
  }

  /**
   * Log quota violations
   */
  async logQuotaViolation(quotaType, quotaInfo, req) {
    await this.logEvent({
      requestId: req.auditInfo?.requestId || this.generateRequestId(),
      operationType: 'quota',
      event: 'quota_violation',
      severity: 'warning',
      userId: req.user?.id,
      userEmail: req.user?.email,
      ipAddress: this.getClientIP(req),
      timestamp: new Date().toISOString(),
      details: {
        quotaType,
        quotaInfo,
      },
    });
  }

  /**
   * Core logging method
   */
  async logEvent(eventData) {
    try {
      const logEntry = {
        timestamp: eventData.timestamp || new Date().toISOString(),
        requestId: eventData.requestId,
        operationType: eventData.operationType,
        event: eventData.event,
        severity: eventData.severity || 'info',
        userId: eventData.userId,
        userEmail: eventData.userEmail,
        ipAddress: eventData.ipAddress,
        userAgent: eventData.userAgent,
        sessionId: eventData.sessionId,
        duration: eventData.duration,
        details: eventData.details || {},
      };

      const logLine = JSON.stringify(logEntry) + '\n';
      const logFile = await this.getCurrentLogFile();
      
      await fs.appendFile(logFile, logLine);
      
      // Also log to console for development
      if (process.env.NODE_ENV === 'development') {
        console.log(`[AUDIT] ${eventData.event}:`, logEntry);
      }
      
      // Check if log rotation is needed
      await this.rotateLogsIfNeeded();
      
    } catch (error) {
      console.error('Failed to write audit log:', error);
    }
  }

  /**
   * Helper methods
   */

  generateRequestId() {
    return crypto.randomBytes(16).toString('hex');
  }

  getClientIP(req) {
    if (!req) return 'unknown';
    
    return req.ip 
      || req.connection?.remoteAddress 
      || req.socket?.remoteAddress 
      || req.headers['x-forwarded-for']?.split(',')[0]?.trim()
      || 'unknown';
  }

  sanitizeParams(params) {
    if (!params || typeof params !== 'object') return params;
    
    const sanitized = { ...params };
    
    // Remove sensitive parameter values
    const sensitiveKeys = ['password', 'token', 'key', 'secret', 'auth'];
    
    Object.keys(sanitized).forEach(key => {
      if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
        sanitized[key] = '[REDACTED]';
      }
    });
    
    return sanitized;
  }

  sanitizeBody(body, operationType) {
    if (!body || typeof body !== 'object') return body;
    
    const sanitized = { ...body };
    
    // For upload operations, don't log file content
    if (operationType === 'upload' || operationType === 'file_upload') {
      delete sanitized.fileContent;
      delete sanitized.buffer;
      
      // Keep metadata but sanitize sensitive info
      if (sanitized.metadata) {
        sanitized.metadata = this.sanitizeParams(sanitized.metadata);
      }
    }
    
    // Remove sensitive fields
    const sensitiveFields = ['password', 'token', 'secret', 'key', 'auth', 'credential'];
    sensitiveFields.forEach(field => {
      if (sanitized[field]) {
        sanitized[field] = '[REDACTED]';
      }
    });
    
    return sanitized;
  }

  getSecurityEventSeverity(eventType) {
    const highSeverityEvents = [
      'malicious_file_detected',
      'virus_detected',
      'unauthorized_access',
      'suspicious_activity',
      'rate_limit_exceeded',
    ];
    
    const mediumSeverityEvents = [
      'validation_failure',
      'quota_exceeded',
      'file_type_violation',
    ];
    
    if (highSeverityEvents.includes(eventType)) return 'error';
    if (mediumSeverityEvents.includes(eventType)) return 'warning';
    return 'info';
  }

  async getCurrentLogFile() {
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    return path.join(this.logDir, `audit-${date}.log`);
  }

  async rotateLogsIfNeeded() {
    try {
      const currentLogFile = await this.getCurrentLogFile();
      const stats = await fs.stat(currentLogFile).catch(() => null);
      
      if (stats && stats.size > this.maxLogSize) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const rotatedFile = currentLogFile.replace('.log', `-${timestamp}.log`);
        
        await fs.rename(currentLogFile, rotatedFile);
        
        // Clean up old log files
        await this.cleanupOldLogs();
      }
    } catch (error) {
      console.error('Log rotation failed:', error);
    }
  }

  async cleanupOldLogs() {
    try {
      const files = await fs.readdir(this.logDir);
      const logFiles = files
        .filter(file => file.startsWith('audit-') && file.endsWith('.log'))
        .map(file => ({
          name: file,
          path: path.join(this.logDir, file),
        }));
      
      if (logFiles.length > this.maxLogFiles) {
        // Sort by modification time and remove oldest files
        const filesWithStats = await Promise.all(
          logFiles.map(async file => ({
            ...file,
            stats: await fs.stat(file.path),
          }))
        );
        
        filesWithStats
          .sort((a, b) => a.stats.mtime - b.stats.mtime)
          .slice(0, filesWithStats.length - this.maxLogFiles)
          .forEach(async file => {
            try {
              await fs.unlink(file.path);
            } catch (error) {
              console.error(`Failed to delete old log file ${file.name}:`, error);
            }
          });
      }
    } catch (error) {
      console.error('Log cleanup failed:', error);
    }
  }
}

// Create singleton instance
const auditLogger = new AuditLogger();

// Middleware functions
const auditFileUpload = auditLogger.auditFileOperation('file_upload');
const auditFileDownload = auditLogger.auditFileOperation('file_download');
const auditFileDelete = auditLogger.auditFileOperation('file_delete');
const auditFileAccess = auditLogger.auditFileOperation('file_access');

module.exports = {
  AuditLogger,
  auditLogger,
  auditFileUpload,
  auditFileDownload,
  auditFileDelete,
  auditFileAccess,
};