const sharp = require('sharp');
const Tesseract = require('tesseract.js');
const exifReader = require('exif-reader');
const fs = require('fs').promises;
const path = require('path');

/**
 * Comprehensive image processing service with advanced capabilities
 * Handles image manipulation, OCR, metadata extraction, and analysis
 */
class ImageProcessor {
  constructor() {
    this.supportedFormats = ['jpeg', 'jpg', 'png', 'webp', 'tiff', 'gif', 'bmp'];
    this.thumbnailSizes = [
      { name: 'small', width: 150, height: 150 },
      { name: 'medium', width: 300, height: 300 },
      { name: 'large', width: 600, height: 600 }
    ];
    
    // Patterns for sensitive data detection
    this.sensitivePatterns = {
      apiKeys: [
        /sk-[a-zA-Z0-9]{20,}/g, // OpenAI API keys (more flexible length)
        /AKIA[0-9A-Z]{16}/g, // AWS Access Keys
        /ghp_[a-zA-Z0-9]{36}/g, // GitHub Personal Access Tokens
        /xoxb-[0-9]{11}-[0-9]{12}-[a-zA-Z0-9]{24}/g // Slack Bot Tokens
      ],
      credentials: [
        /password\s*[:=]\s*[^\s\n]+/gi,
        /token\s*[:=]\s*[^\s\n]+/gi,
        /secret\s*[:=]\s*[^\s\n]+/gi
      ],
      pii: [
        /\b\d{3}-\d{2}-\d{4}\b/g, // SSN
        /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, // Credit card
        /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g // Email
      ]
    };
  }

  /**
   * Process image with comprehensive analysis and variant generation
   * @param {Buffer} imageBuffer - Raw image data
   * @param {Object} options - Processing options
   * @returns {Object} Processing results
   */
  async processImage(imageBuffer, options = {}) {
    try {
      const results = {
        metadata: null,
        variants: {},
        ocrText: '',
        visualElements: {},
        sensitiveDataFlags: {},
        processingTime: Date.now()
      };

      // Extract metadata and basic image info
      results.metadata = await this.extractMetadata(imageBuffer);
      
      // Generate image variants
      results.variants = await this.generateVariants(imageBuffer, options.formats);
      
      // Perform OCR text extraction
      results.ocrText = await this.extractTextOCR(imageBuffer, options.languages);
      
      // Detect visual elements
      results.visualElements = await this.detectVisualElements(imageBuffer);
      
      // Scan for sensitive data
      results.sensitiveDataFlags = await this.detectSensitiveData(results.ocrText);
      
      results.processingTime = Date.now() - results.processingTime;
      
      return results;
    } catch (error) {
      throw new Error(`Image processing failed: ${error.message}`);
    }
  }

  /**
   * Extract comprehensive metadata from image including EXIF data
   * @param {Buffer} imageBuffer - Raw image data
   * @returns {Object} Metadata information
   */
  async extractMetadata (imageBuffer) {
    try {
      const image = sharp(imageBuffer);
      const metadata = await image.metadata();

      const result = {
        format: metadata.format,
        width: metadata.width,
        height: metadata.height,
        channels: metadata.channels,
        density: metadata.density,
        hasAlpha: metadata.hasAlpha,
        hasProfile: metadata.hasProfile,
        size: imageBuffer.length,
        aspectRatio: metadata.width / metadata.height,
        colorSpace: metadata.space,
        exif: null
      };

      // Extract EXIF data if available
      if (metadata.exif) {
        try {
          result.exif = exifReader(metadata.exif);
        } catch (exifError) {
          console.warn('Failed to parse EXIF data:', exifError.message);
        }
      }

      return result;
    } catch (error) {
      throw new Error(`Metadata extraction failed: ${error.message}`);
    }
  }

  /**
   * Generate multiple optimized image variants
   * @param {Buffer} imageBuffer - Raw image data
   * @param {Array} formats - Output formats to generate
   * @returns {Object} Generated variants with buffers
   */
  async generateVariants(imageBuffer, formats = ['webp', 'jpeg']) {
    const variants = {};
    try {
      const image = sharp(imageBuffer);

      // Generate thumbnails in different sizes
      for (const size of this.thumbnailSizes) {
        variants[size.name] = {};
        
        for (const format of formats) {
          const resized = image
            .clone()
            .resize(size.width, size.height, { 
              fit: 'inside',
              withoutEnlargement: true 
            });
          let processed;
          switch (format) {
            case 'webp':
              processed = resized.webp({ quality: 80 });
              break;
            case 'jpeg':
              processed = resized.jpeg({ quality: 85, progressive: true });
              break;
            case 'png':
              processed = resized.png({ compressionLevel: 8 });
              break;
            default:
              processed = resized.jpeg({ quality: 85 });
          }
          
          variants[size.name][format] = await processed.toBuffer();
        }
      }
      
      // Generate web-optimized version (max 1920px width)
      variants.webOptimized = {};
      const webOptimized = image.clone().resize(1920, null, { 
        withoutEnlargement: true,
      });
      
      for (const format of formats) {
        let processed;
        switch (format) {
          case 'webp':
            processed = webOptimized.webp({ quality: 85 });
            break;
          case 'jpeg':
            processed = webOptimized.jpeg({ quality: 90, progressive: true });
            break;
          default:
            processed = webOptimized.jpeg({ quality: 90 });
        }
        
        variants.webOptimized[format] = await processed.toBuffer();
      }
      
      return variants;
    } catch (error) {
      throw new Error(`Variant generation failed: ${error.message}`);
    }
  }

  /**
   * Extract text using advanced OCR with multiple language support
   * @param {Buffer} imageBuffer - Raw image data
   * @param {Array} languages - Languages to detect (default: ['eng'])
   * @returns {Object} OCR results with text and confidence
   */
  async extractTextOCR(imageBuffer, languages = ['eng']) {
    try {
      // Preprocess image for better OCR results
      const preprocessed = await sharp(imageBuffer)
        .greyscale()
        .normalize()
        .sharpen()
        .toBuffer();
      const { data } = await Tesseract.recognize(preprocessed, languages.join('+'), {
        logger: () => {}, // Suppress logging
        tessedit_pageseg_mode: Tesseract.PSM.AUTO,
        tessedit_ocr_engine_mode: Tesseract.OEM.LSTM_ONLY
      });
      return {
        text: data.text.trim(),
        confidence: data.confidence,
        words: data.words.map((word) => ({
          text: word.text,
          confidence: word.confidence,
          bbox: word.bbox,
        })),
        lines: data.lines.map((line) => ({
          text: line.text,
          confidence: line.confidence,
          bbox: line.bbox,
        })),
        paragraphs: data.paragraphs.map((para) => ({
          text: para.text,
          confidence: para.confidence,
          bbox: para.bbox,
        })),
      };
    } catch (error) {
      console.warn('OCR processing failed:', error.message);
      return {
        text: '',
        confidence: 0,
        words: [],
        lines: [],
        paragraphs: [],
      };
    }
  }

  /**
   * Detect visual elements like UI components, charts, and diagrams
   * @param {Buffer} imageBuffer - Raw image data
   * @returns {Object} Detected visual elements
   */
  async detectVisualElements(imageBuffer) {
    try {
      const image = sharp(imageBuffer);
      const { width, height } = await image.metadata();
      // Basic edge detection for UI elements
      const edges = await image
        .clone()
        .greyscale()
        .convolve({
          width: 3,
          height: 3,
          kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1]
        })
        .toBuffer();
      // Analyze image for common UI patterns
      const elements = {
        hasButtons: false,
        hasText: false,
        hasCharts: false,
        hasDiagrams: false,
        hasCode: false,
        layout: this.analyzeLayout(width, height),
        colorAnalysis: await this.analyzeColors(imageBuffer),
      };
      // Simple heuristics for element detection
      // This is a basic implementation - in production, you'd use more sophisticated CV
      const stats = await sharp(edges).stats();
      const edgeDensity = stats.channels[0].mean;
      if (edgeDensity > 50) {
        elements.hasButtons = true;
        elements.hasDiagrams = true;
      }
      return elements;
    } catch (error) {
      console.warn('Visual element detection failed:', error.message);
      return {
        hasButtons: false,
        hasText: false,
        hasCharts: false,
        hasDiagrams: false,
        hasCode: false,
        layout: { type: 'unknown' },
        colorAnalysis: {}
      };
    }
  }

  /**
   * Analyze image layout characteristics
   * @param {number} width - Image width
   * @param {number} height - Image height
   * @returns {Object} Layout analysis
   */
  analyzeLay(width, height) {
    const aspectRatio = width / height;
    if (aspectRatio > 2) {
      return { type: 'banner', orientation: 'landscape' };
    } else if (aspectRatio < 0.5) {
      return { type: 'mobile', orientation: 'portrait' };
    } else if (aspectRatio > 1.3) {
      return { type: 'desktop', orientation: 'landscape' };
    } else {
      return { type: 'square', orientation: 'neutral' };
    }
  }

  /**
   * Analyze color composition of the image
   * @param {Buffer} imageBuffer - Raw image data
   * @returns {Object} Color analysis results
   */
  async analyzeColors (imageBuffer) {
    try {
      const image = sharp(imageBuffer);
      const stats = await image.stats();
      return {
        channels: stats.channels.map((channel, index) => ({
          channel: ['red', 'green', 'blue', 'alpha'][index] || `channel_${index}`,
          min: channel.min,
          max: channel.max,
          sum: channel.sum,
          mean: channel.mean,
          stdev: channel.stdev
        })),
        isGrayscale: stats.isOpaque && stats.channels.length === 1,
        hasTransparency: !stats.isOpaque
      };
    } catch (error) {
      console.warn('Color analysis failed:', error.message);
      return {};
    }
  }

  /**
   * Detect sensitive data in extracted text
   * @param {string|Object} ocrResult - OCR text result
   * @returns {Object} Sensitive data detection results
   */
  async detectSensitiveData(ocrResult) {
    const text = typeof ocrResult === 'string' ? ocrResult : ocrResult.text || '';
    const flags = {
      hasApiKeys: false,
      hasCredentials: false,
      hasPII: false,
      detectedPatterns: [],
    };
    // Check for API keys
    for (const pattern of this.sensitivePatterns.apiKeys) {
      const matches = text.match(pattern);
      if (matches) {
        flags.hasApiKeys = true;
        flags.detectedPatterns.push({
          type: 'api_key',
          count: matches.length,
          pattern: pattern.source
        });
      }
    }
    // Check for credentials
    for (const pattern of this.sensitivePatterns.credentials) {
      const matches = text.match(pattern);
      if (matches) {
        flags.hasCredentials = true;
        flags.detectedPatterns.push({
          type: 'credentials',
          count: matches.length,
          pattern: pattern.source
        });
      }
    }
    // Check for PII
    for (const pattern of this.sensitivePatterns.pii) {
      const matches = text.match(pattern);
      if (matches) {
        flags.hasPII = true;
        flags.detectedPatterns.push({
          type: 'pii',
          count: matches.length,
          pattern: pattern.source
        });
      }
    }
    return flags;
  }

  /**
   * Extract and format code snippets from screenshots
   * @param {Object} ocrResult - OCR result with text and positioning
   * @returns {Object} Extracted code snippets
   */
  extractCodeSnippets(ocrResult) {
    const text = ocrResult.text || '';
    const codePatterns = [
      /function\s+\w+\s*\([^)]*\)\s*\{[^}]*\}/g, // JavaScript functions
      /class\s+\w+\s*\{[^}]*\}/g, // Class definitions
      /if\s*\([^)]+\)\s*\{[^}]*\}/g, // If statements
      /for\s*\([^)]+\)\s*\{[^}]*\}/g, // For loops
      /import\s+.*from\s+['"][^'"]+['"]/g, // Import statements
      /<[^>]+>[^<]*<\/[^>]+>/g, // HTML tags
    ];
    const snippets = [];
    for (const pattern of codePatterns) {
      const matches = text.match(pattern);
      if (matches) {
        matches.forEach((match) => {
          snippets.push({
            code: match.trim(),
            language: this.detectLanguage(match),
            confidence: 0.8 // Basic confidence score
          });
        });
      }
    }
    return {
      snippets,
      hasCode: snippets.length > 0,
      totalSnippets: snippets.length
    };
  }

  /**
   * Detect programming language from code snippet
   * @param {string} code - Code snippet
   * @returns {string} Detected language
   */
  detectLangua (code) {
    if (code.includes('function') || code.includes('const') || code.includes('let')) {
      return 'javascript';
    }
    if (code.includes('def ') || code.includes('import ')) {
      return 'python';
    }
    if (code.includes('<') && code.includes('>')) {
      return 'html';
    }
    if (code.includes('class') && code.includes('{')) {
      return 'java';
    }
    return 'unknown';
  }

  /**
   * Detect relationships between multiple images
   * @param {Array} imageResults - Array of processed image results
   * @returns {Object} Relationship analysis
   */
  detectImageRelationships(imageResults) {
    const relationships = {
      groups: [],
      sequences: [],
      similarities: [],
    };
    // Group images by similar dimensions (likely same application/context)
    const dimensionGroups = {};
    imageResults.forEach((result, index) => {
      const key = `${result.metadata.width}x${result.metadata.height}`;
      if (!dimensionGroups[key]) {
        dimensionGroups[key] = [];
      }
      dimensionGroups[key].push({ index, result });
    });
    Object.entries(dimensionGroups).forEach(([dimensions, images]) => {
      if (images.length > 1) {
        relationships.groups.push({
          type: 'same_dimensions',
          dimensions,
          images: images.map((img) => img.index),
          count: images.length
        });
      }
    });
    // Detect potential sequences (similar content, different states)
    for (let i = 0; i < imageResults.length - 1; i++) {
      for (let j = i + 1; j < imageResults.length; j++) {
        const similarity = this.calculateTextSimilarity(
          imageResults[i].ocrText,
          imageResults[j].ocrText,
        );
        if (similarity > 0.7) {
          relationships.similarities.push({
            images: [i, j],
            similarity,
            type: 'text_similarity',
          });
        }
      }
    }
    return relationships;
  }

  /**
   * Calculate text similarity between two strings
   * @param {string} text1 - First text
   * @param {string} text2 - Second text
   * @returns {number} Similarity score (0-1)
   */
  calculateTextSimilarity(text1, text2) {
    if (!text1 || !text2) return 0;
    
    const words1 = new Set(text1.toLowerCase().split(/\s+/).filter((w) => w.length > 0));
    const words2 = new Set(text2.toLowerCase().split(/\s+/).filter((w) => w.length > 0));
    
    if (words1.size === 0 && words2.size === 0) return 1;
    if (words1.size === 0 || words2.size === 0) return 0;
    
    const intersection = new Set([...words1].filter((x) => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    return intersection.size / union.size;
  }

  /**
   * Validate if buffer contains a supported image format
   * @param {Buffer} buffer - Image buffer
   * @returns {boolean} True if supported format
   */
  async isValidImage(buffer) {
    try {
      const metadata = await sharp(buffer).metadata();
      return this.supportedFormats.includes(metadata.format);
    } catch (error) {
      return false;
    }
  }

  /**
   * Get processing capabilities and limits
   * @returns {Object} Processor capabilities
   */
  getCapabilities() {
    return {
      supportedFormats: this.supportedFormats,
      thumbnailSizes: this.thumbnailSizes,
      maxImageSize: 50 * 1024 * 1024, // 50MB
      ocrLanguages: ['eng', 'spa', 'fra', 'deu', 'ita', 'por', 'rus', 'chi_sim', 'jpn'],
      features: [
        'metadata_extraction',
        'variant_generation',
        'ocr_text_extraction',
        'visual_element_detection',
        'sensitive_data_detection',
        'code_snippet_extraction',
        'relationship_detection'
      ]
    };
  }
}

module.exports = ImageProcessor;