/**
 * Real-time Progress Tracking Service
 * Manages WebSocket connections and job progress updates
 */

const { Server } = require('socket.io');
const { Queue } = require('bullmq');
const ProcessingJob = require('../models/ProcessingJob');

class ProgressTrackingService {
  constructor(server, redisConfig) {
    this.io = new Server(server, {
      cors: {
        origin: process.env.FRONTEND_URL || "http://localhost:5173",
        methods: ["GET", "POST"],
        credentials: true
      },
      path: '/socket.io'
    });

    this.redisConfig = redisConfig;
    this.connectedClients = new Map(); // userId -> Set of socket IDs
    this.jobSubscriptions = new Map(); // jobId -> Set of socket IDs
    
    this.setupSocketHandlers();
    this.setupQueueListeners();
  }

  setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      console.log(`Client connected: ${socket.id}`);

      // Handle authentication
      socket.on('authenticate', (data) => {
        const { userId, token } = data;
        // TODO: Verify JWT token here
        socket.userId = userId;
        
        if (!this.connectedClients.has(userId)) {
          this.connectedClients.set(userId, new Set());
        }
        this.connectedClients.get(userId).add(socket.id);
        
        socket.emit('authenticated', { success: true });
        console.log(`User ${userId} authenticated on socket ${socket.id}`);
      });

      // Handle job subscription
      socket.on('subscribe_job', (data) => {
        const { jobId } = data;
        if (!this.jobSubscriptions.has(jobId)) {
          this.jobSubscriptions.set(jobId, new Set());
        }
        this.jobSubscriptions.get(jobId).add(socket.id);
        
        socket.emit('job_subscribed', { jobId });
        console.log(`Socket ${socket.id} subscribed to job ${jobId}`);
        
        // Send current job status immediately
        this.sendJobStatus(jobId, socket.id);
      });

      // Handle job unsubscription
      socket.on('unsubscribe_job', (data) => {
        const { jobId } = data;
        if (this.jobSubscriptions.has(jobId)) {
          this.jobSubscriptions.get(jobId).delete(socket.id);
          if (this.jobSubscriptions.get(jobId).size === 0) {
            this.jobSubscriptions.delete(jobId);
          }
        }
        socket.emit('job_unsubscribed', { jobId });
      });

      // Handle disconnect
      socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
        this.cleanupSocket(socket);
      });
    });
  }

  setupQueueListeners() {
    // Listen to all specialized queues for progress updates
    const queueNames = ['validation', 'parsing', 'image-processing', 'llm-analysis', 'cleanup'];
    
    queueNames.forEach(queueName => {
      const queue = new Queue(queueName, { connection: this.redisConfig });
      
      // Job progress updates
      queue.on('progress', (job, progress) => {
        this.broadcastJobProgress(job.id, {
          jobId: job.id,
          queueName,
          progress,
          stage: job.data.stage || 'processing',
          timestamp: new Date().toISOString()
        });
      });

      // Job completion
      queue.on('completed', (job, result) => {
        this.broadcastJobUpdate(job.id, {
          jobId: job.id,
          queueName,
          status: 'completed',
          result,
          completedAt: new Date().toISOString()
        });
      });

      // Job failure
      queue.on('failed', (job, error) => {
        this.broadcastJobUpdate(job.id, {
          jobId: job.id,
          queueName,
          status: 'failed',
          error: error.message,
          failedAt: new Date().toISOString()
        });
      });

      // Job started
      queue.on('active', (job) => {
        this.broadcastJobUpdate(job.id, {
          jobId: job.id,
          queueName,
          status: 'active',
          startedAt: new Date().toISOString()
        });
      });
    });
  }

  async sendJobStatus(jobId, socketId = null) {
    try {
      const job = await ProcessingJob.findByJobId(jobId);
      if (!job) {
        return;
      }

      const status = {
        jobId,
        status: job.status,
        progress: job.progress,
        jobType: job.job_type,
        artifactId: job.artifact_id,
        startedAt: job.started_at,
        completedAt: job.completed_at,
        errorDetails: job.error_details,
        resultData: job.result_data,
        timestamp: new Date().toISOString()
      };

      if (socketId) {
        this.io.to(socketId).emit('job_status', status);
      } else {
        this.broadcastToJobSubscribers(jobId, 'job_status', status);
      }
    } catch (error) {
      console.error(`Error sending job status for ${jobId}:`, error);
    }
  }

  broadcastJobProgress(jobId, progressData) {
    this.broadcastToJobSubscribers(jobId, 'job_progress', progressData);
    
    // Update database
    this.updateJobProgress(jobId, progressData.progress, progressData.stage);
  }

  broadcastJobUpdate(jobId, updateData) {
    this.broadcastToJobSubscribers(jobId, 'job_update', updateData);
    
    // Update database based on status
    if (updateData.status === 'completed') {
      this.updateJobCompletion(jobId, updateData.result);
    } else if (updateData.status === 'failed') {
      this.updateJobFailure(jobId, updateData.error);
    } else if (updateData.status === 'active') {
      this.updateJobStart(jobId);
    }
  }

  broadcastToJobSubscribers(jobId, event, data) {
    const subscribers = this.jobSubscriptions.get(jobId);
    if (subscribers && subscribers.size > 0) {
      subscribers.forEach(socketId => {
        this.io.to(socketId).emit(event, data);
      });
    }
  }

  broadcastToUser(userId, event, data) {
    const userSockets = this.connectedClients.get(userId);
    if (userSockets && userSockets.size > 0) {
      userSockets.forEach(socketId => {
        this.io.to(socketId).emit(event, data);
      });
    }
  }

  async updateJobProgress(jobId, progress, stage) {
    try {
      await ProcessingJob.updateProgress(jobId, progress, stage);
    } catch (error) {
      console.error(`Error updating job progress for ${jobId}:`, error);
    }
  }

  async updateJobStart(jobId) {
    try {
      await ProcessingJob.updateStatus(jobId, 'active', { started_at: new Date() });
    } catch (error) {
      console.error(`Error updating job start for ${jobId}:`, error);
    }
  }

  async updateJobCompletion(jobId, result) {
    try {
      await ProcessingJob.updateStatus(jobId, 'completed', {
        completed_at: new Date(),
        result_data: result
      });
    } catch (error) {
      console.error(`Error updating job completion for ${jobId}:`, error);
    }
  }

  async updateJobFailure(jobId, errorMessage) {
    try {
      await ProcessingJob.updateStatus(jobId, 'failed', {
        completed_at: new Date(),
        error_details: { message: errorMessage }
      });
    } catch (error) {
      console.error(`Error updating job failure for ${jobId}:`, error);
    }
  }

  cleanupSocket(socket) {
    // Remove from user connections
    if (socket.userId && this.connectedClients.has(socket.userId)) {
      this.connectedClients.get(socket.userId).delete(socket.id);
      if (this.connectedClients.get(socket.userId).size === 0) {
        this.connectedClients.delete(socket.userId);
      }
    }

    // Remove from job subscriptions
    this.jobSubscriptions.forEach((subscribers, jobId) => {
      subscribers.delete(socket.id);
      if (subscribers.size === 0) {
        this.jobSubscriptions.delete(jobId);
      }
    });
  }

  // Notification system for processing completion and failures
  async sendNotification(userId, notification) {
    const notificationData = {
      id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: notification.type, // 'success', 'error', 'warning', 'info'
      title: notification.title,
      message: notification.message,
      data: notification.data || {},
      timestamp: new Date().toISOString()
    };

    this.broadcastToUser(userId, 'notification', notificationData);
    
    // TODO: Store notification in database for persistence
    console.log(`Notification sent to user ${userId}:`, notificationData);
  }

  // Get connection statistics
  getStats() {
    return {
      connectedClients: this.connectedClients.size,
      totalSockets: Array.from(this.connectedClients.values())
        .reduce((total, sockets) => total + sockets.size, 0),
      activeJobSubscriptions: this.jobSubscriptions.size,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = ProgressTrackingService;