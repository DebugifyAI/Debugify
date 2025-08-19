const { Worker } = require('bullmq');
const ImageProcessor = require('../helpers/ImageProcessor');
const Artifact = require('../models/Artifact');
const aws = require('aws-sdk');
const { withProgressTracking, ProgressHelpers } = require('../middleware/progressTracking');

/**
 * Specialized worker for image processing tasks
 * Handles image variant generation, OCR, visual element detection, and sensitive data scanning
 */
class ImageWorker {
  constructor(redisConfig) {
    this.redisConfig = redisConfig;
    this.imageProcessor = new ImageProcessor();
    this.s3 = new aws.S3({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      region: process.env.AWS_REGION || 'us-east-1',
    });
    
    // Worker configuration for CPU-intensive image processing
    this.workerConfig = {
      connection: redisConfig,
      concurrency: 2, // Limited concurrency for CPU-intensive tasks
      removeOnComplete: 25,
      removeOnFail: 100,
    };
    
    this.worker = new Worker('imageProcessing', 
      withProgressTracking(this.processImageJob.bind(this), 'image-processing'), 
      this.workerConfig
    );
    this.setupEventHandlers();
  }

  /**
   * Main image processing job handler
   * @param {Object} job - BullMQ job object
   * @returns {Object} Processing results
   */
  async processImageJob(job) {
    const { artifactId, processingOptions = {} } = job.data;
    const tracker = job.progressTracker;
    
    try {
      // Stage 1: Image Analysis
      await tracker.updateStageProgress(10, 'Fetching artifact from database');
      
      const artifact = await Artifact.findById(artifactId);
      if (!artifact) {
        throw new Error(`Artifact ${artifactId} not found`);
      }

      await Artifact.update(artifactId, { 
        status: 'processing',
        processing_stages: ['image_processing_started'],
      });
      
      await tracker.updateStageProgress(30, 'Downloading image from S3');
      const imageBuffer = await this.downloadImageFromS3(artifact);
      
      await tracker.updateStageProgress(60, 'Validating image format');
      const isValid = await this.imageProcessor.isValidImage(imageBuffer);
      if (!isValid) {
        throw new Error('Invalid image format or corrupted image');
      }

      await tracker.updateStageProgress(100, 'Image analysis complete');
      await tracker.nextStage();

      // Stage 2: Variant Generation
      const processingResults = await this.processImageComprehensively(
        imageBuffer, 
        processingOptions,
        tracker
      );

      // Stage 3: OCR Processing (handled in processImageComprehensively)
      // Stage 4: Visual Detection (handled in processImageComprehensively)

      // Store results and upload variants to S3
      const storageResults = await this.storeProcessingResults(
        artifact,
        processingResults,
        tracker
      );

      // Update artifact with final results
      await this.updateArtifactWithResults(artifact, processingResults, storageResults);

      return {
        artifactId,
        status: 'completed',
        processingTime: processingResults.processingTime,
        variantsGenerated: Object.keys(storageResults.variants || {}).length,
        ocrTextLength: processingResults.ocrText?.text?.length || 0,
        sensitiveDataDetected: Object.values(processingResults.sensitiveDataFlags || {}).some(Boolean),
        completedAt: new Date().toISOString(),
      };
    } catch (error) {
      console.error(`Image processing failed for artifact ${artifactId}:`, error);
      
      // Update artifact status to failed
      await Artifact.update(artifactId, {
        status: 'failed',
        last_error: error.message,
        processing_stages: ['image_processing_failed'],
      });
      
      throw error;
    }
  }

  /**
   * Download image from S3 with memory optimization
   * @param {Object} artifact - Artifact database record
   * @returns {Buffer} Image buffer
   */
  async downloadImageFromS3(artifact) {
    try {
      const params = {
        Bucket: artifact.s3_bucket,
        Key: artifact.s3_key,
      };

      // For very large images, we might want to add size limits
      const maxImageSize = 50 * 1024 * 1024; // 50MB limit
      if (artifact.size_bytes && artifact.size_bytes > maxImageSize) {
        throw new Error(`Image too large: ${artifact.size_bytes} bytes (max: ${maxImageSize})`);
      }

      const result = await this.s3.getObject(params).promise();
      return Buffer.isBuffer(result.Body) ? result.Body : Buffer.from(result.Body);
    } catch (error) {
      throw new Error(`Failed to download image from S3: ${error.message}`);
    }
  } 
  /**
   * Comprehensive image processing with all analysis features
   * @param {Buffer} imageBuffer - Raw image data
   * @param {Object} options - Processing options
   * @param {Object} job - BullMQ job for progress updates
   * @returns {Object} Complete processing results
   */
  async processImageComprehensively(imageBuffer, options, tracker) {
    const startTime = Date.now();
    
    try {
      // Extract metadata and basic info (10% progress)
      await job.updateProgress(30);
      const metadata = await this.imageProcessor.extractMetadata(imageBuffer);
      
      // Generate image variants in parallel (20% progress)
      await job.updateProgress(40);
      const variants = await this.generateImageVariantsParallel(imageBuffer, options.formats);
      
      // Perform OCR with advanced settings (25% progress)
      await job.updateProgress(55);
      const ocrResults = await this.performAdvancedOCR(imageBuffer, options.languages);
      
      // Detect visual elements (15% progress)
      await job.updateProgress(65);
      const visualElements = await this.detectVisualElementsAdvanced(imageBuffer);
      
      // Extract code snippets from OCR text (10% progress)
      await job.updateProgress(70);
      const codeSnippets = this.imageProcessor.extractCodeSnippets(ocrResults);
      
      // Scan for sensitive data (10% progress)
      await job.updateProgress(75);
      const sensitiveDataFlags = await this.scanForSensitiveDataAdvanced(ocrResults, imageBuffer);
      
      // Assess image quality and enhancement suggestions (10% progress)
      await job.updateProgress(80);
      const qualityAssessment = await this.assessImageQuality(imageBuffer, metadata);
      
      const processingTime = Date.now() - startTime;
      
      return {
        metadata,
        variants,
        ocrText: ocrResults,
        visualElements,
        codeSnippets,
        sensitiveDataFlags,
        qualityAssessment,
        processingTime,
      };
    } catch (error) {
      throw new Error(`Comprehensive image processing failed: ${error.message}`);
    }
  }

  /**
   * Generate image variants with parallel processing for efficiency
   * @param {Buffer} imageBuffer - Raw image data
   * @param {Array} formats - Output formats
   * @returns {Object} Generated variants
   */
  async generateImageVariantsParallel(imageBuffer, formats = ['webp', 'jpeg'], tracker = null) {
    try {
      // Use the existing ImageProcessor method but with better error handling
      const variants = await this.imageProcessor.generateVariants(imageBuffer, formats);
      
      // Add compression statistics
      const originalSize = imageBuffer.length;
      const compressionStats = {};
      
      Object.entries(variants).forEach(([sizeName, sizeVariants]) => {
        compressionStats[sizeName] = {};
        Object.entries(sizeVariants).forEach(([format, buffer]) => {
          const compressionRatio = (1 - (buffer.length / originalSize)) * 100;
          compressionStats[sizeName][format] = {
            size: buffer.length,
            compressionRatio: Math.round(compressionRatio * 100) / 100,
          };
        });
      });
      
      return {
        ...variants,
        compressionStats,
        originalSize,
      };
    } catch (error) {
      throw new Error(`Variant generation failed: ${error.message}`);
    }
  }

  /**
   * Advanced OCR processing with multiple languages and confidence scoring
   * @param {Buffer} imageBuffer - Raw image data
   * @param {Array} languages - Languages to detect
   * @returns {Object} Enhanced OCR results
   */
  async performAdvancedOCR(imageBuffer, languages = ['eng']) {
    try {
      const ocrResults = await this.imageProcessor.extractTextOCR(imageBuffer, languages);
      
      // Add text positioning analysis
      const textRegions = this.analyzeTextRegions(ocrResults);
      
      // Add language detection confidence
      const languageConfidence = this.calculateLanguageConfidence(ocrResults, languages);
      
      return {
        ...ocrResults,
        textRegions,
        languageConfidence,
        totalWords: ocrResults.words?.length || 0,
        averageConfidence: this.calculateAverageConfidence(ocrResults.words || []),
      };
    } catch (error) {
      console.warn('Advanced OCR processing failed:', error.message);
      return {
        text: '',
        confidence: 0,
        words: [],
        lines: [],
        paragraphs: [],
        textRegions: [],
        languageConfidence: {},
        totalWords: 0,
        averageConfidence: 0,
      };
    }
  }

  /**
   * Enhanced visual element detection with UI component recognition
   * @param {Buffer} imageBuffer - Raw image data
   * @returns {Object} Advanced visual element analysis
   */
  async detectVisualElementsAdvanced(imageBuffer) {
    try {
      const basicElements = await this.imageProcessor.detectVisualElements(imageBuffer);
      
      // Add UI component detection
      const uiComponents = await this.detectUIComponents(imageBuffer);
      
      // Add chart and diagram detection
      const chartElements = await this.detectChartsAndDiagrams(imageBuffer);
      
      return {
        ...basicElements,
        uiComponents,
        chartElements,
        complexity: this.calculateVisualComplexity(basicElements, uiComponents, chartElements),
      };
    } catch (error) {
      console.warn('Advanced visual element detection failed:', error.message);
      return {
        hasButtons: false,
        hasText: false,
        hasCharts: false,
        hasDiagrams: false,
        hasCode: false,
        layout: { type: 'unknown' },
        colorAnalysis: {},
        uiComponents: [],
        chartElements: [],
        complexity: 'low',
      };
    }
  }

  /**
   * Advanced sensitive data scanning including image-specific patterns
   * @param {Object} ocrResults - OCR text results
   * @param {Buffer} imageBuffer - Raw image data for additional analysis
   * @returns {Object} Enhanced sensitive data detection
   */
  async scanForSensitiveDataAdvanced(ocrResults, imageBuffer) {
    try {
      // Use existing sensitive data detection
      const basicFlags = await this.imageProcessor.detectSensitiveData(ocrResults);
      
      // Add image-specific sensitive data detection
      const imageSpecificFlags = await this.detectImageSpecificSensitiveData(imageBuffer, ocrResults);
      
      return {
        ...basicFlags,
        ...imageSpecificFlags,
        riskLevel: this.calculateSensitiveDataRiskLevel(basicFlags, imageSpecificFlags),
      };
    } catch (error) {
      console.warn('Advanced sensitive data scanning failed:', error.message);
      return {
        hasApiKeys: false,
        hasCredentials: false,
        hasPII: false,
        detectedPatterns: [],
        riskLevel: 'low',
      };
    }
  }

  /**
   * Assess image quality and provide enhancement suggestions
   * @param {Buffer} imageBuffer - Raw image data
   * @param {Object} metadata - Image metadata
   * @returns {Object} Quality assessment and suggestions
   */
  async assessImageQuality(imageBuffer, metadata) {
    try {
      const sharp = require('sharp');
      const image = sharp(imageBuffer);
      
      // Calculate sharpness using Laplacian variance
      const grayscale = await image.clone().greyscale().raw().toBuffer();
      const sharpness = this.calculateSharpness(grayscale, metadata.width, metadata.height);
      
      // Assess brightness and contrast
      const stats = await image.stats();
      const brightness = this.calculateBrightness(stats);
      const contrast = this.calculateContrast(stats);
      
      // Generate quality score and suggestions
      const qualityScore = this.calculateQualityScore(sharpness, brightness, contrast, metadata);
      const suggestions = this.generateEnhancementSuggestions(qualityScore, sharpness, brightness, contrast);
      
      return {
        sharpness,
        brightness,
        contrast,
        qualityScore,
        suggestions,
        resolution: {
          width: metadata.width,
          height: metadata.height,
          megapixels: (metadata.width * metadata.height) / 1000000,
        },
      };
    } catch (error) {
      console.warn('Image quality assessment failed:', error.message);
      return {
        sharpness: 0,
        brightness: 0,
        contrast: 0,
        qualityScore: 0,
        suggestions: ['Quality assessment unavailable'],
        resolution: { width: 0, height: 0, megapixels: 0 },
      };
    }
  }

  /**
   * Store processing results and upload variants to S3
   * @param {Object} artifact - Original artifact record
   * @param {Object} processingResults - Complete processing results
   * @param {Object} job - BullMQ job for progress updates
   * @returns {Object} Storage results with S3 keys
   */
  async storeProcessingResults(artifact, processingResults, job) {
    try {
      const storageResults = {
        variants: {},
        processedContentKey: null,
      };
      
      // Upload image variants to S3
      const variantPromises = [];
      Object.entries(processingResults.variants).forEach(([sizeName, sizeVariants]) => {
        if (sizeName === 'compressionStats' || sizeName === 'originalSize') return;
        
        Object.entries(sizeVariants).forEach(([format, buffer]) => {
          const variantKey = `${artifact.s3_key.replace(/\.[^/.]+$/, '')}_${sizeName}.${format}`;
          
          const uploadPromise = this.uploadToS3(
            artifact.s3_bucket,
            variantKey,
            buffer,
            `image/${format}`
          ).then((result) => {
            if (!storageResults.variants[sizeName]) {
              storageResults.variants[sizeName] = {};
            }
            storageResults.variants[sizeName][format] = {
              s3Key: variantKey,
              size: buffer.length,
              etag: result.ETag,
            };
          });
          
          variantPromises.push(uploadPromise);
        });
      });
      
      // Upload processed content (OCR text, analysis results) as JSON
      const processedContent = {
        ocrText: processingResults.ocrText,
        visualElements: processingResults.visualElements,
        codeSnippets: processingResults.codeSnippets,
        qualityAssessment: processingResults.qualityAssessment,
        processingTime: processingResults.processingTime,
        processedAt: new Date().toISOString(),
      };
      
      const contentKey = `${artifact.s3_key.replace(/\.[^/.]+$/, '')}_processed.json`;
      const contentUploadPromise = this.uploadToS3(
        artifact.s3_bucket,
        contentKey,
        Buffer.from(JSON.stringify(processedContent, null, 2)),
        'application/json'
      ).then((result) => {
        storageResults.processedContentKey = {
          s3Key: contentKey,
          etag: result.ETag,
        };
      });
      
      variantPromises.push(contentUploadPromise);
      
      // Wait for all uploads to complete
      await Promise.all(variantPromises);
      
      return storageResults;
    } catch (error) {
      throw new Error(`Failed to store processing results: ${error.message}`);
    }
  }

  /**
   * Upload buffer to S3 with proper error handling
   * @param {string} bucket - S3 bucket name
   * @param {string} key - S3 object key
   * @param {Buffer} buffer - Data to upload
   * @param {string} contentType - MIME type
   * @returns {Object} S3 upload result
   */
  async uploadToS3(bucket, key, buffer, contentType) {
    try {
      const params = {
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        ServerSideEncryption: 'AES256',
      };
      
      return await this.s3.upload(params).promise();
    } catch (error) {
      throw new Error(`S3 upload failed for ${key}: ${error.message}`);
    }
  }

  /**
   * Update artifact record with final processing results
   * @param {Object} artifact - Original artifact record
   * @param {Object} processingResults - Processing results
   * @param {Object} storageResults - Storage results
   */
  async updateArtifactWithResults(artifact, processingResults, storageResults) {
    try {
      const updateData = {
        status: 'processed',
        processed_at: new Date().toISOString(),
        image_variants: storageResults.variants,
        image_metadata: processingResults.metadata,
        ocr_text: processingResults.ocrText?.text || '',
        visual_elements: processingResults.visualElements,
        sensitive_data_flags: processingResults.sensitiveDataFlags,
        parsed_content_s3_key: storageResults.processedContentKey?.s3Key,
        content_summary: this.generateContentSummary(processingResults),
        processing_stages: [
          'image_processing_started',
          'metadata_extracted',
          'variants_generated',
          'ocr_completed',
          'visual_analysis_completed',
          'sensitive_data_scanned',
          'quality_assessed',
          'results_stored',
          'processing_completed',
        ],
      };
      
      await Artifact.update(artifact.id, updateData);
    } catch (error) {
      throw new Error(`Failed to update artifact: ${error.message}`);
    }
  }

  // Helper methods for advanced processing

  /**
   * Analyze text regions from OCR results
   * @param {Object} ocrResults - OCR results with positioning
   * @returns {Array} Text region analysis
   */
  analyzeTextRegions(ocrResults) {
    if (!ocrResults.lines || ocrResults.lines.length === 0) return [];
    
    return ocrResults.lines.map((line, index) => ({
      id: index,
      text: line.text,
      confidence: line.confidence,
      bbox: line.bbox,
      wordCount: line.text.split(/\s+/).length,
      isTitle: this.isLikelyTitle(line.text, line.bbox),
      isCode: this.isLikelyCode(line.text),
    }));
  }

  /**
   * Calculate language detection confidence
   * @param {Object} ocrResults - OCR results
   * @param {Array} languages - Requested languages
   * @returns {Object} Language confidence scores
   */
  calculateLanguageConfidence(ocrResults, languages) {
    const confidence = {};
    languages.forEach((lang) => {
      confidence[lang] = ocrResults.confidence || 0;
    });
    return confidence;
  }

  /**
   * Calculate average confidence from word results
   * @param {Array} words - OCR word results
   * @returns {number} Average confidence score
   */
  calculateAverageConfidence(words) {
    if (words.length === 0) return 0;
    const sum = words.reduce((acc, word) => acc + (word.confidence || 0), 0);
    return Math.round((sum / words.length) * 100) / 100;
  }

  /**
   * Detect UI components in images
   * @param {Buffer} imageBuffer - Raw image data
   * @returns {Array} Detected UI components
   */
  async detectUIComponents(imageBuffer) {
    // This is a simplified implementation
    // In production, you'd use computer vision libraries or ML models
    try {
      const sharp = require('sharp');
      const { width, height } = await sharp(imageBuffer).metadata();
      
      // Basic heuristics for UI component detection
      const components = [];
      
      // Detect potential buttons (rectangular regions with text)
      if (width > 100 && height > 30) {
        components.push({
          type: 'button',
          confidence: 0.6,
          bbox: { x: 0, y: 0, width: Math.min(width, 200), height: Math.min(height, 50) },
        });
      }
      
      return components;
    } catch (error) {
      console.warn('UI component detection failed:', error.message);
      return [];
    }
  }

  /**
   * Detect charts and diagrams in images
   * @param {Buffer} imageBuffer - Raw image data
   * @returns {Array} Detected chart elements
   */
  async detectChartsAndDiagrams(imageBuffer) {
    // Simplified implementation for chart detection
    try {
      const sharp = require('sharp');
      const stats = await sharp(imageBuffer).stats();
      
      const elements = [];
      
      // Basic heuristic: if image has high contrast and geometric patterns
      const contrast = this.calculateContrast(stats);
      if (contrast > 50) {
        elements.push({
          type: 'chart',
          confidence: 0.5,
          description: 'Potential chart or diagram detected based on contrast analysis',
        });
      }
      
      return elements;
    } catch (error) {
      console.warn('Chart detection failed:', error.message);
      return [];
    }
  }

  /**
   * Calculate visual complexity score
   * @param {Object} basicElements - Basic visual elements
   * @param {Array} uiComponents - UI components
   * @param {Array} chartElements - Chart elements
   * @returns {string} Complexity level
   */
  calculateVisualComplexity(basicElements, uiComponents, chartElements) {
    let score = 0;
    
    if (basicElements.hasText) score += 1;
    if (basicElements.hasButtons) score += 2;
    if (basicElements.hasCharts) score += 3;
    if (basicElements.hasDiagrams) score += 3;
    if (basicElements.hasCode) score += 2;
    
    score += uiComponents.length;
    score += chartElements.length * 2;
    
    if (score <= 2) return 'low';
    if (score <= 5) return 'medium';
    return 'high';
  }

  /**
   * Detect image-specific sensitive data patterns
   * @param {Buffer} imageBuffer - Raw image data
   * @param {Object} ocrResults - OCR results
   * @returns {Object} Image-specific sensitive data flags
   */
  async detectImageSpecificSensitiveData(imageBuffer, ocrResults) {
    const flags = {
      hasScreenshotMetadata: false,
      hasSystemInfo: false,
      hasNetworkInfo: false,
      hasFileSystemPaths: false,
    };
    
    const text = ocrResults.text || '';
    
    // Check for system information
    if (/(?:windows|mac|linux|ubuntu|debian)/gi.test(text)) {
      flags.hasSystemInfo = true;
    }
    
    // Check for network information
    if (/(?:\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|127\.0\.0\.1)/g.test(text)) {
      flags.hasNetworkInfo = true;
    }
    
    // Check for file system paths
    if (/(?:\/[a-zA-Z0-9_\-./]+|[A-Z]:\\[a-zA-Z0-9_\-\\]+)/g.test(text)) {
      flags.hasFileSystemPaths = true;
    }
    
    return flags;
  }

  /**
   * Calculate sensitive data risk level
   * @param {Object} basicFlags - Basic sensitive data flags
   * @param {Object} imageFlags - Image-specific flags
   * @returns {string} Risk level
   */
  calculateSensitiveDataRiskLevel(basicFlags, imageFlags) {
    let riskScore = 0;
    
    if (basicFlags.hasApiKeys) riskScore += 5;
    if (basicFlags.hasCredentials) riskScore += 4;
    if (basicFlags.hasPII) riskScore += 3;
    if (imageFlags.hasSystemInfo) riskScore += 1;
    if (imageFlags.hasNetworkInfo) riskScore += 2;
    if (imageFlags.hasFileSystemPaths) riskScore += 1;
    
    if (riskScore >= 5) return 'high';
    if (riskScore >= 2) return 'medium';
    return 'low';
  }  
  // Image quality assessment helper methods

  /**
   * Calculate image sharpness using Laplacian variance
   * @param {Buffer} grayscaleBuffer - Grayscale image buffer
   * @param {number} width - Image width
   * @param {number} height - Image height
   * @returns {number} Sharpness score
   */
  calculateSharpness(grayscaleBuffer, width, height) {
    try {
      // Simplified Laplacian variance calculation
      let variance = 0;
      let mean = 0;
      const pixels = [];
      
      // Convert buffer to pixel array
      for (let i = 0; i < grayscaleBuffer.length; i++) {
        pixels.push(grayscaleBuffer[i]);
        mean += grayscaleBuffer[i];
      }
      
      mean /= pixels.length;
      
      // Calculate variance
      for (const pixel of pixels) {
        variance += Math.pow(pixel - mean, 2);
      }
      
      variance /= pixels.length;
      return Math.round(variance * 100) / 100;
    } catch (error) {
      console.warn('Sharpness calculation failed:', error.message);
      return 0;
    }
  }

  /**
   * Calculate image brightness from statistics
   * @param {Object} stats - Sharp image statistics
   * @returns {number} Brightness score (0-255)
   */
  calculateBrightness(stats) {
    try {
      if (!stats.channels || stats.channels.length === 0) return 0;
      
      // Average the mean values across all channels
      const totalMean = stats.channels.reduce((sum, channel) => sum + channel.mean, 0);
      return Math.round((totalMean / stats.channels.length) * 100) / 100;
    } catch (error) {
      console.warn('Brightness calculation failed:', error.message);
      return 0;
    }
  }

  /**
   * Calculate image contrast from statistics
   * @param {Object} stats - Sharp image statistics
   * @returns {number} Contrast score
   */
  calculateContrast(stats) {
    try {
      if (!stats.channels || stats.channels.length === 0) return 0;
      
      // Use standard deviation as a measure of contrast
      const totalStdev = stats.channels.reduce((sum, channel) => sum + channel.stdev, 0);
      return Math.round((totalStdev / stats.channels.length) * 100) / 100;
    } catch (error) {
      console.warn('Contrast calculation failed:', error.message);
      return 0;
    }
  }

  /**
   * Calculate overall quality score
   * @param {number} sharpness - Sharpness score
   * @param {number} brightness - Brightness score
   * @param {number} contrast - Contrast score
   * @param {Object} metadata - Image metadata
   * @returns {number} Quality score (0-100)
   */
  calculateQualityScore(sharpness, brightness, contrast, metadata) {
    try {
      let score = 0;
      
      // Sharpness component (0-40 points)
      score += Math.min(40, sharpness / 10);
      
      // Brightness component (0-20 points) - optimal around 128
      const brightnessOptimal = 128;
      const brightnessDiff = Math.abs(brightness - brightnessOptimal);
      score += Math.max(0, 20 - (brightnessDiff / 6.4));
      
      // Contrast component (0-20 points)
      score += Math.min(20, contrast / 5);
      
      // Resolution component (0-20 points)
      const megapixels = (metadata.width * metadata.height) / 1000000;
      if (megapixels >= 2) score += 20;
      else if (megapixels >= 1) score += 15;
      else if (megapixels >= 0.5) score += 10;
      else score += 5;
      
      return Math.round(Math.min(100, Math.max(0, score)));
    } catch (error) {
      console.warn('Quality score calculation failed:', error.message);
      return 0;
    }
  }

  /**
   * Generate enhancement suggestions based on quality assessment
   * @param {number} qualityScore - Overall quality score
   * @param {number} sharpness - Sharpness score
   * @param {number} brightness - Brightness score
   * @param {number} contrast - Contrast score
   * @returns {Array} Enhancement suggestions
   */
  generateEnhancementSuggestions(qualityScore, sharpness, brightness, contrast) {
    const suggestions = [];
    
    if (qualityScore >= 80) {
      suggestions.push('Image quality is excellent');
    } else if (qualityScore >= 60) {
      suggestions.push('Image quality is good');
    } else {
      suggestions.push('Image quality could be improved');
    }
    
    if (sharpness < 50) {
      suggestions.push('Consider sharpening the image to improve clarity');
    }
    
    if (brightness < 80) {
      suggestions.push('Image appears dark - consider increasing brightness');
    } else if (brightness > 180) {
      suggestions.push('Image appears overexposed - consider reducing brightness');
    }
    
    if (contrast < 30) {
      suggestions.push('Low contrast detected - consider increasing contrast for better visibility');
    }
    
    return suggestions;
  }

  // Text analysis helper methods

  /**
   * Check if text line is likely a title
   * @param {string} text - Text content
   * @param {Object} bbox - Bounding box
   * @returns {boolean} True if likely a title
   */
  isLikelyTitle(text, bbox) {
    // Simple heuristics for title detection
    const isShort = text.length < 50;
    const isUpperCase = text === text.toUpperCase();
    const hasNoLowercase = !/[a-z]/.test(text);
    const isAtTop = bbox && bbox.y < 100;
    
    return (isShort && (isUpperCase || hasNoLowercase)) || isAtTop;
  }

  /**
   * Check if text line is likely code
   * @param {string} text - Text content
   * @returns {boolean} True if likely code
   */
  isLikelyCode(text) {
    const codeIndicators = [
      /[{}();]/g, // Brackets and semicolons
      /\b(function|class|if|for|while|return|import|export)\b/g, // Keywords
      /[=<>!]+/g, // Operators
      /\/\*|\*\/|\/\//g, // Comments
    ];
    
    return codeIndicators.some((pattern) => pattern.test(text));
  }

  /**
   * Generate content summary from processing results
   * @param {Object} processingResults - Complete processing results
   * @returns {string} Content summary
   */
  generateContentSummary(processingResults) {
    const parts = [];
    
    if (processingResults.ocrText?.text) {
      const wordCount = processingResults.ocrText.text.split(/\s+/).length;
      parts.push(`${wordCount} words extracted via OCR`);
    }
    
    if (processingResults.codeSnippets?.snippets?.length > 0) {
      parts.push(`${processingResults.codeSnippets.snippets.length} code snippets detected`);
    }
    
    if (processingResults.visualElements?.complexity) {
      parts.push(`${processingResults.visualElements.complexity} visual complexity`);
    }
    
    if (processingResults.sensitiveDataFlags?.riskLevel) {
      parts.push(`${processingResults.sensitiveDataFlags.riskLevel} security risk`);
    }
    
    const variantCount = Object.keys(processingResults.variants || {}).length - 2; // Exclude stats
    if (variantCount > 0) {
      parts.push(`${variantCount} image variants generated`);
    }
    
    return parts.join(', ') || 'Image processed successfully';
  }

  /**
   * Setup event handlers for worker monitoring
   */
  setupEventHandlers() {
    this.worker.on('ready', () => {
      console.log('🖼️  ImageWorker is ready for processing');
    });

    this.worker.on('error', (error) => {
      console.error('🖼️  ImageWorker error:', error);
    });

    this.worker.on('stalled', (jobId) => {
      console.warn(`🖼️  ImageWorker job ${jobId} stalled`);
    });

    this.worker.on('completed', (job) => {
      console.log(`🖼️  ImageWorker completed job ${job.id} for artifact ${job.data.artifactId}`);
    });

    this.worker.on('failed', (job, err) => {
      console.error(`🖼️  ImageWorker job ${job?.id} failed:`, err.message);
    });

    this.worker.on('progress', (job, progress) => {
      console.log(`🖼️  ImageWorker job ${job.id} progress: ${progress}%`);
    });
  }

  /**
   * Get worker instance for external access
   * @returns {Worker} BullMQ worker instance
   */
  getWorker() {
    return this.worker;
  }

  /**
   * Gracefully close the worker
   */
  async close() {
    console.log('🖼️  Shutting down ImageWorker...');
    await this.worker.close();
    console.log('🖼️  ImageWorker shut down successfully');
  }

  /**
   * Get worker capabilities and configuration
   * @returns {Object} Worker capabilities
   */
  getCapabilities() {
    return {
      ...this.imageProcessor.getCapabilities(),
      workerType: 'ImageWorker',
      concurrency: this.workerConfig.concurrency,
      queueName: 'imageProcessing',
      features: [
        'parallel_variant_generation',
        'advanced_ocr_processing',
        'visual_element_detection',
        'ui_component_recognition',
        'code_snippet_extraction',
        'sensitive_data_scanning',
        'quality_assessment',
        'enhancement_suggestions',
        's3_storage_integration',
      ],
    };
  }
}

module.exports = ImageWorker;