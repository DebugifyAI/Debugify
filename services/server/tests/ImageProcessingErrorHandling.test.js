const { describe, it, expect, beforeEach, afterEach, jest } = require('@jest/globals');
const { ErrorClassification } = require('../utils/ErrorClassification');
const ErrorRecoveryManager = require('../utils/ErrorRecoveryManager');

// Mock Redis configuration
const mockRedisConfig = {
  host: 'localhost',
  port: 6379,
  maxRetriesPerRequest: null,
};

describe('Image Processing Error Handling', () => {
  let recoveryManager;

  beforeEach(() => {
    recoveryManager = new ErrorRecoveryManager(mockRedisConfig, {
      enableDeadLetterQueue: false,
      enableAlerting: false,
    });
  });

  afterEach(async () => {
    await recoveryManager.close();
  });

  describe('Image Format Errors', () => {
    it('should handle corrupt image files', async () => {
      const corruptImageError = new Error('Invalid JPEG: corrupt image data');
      
      const classification = ErrorClassification.classifyError(corruptImageError, {
        imageProcessing: true,
        format: 'jpeg',
      });

      expect(classification.category).toBe('IMAGE_PROCESSING');
      expect(classification.classification.retryable).toBe(true);
    });

    it('should handle unsupported image formats', async () => {
      const unsupportedFormatError = new Error('Unsupported format: TIFF not supported');
      
      const classification = ErrorClassification.classifyError(unsupportedFormatError, {
        imageProcessing: true,
        format: 'tiff',
      });

      expect(classification.category).toBe('IMAGE_PROCESSING');
    });

    it('should recover from format errors by using fallback processor', async () => {
      const formatError = new Error('Invalid PNG: malformed header');
      let processorUsed = 'primary';

      const mockImageOperation = jest.fn().mockImplementation((attempt, context) => {
        if (context.processor === 'fallback') {
          processorUsed = 'fallback';
          return Promise.resolve({
            success: true,
            processor: 'fallback',
            result: 'processed_with_fallback.png',
          });
        }
        throw formatError;
      });

      const result = await recoveryManager.handleError(
        formatError,
        { imageProcessing: true, format: 'png' },
        mockImageOperation
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe('use_fallback_processor');
      expect(processorUsed).toBe('fallback');
    });
  });

  describe('Image Size and Memory Errors', () => {
    it('should handle image too large errors', async () => {
      const imageTooLargeError = new Error('Image too large: 50MB exceeds 10MB limit');
      
      const classification = ErrorClassification.classifyError(imageTooLargeError, {
        imageProcessing: true,
        sizeBytes: 50 * 1024 * 1024,
      });

      expect(classification.category).toBe('IMAGE_PROCESSING');
    });

    it('should handle memory exhaustion during image processing', async () => {
      const memoryError = new Error('Out of memory during image resize operation');
      
      const classification = ErrorClassification.classifyError(memoryError, {
        imageProcessing: true,
        operation: 'resize',
      });

      expect(classification.category).toBe('RESOURCE');
      expect(classification.classification.severity).toBe('high');
    });

    it('should recover from memory errors by reducing image quality', async () => {
      const memoryError = new Error('Heap out of memory during image processing');
      let qualityUsed = 'high';

      const mockImageOperation = jest.fn().mockImplementation((attempt, context) => {
        if (context.quality === 'low' && context.maxDimensions) {
          qualityUsed = 'low';
          return Promise.resolve({
            success: true,
            quality: 'low',
            dimensions: context.maxDimensions,
            result: 'processed_low_quality.jpg',
          });
        }
        throw memoryError;
      });

      const result = await recoveryManager.handleError(
        memoryError,
        { 
          imageProcessing: true, 
          originalDimensions: { width: 4000, height: 3000 },
        },
        mockImageOperation
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe('reduce_quality');
      expect(qualityUsed).toBe('low');
    });

    it('should handle dimension limit errors', async () => {
      const dimensionError = new Error('Image dimensions 8000x6000 exceed maximum 4000x4000');
      
      const mockImageOperation = jest.fn().mockImplementation((attempt, context) => {
        if (context.maxDimensions && 
            context.maxDimensions.width <= 800 && 
            context.maxDimensions.height <= 600) {
          return Promise.resolve({
            success: true,
            resized: true,
            newDimensions: context.maxDimensions,
          });
        }
        throw dimensionError;
      });

      const result = await recoveryManager.handleError(
        dimensionError,
        { 
          imageProcessing: true,
          originalDimensions: { width: 8000, height: 6000 },
        },
        mockImageOperation
      );

      expect(result.success).toBe(true);
    });
  });

  describe('OCR Processing Errors', () => {
    it('should handle OCR engine failures', async () => {
      const ocrError = new Error('Tesseract OCR failed: engine not initialized');
      
      const classification = ErrorClassification.classifyError(ocrError, {
        imageProcessing: true,
        operation: 'ocr',
        engine: 'tesseract',
      });

      expect(classification.category).toBe('IMAGE_PROCESSING');
    });

    it('should handle OCR language detection errors', async () => {
      const languageError = new Error('OCR language detection failed: unsupported language');
      
      const classification = ErrorClassification.classifyError(languageError, {
        imageProcessing: true,
        operation: 'ocr',
        language: 'unknown',
      });

      expect(classification.category).toBe('IMAGE_PROCESSING');
    });

    it('should recover from OCR errors by using simplified processing', async () => {
      const ocrError = new Error('OCR confidence too low: 0.3 below threshold 0.8');
      let ocrMethod = 'advanced';

      const mockOcrOperation = jest.fn().mockImplementation((attempt, context) => {
        if (context.skipAdvancedFeatures) {
          ocrMethod = 'basic';
          return Promise.resolve({
            success: true,
            method: 'basic',
            text: 'extracted text with basic OCR',
            confidence: 0.6,
          });
        }
        throw ocrError;
      });

      const result = await recoveryManager.handleError(
        ocrError,
        { 
          imageProcessing: true,
          operation: 'ocr',
          confidenceThreshold: 0.8,
        },
        mockOcrOperation
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe('skip_advanced_features');
      expect(ocrMethod).toBe('basic');
    });

    it('should handle OCR timeout errors', async () => {
      const timeoutError = new Error('OCR processing timeout after 30 seconds');
      
      const mockOcrOperation = jest.fn().mockImplementation((attempt, context) => {
        if (context.basicProcessingOnly) {
          return Promise.resolve({
            success: true,
            method: 'fast_ocr',
            text: 'quick extracted text',
            processingTime: 5000,
          });
        }
        throw timeoutError;
      });

      const result = await recoveryManager.handleError(
        timeoutError,
        { 
          imageProcessing: true,
          operation: 'ocr',
          timeout: 30000,
        },
        mockOcrOperation
      );

      expect(result.success).toBe(true);
    });
  });

  describe('Image Variant Generation Errors', () => {
    it('should handle thumbnail generation failures', async () => {
      const thumbnailError = new Error('Thumbnail generation failed: invalid resize parameters');
      
      const classification = ErrorClassification.classifyError(thumbnailError, {
        imageProcessing: true,
        operation: 'thumbnail',
        targetSize: { width: 150, height: 150 },
      });

      expect(classification.category).toBe('IMAGE_PROCESSING');
    });

    it('should handle WebP conversion errors', async () => {
      const webpError = new Error('WebP conversion failed: unsupported color profile');
      
      const mockConversionOperation = jest.fn().mockImplementation((attempt, context) => {
        if (context.skipAdvancedFeatures) {
          return Promise.resolve({
            success: true,
            format: 'jpeg',
            fallback: true,
            result: 'converted_fallback.jpg',
          });
        }
        throw webpError;
      });

      const result = await recoveryManager.handleError(
        webpError,
        { 
          imageProcessing: true,
          operation: 'format_conversion',
          targetFormat: 'webp',
        },
        mockConversionOperation
      );

      expect(result.success).toBe(true);
    });

    it('should handle batch variant generation failures', async () => {
      const batchError = new Error('Batch processing failed: too many concurrent operations');
      
      const mockBatchOperation = jest.fn().mockImplementation((attempt, context) => {
        if (context.batchSize <= 3) {
          return Promise.resolve({
            success: true,
            batchSize: context.batchSize,
            processedVariants: ['thumb.jpg', 'medium.jpg', 'large.jpg'],
          });
        }
        throw batchError;
      });

      const result = await recoveryManager.handleError(
        batchError,
        { 
          imageProcessing: true,
          operation: 'batch_variants',
          batchSize: 10,
        },
        mockBatchOperation
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe('reduce_batch_size');
    });
  });

  describe('Visual Element Detection Errors', () => {
    it('should handle computer vision API failures', async () => {
      const visionError = new Error('Computer vision API error: service unavailable');
      
      const classification = ErrorClassification.classifyError(visionError, {
        imageProcessing: true,
        operation: 'visual_detection',
        api: 'computer_vision',
      });

      expect(classification.category).toBe('LLM_SERVICE');
    });

    it('should handle object detection timeout', async () => {
      const detectionTimeout = new Error('Object detection timeout: processing took too long');
      
      const mockDetectionOperation = jest.fn().mockImplementation((attempt, context) => {
        if (context.skipAdvancedFeatures) {
          return Promise.resolve({
            success: true,
            method: 'basic_detection',
            objects: ['text', 'image'],
            confidence: 0.7,
          });
        }
        throw detectionTimeout;
      });

      const result = await recoveryManager.handleError(
        detectionTimeout,
        { 
          imageProcessing: true,
          operation: 'object_detection',
          timeout: 60000,
        },
        mockDetectionOperation
      );

      expect(result.success).toBe(true);
    });

    it('should handle UI component detection failures', async () => {
      const uiDetectionError = new Error('UI component detection failed: no components found');
      
      const mockUiDetection = jest.fn().mockImplementation((attempt, context) => {
        if (context.basicProcessingOnly) {
          return Promise.resolve({
            success: true,
            method: 'basic_ui_scan',
            components: ['button', 'text_field'],
            fallback: true,
          });
        }
        throw uiDetectionError;
      });

      const result = await recoveryManager.handleError(
        uiDetectionError,
        { 
          imageProcessing: true,
          operation: 'ui_detection',
          imageType: 'screenshot',
        },
        mockUiDetection
      );

      expect(result.success).toBe(true);
    });
  });

  describe('Sensitive Data Detection Errors', () => {
    it('should handle PII detection failures', async () => {
      const piiError = new Error('PII detection failed: pattern matching error');
      
      const classification = ErrorClassification.classifyError(piiError, {
        imageProcessing: true,
        operation: 'pii_detection',
        scanType: 'text_extraction',
      });

      expect(classification.category).toBe('IMAGE_PROCESSING');
    });

    it('should handle credential scanning errors', async () => {
      const credentialError = new Error('Credential scanning failed: regex compilation error');
      
      const mockCredentialScan = jest.fn().mockImplementation((attempt, context) => {
        if (context.basicProcessingOnly) {
          return Promise.resolve({
            success: true,
            method: 'basic_scan',
            credentialsFound: false,
            patterns: ['basic_patterns_only'],
          });
        }
        throw credentialError;
      });

      const result = await recoveryManager.handleError(
        credentialError,
        { 
          imageProcessing: true,
          operation: 'credential_scan',
          patterns: ['api_key', 'password', 'token'],
        },
        mockCredentialScan
      );

      expect(result.success).toBe(true);
    });

    it('should handle steganography detection errors', async () => {
      const steganographyError = new Error('Steganography detection failed: analysis timeout');
      
      const mockSteganographyDetection = jest.fn().mockImplementation((attempt, context) => {
        if (context.skipAdvancedFeatures) {
          return Promise.resolve({
            success: true,
            method: 'basic_check',
            hiddenDataFound: false,
            skippedAdvanced: true,
          });
        }
        throw steganographyError;
      });

      const result = await recoveryManager.handleError(
        steganographyError,
        { 
          imageProcessing: true,
          operation: 'steganography_detection',
          deepScan: true,
        },
        mockSteganographyDetection
      );

      expect(result.success).toBe(true);
    });
  });

  describe('Image Processing Integration Errors', () => {
    it('should handle Sharp library errors', async () => {
      const sharpError = new Error('Sharp: Input buffer contains unsupported image format');
      
      const classification = ErrorClassification.classifyError(sharpError, {
        imageProcessing: true,
        library: 'sharp',
      });

      expect(classification.category).toBe('IMAGE_PROCESSING');
    });

    it('should handle ImageMagick errors', async () => {
      const imageMagickError = new Error('ImageMagick: no decode delegate for this image format');
      
      const classification = ErrorClassification.classifyError(imageMagickError, {
        imageProcessing: true,
        library: 'imagemagick',
      });

      expect(classification.category).toBe('IMAGE_PROCESSING');
    });

    it('should handle Canvas API errors', async () => {
      const canvasError = new Error('Canvas: failed to create 2D context');
      
      const classification = ErrorClassification.classifyError(canvasError, {
        imageProcessing: true,
        library: 'canvas',
      });

      expect(classification.category).toBe('IMAGE_PROCESSING');
    });
  });

  describe('Complex Image Processing Scenarios', () => {
    it('should handle cascading image processing failures', async () => {
      const errors = [
        new Error('Image too large for processing'),
        new Error('Memory limit exceeded during resize'),
        new Error('OCR failed on reduced image'),
      ];
      
      let errorIndex = 0;
      let finalQuality = 'high';

      const mockComplexOperation = jest.fn().mockImplementation((attempt, context) => {
        if (context.quality === 'low' && 
            context.maxDimensions && 
            context.skipAdvancedFeatures) {
          finalQuality = 'low';
          return Promise.resolve({
            success: true,
            quality: 'low',
            basicProcessing: true,
            result: 'minimal_processed_image.jpg',
          });
        }
        
        const error = errors[Math.min(errorIndex, errors.length - 1)];
        errorIndex++;
        throw error;
      });

      const result = await recoveryManager.handleError(
        errors[0],
        { 
          imageProcessing: true,
          originalSize: '50MB',
          targetOperations: ['resize', 'ocr', 'object_detection'],
        },
        mockComplexOperation
      );

      expect(result.success).toBe(true);
      expect(finalQuality).toBe('low');
    });

    it('should handle image processing pipeline failures', async () => {
      const pipelineError = new Error('Image processing pipeline failed at stage 3');
      
      const mockPipelineOperation = jest.fn().mockImplementation((attempt, context) => {
        if (context.basicProcessingOnly) {
          return Promise.resolve({
            success: true,
            pipeline: 'basic',
            stages: ['resize', 'format_convert'],
            skippedStages: ['advanced_ocr', 'object_detection', 'enhancement'],
          });
        }
        throw pipelineError;
      });

      const result = await recoveryManager.handleError(
        pipelineError,
        { 
          imageProcessing: true,
          pipeline: 'full',
          stages: ['resize', 'format_convert', 'advanced_ocr', 'object_detection', 'enhancement'],
        },
        mockPipelineOperation
      );

      expect(result.success).toBe(true);
    });

    it('should handle concurrent image processing errors', async () => {
      const concurrencyError = new Error('Too many concurrent image processing operations');
      
      const mockConcurrentOperation = jest.fn().mockImplementation((attempt, context) => {
        if (context.processIndividually) {
          return Promise.resolve({
            success: true,
            method: 'sequential',
            processedCount: 1,
            totalTime: '5s per image',
          });
        }
        throw concurrencyError;
      });

      const result = await recoveryManager.handleError(
        concurrencyError,
        { 
          imageProcessing: true,
          batchSize: 20,
          concurrency: 10,
        },
        mockConcurrentOperation
      );

      expect(result.success).toBe(true);
    });
  });

  describe('Image Processing Error Recovery Performance', () => {
    it('should recover from image errors within reasonable time', async () => {
      const start = Date.now();
      const imageError = new Error('Image processing failed: corrupt data');
      
      const mockOperation = jest.fn()
        .mockRejectedValueOnce(imageError)
        .mockResolvedValue({ success: true, recovered: true });

      const result = await recoveryManager.handleError(
        imageError,
        { imageProcessing: true },
        mockOperation
      );

      const duration = Date.now() - start;
      
      expect(result.success).toBe(true);
      expect(duration).toBeLessThan(5000); // Should recover within 5 seconds
    });

    it('should handle multiple image processing errors efficiently', async () => {
      const errors = Array.from({ length: 10 }, (_, i) => 
        new Error(`Image processing error ${i + 1}`)
      );

      const start = Date.now();
      const results = await Promise.all(
        errors.map(error => 
          recoveryManager.handleError(error, { imageProcessing: true }, null)
        )
      );

      const duration = Date.now() - start;
      
      expect(results).toHaveLength(10);
      expect(duration).toBeLessThan(10000); // Should handle all within 10 seconds
    });
  });
});