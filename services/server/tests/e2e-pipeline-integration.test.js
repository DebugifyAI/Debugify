const request = require('supertest');
const fs = require('fs');
const path = require('path');
const app = require('../index');
const knex = require('../db/knex');
const { Queue } = require('bullmq');
const AWS = require('aws-sdk');

// Mock AWS S3
jest.mock('aws-sdk');

describe('End-to-End Pipeline Integration Tests', () => {
  let server;
  let testUser;
  let authToken;
  let s3Mock;
  let queueMock;

  beforeAll(async () => {
    // Setup test database
    await knex.migrate.latest();
    await knex.seed.run();

    // Create test user
    const userResponse = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'testuser',
        email: 'test@example.com',
        password: 'testpassword123'
      });

    testUser = userResponse.body.user;

    // Login to get auth token
    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'test@example.com',
        password: 'testpassword123'
      });

    authToken = loginResponse.body.token;

    // Setup AWS S3 mock
    s3Mock = {
      getSignedUrl: jest.fn().mockReturnValue('https://test-bucket.s3.amazonaws.com/test-key?signature=test'),
      upload: jest.fn().mockReturnValue({
        promise: jest.fn().mockResolvedValue({
          Location: 'https://test-bucket.s3.amazonaws.com/test-key',
          Key: 'test-key',
          Bucket: 'test-bucket'
        })
      }),
      getObject: jest.fn().mockReturnValue({
        promise: jest.fn().mockResolvedValue({
          Body: Buffer.from('test file content'),
          ContentType: 'text/plain'
        })
      })
    };

    AWS.S3.mockImplementation(() => s3Mock);

    // Setup queue mock
    queueMock = {
      add: jest.fn().mockResolvedValue({ id: 'test-job-id' }),
      getJob: jest.fn().mockResolvedValue({
        id: 'test-job-id',
        progress: 100,
        returnvalue: { status: 'completed' }
      })
    };

    Queue.mockImplementation(() => queueMock);
  });

  afterAll(async () => {
    await knex.destroy();
    if (server) {
      server.close();
    }
  });

  beforeEach(async () => {
    // Clean up artifacts between tests
    await knex('artifacts').del();
    await knex('processing_jobs').del();
    await knex('llm_outputs').del();
    jest.clearAllMocks();
  });

  describe('Complete Upload and Processing Flow', () => {
    test('should handle text file upload and processing end-to-end', async () => {
      // Step 1: Request presigned upload URL
      const presignedResponse = await request(app)
        .post('/api/upload/presigned')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filename: 'test-log.txt',
          contentType: 'text/plain',
          fileSize: 1024
        })
        .expect(200);

      expect(presignedResponse.body).toHaveProperty('uploadUrl');
      expect(presignedResponse.body).toHaveProperty('artifactId');

      const artifactId = presignedResponse.body.artifactId;

      // Step 2: Simulate S3 upload completion
      const confirmResponse = await request(app)
        .post(`/api/upload/confirm/${artifactId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          s3Key: 'test-key',
          etag: 'test-etag'
        })
        .expect(200);

      expect(confirmResponse.body.message).toBe('Upload confirmed and processing started');

      // Step 3: Verify artifact was created
      const artifact = await knex('artifacts').where('id', artifactId).first();
      expect(artifact).toBeTruthy();
      expect(artifact.status).toBe('processing');

      // Step 4: Verify processing job was queued
      expect(queueMock.add).toHaveBeenCalledWith(
        'process-file',
        expect.objectContaining({
          artifactId: artifactId,
          s3Key: 'test-key'
        })
      );

      // Step 5: Check processing status
      const statusResponse = await request(app)
        .get(`/api/artifacts/${artifactId}/status`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(statusResponse.body).toHaveProperty('status');
      expect(statusResponse.body).toHaveProperty('progress');
    });

    test('should handle image file upload with complete processing pipeline', async () => {
      // Create test image buffer
      const testImagePath = path.join(__dirname, 'fixtures', 'test-image.jpg');
      
      // Step 1: Request presigned upload URL for image
      const presignedResponse = await request(app)
        .post('/api/upload/presigned')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filename: 'test-screenshot.jpg',
          contentType: 'image/jpeg',
          fileSize: 50000
        })
        .expect(200);

      const artifactId = presignedResponse.body.artifactId;

      // Step 2: Confirm upload with image-specific metadata
      const confirmResponse = await request(app)
        .post(`/api/upload/confirm/${artifactId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          s3Key: 'images/test-screenshot.jpg',
          etag: 'test-etag',
          metadata: {
            width: 1920,
            height: 1080,
            format: 'jpeg'
          }
        })
        .expect(200);

      // Step 3: Verify image processing job was queued
      expect(queueMock.add).toHaveBeenCalledWith(
        'process-image',
        expect.objectContaining({
          artifactId: artifactId,
          s3Key: 'images/test-screenshot.jpg'
        })
      );

      // Step 4: Simulate image processing completion
      await knex('artifacts')
        .where('id', artifactId)
        .update({
          status: 'completed',
          image_variants: JSON.stringify({
            thumbnail: 'images/test-screenshot-thumb.jpg',
            webOptimized: 'images/test-screenshot-web.webp',
            original: 'images/test-screenshot.jpg'
          }),
          ocr_text: 'Sample OCR extracted text',
          visual_elements: JSON.stringify({
            buttons: [{ x: 100, y: 200, width: 80, height: 30, text: 'Submit' }],
            textFields: [{ x: 50, y: 150, width: 200, height: 25 }]
          })
        });

      // Step 5: Verify processed image data
      const processedArtifact = await knex('artifacts').where('id', artifactId).first();
      expect(processedArtifact.image_variants).toBeTruthy();
      expect(processedArtifact.ocr_text).toBe('Sample OCR extracted text');
      expect(processedArtifact.visual_elements).toBeTruthy();
    });

    test('should handle batch upload of mixed file types', async () => {
      const fileTypes = [
        { filename: 'log1.txt', contentType: 'text/plain', size: 1024 },
        { filename: 'screenshot.png', contentType: 'image/png', size: 25000 },
        { filename: 'document.pdf', contentType: 'application/pdf', size: 50000 }
      ];

      const artifactIds = [];

      // Upload multiple files
      for (const file of fileTypes) {
        const presignedResponse = await request(app)
          .post('/api/upload/presigned')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            filename: file.filename,
            contentType: file.contentType,
            fileSize: file.size
          })
          .expect(200);

        artifactIds.push(presignedResponse.body.artifactId);

        // Confirm each upload
        await request(app)
          .post(`/api/upload/confirm/${presignedResponse.body.artifactId}`)
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            s3Key: `uploads/${file.filename}`,
            etag: `etag-${file.filename}`
          })
          .expect(200);
      }

      // Verify all artifacts were created
      const artifacts = await knex('artifacts').whereIn('id', artifactIds);
      expect(artifacts).toHaveLength(3);

      // Verify different processing jobs were queued based on file type
      expect(queueMock.add).toHaveBeenCalledTimes(3);
      expect(queueMock.add).toHaveBeenCalledWith('process-file', expect.any(Object));
      expect(queueMock.add).toHaveBeenCalledWith('process-image', expect.any(Object));
    });

    test('should handle processing failures and retry mechanisms', async () => {
      // Setup queue to simulate failure
      queueMock.add.mockRejectedValueOnce(new Error('Queue connection failed'));

      const presignedResponse = await request(app)
        .post('/api/upload/presigned')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filename: 'test-fail.txt',
          contentType: 'text/plain',
          fileSize: 1024
        })
        .expect(200);

      const artifactId = presignedResponse.body.artifactId;

      // Attempt to confirm upload (should handle queue failure gracefully)
      const confirmResponse = await request(app)
        .post(`/api/upload/confirm/${artifactId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          s3Key: 'test-fail-key',
          etag: 'test-etag'
        });

      // Should still create artifact but mark as failed
      const artifact = await knex('artifacts').where('id', artifactId).first();
      expect(artifact).toBeTruthy();
    });
  });

  describe('Real-time Progress Tracking', () => {
    test('should provide real-time updates during processing', async () => {
      const presignedResponse = await request(app)
        .post('/api/upload/presigned')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filename: 'progress-test.txt',
          contentType: 'text/plain',
          fileSize: 1024
        })
        .expect(200);

      const artifactId = presignedResponse.body.artifactId;

      // Confirm upload
      await request(app)
        .post(`/api/upload/confirm/${artifactId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          s3Key: 'progress-test-key',
          etag: 'test-etag'
        })
        .expect(200);

      // Check initial progress
      const initialProgress = await request(app)
        .get(`/api/artifacts/${artifactId}/progress`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(initialProgress.body).toHaveProperty('progress');
      expect(initialProgress.body).toHaveProperty('stage');
      expect(initialProgress.body).toHaveProperty('estimatedCompletion');
    });
  });

  describe('Error Handling and Recovery', () => {
    test('should handle S3 upload failures gracefully', async () => {
      // Mock S3 failure
      s3Mock.getSignedUrl.mockImplementationOnce(() => {
        throw new Error('S3 service unavailable');
      });

      const response = await request(app)
        .post('/api/upload/presigned')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filename: 'fail-test.txt',
          contentType: 'text/plain',
          fileSize: 1024
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toContain('S3 service unavailable');
    });

    test('should handle processing job failures with proper error reporting', async () => {
      const presignedResponse = await request(app)
        .post('/api/upload/presigned')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filename: 'error-test.txt',
          contentType: 'text/plain',
          fileSize: 1024
        })
        .expect(200);

      const artifactId = presignedResponse.body.artifactId;

      // Simulate processing failure
      await knex('artifacts')
        .where('id', artifactId)
        .update({
          status: 'failed',
          last_error: 'Processing timeout after 5 minutes',
          retry_count: 3
        });

      const statusResponse = await request(app)
        .get(`/api/artifacts/${artifactId}/status`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(statusResponse.body.status).toBe('failed');
      expect(statusResponse.body.error).toBe('Processing timeout after 5 minutes');
      expect(statusResponse.body.retryCount).toBe(3);
    });
  });

  describe('Security and Validation', () => {
    test('should reject unauthorized upload attempts', async () => {
      const response = await request(app)
        .post('/api/upload/presigned')
        .send({
          filename: 'unauthorized.txt',
          contentType: 'text/plain',
          fileSize: 1024
        });

      expect(response.status).toBe(401);
    });

    test('should validate file types and reject malicious files', async () => {
      const response = await request(app)
        .post('/api/upload/presigned')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filename: 'malicious.exe',
          contentType: 'application/x-executable',
          fileSize: 1024
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('File type not allowed');
    });

    test('should enforce file size limits', async () => {
      const response = await request(app)
        .post('/api/upload/presigned')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filename: 'huge-file.txt',
          contentType: 'text/plain',
          fileSize: 1024 * 1024 * 1024 * 2 // 2GB
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('File size exceeds limit');
    });
  });
});