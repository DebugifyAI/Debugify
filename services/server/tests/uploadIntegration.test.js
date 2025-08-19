const request = require('supertest');
const express = require('express');

// Mock dependencies before requiring modules
jest.mock('../models/Artifact');
jest.mock('../models/Team');
jest.mock('../models/BugReport');
jest.mock('../queues/fileProcessingQueue');
jest.mock('aws-sdk');
jest.mock('../db/knex', () => ({}));

const uploadController = require('../controllers/uploadController');
const {
  validateUploadRequest,
  setUploadSecurityHeaders,
} = require('../middleware/uploadValidation');

const Artifact = require('../models/Artifact');
const Team = require('../models/Team');
const BugReport = require('../models/BugReport');

// Create Express app for integration testing
const app = express();
app.use(express.json());
app.use(setUploadSecurityHeaders);

// Mock authentication middleware
app.use((req, res, next) => {
  req.user = { id: 1 };
  next();
});

// Setup routes with middleware
app.post('/bugs/:bugId/upload/presign',
  validateUploadRequest,
  uploadController.presignUpload
);

describe('Upload Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Mock environment variables
    process.env.AWS_S3_BUCKET_NAME = 'test-bucket';
    process.env.AWS_ACCESS_KEY_ID = 'test-key';
    process.env.AWS_SECRET_ACCESS_KEY = 'test-secret';
    process.env.AWS_REGION = 'us-east-1';

    // Setup default mocks
    BugReport.find.mockResolvedValue({ id: 1, team_id: 1 });
    Team.getMembers.mockResolvedValue([{ user_id: 1 }]);
  });

  describe('Complete Upload Flow', () => {
    it('should handle valid image upload request', async () => {
      const aws = require('aws-sdk');
      const mockS3 = {
        getSignedUrl: jest.fn().mockReturnValue('https://s3.amazonaws.com/test-bucket/test-key?signature=abc'),
      };
      aws.S3.mockImplementation(() => mockS3);

      const response = await request(app)
        .post('/bugs/1/upload/presign')
        .send({
          filename: 'screenshot.png',
          contentType: 'image/png',
          fileSize: 2 * 1024 * 1024, // 2MB
        });

      expect(response.status).toBe(200);
      expect(response.body.type).toBe('standard');
      expect(response.body.url).toBeDefined();
      expect(response.body.bucket).toBe('test-bucket');
      expect(response.body.key).toMatch(/^bug-reports\/1\/artifacts\/1\/\d+-\d+-screenshot\.png$/);

      // Check security headers
      expect(response.headers['cache-control']).toBe('no-store, no-cache, must-revalidate, proxy-revalidate');
    });

    it('should handle large file multipart upload request', async () => {
      const aws = require('aws-sdk');
      const mockS3 = {
        createMultipartUpload: jest.fn().mockReturnValue({
          promise: () => Promise.resolve({ UploadId: 'test-upload-id' }),
        }),
      };
      aws.S3.mockImplementation(() => mockS3);

      const response = await request(app)
        .post('/bugs/1/upload/presign')
        .send({
          filename: 'large-archive.zip',
          contentType: 'application/zip',
          fileSize: 200 * 1024 * 1024, // 200MB
        });

      expect(response.status).toBe(200);
      expect(response.body.type).toBe('multipart');
      expect(response.body.uploadId).toBe('test-upload-id');
      expect(response.body.partSize).toBe(5 * 1024 * 1024);
    });

    it('should reject invalid file types with proper error', async () => {
      const response = await request(app)
        .post('/bugs/1/upload/presign')
        .send({
          filename: 'malware.exe',
          contentType: 'application/x-executable',
          fileSize: 1024,
        });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_FAILED');
      expect(response.body.errors).toContain('File type application/x-executable is not allowed');
    });

    it('should reject files that exceed size limits', async () => {
      const response = await request(app)
        .post('/bugs/1/upload/presign')
        .send({
          filename: 'huge-image.jpg',
          contentType: 'image/jpeg',
          fileSize: 100 * 1024 * 1024, // 100MB (exceeds 50MB limit for images)
        });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_FAILED');
      expect(response.body.errors[0]).toContain('exceeds maximum allowed size');
    });

    it('should handle authorization errors', async () => {
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

    it('should handle non-existent bug reports', async () => {
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
  });

  describe('Error Handling', () => {
    it('should handle AWS S3 errors gracefully', async () => {
      const aws = require('aws-sdk');
      const mockS3 = {
        getSignedUrl: jest.fn().mockImplementation(() => {
          throw new Error('AWS service unavailable');
        }),
      };
      aws.S3.mockImplementation(() => mockS3);

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