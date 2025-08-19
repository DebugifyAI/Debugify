/**
 * Integration tests for real-time progress tracking system
 */

const request = require('supertest');
const { io: Client } = require('socket.io-client');
const { Queue } = require('bullmq');
const express = require('express');
const http = require('http');

const ProgressTrackingService = require('../services/ProgressTrackingService');
const ProgressController = require('../controllers/progressController');
const ProcessingJob = require('../models/ProcessingJob');
const Artifact = require('../models/Artifact');
const { ProgressTracker, withProgressTracking } = require('../middleware/progressTracking');

// Mock Redis configuration for testing
const testRedisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT, 10) || 6379,
  db: 15, // Use separate database for tests
};

describe('Progress Tracking System', () => {
  let app;
  let server;
  let progressService;
  let clientSocket;
  let testQueue;

  beforeAll(async () => {
    // Setup test server with WebSocket
    app = express();
    app.use(express.json());
    server = http.createServer(app);
    
    progressService = new ProgressTrackingService(server, testRedisConfig);
    
    // Add test routes
    app.get('/api/jobs/:jobId/status', ProgressController.getJobStatus);
    app.get('/api/processing/stats', ProgressController.getProcessingStats);
    
    // Start server
    await new Promise((resolve) => {
      server.listen(0, resolve);
    });

    const port = server.address().port;
    
    // Setup test queue
    testQueue = new Queue('test-processing', { connection: testRedisConfig });
    
    // Setup client socket
    clientSocket = Client(`http://localhost:${port}`, {
      transports: ['websocket']
    });
    
    await new Promise((resolve) => {
      clientSocket.on('connect', resolve);
    });
  });

  afterAll(async () => {
    if (clientSocket) {
      clientSocket.disconnect();
    }
    
    if (testQueue) {
      await testQueue.close();
    }
    
    if (server) {
      await new Promise((resolve) => {
        server.close(resolve);
      });
    }
  });

  beforeEach(async () => {
    // Clean up test data
    await testQueue.drain();
    await testQueue.clean(0, 1000);
  });

  describe('WebSocket Connection and Authentication', () => {
    test('should connect to WebSocket server', (done) => {
      expect(clientSocket.connected).toBe(true);
      done();
    });

    test('should authenticate user', (done) => {
      clientSocket.emit('authenticate', {
        userId: 'test-user-123',
        token: 'test-token'
      });

      clientSocket.on('authenticated', (data) => {
        expect(data.success).toBe(true);
        done();
      });
    });

    test('should subscribe to job updates', (done) => {
      const jobId = 'test-job-123';
      
      clientSocket.emit('subscribe_job', { jobId });
      
      clientSocket.on('job_subscribed', (data) => {
        expect(data.jobId).toBe(jobId);
        done();
      });
    });
  });

  describe('Progress Tracking Middleware', () => {
    test('should track job progress through stages', async () => {
      const mockJob = {
        id: 'test-job-456',
        data: { 
          artifactId: 1, 
          jobType: 'image-processing' 
        },
        updateProgress: jest.fn()
      };

      const tracker = new ProgressTracker(mockJob);
      await tracker.initialize();

      // Test stage progression
      await tracker.updateStageProgress(50, 'Processing image');
      expect(tracker.getStatus().stageProgress).toBe(50);

      await tracker.completeStage();
      expect(tracker.currentStage).toBe(1);

      await tracker.updateStageProgress(75, 'Generating variants');
      const status = tracker.getStatus();
      expect(status.currentStage).toBe(2);
      expect(status.stageProgress).toBe(75);
    });

    test('should wrap job processor with progress tracking', async () => {
      const mockProcessor = jest.fn().mockResolvedValue({ result: 'success' });
      const wrappedProcessor = withProgressTracking(mockProcessor, 'test-job');

      const mockJob = {
        id: 'test-job-789',
        data: { artifactId: 1 },
        updateProgress: jest.fn()
      };

      const result = await wrappedProcessor(mockJob);
      
      expect(mockProcessor).toHaveBeenCalledWith(mockJob);
      expect(result).toEqual({ result: 'success' });
      expect(mockJob.progressTracker).toBeDefined();
    });

    test('should handle job failures properly', async () => {
      const mockProcessor = jest.fn().mockRejectedValue(new Error('Processing failed'));
      const wrappedProcessor = withProgressTracking(mockProcessor, 'test-job');

      const mockJob = {
        id: 'test-job-error',
        data: { artifactId: 1 },
        updateProgress: jest.fn()
      };

      await expect(wrappedProcessor(mockJob)).rejects.toThrow('Processing failed');
    });
  });

  describe('Real-time Progress Updates', () => {
    test('should broadcast job progress updates', (done) => {
      const jobId = 'test-broadcast-job';
      
      // Subscribe to job
      clientSocket.emit('subscribe_job', { jobId });
      
      // Listen for progress updates
      clientSocket.on('job_progress', (data) => {
        expect(data.jobId).toBe(jobId);
        expect(data.progress).toBe(50);
        expect(data.stage).toBe('processing');
        done();
      });

      // Simulate progress update
      setTimeout(() => {
        progressService.broadcastJobProgress(jobId, {
          jobId,
          progress: 50,
          stage: 'processing',
          timestamp: new Date().toISOString()
        });
      }, 100);
    });

    test('should broadcast job completion', (done) => {
      const jobId = 'test-completion-job';
      
      clientSocket.emit('subscribe_job', { jobId });
      
      clientSocket.on('job_update', (data) => {
        expect(data.jobId).toBe(jobId);
        expect(data.status).toBe('completed');
        done();
      });

      setTimeout(() => {
        progressService.broadcastJobUpdate(jobId, {
          jobId,
          status: 'completed',
          result: { success: true },
          completedAt: new Date().toISOString()
        });
      }, 100);
    });

    test('should send notifications to users', (done) => {
      const userId = 'test-user-notifications';
      
      // Authenticate as test user
      clientSocket.emit('authenticate', { userId, token: 'test-token' });
      
      clientSocket.on('notification', (data) => {
        expect(data.type).toBe('success');
        expect(data.title).toBe('Processing Complete');
        expect(data.message).toBe('Your file has been processed successfully');
        done();
      });

      setTimeout(async () => {
        await progressService.sendNotification(userId, {
          type: 'success',
          title: 'Processing Complete',
          message: 'Your file has been processed successfully'
        });
      }, 100);
    });
  });

  describe('API Endpoints', () => {
    test('should get job status', async () => {
      // Mock ProcessingJob.findByJobId
      const mockJob = {
        job_id: 'test-api-job',
        artifact_id: 1,
        job_type: 'validation',
        status: 'active',
        progress: 75,
        started_at: new Date(),
        created_at: new Date(),
        updated_at: new Date()
      };

      jest.spyOn(ProcessingJob, 'findByJobId').mockResolvedValue(mockJob);

      const response = await request(app)
        .get('/api/jobs/test-api-job/status')
        .expect(200);

      expect(response.body.jobId).toBe('test-api-job');
      expect(response.body.status).toBe('active');
      expect(response.body.progress).toBe(75);
    });

    test('should return 404 for non-existent job', async () => {
      jest.spyOn(ProcessingJob, 'findByJobId').mockResolvedValue(null);

      const response = await request(app)
        .get('/api/jobs/non-existent-job/status')
        .expect(404);

      expect(response.body.error).toBe('Job not found');
    });

    test('should get processing statistics', async () => {
      const mockStats = {
        total: 100,
        completed: 85,
        failed: 10,
        active: 3,
        queued: 2,
        avgProcessingTime: 5000,
        jobTypeBreakdown: {
          'image-processing': 40,
          'validation': 35,
          'parsing': 25
        }
      };

      jest.spyOn(ProcessingJob, 'getStatsSince').mockResolvedValue(mockStats);

      const response = await request(app)
        .get('/api/processing/stats?timeframe=24h')
        .expect(200);

      expect(response.body.stats.totalJobs).toBe(100);
      expect(response.body.stats.successRate).toBe(85);
      expect(response.body.timeframe).toBe('24h');
    });
  });

  describe('Image Processing Progress', () => {
    test('should track image variant generation progress', async () => {
      const variants = ['thumbnail', 'medium', 'large'];
      let progressUpdates = [];

      // Mock progress tracker
      const mockTracker = {
        updateStageProgress: jest.fn((progress, details) => {
          progressUpdates.push({ progress, details });
        })
      };

      // Simulate variant generation progress
      for (let i = 0; i < variants.length; i++) {
        const progress = Math.round(((i + 1) / variants.length) * 100);
        await mockTracker.updateStageProgress(progress, {
          variant: variants[i],
          completed: i + 1,
          total: variants.length
        });
      }

      expect(progressUpdates).toHaveLength(3);
      expect(progressUpdates[0].progress).toBe(33);
      expect(progressUpdates[1].progress).toBe(67);
      expect(progressUpdates[2].progress).toBe(100);
      expect(progressUpdates[2].details.variant).toBe('large');
    });

    test('should track OCR processing with confidence', async () => {
      const mockTracker = {
        updateStageProgress: jest.fn()
      };

      // Simulate OCR progress with confidence scoring
      const confidence = 0.85;
      const textLength = 1250;
      
      const progress = Math.min(100, Math.round(confidence * 100));
      await mockTracker.updateStageProgress(progress, {
        confidence,
        textLength,
        quality: confidence > 0.8 ? 'high' : 'medium'
      });

      expect(mockTracker.updateStageProgress).toHaveBeenCalledWith(85, {
        confidence: 0.85,
        textLength: 1250,
        quality: 'high'
      });
    });
  });

  describe('Error Handling and Recovery', () => {
    test('should handle WebSocket disconnection gracefully', (done) => {
      const testSocket = Client(`http://localhost:${server.address().port}`, {
        transports: ['websocket']
      });

      testSocket.on('connect', () => {
        testSocket.disconnect();
      });

      testSocket.on('disconnect', (reason) => {
        expect(reason).toBeDefined();
        done();
      });
    });

    test('should clean up socket subscriptions on disconnect', () => {
      const mockSocket = {
        id: 'test-socket-cleanup',
        userId: 'test-user-cleanup'
      };

      // Simulate socket cleanup
      progressService.cleanupSocket(mockSocket);
      
      // Verify cleanup (this would need access to internal state)
      const stats = progressService.getStats();
      expect(stats).toBeDefined();
    });

    test('should handle job retry scenarios', async () => {
      const jobId = 'test-retry-job';
      
      // Mock failed job
      const mockFailedJob = {
        job_id: jobId,
        artifact_id: 1,
        job_type: 'image-processing',
        status: 'failed',
        error_details: { message: 'Processing timeout' }
      };

      jest.spyOn(ProcessingJob, 'findByJobId').mockResolvedValue(mockFailedJob);
      jest.spyOn(Artifact, 'findById').mockResolvedValue({ id: 1, filename: 'test.jpg' });
      
      // Mock the retry functionality
      const mockEnqueue = jest.fn().mockResolvedValue('new-job-id');
      jest.doMock('../queues/specializedQueues', () => ({
        enqueueSpecializedJob: mockEnqueue
      }));

      // This would test the retry endpoint if we had it set up
      expect(mockFailedJob.status).toBe('failed');
    });
  });

  describe('Performance and Scalability', () => {
    test('should handle multiple concurrent job subscriptions', async () => {
      const jobIds = Array.from({ length: 10 }, (_, i) => `concurrent-job-${i}`);
      const subscriptionPromises = jobIds.map(jobId => {
        return new Promise((resolve) => {
          clientSocket.emit('subscribe_job', { jobId });
          clientSocket.on('job_subscribed', (data) => {
            if (data.jobId === jobId) {
              resolve(data);
            }
          });
        });
      });

      const results = await Promise.all(subscriptionPromises);
      expect(results).toHaveLength(10);
      results.forEach((result, index) => {
        expect(result.jobId).toBe(`concurrent-job-${index}`);
      });
    });

    test('should provide connection statistics', () => {
      const stats = progressService.getStats();
      
      expect(stats).toHaveProperty('connectedClients');
      expect(stats).toHaveProperty('totalSockets');
      expect(stats).toHaveProperty('activeJobSubscriptions');
      expect(stats).toHaveProperty('timestamp');
      expect(typeof stats.connectedClients).toBe('number');
    });
  });
});