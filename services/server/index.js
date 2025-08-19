///////////////////////////////
// Imports
///////////////////////////////

require('dotenv').config();
const path = require('path');
const express = require('express');

// middleware imports
const { jwtAuthMiddleware } = require('./middleware/jwtAuth');
const logRoutes = require('./middleware/logRoutes');
const logErrors = require('./middleware/logErrors');
const upload = require('./middleware/upload');
const { 
  uploadRateLimit, 
  enforceUserQuota, 
  enforceTeamQuota, 
  enforceSecurityLevel 
} = require('./middleware/securityEnforcement');
const { 
  auditFileUpload, 
  auditFileDownload, 
  auditFileDelete,
  auditLogger 
} = require('./middleware/auditLogger');
const {
  preUploadValidation,
  postUploadValidation,
} = require('./middleware/uploadSecurityValidation');

// controller imports
const authControllers = require('./controllers/authControllers');
const userControllers = require('./controllers/userControllers');
const organizationsController = require('./controllers/organizationsController');
const teamsController = require('./controllers/teamsController');
const bugController = require('./controllers/bugController');
const uploadController = require('./controllers/uploadController');
const artifactController = require('./controllers/artifactController');
const ProgressController = require('./controllers/progressController');
const { AnalyticsController } = require('./controllers/analyticsController');

const app = express();
const http = require('http');
const server = http.createServer(app);

// Import progress tracking service
const ProgressTrackingService = require('./services/ProgressTrackingService');
const { redisConfig } = require('./queues/specializedQueues');

// Import monitoring service
const { getMonitoringService } = require('./services/MonitoringService');

// Initialize progress tracking
const progressTracker = new ProgressTrackingService(server, redisConfig);

// Initialize analytics controller
const analyticsController = new AnalyticsController();

// Initialize and start monitoring service
const monitoringService = getMonitoringService({
  alertCheckInterval: 60000, // Check alerts every minute
  metricsCleanupInterval: 24 * 60 * 60 * 1000, // Clean metrics daily
  alertHistoryCleanupInterval: 7 * 24 * 60 * 60 * 1000 // Clean alert history weekly
});

// Start monitoring after server is ready
process.nextTick(() => {
  monitoringService.start();
});

// Store audit logger instance for middleware access
app.locals.auditLogger = auditLogger;

// middleware
app.use(logRoutes); // print information about each incoming request
app.use(express.json()); // parse incoming request bodies as JSON
app.use(express.static(path.join(__dirname, '../static-assets'))); // Serve static assets from the static-assets folder

///////////////////////////////
// Auth Routes
///////////////////////////////

app.post('/api/auth/register', authControllers.registerUser);
app.post('/api/auth/login', authControllers.loginUser);
app.get('/api/auth/me', jwtAuthMiddleware, authControllers.showMe);
app.delete('/api/auth/logout', authControllers.logoutUser);

///////////////////////////////
// User Routes
///////////////////////////////

// These actions require users to be logged in (JWT authentication)
// Express lets us pass a piece of middleware to run for a specific endpoint
app.get('/api/users', jwtAuthMiddleware, userControllers.listUsers);
app.get('/api/users/:id', jwtAuthMiddleware, userControllers.showUser);
app.patch('/api/users/:id', jwtAuthMiddleware, userControllers.updateUser);


///////////////////////////////
// Organization Routes (Protected)
///////////////////////////////

app.post('/api/orgs', jwtAuthMiddleware, organizationsController.createOrg);
app.get('/api/orgs', jwtAuthMiddleware, organizationsController.listMine);
app.post('/api/orgs/:orgId/members', jwtAuthMiddleware, organizationsController.addMember);

///////////////////////////////
// Team Routes (Protected)
///////////////////////////////

app.post('/api/teams', jwtAuthMiddleware, teamsController.createTeam);
app.get('/api/teams/org/:orgId', jwtAuthMiddleware, teamsController.listByOrg);
app.post('/api/teams/:teamId/members', jwtAuthMiddleware, teamsController.addMember);
app.post('/api/teams/:teamId/join', jwtAuthMiddleware, teamsController.joinOpenTeam);

///////////////////////////////
// Bug Report Routes (Protected)
///////////////////////////////

app.post('/api/bugs', jwtAuthMiddleware, uploadRateLimit, auditFileUpload, upload.array('files'), bugController.createWithUpload);
app.get('/api/bugs/team/:teamId', jwtAuthMiddleware, bugController.listByTeam);
app.get('/api/bugs/:bugId', jwtAuthMiddleware, bugController.showBug);
app.get('/api/bugs/:bugId/artifacts', jwtAuthMiddleware, bugController.listArtifacts);
app.post('/api/bugs/:bugId/process', jwtAuthMiddleware, bugController.processArtifacts);
app.get('/api/artifacts/:artifactId/download-url', jwtAuthMiddleware, auditFileDownload, bugController.getArtifactDownloadUrl);

///////////////////////////////
// Enhanced Artifact Management Routes
///////////////////////////////

// Enhanced download URL generation with variants and security improvements
app.get('/api/artifacts/:artifactId/download', jwtAuthMiddleware, auditFileDownload, artifactController.getDownloadUrl);

// Batch download as ZIP archive
app.post('/api/bugs/:bugId/batch-download', jwtAuthMiddleware, auditFileDownload, artifactController.getBatchDownload);

// Image gallery for visual artifacts
app.get('/api/bugs/:bugId/image-gallery', jwtAuthMiddleware, artifactController.getImageGallery);

// Get processed content with caching
app.get('/api/artifacts/:artifactId/processed-content', jwtAuthMiddleware, auditFileDownload, artifactController.getProcessedContent);

// Get artifact metadata and variants info
app.get('/api/artifacts/:artifactId/info', jwtAuthMiddleware, artifactController.getArtifactInfo);

// Admin routes for lifecycle management
app.post('/api/admin/artifacts/cleanup', jwtAuthMiddleware, artifactController.cleanupArtifacts);
app.get('/api/admin/artifacts/cache-stats', jwtAuthMiddleware, artifactController.getCacheStats);
app.post('/api/admin/artifacts/clear-cache', jwtAuthMiddleware, artifactController.clearCache);

// Client-direct S3 upload endpoints with enhanced security
app.post(
'/api/bugs/:bugId/presign', 
  jwtAuthMiddleware, 
  preUploadValidation,
  uploadRateLimit,
  enforceSecurityLevel,
  enforceUserQuota,
  enforceTeamQuota,
  auditFileUpload,
  uploadController.presignUpload
);
app.post(
'/api/bugs/:bugId/confirm-uploads', 
  jwtAuthMiddleware, 
  postUploadValidation,
  auditFileUpload,
  uploadController.confirmUploads
);

// Multipart upload endpoints with security
app.post(
'/api/bugs/:bugId/multipart-urls',
  jwtAuthMiddleware,
  uploadRateLimit,
  enforceUserQuota,
  enforceTeamQuota,
  auditFileUpload,
  uploadController.getMultipartUploadUrls
);
app.post(
'/api/bugs/:bugId/complete-multipart',
  jwtAuthMiddleware,
  postUploadValidation,
  auditFileUpload,
  uploadController.completeMultipartUpload
);
app.post(
'/api/bugs/:bugId/abort-multipart',
  jwtAuthMiddleware,
  auditFileUpload,
  uploadController.abortMultipartUpload
);
app.get(
'/api/bugs/:bugId/upload-progress/:uploadId',
  jwtAuthMiddleware,
  uploadController.getUploadProgress
);

///////////////////////////////
// Progress Tracking Routes (Protected)
///////////////////////////////

app.get('/api/jobs/:jobId/status', jwtAuthMiddleware, ProgressController.getJobStatus);
app.get('/api/artifacts/:artifactId/jobs', jwtAuthMiddleware, ProgressController.getArtifactJobs);
app.get('/api/bugs/:bugId/jobs', jwtAuthMiddleware, ProgressController.getBugReportJobs);
app.get('/api/processing/stats', jwtAuthMiddleware, ProgressController.getProcessingStats);
app.post('/api/jobs/:jobId/retry', jwtAuthMiddleware, ProgressController.retryJob);
app.get('/api/queues/health', jwtAuthMiddleware, ProgressController.getQueueHealth);

///////////////////////////////
// Analytics and Monitoring Routes (Protected)
///////////////////////////////

// Dashboard overview
app.get('/api/analytics/dashboard', jwtAuthMiddleware, analyticsController.getDashboardOverview.bind(analyticsController));

// Processing statistics
app.get('/api/analytics/processing', jwtAuthMiddleware, analyticsController.getProcessingStats.bind(analyticsController));

// Image processing analytics
app.get('/api/analytics/images', jwtAuthMiddleware, analyticsController.getImageAnalytics.bind(analyticsController));

// Cost analytics
app.get('/api/analytics/costs', jwtAuthMiddleware, analyticsController.getCostAnalytics.bind(analyticsController));

// Performance metrics
app.get('/api/analytics/performance', jwtAuthMiddleware, analyticsController.getPerformanceMetrics.bind(analyticsController));

// Error analytics
app.get('/api/analytics/errors', jwtAuthMiddleware, analyticsController.getErrorAnalytics.bind(analyticsController));

// System health
app.get('/api/analytics/health', jwtAuthMiddleware, analyticsController.getSystemHealth.bind(analyticsController));

// Alerts management
app.get('/api/analytics/alerts', jwtAuthMiddleware, analyticsController.getAlerts.bind(analyticsController));
app.put('/api/analytics/alerts/thresholds', jwtAuthMiddleware, analyticsController.updateAlertThresholds.bind(analyticsController));
app.post('/api/analytics/alerts/check', jwtAuthMiddleware, analyticsController.checkAlerts.bind(analyticsController));

// Custom metrics
app.get('/api/analytics/metrics/:category', jwtAuthMiddleware, analyticsController.getCustomMetrics.bind(analyticsController));
app.post('/api/analytics/metrics/:category', jwtAuthMiddleware, analyticsController.recordCustomMetric.bind(analyticsController));

// Monitoring service endpoints
app.get('/api/monitoring/health', (req, res) => {
  monitoringService.getHealthSummary()
    .then(health => res.json(health))
    .catch(error => res.status(500).json({ error: error.message }));
});

app.get('/api/monitoring/status', (req, res) => {
  res.json(monitoringService.getStatus());
});

app.post('/api/monitoring/check-alerts', jwtAuthMiddleware, async (req, res) => {
  try {
    const alerts = await monitoringService.forceAlertCheck();
    res.json({ message: 'Alert check completed', alerts });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.use(logErrors);

///////////////////////////////
// Fallback Routes
///////////////////////////////

// Requests meant for the API will be sent along to the router.
// For all other requests, send back the index.html file for SPA routing.
app.get('*', (req, res, next) => {
  if (req.originalUrl.startsWith('/api')) return next();
  res.sendFile(path.join(__dirname, '../static-assets/index.html'));
});

///////////////////////////////
// Start Listening
///////////////////////////////

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}/`);
  console.log(`WebSocket server ready for real-time progress tracking`);
});
