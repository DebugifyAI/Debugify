const { Worker } = require('bullmq');
const FileValidator = require('../helpers/FileValidator');
const Artifact = require('../models/Artifact');

/**
 * Specialized worker for file validation and security checks
 * Handles virus scanning, format validation, and security analysis
 */
class ValidationWorker {
  constructor(redisConfig) {
    this.redisConfig = redisConfig;
    this.fileValidator = new FileValidator();
    
    // Worker configuration for validation tasks
    this.workerConfig = {
      connection: redisConfig,
      concurrency: 10, // High concurrency for validation tasks
      removeOnComplete: 25,
      removeOnFail: 100,
    };
    
    this.worker = new Worker('validation', this.processValidationJob.bind(this), this.workerConfig);
    this.setupEventHandlers();
  }

  /**
   * Main validation job handler
   * @param {Object} job - BullMQ job object
   * @returns {Object} Validation results
   */
  async processValidationJob(job) {
    const { artifactId, validationOptions = {} } = job.data;
    
    try {
      await job.updateProgress(5);
      
      // Fetch artifact from database
      const artifact = await Artifact.findById(artifactId);
      if (!artifact) {
        throw new Error(`Artifact ${artifactId} not found`);
      }

      // Update artifact status to validation in progress
      await Artifact.update(artifactId, { 
        status: 'validating',
        processing_stages: ['validation_started'],
      });
      
      await job.updateProgress(10);

      // Perform comprehensive validation
      const validationResult = await this.performComprehensiveValidation(
        artifact,
        validationOptions,
        job
      );

      await job.updateProgress(80);

      // Update artifact with validation results
      await this.updateArtifactWithValidation(artifact, validationResult);

      await job.updateProgress(100);

      return {
        artifactId,
        status: validationResult.isValid ? 'valid' : 'invalid',
        validationChecks: validationResult.checks,
        securityFlags: validationResult.securityFlags,
        recommendations: validationResult.recommendations,
        processingTime: validationResult.processingTime,
        completedAt: new Date().toISOString(),
      };

    } catch (error) {
      console.error(`Validation failed for artifact ${artifactId}:`, error);
      
      // Update artifact status to validation failed
      await Artifact.update(artifactId, {
        status: 'validation_failed',
        last_error: error.message,
        processing_stages: ['validation_failed'],
        validation_status: 'failed',
        validation_errors: { error: error.message, timestamp: new Date().toISOString() },
      });
      
      throw error;
    }
  }

  /**
   * Perform comprehensive validation including security checks
   * @param {Object} artifact - Artifact database record
   * @param {Object} options - Validation options
   * @param {Object} job - BullMQ job for progress updates
   * @returns {Object} Validation results
   */
  async performComprehensiveValidation(artifact, options, job) {
    const startTime = Date.now();
    
    try {
      const validationResult = {
        isValid: true,
        checks: {},
        securityFlags: {},
        recommendations: [],
        errors: [],
      };

      // File type validation (20% progress)
      await job.updateProgress(20);
      const fileTypeCheck = await this.fileValidator.validateFileType(artifact);
      validationResult.checks.fileType = fileTypeCheck;
      if (!fileTypeCheck.isValid) {
        validationResult.isValid = false;
        validationResult.errors.push(fileTypeCheck.error);
      }

      // File size validation (30% progress)
      await job.updateProgress(30);
      const fileSizeCheck = await this.fileValidator.validateFileSize(artifact);
      validationResult.checks.fileSize = fileSizeCheck;
      if (!fileSizeCheck.isValid) {
        validationResult.isValid = false;
        validationResult.errors.push(fileSizeCheck.error);
      }

      // Content type verification (40% progress)
      await job.updateProgress(40);
      const contentTypeCheck = await this.fileValidator.validateContentType(artifact);
      validationResult.checks.contentType = contentTypeCheck;
      if (!contentTypeCheck.isValid) {
        validationResult.isValid = false;
        validationResult.errors.push(contentTypeCheck.error);
      }

      // Security scanning (60% progress)
      await job.updateProgress(60);
      const securityCheck = await this.fileValidator.performSecurityScan(artifact);
      validationResult.checks.security = securityCheck;
      validationResult.securityFlags = securityCheck.flags || {};
      if (!securityCheck.isValid) {
        validationResult.isValid = false;
        validationResult.errors.push(securityCheck.error);
      }

      // Malicious pattern detection (70% progress)
      await job.updateProgress(70);
      const malwareCheck = await this.fileValidator.scanForMaliciousPatterns(artifact);
      validationResult.checks.malware = malwareCheck;
      if (!malwareCheck.isValid) {
        validationResult.isValid = false;
        validationResult.errors.push(malwareCheck.error);
      }

      // Generate recommendations based on validation results
      validationResult.recommendations = this.generateValidationRecommendations(validationResult);
      
      validationResult.processingTime = Date.now() - startTime;
      
      return validationResult;
      
    } catch (error) {
      throw new Error(`Comprehensive validation failed: ${error.message}`);
    }
  }

  /**
   * Generate validation recommendations based on results
   * @param {Object} validationResult - Validation results
   * @returns {Array} Recommendations
   */
  generateValidationRecommendations(validationResult) {
    const recommendations = [];
    
    if (!validationResult.isValid) {
      recommendations.push('File failed validation and should not be processed further');
    }
    
    if (validationResult.securityFlags.hasSuspiciousPatterns) {
      recommendations.push('File contains suspicious patterns - manual review recommended');
    }
    
    if (validationResult.securityFlags.hasLargeSize) {
      recommendations.push('Large file detected - consider size optimization');
    }
    
    if (validationResult.checks.fileType?.warning) {
      recommendations.push(`File type warning: ${validationResult.checks.fileType.warning}`);
    }
    
    if (validationResult.isValid && Object.keys(validationResult.securityFlags).length === 0) {
      recommendations.push('File passed all validation checks and is safe to process');
    }
    
    return recommendations;
  }

  /**
   * Update artifact with validation results
   * @param {Object} artifact - Original artifact record
   * @param {Object} validationResult - Validation results
   */
  async updateArtifactWithValidation(artifact, validationResult) {
    try {
      const updateData = {
        status: validationResult.isValid ? 'validated' : 'validation_failed',
        validation_status: validationResult.isValid ? 'passed' : 'failed',
        validation_errors: validationResult.isValid ? null : {
          errors: validationResult.errors,
          timestamp: new Date().toISOString(),
        },
        processing_stages: [
          'validation_started',
          'file_type_checked',
          'size_validated',
          'content_type_verified',
          'security_scanned',
          'malware_checked',
          validationResult.isValid ? 'validation_completed' : 'validation_failed',
        ],
      };
      
      await Artifact.update(artifact.id, updateData);
      
    } catch (error) {
      throw new Error(`Failed to update artifact: ${error.message}`);
    }
  }

  /**
   * Setup event handlers for worker monitoring
   */
  setupEventHandlers() {
    this.worker.on('ready', () => {
      console.log('🔍 ValidationWorker is ready for processing');
    });

    this.worker.on('error', (error) => {
      console.error('🔍 ValidationWorker error:', error);
    });

    this.worker.on('stalled', (jobId) => {
      console.warn(`🔍 ValidationWorker job ${jobId} stalled`);
    });

    this.worker.on('completed', (job) => {
      console.log(`🔍 ValidationWorker completed job ${job.id} for artifact ${job.data.artifactId}`);
    });

    this.worker.on('failed', (job, err) => {
      console.error(`🔍 ValidationWorker job ${job?.id} failed:`, err.message);
    });

    this.worker.on('progress', (job, progress) => {
      console.log(`🔍 ValidationWorker job ${job.id} progress: ${progress}%`);
    });
  }

  /**
   * Get worker instance for external access
   * @returns {Worker} BullMQ worker instance
   */
  getWorker() {
    return this.worker;
  }

  /**
   * Gracefully close the worker
   */
  async close() {
    console.log('🔍 Shutting down ValidationWorker...');
    await this.worker.close();
    console.log('🔍 ValidationWorker shut down successfully');
  }

  /**
   * Get worker capabilities and configuration
   * @returns {Object} Worker capabilities
   */
  getCapabilities() {
    return {
      workerType: 'ValidationWorker',
      concurrency: this.workerConfig.concurrency,
      queueName: 'validation',
      features: [
        'file_type_validation',
        'file_size_validation',
        'content_type_verification',
        'security_scanning',
        'malicious_pattern_detection',
        'virus_scanning_integration',
        'comprehensive_validation_reporting',
        'security_recommendations',
      ],
      supportedFileTypes: this.fileValidator.getSupportedFileTypes(),
      maxFileSize: this.fileValidator.getMaxFileSize(),
    };
  }
}

module.exports = ValidationWorker;