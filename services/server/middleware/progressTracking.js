/**
 * Progress Tracking Middleware for BullMQ Jobs
 * Provides standardized progress reporting and stage tracking
 */

const ProcessingJob = require('../models/ProcessingJob');

class ProgressTracker {
  constructor(job, totalStages = 1) {
    this.job = job;
    this.jobId = job.id;
    this.totalStages = totalStages;
    this.currentStage = 0;
    this.stageProgress = 0;
    this.stages = [];
    this.startTime = Date.now();
  }

  // Define processing stages for different job types
  static getStagesForJobType(jobType) {
    const stageDefinitions = {
      'validation': [
        { name: 'file_scan', description: 'Scanning file for security threats', weight: 30 },
        { name: 'content_validation', description: 'Validating file content and format', weight: 40 },
        { name: 'metadata_extraction', description: 'Extracting file metadata', weight: 30 }
      ],
      'parsing': [
        { name: 'format_detection', description: 'Detecting file format and structure', weight: 20 },
        { name: 'content_extraction', description: 'Extracting readable content', weight: 60 },
        { name: 'structure_analysis', description: 'Analyzing content structure', weight: 20 }
      ],
      'image-processing': [
        { name: 'image_analysis', description: 'Analyzing image properties', weight: 15 },
        { name: 'variant_generation', description: 'Generating image variants', weight: 25 },
        { name: 'ocr_processing', description: 'Extracting text with OCR', weight: 35 },
        { name: 'visual_detection', description: 'Detecting visual elements', weight: 25 }
      ],
      'llm-analysis': [
        { name: 'content_preparation', description: 'Preparing content for analysis', weight: 20 },
        { name: 'llm_processing', description: 'Processing with LLM', weight: 60 },
        { name: 'result_structuring', description: 'Structuring analysis results', weight: 20 }
      ],
      'cleanup': [
        { name: 'temp_cleanup', description: 'Cleaning temporary files', weight: 50 },
        { name: 'cache_cleanup', description: 'Cleaning cache entries', weight: 50 }
      ]
    };

    return stageDefinitions[jobType] || [
      { name: 'processing', description: 'Processing', weight: 100 }
    ];
  }

  // Initialize progress tracker with stages
  async initialize() {
    this.stages = ProgressTracker.getStagesForJobType(this.job.data.jobType || 'processing');
    this.totalStages = this.stages.length;

    // Create or update processing job record
    await ProcessingJob.createOrUpdate({
      job_id: this.jobId,
      artifact_id: this.job.data.artifactId,
      job_type: this.job.data.jobType || 'processing',
      status: 'active',
      progress: 0,
      started_at: new Date()
    });

    await this.updateProgress(0, this.stages[0]?.name || 'starting');
  }

  // Update progress within current stage
  async updateStageProgress(progress, details = null) {
    this.stageProgress = Math.max(0, Math.min(100, progress));
    
    const overallProgress = this.calculateOverallProgress();
    const currentStage = this.stages[this.currentStage];
    
    await this.updateProgress(overallProgress, currentStage?.name || 'processing', {
      stage: this.currentStage + 1,
      totalStages: this.totalStages,
      stageProgress: this.stageProgress,
      stageName: currentStage?.name,
      stageDescription: currentStage?.description,
      details
    });
  }

  // Move to next stage
  async nextStage(details = null) {
    if (this.currentStage < this.totalStages - 1) {
      this.currentStage++;
      this.stageProgress = 0;
      
      const overallProgress = this.calculateOverallProgress();
      const currentStage = this.stages[this.currentStage];
      
      await this.updateProgress(overallProgress, currentStage?.name || 'processing', {
        stage: this.currentStage + 1,
        totalStages: this.totalStages,
        stageProgress: 0,
        stageName: currentStage?.name,
        stageDescription: currentStage?.description,
        details
      });
    }
  }

  // Complete current stage and move to next
  async completeStage(details = null) {
    await this.updateStageProgress(100, details);
    await this.nextStage();
  }

  // Calculate overall progress based on stage weights
  calculateOverallProgress() {
    let totalWeight = 0;
    let completedWeight = 0;

    for (let i = 0; i < this.stages.length; i++) {
      const stage = this.stages[i];
      totalWeight += stage.weight;

      if (i < this.currentStage) {
        // Completed stages
        completedWeight += stage.weight;
      } else if (i === this.currentStage) {
        // Current stage
        completedWeight += (stage.weight * this.stageProgress) / 100;
      }
    }

    return totalWeight > 0 ? Math.round((completedWeight / totalWeight) * 100) : 0;
  }

  // Update job progress in BullMQ and database
  async updateProgress(progress, stage, metadata = {}) {
    try {
      // Update BullMQ job progress
      await this.job.updateProgress(progress);

      // Update database record
      await ProcessingJob.updateProgress(this.jobId, progress, stage, {
        ...metadata,
        updatedAt: new Date().toISOString(),
        elapsedTime: Date.now() - this.startTime
      });

    } catch (error) {
      console.error(`Error updating progress for job ${this.jobId}:`, error);
    }
  }

  // Mark job as completed
  async complete(result = null) {
    const completionTime = Date.now();
    const processingTime = completionTime - this.startTime;

    await ProcessingJob.updateStatus(this.jobId, 'completed', {
      completed_at: new Date(),
      result_data: result,
      processing_time_ms: processingTime
    });

    await this.job.updateProgress(100);
  }

  // Mark job as failed
  async fail(error) {
    const failureTime = Date.now();
    const processingTime = failureTime - this.startTime;

    await ProcessingJob.updateStatus(this.jobId, 'failed', {
      completed_at: new Date(),
      error_details: {
        message: error.message,
        stack: error.stack,
        stage: this.stages[this.currentStage]?.name || 'unknown'
      },
      processing_time_ms: processingTime
    });
  }

  // Get current status summary
  getStatus() {
    const currentStage = this.stages[this.currentStage];
    return {
      jobId: this.jobId,
      overallProgress: this.calculateOverallProgress(),
      currentStage: this.currentStage + 1,
      totalStages: this.totalStages,
      stageProgress: this.stageProgress,
      stageName: currentStage?.name || 'processing',
      stageDescription: currentStage?.description || 'Processing',
      elapsedTime: Date.now() - this.startTime
    };
  }
}

// Middleware function to wrap job processing with progress tracking
function withProgressTracking(jobProcessor, jobType = null) {
  return async function(job) {
    const tracker = new ProgressTracker(job);
    
    // Override job type if provided
    if (jobType) {
      job.data.jobType = jobType;
    }

    try {
      await tracker.initialize();
      
      // Add tracker to job data for use in processor
      job.progressTracker = tracker;
      
      const result = await jobProcessor(job);
      
      await tracker.complete(result);
      return result;
      
    } catch (error) {
      await tracker.fail(error);
      throw error;
    }
  };
}

// Helper functions for common progress patterns
const ProgressHelpers = {
  // For image processing with multiple variants
  async trackImageVariantGeneration(tracker, variants, currentIndex) {
    const progress = Math.round(((currentIndex + 1) / variants.length) * 100);
    await tracker.updateStageProgress(progress, {
      variant: variants[currentIndex],
      completed: currentIndex + 1,
      total: variants.length
    });
  },

  // For OCR processing with confidence tracking
  async trackOCRProgress(tracker, confidence, textLength) {
    const progress = Math.min(100, Math.round(confidence * 100));
    await tracker.updateStageProgress(progress, {
      confidence,
      textLength,
      quality: confidence > 0.8 ? 'high' : confidence > 0.6 ? 'medium' : 'low'
    });
  },

  // For LLM processing with token tracking
  async trackLLMProgress(tracker, tokensProcessed, totalTokens) {
    const progress = Math.round((tokensProcessed / totalTokens) * 100);
    await tracker.updateStageProgress(progress, {
      tokensProcessed,
      totalTokens,
      estimatedTimeRemaining: Math.round((totalTokens - tokensProcessed) / 10) // rough estimate
    });
  },

  // For file parsing with chunk tracking
  async trackParsingProgress(tracker, chunksProcessed, totalChunks) {
    const progress = Math.round((chunksProcessed / totalChunks) * 100);
    await tracker.updateStageProgress(progress, {
      chunksProcessed,
      totalChunks
    });
  }
};

module.exports = {
  ProgressTracker,
  withProgressTracking,
  ProgressHelpers
};