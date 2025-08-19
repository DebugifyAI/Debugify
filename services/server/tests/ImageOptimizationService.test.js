const sharp = require('sharp');
const aws = require('aws-sdk');
const ImageOptimizationService = require('../services/ImageOptimizationService');

// Mock dependencies
jest.mock('sharp');
jest.mock('aws-sdk');

describe('ImageOptimizationService', () => {
  let service;
  let mockS3;
  let mockSharp;

  beforeEach(() => {
    jest.clearAllMocks();
    
    service = new ImageOptimizationService(mockS3);
    
    // Mock S3 instance
    mockS3 = {
      getObject: jest.fn(),
      upload: jest.fn(),
    };
    aws.S3.mockImplementation(() => mockS3);

    // Mock Sharp instance
    mockSharp = {
      metadata: jest.fn(),
      resize: jest.fn(),
      webp: jest.fn(),
      jpeg: jest.fn(),
      toBuffer: jest.fn(),
    };
    
    // Chain methods for fluent API
    mockSharp.resize.mockReturnValue(mockSharp);
    mockSharp.webp.mockReturnValue(mockSharp);
    mockSharp.jpeg.mockReturnValue(mockSharp);
    
    sharp.mockReturnValue(mockSharp);

    // Mock environment variables
    process.env.AWS_ACCESS_KEY_ID = 'test-key';
    process.env.AWS_SECRET_ACCESS_KEY = 'test-secret';
    process.env.AWS_REGION = 'us-east-1';
  });

  describe('isImage', () => {
    it('should return true for image content types', () => {
      expect(service.isImage('image/jpeg')).toBe(true);
      expect(service.isImage('image/png')).toBe(true);
      expect(service.isImage('image/webp')).toBe(true);
    });

    it('should return false for non-image content types', () => {
      expect(service.isImage('text/plain')).toBe(false);
      expect(service.isImage('application/pdf')).toBe(false);
      expect(service.isImage(null)).toBe(false);
      expect(service.isImage(undefined)).toBe(false);
    });
  });

  describe('getImageFormat', () => {
    it('should return correct format for content types', () => {
      expect(service.getImageFormat('image/jpeg')).toBe('jpeg');
      expect(service.getImageFormat('image/jpg')).toBe('jpeg');
      expect(service.getImageFormat('image/png')).toBe('png');
      expect(service.getImageFormat('image/webp')).toBe('webp');
    });

    it('should return jpeg as default for unknown types', () => {
      expect(service.getImageFormat('image/unknown')).toBe('jpeg');
      expect(service.getImageFormat('text/plain')).toBe('jpeg');
    });
  });

  describe('validateImage', () => {
    const mockImageBuffer = Buffer.from('fake-image-data');

    it('should validate a valid image', async () => {
      const mockMetadata = {
        width: 1920,
        height: 1080,
        format: 'jpeg',
      };
      mockSharp.metadata.mockResolvedValue(mockMetadata);

      const result = await service.validateImage(mockImageBuffer, 'image/jpeg');

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.metadata).toEqual(mockMetadata);
    });

    it('should reject image with excessive dimensions', async () => {
      const mockMetadata = {
        width: 5000,
        height: 5000,
        format: 'jpeg',
      };
      mockSharp.metadata.mockResolvedValue(mockMetadata);

      const result = await service.validateImage(mockImageBuffer, 'image/jpeg');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Image dimensions 5000x5000 exceed maximum allowed 4096x4096',
      );
    });

    it('should reject image that is too large', async () => {
      const mockMetadata = {
        width: 1920,
        height: 1080,
        format: 'jpeg',
      };
      mockSharp.metadata.mockResolvedValue(mockMetadata);

      const largeBuffer = Buffer.alloc(100 * 1024 * 1024); // 100MB
      const result = await service.validateImage(largeBuffer, 'image/jpeg', 50 * 1024 * 1024);

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('exceeds maximum allowed');
    });

    it('should reject unsupported format', async () => {
      const mockMetadata = {
        width: 1920,
        height: 1080,
        format: 'jpeg',
      };
      mockSharp.metadata.mockResolvedValue(mockMetadata);

      const result = await service.validateImage(mockImageBuffer, 'image/unsupported');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Image format unsupported is not supported');
    });

    it('should handle invalid image files', async () => {
      mockSharp.metadata.mockRejectedValue(new Error('Invalid image'));

      const result = await service.validateImage(mockImageBuffer, 'image/jpeg');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid image file: Invalid image');
      expect(result.metadata).toBeNull();
    });
  });

  describe('generateVariants', () => {
    const mockImageBuffer = Buffer.from('fake-image-data');

    beforeEach(() => {
      const mockMetadata = {
        width: 2000,
        height: 1500,
        format: 'jpeg',
      };
      mockSharp.metadata.mockResolvedValue(mockMetadata);
      
      const mockOptimizedBuffer = Buffer.from('optimized-image-data');
      mockSharp.toBuffer.mockResolvedValue(mockOptimizedBuffer);
    });

    it('should generate all variant sizes', async () => {
      const variants = await service.generateVariants(mockImageBuffer);

      expect(variants).toHaveProperty('thumbnail');
      expect(variants).toHaveProperty('small');
      expect(variants).toHaveProperty('medium');
      expect(variants).toHaveProperty('large');

      // Check that resize was called for each variant
      expect(mockSharp.resize).toHaveBeenCalledTimes(4);
    });

    it('should use WebP format for non-thumbnail variants', async () => {
      await service.generateVariants(mockImageBuffer);

      // Thumbnail should use JPEG, others should use WebP
      expect(mockSharp.jpeg).toHaveBeenCalledTimes(1); // thumbnail
      expect(mockSharp.webp).toHaveBeenCalledTimes(3); // small, medium, large
    });

    it('should handle variant generation errors gracefully', async () => {
      // Make one variant fail
      mockSharp.toBuffer
        .mockResolvedValueOnce(Buffer.from('thumbnail'))
        .mockRejectedValueOnce(new Error('Processing failed'))
        .mockResolvedValueOnce(Buffer.from('medium'))
        .mockResolvedValueOnce(Buffer.from('large'));

      const variants = await service.generateVariants(mockImageBuffer);

      // Should have 3 variants (thumbnail, medium, large) but not small
      expect(Object.keys(variants)).toHaveLength(3);
      expect(variants).toHaveProperty('thumbnail');
      expect(variants).not.toHaveProperty('small');
      expect(variants).toHaveProperty('medium');
      expect(variants).toHaveProperty('large');
    });

    it('should throw error if all variants fail', async () => {
      mockSharp.toBuffer.mockRejectedValue(new Error('All processing failed'));

      await expect(service.generateVariants(mockImageBuffer)).rejects.toThrow(
        'Failed to generate image variants',
      );
    });
  });

  describe('uploadVariants', () => {
    const mockVariants = {
      thumbnail: {
        buffer: Buffer.from('thumbnail-data'),
        format: 'jpeg',
        size: 1024,
        width: 150,
        height: 150,
        quality: 80,
      },
      medium: {
        buffer: Buffer.from('medium-data'),
        format: 'webp',
        size: 2048,
        width: 800,
        height: 600,
        quality: 90,
      },
    };

    it('should upload all variants to S3', async () => {
      mockS3.upload.mockReturnValue({
        promise: () => Promise.resolve({
          Location: 'https://s3.amazonaws.com/bucket/key',
          ETag: '"test-etag"',
        }),
      });

      const result = await service.uploadVariants(
        mockVariants,
        'original/key.jpg',
        'test-bucket',
      );

      expect(mockS3.upload).toHaveBeenCalledTimes(2);
      expect(result).toHaveProperty('thumbnail');
      expect(result).toHaveProperty('medium');
      expect(result.thumbnail.s3Key).toMatch(/original\/key_thumbnail\.jpeg$/);
      expect(result.medium.s3Key).toMatch(/original\/key_medium\.webp$/);
    });

    it('should handle upload failures gracefully', async () => {
      mockS3.upload
        .mockReturnValueOnce({
          promise: () => Promise.resolve({
            Location: 'https://s3.amazonaws.com/bucket/thumbnail',
            ETag: '"thumbnail-etag"',
          }),
        })
        .mockReturnValueOnce({
          promise: () => Promise.reject(new Error('Upload failed')),
        });

      const result = await service.uploadVariants(
        mockVariants,
        'original/key.jpg',
        'test-bucket',
      );

      // Should have thumbnail but not medium
      expect(result).toHaveProperty('thumbnail');
      expect(result).not.toHaveProperty('medium');
    });
  });

  describe('optimizeForUpload', () => {
    const mockImageBuffer = Buffer.from('fake-large-image-data');

    beforeEach(() => {
      const mockMetadata = {
        width: 3000,
        height: 2000,
        format: 'jpeg',
      };
      mockSharp.metadata.mockResolvedValue(mockMetadata);
    });

    it('should return original if already optimized', async () => {
      const smallBuffer = Buffer.alloc(1024); // 1KB
      mockSharp.metadata.mockResolvedValue({
        width: 800,
        height: 600,
        format: 'webp',
      });

      const result = await service.optimizeForUpload(smallBuffer, 'image/webp');

      expect(result.optimized).toBe(false);
      expect(result.buffer).toBe(smallBuffer);
      expect(result.compressionRatio).toBe(1);
    });

    it('should optimize large images', async () => {
      const optimizedBuffer = Buffer.alloc(1024); // Much smaller
      mockSharp.toBuffer.mockResolvedValue(optimizedBuffer);

      const result = await service.optimizeForUpload(
        mockImageBuffer,
        'image/jpeg',
        2 * 1024 * 1024, // 2MB target
      );

      expect(result.optimized).toBe(true);
      expect(result.contentType).toBe('image/webp');
      expect(result.compressionRatio).toBeGreaterThan(1);
      expect(mockSharp.resize).toHaveBeenCalled();
      expect(mockSharp.webp).toHaveBeenCalled();
    });

    it('should reduce quality iteratively to meet target size', async () => {
      // First attempt is too large, second is acceptable
      mockSharp.toBuffer
        .mockResolvedValueOnce(Buffer.alloc(6 * 1024 * 1024)) // 6MB - too large
        .mockResolvedValueOnce(Buffer.alloc(4 * 1024 * 1024)); // 4MB - acceptable

      const result = await service.optimizeForUpload(
        mockImageBuffer,
        'image/jpeg',
        5 * 1024 * 1024, // 5MB target
      );

      expect(result.optimized).toBe(true);
      expect(result.qualityUsed).toBeLessThan(90); // Quality was reduced
    });
  });

  describe('extractMetadata', () => {
    const mockImageBuffer = Buffer.from('fake-image-data');

    it('should extract comprehensive metadata', async () => {
      const mockMetadata = {
        width: 1920,
        height: 1080,
        format: 'jpeg',
        channels: 3,
        depth: 'uchar',
        density: 72,
        space: 'srgb',
        hasAlpha: false,
        pages: 1,
        orientation: 1,
        exif: Buffer.from('exif-data'),
      };
      mockSharp.metadata.mockResolvedValue(mockMetadata);

      const result = await service.extractMetadata(mockImageBuffer);

      expect(result).toMatchObject({
        width: 1920,
        height: 1080,
        format: 'jpeg',
        size: mockImageBuffer.length,
        channels: 3,
        depth: 'uchar',
        density: 72,
        colorSpace: 'srgb',
        hasAlpha: false,
        isAnimated: false,
        pages: 1,
        orientation: 1,
      });
      expect(result.exif).toEqual({ hasExif: true, size: 9 });
    });

    it('should handle metadata extraction errors', async () => {
      mockSharp.metadata.mockRejectedValue(new Error('Metadata extraction failed'));

      const result = await service.extractMetadata(mockImageBuffer);

      expect(result).toBeNull();
    });
  });

  describe('processImageUpload', () => {
    const mockImageBuffer = Buffer.from('fake-image-data');

    beforeEach(() => {
      mockS3.getObject.mockReturnValue({
        promise: () => Promise.resolve({ Body: mockImageBuffer }),
      });

      const mockMetadata = {
        width: 1920,
        height: 1080,
        format: 'jpeg',
      };
      mockSharp.metadata.mockResolvedValue(mockMetadata);
      
      const mockOptimizedBuffer = Buffer.from('optimized-data');
      mockSharp.toBuffer.mockResolvedValue(mockOptimizedBuffer);

      mockS3.upload.mockReturnValue({
        promise: () => Promise.resolve({
          Location: 'https://s3.amazonaws.com/bucket/variant',
          ETag: '"variant-etag"',
        }),
      });
    });

    it('should process image upload successfully', async () => {
      const result = await service.processImageUpload(
        'test-bucket',
        'test-key',
        'image/jpeg',
      );

      expect(result.success).toBe(true);
      expect(result.metadata).toBeDefined();
      expect(result.variants).toBeDefined();
      expect(result.variantCount).toBeGreaterThan(0);
      expect(mockS3.getObject).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'test-key',
      });
    });

    it('should handle validation failures', async () => {
      // Mock validation failure
      mockSharp.metadata.mockResolvedValue({
        width: 5000, // Too large
        height: 5000,
        format: 'jpeg',
      });

      const result = await service.processImageUpload(
        'test-bucket',
        'test-key',
        'image/jpeg',
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Image validation failed');
    });

    it('should handle S3 download errors', async () => {
      mockS3.getObject.mockReturnValue({
        promise: () => Promise.reject(new Error('S3 download failed')),
      });

      const result = await service.processImageUpload(
        'test-bucket',
        'test-key',
        'image/jpeg',
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('S3 download failed');
    });
  });

  describe('generateVariantS3Key', () => {
    it('should generate correct variant keys', () => {
      const originalKey = 'path/to/image.jpg';
      
      const thumbnailKey = service.generateVariantS3Key(originalKey, 'thumbnail', 'jpeg');
      expect(thumbnailKey).toBe('path/to/image_thumbnail.jpeg');

      const mediumKey = service.generateVariantS3Key(originalKey, 'medium', 'webp');
      expect(mediumKey).toBe('path/to/image_medium.webp');
    });

    it('should handle keys without extensions', () => {
      const originalKey = 'path/to/image';
      
      const thumbnailKey = service.generateVariantS3Key(originalKey, 'thumbnail', 'jpeg');
      expect(thumbnailKey).toBe('path/to/image_thumbnail.jpeg');
    });

    it('should handle keys with multiple dots', () => {
      const originalKey = 'path/to/image.backup.jpg';
      
      const thumbnailKey = service.generateVariantS3Key(originalKey, 'thumbnail', 'jpeg');
      expect(thumbnailKey).toBe('path/to/image.backup_thumbnail.jpeg');
    });
  });
});