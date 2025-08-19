/**
 * Client-side Progress Tracking Utilities
 * Handles WebSocket connections and progress monitoring
 */

import { io } from 'socket.io-client';

class ProgressTracker {
  constructor(options = {}) {
    this.socket = null;
    this.isConnected = false;
    this.subscribedJobs = new Set();
    this.eventHandlers = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = options.maxReconnectAttempts || 5;
    this.reconnectDelay = options.reconnectDelay || 1000;
    
    this.serverUrl = options.serverUrl || 'http://localhost:3000';
    this.token = options.token || null;
    this.userId = options.userId || null;
  }

  // Initialize WebSocket connection
  connect() {
    if (this.socket && this.isConnected) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      this.socket = io(this.serverUrl, {
        path: '/socket.io',
        transports: ['websocket', 'polling'],
        timeout: 10000,
        forceNew: true
      });

      this.socket.on('connect', () => {
        console.log('Connected to progress tracking server');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        
        // Authenticate if we have credentials
        if (this.token && this.userId) {
          this.authenticate();
        }
        
        resolve();
      });

      this.socket.on('disconnect', (reason) => {
        console.log('Disconnected from progress tracking server:', reason);
        this.isConnected = false;
        
        if (reason === 'io server disconnect') {
          // Server initiated disconnect, don't reconnect
          return;
        }
        
        // Attempt to reconnect
        this.attemptReconnect();
      });

      this.socket.on('connect_error', (error) => {
        console.error('Connection error:', error);
        this.isConnected = false;
        reject(error);
      });

      this.setupEventHandlers();
    });
  }

  // Authenticate with the server
  authenticate() {
    if (!this.socket || !this.isConnected) {
      console.warn('Cannot authenticate: not connected');
      return;
    }

    this.socket.emit('authenticate', {
      userId: this.userId,
      token: this.token
    });
  }

  // Set authentication credentials
  setCredentials(userId, token) {
    this.userId = userId;
    this.token = token;
    
    if (this.isConnected) {
      this.authenticate();
    }
  }

  // Setup event handlers for progress updates
  setupEventHandlers() {
    this.socket.on('authenticated', (data) => {
      console.log('Authentication successful:', data);
      this.emit('authenticated', data);
    });

    this.socket.on('job_progress', (data) => {
      this.emit('progress', data);
      this.emit(`progress:${data.jobId}`, data);
    });

    this.socket.on('job_update', (data) => {
      this.emit('update', data);
      this.emit(`update:${data.jobId}`, data);
      
      // Handle completion/failure
      if (data.status === 'completed') {
        this.emit('completed', data);
        this.emit(`completed:${data.jobId}`, data);
      } else if (data.status === 'failed') {
        this.emit('failed', data);
        this.emit(`failed:${data.jobId}`, data);
      }
    });

    this.socket.on('job_status', (data) => {
      this.emit('status', data);
      this.emit(`status:${data.jobId}`, data);
    });

    this.socket.on('notification', (data) => {
      this.emit('notification', data);
    });

    this.socket.on('job_subscribed', (data) => {
      this.subscribedJobs.add(data.jobId);
      this.emit('subscribed', data);
    });

    this.socket.on('job_unsubscribed', (data) => {
      this.subscribedJobs.delete(data.jobId);
      this.emit('unsubscribed', data);
    });
  }

  // Subscribe to job progress updates
  subscribeToJob(jobId) {
    if (!this.socket || !this.isConnected) {
      console.warn('Cannot subscribe: not connected');
      return false;
    }

    this.socket.emit('subscribe_job', { jobId });
    return true;
  }

  // Unsubscribe from job progress updates
  unsubscribeFromJob(jobId) {
    if (!this.socket || !this.isConnected) {
      return false;
    }

    this.socket.emit('unsubscribe_job', { jobId });
    return true;
  }

  // Add event listener
  on(event, handler) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event).add(handler);
  }

  // Remove event listener
  off(event, handler) {
    if (this.eventHandlers.has(event)) {
      this.eventHandlers.get(event).delete(handler);
    }
  }

  // Emit event to handlers
  emit(event, data) {
    if (this.eventHandlers.has(event)) {
      this.eventHandlers.get(event).forEach(handler => {
        try {
          handler(data);
        } catch (error) {
          console.error(`Error in event handler for ${event}:`, error);
        }
      });
    }
  }

  // Attempt to reconnect
  attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      this.emit('reconnect_failed');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    
    console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${delay}ms`);
    
    setTimeout(() => {
      if (!this.isConnected) {
        this.connect().catch(error => {
          console.error('Reconnection failed:', error);
          this.attemptReconnect();
        });
      }
    }, delay);
  }

  // Disconnect from server
  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.isConnected = false;
    this.subscribedJobs.clear();
  }

  // Get connection status
  getStatus() {
    return {
      connected: this.isConnected,
      subscribedJobs: Array.from(this.subscribedJobs),
      reconnectAttempts: this.reconnectAttempts
    };
  }
}

// Progress monitoring utilities
export class ProgressMonitor {
  constructor(tracker) {
    this.tracker = tracker;
    this.activeJobs = new Map();
    this.completedJobs = new Map();
    this.failedJobs = new Map();
  }

  // Monitor a job with callbacks
  monitorJob(jobId, callbacks = {}) {
    const monitor = {
      jobId,
      startTime: Date.now(),
      callbacks: {
        onProgress: callbacks.onProgress || (() => {}),
        onUpdate: callbacks.onUpdate || (() => {}),
        onCompleted: callbacks.onCompleted || (() => {}),
        onFailed: callbacks.onFailed || (() => {}),
        onStatus: callbacks.onStatus || (() => {})
      }
    };

    this.activeJobs.set(jobId, monitor);

    // Subscribe to job updates
    this.tracker.subscribeToJob(jobId);

    // Set up event handlers
    this.tracker.on(`progress:${jobId}`, (data) => {
      monitor.lastProgress = data;
      monitor.callbacks.onProgress(data);
    });

    this.tracker.on(`update:${jobId}`, (data) => {
      monitor.lastUpdate = data;
      monitor.callbacks.onUpdate(data);
    });

    this.tracker.on(`completed:${jobId}`, (data) => {
      monitor.completedAt = Date.now();
      monitor.duration = monitor.completedAt - monitor.startTime;
      this.completedJobs.set(jobId, monitor);
      this.activeJobs.delete(jobId);
      monitor.callbacks.onCompleted(data);
    });

    this.tracker.on(`failed:${jobId}`, (data) => {
      monitor.failedAt = Date.now();
      monitor.duration = monitor.failedAt - monitor.startTime;
      this.failedJobs.set(jobId, monitor);
      this.activeJobs.delete(jobId);
      monitor.callbacks.onFailed(data);
    });

    this.tracker.on(`status:${jobId}`, (data) => {
      monitor.lastStatus = data;
      monitor.callbacks.onStatus(data);
    });

    return monitor;
  }

  // Stop monitoring a job
  stopMonitoring(jobId) {
    this.tracker.unsubscribeFromJob(jobId);
    this.activeJobs.delete(jobId);
  }

  // Get monitoring statistics
  getStats() {
    return {
      active: this.activeJobs.size,
      completed: this.completedJobs.size,
      failed: this.failedJobs.size,
      total: this.activeJobs.size + this.completedJobs.size + this.failedJobs.size
    };
  }
}

// Image processing progress utilities
export class ImageProgressTracker {
  constructor(progressMonitor) {
    this.progressMonitor = progressMonitor;
  }

  // Track image processing with preview capabilities
  trackImageProcessing(jobId, imageFile, callbacks = {}) {
    const imagePreview = this.createImagePreview(imageFile);
    
    return this.progressMonitor.monitorJob(jobId, {
      onProgress: (data) => {
        // Handle image-specific progress
        if (data.stage === 'variant_generation') {
          this.handleVariantGeneration(data, callbacks.onVariantProgress);
        } else if (data.stage === 'ocr_processing') {
          this.handleOCRProgress(data, callbacks.onOCRProgress);
        } else if (data.stage === 'visual_detection') {
          this.handleVisualDetection(data, callbacks.onVisualProgress);
        }
        
        if (callbacks.onProgress) {
          callbacks.onProgress(data, imagePreview);
        }
      },
      onCompleted: (data) => {
        if (callbacks.onCompleted) {
          callbacks.onCompleted(data, imagePreview);
        }
      },
      onFailed: (data) => {
        if (callbacks.onFailed) {
          callbacks.onFailed(data, imagePreview);
        }
      }
    });
  }

  // Create image preview for UI
  createImagePreview(imageFile) {
    if (!imageFile || typeof imageFile === 'string') {
      return { url: imageFile, type: 'url' };
    }

    const url = URL.createObjectURL(imageFile);
    return {
      url,
      type: 'blob',
      name: imageFile.name,
      size: imageFile.size,
      cleanup: () => URL.revokeObjectURL(url)
    };
  }

  // Handle variant generation progress
  handleVariantGeneration(data, callback) {
    if (callback && data.details) {
      callback({
        variant: data.details.variant,
        completed: data.details.completed,
        total: data.details.total,
        progress: data.progress
      });
    }
  }

  // Handle OCR progress
  handleOCRProgress(data, callback) {
    if (callback && data.details) {
      callback({
        confidence: data.details.confidence,
        textLength: data.details.textLength,
        quality: data.details.quality,
        progress: data.progress
      });
    }
  }

  // Handle visual detection progress
  handleVisualDetection(data, callback) {
    if (callback && data.details) {
      callback({
        elementsDetected: data.details.elementsDetected,
        progress: data.progress
      });
    }
  }
}

// Create singleton instance
let globalTracker = null;

export function getProgressTracker(options = {}) {
  if (!globalTracker) {
    globalTracker = new ProgressTracker(options);
  }
  return globalTracker;
}

export { ProgressTracker };