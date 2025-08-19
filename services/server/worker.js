#!/usr/bin/env node

/**
 * Enhanced BullMQ Worker Service
 * Manages specialized workers for different processing tasks
 */

require('dotenv').config();

const WorkerManager = require('./workers/WorkerManager');
const { redisConfig } = require('./queues/specializedQueues');

console.log('🚀 Starting Enhanced BullMQ Worker Service...');
console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`Redis Host: ${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`);

// Test Redis connection before starting workers
(async () => {
  try {
    const Redis = require('ioredis');
    const redis = new Redis(redisConfig);
    await redis.ping();
    console.log('✅ Redis connection successful');
    redis.disconnect();
  } catch (error) {
    console.error('❌ Redis connection failed:', error.message);
    process.exit(1);
  }
})();

// Initialize and start the worker manager
const workerManager = new WorkerManager(redisConfig);

(async () => {
  try {
    await workerManager.start();

    // Log worker capabilities
    const capabilities = workerManager.getCapabilities();
    console.log('\n🔧 Worker Capabilities:');
    Object.entries(capabilities.workers).forEach(([workerType, caps]) => {
      console.log(`   ${workerType}: ${caps.features?.length || 0} features, concurrency: ${caps.concurrency || 1}`);
    });

    console.log('\n✅ All workers are running and waiting for jobs...');
    console.log('Press Ctrl+C to stop');

  } catch (error) {
    console.error('❌ Failed to start worker manager:', error);
    process.exit(1);
  }
})();

// Optional: Add health check endpoint for Docker
if (process.env.ENABLE_WORKER_HEALTH_CHECK === 'true') {
  const express = require('express');
  const app = express();
  const port = process.env.WORKER_HEALTH_PORT || 3002;

  app.get('/health', (req, res) => {
    const status = workerManager.getStatus();
    const healthStatus = {
      status: status.isRunning ? 'ok' : 'error',
      workerManager: status.isRunning,
      workers: status.workers,
      summary: status.summary,
      timestamp: new Date().toISOString(),
    };

    res.json(healthStatus);
  });

  app.get('/capabilities', (req, res) => {
    const capabilities = workerManager.getCapabilities();
    res.json(capabilities);
  });

  app.listen(port, () => {
    console.log(`💓 Worker health check server running on port ${port}`);
  });
}