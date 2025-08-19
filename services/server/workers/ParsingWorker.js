const { Worker } = require('bullmq');
const ContentParser = require('../helpers/ContentParser');
const Artifact = require('../models/Artifact');
const aws = require('aws-sdk');

/**
 * Specialized worker for content parsing and extraction
 * Handles text extraction, log parsing, and content structuring
 */
class ParsingWorker {
  constructor(redisConfig) {
    this.redisConfig = redisConfig;
    this.contentParser = new ContentParser();
    this.s3 = new aws.S3({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      region: process.env.AWS_REGION || 'us-east-1',
    });
    
    // Worker configuration for parsing tasks
    this.workerConfig = {
      connection: redisConfig,
      concurrency: 5, // Moderate concurrency for parsing tasks
      removeOnComplete: 25,
      removeOnFail: 100,
    };
    
    this.worker = new Worker('parsing', this.processParsingJob.bind(this), this.workerConfig);
    this.setupEventHandlers();
  }

  /**
   * Main parsing job handler
   * @param {Object} job - BullMQ job object
   * @returns {Object} Parsing results
   */
  async processParsingJob(job) {
    const { artifactId, parsingOptions = {} } = job.data;
    
    try {
      await job.updateProgress(5);
      
      // Fetch artifact from database
      const artifact = await Artifact.findById(artifactId);
      if (!artifact) {
        throw new Error(`Artifact ${artifactId} not found`);
      }

      // Update artifact status to parsing in progress
      await Artifact.update(artifactId, { 
        status: 'parsing',
        processing_stages: [...(artifact.processing_stages || []), 'parsing_started'],
      });
      
      await job.updateProgress(10);

      // Download content from S3
      const content = await this.downloadContentFromS3(artifact, job);
      
      await job.updateProgress(30);

      // Perform content parsing
      const parsingResult = await this.performContentParsing(
        artifact,
        content,
        parsingOptions,
        job
      );

      await job.updateProgress(80);

      // Store parsed content and update artifact
      const storageResult = await this.storeParsedContent(artifact, parsingResult, job);
      
      await job.updateProgress(95);

      // Update artifact with parsing results
      await this.updateArtifactWithParsing(artifact, parsingResult, storageResult);

      await job.updateProgress(100);

      return {
        artifactId,
        status: 'parsed',
        contentType: parsingResult.contentType,
        extractedText: parsingResult.extractedText?.length || 0,
        structuredData: Object.keys(parsingResult.structuredData || {}).length,
        metadata: parsingResult.metadata,
        processingTime: parsingResult.processingTime,
        s3Key: storageResult.s3Key,
        completedAt: new Date().toISOString(),
      };

    } catch (error) {
      console.error(`Parsing failed for artifact ${artifactId}:`, error);
      
      // Update artifact status to parsing failed
      await Artifact.update(artifactId, {
        status: 'parsing_failed',
        last_error: error.message,
        processing_stages: [...(artifact?.processing_stages || []), 'parsing_failed'],
      });
      
      throw error;
    }
  }

  /**
   * Download content from S3 for parsing
   * @param {Object} artifact - Artifact database record
   * @param {Object} job - BullMQ job for progress updates
   * @returns {Buffer} Content buffer
   */
  async downloadContentFromS3(artifact, job) {
    try {
      const params = {
        Bucket: artifact.s3_bucket,
        Key: artifact.s3_key,
      };

      // Limit download size for parsing (10MB max)
      const maxSize = 10 * 1024 * 1024;
      if (artifact.size_bytes && artifact.size_bytes > maxSize) {
        params.Range = `bytes=0-${maxSize - 1}`;
        console.warn(`Large file detected (${artifact.size_bytes} bytes), limiting to ${maxSize} bytes`);
      }

      await job.updateProgress(20);

      const result = await this.s3.getObject(params).promise();
      return Buffer.isBuffer(result.Body) ? result.Body : Buffer.from(result.Body);
      
    } catch (error) {
      throw new Error(`Failed to download content from S3: ${error.message}`);
    }
  }

  /**
   * Perform content parsing based on file type
   * @param {Object} artifact - Artifact database record
   * @param {Buffer} content - File content
   * @param {Object} options - Parsing options
   * @param {Object} job - BullMQ job for progress updates
   * @returns {Object} Parsing results
   */
  async performContentParsing(artifact, content, options, job) {
    const startTime = Date.now();
    
    try {
      const contentType = this.determineContentType(artifact);
      
      await job.updateProgress(40);

      let parsingResult;
      
      switch (contentType) {
        case 'text':
          parsingResult = await this.parseTextContent(content, artifact, options);
          break;
        case 'log':
          parsingResult = await this.parseLogContent(content, artifact, options);
          break;
        case 'json':
          parsingResult = await this.parseJsonContent(content, artifact, options);
          break;
        case 'xml':
          parsingResult = await this.parseXmlContent(content, artifact, options);
          break;
        case 'csv':
          parsingResult = await this.parseCsvContent(content, artifact, options);
          break;
        case 'binary':
          parsingResult = await this.parseBinaryContent(content, artifact, options);
          break;
        default:
          parsingResult = await this.parseGenericContent(content, artifact, options);
      }

      await job.updateProgress(70);

      // Add common metadata
      parsingResult.contentType = contentType;
      parsingResult.processingTime = Date.now() - startTime;
      parsingResult.metadata = {
        ...parsingResult.metadata,
        originalSize: content.length,
        filename: artifact.original_filename,
        mimeType: artifact.content_type,
        parsedAt: new Date().toISOString(),
      };

      return parsingResult;
      
    } catch (error) {
      throw new Error(`Content parsing failed: ${error.message}`);
    }
  }

  /**
   * Determine content type for parsing strategy
   * @param {Object} artifact - Artifact database record
   * @returns {string} Content type
   */
  determineContentType(artifact) {
    const filename = artifact.original_filename || '';
    const mimeType = artifact.content_type || '';
    
    // Check file extension
    if (/\.log$/i.test(filename) || /log/i.test(mimeType)) {
      return 'log';
    }
    if (/\.json$/i.test(filename) || mimeType.includes('json')) {
      return 'json';
    }
    if (/\.xml$/i.test(filename) || mimeType.includes('xml')) {
      return 'xml';
    }
    if (/\.csv$/i.test(filename) || mimeType.includes('csv')) {
      return 'csv';
    }
    if (mimeType.startsWith('text/')) {
      return 'text';
    }
    if (mimeType.startsWith('application/') && !mimeType.includes('json') && !mimeType.includes('xml')) {
      return 'binary';
    }
    
    return 'text'; // Default fallback
  }

  /**
   * Parse plain text content
   * @param {Buffer} content - File content
   * @param {Object} artifact - Artifact record
   * @param {Object} options - Parsing options
   * @returns {Object} Parsing results
   */
  async parseTextContent(content, artifact, options) {
    try {
      const text = content.toString('utf-8');
      
      const result = {
        extractedText: text,
        structuredData: {
          lineCount: text.split('\n').length,
          wordCount: text.split(/\s+/).length,
          characterCount: text.length,
        },
        metadata: {
          encoding: 'utf-8',
          hasUnicodeCharacters: /[^\x00-\x7F]/.test(text),
        },
      };

      // Extract additional structure if requested
      if (options.extractStructure) {
        result.structuredData.paragraphs = text.split('\n\n').filter(p => p.trim().length > 0);
        result.structuredData.sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
      }

      return result;
      
    } catch (error) {
      throw new Error(`Text parsing failed: ${error.message}`);
    }
  }

  /**
   * Parse log file content
   * @param {Buffer} content - File content
   * @param {Object} artifact - Artifact record
   * @param {Object} options - Parsing options
   * @returns {Object} Parsing results
   */
  async parseLogContent(content, artifact, options) {
    try {
      const result = await this.contentParser.parseLogFile(content, {
        format: options.logFormat || 'auto',
        extractTimestamps: true,
        extractLevels: true,
        ...options,
      });

      return {
        extractedText: result.rawText || content.toString('utf-8'),
        structuredData: {
          entries: result.entries || [],
          logLevels: result.logLevels || {},
          timeRange: result.timeRange || null,
          errorCount: result.errorCount || 0,
          warningCount: result.warningCount || 0,
          patterns: result.patterns || [],
        },
        metadata: {
          logFormat: result.detectedFormat || 'unknown',
          totalEntries: (result.entries || []).length,
          hasTimestamps: result.hasTimestamps || false,
          hasLevels: result.hasLevels || false,
        },
      };
      
    } catch (error) {
      console.warn('Log parsing failed, falling back to text parsing:', error.message);
      return this.parseTextContent(content, artifact, options);
    }
  }

  /**
   * Parse JSON content
   * @param {Buffer} content - File content
   * @param {Object} artifact - Artifact record
   * @param {Object} options - Parsing options
   * @returns {Object} Parsing results
   */
  async parseJsonContent(content, artifact, options) {
    try {
      const text = content.toString('utf-8');
      const jsonData = JSON.parse(text);
      
      const result = {
        extractedText: text,
        structuredData: {
          jsonData,
          keys: this.extractJsonKeys(jsonData),
          depth: this.calculateJsonDepth(jsonData),
          arrayCount: this.countJsonArrays(jsonData),
          objectCount: this.countJsonObjects(jsonData),
        },
        metadata: {
          isValidJson: true,
          dataType: Array.isArray(jsonData) ? 'array' : typeof jsonData,
          size: Object.keys(jsonData || {}).length,
        },
      };

      return result;
      
    } catch (error) {
      console.warn('JSON parsing failed, falling back to text parsing:', error.message);
      return this.parseTextContent(content, artifact, options);
    }
  }

  /**
   * Parse XML content
   * @param {Buffer} content - File content
   * @param {Object} artifact - Artifact record
   * @param {Object} options - Parsing options
   * @returns {Object} Parsing results
   */
  async parseXmlContent(content, artifact, options) {
    try {
      const result = await this.contentParser.parseXmlContent(content, options);
      
      return {
        extractedText: result.text || content.toString('utf-8'),
        structuredData: {
          xmlData: result.data || {},
          elements: result.elements || [],
          attributes: result.attributes || {},
          namespaces: result.namespaces || [],
        },
        metadata: {
          isValidXml: result.isValid || false,
          rootElement: result.rootElement || null,
          elementCount: (result.elements || []).length,
        },
      };
      
    } catch (error) {
      console.warn('XML parsing failed, falling back to text parsing:', error.message);
      return this.parseTextContent(content, artifact, options);
    }
  }

  /**
   * Parse CSV content
   * @param {Buffer} content - File content
   * @param {Object} artifact - Artifact record
   * @param {Object} options - Parsing options
   * @returns {Object} Parsing results
   */
  async parseCsvContent(content, artifact, options) {
    try {
      const result = await this.contentParser.parseCsvContent(content, {
        delimiter: options.delimiter || ',',
        hasHeaders: options.hasHeaders !== false,
        ...options,
      });
      
      return {
        extractedText: content.toString('utf-8'),
        structuredData: {
          rows: result.rows || [],
          headers: result.headers || [],
          columnCount: (result.headers || []).length,
          rowCount: (result.rows || []).length,
          statistics: result.statistics || {},
        },
        metadata: {
          delimiter: result.delimiter || ',',
          hasHeaders: result.hasHeaders || false,
          encoding: result.encoding || 'utf-8',
        },
      };
      
    } catch (error) {
      console.warn('CSV parsing failed, falling back to text parsing:', error.message);
      return this.parseTextContent(content, artifact, options);
    }
  }

  /**
   * Parse binary content (extract metadata only)
   * @param {Buffer} content - File content
   * @param {Object} artifact - Artifact record
   * @param {Object} options - Parsing options
   * @returns {Object} Parsing results
   */
  async parseBinaryContent(content, artifact, options) {
    try {
      const result = await this.contentParser.extractBinaryMetadata(content, {
        filename: artifact.original_filename,
        mimeType: artifact.content_type,
        ...options,
      });
      
      return {
        extractedText: '', // No text extraction for binary files
        structuredData: {
          metadata: result.metadata || {},
          fileSignature: result.fileSignature || null,
          entropy: result.entropy || 0,
          hasEmbeddedText: result.hasEmbeddedText || false,
        },
        metadata: {
          isBinary: true,
          fileType: result.fileType || 'unknown',
          hasMetadata: Object.keys(result.metadata || {}).length > 0,
        },
      };
      
    } catch (error) {
      console.warn('Binary parsing failed:', error.message);
      return {
        extractedText: '',
        structuredData: { error: error.message },
        metadata: { isBinary: true, parseError: true },
      };
    }
  }

  /**
   * Parse generic content (fallback)
   * @param {Buffer} content - File content
   * @param {Object} artifact - Artifact record
   * @param {Object} options - Parsing options
   * @returns {Object} Parsing results
   */
  async parseGenericContent(content, artifact, options) {
    try {
      // Try to detect if content is text-based
      const sample = content.slice(0, 1024).toString('utf-8');
      const isTextLike = /^[\x09\x0A\x0D\x20-\x7E\x80-\xFF]*$/.test(sample);
      
      if (isTextLike) {
        return this.parseTextContent(content, artifact, options);
      } else {
        return this.parseBinaryContent(content, artifact, options);
      }
      
    } catch (error) {
      throw new Error(`Generic parsing failed: ${error.message}`);
    }
  }

  // Helper methods for JSON parsing

  /**
   * Extract all keys from JSON object recursively
   * @param {*} obj - JSON object
   * @returns {Array} Array of keys
   */
  extractJsonKeys(obj, prefix = '') {
    const keys = [];
    
    if (typeof obj === 'object' && obj !== null) {
      Object.keys(obj).forEach((key) => {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        keys.push(fullKey);
        
        if (typeof obj[key] === 'object' && obj[key] !== null) {
          keys.push(...this.extractJsonKeys(obj[key], fullKey));
        }
      });
    }
    
    return keys;
  }

  /**
   * Calculate maximum depth of JSON object
   * @param {*} obj - JSON object
   * @returns {number} Maximum depth
   */
  calculateJsonDepth(obj) {
    if (typeof obj !== 'object' || obj === null) {
      return 0;
    }
    
    let maxDepth = 0;
    Object.values(obj).forEach((value) => {
      const depth = this.calculateJsonDepth(value);
      maxDepth = Math.max(maxDepth, depth);
    });
    
    return maxDepth + 1;
  }

  /**
   * Count arrays in JSON object
   * @param {*} obj - JSON object
   * @returns {number} Array count
   */
  countJsonArrays(obj) {
    if (typeof obj !== 'object' || obj === null) {
      return 0;
    }
    
    let count = Array.isArray(obj) ? 1 : 0;
    
    Object.values(obj).forEach((value) => {
      count += this.countJsonArrays(value);
    });
    
    return count;
  }

  /**
   * Count objects in JSON object
   * @param {*} obj - JSON object
   * @returns {number} Object count
   */
  countJsonObjects(obj) {
    if (typeof obj !== 'object' || obj === null) {
      return 0;
    }
    
    let count = Array.isArray(obj) ? 0 : 1;
    
    Object.values(obj).forEach((value) => {
      count += this.countJsonObjects(value);
    });
    
    return count;
  }

  /**
   * Store parsed content to S3
   * @param {Object} artifact - Artifact database record
   * @param {Object} parsingResult - Parsing results
   * @param {Object} job - BullMQ job for progress updates
   * @returns {Object} Storage results
   */
  async storeParsedContent(artifact, parsingResult, job) {
    try {
      const parsedContentKey = `${artifact.s3_key.replace(/\.[^/.]+$/, '')}_parsed.json`;
      
      const contentToStore = {
        extractedText: parsingResult.extractedText,
        structuredData: parsingResult.structuredData,
        metadata: parsingResult.metadata,
        processingTime: parsingResult.processingTime,
        parsedAt: new Date().toISOString(),
      };
      
      const params = {
        Bucket: artifact.s3_bucket,
        Key: parsedContentKey,
        Body: JSON.stringify(contentToStore, null, 2),
        ContentType: 'application/json',
        ServerSideEncryption: 'AES256',
      };
      
      await job.updateProgress(90);
      
      const result = await this.s3.upload(params).promise();
      
      return {
        s3Key: parsedContentKey,
        etag: result.ETag,
        size: Buffer.byteLength(params.Body),
      };
      
    } catch (error) {
      throw new Error(`Failed to store parsed content: ${error.message}`);
    }
  }

  /**
   * Update artifact with parsing results
   * @param {Object} artifact - Original artifact record
   * @param {Object} parsingResult - Parsing results
   * @param {Object} storageResult - Storage results
   */
  async updateArtifactWithParsing(artifact, parsingResult, storageResult) {
    try {
      const updateData = {
        status: 'parsed',
        parsed_content_s3_key: storageResult.s3Key,
        content_summary: this.generateContentSummary(parsingResult),
        processing_stages: [
          ...(artifact.processing_stages || []),
          'content_downloaded',
          'content_parsed',
          'structured_data_extracted',
          'parsed_content_stored',
          'parsing_completed',
        ],
      };
      
      await Artifact.update(artifact.id, updateData);
      
    } catch (error) {
      throw new Error(`Failed to update artifact: ${error.message}`);
    }
  }

  /**
   * Generate content summary from parsing results
   * @param {Object} parsingResult - Parsing results
   * @returns {string} Content summary
   */
  generateContentSummary(parsingResult) {
    const parts = [];
    
    parts.push(`${parsingResult.contentType} content parsed`);
    
    if (parsingResult.extractedText) {
      const textLength = parsingResult.extractedText.length;
      parts.push(`${textLength} characters extracted`);
    }
    
    if (parsingResult.structuredData) {
      const structuredKeys = Object.keys(parsingResult.structuredData).length;
      parts.push(`${structuredKeys} structured data fields`);
    }
    
    if (parsingResult.metadata?.totalEntries) {
      parts.push(`${parsingResult.metadata.totalEntries} log entries`);
    }
    
    if (parsingResult.structuredData?.rowCount) {
      parts.push(`${parsingResult.structuredData.rowCount} data rows`);
    }
    
    return parts.join(', ') || 'Content parsed successfully';
  }

  /**
   * Setup event handlers for worker monitoring
   */
  setupEventHandlers() {
    this.worker.on('ready', () => {
      console.log('📄 ParsingWorker is ready for processing');
    });

    this.worker.on('error', (error) => {
      console.error('📄 ParsingWorker error:', error);
    });

    this.worker.on('stalled', (jobId) => {
      console.warn(`📄 ParsingWorker job ${jobId} stalled`);
    });

    this.worker.on('completed', (job) => {
      console.log(`📄 ParsingWorker completed job ${job.id} for artifact ${job.data.artifactId}`);
    });

    this.worker.on('failed', (job, err) => {
      console.error(`📄 ParsingWorker job ${job?.id} failed:`, err.message);
    });

    this.worker.on('progress', (job, progress) => {
      console.log(`📄 ParsingWorker job ${job.id} progress: ${progress}%`);
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
    console.log('📄 Shutting down ParsingWorker...');
    await this.worker.close();
    console.log('📄 ParsingWorker shut down successfully');
  }

  /**
   * Get worker capabilities and configuration
   * @returns {Object} Worker capabilities
   */
  getCapabilities() {
    return {
      ...this.contentParser.getCapabilities(),
      workerType: 'ParsingWorker',
      concurrency: this.workerConfig.concurrency,
      queueName: 'parsing',
      features: [
        'text_extraction',
        'log_file_parsing',
        'json_parsing',
        'xml_parsing',
        'csv_parsing',
        'binary_metadata_extraction',
        'structured_data_extraction',
        'content_type_detection',
        's3_integration',
      ],
      supportedFormats: [
        'text/plain',
        'application/json',
        'application/xml',
        'text/csv',
        'application/log',
        'binary/*',
      ],
    };
  }
}

module.exports = ParsingWorker;