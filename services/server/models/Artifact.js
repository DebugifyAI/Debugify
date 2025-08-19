const Base = require('./BaseModel');

class Artifact extends Base {
  static tableName = 'artifacts';

  static async createForBug({
    bugReportId,
    uploaderUserId = null,
    s3Bucket,
    s3Key,
    contentType = null,
    sizeBytes = null,
    etag = null,
    checksum = null,
    status = 'uploaded',
    metadata = null,
    processingJobId = null,
    validationStatus = 'pending',
    validationErrors = null,
    parsedContentS3Key = null,
    contentSummary = null,
    processingStages = [],
    retryCount = 0,
    lastError = null,
    imageVariants = null,
    imageMetadata = null,
    ocrText = null,
    visualElements = null,
    sensitiveDataFlags = null,
  }) {
    return this.insert({
      bug_report_id: bugReportId,
      uploader_user_id: uploaderUserId,
      s3_bucket: s3Bucket,
      s3_key: s3Key,
      content_type: contentType,
      size_bytes: sizeBytes,
      etag,
      checksum,
      status,
      metadata,
      processing_job_id: processingJobId,
      validation_status: validationStatus,
      validation_errors: validationErrors,
      parsed_content_s3_key: parsedContentS3Key,
      content_summary: contentSummary,
      processing_stages: processingStages,
      retry_count: retryCount,
      last_error: lastError,
      image_variants: imageVariants,
      image_metadata: imageMetadata,
      ocr_text: ocrText,
      visual_elements: visualElements,
      sensitive_data_flags: sensitiveDataFlags,
    });
  }

  /**
   * Update validation status and errors
   */
  async updateValidationStatus(status, errors = null) {
    return this.update({
      validation_status: status,
      validation_errors: errors,
    });
  }

  /**
   * Update processing stage information
   */
  async addProcessingStage(stage) {
    const currentStages = this.processing_stages || [];
    const updatedStages = [...currentStages, {
      ...stage,
      timestamp: new Date().toISOString(),
    }];
    
    return this.update({
      processing_stages: updatedStages,
    });
  }

  /**
   * Update retry count and last error
   */
  async incrementRetryCount(error = null) {
    return this.update({
      retry_count: (this.retry_count || 0) + 1,
      last_error: error,
    });
  }

  /**
   * Update image processing results
   */
  async updateImageProcessing({
    variants = null,
    metadata = null,
    ocrText = null,
    visualElements = null,
    sensitiveDataFlags = null,
  }) {
    const updates = {};
    if (variants !== null) updates.image_variants = variants;
    if (metadata !== null) updates.image_metadata = metadata;
    if (ocrText !== null) updates.ocr_text = ocrText;
    if (visualElements !== null) updates.visual_elements = visualElements;
    if (sensitiveDataFlags !== null) updates.sensitive_data_flags = sensitiveDataFlags;

    return this.update(updates);
  }

  /**
   * Update parsed content information
   */
  async updateParsedContent(s3Key, summary = null) {
    return this.update({
      parsed_content_s3_key: s3Key,
      content_summary: summary,
    });
  }

  /**
   * Get artifacts by validation status
   */
  static async getByValidationStatus(status) {
    return this.findAll({ validation_status: status });
  }

  /**
   * Get artifacts that need retry (failed with retry count < max)
   */
  static async getForRetry(maxRetries = 3) {
    return this.query()
      .where('status', 'failed')
      .where('retry_count', '<', maxRetries)
      .orderBy('updated_at', 'asc');
  }

  /**
   * Check if artifact is an image based on content type
   */
  isImage() {
    return this.content_type && this.content_type.startsWith('image/');
  }

  /**
   * Check if artifact has been processed successfully
   */
  isProcessed() {
    return this.status === 'processed' && this.validation_status === 'valid';
  }
}

module.exports = Artifact;


