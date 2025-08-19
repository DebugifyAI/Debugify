/**
 * Simple unit tests for progress tracking components
 * Tests core functionality without database dependencies
 */

const { ProgressTracker, withProgressTracking, ProgressHelpers } = require('../middleware/progressTracking');

// Mock ProcessingJob to avoid database dependencies
jest.mock('../models/ProcessingJob', () => ({
  createOrUpdate: jest.fn().mockResolvedValue({}),
  updateProgress: jest.fn().mockResolvedValue({}),
  updateStatus: jest.fn().mockResolvedValue({})
}));

describe('Progress Tracking Core Functionality', () => {
  describe('ProgressTracker', () => {
    let mockJob;
    let tracker;

    beforeEach(() => {
      mockJob = {
        id: 'test-job-123',
        data: { 
          artifactId: 1, 
          jobType: 'image-processing' 
        },
        updateProgress: jest.fn().mockResolvedValue({})
      };
      
      tracker = new ProgressTracker(mockJob);
    });

    test('should initialize with correct stages for image processing', async () => {
      await tracker.initialize();
      
      expect(tracker.stages).toHaveLength(4);
      expect(tracker.stages[0].name).toBe('image_analysis');
      expect(tracker.stages[1].name).toBe('variant_generation');
      expect(tracker.stages[2].name).toBe('ocr_processing');
      expect(tracker.stages[3].name).toBe('visual_detection');
    });

    test('should calculate overall progress correctly', async () => {
      await tracker.initialize();
      
      // Complete first stage (15% weight)
      tracker.currentStage = 1;
      tracker.stageProgress = 0;
      expect(tracker.calculateOverallProgress()).toBe(15);
      
      // 50% through second stage (25% weight)
      tracker.stageProgress = 50;
      expect(tracker.calculateOverallProgress()).toBe(28); // 15 + (25 * 0.5)
    });

    test('should update stage progress correctly', async () => {
      await tracker.initialize();
      
      await tracker.updateStageProgress(50, 'Processing image metadata');
      expect(tracker.stageProgress).toBe(50);
      expect(mockJob.updateProgress).toHaveBeenCalled();
    });

    test('should move to next stage correctly', async () => {
      await tracker.initialize();
      
      const initialStage = tracker.currentStage;
      await tracker.nextStage();
      
      expect(tracker.currentStage).toBe(initialStage + 1);
      expect(tracker.stageProgress).toBe(0);
    });

    test('should complete stage and move to next', async () => {
      await tracker.initialize();
      
      const initialStage = tracker.currentStage;
      await tracker.completeStage('Stage completed successfully');
      
      expect(tracker.currentStage).toBe(initialStage + 1);
      expect(tracker.stageProgress).toBe(0);
    });

    test('should provide status summary', async () => {
      await tracker.initialize();
      
      tracker.currentStage = 1;
      tracker.stageProgress = 75;
      
      const status = tracker.getStatus();
      
      expect(status.jobId).toBe('test-job-123');
      expect(status.currentStage).toBe(2); // 1-indexed
      expect(status.totalStages).toBe(4);
      expect(status.stageProgress).toBe(75);
      expect(status.stageName).toBe('variant_generation');
    });
  });

  describe('Stage Definitions', () => {
    test('should return correct stages for validation job', () => {
      const stages = ProgressTracker.getStagesForJobType('validation');
      
      expect(stages).toHaveLength(3);
      expect(stages[0].name).toBe('file_scan');
      expect(stages[1].name).toBe('content_validation');
      expect(stages[2].name).toBe('metadata_extraction');
      
      // Check weights sum to 100
      const totalWeight = stages.reduce((sum, stage) => sum + stage.weight, 0);
      expect(totalWeight).toBe(100);
    });

    test('should return correct stages for parsing job', () => {
      const stages = ProgressTracker.getStagesForJobType('parsing');
      
      expect(stages).toHaveLength(3);
      expect(stages[0].name).toBe('format_detection');
      expect(stages[1].name).toBe('content_extraction');
      expect(stages[2].name).toBe('structure_analysis');
    });

    test('should return correct stages for LLM analysis job', () => {
      const stages = ProgressTracker.getStagesForJobType('llm-analysis');
      
      expect(stages).toHaveLength(3);
      expect(stages[0].name).toBe('content_preparation');
      expect(stages[1].name).toBe('llm_processing');
      expect(stages[2].name).toBe('result_structuring');
    });

    test('should return default stage for unknown job type', () => {
      const stages = ProgressTracker.getStagesForJobType('unknown-job-type');
      
      expect(stages).toHaveLength(1);
      expect(stages[0].name).toBe('processing');
      expect(stages[0].weight).toBe(100);
    });
  });

  describe('Progress Tracking Middleware', () => {
    test('should wrap job processor with progress tracking', async () => {
      const mockProcessor = jest.fn().mockResolvedValue({ result: 'success' });
      const wrappedProcessor = withProgressTracking(mockProcessor, 'validation');

      const mockJob = {
        id: 'test-job-456',
        data: { artifactId: 1 },
        updateProgress: jest.fn().mockResolvedValue({})
      };

      const result = await wrappedProcessor(mockJob);
      
      expect(mockProcessor).toHaveBeenCalledWith(mockJob);
      expect(result).toEqual({ result: 'success' });
      expect(mockJob.progressTracker).toBeDefined();
      expect(mockJob.data.jobType).toBe('validation');
    });

    test('should handle job processor errors', async () => {
      const mockProcessor = jest.fn().mockRejectedValue(new Error('Processing failed'));
      const wrappedProcessor = withProgressTracking(mockProcessor, 'parsing');

      const mockJob = {
        id: 'test-job-error',
        data: { artifactId: 1 },
        updateProgress: jest.fn().mockResolvedValue({})
      };

      await expect(wrappedProcessor(mockJob)).rejects.toThrow('Processing failed');
      expect(mockJob.progressTracker).toBeDefined();
    });

    test('should use job data jobType if no override provided', async () => {
      const mockProcessor = jest.fn().mockResolvedValue({ result: 'success' });
      const wrappedProcessor = withProgressTracking(mockProcessor); // No jobType override

      const mockJob = {
        id: 'test-job-789',
        data: { 
          artifactId: 1,
          jobType: 'image-processing' // Use this jobType
        },
        updateProgress: jest.fn().mockResolvedValue({})
      };

      await wrappedProcessor(mockJob);
      
      expect(mockJob.data.jobType).toBe('image-processing');
    });
  });

  describe('Progress Helpers', () => {
    let mockTracker;

    beforeEach(() => {
      mockTracker = {
        updateStageProgress: jest.fn().mockResolvedValue({})
      };
    });

    test('should track image variant generation progress', async () => {
      const variants = ['thumbnail', 'medium', 'large'];
      
      await ProgressHelpers.trackImageVariantGeneration(mockTracker, variants, 1);
      
      expect(mockTracker.updateStageProgress).toHaveBeenCalledWith(67, {
        variant: 'medium',
        completed: 2,
        total: 3
      });
    });

    test('should track OCR progress with confidence', async () => {
      const confidence = 0.85;
      const textLength = 1250;
      
      await ProgressHelpers.trackOCRProgress(mockTracker, confidence, textLength);
      
      expect(mockTracker.updateStageProgress).toHaveBeenCalledWith(85, {
        confidence: 0.85,
        textLength: 1250,
        quality: 'high'
      });
    });

    test('should track LLM progress with token counting', async () => {
      const tokensProcessed = 750;
      const totalTokens = 1000;
      
      await ProgressHelpers.trackLLMProgress(mockTracker, tokensProcessed, totalTokens);
      
      expect(mockTracker.updateStageProgress).toHaveBeenCalledWith(75, {
        tokensProcessed: 750,
        totalTokens: 1000,
        estimatedTimeRemaining: 25 // (1000 - 750) / 10
      });
    });

    test('should track parsing progress with chunks', async () => {
      const chunksProcessed = 8;
      const totalChunks = 10;
      
      await ProgressHelpers.trackParsingProgress(mockTracker, chunksProcessed, totalChunks);
      
      expect(mockTracker.updateStageProgress).toHaveBeenCalledWith(80, {
        chunksProcessed: 8,
        totalChunks: 10
      });
    });

    test('should handle OCR confidence quality levels', async () => {
      // High confidence
      await ProgressHelpers.trackOCRProgress(mockTracker, 0.9, 1000);
      expect(mockTracker.updateStageProgress).toHaveBeenLastCalledWith(90, {
        confidence: 0.9,
        textLength: 1000,
        quality: 'high'
      });

      // Medium confidence
      await ProgressHelpers.trackOCRProgress(mockTracker, 0.7, 800);
      expect(mockTracker.updateStageProgress).toHaveBeenLastCalledWith(70, {
        confidence: 0.7,
        textLength: 800,
        quality: 'medium'
      });

      // Low confidence
      await ProgressHelpers.trackOCRProgress(mockTracker, 0.4, 500);
      expect(mockTracker.updateStageProgress).toHaveBeenLastCalledWith(40, {
        confidence: 0.4,
        textLength: 500,
        quality: 'low'
      });
    });
  });

  describe('Edge Cases and Error Handling', () => {
    test('should handle progress values outside 0-100 range', async () => {
      const mockJob = {
        id: 'test-job-bounds',
        data: { artifactId: 1, jobType: 'validation' },
        updateProgress: jest.fn().mockResolvedValue({})
      };
      
      const tracker = new ProgressTracker(mockJob);
      await tracker.initialize();
      
      // Test negative progress
      await tracker.updateStageProgress(-10);
      expect(tracker.stageProgress).toBe(0);
      
      // Test progress over 100
      await tracker.updateStageProgress(150);
      expect(tracker.stageProgress).toBe(100);
    });

    test('should handle empty or invalid stage definitions', () => {
      const stages = ProgressTracker.getStagesForJobType('');
      expect(stages).toHaveLength(1);
      expect(stages[0].name).toBe('processing');
    });

    test('should handle tracker initialization errors gracefully', async () => {
      const mockJob = {
        id: 'test-job-error-init',
        data: { artifactId: 1, jobType: 'validation' },
        updateProgress: jest.fn().mockRejectedValue(new Error('Update failed'))
      };
      
      const tracker = new ProgressTracker(mockJob);
      
      // Should not throw error even if updateProgress fails
      await expect(tracker.initialize()).resolves.not.toThrow();
    });

    test('should calculate progress correctly when no stages defined', () => {
      const mockJob = {
        id: 'test-job-no-stages',
        data: { artifactId: 1 },
        updateProgress: jest.fn()
      };
      
      const tracker = new ProgressTracker(mockJob);
      tracker.stages = []; // No stages
      
      const progress = tracker.calculateOverallProgress();
      expect(progress).toBe(0);
    });
  });
});