const aws = require('aws-sdk');
const archiver = require('archiver');
const { Readable } = require('stream');
const Artifact = require('../models/Artifact');
const { getAWSCredentials } = require('../utils/SecureCredentialManager');
const { auditLogger } = require('../middleware/auditLogger');

/**
 * Enhanced Artifact Management Service
 * Handles download URLs, batch operations, lifecycle management, and caching
 */
class ArtifactManagementService {
  constructor() {
    this.s3Instance = null;
    this.downloadCache = new Map(); // Simple in-memory cache for frequently accessed items
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes cache timeout
  }

  /**
   * Get S3 instance with secure credentials
   */
  async getS3Instance() {
    if (!this.s3Instance) {
      try {
        const credentials = await getAWSCredentials();
        this.s3Instance = new aws.S3({
          accessKeyId: credentials.accessKeyId,
          secretAccessKey: credentials.secretAccessKey,
          region: credentials.region,
          sessionToken: credentials.sessionToken,
        });
      } catch (error) {
        console.error('Failed to initialize S3 with secure credentials:', error);
        // Fallback to environment variables
        this.s3Instance = new aws.S3({
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          region: process.env.AWS_REGION || 'us-east-1',
        });
      }
    }
    return this.s3Instance;
  }

  /**
   * Generate enhanced presigned download URL with security improvements
   */
  async generateDownloadUrl(artifactId, options = {}) {
    const {
      expiresIn = 3600, // 1 hour default
      responseContentType = null,
      responseContentDisposition = null,
      variant = null, // For image variants (thumbnail, web-optimized, etc.)
      userId = null,
    } = options;

    try {
      const artifact = await Artifact.find(artifactId);
      if (!artifact) {
        throw new Error('Artifact not found');
      }

      const s3 = await this.getS3Instance();
      let s3Key = artifact.s3_key;

      // Handle image variants
      if (variant && artifact.image_variants && artifact.image_variants[variant]) {
        s3Key = artifact.image_variants[variant].s3_key;
      }

      // Generate cache key for frequently accessed items
      const cacheKey = `${artifactId}-${variant || 'original'}-${userId}`;
      
      // Check cache for recent URLs (to avoid regenerating frequently)
      const cached = this.downloadCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
        return {
          url: cached.url,
          cached: true,
          expiresAt: cached.expiresAt,
        };
      }

      const params = {
        Bucket: artifact.s3_bucket,
        Key: s3Key,
        Expires: expiresIn,
      };

      // Add response headers if specified
      if (responseContentType) {
        params.ResponseContentType = responseContentType;
      }
      
      if (responseContentDisposition) {
        params.ResponseContentDisposition = responseContentDisposition;
      } else {
        // Default to attachment with original filename
        const filename = artifact.metadata?.originalname || `artifact-${artifactId}`;
        params.ResponseContentDisposition = `attachment; filename="${filename}"`;
      }

      const url = s3.getSignedUrl('getObject', params);
      const expiresAt = new Date(Date.now() + expiresIn * 1000);

      // Cache the URL
      this.downloadCache.set(cacheKey, {
        url,
        timestamp: Date.now(),
        expiresAt,
      });

      // Audit log the download URL generation
      if (userId) {
        await auditLogger.logFileAccess('download_url_generated', {
          id: artifactId,
          variant: variant || 'original',
          expiresAt: expiresAt.toISOString(),
        }, { user: { id: userId } });
      }

      return {
        url,
        cached: false,
        expiresAt,
        variant: variant || 'original',
        contentType: artifact.content_type,
        size: artifact.size_bytes,
      };
    } catch (error) {
      console.error('Error generating download URL:', error);
      throw error;
    }
  }

  /**
   * Generate batch download as ZIP archive
   */
  async generateBatchDownload(artifactIds, options = {}) {
    const {
      includeVariants = false,
      compressionLevel = 6,
      userId = null,
      maxTotalSize = 1024 * 1024 * 1024, // 1GB limit
    } = options;

    try {
      // Fetch all artifacts
      const artifacts = await Promise.all(
        artifactIds.map(id => Artifact.find(id))
      );

      // Filter out null artifacts
      const validArtifacts = artifacts.filter(artifact => artifact !== null);
      
      if (validArtifacts.length === 0) {
        throw new Error('No valid artifacts found');
      }

      // Calculate total size
      let totalSize = 0;
      const downloadItems = [];

      for (const artifact of validArtifacts) {
        // Add original file
        downloadItems.push({
          artifact,
          s3Key: artifact.s3_key,
          filename: artifact.metadata?.originalname || `artifact-${artifact.id}`,
          size: artifact.size_bytes || 0,
        });
        totalSize += artifact.size_bytes || 0;

        // Add image variants if requested
        if (includeVariants && artifact.image_variants) {
          for (const [variantName, variantData] of Object.entries(artifact.image_variants)) {
            downloadItems.push({
              artifact,
              s3Key: variantData.s3_key,
              filename: `${variantName}/${artifact.metadata?.originalname || `artifact-${artifact.id}`}`,
              size: variantData.size || 0,
            });
            totalSize += variantData.size || 0;
          }
        }
      }

      // Check size limit
      if (totalSize > maxTotalSize) {
        throw new Error(`Total download size (${totalSize} bytes) exceeds limit (${maxTotalSize} bytes)`);
      }

      // Create ZIP archive stream
      const archive = archiver('zip', {
        zlib: { level: compressionLevel },
      });

      const s3 = await this.getS3Instance();

      // Add files to archive
      for (const item of downloadItems) {
        try {
          const s3Stream = s3.getObject({
            Bucket: item.artifact.s3_bucket,
            Key: item.s3Key,
          }).createReadStream();

          archive.append(s3Stream, { name: item.filename });
        } catch (error) {
          console.error(`Error adding ${item.filename} to archive:`, error);
          // Continue with other files
        }
      }

      // Audit log the batch download
      if (userId) {
        await auditLogger.logFileAccess('batch_download_generated', {
          artifactIds,
          totalFiles: downloadItems.length,
          totalSize,
          includeVariants,
        }, { user: { id: userId } });
      }

      return {
        archive,
        totalFiles: downloadItems.length,
        totalSize,
        estimatedCompressedSize: Math.round(totalSize * 0.7), // Rough estimate
      };
    } catch (error) {
      console.error('Error generating batch download:', error);
      throw error;
    }
  }

  /**
   * Get image gallery data for visual artifacts
   */
  async getImageGallery(bugReportId, options = {}) {
    const {
      includeVariants = true,
      sortBy = 'created_at',
      sortOrder = 'desc',
      limit = 50,
      offset = 0,
    } = options;

    try {
      // Get all image artifacts for the bug report
      const artifacts = await Artifact.query()
        .where('bug_report_id', bugReportId)
        .where('content_type', 'like', 'image/%')
        .where('status', 'processed')
        .orderBy(sortBy, sortOrder)
        .limit(limit)
        .offset(offset);

      const galleryItems = [];

      for (const artifact of artifacts) {
        const item = {
          id: artifact.id,
          originalFilename: artifact.metadata?.originalname,
          contentType: artifact.content_type,
          size: artifact.size_bytes,
          createdAt: artifact.created_at,
          metadata: artifact.image_metadata,
          ocrText: artifact.ocr_text,
          visualElements: artifact.visual_elements,
          sensitiveDataFlags: artifact.sensitive_data_flags,
          variants: {},
        };

        // Generate download URLs for original and variants
        item.downloadUrl = await this.generateDownloadUrl(artifact.id, {
          expiresIn: 3600,
          responseContentDisposition: 'inline', // For preview
        });

        if (includeVariants && artifact.image_variants) {
          for (const [variantName, variantData] of Object.entries(artifact.image_variants)) {
            item.variants[variantName] = {
              ...variantData,
              downloadUrl: await this.generateDownloadUrl(artifact.id, {
                variant: variantName,
                expiresIn: 3600,
                responseContentDisposition: 'inline',
              }),
            };
          }
        }

        galleryItems.push(item);
      }

      return {
        items: galleryItems,
        total: galleryItems.length,
        hasMore: galleryItems.length === limit,
      };
    } catch (error) {
      console.error('Error generating image gallery:', error);
      throw error;
    }
  }

  /**
   * Get cached processed content with compression
   */
  async getCachedProcessedContent(artifactId, options = {}) {
    const {
      compress = true,
      format = 'json',
      userId = null,
    } = options;

    try {
      const artifact = await Artifact.find(artifactId);
      if (!artifact || !artifact.parsed_content_s3_key) {
        throw new Error('Processed content not found');
      }

      const cacheKey = `processed-${artifactId}-${format}-${compress}`;
      
      // Check cache
      const cached = this.downloadCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
        return {
          content: cached.content,
          cached: true,
          contentType: cached.contentType,
        };
      }

      const s3 = await this.getS3Instance();
      const result = await s3.getObject({
        Bucket: artifact.s3_bucket,
        Key: artifact.parsed_content_s3_key,
      }).promise();

      let content = result.Body.toString();
      let contentType = 'application/json';

      // Parse and format content based on requested format
      if (format === 'json') {
        try {
          const parsed = JSON.parse(content);
          content = compress ? JSON.stringify(parsed) : JSON.stringify(parsed, null, 2);
          contentType = 'application/json';
        } catch (error) {
          // If not valid JSON, return as text
          contentType = 'text/plain';
        }
      } else if (format === 'text') {
        contentType = 'text/plain';
      }

      // Cache the processed content
      this.downloadCache.set(cacheKey, {
        content,
        contentType,
        timestamp: Date.now(),
      });

      // Audit log
      if (userId) {
        await auditLogger.logFileAccess('processed_content_accessed', {
          id: artifactId,
          format,
          compressed: compress,
        }, { user: { id: userId } });
      }

      return {
        content,
        cached: false,
        contentType,
        summary: artifact.content_summary,
        processingStages: artifact.processing_stages,
      };
    } catch (error) {
      console.error('Error getting cached processed content:', error);
      throw error;
    }
  }

  /**
   * Implement artifact lifecycle management and cleanup
   */
  async cleanupArtifacts(options = {}) {
    const {
      olderThanDays = 90,
      includeProcessed = false,
      dryRun = false,
      batchSize = 100,
    } = options;

    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

      let query = Artifact.query()
        .where('created_at', '<', cutoffDate.toISOString());

      if (!includeProcessed) {
        query = query.where('status', '!=', 'processed');
      }

      const artifactsToCleanup = await query.limit(batchSize);
      
      const cleanupResults = {
        processed: 0,
        deleted: 0,
        errors: 0,
        totalSize: 0,
        details: [],
      };

      const s3 = await this.getS3Instance();

      for (const artifact of artifactsToCleanup) {
        try {
          const itemsToDelete = [artifact.s3_key];
          let itemSize = artifact.size_bytes || 0;

          // Add image variants to deletion list
          if (artifact.image_variants) {
            for (const variant of Object.values(artifact.image_variants)) {
              if (variant.s3_key) {
                itemsToDelete.push(variant.s3_key);
                itemSize += variant.size || 0;
              }
            }
          }

          // Add parsed content if exists
          if (artifact.parsed_content_s3_key) {
            itemsToDelete.push(artifact.parsed_content_s3_key);
          }

          if (!dryRun) {
            // Delete from S3
            const deleteParams = {
              Bucket: artifact.s3_bucket,
              Delete: {
                Objects: itemsToDelete.map(key => ({ Key: key })),
                Quiet: true,
              },
            };

            await s3.deleteObjects(deleteParams).promise();

            // Delete from database
            await artifact.delete();
          }

          cleanupResults.processed++;
          cleanupResults.deleted += itemsToDelete.length;
          cleanupResults.totalSize += itemSize;
          cleanupResults.details.push({
            artifactId: artifact.id,
            s3Keys: itemsToDelete,
            size: itemSize,
            createdAt: artifact.created_at,
          });

        } catch (error) {
          console.error(`Error cleaning up artifact ${artifact.id}:`, error);
          cleanupResults.errors++;
        }
      }

      // Audit log cleanup operation
      await auditLogger.logFileAccess('artifacts_cleanup', {
        ...cleanupResults,
        olderThanDays,
        includeProcessed,
        dryRun,
      }, { user: { id: 'system' } });

      return cleanupResults;
    } catch (error) {
      console.error('Error during artifact cleanup:', error);
      throw error;
    }
  }

  /**
   * Clear download cache
   */
  clearCache() {
    this.downloadCache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      size: this.downloadCache.size,
      timeout: this.cacheTimeout,
      entries: Array.from(this.downloadCache.keys()),
    };
  }
}

module.exports = new ArtifactManagementService();