const crypto = require('crypto');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

/**
 * Advanced image security scanner for detecting steganography, malicious content,
 * and other security threats in uploaded images
 */
class ImageSecurityScanner {
  constructor() {
    this.tempDir = process.env.TEMP_DIR || '/tmp';
    
    // Steganography detection thresholds
    this.steganographyThresholds = {
      entropyVariance: 0.1, // Unusual entropy distribution
      lsbAnalysis: 0.3, // LSB (Least Significant Bit) randomness
      frequencyAnalysis: 0.25, // Frequency domain anomalies
      pixelPatterns: 0.2, // Unusual pixel patterns
    };

    // Malicious image patterns
    this.maliciousPatterns = {
      // Embedded script patterns
      scriptTags: /<script[^>]*>.*?<\/script>/gi,
      javascriptUrls: /javascript:/gi,
      dataUrls: /data:(?:text\/html|application\/javascript)/gi,
      
      // Suspicious metadata patterns
      suspiciousComments: /(?:eval|exec|system|shell|cmd)/gi,
      encodedPayloads: /(?:base64|hex|url)encode/gi,
      
      // Polyglot file signatures
      zipSignature: /PK\x03\x04/g,
      rarSignature: /Rar!\x1a\x07\x00/g,
      exeSignature: /MZ/g,
      
      // Suspicious EXIF data
      suspiciousExif: /(?:copyright|artist|software).*(?:hack|exploit|payload)/gi,
    };

    // Image format specific security checks
    this.formatChecks = {
      'image/jpeg': this.checkJPEGSecurity.bind(this),
      'image/png': this.checkPNGSecurity.bind(this),
      'image/gif': this.checkGIFSecurity.bind(this),
      'image/webp': this.checkWebPSecurity.bind(this),
      'image/svg+xml': this.checkSVGSecurity.bind(this),
      'image/bmp': this.checkBMPSecurity.bind(this),
      'image/tiff': this.checkTIFFSecurity.bind(this),
    };

    // Suspicious dimension patterns
    this.suspiciousDimensions = {
      tinyImages: { maxWidth: 10, maxHeight: 10 }, // Potential tracking pixels
      hugeImages: { maxWidth: 50000, maxHeight: 50000 }, // Potential DoS
      unusualRatios: { minRatio: 0.01, maxRatio: 100 }, // Extreme aspect ratios
    };
  }

  /**
   * Main security scanning method
   */
  async scanImage(imageBuffer, metadata = {}) {
    const scanResult = {
      isSecure: true,
      threats: [],
      warnings: [],
      steganographyRisk: 'low',
      malwareRisk: 'low',
      overallRisk: 'low',
      scanDetails: {},
    };

    try {
      const { contentType, filename } = metadata;

      // 1. Basic format validation
      const formatValidation = await this.validateImageFormat(imageBuffer, contentType);
      if (!formatValidation.isValid) {
        scanResult.isSecure = false;
        scanResult.threats.push(...formatValidation.threats);
      }

      // 2. Dimension analysis
      const dimensionAnalysis = await this.analyzeDimensions(imageBuffer, metadata);
      if (dimensionAnalysis.suspicious) {
        scanResult.warnings.push(...dimensionAnalysis.warnings);
      }

      // 3. Steganography detection
      const steganographyAnalysis = await this.detectSteganography(imageBuffer);
      scanResult.steganographyRisk = steganographyAnalysis.riskLevel;
      scanResult.scanDetails.steganography = steganographyAnalysis;
      
      if (steganographyAnalysis.riskLevel === 'high') {
        scanResult.isSecure = false;
        scanResult.threats.push('Potential steganography detected');
      } else if (steganographyAnalysis.riskLevel === 'medium') {
        scanResult.warnings.push('Possible hidden data detected');
      }

      // 4. Malicious content detection
      const malwareAnalysis = await this.detectMaliciousContent(imageBuffer, metadata);
      scanResult.malwareRisk = malwareAnalysis.riskLevel;
      scanResult.scanDetails.malware = malwareAnalysis;
      
      if (malwareAnalysis.riskLevel === 'high') {
        scanResult.isSecure = false;
        scanResult.threats.push(...malwareAnalysis.threats);
      } else if (malwareAnalysis.riskLevel === 'medium') {
        scanResult.warnings.push(...malwareAnalysis.warnings);
      }

      // 5. Format-specific security checks
      if (this.formatChecks[contentType]) {
        const formatAnalysis = await this.formatChecks[contentType](imageBuffer);
        if (formatAnalysis.threats.length > 0) {
          scanResult.isSecure = false;
          scanResult.threats.push(...formatAnalysis.threats);
        }
        scanResult.warnings.push(...formatAnalysis.warnings);
        scanResult.scanDetails.formatSpecific = formatAnalysis;
      }

      // 6. Metadata analysis
      const metadataAnalysis = await this.analyzeMetadata(imageBuffer, contentType);
      if (metadataAnalysis.suspicious) {
        scanResult.warnings.push(...metadataAnalysis.warnings);
      }
      scanResult.scanDetails.metadata = metadataAnalysis;

      // 7. Calculate overall risk
      scanResult.overallRisk = this.calculateOverallRisk(scanResult);

      return scanResult;

    } catch (error) {
      console.error('Image security scan failed:', error);
      return {
        isSecure: false,
        threats: [`Security scan failed: ${error.message}`],
        warnings: [],
        steganographyRisk: 'unknown',
        malwareRisk: 'unknown',
        overallRisk: 'high',
        scanDetails: { error: error.message },
      };
    }
  }

  /**
   * Validate image format and detect format spoofing
   */
  async validateImageFormat(imageBuffer, declaredContentType) {
    const result = { isValid: true, threats: [], warnings: [] };

    try {
      // Get actual format from magic bytes
      const actualFormat = this.detectImageFormat(imageBuffer);
      
      if (!actualFormat) {
        result.isValid = false;
        result.threats.push('Invalid or corrupted image format');
        return result;
      }

      // Check for format spoofing
      const expectedMimeType = this.formatToMimeType(actualFormat);
      if (declaredContentType && declaredContentType !== expectedMimeType) {
        result.isValid = false;
        result.threats.push(`Format spoofing detected: declared ${declaredContentType}, actual ${expectedMimeType}`);
      }

      // Check for polyglot files (files that are valid in multiple formats)
      const polyglotCheck = this.detectPolyglotFile(imageBuffer);
      if (polyglotCheck.isPolyglot) {
        result.isValid = false;
        result.threats.push(`Polyglot file detected: ${polyglotCheck.formats.join(', ')}`);
      }

    } catch (error) {
      result.isValid = false;
      result.threats.push(`Format validation failed: ${error.message}`);
    }

    return result;
  }

  /**
   * Analyze image dimensions for suspicious patterns
   */
  async analyzeDimensions(imageBuffer, metadata) {
    const result = { suspicious: false, warnings: [] };

    try {
      const dimensions = await this.extractDimensions(imageBuffer);
      
      if (!dimensions) {
        result.warnings.push('Could not extract image dimensions');
        return result;
      }

      const { width, height } = dimensions;
      const aspectRatio = width / height;

      // Check for tracking pixels
      if (width <= this.suspiciousDimensions.tinyImages.maxWidth && 
          height <= this.suspiciousDimensions.tinyImages.maxHeight) {
        result.suspicious = true;
        result.warnings.push('Potential tracking pixel detected (very small image)');
      }

      // Check for unusually large images
      if (width > this.suspiciousDimensions.hugeImages.maxWidth || 
          height > this.suspiciousDimensions.hugeImages.maxHeight) {
        result.suspicious = true;
        result.warnings.push('Unusually large image dimensions (potential DoS vector)');
      }

      // Check for extreme aspect ratios
      if (aspectRatio < this.suspiciousDimensions.unusualRatios.minRatio || 
          aspectRatio > this.suspiciousDimensions.unusualRatios.maxRatio) {
        result.suspicious = true;
        result.warnings.push('Extreme aspect ratio detected');
      }

    } catch (error) {
      result.warnings.push(`Dimension analysis failed: ${error.message}`);
    }

    return result;
  }

  /**
   * Detect steganography using multiple analysis techniques
   */
  async detectSteganography(imageBuffer) {
    const analysis = {
      riskLevel: 'low',
      confidence: 0,
      techniques: {},
    };

    try {
      // 1. Entropy analysis
      const entropyAnalysis = this.analyzeEntropy(imageBuffer);
      analysis.techniques.entropy = entropyAnalysis;

      // 2. LSB (Least Significant Bit) analysis
      const lsbAnalysis = this.analyzeLSB(imageBuffer);
      analysis.techniques.lsb = lsbAnalysis;

      // 3. Frequency domain analysis
      const frequencyAnalysis = this.analyzeFrequencyDomain(imageBuffer);
      analysis.techniques.frequency = frequencyAnalysis;

      // 4. Pixel pattern analysis
      const patternAnalysis = this.analyzePixelPatterns(imageBuffer);
      analysis.techniques.patterns = patternAnalysis;

      // Calculate overall steganography risk
      const riskScores = [
        entropyAnalysis.suspiciousScore,
        lsbAnalysis.suspiciousScore,
        frequencyAnalysis.suspiciousScore,
        patternAnalysis.suspiciousScore,
      ];

      const averageRisk = riskScores.reduce((sum, score) => sum + score, 0) / riskScores.length;
      analysis.confidence = averageRisk;

      if (averageRisk > 0.7) {
        analysis.riskLevel = 'high';
      } else if (averageRisk > 0.4) {
        analysis.riskLevel = 'medium';
      }

    } catch (error) {
      console.error('Steganography detection failed:', error);
      analysis.riskLevel = 'unknown';
      analysis.error = error.message;
    }

    return analysis;
  }

  /**
   * Detect malicious content in images
   */
  async detectMaliciousContent(imageBuffer, metadata) {
    const analysis = {
      riskLevel: 'low',
      threats: [],
      warnings: [],
    };

    try {
      // Convert buffer to string for pattern matching
      const bufferString = imageBuffer.toString('latin1');

      // Check for embedded scripts and malicious patterns
      Object.entries(this.maliciousPatterns).forEach(([patternName, pattern]) => {
        const matches = bufferString.match(pattern);
        if (matches) {
          if (patternName.includes('script') || patternName.includes('javascript')) {
            analysis.riskLevel = 'high';
            analysis.threats.push(`Embedded script detected: ${patternName}`);
          } else {
            analysis.warnings.push(`Suspicious pattern detected: ${patternName}`);
          }
        }
      });

      // Check for embedded files (polyglot detection)
      const embeddedFiles = this.detectEmbeddedFiles(imageBuffer);
      if (embeddedFiles.length > 0) {
        analysis.riskLevel = 'high';
        analysis.threats.push(`Embedded files detected: ${embeddedFiles.join(', ')}`);
      }

      // Check file size vs. expected size for format
      const sizeAnalysis = this.analyzeSizeAnomalies(imageBuffer, metadata);
      if (sizeAnalysis.suspicious) {
        analysis.warnings.push('File size anomaly detected (may contain hidden data)');
      }

    } catch (error) {
      console.error('Malicious content detection failed:', error);
      analysis.warnings.push(`Malware scan failed: ${error.message}`);
    }

    return analysis;
  }

  /**
   * Format-specific security checks
   */

  async checkJPEGSecurity(imageBuffer) {
    const result = { threats: [], warnings: [] };

    try {
      // Check for JPEG comment sections that might contain malicious data
      const jpegSections = this.parseJPEGSections(imageBuffer);
      
      jpegSections.forEach(section => {
        if (section.type === 'COM' && section.data.length > 1000) {
          result.warnings.push('Large JPEG comment section detected');
        }
        
        if (section.type === 'APP' && this.containsSuspiciousData(section.data)) {
          result.threats.push('Suspicious data in JPEG APP section');
        }
      });

    } catch (error) {
      result.warnings.push(`JPEG security check failed: ${error.message}`);
    }

    return result;
  }

  async checkPNGSecurity(imageBuffer) {
    const result = { threats: [], warnings: [] };

    try {
      // Check PNG chunks for suspicious content
      const pngChunks = this.parsePNGChunks(imageBuffer);
      
      pngChunks.forEach(chunk => {
        // Check for suspicious text chunks
        if (chunk.type === 'tEXt' || chunk.type === 'iTXt' || chunk.type === 'zTXt') {
          if (this.containsSuspiciousData(chunk.data)) {
            result.threats.push(`Suspicious data in PNG ${chunk.type} chunk`);
          }
        }
        
        // Check for unknown critical chunks
        if (chunk.critical && !this.isKnownPNGChunk(chunk.type)) {
          result.warnings.push(`Unknown critical PNG chunk: ${chunk.type}`);
        }
      });

    } catch (error) {
      result.warnings.push(`PNG security check failed: ${error.message}`);
    }

    return result;
  }

  async checkSVGSecurity(imageBuffer) {
    const result = { threats: [], warnings: [] };

    try {
      const svgContent = imageBuffer.toString('utf8');
      
      // SVGs can contain JavaScript - this is a major security risk
      if (/<script/i.test(svgContent)) {
        result.threats.push('JavaScript detected in SVG file');
      }
      
      if (/on\w+\s*=/i.test(svgContent)) {
        result.threats.push('Event handlers detected in SVG file');
      }
      
      if (/<foreignObject/i.test(svgContent)) {
        result.warnings.push('Foreign object detected in SVG (potential security risk)');
      }
      
      if (/<use\s+href/i.test(svgContent)) {
        result.warnings.push('External references detected in SVG');
      }

    } catch (error) {
      result.warnings.push(`SVG security check failed: ${error.message}`);
    }

    return result;
  }

  async checkGIFSecurity(imageBuffer) {
    const result = { threats: [], warnings: [] };

    try {
      // Check for GIF comment extensions
      const gifData = this.parseGIFData(imageBuffer);
      
      if (gifData.comments) {
        gifData.comments.forEach(comment => {
          if (this.containsSuspiciousData(Buffer.from(comment))) {
            result.threats.push('Suspicious data in GIF comment');
          }
        });
      }
      
      // Check for unusual GIF structure
      if (gifData.frames && gifData.frames.length > 1000) {
        result.warnings.push('Unusually high number of GIF frames (potential DoS)');
      }

    } catch (error) {
      result.warnings.push(`GIF security check failed: ${error.message}`);
    }

    return result;
  }

  async checkWebPSecurity(imageBuffer) {
    const result = { threats: [], warnings: [] };

    try {
      // WebP format analysis
      const webpData = this.parseWebPData(imageBuffer);
      
      if (webpData.hasAnimation && webpData.frameCount > 1000) {
        result.warnings.push('Unusually high number of WebP frames');
      }
      
      if (webpData.metadata && this.containsSuspiciousData(webpData.metadata)) {
        result.threats.push('Suspicious metadata in WebP file');
      }

    } catch (error) {
      result.warnings.push(`WebP security check failed: ${error.message}`);
    }

    return result;
  }

  async checkBMPSecurity(imageBuffer) {
    const result = { threats: [], warnings: [] };

    try {
      // BMP files can have large headers - check for anomalies
      const bmpHeader = this.parseBMPHeader(imageBuffer);
      
      if (bmpHeader.fileSize !== imageBuffer.length) {
        result.warnings.push('BMP file size mismatch in header');
      }
      
      if (bmpHeader.dataOffset > imageBuffer.length) {
        result.threats.push('Invalid BMP data offset');
      }

    } catch (error) {
      result.warnings.push(`BMP security check failed: ${error.message}`);
    }

    return result;
  }

  async checkTIFFSecurity(imageBuffer) {
    const result = { threats: [], warnings: [] };

    try {
      // TIFF files can contain arbitrary data in tags
      const tiffTags = this.parseTIFFTags(imageBuffer);
      
      tiffTags.forEach(tag => {
        if (tag.data && this.containsSuspiciousData(tag.data)) {
          result.threats.push(`Suspicious data in TIFF tag ${tag.id}`);
        }
      });

    } catch (error) {
      result.warnings.push(`TIFF security check failed: ${error.message}`);
    }

    return result;
  }

  /**
   * Helper methods for analysis
   */

  detectImageFormat(buffer) {
    const signatures = {
      'JPEG': [0xFF, 0xD8, 0xFF],
      'PNG': [0x89, 0x50, 0x4E, 0x47],
      'GIF': [0x47, 0x49, 0x46],
      'WebP': [0x52, 0x49, 0x46, 0x46],
      'BMP': [0x42, 0x4D],
      'TIFF_LE': [0x49, 0x49, 0x2A, 0x00],
      'TIFF_BE': [0x4D, 0x4D, 0x00, 0x2A],
    };

    for (const [format, signature] of Object.entries(signatures)) {
      if (this.matchesSignature(buffer, signature)) {
        return format;
      }
    }

    return null;
  }

  matchesSignature(buffer, signature) {
    if (buffer.length < signature.length) return false;
    
    for (let i = 0; i < signature.length; i++) {
      if (buffer[i] !== signature[i]) return false;
    }
    
    return true;
  }

  formatToMimeType(format) {
    const mimeTypes = {
      'JPEG': 'image/jpeg',
      'PNG': 'image/png',
      'GIF': 'image/gif',
      'WebP': 'image/webp',
      'BMP': 'image/bmp',
      'TIFF_LE': 'image/tiff',
      'TIFF_BE': 'image/tiff',
    };

    return mimeTypes[format] || 'application/octet-stream';
  }

  detectPolyglotFile(buffer) {
    const formats = [];
    
    // Check for multiple valid format signatures
    if (this.matchesSignature(buffer, [0xFF, 0xD8, 0xFF])) formats.push('JPEG');
    if (this.matchesSignature(buffer, [0x89, 0x50, 0x4E, 0x47])) formats.push('PNG');
    if (this.matchesSignature(buffer, [0x50, 0x4B, 0x03, 0x04])) formats.push('ZIP');
    if (this.matchesSignature(buffer, [0x4D, 0x5A])) formats.push('EXE');
    
    return {
      isPolyglot: formats.length > 1,
      formats,
    };
  }

  analyzeEntropy(buffer) {
    // Calculate Shannon entropy
    const frequencies = new Array(256).fill(0);
    
    for (let i = 0; i < buffer.length; i++) {
      frequencies[buffer[i]]++;
    }
    
    let entropy = 0;
    for (let i = 0; i < 256; i++) {
      if (frequencies[i] > 0) {
        const probability = frequencies[i] / buffer.length;
        entropy -= probability * Math.log2(probability);
      }
    }
    
    // High entropy might indicate encrypted/compressed data
    const suspiciousScore = entropy > 7.5 ? (entropy - 7.5) / 0.5 : 0;
    
    return {
      entropy,
      suspiciousScore: Math.min(1, suspiciousScore),
    };
  }

  analyzeLSB(buffer) {
    // Analyze least significant bits for randomness
    const lsbBits = [];
    
    for (let i = 0; i < Math.min(buffer.length, 10000); i++) {
      lsbBits.push(buffer[i] & 1);
    }
    
    // Calculate chi-square test for randomness
    const ones = lsbBits.filter(bit => bit === 1).length;
    const zeros = lsbBits.length - ones;
    const expected = lsbBits.length / 2;
    
    const chiSquare = Math.pow(ones - expected, 2) / expected + 
                     Math.pow(zeros - expected, 2) / expected;
    
    // Higher chi-square indicates more randomness (potential steganography)
    const suspiciousScore = chiSquare > 10 ? Math.min(1, (chiSquare - 10) / 20) : 0;
    
    return {
      chiSquare,
      suspiciousScore,
    };
  }

  analyzeFrequencyDomain(buffer) {
    // Simplified frequency analysis
    // In a real implementation, you'd use FFT
    const blockSize = 64;
    let anomalies = 0;
    
    for (let i = 0; i < buffer.length - blockSize; i += blockSize) {
      const block = buffer.slice(i, i + blockSize);
      const variance = this.calculateVariance(Array.from(block));
      
      // Unusual variance might indicate hidden data
      if (variance < 10 || variance > 1000) {
        anomalies++;
      }
    }
    
    const anomalyRate = anomalies / Math.floor(buffer.length / blockSize);
    const suspiciousScore = anomalyRate > 0.1 ? Math.min(1, anomalyRate * 5) : 0;
    
    return {
      anomalyRate,
      suspiciousScore,
    };
  }

  analyzePixelPatterns(buffer) {
    // Look for unusual pixel patterns
    let patternScore = 0;
    const sampleSize = Math.min(buffer.length, 1000);
    
    for (let i = 0; i < sampleSize - 1; i++) {
      const diff = Math.abs(buffer[i] - buffer[i + 1]);
      if (diff === 1) patternScore++; // Sequential values might indicate steganography
    }
    
    const suspiciousScore = (patternScore / sampleSize) > 0.3 ? 
                           Math.min(1, (patternScore / sampleSize) * 2) : 0;
    
    return {
      patternScore: patternScore / sampleSize,
      suspiciousScore,
    };
  }

  calculateVariance(values) {
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
    return squaredDiffs.reduce((sum, val) => sum + val, 0) / values.length;
  }

  containsSuspiciousData(buffer) {
    const suspicious = [
      /eval\s*\(/gi,
      /exec\s*\(/gi,
      /system\s*\(/gi,
      /<script/gi,
      /javascript:/gi,
      /vbscript:/gi,
    ];
    
    const text = buffer.toString('utf8');
    return suspicious.some(pattern => pattern.test(text));
  }

  calculateOverallRisk(scanResult) {
    if (scanResult.threats.length > 0) return 'high';
    if (scanResult.steganographyRisk === 'high' || scanResult.malwareRisk === 'high') return 'high';
    if (scanResult.steganographyRisk === 'medium' || scanResult.malwareRisk === 'medium') return 'medium';
    if (scanResult.warnings.length > 3) return 'medium';
    return 'low';
  }

  // Placeholder methods for format-specific parsing
  // In a real implementation, these would use proper image parsing libraries

  parseJPEGSections(buffer) { return []; }
  parsePNGChunks(buffer) { return []; }
  parseGIFData(buffer) { return {}; }
  parseWebPData(buffer) { return {}; }
  parseBMPHeader(buffer) { return {}; }
  parseTIFFTags(buffer) { return []; }
  isKnownPNGChunk(type) { return true; }
  extractDimensions(buffer) { return null; }
  analyzeMetadata(buffer, contentType) { return { suspicious: false, warnings: [] }; }
  detectEmbeddedFiles(buffer) { return []; }
  analyzeSizeAnomalies(buffer, metadata) { return { suspicious: false }; }
}

// Create singleton instance
const imageSecurityScanner = new ImageSecurityScanner();

module.exports = {
  ImageSecurityScanner,
  imageSecurityScanner,
};