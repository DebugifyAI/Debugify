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
jest.mock('../helpers/ContentParser');
jest.mock('../helpers/ImageProcessor');
jest.mock('../services/LLMService');
jest.mock('../models/Artifact');
jest.mock('../models/ProcessingJob');

// Mock all worker classes
jest.mock('../workers/ValidationWorker');
jest.mock('../workers/ParsingWorker');
jest.mock('../workers/ImageWorker');
jest.mock('../workers/LLMWorker');
jest.mock('../workers/CleanupWorker');

const WorkerManager = require('../workers/WorkerManager');
const ValidationWorker = require('../workers/ValidationWorker');
const ParsingWorker = require('../workers/ParsingWorker');
const ImageWorker = require('../workers/ImageWorker');
const LLMWorker = require('../workers/LLMWorker');
const CleanupWorker = require('../workers/CleanupWorker');

describe('WorkerManager', () => {
  let workerManager;
  let mockRedisConfig;

  beforeEach(() => {
    mockRedisConfig = {
      host: 'localhost',
      port: 6379,
    };

    // Mock worker constructors
    ValidationWorker.mockImplementation(() => ({
      close: jest.fn(),
      getCapabilities: jest.fn().mockReturnValue({
        workerType: 'ValidationWorker',
        features: ['file_validation'],
      }),
    }));

    ParsingWorker.mockImplementation(() => ({
      close: jest.fn(),
      getCapabilities: jest.fn().mockReturnValue({
        workerType: 'ParsingWorker',
        features: ['content_parsing'],
      }),
    }));

    ImageWorker.mockImplementation(() => ({
      close: jest.fn(),
      getCapabilities: jest.fn().mockReturnValue({
        workerType: 'ImageWorker',
        features: ['image_processing'],
      }),
    }));

    LLMWorker.mockImplementation(() => ({
      close: jest.fn(),
      getCapabilities: jest.fn().mockReturnValue({
        workerType: 'LLMWorker',
        features: ['llm_analysis'],
      }),
    }));

    CleanupWorker.mockImplementation(() => ({
      close: jest.fn(),
      getCapabilities: jest.fn().mockReturnValue({
        workerType: 'CleanupWorker',
        features: ['cleanup_tasks'],
      }),
    }));

    workerManager = new WorkerManager(mockRedisConfig);
  });

  afterEach(async () => {
    // Clean up worker manager to prevent memory leaks
    if (workerManager && workerManager.isManagerRunning()) {
      await workerManager.stop();
    }
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with correct configuration', () => {
      expect(workerManager.redisConfig).toEqual(mockRedisConfig);
      expect(workerManager.isRunning).toBe(false);
      expect(workerManager.workers).toEqual({});
    });

    it('should have default worker configuration', () => {
      expect(workerManager.workerConfig.validation.enabled).toBe(true);
      expect(workerManager.workerConfig.parsing.enabled).toBe(true);
      expect(workerManager.workerConfig.imageProcessing.enabled).toBe(true);
      expect(workerManager.workerConfig.llmAnalysis.enabled).toBe(true);
      expect(workerManager.workerConfig.cleanup.enabled).toBe(true);
    });
  });

  describe('start', () => {
    it('should start all enabled workers', async () => {
      await workerManager.start();

      expect(workerManager.isRunning).toBe(true);
      expect(ValidationWorker).toHaveBeenCalledWith(mockRedisConfig);
      expect(ParsingWorker).toHaveBeenCalledWith(mockRedisConfig);
      expect(ImageWorker).toHaveBeenCalledWith(mockRedisConfig);
      expect(LLMWorker).toHaveBeenCalledWith(mockRedisConfig);
      expect(CleanupWorker).toHaveBeenCalledWith(mockRedisConfig);
      expect(Object.keys(workerManager.workers)).toHaveLength(5);
    });

    it('should not start disabled workers', async () => {
      workerManager.workerConfig.validation.enabled = false;
      workerManager.workerConfig.parsing.enabled = false;

      await workerManager.start();

      expect(workerManager.isRunning).toBe(true);
      expect(ValidationWorker).not.toHaveBeenCalled();
      expect(ParsingWorker).not.toHaveBeenCalled();
      expect(ImageWorker).toHaveBeenCalledWith(mockRedisConfig);
      expect(LLMWorker).toHaveBeenCalledWith(mockRedisConfig);
      expect(CleanupWorker).toHaveBeenCalledWith(mockRedisConfig);
      expect(Object.keys(workerManager.workers)).toHaveLength(3);
    });

    it('should not start if already running', async () => {
      await workerManager.start();
      const firstStartWorkerCount = Object.keys(workerManager.workers).length;

      // Try to start again
      await workerManager.start();
      const secondStartWorkerCount = Object.keys(workerManager.workers).length;

      expect(firstStartWorkerCount).toBe(secondStartWorkerCount);
    });

    it('should handle worker initialization errors', async () => {
      ValidationWorker.mockImplementation(() => {
        throw new Error('Worker initialization failed');
      });

      await expect(workerManager.start()).rejects.toThrow('Worker initialization failed');
      expect(workerManager.isRunning).toBe(false);
    });
  });

  describe('stop', () => {
    beforeEach(async () => {
      await workerManager.start();
    });

    it('should stop all workers gracefully', async () => {
      const mockClose = jest.fn();
      Object.values(workerManager.workers).forEach(worker => {
        worker.close = mockClose;
      });

      await workerManager.stop();

      expect(workerManager.isRunning).toBe(false);
      expect(workerManager.workers).toEqual({});
      expect(mockClose).toHaveBeenCalledTimes(5);
    });

    it('should handle worker close errors', async () => {
      const mockClose = jest.fn().mockRejectedValue(new Error('Close failed'));
      Object.values(workerManager.workers).forEach(worker => {
        worker.close = mockClose;
      });

      // Should not throw even if individual workers fail to close
      await expect(workerManager.stop()).resolves.not.toThrow();
      expect(workerManager.isRunning).toBe(false);
    });

    it('should not stop if not running', async () => {
      await workerManager.stop(); // First stop
      const workers = { ...workerManager.workers };

      await workerManager.stop(); // Second stop

      expect(workerManager.workers).toEqual(workers);
    });
  });

  describe('restart', () => {
    it('should restart all workers', async () => {
      await workerManager.start();
      expect(workerManager.isRunning).toBe(true);

      await workerManager.restart();

      expect(workerManager.isRunning).toBe(true);
      expect(Object.keys(workerManager.workers)).toHaveLength(5);
    });
  });

  describe('getStatus', () => {
    it('should return correct status when not running', () => {
      const status = workerManager.getStatus();

      expect(status.isRunning).toBe(false);
      expect(status.summary.total).toBe(0);
      expect(status.summary.running).toBe(0);
      expect(status.workers).toEqual({});
    });

    it('should return correct status when running', async () => {
      await workerManager.start();
      const status = workerManager.getStatus();

      expect(status.isRunning).toBe(true);
      expect(status.summary.total).toBe(5);
      expect(status.summary.running).toBe(5);
      expect(Object.keys(status.workers)).toHaveLength(5);
      expect(status.workers.validation.enabled).toBe(true);
    });
  });

  describe('getCapabilities', () => {
    it('should return combined worker capabilities', async () => {
      await workerManager.start();
      const capabilities = workerManager.getCapabilities();

      expect(capabilities.workerManager.totalWorkers).toBe(5);
      expect(capabilities.workers.validation.workerType).toBe('ValidationWorker');
      expect(capabilities.workers.parsing.workerType).toBe('ParsingWorker');
      expect(capabilities.workers.imageProcessing.workerType).toBe('ImageWorker');
      expect(capabilities.workers.llmAnalysis.workerType).toBe('LLMWorker');
      expect(capabilities.workers.cleanup.workerType).toBe('CleanupWorker');
    });
  });

  describe('setWorkerEnabled', () => {
    it('should enable a disabled worker', async () => {
      workerManager.workerConfig.validation.enabled = false;
      await workerManager.start();

      expect(workerManager.workers.validation).toBeUndefined();

      await workerManager.setWorkerEnabled('validation', true);

      expect(workerManager.workerConfig.validation.enabled).toBe(true);
      expect(workerManager.workers.validation).toBeDefined();
    });

    it('should disable an enabled worker', async () => {
      await workerManager.start();
      expect(workerManager.workers.validation).toBeDefined();

      await workerManager.setWorkerEnabled('validation', false);

      expect(workerManager.workerConfig.validation.enabled).toBe(false);
      expect(workerManager.workers.validation).toBeUndefined();
    });

    it('should throw error for unknown worker type', async () => {
      await expect(workerManager.setWorkerEnabled('unknown', true))
        .rejects.toThrow('Unknown worker type: unknown');
    });
  });

  describe('startWorker', () => {
    it('should start a specific worker', async () => {
      await workerManager.startWorker('validation');

      expect(ValidationWorker).toHaveBeenCalledWith(mockRedisConfig);
      expect(workerManager.workers.validation).toBeDefined();
    });

    it('should not start worker if already running', async () => {
      await workerManager.startWorker('validation');
      ValidationWorker.mockClear();

      await workerManager.startWorker('validation');

      expect(ValidationWorker).not.toHaveBeenCalled();
    });

    it('should throw error for unknown worker type', async () => {
      await expect(workerManager.startWorker('unknown'))
        .rejects.toThrow('Unknown worker type: unknown');
    });
  });

  describe('stopWorker', () => {
    it('should stop a specific worker', async () => {
      await workerManager.startWorker('validation');
      const mockClose = jest.fn();
      workerManager.workers.validation.close = mockClose;

      await workerManager.stopWorker('validation');

      expect(mockClose).toHaveBeenCalled();
      expect(workerManager.workers.validation).toBeUndefined();
    });

    it('should not stop worker if not running', async () => {
      await workerManager.stopWorker('validation');
      // Should not throw error
    });
  });

  describe('performHealthCheck', () => {
    it('should return healthy status for all workers', async () => {
      await workerManager.start();

      // Mock workers to have proper methods for health check
      Object.values(workerManager.workers).forEach(worker => {
        worker.getWorker = jest.fn();
        worker.close = jest.fn();
      });

      const healthStatus = await workerManager.performHealthCheck();

      expect(healthStatus.overall).toBe('healthy');
      expect(Object.keys(healthStatus.workers)).toHaveLength(5);
      Object.values(healthStatus.workers).forEach(workerHealth => {
        expect(workerHealth.status).toBe('healthy');
      });
    });

    it('should detect unhealthy workers', async () => {
      await workerManager.start();

      // Make one worker unhealthy by removing required methods
      delete workerManager.workers.validation.getWorker;

      const healthStatus = await workerManager.performHealthCheck();

      expect(healthStatus.overall).toBe('degraded');
      expect(healthStatus.workers.validation.status).toBe('unhealthy');
    });
  });

  describe('setWorkerConcurrency', () => {
    it('should update worker concurrency', () => {
      workerManager.setWorkerConcurrency('validation', 20);

      expect(workerManager.workerConfig.validation.concurrency).toBe(20);
    });

    it('should throw error for unknown worker type', () => {
      expect(() => workerManager.setWorkerConcurrency('unknown', 10))
        .toThrow('Unknown worker type: unknown');
    });
  });

  describe('getWorker', () => {
    it('should return worker instance', async () => {
      await workerManager.start();
      const worker = workerManager.getWorker('validation');

      expect(worker).toBeDefined();
      expect(worker).toBe(workerManager.workers.validation);
    });

    it('should return null for non-existent worker', () => {
      const worker = workerManager.getWorker('nonexistent');

      expect(worker).toBeNull();
    });
  });
});

// Integration test
describe('WorkerManager Integration', () => {
  let workerManager;

  beforeEach(() => {
    // Use real worker classes for integration test
    jest.unmock('../workers/ValidationWorker');
    jest.unmock('../workers/ParsingWorker');
    jest.unmock('../workers/ImageWorker');
    jest.unmock('../workers/LLMWorker');
    jest.unmock('../workers/CleanupWorker');

    workerManager = new WorkerManager({
      host: 'localhost',
      port: 6379,
    });
  });

  it('should handle full lifecycle with real workers', async () => {
    // Start with limited workers to avoid external dependencies
    workerManager.workerConfig.imageProcessing.enabled = false;
    workerManager.workerConfig.llmAnalysis.enabled = false;

    await workerManager.start();
    expect(workerManager.isRunning).toBe(true);

    const status = workerManager.getStatus();
    expect(status.summary.running).toBeGreaterThan(0);

    const capabilities = workerManager.getCapabilities();
    expect(capabilities.workerManager.totalWorkers).toBeGreaterThan(0);

    await workerManager.stop();
    expect(workerManager.isRunning).toBe(false);
  }, 10000); // Longer timeout for integration test
});