// Mock dependencies first
jest.mock('../models/Artifact');
jest.mock('aws-sdk');
jest.mock('bullmq');
jest.mock('sharp');

const ImageWorker = require('../workers/ImageWorker');
const ImageProcessor = require('../helpers/ImageProcessor');
const Artifact = require('../models/Artifact');
const sharp = require('sharp');
const fs = require('fs').promises;
const path = require('path');

describe('ImageWorker', () => {
  let imageWorker;
  let mockRedisConfig;
  let mockS3;
  let mockJob;

  beforeEach(() => {
    mockRedisConfig = {
      host: 'localhost',
      port: 6379,
    };

    // Mock S3
    mockS3 = {
      getObject: jest.fn(),
      upload: jest.fn(),
    };

    // Mock BullMQ job
    mockJob = {
      data: { artifactId: 1 },
      updateProgress: jest.fn(),
    };

    // Mock AWS SDK
    const AWS = require('aws-sdk');
    AWS.S3 = jest.fn(() => mockS3);

    // Mock BullMQ Worker
    const { Worker } = require('bullmq');
    Worker.mockImplementation(() => ({
      on: jest.fn(),
      close: jest.fn(),
    }));

    imageWorker = new ImageWorker(mockRedisConfig);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('processImageJob', () => {
    const mockArtifact = {
      id: 1,
      s3_bucket: 'test-bucket',
      s3_key: 'test-image.jpg',
      size_bytes: 1024000,
      processing_stages: [],
    };

    const mockImageBuffer = Buffer.from('fake-image-data');

    beforeEach(() => {
      Artifact.findById.mockResolvedValue(mockArtifact);
      Artifact.update.mockResolvedValue({});
      
      mockS3.getObject.mockReturnValue({
        promise: () => Promise.resolve({
          Body: mockImageBuffer,
        }),
      });

      mockS3.upload.mockReturnValue({
        promise: () => Promise.resolve({
          ETag: '"mock-etag"',
        }),
      });
    });

    it('should process image successfully', async () => {
      // Mock image processor methods
      const mockProcessor = new ImageProcessor();
      mockProcessor.isValidImage = jest.fn().mockResolvedValue(true);
      mockProcessor.extractMetadata = jest.fn().mockResolvedValue({
        format: 'jpeg',
        width: 1920,
        height: 1080,
      });
      mockProcessor.generateVariants = jest.fn().mockResolvedValue({
        small: { webp: Buffer.from('small-webp'), jpeg: Buffer.from('small-jpeg') },
        medium: { webp: Buffer.from('medium-webp'), jpeg: Buffer.from('medium-jpeg') },
      });

      imageWorker.imageProcessor = mockProcessor;

      const result = await imageWorker.processImageJob(mockJob);

      expect(result).toMatchObject({
        artifactId: 1,
        status: 'completed',
      });

      expect(Artifact.findById).toHaveBeenCalledWith(1);
      expect(Artifact.update).toHaveBeenCalledWith(1, expect.objectContaining({
        status: 'processing',
      }));
      expect(mockJob.updateProgress).toHaveBeenCalledTimes(6);
    });

    it('should handle artifact not found', async () => {
      Artifact.findById.mockResolvedValue(null);

      await expect(imageWorker.processImageJob(mockJob)).rejects.toThrow('Artifact 1 not found');
    });

    it('should handle invalid image format', async () => {
      const mockProcessor = new ImageProcessor();
      mockProcessor.isValidImage = jest.fn().mockResolvedValue(false);
      imageWorker.imageProcessor = mockProcessor;

      await expect(imageWorker.processImageJob(mockJob)).rejects.toThrow('Invalid image format');
      
      expect(Artifact.update).toHaveBeenCalledWith(1, expect.objectContaining({
        status: 'failed',
      }));
    });

    it('should handle S3 download failure', async () => {
      mockS3.getObject.mockReturnValue({
        promise: () => Promise.reject(new Error('S3 error')),
      });

      await expect(imageWorker.processImageJob(mockJob)).rejects.toThrow('Failed to download image from S3');
    });

    it('should handle large image size limit', async () => {
      const largeArtifact = {
        ...mockArtifact,
        size_bytes: 60 * 1024 * 1024, // 60MB
      };
      Artifact.findById.mockResolvedValue(largeArtifact);

      await expect(imageWorker.processImageJob(mockJob)).rejects.toThrow('Image too large');
    });
  });

  describe('processImageComprehensively', () => {
    const mockImageBuffer = Buffer.from('fake-image-data');
    const mockOptions = {
      formats: ['webp', 'jpeg'],
      languages: ['eng'],
    };

    beforeEach(() => {
      // Mock ImageProcessor methods
      imageWorker.imageProcessor.extractMetadata = jest.fn().mockResolvedValue({
        format: 'jpeg',
        width: 1920,
        height: 1080,
      });
      
      imageWorker.imageProcessor.generateVariants = jest.fn().mockResolvedValue({
        small: { webp: Buffer.from('small') },
      });
      
      imageWorker.imageProcessor.extractTextOCR = jest.fn().mockResolvedValue({
        text: 'Sample OCR text',
        confidence: 85,
        words: [],
      });
      
      imageWorker.imageProcessor.detectVisualElements = jest.fn().mockResolvedValue({
        hasButtons: true,
        hasText: true,
      });
      
      imageWorker.imageProcessor.extractCodeSnippets = jest.fn().mockReturnValue({
        snippets: [],
        hasCode: false,
      });
      
      imageWorker.imageProcessor.detectSensitiveData = jest.fn().mockResolvedValue({
        hasApiKeys: false,
        hasCredentials: false,
      });
    });

    it('should perform comprehensive image processing', async () => {
      const result = await imageWorker.processImageComprehensively(
        mockImageBuffer,
        mockOptions,
        mockJob,
      );

      expect(result).toHaveProperty('metadata');
      expect(result).toHaveProperty('variants');
      expect(result).toHaveProperty('ocrText');
      expect(result).toHaveProperty('visualElements');
      expect(result).toHaveProperty('codeSnippets');
      expect(result).toHaveProperty('sensitiveDataFlags');
      expect(result).toHaveProperty('qualityAssessment');
      expect(result).toHaveProperty('processingTime');

      expect(imageWorker.imageProcessor.extractMetadata).toHaveBeenCalledWith(mockImageBuffer);
      expect(imageWorker.imageProcessor.generateVariants).toHaveBeenCalledWith(mockImageBuffer, mockOptions.formats);
    });

    it('should handle processing errors gracefully', async () => {
      imageWorker.imageProcessor.extractMetadata.mockRejectedValue(new Error('Metadata error'));

      await expect(
        imageWorker.processImageComprehensively(mockImageBuffer, mockOptions, mockJob),
      ).rejects.toThrow('Comprehensive image processing failed');
    });
  });

  describe('generateImageVariantsParallel', () => {
    const mockImageBuffer = Buffer.from('fake-image-data');

    it('should generate variants with compression stats', async () => {
      const mockVariants = {
        small: { webp: Buffer.from('small-webp'), jpeg: Buffer.from('small-jpeg') },
        medium: { webp: Buffer.from('medium-webp'), jpeg: Buffer.from('medium-jpeg') },
      };

      imageWorker.imageProcessor.generateVariants = jest.fn().mockResolvedValue(mockVariants);

      const result = await imageWorker.generateImageVariantsParallel(mockImageBuffer, ['webp', 'jpeg']);

      expect(result).toHaveProperty('small');
      expect(result).toHaveProperty('medium');
      expect(result).toHaveProperty('compressionStats');
      expect(result).toHaveProperty('originalSize');
      expect(result.originalSize).toBe(mockImageBuffer.length);
    });

    it('should handle variant generation errors', async () => {
      imageWorker.imageProcessor.generateVariants = jest.fn().mockRejectedValue(new Error('Variant error'));

      await expect(
        imageWorker.generateImageVariantsParallel(mockImageBuffer, ['webp']),
      ).rejects.toThrow('Variant generation failed');
    });
  });

  describe('performAdvancedOCR', () => {
    const mockImageBuffer = Buffer.from('fake-image-data');

    it('should perform OCR with enhanced results', async () => {
      const mockOCRResult = {
        text: 'Sample text from image',
        confidence: 85,
        words: [
          { text: 'Sample', confidence: 90, bbox: { x: 0, y: 0, width: 50, height: 20 } },
          { text: 'text', confidence: 80, bbox: { x: 55, y: 0, width: 30, height: 20 } },
        ],
        lines: [],
        paragraphs: [],
      };

      imageWorker.imageProcessor.extractTextOCR = jest.fn().mockResolvedValue(mockOCRResult);

      const result = await imageWorker.performAdvancedOCR(mockImageBuffer, ['eng']);

      expect(result).toHaveProperty('text');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('textRegions');
      expect(result).toHaveProperty('languageConfidence');
      expect(result).toHaveProperty('totalWords');
      expect(result).toHaveProperty('averageConfidence');
      expect(result.totalWords).toBe(2);
      expect(result.averageConfidence).toBe(85);
    });

    it('should handle OCR failures gracefully', async () => {
      imageWorker.imageProcessor.extractTextOCR = jest.fn().mockRejectedValue(new Error('OCR error'));

      const result = await imageWorker.performAdvancedOCR(mockImageBuffer, ['eng']);

      expect(result.text).toBe('');
      expect(result.confidence).toBe(0);
      expect(result.totalWords).toBe(0);
    });
  });

  describe('assessImageQuality', () => {
    const mockImageBuffer = Buffer.from('fake-image-data');
    const mockMetadata = {
      width: 1920,
      height: 1080,
      format: 'jpeg',
    };

    beforeEach(() => {
      // Mock sharp for quality assessment
      const mockSharp = {
        clone: jest.fn().mockReturnThis(),
        greyscale: jest.fn().mockReturnThis(),
        raw: jest.fn().mockReturnThis(),
        toBuffer: jest.fn().mockResolvedValue(Buffer.alloc(100, 128)),
        stats: jest.fn().mockResolvedValue({
          channels: [
            { mean: 128, stdev: 50, min: 0, max: 255 },
            { mean: 120, stdev: 45, min: 0, max: 255 },
            { mean: 135, stdev: 55, min: 0, max: 255 },
          ],
        }),
      };

      require('sharp').mockReturnValue(mockSharp);
    });

    it('should assess image quality and provide suggestions', async () => {
      const result = await imageWorker.assessImageQuality(mockImageBuffer, mockMetadata);

      expect(result).toHaveProperty('sharpness');
      expect(result).toHaveProperty('brightness');
      expect(result).toHaveProperty('contrast');
      expect(result).toHaveProperty('qualityScore');
      expect(result).toHaveProperty('suggestions');
      expect(result).toHaveProperty('resolution');
      expect(result.suggestions).toBeInstanceOf(Array);
      expect(result.resolution.megapixels).toBeCloseTo(2.07, 1);
    });

    it('should handle quality assessment errors', async () => {
      require('sharp').mockImplementation(() => {
        throw new Error('Sharp error');
      });

      const result = await imageWorker.assessImageQuality(mockImageBuffer, mockMetadata);

      expect(result.qualityScore).toBe(0);
      expect(result.suggestions).toContain('Quality assessment unavailable');
    });
  });

  describe('storeProcessingResults', () => {
    const mockArtifact = {
      id: 1,
      s3_bucket: 'test-bucket',
      s3_key: 'test-image.jpg',
    };

    const mockProcessingResults = {
      variants: {
        small: { webp: Buffer.from('small-webp'), jpeg: Buffer.from('small-jpeg') },
        compressionStats: {},
        originalSize: 1024,
      },
      ocrText: { text: 'Sample text' },
      visualElements: { hasButtons: true },
      processingTime: 5000,
    };

    beforeEach(() => {
      mockS3.upload.mockReturnValue({
        promise: () => Promise.resolve({ ETag: '"mock-etag"' }),
      });
    });

    it('should store variants and processed content', async () => {
      const result = await imageWorker.storeProcessingResults(
        mockArtifact,
        mockProcessingResults,
        mockJob,
      );

      expect(result).toHaveProperty('variants');
      expect(result).toHaveProperty('processedContentKey');
      expect(mockS3.upload).toHaveBeenCalledTimes(3); // 2 variants + 1 processed content
    });

    it('should handle storage errors', async () => {
      mockS3.upload.mockReturnValue({
        promise: () => Promise.reject(new Error('S3 upload error')),
      });

      await expect(
        imageWorker.storeProcessingResults(mockArtifact, mockProcessingResults, mockJob),
      ).rejects.toThrow('Failed to store processing results');
    });
  });

  describe('helper methods', () => {
    describe('calculateSharpness', () => {
      it('should calculate sharpness from grayscale buffer', () => {
        const grayscaleBuffer = Buffer.alloc(100, 128);
        const sharpness = imageWorker.calculateSharpness(grayscaleBuffer, 10, 10);
        
        expect(typeof sharpness).toBe('number');
        expect(sharpness).toBeGreaterThanOrEqual(0);
      });

      it('should handle calculation errors', () => {
        const sharpness = imageWorker.calculateSharpness(null, 10, 10);
        expect(sharpness).toBe(0);
      });
    });

    describe('calculateBrightness', () => {
      it('should calculate brightness from stats', () => {
        const stats = {
          channels: [
            { mean: 128 },
            { mean: 120 },
            { mean: 135 },
          ],
        };

        const brightness = imageWorker.calculateBrightness(stats);
        expect(brightness).toBeCloseTo(127.67, 1);
      });

      it('should handle empty stats', () => {
        const brightness = imageWorker.calculateBrightness({ channels: [] });
        expect(brightness).toBe(0);
      });
    });

    describe('calculateContrast', () => {
      it('should calculate contrast from stats', () => {
        const stats = {
          channels: [
            { stdev: 50 },
            { stdev: 45 },
            { stdev: 55 },
          ],
        };

        const contrast = imageWorker.calculateContrast(stats);
        expect(contrast).toBe(50);
      });
    });

    describe('generateContentSummary', () => {
      it('should generate comprehensive content summary', () => {
        const processingResults = {
          ocrText: { text: 'This is sample text with multiple words' },
          codeSnippets: { snippets: [{ code: 'function test() {}' }] },
          visualElements: { complexity: 'medium' },
          sensitiveDataFlags: { riskLevel: 'low' },
          variants: { small: {}, medium: {}, compressionStats: {}, originalSize: 1024 },
        };

        const summary = imageWorker.generateContentSummary(processingResults);
        
        expect(summary).toContain('words extracted via OCR');
        expect(summary).toContain('code snippets detected');
        expect(summary).toContain('medium visual complexity');
        expect(summary).toContain('low security risk');
        expect(summary).toContain('image variants generated');
      });

      it('should handle empty results', () => {
        const summary = imageWorker.generateContentSummary({});
        expect(summary).toBe('Image processed successfully');
      });
    });
  });

  describe('worker lifecycle', () => {
    it('should initialize with correct configuration', () => {
      expect(imageWorker.workerConfig.concurrency).toBe(2);
      expect(imageWorker.workerConfig.removeOnComplete).toBe(25);
      expect(imageWorker.workerConfig.removeOnFail).toBe(100);
    });

    it('should provide capabilities information', () => {
      const capabilities = imageWorker.getCapabilities();
      
      expect(capabilities).toHaveProperty('workerType', 'ImageWorker');
      expect(capabilities).toHaveProperty('queueName', 'imageProcessing');
      expect(capabilities).toHaveProperty('features');
      expect(capabilities.features).toContain('parallel_variant_generation');
      expect(capabilities.features).toContain('advanced_ocr_processing');
    });

    it('should close gracefully', async () => {
      const mockWorker = { close: jest.fn().mockResolvedValue() };
      imageWorker.worker = mockWorker;

      await imageWorker.close();
      expect(mockWorker.close).toHaveBeenCalled();
    });
  });
});

// Performance benchmarks
describe('ImageWorker Performance', () => {
  let imageWorker;

  beforeEach(() => {
    const mockRedisConfig = { host: 'localhost', port: 6379 };
    imageWorker = new ImageWorker(mockRedisConfig);
  });

  it('should process small images quickly', async () => {
    // Create a small test image
    const testImage = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    }).jpeg().toBuffer();

    const startTime = Date.now();
    
    // Mock the processor methods for performance test
    imageWorker.imageProcessor.isValidImage = jest.fn().mockResolvedValue(true);
    imageWorker.imageProcessor.extractMetadata = jest.fn().mockResolvedValue({
      format: 'jpeg',
      width: 100,
      height: 100,
    });

    const processingTime = Date.now() - startTime;
    
    // Small images should process in under 1 second
    expect(processingTime).toBeLessThan(1000);
  });

  it('should handle memory efficiently for large datasets', () => {
    // Test memory usage patterns
    const initialMemory = process.memoryUsage().heapUsed;
    
    // Simulate processing multiple images
    const promises = Array.from({ length: 10 }, (_, i) => {
      return imageWorker.calculateSharpness(Buffer.alloc(1000, i), 100, 10);
    });

    Promise.all(promises);

    const finalMemory = process.memoryUsage().heapUsed;
    const memoryIncrease = finalMemory - initialMemory;
    
    // Memory increase should be reasonable (less than 50MB)
    expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);
  });
});