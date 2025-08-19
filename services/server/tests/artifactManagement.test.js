const request = require('supertest');
const express = require('express');
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

describe('ArtifactManagementService', () => {
  let service;

  beforeEach(() => {
    service = new (require('../services/ArtifactManagementService').constructor)();
    jest.clearAllMocks();
  });

  describe('generateDownloadUrl', () => {
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
      },
    };

    beforeEach(() => {
      Artifact.find.mockResolvedValue(mockArtifact);
      mockS3.getSignedUrl.mockReturnValue('https://signed-url.com');
    });

    it('should generate download URL for original artifact', async () => {
      const result = await service.generateDownloadUrl(1, {
        expiresIn: 3600,
        userId: 123,
      });

      expect(result).toMatchObject({
        url: 'https://signed-url.com',
        cached: false,
        variant: 'original',
        contentType: 'image/jpeg',
        size: 1024,
      });

      expect(mockS3.getSignedUrl).toHaveBeenCalledWith('getObject', {
        Bucket: 'test-bucket',
        Key: 'test-key',
        Expires: 3600,
        ResponseContentDisposition: 'attachment; filename="test.jpg"',
      });
    });

    it('should generate download URL for image variant', async () => {
      const result = await service.generateDownloadUrl(1, {
        variant: 'thumbnail',
        userId: 123,
      });

      expect(result.variant).toBe('thumbnail');
      expect(mockS3.getSignedUrl).toHaveBeenCalledWith('getObject', {
        Bucket: 'test-bucket',
        Key: 'thumb-key',
        Expires: 3600,
        ResponseContentDisposition: 'attachment; filename="test.jpg"',
      });
    });

    it('should use cache for repeated requests', async () => {
      // First request
      const result1 = await service.generateDownloadUrl(1, { userId: 123 });
      expect(result1.cached).toBe(false);

      // Second request should be cached
      const result2 = await service.generateDownloadUrl(1, { userId: 123 });
      expect(result2.cached).toBe(true);
      expect(result2.url).toBe(result1.url);

      // S3 should only be called once
      expect(mockS3.getSignedUrl).toHaveBeenCalledTimes(1);
    });

    it('should handle custom response headers', async () => {
      await service.generateDownloadUrl(1, {
        responseContentType: 'application/octet-stream',
        responseContentDisposition: 'inline; filename="custom.jpg"',
      });

      expect(mockS3.getSignedUrl).toHaveBeenCalledWith('getObject', {
        Bucket: 'test-bucket',
        Key: 'test-key',
        Expires: 3600,
        ResponseContentType: 'application/octet-stream',
        ResponseContentDisposition: 'inline; filename="custom.jpg"',
      });
    });

    it('should throw error for non-existent artifact', async () => {
      Artifact.find.mockResolvedValue(null);

      await expect(service.generateDownloadUrl(999)).rejects.toThrow('Artifact not found');
    });
  });

  describe('generateBatchDownload', () => {
    const mockArtifacts = [
      {
        id: 1,
        s3_bucket: 'test-bucket',
        s3_key: 'file1.jpg',
        size_bytes: 1024,
        metadata: { originalname: 'file1.jpg' },
        image_variants: {
          thumbnail: { s3_key: 'thumb1.jpg', size: 512 },
        },
      },
      {
        id: 2,
        s3_bucket: 'test-bucket',
        s3_key: 'file2.pdf',
        size_bytes: 2048,
        metadata: { originalname: 'file2.pdf' },
      },
    ];

    beforeEach(() => {
      Artifact.find
        .mockResolvedValueOnce(mockArtifacts[0])
        .mockResolvedValueOnce(mockArtifacts[1]);

      mockS3.getObject.mockReturnValue({
        createReadStream: jest.fn(() => ({
          pipe: jest.fn(),
          on: jest.fn(),
        })),
      });
    });

    it('should generate batch download archive', async () => {
      const result = await service.generateBatchDownload([1, 2], {
        userId: 123,
      });

      expect(result).toMatchObject({
        totalFiles: 2,
        totalSize: 3072,
        estimatedCompressedSize: expect.any(Number),
      });

      expect(result.archive).toBeDefined();
    });

    it('should include image variants when requested', async () => {
      const result = await service.generateBatchDownload([1, 2], {
        includeVariants: true,
        userId: 123,
      });

      expect(result.totalFiles).toBe(3); // 2 originals + 1 variant
      expect(result.totalSize).toBe(3584); // 3072 + 512
    });

    it('should respect size limits', async () => {
      await expect(
        service.generateBatchDownload([1, 2], {
          maxTotalSize: 1000, // Smaller than total size
        })
      ).rejects.toThrow('Total download size');
    });

    it('should handle compression level', async () => {
      const result = await service.generateBatchDownload([1, 2], {
        compressionLevel: 9,
      });

      expect(result.archive).toBeDefined();
    });
  });

  describe('getImageGallery', () => {
    const mockImageArtifacts = [
      {
        id: 1,
        bug_report_id: 1,
        content_type: 'image/jpeg',
        size_bytes: 1024,
        created_at: '2023-01-01T00:00:00Z',
        metadata: { originalname: 'screenshot1.jpg' },
        image_metadata: { width: 1920, height: 1080 },
        image_variants: {
          thumbnail: { s3_key: 'thumb1.jpg', size: 512 },
        },
        ocr_text: 'Login button',
        visual_elements: { buttons: 1, forms: 1 },
      },
      {
        id: 2,
        bug_report_id: 1,
        content_type: 'image/png',
        size_bytes: 2048,
        created_at: '2023-01-02T00:00:00Z',
        metadata: { originalname: 'diagram.png' },
        image_metadata: { width: 800, height: 600 },
      },
    ];

    beforeEach(() => {
      // Mock the query builder
      const mockQuery = {
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockResolvedValue(mockImageArtifacts),
      };

      Artifact.query = jest.fn(() => mockQuery);
      mockS3.getSignedUrl.mockReturnValue('https://signed-url.com');
    });

    it('should return image gallery with metadata', async () => {
      const result = await service.getImageGallery(1, {
        includeVariants: true,
        limit: 10,
        offset: 0,
      });

      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toMatchObject({
        id: 1,
        originalFilename: 'screenshot1.jpg',
        contentType: 'image/jpeg',
        size: 1024,
        metadata: { width: 1920, height: 1080 },
        ocrText: 'Login button',
        visualElements: { buttons: 1, forms: 1 },
      });

      expect(result.items[0].downloadUrl).toBeDefined();
      expect(result.items[0].variants.thumbnail).toBeDefined();
    });

    it('should support pagination', async () => {
      await service.getImageGallery(1, {
        limit: 5,
        offset: 10,
      });

      const mockQuery = Artifact.query();
      expect(mockQuery.limit).toHaveBeenCalledWith(5);
      expect(mockQuery.offset).toHaveBeenCalledWith(10);
    });

    it('should support sorting options', async () => {
      await service.getImageGallery(1, {
        sortBy: 'size_bytes',
        sortOrder: 'asc',
      });

      const mockQuery = Artifact.query();
      expect(mockQuery.orderBy).toHaveBeenCalledWith('size_bytes', 'asc');
    });
  });

  describe('getCachedProcessedContent', () => {
    const mockArtifact = {
      id: 1,
      s3_bucket: 'test-bucket',
      parsed_content_s3_key: 'processed/content.json',
      content_summary: 'Test summary',
      processing_stages: ['parsed', 'analyzed'],
    };

    beforeEach(() => {
      Artifact.find.mockResolvedValue(mockArtifact);
      mockS3.getObject.mockReturnValue({
        promise: jest.fn().mockResolvedValue({
          Body: Buffer.from('{"test": "data"}'),
        }),
      });
    });

    it('should return processed content with metadata', async () => {
      const result = await service.getCachedProcessedContent(1, {
        format: 'json',
        compress: false,
        userId: 123,
      });

      expect(result).toMatchObject({
        content: '{\n  "test": "data"\n}',
        cached: false,
        contentType: 'application/json',
        summary: 'Test summary',
        processingStages: ['parsed', 'analyzed'],
      });
    });

    it('should use cache for repeated requests', async () => {
      // First request
      const result1 = await service.getCachedProcessedContent(1);
      expect(result1.cached).toBe(false);

      // Second request should be cached
      const result2 = await service.getCachedProcessedContent(1);
      expect(result2.cached).toBe(true);

      expect(mockS3.getObject).toHaveBeenCalledTimes(1);
    });

    it('should handle different formats', async () => {
      const result = await service.getCachedProcessedContent(1, {
        format: 'text',
      });

      expect(result.contentType).toBe('text/plain');
    });

    it('should handle compression', async () => {
      const result = await service.getCachedProcessedContent(1, {
        format: 'json',
        compress: true,
      });

      expect(result.content).toBe('{"test":"data"}');
    });
  });

  describe('cleanupArtifacts', () => {
    const mockOldArtifacts = [
      {
        id: 1,
        s3_bucket: 'test-bucket',
        s3_key: 'old-file1.jpg',
        size_bytes: 1024,
        created_at: '2022-01-01T00:00:00Z',
        image_variants: {
          thumbnail: { s3_key: 'old-thumb1.jpg', size: 512 },
        },
        parsed_content_s3_key: 'old-processed1.json',
        delete: jest.fn().mockResolvedValue(true),
      },
      {
        id: 2,
        s3_bucket: 'test-bucket',
        s3_key: 'old-file2.pdf',
        size_bytes: 2048,
        created_at: '2022-01-02T00:00:00Z',
        delete: jest.fn().mockResolvedValue(true),
      },
    ];

    beforeEach(() => {
      // Mock the query builder for cleanup
      const mockQuery = {
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue(mockOldArtifacts),
      };

      Artifact.query = jest.fn(() => mockQuery);
      mockS3.deleteObjects.mockReturnValue({
        promise: jest.fn().mockResolvedValue({}),
      });
    });

    it('should perform dry run cleanup', async () => {
      const result = await service.cleanupArtifacts({
        olderThanDays: 90,
        dryRun: true,
        batchSize: 10,
      });

      expect(result).toMatchObject({
        processed: 2,
        deleted: 4, // 2 files + 1 variant + 1 processed content
        errors: 0,
        totalSize: 3584,
      });

      expect(mockS3.deleteObjects).not.toHaveBeenCalled();
      expect(mockOldArtifacts[0].delete).not.toHaveBeenCalled();
    });

    it('should perform actual cleanup', async () => {
      const result = await service.cleanupArtifacts({
        olderThanDays: 90,
        dryRun: false,
        batchSize: 10,
      });

      expect(result.processed).toBe(2);
      expect(mockS3.deleteObjects).toHaveBeenCalledTimes(2);
      expect(mockOldArtifacts[0].delete).toHaveBeenCalled();
      expect(mockOldArtifacts[1].delete).toHaveBeenCalled();
    });

    it('should handle cleanup errors gracefully', async () => {
      mockS3.deleteObjects.mockReturnValue({
        promise: jest.fn().mockRejectedValue(new Error('S3 error')),
      });

      const result = await service.cleanupArtifacts({
        olderThanDays: 90,
        dryRun: false,
      });

      expect(result.errors).toBe(2);
    });
  });

  describe('Performance Tests', () => {
    it('should handle concurrent download URL generation', async () => {
      const mockArtifact = {
        id: 1,
        s3_bucket: 'test-bucket',
        s3_key: 'test-key',
        content_type: 'image/jpeg',
        metadata: { originalname: 'test.jpg' },
      };

      Artifact.find.mockResolvedValue(mockArtifact);
      mockS3.getSignedUrl.mockReturnValue('https://signed-url.com');

      const startTime = Date.now();
      
      // Generate 100 concurrent requests
      const promises = Array.from({ length: 100 }, (_, i) =>
        service.generateDownloadUrl(1, { userId: i })
      );

      const results = await Promise.all(promises);
      const endTime = Date.now();

      expect(results).toHaveLength(100);
      expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second
      
      // First request should not be cached, rest should be
      expect(results[0].cached).toBe(false);
      expect(results[99].cached).toBe(true);
    });

    it('should handle large batch downloads efficiently', async () => {
      const mockArtifacts = Array.from({ length: 50 }, (_, i) => ({
        id: i + 1,
        s3_bucket: 'test-bucket',
        s3_key: `file${i + 1}.jpg`,
        size_bytes: 1024,
        metadata: { originalname: `file${i + 1}.jpg` },
      }));

      // Mock Artifact.find for each artifact
      mockArtifacts.forEach((artifact) => {
        Artifact.find.mockResolvedValueOnce(artifact);
      });

      mockS3.getObject.mockReturnValue({
        createReadStream: jest.fn(() => ({
          pipe: jest.fn(),
          on: jest.fn(),
        })),
      });

      const startTime = Date.now();
      const artifactIds = mockArtifacts.map(a => a.id);
      
      const result = await service.generateBatchDownload(artifactIds);
      const endTime = Date.now();

      expect(result.totalFiles).toBe(50);
      expect(endTime - startTime).toBeLessThan(2000); // Should complete within 2 seconds
    });

    it('should efficiently manage cache memory usage', async () => {
      const mockArtifact = {
        id: 1,
        s3_bucket: 'test-bucket',
        s3_key: 'test-key',
        content_type: 'image/jpeg',
        metadata: { originalname: 'test.jpg' },
      };

      Artifact.find.mockResolvedValue(mockArtifact);
      mockS3.getSignedUrl.mockReturnValue('https://signed-url.com');

      // Generate many cache entries
      for (let i = 0; i < 1000; i++) {
        await service.generateDownloadUrl(1, { userId: i });
      }

      const stats = service.getCacheStats();
      expect(stats.size).toBeLessThanOrEqual(1000);

      // Clear cache and verify
      service.clearCache();
      const clearedStats = service.getCacheStats();
      expect(clearedStats.size).toBe(0);
    });
  });

  describe('Cache Management', () => {
    it('should provide accurate cache statistics', () => {
      const stats = service.getCacheStats();
      
      expect(stats).toMatchObject({
        size: expect.any(Number),
        timeout: expect.any(Number),
        entries: expect.any(Array),
      });
    });

    it('should clear cache successfully', () => {
      service.clearCache();
      const stats = service.getCacheStats();
      expect(stats.size).toBe(0);
    });
  });
});

describe('Artifact Controller Integration Tests', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    
    // Mock middleware
    app.use((req, res, next) => {
      req.user = { id: 123 };
      next();
    });

    // Add routes
    const artifactController = require('../controllers/artifactController');
    app.get('/api/artifacts/:artifactId/download', artifactController.getDownloadUrl);
    app.post('/api/bugs/:bugId/batch-download', artifactController.getBatchDownload);
    app.get('/api/bugs/:bugId/image-gallery', artifactController.getImageGallery);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should handle download URL requests', async () => {
    const mockArtifact = {
      id: 1,
      bug_report_id: 1,
      s3_bucket: 'test-bucket',
      s3_key: 'test-key',
      content_type: 'image/jpeg',
      metadata: { originalname: 'test.jpg' },
    };

    const mockBugReport = { id: 1, team_id: 1 };
    const mockTeamMembers = [{ user_id: 123 }];

    Artifact.find.mockResolvedValue(mockArtifact);
    const BugReport = require('../models/BugReport');
    const Team = require('../models/Team');
    
    BugReport.find = jest.fn().mockResolvedValue(mockBugReport);
    Team.getMembers = jest.fn().mockResolvedValue(mockTeamMembers);

    mockS3.getSignedUrl.mockReturnValue('https://signed-url.com');

    const response = await request(app)
      .get('/api/artifacts/1/download')
      .query({ variant: 'thumbnail', expiresIn: 7200 });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.url).toBe('https://signed-url.com');
  });

  it('should handle batch download requests', async () => {
    const mockBugReport = { id: 1, team_id: 1 };
    const mockTeamMembers = [{ user_id: 123 }];
    const mockArtifacts = [
      { id: 1, bug_report_id: 1, s3_bucket: 'test', s3_key: 'key1' },
      { id: 2, bug_report_id: 1, s3_bucket: 'test', s3_key: 'key2' },
    ];

    const BugReport = require('../models/BugReport');
    const Team = require('../models/Team');
    
    BugReport.find = jest.fn().mockResolvedValue(mockBugReport);
    Team.getMembers = jest.fn().mockResolvedValue(mockTeamMembers);
    Artifact.find
      .mockResolvedValueOnce(mockArtifacts[0])
      .mockResolvedValueOnce(mockArtifacts[1]);

    mockS3.getObject.mockReturnValue({
      createReadStream: jest.fn(() => ({
        pipe: jest.fn(),
        on: jest.fn(),
      })),
    });

    const response = await request(app)
      .post('/api/bugs/1/batch-download')
      .send({
        artifactIds: [1, 2],
        includeVariants: true,
        compressionLevel: 6,
      });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/zip');
    expect(response.headers['x-total-files']).toBeDefined();
  });
});