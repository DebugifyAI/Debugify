const Artifact = require('../models/Artifact');
const BugReport = require('../models/BugReport');
const Team = require('../models/Team');
const artifactManagementService = require('../services/ArtifactManagementService');
const { auditLogger } = require('../middleware/auditLogger');

/**
 * Enhanced Artifact Controller
 * Handles download URLs, batch operations, image gallery, and lifecycle management
 */

/**
 * Generate enhanced download URL with security improvements
 */
exports.getDownloadUrl = async (req, res) => {
  try {
    const { artifactId } = req.params;
    const { 
      variant = null, 
      expiresIn = 3600,
      disposition = 'attachment',
    } = req.query;

    // Verify artifact exists
    const artifact = await Artifact.find(artifactId);
    if (!artifact) {
      return res.status(404).json({
        message: 'Artifact not found',
        code: 'ARTIFACT_NOT_FOUND',
      });
    }

    // Authorization via bug report/team
    const bugReport = await BugReport.find(artifact.bug_report_id);
    if (!bugReport) {
      return res.status(404).json({
        message: 'Associated bug report not found',
        code: 'BUG_NOT_FOUND',
      });
    }

    const teamMembers = await Team.getMembers(bugReport.team_id);
    const isMember = teamMembers.some(member => member.user_id === req.user.id);
    if (!isMember) {
      return res.status(403).json({
        message: 'Access denied: not a team member',
        code: 'ACCESS_DENIED',
      });
    }

    // Generate download URL
    const result = await artifactManagementService.generateDownloadUrl(artifactId, {
      expiresIn: parseInt(expiresIn, 10),
      variant,
      responseContentDisposition: disposition === 'inline' ? 'inline' : 'attachment',
      userId: req.user.id,
    });

    return res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('Error generating download URL:', error);
    return res.status(500).json({
      message: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
  }
};

/**
 * Generate batch download as ZIP archive
 */
exports.getBatchDownload = async (req, res) => {
  try {
    const { bugId } = req.params;
    const { 
      artifactIds = [],
      includeVariants = false,
      compressionLevel = 6,
    } = req.body;

    if (!Array.isArray(artifactIds) || artifactIds.length === 0) {
      return res.status(400).json({
        message: 'artifactIds array is required and must not be empty',
        code: 'MISSING_ARTIFACT_IDS',
      });
    }

    // Verify bug report exists and user has access
    const bugReport = await BugReport.find(bugId);
    if (!bugReport) {
      return res.status(404).json({
        message: 'Bug report not found',
        code: 'BUG_NOT_FOUND',
      });
    }

    const teamMembers = await Team.getMembers(bugReport.team_id);
    const isMember = teamMembers.some(member => member.user_id === req.user.id);
    if (!isMember) {
      return res.status(403).json({
        message: 'Access denied: not a team member',
        code: 'ACCESS_DENIED',
      });
    }

    // Verify all artifacts belong to this bug report
    const artifacts = await Promise.all(
      artifactIds.map(id => Artifact.find(id))
    );

    const invalidArtifacts = artifacts.filter(
      (artifact, index) => !artifact || artifact.bug_report_id !== parseInt(bugId, 10)
    );

    if (invalidArtifacts.length > 0) {
      return res.status(400).json({
        message: 'Some artifacts do not belong to this bug report or do not exist',
        code: 'INVALID_ARTIFACTS',
      });
    }

    // Generate batch download
    const result = await artifactManagementService.generateBatchDownload(artifactIds, {
      includeVariants: includeVariants === 'true' || includeVariants === true,
      compressionLevel: parseInt(compressionLevel, 10),
      userId: req.user.id,
    });

    // Set response headers for ZIP download
    const filename = `bug-${bugId}-artifacts-${Date.now()}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Total-Files', result.totalFiles);
    res.setHeader('X-Total-Size', result.totalSize);

    // Finalize archive and pipe to response
    result.archive.finalize();
    result.archive.pipe(res);

    // Handle archive events
    result.archive.on('error', (error) => {
      console.error('Archive error:', error);
      if (!res.headersSent) {
        res.status(500).json({
          message: 'Error creating archive',
          code: 'ARCHIVE_ERROR',
        });
      }
    });

  } catch (error) {
    console.error('Error generating batch download:', error);
    if (!res.headersSent) {
      return res.status(500).json({
        message: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }
};

/**
 * Get image gallery for visual artifacts
 */
exports.getImageGallery = async (req, res) => {
  try {
    const { bugId } = req.params;
    const {
      includeVariants = true,
      sortBy = 'created_at',
      sortOrder = 'desc',
      limit = 50,
      offset = 0,
    } = req.query;

    // Verify bug report exists and user has access
    const bugReport = await BugReport.find(bugId);
    if (!bugReport) {
      return res.status(404).json({
        message: 'Bug report not found',
        code: 'BUG_NOT_FOUND',
      });
    }

    const teamMembers = await Team.getMembers(bugReport.team_id);
    const isMember = teamMembers.some(member => member.user_id === req.user.id);
    if (!isMember) {
      return res.status(403).json({
        message: 'Access denied: not a team member',
        code: 'ACCESS_DENIED',
      });
    }

    // Get image gallery
    const gallery = await artifactManagementService.getImageGallery(bugId, {
      includeVariants: includeVariants === 'true' || includeVariants === true,
      sortBy,
      sortOrder,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
    });

    return res.json({
      success: true,
      ...gallery,
    });
  } catch (error) {
    console.error('Error getting image gallery:', error);
    return res.status(500).json({
      message: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
  }
};

/**
 * Get cached processed content
 */
exports.getProcessedContent = async (req, res) => {
  try {
    const { artifactId } = req.params;
    const {
      format = 'json',
      compress = true,
    } = req.query;

    // Verify artifact exists
    const artifact = await Artifact.find(artifactId);
    if (!artifact) {
      return res.status(404).json({
        message: 'Artifact not found',
        code: 'ARTIFACT_NOT_FOUND',
      });
    }

    // Authorization via bug report/team
    const bugReport = await BugReport.find(artifact.bug_report_id);
    if (!bugReport) {
      return res.status(404).json({
        message: 'Associated bug report not found',
        code: 'BUG_NOT_FOUND',
      });
    }

    const teamMembers = await Team.getMembers(bugReport.team_id);
    const isMember = teamMembers.some(member => member.user_id === req.user.id);
    if (!isMember) {
      return res.status(403).json({
        message: 'Access denied: not a team member',
        code: 'ACCESS_DENIED',
      });
    }

    // Get processed content
    const result = await artifactManagementService.getCachedProcessedContent(artifactId, {
      format,
      compress: compress === 'true' || compress === true,
      userId: req.user.id,
    });

    // Set appropriate content type
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('X-Cached', result.cached);
    
    if (result.summary) {
      res.setHeader('X-Content-Summary', encodeURIComponent(result.summary));
    }

    return res.send(result.content);
  } catch (error) {
    console.error('Error getting processed content:', error);
    return res.status(500).json({
      message: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
  }
};

/**
 * Get artifact metadata and variants info
 */
exports.getArtifactInfo = async (req, res) => {
  try {
    const { artifactId } = req.params;

    // Verify artifact exists
    const artifact = await Artifact.find(artifactId);
    if (!artifact) {
      return res.status(404).json({
        message: 'Artifact not found',
        code: 'ARTIFACT_NOT_FOUND',
      });
    }

    // Authorization via bug report/team
    const bugReport = await BugReport.find(artifact.bug_report_id);
    if (!bugReport) {
      return res.status(404).json({
        message: 'Associated bug report not found',
        code: 'BUG_NOT_FOUND',
      });
    }

    const teamMembers = await Team.getMembers(bugReport.team_id);
    const isMember = teamMembers.some(member => member.user_id === req.user.id);
    if (!isMember) {
      return res.status(403).json({
        message: 'Access denied: not a team member',
        code: 'ACCESS_DENIED',
      });
    }

    // Prepare artifact info
    const artifactInfo = {
      id: artifact.id,
      bugReportId: artifact.bug_report_id,
      originalFilename: artifact.metadata?.originalname,
      contentType: artifact.content_type,
      size: artifact.size_bytes,
      status: artifact.status,
      validationStatus: artifact.validation_status,
      createdAt: artifact.created_at,
      updatedAt: artifact.updated_at,
      
      // Processing information
      processingStages: artifact.processing_stages,
      contentSummary: artifact.content_summary,
      retryCount: artifact.retry_count,
      lastError: artifact.last_error,
      
      // Image-specific data
      isImage: artifact.isImage(),
      imageMetadata: artifact.image_metadata,
      ocrText: artifact.ocr_text,
      visualElements: artifact.visual_elements,
      sensitiveDataFlags: artifact.sensitive_data_flags,
      
      // Available variants
      variants: artifact.image_variants ? Object.keys(artifact.image_variants) : [],
      
      // Processing status
      isProcessed: artifact.isProcessed(),
      hasProcessedContent: !!artifact.parsed_content_s3_key,
    };

    return res.json({
      success: true,
      artifact: artifactInfo,
    });
  } catch (error) {
    console.error('Error getting artifact info:', error);
    return res.status(500).json({
      message: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
  }
};

/**
 * Cleanup old artifacts (admin only)
 */
exports.cleanupArtifacts = async (req, res) => {
  try {
    // This should be restricted to admin users
    // For now, we'll check if user is in a specific admin team or has admin role
    // This is a placeholder - implement proper admin authorization
    
    const {
      olderThanDays = 90,
      includeProcessed = false,
      dryRun = true,
      batchSize = 100,
    } = req.body;

    // Perform cleanup
    const result = await artifactManagementService.cleanupArtifacts({
      olderThanDays: parseInt(olderThanDays, 10),
      includeProcessed: includeProcessed === 'true' || includeProcessed === true,
      dryRun: dryRun === 'true' || dryRun === true,
      batchSize: parseInt(batchSize, 10),
    });

    return res.json({
      success: true,
      cleanup: result,
    });
  } catch (error) {
    console.error('Error during artifact cleanup:', error);
    return res.status(500).json({
      message: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
  }
};

/**
 * Get cache statistics (admin only)
 */
exports.getCacheStats = async (req, res) => {
  try {
    const stats = artifactManagementService.getCacheStats();
    
    return res.json({
      success: true,
      cache: stats,
    });
  } catch (error) {
    console.error('Error getting cache stats:', error);
    return res.status(500).json({
      message: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
  }
};

/**
 * Clear download cache (admin only)
 */
exports.clearCache = async (req, res) => {
  try {
    artifactManagementService.clearCache();
    
    return res.json({
      success: true,
      message: 'Cache cleared successfully',
    });
  } catch (error) {
    console.error('Error clearing cache:', error);
    return res.status(500).json({
      message: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
  }
};