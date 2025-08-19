const { Worker } = require('bullmq');
const LLMService = require('../services/LLMService');
const Artifact = require('../models/Artifact');
const LlmOutput = require('../models/LlmOutput');
const aws = require('aws-sdk');

/**
 * Specialized worker for LLM analysis tasks
 * Handles AI analysis of processed content with intelligent routing and cost optimization
 */
class LLMWorker {
  constructor(redisConfig) {
    this.redisConfig = redisConfig;
    this.llmService = new LLMService();
    this.s3 = new aws.S3({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      region: process.env.AWS_REGION || 'us-east-1',
    });
    
    // Worker configuration for LLM processing
    this.workerConfig = {
      connection: redisConfig,
      concurrency: 2, // Limited concurrency for API rate limits
      removeOnComplete: 50,
      removeOnFail: 100,
    };
    
    this.worker = new Worker('llmAnalysis', this.processLLMJob.bind(this), this.workerConfig);
    this.setupEventHandlers();
  }

  /**
   * Main LLM analysis job handler
   * @param {Object} job - BullMQ job object
   * @returns {Object} Analysis results
   */
  async processLLMJob(job) {
    const { artifactId, analysisOptions = {} } = job.data;
    
    try {
      await job.updateProgress(5);
      
      // Fetch artifact from database
      const artifact = await Artifact.findById(artifactId);
      if (!artifact) {
        throw new Error(`Artifact ${artifactId} not found`);
      }

      // Update artifact status
      await Artifact.update(artifactId, { 
        status: 'llm_processing',
        processing_stages: [...(artifact.processing_stages || []), 'llm_analysis_started'],
      });
      
      await job.updateProgress(10);

      // Determine content type and analysis approach
      const contentType = this.determineContentType(artifact);
      const analysisType = analysisOptions.analysisType || this.selectAnalysisType(artifact, contentType);

      await job.updateProgress(15);

      // Prepare content for LLM analysis
      const preparedContent = await this.prepareArtifactContent(artifact, contentType, job);
      
      await job.updateProgress(30);

      // Perform LLM analysis
      const analysisResult = await this.performLLMAnalysis(
        preparedContent,
        contentType,
        analysisType,
        analysisOptions,
        job
      );

      await job.updateProgress(80);

      // Store analysis results
      const llmOutputId = await this.storeAnalysisResults(
        artifact,
        analysisResult,
        analysisType,
        job
      );

      await job.updateProgress(95);

      // Update artifact with analysis completion
      await this.updateArtifactWithAnalysis(artifact, analysisResult, llmOutputId);

      await job.updateProgress(100);

      return {
        artifactId,
        llmOutputId,
        status: 'completed',
        analysisType,
        provider: analysisResult.metadata?.provider,
        model: analysisResult.metadata?.model,
        tokensUsed: analysisResult.metadata?.totalTokens || 0,
        estimatedCost: analysisResult.metadata?.estimatedCost || 0,
        processingTime: analysisResult.metadata?.processingTime || 0,
        completedAt: new Date().toISOString(),
      };

    } catch (error) {
      console.error(`LLM analysis failed for artifact ${artifactId}:`, error);
      
      // Update artifact status to failed
      await Artifact.update(artifactId, {
        status: 'llm_failed',
        last_error: error.message,
        processing_stages: [...(artifact?.processing_stages || []), 'llm_analysis_failed'],
      });
      
      throw error;
    }
  }

  /**
   * Determine content type for LLM analysis
   * @param {Object} artifact - Artifact database record
   * @returns {string} Content type (text, image, mixed)
   */
  determineContentType(artifact) {
    const contentType = artifact.content_type || '';
    
    if (contentType.startsWith('image/')) {
      return 'image';
    } else if (contentType.startsWith('text/') || 
               contentType.includes('json') || 
               contentType.includes('xml') ||
               contentType.includes('log')) {
      return 'text';
    } else {
      // For unknown types, check if we have processed content
      if (artifact.image_variants || artifact.ocr_text) {
        return 'image';
      } else if (artifact.parsed_content_s3_key) {
        return 'text';
      } else {
        return 'text'; // Default fallback
      }
    }
  }

  /**
   * Select appropriate analysis type based on artifact characteristics
   * @param {Object} artifact - Artifact database record
   * @param {string} contentType - Content type
   * @returns {string} Analysis type
   */
  selectAnalysisType(artifact, contentType) {
    if (contentType === 'image') {
      // Analyze visual elements to determine image type
      const visualElements = artifact.visual_elements || {};
      const ocrText = artifact.ocr_text || '';
      
      if (visualElements.hasCode || /function|class|import|export/i.test(ocrText)) {
        return 'codeImage';
      } else if (visualElements.hasCharts || visualElements.hasDiagrams) {
        return 'diagram';
      } else if (visualElements.hasButtons || /button|click|menu/i.test(ocrText)) {
        return 'screenshot';
      } else {
        return 'general';
      }
    } else {
      // Analyze content type and filename for text analysis
      const filename = artifact.original_filename || '';
      const contentType = artifact.content_type || '';
      
      if (/\.log$|log/i.test(filename) || /log/i.test(contentType)) {
        return 'logAnalysis';
      } else if (/\.(js|ts|py|java|cpp|c|php|rb|go)$/i.test(filename)) {
        return 'codeReview';
      } else {
        return 'documentSummary';
      }
    }
  }

  /**
   * Prepare artifact content for LLM analysis
   * @param {Object} artifact - Artifact database record
   * @param {string} contentType - Content type
   * @param {Object} job - BullMQ job for progress updates
   * @returns {Object} Prepared content
   */
  async prepareArtifactContent(artifact, contentType, job) {
    try {
      const content = {
        type: contentType,
        metadata: {
          filename: artifact.original_filename,
          contentType: artifact.content_type,
          size: artifact.size_bytes,
          uploadedAt: artifact.created_at,
        },
      };

      if (contentType === 'image') {
        // For images, use processed data if available
        content.ocrText = artifact.ocr_text || '';
        content.visualElements = artifact.visual_elements || {};
        content.metadata.imageMetadata = artifact.image_metadata || {};
        
        // Download original image if needed for vision analysis
        if (this.shouldIncludeImageBuffer(artifact)) {
          content.imageBuffer = await this.downloadImageFromS3(artifact);
        }
        
      } else {
        // For text content, download and prepare text
        if (artifact.parsed_content_s3_key) {
          // Use processed content if available
          content.text = await this.downloadProcessedContent(artifact);
        } else {
          // Download and process raw content
          content.text = await this.downloadRawContent(artifact);
        }
      }

      await job.updateProgress(25);
      return content;

    } catch (error) {
      throw new Error(`Failed to prepare content: ${error.message}`);
    }
  }

  /**
   * Determine if image buffer should be included for vision analysis
   * @param {Object} artifact - Artifact database record
   * @returns {boolean} True if image buffer needed
   */
  shouldIncludeImageBuffer(artifact) {
    // Include image buffer for vision analysis if:
    // 1. Image is not too large (< 20MB for vision APIs)
    // 2. OCR text is limited or visual analysis is needed
    const maxSizeForVision = 20 * 1024 * 1024; // 20MB
    const ocrTextLength = (artifact.ocr_text || '').length;
    
    return (artifact.size_bytes || 0) < maxSizeForVision && 
           (ocrTextLength < 1000 || !artifact.visual_elements);
  }

  /**
   * Download image from S3 for vision analysis
   * @param {Object} artifact - Artifact database record
   * @returns {Buffer} Image buffer
   */
  async downloadImageFromS3(artifact) {
    try {
      const params = {
        Bucket: artifact.s3_bucket,
        Key: artifact.s3_key,
      };

      const result = await this.s3.getObject(params).promise();
      return Buffer.isBuffer(result.Body) ? result.Body : Buffer.from(result.Body);
      
    } catch (error) {
      throw new Error(`Failed to download image: ${error.message}`);
    }
  }

  /**
   * Download processed content from S3
   * @param {Object} artifact - Artifact database record
   * @returns {string} Processed content text
   */
  async downloadProcessedContent(artifact) {
    try {
      const params = {
        Bucket: artifact.s3_bucket,
        Key: artifact.parsed_content_s3_key,
      };

      const result = await this.s3.getObject(params).promise();
      const contentStr = result.Body.toString('utf-8');
      
      try {
        const parsed = JSON.parse(contentStr);
        return parsed.text || parsed.content || contentStr;
      } catch {
        return contentStr;
      }
      
    } catch (error) {
      throw new Error(`Failed to download processed content: ${error.message}`);
    }
  }

  /**
   * Download raw content from S3
   * @param {Object} artifact - Artifact database record
   * @returns {string} Raw content text
   */
  async downloadRawContent(artifact) {
    try {
      const params = {
        Bucket: artifact.s3_bucket,
        Key: artifact.s3_key,
      };

      // Limit download size for text analysis
      const maxSize = 5 * 1024 * 1024; // 5MB limit
      if (artifact.size_bytes && artifact.size_bytes > maxSize) {
        params.Range = `bytes=0-${maxSize - 1}`;
      }

      const result = await this.s3.getObject(params).promise();
      return result.Body.toString('utf-8');
      
    } catch (error) {
      throw new Error(`Failed to download raw content: ${error.message}`);
    }
  }  /*
*
   * Perform LLM analysis using the LLMService
   * @param {Object} content - Prepared content
   * @param {string} contentType - Content type
   * @param {string} analysisType - Analysis type
   * @param {Object} options - Analysis options
   * @param {Object} job - BullMQ job for progress updates
   * @returns {Object} Analysis results
   */
  async performLLMAnalysis(content, contentType, analysisType, options, job) {
    try {
      const analysisOptions = {
        type: contentType,
        analysisType,
        provider: options.provider || 'openai',
        model: options.model,
        maxTokens: options.maxTokens,
        temperature: options.temperature || 0.1,
      };

      await job.updateProgress(40);

      const result = await this.llmService.analyzeContent(content, analysisOptions);

      if (!result.success) {
        throw new Error(`LLM analysis failed: ${result.error}`);
      }

      await job.updateProgress(75);

      return result;

    } catch (error) {
      throw new Error(`LLM analysis processing failed: ${error.message}`);
    }
  }

  /**
   * Store analysis results in database and S3
   * @param {Object} artifact - Artifact database record
   * @param {Object} analysisResult - LLM analysis results
   * @param {string} analysisType - Analysis type
   * @param {Object} job - BullMQ job for progress updates
   * @returns {number} LLM output ID
   */
  async storeAnalysisResults(artifact, analysisResult, analysisType, job) {
    try {
      // Store detailed results in S3
      const resultsKey = `${artifact.s3_key.replace(/\.[^/.]+$/, '')}_llm_analysis.json`;
      const detailedResults = {
        analysis: analysisResult.analysis,
        metadata: analysisResult.metadata,
        analysisType,
        artifactId: artifact.id,
        createdAt: new Date().toISOString(),
      };

      await this.uploadToS3(
        artifact.s3_bucket,
        resultsKey,
        Buffer.from(JSON.stringify(detailedResults, null, 2)),
        'application/json'
      );

      await job.updateProgress(85);

      // Create LLM output record in database
      const llmOutputData = {
        artifact_id: artifact.id,
        analysis_type: analysisType,
        provider: analysisResult.metadata?.provider || 'unknown',
        model: analysisResult.metadata?.model || 'unknown',
        prompt_tokens: analysisResult.metadata?.totalTokens || 0,
        completion_tokens: 0, // Will be calculated from response
        total_tokens: analysisResult.metadata?.totalTokens || 0,
        response_text: analysisResult.analysis,
        confidence_score: this.calculateConfidenceScore(analysisResult),
        processing_time_ms: analysisResult.metadata?.processingTime || 0,
        token_usage: {
          inputTokens: analysisResult.metadata?.totalTokens || 0,
          outputTokens: 0,
          totalTokens: analysisResult.metadata?.totalTokens || 0,
          estimatedCost: analysisResult.metadata?.estimatedCost || 0,
        },
        structured_output: this.extractStructuredOutput(analysisResult.analysis, analysisType),
        s3_key: resultsKey,
      };

      const llmOutput = await LlmOutput.create(llmOutputData);
      
      await job.updateProgress(90);

      return llmOutput.id;

    } catch (error) {
      throw new Error(`Failed to store analysis results: ${error.message}`);
    }
  }

  /**
   * Upload content to S3
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
   * Calculate confidence score for analysis results
   * @param {Object} analysisResult - Analysis results
   * @returns {number} Confidence score (0-1)
   */
  calculateConfidenceScore(analysisResult) {
    // Basic confidence calculation based on response length and metadata
    const analysis = analysisResult.analysis || '';
    const metadata = analysisResult.metadata || {};
    
    let confidence = 0.5; // Base confidence
    
    // Increase confidence for longer, more detailed responses
    if (analysis.length > 500) confidence += 0.2;
    if (analysis.length > 1000) confidence += 0.1;
    
    // Increase confidence for successful processing
    if (metadata.chunksProcessed === 1) confidence += 0.1;
    
    // Decrease confidence for errors or retries
    if (analysisResult.error) confidence -= 0.3;
    
    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Extract structured output from analysis text
   * @param {string} analysis - Analysis text
   * @param {string} analysisType - Analysis type
   * @returns {Object} Structured output
   */
  extractStructuredOutput(analysis, analysisType) {
    const structured = {
      analysisType,
      summary: this.extractSummary(analysis),
      keyFindings: this.extractKeyFindings(analysis),
      recommendations: this.extractRecommendations(analysis),
      technicalDetails: this.extractTechnicalDetails(analysis, analysisType),
    };

    return structured;
  }

  /**
   * Extract summary from analysis text
   * @param {string} analysis - Analysis text
   * @returns {string} Summary
   */
  extractSummary(analysis) {
    // Look for summary sections or take first paragraph
    const summaryMatch = analysis.match(/(?:summary|overview):\s*([^.\n]+(?:\.[^.\n]+)*)/i);
    if (summaryMatch) {
      return summaryMatch[1].trim();
    }
    
    // Fallback: take first sentence or paragraph
    const firstParagraph = analysis.split('\n\n')[0];
    return firstParagraph.split('.')[0] + '.';
  }

  /**
   * Extract key findings from analysis text
   * @param {string} analysis - Analysis text
   * @returns {Array} Key findings
   */
  extractKeyFindings(analysis) {
    const findings = [];
    
    // Look for numbered lists or bullet points
    const listMatches = analysis.match(/^\d+\.\s+(.+)$/gm);
    if (listMatches) {
      findings.push(...listMatches.map(match => match.replace(/^\d+\.\s+/, '')));
    }
    
    // Look for bullet points
    const bulletMatches = analysis.match(/^[-*]\s+(.+)$/gm);
    if (bulletMatches) {
      findings.push(...bulletMatches.map(match => match.replace(/^[-*]\s+/, '')));
    }
    
    return findings.slice(0, 10); // Limit to top 10 findings
  }

  /**
   * Extract recommendations from analysis text
   * @param {string} analysis - Analysis text
   * @returns {Array} Recommendations
   */
  extractRecommendations(analysis) {
    const recommendations = [];
    
    // Look for recommendation sections
    const recSection = analysis.match(/(?:recommendations?|suggestions?|actions?):\s*([^#]*?)(?:\n#|$)/i);
    if (recSection) {
      const recText = recSection[1];
      const recMatches = recText.match(/^\d+\.\s+(.+)$/gm) || recText.match(/^[-*]\s+(.+)$/gm);
      if (recMatches) {
        recommendations.push(...recMatches.map(match => match.replace(/^(?:\d+\.|-|\*)\s+/, '')));
      }
    }
    
    return recommendations.slice(0, 5); // Limit to top 5 recommendations
  }

  /**
   * Extract technical details based on analysis type
   * @param {string} analysis - Analysis text
   * @param {string} analysisType - Analysis type
   * @returns {Object} Technical details
   */
  extractTechnicalDetails(analysis, analysisType) {
    const details = {};
    
    switch (analysisType) {
      case 'codeReview':
        details.languages = this.extractLanguages(analysis);
        details.issues = this.extractIssues(analysis);
        details.complexity = this.extractComplexity(analysis);
        break;
        
      case 'logAnalysis':
        details.errorCount = this.extractErrorCount(analysis);
        details.patterns = this.extractPatterns(analysis);
        details.timeRange = this.extractTimeRange(analysis);
        break;
        
      case 'screenshot':
      case 'diagram':
        details.components = this.extractComponents(analysis);
        details.workflow = this.extractWorkflow(analysis);
        break;
        
      default:
        details.topics = this.extractTopics(analysis);
        break;
    }
    
    return details;
  }

  // Helper methods for structured output extraction

  extractLanguages(analysis) {
    const languages = [];
    const langPattern = /(?:javascript|typescript|python|java|c\+\+|c#|php|ruby|go|rust|swift)/gi;
    const matches = analysis.match(langPattern);
    if (matches) {
      languages.push(...new Set(matches.map(lang => lang.toLowerCase())));
    }
    return languages;
  }

  extractIssues(analysis) {
    const issues = [];
    const issuePatterns = [
      /(?:error|bug|issue|problem|vulnerability):\s*([^.\n]+)/gi,
      /(?:security|performance|maintainability)\s+(?:issue|concern|problem):\s*([^.\n]+)/gi,
    ];
    
    issuePatterns.forEach(pattern => {
      const matches = analysis.match(pattern);
      if (matches) {
        issues.push(...matches.map(match => match.replace(pattern, '$1').trim()));
      }
    });
    
    return issues.slice(0, 10);
  }

  extractComplexity(analysis) {
    const complexityMatch = analysis.match(/complexity:\s*(low|medium|high|very high)/i);
    return complexityMatch ? complexityMatch[1].toLowerCase() : 'unknown';
  }

  extractErrorCount(analysis) {
    const errorMatch = analysis.match(/(\d+)\s+errors?/i);
    return errorMatch ? parseInt(errorMatch[1], 10) : 0;
  }

  extractPatterns(analysis) {
    const patterns = [];
    const patternMatch = analysis.match(/patterns?:\s*([^#\n]*)/i);
    if (patternMatch) {
      patterns.push(...patternMatch[1].split(',').map(p => p.trim()));
    }
    return patterns.slice(0, 5);
  }

  extractTimeRange(analysis) {
    const timeMatch = analysis.match(/(?:from|between)\s+([^to\n]+)\s+to\s+([^.\n]+)/i);
    return timeMatch ? { start: timeMatch[1].trim(), end: timeMatch[2].trim() } : null;
  }

  extractComponents(analysis) {
    const components = [];
    const compPattern = /(?:component|element|button|menu|dialog):\s*([^.\n]+)/gi;
    const matches = analysis.match(compPattern);
    if (matches) {
      components.push(...matches.map(match => match.replace(compPattern, '$1').trim()));
    }
    return components.slice(0, 10);
  }

  extractWorkflow(analysis) {
    const workflow = [];
    const stepPattern = /(?:step|stage|phase)\s*\d*:\s*([^.\n]+)/gi;
    const matches = analysis.match(stepPattern);
    if (matches) {
      workflow.push(...matches.map(match => match.replace(stepPattern, '$1').trim()));
    }
    return workflow.slice(0, 10);
  }

  extractTopics(analysis) {
    const topics = [];
    const topicPattern = /(?:topic|subject|theme):\s*([^.\n]+)/gi;
    const matches = analysis.match(topicPattern);
    if (matches) {
      topics.push(...matches.map(match => match.replace(topicPattern, '$1').trim()));
    }
    return topics.slice(0, 5);
  }

  /**
   * Update artifact with analysis completion
   * @param {Object} artifact - Artifact database record
   * @param {Object} analysisResult - Analysis results
   * @param {number} llmOutputId - LLM output ID
   */
  async updateArtifactWithAnalysis(artifact, analysisResult, llmOutputId) {
    try {
      const updateData = {
        status: 'analyzed',
        processed_at: new Date().toISOString(),
        content_summary: this.generateAnalysisSummary(analysisResult),
        processing_stages: [
          ...(artifact.processing_stages || []),
          'llm_analysis_completed',
        ],
      };
      
      await Artifact.update(artifact.id, updateData);
      
    } catch (error) {
      throw new Error(`Failed to update artifact: ${error.message}`);
    }
  }

  /**
   * Generate analysis summary for artifact
   * @param {Object} analysisResult - Analysis results
   * @returns {string} Analysis summary
   */
  generateAnalysisSummary(analysisResult) {
    const analysis = analysisResult.analysis || '';
    const metadata = analysisResult.metadata || {};
    
    const parts = [];
    
    if (metadata.provider && metadata.model) {
      parts.push(`Analyzed using ${metadata.provider}/${metadata.model}`);
    }
    
    if (metadata.totalTokens) {
      parts.push(`${metadata.totalTokens} tokens processed`);
    }
    
    if (metadata.estimatedCost) {
      parts.push(`$${metadata.estimatedCost.toFixed(4)} estimated cost`);
    }
    
    // Add first sentence of analysis as summary
    const firstSentence = analysis.split('.')[0];
    if (firstSentence && firstSentence.length > 10) {
      parts.push(firstSentence + '.');
    }
    
    return parts.join(', ') || 'LLM analysis completed';
  }

  /**
   * Setup event handlers for worker monitoring
   */
  setupEventHandlers() {
    this.worker.on('ready', () => {
      console.log('🤖 LLMWorker is ready for processing');
    });

    this.worker.on('error', (error) => {
      console.error('🤖 LLMWorker error:', error);
    });

    this.worker.on('stalled', (jobId) => {
      console.warn(`🤖 LLMWorker job ${jobId} stalled`);
    });

    this.worker.on('completed', (job) => {
      console.log(`🤖 LLMWorker completed job ${job.id} for artifact ${job.data.artifactId}`);
    });

    this.worker.on('failed', (job, err) => {
      console.error(`🤖 LLMWorker job ${job?.id} failed:`, err.message);
    });

    this.worker.on('progress', (job, progress) => {
      console.log(`🤖 LLMWorker job ${job.id} progress: ${progress}%`);
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
    console.log('🤖 Shutting down LLMWorker...');
    await this.worker.close();
    console.log('🤖 LLMWorker shut down successfully');
  }

  /**
   * Get worker capabilities and configuration
   * @returns {Object} Worker capabilities
   */
  getCapabilities() {
    return {
      ...this.llmService.getCapabilities(),
      workerType: 'LLMWorker',
      concurrency: this.workerConfig.concurrency,
      queueName: 'llmAnalysis',
      features: [
        'multi_provider_llm_support',
        'intelligent_content_routing',
        'automatic_analysis_type_selection',
        'structured_output_extraction',
        'cost_tracking',
        'retry_with_backoff',
        'progress_tracking',
        's3_integration',
      ],
    };
  }
}

module.exports = LLMWorker;