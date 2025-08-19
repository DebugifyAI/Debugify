const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');

/**
 * Enhanced file validation service with comprehensive security checks
 */
class FileValidator {
  constructor() {
    // Supported file types with their MIME types and magic numbers
    this.allowedTypes = {
      // Text files
      'text/plain': { extensions: ['.txt', '.log'], magicNumbers: [] },
      'application/json': { extensions: ['.json'], magicNumbers: [] },
      'text/csv': { extensions: ['.csv'], magicNumbers: [] },
      // Documents
      'application/pdf': { extensions: ['.pdf'], magicNumbers: ['25504446'] }, // %PDF
      'application/msword': { extensions: ['.doc'], magicNumbers: ['d0cf11e0'] },
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
        extensions: ['.docx'],
        magicNumbers: ['504b0304'],
      },
      // Images
      'image/jpeg': { extensions: ['.jpg', '.jpeg'], magicNumbers: ['ffd8ff'] },
      'image/png': { extensions: ['.png'], magicNumbers: ['89504e47'] },
      'image/gif': { extensions: ['.gif'], magicNumbers: ['474946'] },
      'image/webp': { extensions: ['.webp'], magicNumbers: ['52494646'] },
      'image/bmp': { extensions: ['.bmp'], magicNumbers: ['424d'] },
      'image/tiff': { extensions: ['.tiff', '.tif'], magicNumbers: ['49492a00', '4d4d002a'] },
      // Archives
      'application/zip': { extensions: ['.zip'], magicNumbers: ['504b0304'] },
      'application/x-tar': { extensions: ['.tar'], magicNumbers: [] },
      'application/gzip': { extensions: ['.gz'], magicNumbers: ['1f8b'] },
      // Code files
      'text/javascript': { extensions: ['.js'], magicNumbers: [] },
      'text/typescript': { extensions: ['.ts'], magicNumbers: [] },
      'text/x-python': { extensions: ['.py'], magicNumbers: [] },
      'text/html': { extensions: ['.html', '.htm'], magicNumbers: [] },
      'text/css': { extensions: ['.css'], magicNumbers: [] },
      // Additional formats for enhanced support
      'application/xml': { extensions: ['.xml'], magicNumbers: [] },
      'text/xml': { extensions: ['.xml'], magicNumbers: [] },
      'application/yaml': { extensions: ['.yml', '.yaml'], magicNumbers: [] },
      'text/yaml': { extensions: ['.yml', '.yaml'], magicNumbers: [] },
      'application/x-sh': { extensions: ['.sh'], magicNumbers: [] },
      'text/x-shellscript': { extensions: ['.sh'], magicNumbers: [] }
    };

    // Maximum file sizes by type (in bytes)
    this.maxFileSizes = {
      'text/plain': 100 * 1024 * 1024, // 100MB for logs
      'application/json': 50 * 1024 * 1024, // 50MB for JSON
      'application/pdf': 50 * 1024 * 1024, // 50MB for PDFs
      'image/jpeg': 20 * 1024 * 1024, // 20MB for images
      'image/png': 20 * 1024 * 1024,
      'image/gif': 10 * 1024 * 1024,
      'image/webp': 20 * 1024 * 1024,
      'image/bmp': 50 * 1024 * 1024,
      'image/tiff': 50 * 1024 * 1024,
      'application/zip': 100 * 1024 * 1024, // 100MB for archives
      'application/xml': 10 * 1024 * 1024, // 10MB for XML
      'text/xml': 10 * 1024 * 1024,
      'application/yaml': 5 * 1024 * 1024, // 5MB for YAML
      'text/yaml': 5 * 1024 * 1024,
      'application/x-sh': 1 * 1024 * 1024, // 1MB for shell scripts
      'text/x-shellscript': 1 * 1024 * 1024,
      default: 10 * 1024 * 1024, // 10MB default
    };

    // Image dimension limits
    this.imageLimits = {
      maxWidth: 10000,
      maxHeight: 10000,
      minWidth: 1,
      minHeight: 1,
    };

    // Sensitive data patterns to detect
    this.sensitivePatterns = [
      // API Keys and tokens
      /(?:api[_-]?key|access[_-]?token|secret[_-]?key|private[_-]?key)\s*[:=]\s*['"]?([a-zA-Z0-9_-]{20,})['"]?/gi,
      // AWS credentials
      /AKIA[0-9A-Z]{16}/g, // AWS Access Key ID
      /(?:aws[_-]?secret[_-]?access[_-]?key)\s*[:=]\s*['"]?([a-zA-Z0-9/+=]{40})['"]?/gi,
      // Database connection strings
      /(?:mongodb|mysql|postgresql|postgres):\/\/[^\s]+/gi,
      // Email addresses (potential PII)
      /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
      // Credit card numbers (basic pattern)
      /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
      // Social Security Numbers (US format)
      /\b\d{3}-\d{2}-\d{4}\b/g,
      // Phone numbers
      /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,
      // JWT tokens
      /eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/g,
      // Private keys
      /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/gi,
      // Passwords in configuration
      /(?:password|passwd|pwd)\s*[:=]\s*['"]?([^\s'"]{8,})['"]?/gi
    ];

    // File entropy thresholds for detecting encrypted/compressed data
    this.entropyThresholds = {
      suspicious: 7.5, // High entropy might indicate encryption or compression
      critical: 7.8, // Very high entropy is highly suspicious
    };

    // Malicious patterns to detect
    this.maliciousPatterns = [
      // Script injection patterns
      /<script[^>]*>.*?<\/script>/gi,
      /javascript:/gi,
      /vbscript:/gi,
      /onload\s*=/gi,
      /onerror\s*=/gi,
      // SQL injection patterns
      /(\bUNION\b|\bSELECT\b|\bINSERT\b|\bDELETE\b|\bUPDATE\b|\bDROP\b).*?(\bFROM\b|\bINTO\b|\bWHERE\b)/gi,
      // Command injection patterns
      /(\||&|;|`|\$\(|\${)/g,
      // Path traversal patterns
      /\.\.[/\\]/g,
      // Executable signatures
      /MZ[\x00-\xFF]{58}PE/g, // PE executable
      /\x7fELF/g, // ELF executable
      // Suspicious URLs
      /https?:\/\/[^\s]+\.(exe|bat|cmd|scr|pif|com)/gi,
      // Additional malicious patterns
      /eval\s*\(/gi, // JavaScript eval
      /document\.write\s*\(/gi, // DOM manipulation
      /window\.location\s*=/gi, // Redirect attempts
      /base64_decode\s*\(/gi, // PHP base64 decode
      /system\s*\(/gi, // System command execution
      /exec\s*\(/gi, // Command execution
      /shell_exec\s*\(/gi, // Shell execution
      /passthru\s*\(/gi, // PHP passthru
      /file_get_contents\s*\(/gi, // File access
      /fopen\s*\(/gi, // File operations
      /curl_exec\s*\(/gi, // Network requests
      /fsockopen\s*\(/gi, // Socket operations
      // Obfuscation patterns
      /String\.fromCharCode\s*\(/gi, // Character code obfuscation
      /unescape\s*\(/gi, // URL unescape
      /decodeURIComponent\s*\(/gi, // URI decode
      /atob\s*\(/gi, // Base64 decode
      // Suspicious file extensions in content
      /\.(exe|bat|cmd|scr|pif|com|dll|sys|vbs|ps1|jar)["'\s]/gi,
    ];
  }

  /**
   * Main validation method that runs all security checks
   * @param {Object} artifact - Artifact object with file information
   * @param {Buffer} fileBuffer - File content buffer
   * @returns {Promise<Object>} Validation result
   */
  async validateFile(artifact, fileBuffer) {
    const validationResult = {
      isValid: true,
      errors: [],
      warnings: [],
      metadata: {},
    };

    try {
      // 1. File type validation
      const typeValidation = this.validateFileType(artifact);
      if (!typeValidation.isValid) {
        validationResult.isValid = false;
        validationResult.errors.push(...typeValidation.errors);
      }

      // 2. File size validation
      const sizeValidation = this.validateFileSize(artifact, fileBuffer);
      if (!sizeValidation.isValid) {
        validationResult.isValid = false;
        validationResult.errors.push(...sizeValidation.errors);
      }

      // 3. Content signature validation
      const signatureValidation = this.validateFileSignature(artifact, fileBuffer);
      if (!signatureValidation.isValid) {
        validationResult.isValid = false;
        validationResult.errors.push(...signatureValidation.errors);
      }

      // 4. Malicious pattern detection
      const patternValidation = await this.detectMaliciousPatterns(fileBuffer);
      if (!patternValidation.isValid) {
        validationResult.isValid = false;
        validationResult.errors.push(...patternValidation.errors);
      }
      validationResult.warnings.push(...patternValidation.warnings);

      // 5. Image-specific validation (if applicable)
      if (this.isImageFile(artifact.contentType)) {
        const imageValidation = await this.validateImage(fileBuffer);
        if (!imageValidation.isValid) {
          validationResult.isValid = false;
          validationResult.errors.push(...imageValidation.errors);
        }
        validationResult.metadata.imageInfo = imageValidation.metadata;
      }

      // 6. Sensitive data detection
      const sensitiveDataValidation = await this.detectSensitiveData(fileBuffer);
      validationResult.warnings.push(...sensitiveDataValidation.warnings);

      // 7. File entropy analysis
      const entropyValidation = this.analyzeFileEntropy(fileBuffer);
      validationResult.warnings.push(...entropyValidation.warnings);
      validationResult.metadata.entropy = entropyValidation.entropy;

      // 8. File hash calculation for integrity
      validationResult.metadata.fileHash = this.calculateFileHash(fileBuffer);

      // 9. Virus scanning (if ClamAV is available)
      const virusValidation = await this.scanForViruses(fileBuffer);
      if (!virusValidation.isValid) {
        validationResult.isValid = false;
        validationResult.errors.push(...virusValidation.errors);
      }

      return validationResult;
    } catch (error) {
      return {
        isValid: false,
        errors: [`Validation failed: ${error.message}`],
        warnings: [],
        metadata: {},
      };
    }
  }

  /**
   * Validate file type against allowlist
   */
  validateFileType(artifact) {
    const result = { isValid: true, errors: [] };
    const { contentType, filename } = artifact;
    const fileExtension = filename ? path.extname(filename).toLowerCase() : '';

    // Check if content type is allowed
    if (!this.allowedTypes[contentType]) {
      result.isValid = false;
      result.errors.push(`File type '${contentType}' is not allowed`);
      return result;
    }

    // Check if file extension matches content type (skip if no filename or no required extensions)
    const allowedExtensions = this.allowedTypes[contentType].extensions;
    const hasExtensionMismatch = allowedExtensions.length > 0 && filename
    && !allowedExtensions.includes(fileExtension);
    if (hasExtensionMismatch) {
      result.isValid = false;
      const message = `File extension '${fileExtension}' does not match content type '${contentType}'`;
      result.errors.push(message);
    }

    return result;
  }

  /**
   * Validate file size against limits
   */
  validateFileSize(artifact, fileBuffer) {
    const result = { isValid: true, errors: [] };
    const fileSize = fileBuffer.length;
    const maxSize = this.maxFileSizes[artifact.contentType] || this.maxFileSizes.default;

    if (fileSize > maxSize) {
      result.isValid = false;
      result.errors.push(`File size ${fileSize} bytes exceeds maximum allowed size of ${maxSize} bytes`);
    }

    if (fileSize === 0) {
      result.isValid = false;
      result.errors.push('File is empty');
    }

    return result;
  }

  /**
   * Validate file signature (magic numbers)
   */
  validateFileSignature(artifact, fileBuffer) {
    const result = { isValid: true, errors: [] };
    const contentType = artifact.contentType;
    const expectedMagicNumbers = this.allowedTypes[contentType]?.magicNumbers || [];

    // Skip validation if no magic numbers are defined for this type
    if (expectedMagicNumbers.length === 0) {
      return result;
    }

    // Get first 8 bytes as hex string
    const fileHeader = fileBuffer.slice(0, 8).toString('hex').toLowerCase();

    // Check if file header matches any expected magic number
    // eslint-disable-next-line max-len
    const hasValidSignature = expectedMagicNumbers.some((magic) => fileHeader.startsWith(magic.toLowerCase()));

    if (!hasValidSignature) {
      result.isValid = false;
      result.errors.push(`File signature does not match expected format for ${contentType}`);
    }

    return result;
  }

  /**
   * Detect malicious patterns in file content
   */
  async detectMaliciousPatterns(fileBuffer) {
    const result = { isValid: true, errors: [], warnings: [] };

    try {
      // Convert buffer to string for pattern matching (handle binary files gracefully)
      let content;
      try {
        content = fileBuffer.toString('utf8');
      } catch (error) {
        // If UTF-8 conversion fails, try latin1 for binary files
        content = fileBuffer.toString('latin1');
      }

      // Check for malicious patterns
      this.maliciousPatterns.forEach((pattern) => {
        const matches = content.match(pattern);
        if (matches) {
          // For some patterns, treat as error, others as warning
          if (this.isCriticalPattern(pattern)) {
            result.isValid = false;
            result.errors.push(`Detected potentially malicious content: ${matches[0].substring(0, 100)}`);
          } else {
            result.warnings.push(`Suspicious pattern detected: ${matches[0].substring(0, 50)}`);
          }
        }
      });

      // Check for suspicious file headers in text content
      if (content.includes('\x00') && content.length > 100) {
        result.warnings.push('File contains null bytes, may be binary data disguised as text');
      }
    } catch (error) {
      result.warnings.push(`Pattern detection failed: ${error.message}`);
    }

    return result;
  }

  /**
   * Validate image-specific properties
   */
  async validateImage(fileBuffer) {
    const result = { isValid: true, errors: [], warnings: [], metadata: {} };

    try {
      // Basic image validation - check if we can get dimensions
      const imageInfo = await this.getImageInfo(fileBuffer);
    
      if (!imageInfo) {
        result.isValid = false;
        result.errors.push('Invalid image format or corrupted image data');
        return result;
      }

      result.metadata = imageInfo;

      // Validate dimensions
      const exceedsMax = imageInfo.width > this.imageLimits.maxWidth || 
                        imageInfo.height > this.imageLimits.maxHeight;
      if (exceedsMax) {
        result.isValid = false;
        const maxDims = `${this.imageLimits.maxWidth}x${this.imageLimits.maxHeight}`;
        const currentDims = `${imageInfo.width}x${imageInfo.height}`;
        result.errors.push(`Image dimensions ${currentDims} exceed maximum allowed ${maxDims}`);
      }

      const belowMin = imageInfo.width < this.imageLimits.minWidth || 
                      imageInfo.height < this.imageLimits.minHeight;
      if (belowMin) {
        result.isValid = false;
        const minDims = `${this.imageLimits.minWidth}x${this.imageLimits.minHeight}`;
        const currentDims = `${imageInfo.width}x${imageInfo.height}`;
        result.errors.push(`Image dimensions ${currentDims} are below minimum required ${minDims}`);
      }

      // Check for suspicious aspect ratios (potential steganography)
      const aspectRatio = imageInfo.width / imageInfo.height;
      if (aspectRatio > 100 || aspectRatio < 0.01) {
        result.warnings.push('Unusual aspect ratio detected, may indicate data hiding');
      }
    } catch (error) {
      result.isValid = false;
      result.errors.push(`Image validation failed: ${error.message}`);
    }

    return result;
  }

  /**
   * Detect sensitive data patterns in file content
   */
  async detectSensitiveData(fileBuffer) {
    const result = { isValid: true, warnings: [] };
    try {
      // Convert buffer to string for pattern matching
      let content;
      try {
        content = fileBuffer.toString('utf8');
      } catch (error) {
        // Skip sensitive data detection for binary files
        return result;
      }

      // Check for sensitive patterns
      this.sensitivePatterns.forEach((pattern) => {
        const matches = content.match(pattern);
        if (matches) {
          matches.forEach((match) => {
            // Mask the sensitive data in the warning
            const maskedMatch = this.maskSensitiveData(match);
            result.warnings.push(`Potential sensitive data detected: ${maskedMatch}`);
          });
        }
      });
    } catch (error) {
      result.warnings.push(`Sensitive data detection failed: ${error.message}`);
    }

    return result;
  }

  /**
   * Analyze file entropy to detect encrypted or compressed data
   */
  analyzeFileEntropy(fileBuffer) {
    const result = { isValid: true, warnings: [], entropy: 0 };
    try {
      // Calculate Shannon entropy
      const entropy = this.calculateEntropy(fileBuffer);
      result.entropy = entropy;

      if (entropy > this.entropyThresholds.critical) {
        result.warnings.push(`Very high file entropy (${entropy.toFixed(2)}) - may indicate encrypted or highly compressed data`);
      } else if (entropy > this.entropyThresholds.suspicious) {
        result.warnings.push(`High file entropy (${entropy.toFixed(2)}) - may indicate compressed or obfuscated data`);
      }
    } catch (error) {
      result.warnings.push(`Entropy analysis failed: ${error.message}`);
    }

    return result;
  }

  /**
   * Calculate file hash for integrity verification
   */
  calculateFileHash(fileBuffer) {
    try {
      return crypto.createHash('sha256').update(fileBuffer).digest('hex');
    } catch (error) {
      console.warn('Failed to calculate file hash:', error.message);
      return null;
    }
  }

  /**
   * Enhanced virus scanning with multiple engines support
   */
  async scanForViruses(fileBuffer) {
    const result = { isValid: true, errors: [] };

    try {
      // Try ClamAV first
      const clamResult = await this.scanWithClamAV(fileBuffer);
      if (!clamResult.isValid) {
        result.isValid = false;
        result.errors.push(...clamResult.errors);
        return result;
      }

      // Could add additional virus scanners here in the future
      // e.g., Windows Defender, VirusTotal API, etc.

    } catch (error) {
      // Don't fail validation if virus scanning fails, but log the error
      console.error('Virus scanning failed:', error.message);
    }

    return result;
  }

  /**
   * Scan with ClamAV antivirus
   */
  async scanWithClamAV(fileBuffer) {
    const result = { isValid: true, errors: [] };

    try {
      // Check if ClamAV is available
      const clamAvailable = await this.isClamAvailable();
      
      if (!clamAvailable) {
        // ClamAV not available, skip virus scanning but log warning
        console.warn('ClamAV not available, skipping virus scan');
        return result;
      }

      // Write buffer to temporary file for scanning
      const tempFile = `/tmp/scan_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      await fs.writeFile(tempFile, fileBuffer);

      try {
        const scanResult = await this.runClamScan(tempFile);
        
        if (!scanResult.clean) {
          result.isValid = false;
          result.errors.push(`Virus detected: ${scanResult.threat || 'Unknown threat'}`);
        }
      } finally {
        // Clean up temporary file
        try {
          await fs.unlink(tempFile);
        } catch (cleanupError) {
          console.warn(`Failed to cleanup temp file ${tempFile}:`, cleanupError.message);
        }
      }

    } catch (error) {
      // Don't fail validation if virus scanning fails, but log the error
      console.error('ClamAV scanning failed:', error.message);
    }

    return result;
  }

  /**
   * Helper methods
   */

  isImageFile(contentType) {
    return contentType != null && contentType.startsWith('image/');
  }

  isCriticalPattern(pattern) {
    // Patterns that should cause validation failure vs warnings
    const criticalPatterns = [
      /MZ[\x00-\xFF]{58}PE/g, // PE executable
      /\x7fELF/g, // ELF executable
      /<script[^>]*>.*?<\/script>/gi, // Script injection
      /(\bUNION\b|\bSELECT\b|\bINSERT\b|\bDELETE\b|\bUPDATE\b|\bDROP\b).*?(\bFROM\b|\bINTO\b|\bWHERE\b)/gi // SQL injection
    ];
    
    return criticalPatterns.some((critical) => critical.toString() === pattern.toString());
  }

  /**
   * Mask sensitive data for logging/reporting
   */
  maskSensitiveData(data) {
    if (data.length <= 8) {
      return '*'.repeat(data.length);
    }
    
    const start = data.substring(0, 3);
    const end = data.substring(data.length - 3);
    const middle = '*'.repeat(Math.min(data.length - 6, 10));
    
    return `${start}${middle}${end}`;
  }

  /**
   * Calculate Shannon entropy of data
   */
  calculateEntropy(buffer) {
    const frequencies = new Array(256).fill(0);
    const length = buffer.length;
    
    // Count byte frequencies
    for (let i = 0; i < length; i++) {
      frequencies[buffer[i]]++;
    }
    
    // Calculate entropy
    let entropy = 0;
    for (let i = 0; i < 256; i++) {
      if (frequencies[i] > 0) {
        const probability = frequencies[i] / length;
        entropy -= probability * Math.log2(probability);
      }
    }
    
    return entropy;
  }

  async getImageInfo(fileBuffer) {
    // Basic image info extraction without external dependencies
    // This is a simplified version - in production, you'd use a library like 'sharp'
    
    try {
      if (fileBuffer.length < 24) {
        return null;
      }
      
      const header = fileBuffer.slice(0, 24);
      
      // PNG format - check for PNG signature and IHDR chunk
      if (header.slice(0, 8).toString('hex') === '89504e470d0a1a0a') {
        // Look for IHDR chunk which should be at offset 8
        if (fileBuffer.length >= 24 && fileBuffer.slice(12, 16).toString() === 'IHDR') {
          const width = fileBuffer.readUInt32BE(16);
          const height = fileBuffer.readUInt32BE(20);
          return { width, height, format: 'PNG' };
        }
      }
      
      // JPEG format (simplified)
      if (header.slice(0, 3).toString('hex') === 'ffd8ff') {
        // For JPEG, we'd need to parse the segments to find dimensions
        // This is a placeholder - real implementation would parse JPEG segments
        return { width: 0, height: 0, format: 'JPEG' };
      }
      
      // GIF format
      if (header.slice(0, 6).toString() === 'GIF87a' || header.slice(0, 6).toString() === 'GIF89a') {
        const width = header.readUInt16LE(6);
        const height = header.readUInt16LE(8);
        return { width, height, format: 'GIF' };
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }

  async isClamAvailable() {
    return new Promise((resolve) => {
      const child = spawn('which', ['clamscan']);
      child.on('close', (code) => {
        resolve(code === 0);
      });
      child.on('error', () => {
        resolve(false);
      });
    });
  }

  async runClamScan(filePath) {
    return new Promise((resolve, reject) => {
      const child = spawn('clamscan', ['--no-summary', filePath]);
      let output = '';
      let error = '';

      child.stdout.on('data', (data) => {
        output += data.toString();
      });

      child.stderr.on('data', (data) => {
        error += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve({ clean: true });
        } else if (code === 1) {
          // Virus found
          const threatMatch = output.match(/FOUND:\s*(.+)/);
          resolve({ 
            clean: false, 
            threat: threatMatch ? threatMatch[1].trim() : 'Unknown threat' 
          });
        } else {
          reject(new Error(`ClamAV scan failed: ${error || output}`));
        }
      });

      child.on('error', (err) => {
        reject(err);
      });
    });
  }
}

module.exports = FileValidator;