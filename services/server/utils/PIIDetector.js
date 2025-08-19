const crypto = require('crypto');

/**
 * Comprehensive PII (Personally Identifiable Information) detection and masking system
 * Supports both text content and image OCR text analysis
 */
class PIIDetector {
  constructor() {
    // PII detection patterns with confidence levels
    this.piiPatterns = {
      // Email addresses
      email: {
        pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
        confidence: 0.95,
        category: 'contact',
        severity: 'medium',
      },
      
      // Phone numbers (various formats)
      phone: {
        pattern: /(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})\b/g,
        confidence: 0.90,
        category: 'contact',
        severity: 'medium',
      },
      
      // Social Security Numbers (US)
      ssn: {
        pattern: /\b(?!000|666|9\d{2})\d{3}[-\s]?(?!00)\d{2}[-\s]?(?!0000)\d{4}\b/g,
        confidence: 0.98,
        category: 'government_id',
        severity: 'high',
      },
      
      // Credit card numbers (basic Luhn algorithm check)
      creditCard: {
        pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|3[0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g,
        confidence: 0.85,
        category: 'financial',
        severity: 'high',
      },
      
      // Driver's license (US format variations)
      driversLicense: {
        pattern: /\b[A-Z]{1,2}[0-9]{6,8}\b|\b[0-9]{8,9}\b/g,
        confidence: 0.60,
        category: 'government_id',
        severity: 'medium',
      },
      
      // Passport numbers (US format)
      passport: {
        pattern: /\b[0-9]{9}\b/g,
        confidence: 0.50,
        category: 'government_id',
        severity: 'high',
      },
      
      // IP addresses
      ipAddress: {
        pattern: /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g,
        confidence: 0.80,
        category: 'network',
        severity: 'low',
      },
      
      // MAC addresses
      macAddress: {
        pattern: /\b([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})\b/g,
        confidence: 0.90,
        category: 'network',
        severity: 'low',
      },
      
      // API keys and tokens (generic patterns)
      apiKey: {
        pattern: /(?:api[_-]?key|access[_-]?token|secret[_-]?key)\s*[:=]\s*['"]?([a-zA-Z0-9_-]{20,})['"]?/gi,
        confidence: 0.85,
        category: 'credentials',
        severity: 'high',
      },
      
      // AWS Access Keys
      awsAccessKey: {
        pattern: /\bAKIA[0-9A-Z]{16}\b/g,
        confidence: 0.95,
        category: 'credentials',
        severity: 'high',
      },
      
      // JWT tokens
      jwtToken: {
        pattern: /\beyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*\b/g,
        confidence: 0.90,
        category: 'credentials',
        severity: 'high',
      },
      
      // Private keys
      privateKey: {
        pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+)?PRIVATE\s+KEY-----/gi,
        confidence: 0.99,
        category: 'credentials',
        severity: 'critical',
      },
      
      // Addresses (basic pattern)
      address: {
        pattern: /\b\d+\s+[A-Za-z0-9\s,.-]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Place|Pl)\b/gi,
        confidence: 0.70,
        category: 'location',
        severity: 'medium',
      },
      
      // Names (common patterns - lower confidence due to false positives)
      name: {
        pattern: /\b[A-Z][a-z]+ [A-Z][a-z]+\b/g,
        confidence: 0.40,
        category: 'personal',
        severity: 'medium',
      },
      
      // Date of birth patterns
      dateOfBirth: {
        pattern: /\b(?:0[1-9]|1[0-2])[-/](?:0[1-9]|[12][0-9]|3[01])[-/](?:19|20)\d{2}\b/g,
        confidence: 0.60,
        category: 'personal',
        severity: 'medium',
      },
      
      // Bank account numbers (basic pattern)
      bankAccount: {
        pattern: /\b[0-9]{8,17}\b/g,
        confidence: 0.30,
        category: 'financial',
        severity: 'high',
      },
      
      // Medical record numbers
      medicalRecord: {
        pattern: /\b(?:MRN|MR|Medical Record)[\s#:]*([0-9]{6,10})\b/gi,
        confidence: 0.80,
        category: 'medical',
        severity: 'high',
      },
    };

    // Context-based detection rules
    this.contextRules = {
      // Look for PII in specific contexts
      formFields: [
        'name', 'email', 'phone', 'address', 'ssn', 'social', 'dob', 'birth',
        'credit', 'card', 'account', 'license', 'passport', 'medical',
      ],
      
      // Sensitive file types that commonly contain PII
      sensitiveFileTypes: [
        'application/pdf', 'text/csv', 'application/json',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ],
    };

    // Masking strategies
    this.maskingStrategies = {
      full: (text) => '*'.repeat(text.length),
      partial: (text) => {
        if (text.length <= 4) return '*'.repeat(text.length);
        return text.substring(0, 2) + '*'.repeat(text.length - 4) + text.substring(text.length - 2);
      },
      hash: (text) => crypto.createHash('sha256').update(text).digest('hex').substring(0, 8),
      preserve: (text) => text, // Keep original for low-risk PII
    };
  }

  /**
   * Main PII detection method for text content
   */
  async detectPII(content, options = {}) {
    const {
      contentType = 'text/plain',
      filename = '',
      maskingLevel = 'medium', // low, medium, high
      includeContext = true,
    } = options;

    const results = {
      hasPII: false,
      detections: [],
      maskedContent: content,
      riskLevel: 'low',
      summary: {
        totalDetections: 0,
        categoryCounts: {},
        severityCounts: {},
      },
    };

    try {
      // Skip detection for binary content
      if (this.isBinaryContent(content)) {
        return results;
      }

      // Convert content to string if it's a buffer
      const textContent = Buffer.isBuffer(content) ? content.toString('utf8') : content;

      // Detect PII patterns
      const detections = this.detectPIIPatterns(textContent);
      
      // Add context-based detections
      if (includeContext) {
        const contextDetections = this.detectContextualPII(textContent, contentType, filename);
        detections.push(...contextDetections);
      }

      // Filter and score detections
      const validDetections = this.filterAndScoreDetections(detections, textContent);

      // Apply masking
      const maskedContent = this.applyMasking(textContent, validDetections, maskingLevel);

      // Calculate risk level
      const riskLevel = this.calculateRiskLevel(validDetections);

      // Generate summary
      const summary = this.generateSummary(validDetections);

      return {
        hasPII: validDetections.length > 0,
        detections: validDetections,
        maskedContent,
        riskLevel,
        summary,
      };

    } catch (error) {
      console.error('PII detection failed:', error);
      return {
        ...results,
        error: error.message,
      };
    }
  }

  /**
   * Detect PII in image OCR text
   */
  async detectPIIInImage(ocrText, imageMetadata = {}) {
    const options = {
      contentType: 'image/ocr',
      filename: imageMetadata.filename || '',
      maskingLevel: 'high', // More aggressive masking for images
      includeContext: true,
    };

    const piiResults = await this.detectPII(ocrText, options);

    // Add image-specific context
    if (piiResults.hasPII) {
      piiResults.imageContext = {
        hasScreenshot: this.isLikelyScreenshot(imageMetadata),
        hasDocument: this.isLikelyDocument(imageMetadata),
        hasForm: this.isLikelyForm(ocrText),
      };
    }

    return piiResults;
  }

  /**
   * Detect PII patterns using regex
   */
  detectPIIPatterns(content) {
    const detections = [];

    Object.entries(this.piiPatterns).forEach(([type, config]) => {
      const matches = content.matchAll(config.pattern);
      
      for (const match of matches) {
        detections.push({
          type,
          value: match[0],
          index: match.index,
          length: match[0].length,
          confidence: config.confidence,
          category: config.category,
          severity: config.severity,
          context: this.extractContext(content, match.index, match[0].length),
        });
      }
    });

    return detections;
  }

  /**
   * Detect contextual PII based on surrounding text
   */
  detectContextualPII(content, contentType, filename) {
    const detections = [];
    const lines = content.split('\n');

    // Look for form-like structures
    lines.forEach((line, lineIndex) => {
      this.contextRules.formFields.forEach(fieldName => {
        const fieldPattern = new RegExp(`\\b${fieldName}\\s*[:=]\\s*([^\\n\\r,;]+)`, 'gi');
        const matches = line.matchAll(fieldPattern);
        
        for (const match of matches) {
          const value = match[1].trim();
          if (value && value.length > 2) {
            detections.push({
              type: 'contextual_pii',
              value,
              index: content.indexOf(line) + match.index,
              length: value.length,
              confidence: 0.70,
              category: 'contextual',
              severity: 'medium',
              context: {
                fieldName,
                line: lineIndex + 1,
                surrounding: line,
              },
            });
          }
        }
      });
    });

    return detections;
  }

  /**
   * Filter and score detections to reduce false positives
   */
  filterAndScoreDetections(detections, content) {
    return detections
      .filter(detection => {
        // Filter out obvious false positives
        if (detection.type === 'name' && this.isCommonWord(detection.value)) {
          return false;
        }
        
        if (detection.type === 'ipAddress' && this.isPrivateIP(detection.value)) {
          detection.severity = 'low'; // Private IPs are less sensitive
        }
        
        if (detection.type === 'creditCard' && !this.isValidCreditCard(detection.value)) {
          return false;
        }
        
        return detection.confidence > 0.3; // Minimum confidence threshold
      })
      .map(detection => {
        // Adjust confidence based on context
        if (detection.context && detection.context.fieldName) {
          detection.confidence = Math.min(0.95, detection.confidence + 0.2);
        }
        
        return detection;
      })
      .sort((a, b) => b.confidence - a.confidence); // Sort by confidence
  }

  /**
   * Apply masking based on detection results and masking level
   */
  applyMasking(content, detections, maskingLevel) {
    if (detections.length === 0) {
      return content;
    }

    let maskedContent = content;
    const maskingThresholds = {
      low: { confidence: 0.8, severities: ['critical', 'high'] },
      medium: { confidence: 0.6, severities: ['critical', 'high', 'medium'] },
      high: { confidence: 0.3, severities: ['critical', 'high', 'medium', 'low'] },
    };

    const threshold = maskingThresholds[maskingLevel];
    
    // Sort detections by index in reverse order to maintain positions during replacement
    const sortedDetections = [...detections]
      .filter(d => d.confidence >= threshold.confidence && threshold.severities.includes(d.severity))
      .sort((a, b) => b.index - a.index);

    sortedDetections.forEach(detection => {
      const strategy = this.getMaskingStrategy(detection.severity, detection.category);
      const maskedValue = this.maskingStrategies[strategy](detection.value);
      
      maskedContent = maskedContent.substring(0, detection.index)
                    + maskedValue
                    + maskedContent.substring(detection.index + detection.length);
    });

    return maskedContent;
  }

  /**
   * Calculate overall risk level based on detections
   */
  calculateRiskLevel(detections) {
    if (detections.length === 0) return 'low';

    const criticalCount = detections.filter(d => d.severity === 'critical').length;
    const highCount = detections.filter(d => d.severity === 'high').length;
    const mediumCount = detections.filter(d => d.severity === 'medium').length;

    if (criticalCount > 0 || highCount > 3) return 'critical';
    if (highCount > 0 || mediumCount > 5) return 'high';
    if (mediumCount > 0 || detections.length > 10) return 'medium';
    
    return 'low';
  }

  /**
   * Generate detection summary
   */
  generateSummary(detections) {
    const summary = {
      totalDetections: detections.length,
      categoryCounts: {},
      severityCounts: {},
      typesCounts: {},
    };

    detections.forEach(detection => {
      summary.categoryCounts[detection.category] = (summary.categoryCounts[detection.category] || 0) + 1;
      summary.severityCounts[detection.severity] = (summary.severityCounts[detection.severity] || 0) + 1;
      summary.typesCounts[detection.type] = (summary.typesCounts[detection.type] || 0) + 1;
    });

    return summary;
  }

  /**
   * Helper methods
   */

  isBinaryContent(content) {
    if (Buffer.isBuffer(content)) {
      // Check for null bytes which indicate binary content
      return content.includes(0);
    }
    
    if (typeof content === 'string') {
      return content.includes('\x00');
    }
    
    return false;
  }

  extractContext(content, index, length, contextSize = 50) {
    const start = Math.max(0, index - contextSize);
    const end = Math.min(content.length, index + length + contextSize);
    
    return {
      before: content.substring(start, index),
      after: content.substring(index + length, end),
      full: content.substring(start, end),
    };
  }

  isCommonWord(word) {
    const commonWords = [
      'John Doe', 'Jane Doe', 'Test User', 'Admin User', 'Sample Name',
      'First Last', 'Your Name', 'User Name', 'Full Name',
    ];
    
    return commonWords.some(common => 
      word.toLowerCase().includes(common.toLowerCase())
    );
  }

  isPrivateIP(ip) {
    const privateRanges = [
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[01])\./,
      /^192\.168\./,
      /^127\./,
    ];
    
    return privateRanges.some(range => range.test(ip));
  }

  isValidCreditCard(number) {
    // Basic Luhn algorithm check
    const digits = number.replace(/\D/g, '');
    
    // Must be at least 13 digits
    if (digits.length < 13) return false;
    
    let sum = 0;
    let isEven = false;
    
    for (let i = digits.length - 1; i >= 0; i--) {
      let digit = parseInt(digits[i], 10);
      
      if (isEven) {
        digit *= 2;
        if (digit > 9) {
          digit -= 9;
        }
      }
      
      sum += digit;
      isEven = !isEven;
    }
    
    return sum % 10 === 0 && digits.length >= 13;
  }

  getMaskingStrategy(severity, category) {
    if (severity === 'critical') return 'full';
    if (severity === 'high' && category === 'credentials') return 'full';
    if (severity === 'high') return 'hash';
    if (severity === 'medium') return 'partial';
    return 'preserve';
  }

  isLikelyScreenshot(metadata) {
    const { width, height, filename } = metadata;
    
    // Common screenshot dimensions and naming patterns
    const screenshotPatterns = [
      /screenshot/i,
      /screen[_-]?shot/i,
      /capture/i,
      /snap/i,
    ];
    
    const hasScreenshotName = filename && screenshotPatterns.some(pattern => pattern.test(filename));
    const hasScreenshotDimensions = width && height && (
      (width === 1920 && height === 1080)
      || (width === 1366 && height === 768)
      || (width === 1440 && height === 900)
      || (width > 800 && height > 600 && width / height > 1.2)
    );
    
    return hasScreenshotName || hasScreenshotDimensions;
  }

  isLikelyDocument(metadata) {
    const { width, height, filename } = metadata;
    
    const documentPatterns = [
      /document/i,
      /form/i,
      /report/i,
      /invoice/i,
      /receipt/i,
    ];
    
    const hasDocumentName = filename && documentPatterns.some(pattern => pattern.test(filename));
    const hasDocumentDimensions = width && height && (
      height > width // Portrait orientation
      || (width / height < 1.5) // Square-ish aspect ratio
    );
    
    return hasDocumentName || hasDocumentDimensions;
  }

  isLikelyForm(ocrText) {
    const formIndicators = [
      /name\s*:/i,
      /address\s*:/i,
      /phone\s*:/i,
      /email\s*:/i,
      /date\s*:/i,
      /signature\s*:/i,
      /\[\s*\]/g, // Checkboxes
      /___+/g, // Fill-in lines
    ];
    
    const indicatorCount = formIndicators.reduce((count, pattern) => {
      return count + (ocrText.match(pattern) || []).length;
    }, 0);
    
    return indicatorCount >= 2;
  }
}

// Create singleton instance
const piiDetector = new PIIDetector();

module.exports = {
  PIIDetector,
  piiDetector,
};