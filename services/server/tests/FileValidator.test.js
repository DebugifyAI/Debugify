const FileValidator = require('../helpers/FileValidator');

describe('FileValidator', () => {
  let validator;
  let mockArtifact;

  beforeEach(() => {
    validator = new FileValidator();
    mockArtifact = {
      filename: 'test.txt',
      contentType: 'text/plain',
      size: 1024
    };
  });

  describe('validateFileType', () => {
    test('should accept allowed file types', () => {
      const result = validator.validateFileType(mockArtifact);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('should reject disallowed file types', () => {
      mockArtifact.contentType = 'application/x-executable';
      const result = validator.validateFileType(mockArtifact);
      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain('not allowed');
    });

    test('should validate file extension matches content type', () => {
      mockArtifact.filename = 'test.jpg';
      mockArtifact.contentType = 'text/plain';
      const result = validator.validateFileType(mockArtifact);
      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain('does not match content type');
    });

    test('should accept matching extension and content type', () => {
      mockArtifact.filename = 'image.jpg';
      mockArtifact.contentType = 'image/jpeg';
      const result = validator.validateFileType(mockArtifact);
      expect(result.isValid).toBe(true);
    });
  });

  describe('validateFileSize', () => {
    test('should accept files within size limits', () => {
      const buffer = Buffer.alloc(1024); // 1KB
      const result = validator.validateFileSize(mockArtifact, buffer);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('should reject files exceeding size limits', () => {
      const buffer = Buffer.alloc(200 * 1024 * 1024); // 200MB
      const result = validator.validateFileSize(mockArtifact, buffer);
      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain('exceeds maximum allowed size');
    });

    test('should reject empty files', () => {
      const buffer = Buffer.alloc(0);
      const result = validator.validateFileSize(mockArtifact, buffer);
      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain('File is empty');
    });

    test('should use type-specific size limits', () => {
      mockArtifact.contentType = 'image/jpeg';
      const buffer = Buffer.alloc(25 * 1024 * 1024); // 25MB
      const result = validator.validateFileSize(mockArtifact, buffer);
      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain('exceeds maximum allowed size');
    });
  });

  describe('validateFileSignature', () => {
    test('should validate PNG signature', () => {
      mockArtifact.contentType = 'image/png';
      // PNG signature: 89 50 4E 47 0D 0A 1A 0A
      const buffer = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
      const result = validator.validateFileSignature(mockArtifact, buffer);
      expect(result.isValid).toBe(true);
    });

    test('should reject invalid PNG signature', () => {
      mockArtifact.contentType = 'image/png';
      const buffer = Buffer.from([0x00, 0x00, 0x00, 0x00]);
      const result = validator.validateFileSignature(mockArtifact, buffer);
      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain('File signature does not match');
    });

    test('should skip validation for types without magic numbers', () => {
      mockArtifact.contentType = 'text/plain';
      const buffer = Buffer.from('any content');
      const result = validator.validateFileSignature(mockArtifact, buffer);
      expect(result.isValid).toBe(true);
    });

    test('should validate PDF signature', () => {
      mockArtifact.contentType = 'application/pdf';
      const buffer = Buffer.from('%PDF-1.4\n');
      const result = validator.validateFileSignature(mockArtifact, buffer);
      expect(result.isValid).toBe(true);
    });

    test('should validate JPEG signature', () => {
      mockArtifact.contentType = 'image/jpeg';
      // JPEG signature: FF D8 FF
      const buffer = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]);
      const result = validator.validateFileSignature(mockArtifact, buffer);
      expect(result.isValid).toBe(true);
    });
  });

  describe('detectMaliciousPatterns', () => {
    test('should detect script injection patterns', async () => {
      const buffer = Buffer.from('<script>alert("xss")</script>');
      const result = await validator.detectMaliciousPatterns(buffer);
      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain('potentially malicious content');
    });

    test('should detect SQL injection patterns', async () => {
      const buffer = Buffer.from('SELECT * FROM users WHERE id = 1 UNION SELECT password FROM admin');
      const result = await validator.detectMaliciousPatterns(buffer);
      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain('potentially malicious content');
    });

    test('should detect command injection patterns', async () => {
      const buffer = Buffer.from('filename; rm -rf /');
      const result = await validator.detectMaliciousPatterns(buffer);
      expect(result.warnings[0]).toContain('Suspicious pattern detected');
    });

    test('should detect path traversal patterns', async () => {
      const buffer = Buffer.from('../../../etc/passwd');
      const result = await validator.detectMaliciousPatterns(buffer);
      expect(result.warnings[0]).toContain('Suspicious pattern detected');
    });

    test('should detect executable signatures', async () => {
      // Mock PE executable header
      const peHeader = Buffer.alloc(64);
      peHeader.write('MZ', 0); // DOS header
      peHeader.write('PE', 60); // PE signature position
      const result = await validator.detectMaliciousPatterns(peHeader);
      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain('potentially malicious content');
    });

    test('should handle binary files gracefully', async () => {
      const buffer = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xFF, 0xFE]);
      const result = await validator.detectMaliciousPatterns(buffer);
      // Should not throw error and should complete validation
      expect(result).toHaveProperty('isValid');
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('warnings');
    });

    test('should warn about null bytes in text content', async () => {
      const buffer = Buffer.from('normal text\x00hidden content with more than 100 chars to trigger the warning about binary data disguised as text');
      const result = await validator.detectMaliciousPatterns(buffer);
      expect(result.warnings.some(w => w.includes('null bytes'))).toBe(true);
    });
  });

  describe('validateImage', () => {
    test('should validate PNG image dimensions', async () => {
      // Create a minimal PNG header with IHDR chunk
      const pngBuffer = Buffer.alloc(33);
      // PNG signature: 89 50 4E 47 0D 0A 1A 0A
      pngBuffer[0] = 0x89; pngBuffer[1] = 0x50; pngBuffer[2] = 0x4E; pngBuffer[3] = 0x47;
      pngBuffer[4] = 0x0D; pngBuffer[5] = 0x0A; pngBuffer[6] = 0x1A; pngBuffer[7] = 0x0A;
      // IHDR chunk length (13 bytes)
      pngBuffer.writeUInt32BE(13, 8);
      // IHDR chunk type
      pngBuffer.write('IHDR', 12);
      // Width and height
      pngBuffer.writeUInt32BE(100, 16); // width
      pngBuffer.writeUInt32BE(200, 20); // height

      const result = await validator.validateImage(pngBuffer);
      expect(result.isValid).toBe(true);
      expect(result.metadata.width).toBe(100);
      expect(result.metadata.height).toBe(200);
      expect(result.metadata.format).toBe('PNG');
    });

    test('should validate GIF image dimensions', async () => {
      // Create a minimal GIF header
      const gifHeader = Buffer.alloc(24);
      gifHeader.write('GIF89a', 0); // GIF signature
      gifHeader.writeUInt16LE(150, 6); // width (little endian)
      gifHeader.writeUInt16LE(100, 8); // height (little endian)

      const result = await validator.validateImage(gifHeader);
      expect(result.isValid).toBe(true);
      expect(result.metadata.width).toBe(150);
      expect(result.metadata.height).toBe(100);
      expect(result.metadata.format).toBe('GIF');
    });

    test('should reject images exceeding dimension limits', async () => {
      // Create PNG with oversized dimensions
      const pngBuffer = Buffer.alloc(33);
      pngBuffer[0] = 0x89; pngBuffer[1] = 0x50; pngBuffer[2] = 0x4E; pngBuffer[3] = 0x47;
      pngBuffer[4] = 0x0D; pngBuffer[5] = 0x0A; pngBuffer[6] = 0x1A; pngBuffer[7] = 0x0A;
      pngBuffer.writeUInt32BE(13, 8);
      pngBuffer.write('IHDR', 12);
      pngBuffer.writeUInt32BE(15000, 16); // width > maxWidth
      pngBuffer.writeUInt32BE(200, 20); // height

      const result = await validator.validateImage(pngBuffer);
      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain('exceed maximum allowed');
    });

    test('should reject images below minimum dimensions', async () => {
      const pngBuffer = Buffer.alloc(33);
      pngBuffer[0] = 0x89; pngBuffer[1] = 0x50; pngBuffer[2] = 0x4E; pngBuffer[3] = 0x47;
      pngBuffer[4] = 0x0D; pngBuffer[5] = 0x0A; pngBuffer[6] = 0x1A; pngBuffer[7] = 0x0A;
      pngBuffer.writeUInt32BE(13, 8);
      pngBuffer.write('IHDR', 12);
      pngBuffer.writeUInt32BE(0, 16); // width = 0
      pngBuffer.writeUInt32BE(100, 20); // height

      const result = await validator.validateImage(pngBuffer);
      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain('below minimum required');
    });

    test('should warn about unusual aspect ratios', async () => {
      const pngBuffer = Buffer.alloc(33);
      pngBuffer[0] = 0x89; pngBuffer[1] = 0x50; pngBuffer[2] = 0x4E; pngBuffer[3] = 0x47;
      pngBuffer[4] = 0x0D; pngBuffer[5] = 0x0A; pngBuffer[6] = 0x1A; pngBuffer[7] = 0x0A;
      pngBuffer.writeUInt32BE(13, 8);
      pngBuffer.write('IHDR', 12);
      pngBuffer.writeUInt32BE(10000, 16); // width
      pngBuffer.writeUInt32BE(1, 20); // height (aspect ratio = 10000)

      const result = await validator.validateImage(pngBuffer);
      expect(result.warnings.some(w => w.includes('Unusual aspect ratio'))).toBe(true);
    });

    test('should handle invalid image data', async () => {
      const invalidBuffer = Buffer.from('not an image');
      const result = await validator.validateImage(invalidBuffer);
      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain('Invalid image format');
    });
  });

  describe('isImageFile', () => {
    test('should identify image content types', () => {
      expect(validator.isImageFile('image/jpeg')).toBe(true);
      expect(validator.isImageFile('image/png')).toBe(true);
      expect(validator.isImageFile('image/gif')).toBe(true);
      expect(validator.isImageFile('text/plain')).toBe(false);
      expect(validator.isImageFile('application/pdf')).toBe(false);
    });

    test('should handle null/undefined content types', () => {
      expect(validator.isImageFile(null)).toBe(false);
      expect(validator.isImageFile(undefined)).toBe(false);
      expect(validator.isImageFile('')).toBe(false);
    });
  });

  describe('isCriticalPattern', () => {
    test('should identify critical patterns', () => {
      const pePattern = /MZ[\x00-\xFF]{58}PE/g;
      const elfPattern = /\x7fELF/g;
      const scriptPattern = /<script[^>]*>.*?<\/script>/gi;
      const pathPattern = /\.\.[/\\]/g;

      expect(validator.isCriticalPattern(pePattern)).toBe(true);
      expect(validator.isCriticalPattern(elfPattern)).toBe(true);
      expect(validator.isCriticalPattern(scriptPattern)).toBe(true);
      expect(validator.isCriticalPattern(pathPattern)).toBe(false);
    });
  });

  describe('getImageInfo', () => {
    test('should extract PNG image info', async () => {
      const pngBuffer = Buffer.alloc(33);
      pngBuffer[0] = 0x89; pngBuffer[1] = 0x50; pngBuffer[2] = 0x4E; pngBuffer[3] = 0x47;
      pngBuffer[4] = 0x0D; pngBuffer[5] = 0x0A; pngBuffer[6] = 0x1A; pngBuffer[7] = 0x0A;
      pngBuffer.writeUInt32BE(13, 8);
      pngBuffer.write('IHDR', 12);
      pngBuffer.writeUInt32BE(640, 16);
      pngBuffer.writeUInt32BE(480, 20);

      const info = await validator.getImageInfo(pngBuffer);
      expect(info).toEqual({
        width: 640,
        height: 480,
        format: 'PNG'
      });
    });

    test('should extract GIF image info', async () => {
      const gifHeader = Buffer.alloc(24);
      gifHeader.write('GIF89a', 0);
      gifHeader.writeUInt16LE(320, 6);
      gifHeader.writeUInt16LE(240, 8);

      const info = await validator.getImageInfo(gifHeader);
      expect(info).toEqual({
        width: 320,
        height: 240,
        format: 'GIF'
      });
    });

    test('should return null for invalid image data', async () => {
      const invalidBuffer = Buffer.from('invalid image data');
      const info = await validator.getImageInfo(invalidBuffer);
      expect(info).toBeNull();
    });

    test('should handle buffer read errors gracefully', async () => {
      const shortBuffer = Buffer.alloc(5); // Too short for image header
      const info = await validator.getImageInfo(shortBuffer);
      expect(info).toBeNull();
    });
  });

  describe('validateFile - integration tests', () => {
    test('should validate a valid text file', async () => {
      const buffer = Buffer.from('This is a valid log file content\nwith multiple lines\nand normal text');
      const result = await validator.validateFile(mockArtifact, buffer);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('should reject a file with multiple validation failures', async () => {
      mockArtifact.contentType = 'application/x-executable'; // Invalid type
      const buffer = Buffer.alloc(200 * 1024 * 1024); // Too large
      buffer.write('<script>alert("xss")</script>', 0); // Malicious content

      const result = await validator.validateFile(mockArtifact, buffer);

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(1);
    });

    test('should validate image files with image-specific checks', async () => {
      mockArtifact.contentType = 'image/png';
      mockArtifact.filename = 'test.png';

      const pngBuffer = Buffer.alloc(1024);
      pngBuffer[0] = 0x89; pngBuffer[1] = 0x50; pngBuffer[2] = 0x4E; pngBuffer[3] = 0x47;
      pngBuffer[4] = 0x0D; pngBuffer[5] = 0x0A; pngBuffer[6] = 0x1A; pngBuffer[7] = 0x0A;
      pngBuffer.writeUInt32BE(13, 8); // IHDR length
      pngBuffer.write('IHDR', 12); // IHDR chunk type
      pngBuffer.writeUInt32BE(640, 16); // width
      pngBuffer.writeUInt32BE(480, 20); // height

      const result = await validator.validateFile(mockArtifact, pngBuffer);

      expect(result.isValid).toBe(true);
      expect(result.metadata.imageInfo).toBeDefined();
      expect(result.metadata.imageInfo.width).toBe(640);
      expect(result.metadata.imageInfo.height).toBe(480);
    });

    test('should handle validation errors gracefully', async () => {
      // Mock a scenario where validation throws an error
      const originalValidateFileType = validator.validateFileType;
      validator.validateFileType = () => {
        throw new Error('Validation error');
      };

      const buffer = Buffer.from('test content');
      const result = await validator.validateFile(mockArtifact, buffer);

      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain('Validation failed');

      // Restore original method
      validator.validateFileType = originalValidateFileType;
    });
  });

  describe('virus scanning', () => {
    test('should handle missing ClamAV gracefully', async () => {
      // Mock ClamAV as not available
      validator.isClamAvailable = jest.fn().mockResolvedValue(false);

      const buffer = Buffer.from('test content');
      const result = await validator.scanForViruses(buffer);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('should handle ClamAV scan errors gracefully', async () => {
      // Mock ClamAV as available but failing
      validator.isClamAvailable = jest.fn().mockResolvedValue(true);
      validator.runClamScan = jest.fn().mockRejectedValue(new Error('Scan failed'));

      const buffer = Buffer.from('test content');
      const result = await validator.scanForViruses(buffer);

      // Should not fail validation even if virus scan fails
      expect(result.isValid).toBe(true);
    });
  });

  describe('detectSensitiveData', () => {
    test('should detect API keys', async () => {
      const buffer = Buffer.from('api_key=sk_test_1234567890abcdef1234567890abcdef');
      const result = await validator.detectSensitiveData(buffer);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('Potential sensitive data detected');
      expect(result.warnings[0]).toContain('***'); // Should be masked
    });

    test('should detect AWS credentials', async () => {
      const buffer = Buffer.from('AKIAIOSFODNN7EXAMPLE');
      const result = await validator.detectSensitiveData(buffer);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('Potential sensitive data detected');
    });

    test('should detect email addresses', async () => {
      const buffer = Buffer.from('Contact us at support@example.com for help');
      const result = await validator.detectSensitiveData(buffer);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('Potential sensitive data detected');
    });

    test('should detect JWT tokens', async () => {
      const buffer = Buffer.from('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c');
      const result = await validator.detectSensitiveData(buffer);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('Potential sensitive data detected');
    });

    test('should handle binary files gracefully', async () => {
      const buffer = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xFF, 0xFE]);
      const result = await validator.detectSensitiveData(buffer);
      expect(result.isValid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe('analyzeFileEntropy', () => {
    test('should calculate entropy for text files', () => {
      const buffer = Buffer.from('This is a normal text file with regular content');
      const result = validator.analyzeFileEntropy(buffer);
      expect(result.entropy).toBeGreaterThan(0);
      expect(result.entropy).toBeLessThan(6); // Normal text should have lower entropy
    });

    test('should detect high entropy in random data', () => {
      // Create pseudo-random data with high entropy
      const buffer = Buffer.alloc(1000);
      for (let i = 0; i < buffer.length; i++) {
        buffer[i] = Math.floor(Math.random() * 256);
      }
      const result = validator.analyzeFileEntropy(buffer);
      expect(result.entropy).toBeGreaterThan(7); // Random data should have high entropy
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    test('should handle empty buffers', () => {
      const buffer = Buffer.alloc(0);
      const result = validator.analyzeFileEntropy(buffer);
      expect(result.entropy).toBe(0);
    });
  });

  describe('calculateFileHash', () => {
    test('should calculate SHA256 hash', () => {
      const buffer = Buffer.from('test content');
      const hash = validator.calculateFileHash(buffer);
      expect(hash).toBe('6ae8a75555209fd6c44157c0aed8016e763ff435a19cf186f76863140143ff72');
    });

    test('should return consistent hashes for same content', () => {
      const buffer1 = Buffer.from('identical content');
      const buffer2 = Buffer.from('identical content');
      const hash1 = validator.calculateFileHash(buffer1);
      const hash2 = validator.calculateFileHash(buffer2);
      expect(hash1).toBe(hash2);
    });

    test('should return different hashes for different content', () => {
      const buffer1 = Buffer.from('content one');
      const buffer2 = Buffer.from('content two');
      const hash1 = validator.calculateFileHash(buffer1);
      const hash2 = validator.calculateFileHash(buffer2);
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('maskSensitiveData', () => {
    test('should mask short strings completely', () => {
      const masked = validator.maskSensitiveData('short');
      expect(masked).toBe('*****');
    });

    test('should mask long strings with partial visibility', () => {
      const masked = validator.maskSensitiveData('this_is_a_very_long_sensitive_string');
      expect(masked).toMatch(/^thi\*+ing$/);
    });

    test('should handle empty strings', () => {
      const masked = validator.maskSensitiveData('');
      expect(masked).toBe('');
    });
  });

  describe('calculateEntropy', () => {
    test('should calculate zero entropy for uniform data', () => {
      const buffer = Buffer.alloc(100, 0x41); // All 'A' characters
      const entropy = validator.calculateEntropy(buffer);
      expect(entropy).toBe(0);
    });

    test('should calculate maximum entropy for perfectly random data', () => {
      // Create buffer with all possible byte values
      const buffer = Buffer.alloc(256);
      for (let i = 0; i < 256; i++) {
        buffer[i] = i;
      }
      const entropy = validator.calculateEntropy(buffer);
      expect(entropy).toBe(8); // Maximum entropy for 8-bit data
    });

    test('should handle empty buffers', () => {
      const buffer = Buffer.alloc(0);
      const entropy = validator.calculateEntropy(buffer);
      expect(entropy).toBe(0);
    });
  });

  describe('enhanced validateFile integration', () => {
    test('should include entropy and hash in metadata', async () => {
      const buffer = Buffer.from('This is test content for metadata validation');
      const result = await validator.validateFile(mockArtifact, buffer);

      expect(result.metadata.entropy).toBeDefined();
      expect(result.metadata.fileHash).toBeDefined();
      expect(typeof result.metadata.entropy).toBe('number');
      expect(typeof result.metadata.fileHash).toBe('string');
    });

    test('should detect sensitive data in validation', async () => {
      const buffer = Buffer.from('Normal content with api_key=secret123456789abcdef1234567890 embedded');
      const result = await validator.validateFile(mockArtifact, buffer);

      expect(result.isValid).toBe(true); // Should still be valid
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w) => w.includes('sensitive data'))).toBe(true);
    });

    test('should warn about high entropy files', async () => {
      // Create high entropy buffer with all possible byte values
      const buffer = Buffer.alloc(2048);
      for (let i = 0; i < buffer.length; i++) {
        buffer[i] = i % 256;
      }

      const result = await validator.validateFile(mockArtifact, buffer);
      expect(result.warnings.some((w) => w.includes('entropy'))).toBe(true);
    });
  });

  describe('edge cases and error handling', () => {
    test('should handle extremely large files', () => {
      const largeBuffer = Buffer.alloc(1024 * 1024 * 1024); // 1GB
      const result = validator.validateFileSize(mockArtifact, largeBuffer);
      expect(result.isValid).toBe(false);
    });

    test('should handle files with unusual names', () => {
      mockArtifact.filename = '../../etc/passwd.txt';
      const result = validator.validateFileType(mockArtifact);
      expect(result.isValid).toBe(true); // File type validation should still work
    });

    test('should handle binary files with text content type', () => {
      const binaryBuffer = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xFF, 0xFE, 0xFD]);
      const result = validator.validateFileType(mockArtifact);
      expect(result.isValid).toBe(true); // Type validation should pass
    });

    test('should handle empty filename', () => {
      mockArtifact.filename = '';
      const result = validator.validateFileType(mockArtifact);
      expect(result.isValid).toBe(true); // Should handle gracefully
    });

    test('should handle filename without extension', () => {
      mockArtifact.filename = 'README';
      const result = validator.validateFileType(mockArtifact);
      expect(result.isValid).toBe(false); // Should fail extension check
    });
  });
});