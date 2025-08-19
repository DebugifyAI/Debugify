const ArtifactManagementService = require('../services/ArtifactManagementService');
const Artifact = require('../models/Artifact');

// Mock dependencies
jest.mock('../models/Artifact');
jest.mock('../utils/SecureCredentialManager');
jest.mock('../middleware/auditLogger');
jest.mock('aws-sdk');

const mockS3 = {
  getSignedUrl: jest.fn(),
  getObject: jest.fn(),
  deleteObjects: jest.fn(),
};

const mockAWS = require('aws-sdk');
mockAWS.S3 = jest.fn(() => mockS3);

describe('Artifact Management Performance Tests', () => {
  let service;

  beforeEach(() => {
    service = new (require('../services/ArtifactManagementService').constructor)();
    jest.clearAllMocks();
  });

  describe('Download URL Generation Performance', () => {
    const mockArtifact = {
      id: 1,
      s3_bucket: 'test-bucket',
      s3_key: 'test-key',
      content_type: 'image/jpeg',
      size_bytes: 1024,
      metadata: { originalname: 'test.jpg' },
      image_variants: {
        thumbnail: { s3_key: 'thumb-key', size: 512 },
        web: { s3_key: 'web-key', size: 2048 },
        full: { s3_key: 'full-key', size: 4096 },
      },
    };

    beforeEach(() => {
      Artifact.find.mockResolvedValue(mockArtifact);
      mockS3.getSignedUrl.mockReturnValue('https://signed-url.com');
    });

    it('should generate single download URL within performance threshold', async () => {
      const startTime = process.hrtime.bigint();
      
      await service.generateDownloadUrl(1, { userId: 123 });
      
      const endTime = process.hrtime.bigint();
      const durationMs = Number(endTime - startTime) / 1000000;
      
      expect(durationMs).toBeLessThan(100); // Should complete within 100ms
    });

    it('should handle concurrent URL generation efficiently', async () => {
      const concurrentRequests = 100;
      const startTime = process.hrtime.bigint();
      
      const promises = Array.from({ length: concurrentRequests }, (_, i) =>
        service.generateDownloadUrl(1, { userId: i })
      );
      
      const results = await Promise.all(promises);
      
      const endTime = process.hrtime.bigint();
      const durationMs = Number(endTime - startTime) / 1000000;
      
      expect(results).toHaveLength(concurrentRequests);
      expect(durationMs).toBeLessThan(500); // Should complete within 500ms
      
      // Verify caching effectiveness
      const cachedResults = results.filter(r => r.cached);
      expect(cachedResults.length).toBeGreaterThan(90); // Most should be cached
    });

    it('should handle variant URL generation efficiently', async () => {
      const variants = ['thumbnail', 'web', 'full'];
      const startTime = process.hrtime.bigint();
      
      const promises = variants.map(variant =>
        service.generateDownloadUrl(1, { variant, userId: 123 })
      );
      
      const results = await Promise.all(promises);
      
      const endTime = process.hrtime.bigint();
      const durationMs = Number(endTime - startTime) / 1000000;
      
      expect(results).toHaveLength(3);
      expect(durationMs).toBeLessThan(150); // Should complete within 150ms
      expect(results.map(r => r.variant)).toEqual(['thumbnail', 'web', 'full']);
    });

    it('should maintain cache performance under load', async () => {
      // Pre-populate cache
      await service.generateDownloadUrl(1, { userId: 123 });
      
      const iterations = 1000;
      const startTime = process.hrtime.bigint();
      
      const promises = Array.from({ length: iterations }, () =>
        service.generateDownloadUrl(1, { userId: 123 })
      );
      
      const results = await Promise.all(promises);
      
      const endTime = process.hrtime.bigint();
      const durationMs = Number(endTime - startTime) / 1000000;
      
      expect(results).toHaveLength(iterations);
      expect(durationMs).toBeLessThan(100); // Cached requests should be very fast
      expect(results.every(r => r.cached)).toBe(true);
    });
  });

  describe('Batch Download Performance', () => {
    const createMockArtifacts = (count) => {
      return Array.from({ length: count }, (_, i) => ({
        id: i + 1,
        s3_bucket: 'test-bucket',
        s3_key: `file${i + 1}.jpg`,
        size_bytes: 1024 * (i + 1),
        metadata: { originalname: `file${i + 1}.jpg` },
        image_variants: i % 2 === 0 ? {
          thumbnail: { s3_key: `thumb${i + 1}.jpg`, size: 512 },
        } : null,
      }));
    };

    beforeEach(() => {
      mockS3.getObject.mockReturnValue({
        createReadStream: jest.fn(() => ({
          pipe: jest.fn(),
          on: jest.fn(),
        })),
      });
    });

    it('should handle small batch downloads efficiently', async () => {
      const artifacts = createMockArtifacts(5);
      artifacts.forEach(artifact => {
        Artifact.find.mockResolvedValueOnce(artifact);
      });

      const startTime = process.hrtime.bigint();
      
      const result = await service.generateBatchDownload([1, 2, 3, 4, 5], {
        userId: 123,
      });
      
      const endTime = process.hrtime.bigint();
      const durationMs = Number(endTime - startTime) / 1000000;
      
      expect(result.totalFiles).toBe(5);
      expect(durationMs).toBeLessThan(200); // Should complete within 200ms
    });

    it('should handle medium batch downloads with variants', async () => {
      const artifacts = createMockArtifacts(25);
      artifacts.forEach(artifact => {
        Artifact.find.mockResolvedValueOnce(artifact);
      });

      const startTime = process.hrtime.bigint();
      
      const result = await service.generateBatchDownload(
        artifacts.map(a => a.id),
        {
          includeVariants: true,
          userId: 123,
        }
      );
      
      const endTime = process.hrtime.bigint();
      const durationMs = Number(endTime - startTime) / 1000000;
      
      expect(result.totalFiles).toBeGreaterThan(25); // Should include variants
      expect(durationMs).toBeLessThan(1000); // Should complete within 1 second
    });

    it('should handle large batch downloads efficiently', async () => {
      const artifacts = createMockArtifacts(100);
      artifacts.forEach(artifact => {
        Artifact.find.mockResolvedValueOnce(artifact);
      });

      const startTime = process.hrtime.bigint();
      
      const result = await service.generateBatchDownload(
        artifacts.map(a => a.id),
        {
          compressionLevel: 1, // Fastest compression
          userId: 123,
        }
      );
      
      const endTime = process.hrtime.bigint();
      const durationMs = Number(endTime - startTime) / 1000000;
      
      expect(result.totalFiles).toBe(100);
      expect(durationMs).toBeLessThan(3000); // Should complete within 3 seconds
    });

    it('should respect size limits efficiently', async () => {
      const artifacts = createMockArtifacts(10);
      artifacts.forEach(artifact => {
        Artifact.find.mockResolvedValueOnce(artifact);
      });

      const startTime = process.hrtime.bigint();
      
      await expect(
        service.generateBatchDownload(
          artifacts.map(a => a.id),
          {
            maxTotalSize: 1000, // Very small limit
            userId: 123,
          }
        )
      ).rejects.toThrow('Total download size');
      
      const endTime = process.hrtime.bigint();
      const durationMs = Number(endTime - startTime) / 1000000;
      
      expect(durationMs).toBeLessThan(100); // Should fail fast
    });
  });

  describe('Image Gallery Performance', () => {
    const createMockImageArtifacts = (count) => {
      return Array.from({ length: count }, (_, i) => ({
        id: i + 1,
        bug_report_id: 1,
        content_type: 'image/jpeg',
        size_bytes: 1024 * (i + 1),
        created_at: new Date(Date.now() - i * 86400000).toISOString(),
        metadata: { originalname: `image${i + 1}.jpg` },
        image_metadata: { width: 1920, height: 1080 },
        image_variants: {
          thumbnail: { s3_key: `thumb${i + 1}.jpg`, size: 512 },
          web: { s3_key: `web${i + 1}.jpg`, size: 2048 },
        },
        ocr_text: `Text content ${i + 1}`,
        visual_elements: { buttons: i % 3, forms: i % 2 },
      }));
    };

    beforeEach(() => {
      mockS3.getSignedUrl.mockReturnValue('https://signed-url.com');
    });

    it('should load small image gallery efficiently', async () => {
      const artifacts = createMockImageArtifacts(10);
      
      const mockQuery = {
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockResolvedValue(artifacts),
      };
      
      Artifact.query = jest.fn(() => mockQuery);

      const startTime = process.hrtime.bigint();
      
      const result = await service.getImageGallery(1, {
        includeVariants: true,
        limit: 10,
        offset: 0,
      });
      
      const endTime = process.hrtime.bigint();
      const durationMs = Number(endTime - startTime) / 1000000;
      
      expect(result.items).toHaveLength(10);
      expect(durationMs).toBeLessThan(300); // Should complete within 300ms
    });

    it('should handle large image gallery with pagination', async () => {
      const artifacts = createMockImageArtifacts(50);
      
      const mockQuery = {
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockResolvedValue(artifacts),
      };
      
      Artifact.query = jest.fn(() => mockQuery);

      const startTime = process.hrtime.bigint();
      
      const result = await service.getImageGallery(1, {
        includeVariants: true,
        limit: 50,
        offset: 0,
      });
      
      const endTime = process.hrtime.bigint();
      const durationMs = Number(endTime - startTime) / 1000000;
      
      expect(result.items).toHaveLength(50);
      expect(durationMs).toBeLessThan(1000); // Should complete within 1 second
      
      // Verify all items have required URLs
      expect(result.items.every(item => item.downloadUrl)).toBe(true);
      expect(result.items.every(item => item.variants.thumbnail)).toBe(true);
    });

    it('should optimize gallery loading without variants', async () => {
      const artifacts = createMockImageArtifacts(100);
      
      const mockQuery = {
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockResolvedValue(artifacts),
      };
      
      Artifact.query = jest.fn(() => mockQuery);

      const startTime = process.hrtime.bigint();
      
      const result = await service.getImageGallery(1, {
        includeVariants: false, // Should be faster without variants
        limit: 100,
        offset: 0,
      });
      
      const endTime = process.hrtime.bigint();
      const durationMs = Number(endTime - startTime) / 1000000;
      
      expect(result.items).toHaveLength(100);
      expect(durationMs).toBeLessThan(800); // Should be faster without variants
      
      // Verify no variant URLs are generated
      expect(result.items.every(item => Object.keys(item.variants).length === 0)).toBe(true);
    });
  });

  describe('Processed Content Caching Performance', () => {
    const mockArtifact = {
      id: 1,
      s3_bucket: 'test-bucket',
      parsed_content_s3_key: 'processed/content.json',
      content_summary: 'Test summary',
      processing_stages: ['parsed', 'analyzed'],
    };

    beforeEach(() => {
      Artifact.find.mockResolvedValue(mockArtifact);
    });

    it('should load processed content efficiently on first request', async () => {
      const largeContent = JSON.stringify({ data: 'x'.repeat(10000) });
      mockS3.getObject.mockReturnValue({
        promise: jest.fn().mockResolvedValue({
          Body: Buffer.from(largeContent),
        }),
      });

      const startTime = process.hrtime.bigint();
      
      const result = await service.getCachedProcessedContent(1, {
        format: 'json',
        compress: false,
        userId: 123,
      });
      
      const endTime = process.hrtime.bigint();
      const durationMs = Number(endTime - startTime) / 1000000;
      
      expect(result.cached).toBe(false);
      expect(durationMs).toBeLessThan(200); // Should complete within 200ms
    });

    it('should serve cached content very quickly', async () => {
      const content = '{"test": "data"}';
      mockS3.getObject.mockReturnValue({
        promise: jest.fn().mockResolvedValue({
          Body: Buffer.from(content),
        }),
      });

      // First request to populate cache
      await service.getCachedProcessedContent(1, { userId: 123 });

      const startTime = process.hrtime.bigint();
      
      const result = await service.getCachedProcessedContent(1, { userId: 123 });
      
      const endTime = process.hrtime.bigint();
      const durationMs = Number(endTime - startTime) / 1000000;
      
      expect(result.cached).toBe(true);
      expect(durationMs).toBeLessThan(10); // Cached requests should be very fast
    });

    it('should handle concurrent processed content requests', async () => {
      const content = '{"test": "data"}';
      mockS3.getObject.mockReturnValue({
        promise: jest.fn().mockResolvedValue({
          Body: Buffer.from(content),
        }),
      });

      const concurrentRequests = 50;
      const startTime = process.hrtime.bigint();
      
      const promises = Array.from({ length: concurrentRequests }, (_, i) =>
        service.getCachedProcessedContent(1, { userId: i })
      );
      
      const results = await Promise.all(promises);
      
      const endTime = process.hrtime.bigint();
      const durationMs = Number(endTime - startTime) / 1000000;
      
      expect(results).toHaveLength(concurrentRequests);
      expect(durationMs).toBeLessThan(300); // Should complete within 300ms
      
      // Most should be cached after the first request
      const cachedResults = results.filter(r => r.cached);
      expect(cachedResults.length).toBeGreaterThan(40);
    });
  });

  describe('Cleanup Performance', () => {
    const createMockOldArtifacts = (count) => {
      return Array.from({ length: count }, (_, i) => ({
        id: i + 1,
        s3_bucket: 'test-bucket',
        s3_key: `old-file${i + 1}.jpg`,
        size_bytes: 1024 * (i + 1),
        created_at: new Date(Date.now() - (i + 90) * 86400000).toISOString(),
        image_variants: i % 2 === 0 ? {
          thumbnail: { s3_key: `old-thumb${i + 1}.jpg`, size: 512 },
        } : null,
        parsed_content_s3_key: i % 3 === 0 ? `old-processed${i + 1}.json` : null,
        delete: jest.fn().mockResolvedValue(true),
      }));
    };

    beforeEach(() => {
      mockS3.deleteObjects.mockReturnValue({
        promise: jest.fn().mockResolvedValue({}),
      });
    });

    it('should perform dry run cleanup efficiently', async () => {
      const artifacts = createMockOldArtifacts(100);
      
      const mockQuery = {
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue(artifacts),
      };
      
      Artifact.query = jest.fn(() => mockQuery);

      const startTime = process.hrtime.bigint();
      
      const result = await service.cleanupArtifacts({
        olderThanDays: 90,
        dryRun: true,
        batchSize: 100,
      });
      
      const endTime = process.hrtime.bigint();
      const durationMs = Number(endTime - startTime) / 1000000;
      
      expect(result.processed).toBe(100);
      expect(durationMs).toBeLessThan(500); // Should complete within 500ms
      expect(mockS3.deleteObjects).not.toHaveBeenCalled();
    });

    it('should perform actual cleanup in batches efficiently', async () => {
      const artifacts = createMockOldArtifacts(50);
      
      const mockQuery = {
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue(artifacts),
      };
      
      Artifact.query = jest.fn(() => mockQuery);

      const startTime = process.hrtime.bigint();
      
      const result = await service.cleanupArtifacts({
        olderThanDays: 90,
        dryRun: false,
        batchSize: 50,
      });
      
      const endTime = process.hrtime.bigint();
      const durationMs = Number(endTime - startTime) / 1000000;
      
      expect(result.processed).toBe(50);
      expect(durationMs).toBeLessThan(2000); // Should complete within 2 seconds
      expect(mockS3.deleteObjects).toHaveBeenCalled();
    });
  });

  describe('Memory Usage and Cache Management', () => {
    it('should maintain reasonable memory usage under load', async () => {
      const mockArtifact = {
        id: 1,
        s3_bucket: 'test-bucket',
        s3_key: 'test-key',
        content_type: 'image/jpeg',
        metadata: { originalname: 'test.jpg' },
      };

      Artifact.find.mockResolvedValue(mockArtifact);
      mockS3.getSignedUrl.mockReturnValue('https://signed-url.com');

      const initialMemory = process.memoryUsage().heapUsed;
      
      // Generate many cache entries
      for (let i = 0; i < 1000; i++) {
        await service.generateDownloadUrl(1, { userId: i });
      }
      
      const afterCacheMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = afterCacheMemory - initialMemory;
      
      // Memory increase should be reasonable (less than 10MB for 1000 entries)
      expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024);
      
      // Clear cache and verify memory is released
      service.clearCache();
      
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }
      
      const afterClearMemory = process.memoryUsage().heapUsed;
      expect(afterClearMemory).toBeLessThan(afterCacheMemory);
    });

    it('should handle cache expiration efficiently', async () => {
      const mockArtifact = {
        id: 1,
        s3_bucket: 'test-bucket',
        s3_key: 'test-key',
        content_type: 'image/jpeg',
        metadata: { originalname: 'test.jpg' },
      };

      Artifact.find.mockResolvedValue(mockArtifact);
      mockS3.getSignedUrl.mockReturnValue('https://signed-url.com');

      // Create service with very short cache timeout for testing
      const shortCacheService = new (require('../services/ArtifactManagementService').constructor)();
      shortCacheService.cacheTimeout = 10; // 10ms timeout

      // First request
      const result1 = await shortCacheService.generateDownloadUrl(1, { userId: 123 });
      expect(result1.cached).toBe(false);

      // Immediate second request should be cached
      const result2 = await shortCacheService.generateDownloadUrl(1, { userId: 123 });
      expect(result2.cached).toBe(true);

      // Wait for cache to expire
      await new Promise(resolve => setTimeout(resolve, 20));

      // Third request should not be cached
      const result3 = await shortCacheService.generateDownloadUrl(1, { userId: 123 });
      expect(result3.cached).toBe(false);
    });
  });
});