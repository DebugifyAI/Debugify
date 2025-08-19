// Test setup file
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test_db';
process.env.REDIS_URL = 'redis://localhost:6379/1';
process.env.JWT_SECRET = 'test-jwt-secret-key';
process.env.AWS_ACCESS_KEY_ID = 'test-access-key';
process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-key';
process.env.AWS_REGION = 'us-east-1';
process.env.S3_BUCKET_NAME = 'test-bucket';
process.env.CREDENTIAL_ENCRYPTION_KEY = 'test-encryption-key-32-characters-long';

// Mock external services
jest.mock('aws-sdk');
jest.mock('bullmq');
jest.mock('ioredis');

// Global test timeout
jest.setTimeout(30000);