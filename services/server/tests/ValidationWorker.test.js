// Mock database and dependencies before importing
jest.mock('../db/knex', () => ({
  select: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  first: jest.fn(),
  insert: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
}));

jest.mock('../helpers/FileValidator');
jest.mock('../models/Artifact');

const ValidationWorker = require('../workers/ValidationWorker');
const FileValidator = require('../helpers/FileValidator');
const Artifact = require('../models/Artifact');
jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation((queueName, processor, config) => ({
    on: jest.fn(),
    close: jest.fn(),
  })),
}));

describe('ValidationWorker', () => {
  let validationWorker;
  let mockRedisConfig;
  let mockFileValidator;

  beforeEach(() => {
    mockRedisConfig = {
      host: 'localhost',
      port: 6379,
    };

    mockFileValidator = {
      validateFileType: jest.fn(),
      validateFileSize: jest.fn(),
      validateContentType: jest.fn(),
      performSecurityScan: jest.fn(),
      scanForMaliciousPatterns: jest.fn(),
      getSupportedFileTypes: jest.fn().mockReturnValue(['image/jpeg', 'text/plain']),
      getMaxFileSize: jest.fn().mockReturnValue(50 * 1024 * 1024),
    };

    FileValidator.mockImplementation(() => mockFileValidator);

    validationWorker = new ValidationWorker(mockRedisConfig);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with correct configuration', () => {
      expect(validationWorker.redisConfig).toEqual(mockRedisConfig);
      expect(validationWorker.workerConfig.concurrency).toBe(10);
      expect(validationWorker.workerConfig.queueName).toBe('validation');
    });
  });

  describe('processValidationJob', () => {
    let mockJob;
    let mockArtifact;

    beforeEach(() => {
      mockJob = {
        data: {
          artifactId: 123,
          validationOptions: {},
        },
        updateProgress: jest.fn(),
      };

      mockArtifact = {
        id: 123,
        original_filename: 'test.jpg',
        content_type: 'image/jpeg',
        size_bytes: 1024,
        s3_bucket: 'test-bucket',
        s3_key: 'test-key',
      };

      Artifact.findById.mockResolvedValue(mockArtifact);
      Artifact.update.mockResolvedValue({});
    });

    it('should successfully validate a valid artifact', async () => {
      // Mock successful validation results
      mockFileValidator.validateFileType.mockResolvedValue({
        isValid: true,
        fileType: 'image/jpeg',
      });
      mockFileValidator.validateFileSize.mockResolvedValue({
        isValid: true,
        size: 1024,
      });
      mockFileValidator.validateContentType.mockResolvedValue({
        isValid: true,
        contentType: 'image/jpeg',
      });
      mockFileValidator.performSecurityScan.mockResolvedValue({
        isValid: true,
        flags: {},
      });
      mockFileValidator.scanForMaliciousPatterns.mockResolvedValue({
        isValid: true,
        patterns: [],
      });

      const result = await validationWorker.processValidationJob(mockJob);

      expect(result.status).toBe('valid');
      expect(result.artifactId).toBe(123);
      expect(mockJob.updateProgress).toHaveBeenCalledWith(100);
      expect(Artifact.update).toHaveBeenCalledWith(123, expect.objectContaining({
        status: 'validated',
        validation_status: 'passed',
      }));
    });

    it('should handle validation failure', async () => {
      // Mock validation failure
      mockFileValidator.validateFileType.mockResolvedValue({
        isValid: false,
        error: 'Unsupported file type',
      });
      mockFileValidator.validateFileSize.mockResolvedValue({
        isValid: true,
        size: 1024,
      });
      mockFileValidator.validateContentType.mockResolvedValue({
        isValid: true,
        contentType: 'image/jpeg',
      });
      mockFileValidator.performSecurityScan.mockResolvedValue({
        isValid: true,
        flags: {},
      });
      mockFileValidator.scanForMaliciousPatterns.mockResolvedValue({
        isValid: true,
        patterns: [],
      });

      const result = await validationWorker.processValidationJob(mockJob);

      expect(result.status).toBe('invalid');
      expect(Artifact.update).toHaveBeenCalledWith(123, expect.objectContaining({
        status: 'validation_failed',
        validation_status: 'failed',
      }));
    });

    it('should handle artifact not found', async () => {
      Artifact.findById.mockResolvedValue(null);

      await expect(validationWorker.processValidationJob(mockJob))
        .rejects.toThrow('Artifact 123 not found');
    });

    it('should handle validation errors', async () => {
      mockFileValidator.validateFileType.mockRejectedValue(new Error('Validation service error'));

      await expect(validationWorker.processValidationJob(mockJob))
        .rejects.toThrow('Comprehensive validation failed: Validation service error');

      expect(Artifact.update).toHaveBeenCalledWith(123, expect.objectContaining({
        status: 'validation_failed',
        last_error: 'Comprehensive validation failed: Validation service error',
      }));
    });
  });

  describe('generateValidationRecommendations', () => {
    it('should generate recommendations for valid file', () => {
      const validationResult = {
        isValid: true,
        securityFlags: {},
        checks: {},
      };

      const recommendations = validationWorker.generateValidationRecommendations(validationResult);

      expect(recommendations).toContain('File passed all validation checks and is safe to process');
    });

    it('should generate recommendations for invalid file', () => {
      const validationResult = {
        isValid: false,
        securityFlags: { hasSuspiciousPatterns: true },
        checks: { fileType: { warning: 'Unusual file extension' } },
      };

      const recommendations = validationWorker.generateValidationRecommendations(validationResult);

      expect(recommendations).toContain('File failed validation and should not be processed further');
      expect(recommendations).toContain('File contains suspicious patterns - manual review recommended');
      expect(recommendations).toContain('File type warning: Unusual file extension');
    });
  });

  describe('getCapabilities', () => {
    it('should return worker capabilities', () => {
      const capabilities = validationWorker.getCapabilities();

      expect(capabilities.workerType).toBe('ValidationWorker');
      expect(capabilities.queueName).toBe('validation');
      expect(capabilities.features).toContain('file_type_validation');
      expect(capabilities.features).toContain('security_scanning');
      expect(capabilities.supportedFileTypes).toEqual(['image/jpeg', 'text/plain']);
    });
  });

  describe('close', () => {
    it('should close worker gracefully', async () => {
      const mockClose = jest.fn();
      validationWorker.worker.close = mockClose;

      await validationWorker.close();

      expect(mockClose).toHaveBeenCalled();
    });
  });
});

// Integration test with real validation scenarios
describe('ValidationWorker Integration', () => {
  let validationWorker;

  beforeEach(() => {
    // Use real FileValidator for integration tests
    jest.unmock('../helpers/FileValidator');
    validationWorker = new ValidationWorker({
      host: 'localhost',
      port: 6379,
    });
  });

  describe('validation scenarios', () => {
    it('should validate common file types correctly', async () => {
      const testCases = [
        {
          artifact: {
            original_filename: 'test.jpg',
            content_type: 'image/jpeg',
            size_bytes: 1024,
          },
          expectedValid: true,
        },
        {
          artifact: {
            original_filename: 'test.exe',
            content_type: 'application/x-executable',
            size_bytes: 1024,
          },
          expectedValid: false, // Assuming .exe files are not allowed
        },
        {
          artifact: {
            original_filename: 'test.txt',
            content_type: 'text/plain',
            size_bytes: 100 * 1024 * 1024, // 100MB
          },
          expectedValid: false, // Assuming this exceeds size limit
        },
      ];

      for (const testCase of testCases) {
        const mockJob = {
          data: { artifactId: 1, validationOptions: {} },
          updateProgress: jest.fn(),
        };

        Artifact.findById.mockResolvedValue(testCase.artifact);
        Artifact.update.mockResolvedValue({});

        try {
          const result = await validationWorker.processValidationJob(mockJob);

          if (testCase.expectedValid) {
            expect(result.status).toBe('valid');
          } else {
            expect(result.status).toBe('invalid');
          }
        } catch (error) {
          if (!testCase.expectedValid) {
            // Expected to fail
            expect(error).toBeDefined();
          } else {
            throw error;
          }
        }
      }
    });
  });
});

// Performance test
describe('ValidationWorker Performance', () => {
  let validationWorker;

  beforeEach(() => {
    validationWorker = new ValidationWorker({
      host: 'localhost',
      port: 6379,
    });
  });

  it('should handle concurrent validation jobs efficiently', async () => {
    const concurrentJobs = 5;
    const jobs = [];

    // Mock successful validation for all jobs
    mockFileValidator.validateFileType.mockResolvedValue({ isValid: true });
    mockFileValidator.validateFileSize.mockResolvedValue({ isValid: true });
    mockFileValidator.validateContentType.mockResolvedValue({ isValid: true });
    mockFileValidator.performSecurityScan.mockResolvedValue({ isValid: true, flags: {} });
    mockFileValidator.scanForMaliciousPatterns.mockResolvedValue({ isValid: true });

    Artifact.findById.mockResolvedValue({
      id: 1,
      original_filename: 'test.jpg',
      content_type: 'image/jpeg',
      size_bytes: 1024,
    });
    Artifact.update.mockResolvedValue({});

    // Create concurrent jobs
    for (let i = 0; i < concurrentJobs; i++) {
      const mockJob = {
        data: { artifactId: i + 1, validationOptions: {} },
        updateProgress: jest.fn(),
      };
      jobs.push(validationWorker.processValidationJob(mockJob));
    }

    const startTime = Date.now();
    const results = await Promise.all(jobs);
    const endTime = Date.now();

    expect(results).toHaveLength(concurrentJobs);
    expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds

    results.forEach((result, index) => {
      expect(result.status).toBe('valid');
      expect(result.artifactId).toBe(index + 1);
    });
  });
});