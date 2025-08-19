const request = require('supertest');
const express = require('express');
const aws = require('aws-sdk');
const uploadController = require('../controllers/uploadController');
const Artifact = require('../models/Artifact');
const Team = require('../models/Team');
const BugReport = require('../models/BugReport');
const { enqueueFileProcessingJob } = require('../queues/fileProcessingQueue');

// Mock dependencies
jest.mock('aws-sdk');
jest.mock('../models/Artifact');
jest.mock('../models/Team');
jest.mock('../models/BugReport');
jest.mock('../queues/fileProcessingQueue');

// Create Express app for testing
const app = express();
app.use(express.json());

// Mock authentication middleware
app.use((req, res, next) => {
  req.user = { id: 1 };
  next();
});

// Setup routes
app.post('/bugs/:bugId/upload/presign', uploadController.presignUpload);
app.post('/bugs/:bugId/upload/multipart/urls', uploadController.getMultipartUploadUrls);
app.post('/bugs/:bugId/upload/multipart/complete', uploadController.completeMultipartUpload);
app.post('/bugs/:bugId/upload/multipart/abort', uploadController.abortMultipartUpload);
app.post('/bugs/:bugId/upload/confirm', uploadController.confirmUploads);
app.get('/bugs/:bugId/upload/:uploadId/progress', uploadController.getUploadProgress);

describe('Upload Controller', () => {
  let mockS3;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock S3 instance
    mockS3 = {
      getSignedUrl: jest.fn(),
      createMultipartUpload: jest.fn(),
      completeMultipartUpload: jest.fn(),
      abortMultipartUpload: jest.fn(),
      headObject: jest.fn(),
      listParts: jest.fn(),
    };

    aws.S3.mockImplementation(() => mockS3);

    // Mock environment variables
    process.env.AWS_S3_BUCKET_NAME = 'test-bucket';
    process.env.AWS_ACCESS_KEY_ID = 'test-key';
    process.env.AWS_SECRET_ACCESS_KEY = 'test-secret';
    process.env.AWS_REGION = 'us-east-1';
  });

  describe('presignUpload', () => {
    beforeEach(() => {
      BugReport.find.mockResolvedValue({ id: 1, team_id: 1 });
      Team.getMembers.mockResolvedValue([{ user_id: 1 }]);
    });

    it('should generate presigned URL for valid small file', async () => {
      const mockPresignedUrl = 'https://s3.amazonaws.com/test-bucket/test-key?signature=abc';
      mockS3.getSignedUrl.mockReturnValue(mockPresignedUrl);

      const response = await request(app)
        .post('/bugs/1/upload/presign')
        .send({
          filename: 'test.jpg',
          contentType: 'image/jpeg',
          fileSize: 1024 * 1024, // 1MB
        });

      expect(response.status).toBe(200);
      expect(response.body.type).toBe('standard');
      expect(response.body.url).toBe(mockPresignedUrl);
      expect(response.body.bucket).toBe('test-bucket');
      expect(response.body.key).toMatch(/^bug-reports\/1\/artifacts\/1\/\d+-\d+-test\.jpg$/);
    });

    it('should initiate multipart upload for large file', async () => {
      const mockUploadId = 'test-upload-id';
      mockS3.createMultipartUpload.mockReturnValue({
        promise: () => Promise.resolve({ UploadId: mockUploadId }),
      });

      const response = await request(app)
        .post('/bugs/1/upload/presign')
        .send({
          filename: 'large-file.zip',
          contentType: 'application/zip',
          fileSize: 200 * 1024 * 1024, // 200MB
        });

      expect(response.status).toBe(200);
      expect(response.body.type).toBe('multipart');
      expect(response.body.uploadId).toBe(mockUploadId);
      expect(response.body.partSize).toBe(5 * 1024 * 1024);
    });

    it('should reject invalid file types', async () => {
      const response = await request(app)
        .post('/bugs/1/upload/presign')
        .send({
          filename: 'malicious.exe',
          contentType: 'application/x-executable',
          fileSize: 1024,
        });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_FAILED');
      expect(response.body.errors).toContain('File type application/x-executable is not allowed');
    });

    it('should reject files that are too large', async () => {
      const response = await request(app)
        .post('/bugs/1/upload/presign')
        .send({
          filename: 'huge-image.jpg',
          contentType: 'image/jpeg',
          fileSize: 100 * 1024 * 1024, // 100MB (exceeds 50MB limit for images)
        });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_FAILED');
    });

    it('should reject dangerous filenames', async () => {
      const response = await request(app)
        .post('/bugs/1/upload/presign')
        .send({
          filename: '../../../etc/passwd',
          contentType: 'text/plain',
          fileSize: 1024,
        });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_FAILED');
      expect(response.body.errors).toContain('Filename contains invalid or dangerous characters');
    });

    it('should return 404 for non-existent bug report', async () => {
      BugReport.find.mockResolvedValue(null);

      const response = await request(app)
        .post('/bugs/999/upload/presign')
        .send({
          filename: 'test.jpg',
          contentType: 'image/jpeg',
          fileSize: 1024,
        });

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('BUG_NOT_FOUND');
    });

    it('should return 403 for unauthorized user', async () => {
      Team.getMembers.mockResolvedValue([{ user_id: 2 }]); // Different user

      const response = await request(app)
        .post('/bugs/1/upload/presign')
        .send({
          filename: 'test.jpg',
          contentType: 'image/jpeg',
          fileSize: 1024,
        });

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('ACCESS_DENIED');
    });
  });

  describe('getMultipartUploadUrls', () => {
    beforeEach(() => {
      BugReport.find.mockResolvedValue({ id: 1, team_id: 1 });
      Team.getMembers.mockResolvedValue([{ user_id: 1 }]);
    });

    it('should generate presigned URLs for multipart upload parts', async () => {
      const mockUrls = [
        'https://s3.amazonaws.com/test-bucket/test-key?partNumber=1',
        'https://s3.amazonaws.com/test-bucket/test-key?partNumber=2',
      ];
      mockS3.getSignedUrl.mockReturnValueOnce(mockUrls[0]).mockReturnValueOnce(mockUrls[1]);

      const response = await request(app)
        .post('/bugs/1/upload/multipart/urls')
        .send({
          uploadId: 'test-upload-id',
          key: 'test-key',
          partNumbers: [1, 2],
        });

      expect(response.status).toBe(200);
      expect(response.body.urls).toHaveLength(2);
      expect(response.body.urls[0].partNumber).toBe(1);
      expect(response.body.urls[0].url).toBe(mockUrls[0]);
      expect(response.body.urls[1].partNumber).toBe(2);
      expect(response.body.urls[1].url).toBe(mockUrls[1]);
    });

    it('should reject invalid part numbers', async () => {
      const response = await request(app)
        .post('/bugs/1/upload/multipart/urls')
        .send({
          uploadId: 'test-upload-id',
          key: 'test-key',
          partNumbers: [0, 10001], // Invalid part numbers
        });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('INVALID_PART_NUMBER');
    });
  });

  describe('completeMultipartUpload', () => {
    beforeEach(() => {
      BugReport.find.mockResolvedValue({ id: 1, team_id: 1 });
      Team.getMembers.mockResolvedValue([{ user_id: 1 }]);
      Artifact.createForBug.mockResolvedValue({ id: 1 });
      enqueueFileProcessingJob.mockResolvedValue('job-123');
    });

    it('should complete multipart upload successfully', async () => {
      const mockResult = {
        ETag: '"test-etag"',
        Location: 'https://s3.amazonaws.com/test-bucket/test-key',
      };
      mockS3.completeMultipartUpload.mockReturnValue({
        promise: () => Promise.resolve(mockResult),
      });

      const response = await request(app)
        .post('/bugs/1/upload/multipart/complete')
        .send({
          uploadId: 'test-upload-id',
          key: 'test-key',
          parts: [
            { partNumber: 1, etag: '"etag1"' },
            { partNumber: 2, etag: '"etag2"' },
          ],
          metadata: {
            filename: 'large-file.zip',
            contentType: 'application/zip',
            fileSize: 200 * 1024 * 1024,
          },
        });

      expect(response.status).toBe(200);
      expect(response.body.artifact).toBeDefined();
      expect(response.body.jobId).toBe('job-123');
      expect(response.body.location).toBe(mockResult.Location);
    });

    it('should abort upload on completion failure', async () => {
      mockS3.completeMultipartUpload.mockReturnValue({
        promise: () => Promise.reject(new Error('S3 error')),
      });
      mockS3.abortMultipartUpload.mockReturnValue({
        promise: () => Promise.resolve(),
      });

      const response = await request(app)
        .post('/bugs/1/upload/multipart/complete')
        .send({
          uploadId: 'test-upload-id',
          key: 'test-key',
          parts: [{ partNumber: 1, etag: '"etag1"' }],
        });

      expect(response.status).toBe(500);
      expect(mockS3.abortMultipartUpload).toHaveBeenCalled();
    });
  });

  describe('confirmUploads', () => {
    beforeEach(() => {
      BugReport.find.mockResolvedValue({ id: 1, team_id: 1 });
      Team.getMembers.mockResolvedValue([{ user_id: 1 }]);
      Artifact.createForBug.mockResolvedValue({ id: 1 });
      enqueueFileProcessingJob.mockResolvedValue('job-123');
      mockS3.headObject.mockReturnValue({
        promise: () => Promise.resolve({ ContentLength: 1024 }),
      });
    });

    it('should confirm batch uploads successfully', async () => {
      const response = await request(app)
        .post('/bugs/1/upload/confirm')
        .send({
          uploads: [
            {
              bucket: 'test-bucket',
              key: 'test-key-1',
              contentType: 'image/jpeg',
              sizeBytes: 1024,
              etag: '"etag1"',
              originalName: 'image1.jpg',
            },
            {
              bucket: 'test-bucket',
              key: 'test-key-2',
              contentType: 'text/plain',
              sizeBytes: 512,
              etag: '"etag2"',
              originalName: 'log.txt',
            },
          ],
        });

      expect(response.status).toBe(200);
      expect(response.body.artifacts).toHaveLength(2);
      expect(response.body.jobId).toBe('job-123');
      expect(response.body.count).toBe(2);
    });

    it('should handle image-specific metadata', async () => {
      const response = await request(app)
        .post('/bugs/1/upload/confirm')
        .send({
          uploads: [
            {
              bucket: 'test-bucket',
              key: 'test-key-1',
              contentType: 'image/png',
              sizeBytes: 2048,
              etag: '"etag1"',
              originalName: 'screenshot.png',
              dimensions: { width: 1920, height: 1080 },
              colorSpace: 'srgb',
              hasAlpha: true,
              variants: {
                thumbnail: { s3Key: 'test-key-1_thumbnail.webp' },
                medium: { s3Key: 'test-key-1_medium.webp' },
              },
            },
          ],
        });

      expect(response.status).toBe(200);
      expect(Artifact.createForBug).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            imageMetadata: expect.objectContaining({
              dimensions: { width: 1920, height: 1080 },
              colorSpace: 'srgb',
              hasAlpha: true,
            }),
          }),
          imageVariants: expect.objectContaining({
            thumbnail: { s3Key: 'test-key-1_thumbnail.webp' },
            medium: { s3Key: 'test-key-1_medium.webp' },
          }),
        }),
      );
    });

    it('should handle partial failures gracefully', async () => {
      // First upload succeeds, second fails
      mockS3.headObject
        .mockReturnValueOnce({
          promise: () => Promise.resolve({ ContentLength: 1024 }),
        })
        .mockReturnValueOnce({
          promise: () => Promise.reject(new Error('File not found')),
        });

      const response = await request(app)
        .post('/bugs/1/upload/confirm')
        .send({
          uploads: [
            {
              bucket: 'test-bucket',
              key: 'valid-key',
              contentType: 'image/jpeg',
              originalName: 'valid.jpg',
            },
            {
              bucket: 'test-bucket',
              key: 'invalid-key',
              contentType: 'image/jpeg',
              originalName: 'invalid.jpg',
            },
          ],
        });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('PARTIAL_SUCCESS');
      expect(response.body.errors).toHaveLength(1);
      expect(response.body.successfulArtifacts).toHaveLength(1);
    });

    it('should reject empty uploads array', async () => {
      const response = await request(app)
        .post('/bugs/1/upload/confirm')
        .send({ uploads: [] });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('MISSING_UPLOADS');
    });
  });

  describe('getUploadProgress', () => {
    beforeEach(() => {
      BugReport.find.mockResolvedValue({ id: 1, team_id: 1 });
      Team.getMembers.mockResolvedValue([{ user_id: 1 }]);
    });

    it('should return upload progress for multipart upload', async () => {
      mockS3.listParts.mockReturnValue({
        promise: () => Promise.resolve({
          Parts: [
            { PartNumber: 1, ETag: '"etag1"' },
            { PartNumber: 2, ETag: '"etag2"' },
          ],
        }),
      });

      const response = await request(app)
        .get('/bugs/1/upload/test-upload-id/progress')
        .query({
          key: 'test-key',
          totalParts: 4,
        });

      expect(response.status).toBe(200);
      expect(response.body.progress).toBe(50); // 2 out of 4 parts
      expect(response.body.completedParts).toBe(2);
      expect(response.body.totalParts).toBe(4);
      expect(response.body.status).toBe('in_progress');
    });

    it('should return ready_to_complete when all parts uploaded', async () => {
      mockS3.listParts.mockReturnValue({
        promise: () => Promise.resolve({
          Parts: [
            { PartNumber: 1, ETag: '"etag1"' },
            { PartNumber: 2, ETag: '"etag2"' },
          ],
        }),
      });

      const response = await request(app)
        .get('/bugs/1/upload/test-upload-id/progress')
        .query({
          key: 'test-key',
          totalParts: 2,
        });

      expect(response.status).toBe(200);
      expect(response.body.progress).toBe(100);
      expect(response.body.status).toBe('ready_to_complete');
    });

    it('should handle upload not found', async () => {
      mockS3.listParts.mockReturnValue({
        promise: () => Promise.reject(new Error('No such upload')),
      });

      const response = await request(app)
        .get('/bugs/1/upload/test-upload-id/progress')
        .query({
          key: 'test-key',
          totalParts: 2,
        });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('not_found');
      expect(response.body.progress).toBe(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle S3 service errors gracefully', async () => {
      BugReport.find.mockResolvedValue({ id: 1, team_id: 1 });
      Team.getMembers.mockResolvedValue([{ user_id: 1 }]);
      mockS3.getSignedUrl.mockImplementation(() => {
        throw new Error('S3 service unavailable');
      });

      const response = await request(app)
        .post('/bugs/1/upload/presign')
        .send({
          filename: 'test.jpg',
          contentType: 'image/jpeg',
          fileSize: 1024,
        });

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });

    it('should handle database errors gracefully', async () => {
      BugReport.find.mockRejectedValue(new Error('Database connection failed'));

      const response = await request(app)
        .post('/bugs/1/upload/presign')
        .send({
          filename: 'test.jpg',
          contentType: 'image/jpeg',
          fileSize: 1024,
        });

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });
});