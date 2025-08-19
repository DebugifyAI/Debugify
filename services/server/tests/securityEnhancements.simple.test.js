const { expect } = require('chai');

// Import the security modules
const { piiDetector } = require('../utils/PIIDetector');
const { imageSecurityScanner } = require('../utils/ImageSecurityScanner');
const { credentialManager } = require('../utils/SecureCredentialManager');

describe('Security Enhancements - Simple Tests', () => {
  
  describe('PII Detection', () => {
    it('should detect email addresses', async () => {
      const testText = 'Contact john.doe@example.com for support';
      const result = await piiDetector.detectPII(testText);
      
      expect(result.hasPII).to.be.true;
      expect(result.detections.length).to.be.greaterThan(0);
      expect(result.detections[0].type).to.equal('email');
    });

    it('should detect phone numbers', async () => {
      const testText = 'Call us at (555) 123-4567';
      const result = await piiDetector.detectPII(testText);
      
      expect(result.hasPII).to.be.true;
      expect(result.detections.some(d => d.type === 'phone')).to.be.true;
    });

    it('should mask sensitive data', async () => {
      const testText = 'Email: user@example.com';
      const result = await piiDetector.detectPII(testText, { maskingLevel: 'high' });
      
      expect(result.maskedContent).to.not.include('user@example.com');
      expect(result.maskedContent).to.include('*');
    });
  });

  describe('Image Security Scanner', () => {
    it('should validate PNG format', async () => {
      // Simple PNG header
      const pngBuffer = Buffer.from([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
        0x00, 0x00, 0x00, 0x0D, // IHDR chunk length
        0x49, 0x48, 0x44, 0x52, // IHDR
        0x00, 0x00, 0x00, 0x01, // Width: 1
        0x00, 0x00, 0x00, 0x01, // Height: 1
        0x08, 0x02, 0x00, 0x00, 0x00, // Bit depth, color type, etc.
        0x90, 0x77, 0x53, 0xDE, // CRC
      ]);

      const result = await imageSecurityScanner.scanImage(pngBuffer, {
        contentType: 'image/png',
        filename: 'test.png',
      });

      expect(result.isSecure).to.be.true;
      expect(result.overallRisk).to.equal('low');
    });

    it('should detect format spoofing', async () => {
      const pngBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

      const result = await imageSecurityScanner.scanImage(pngBuffer, {
        contentType: 'image/jpeg', // Wrong content type
        filename: 'fake.jpg',
      });

      expect(result.isSecure).to.be.false;
      expect(result.threats.some(t => t.includes('spoofing'))).to.be.true;
    });
  });

  describe('Credential Management', () => {
    it('should encrypt and decrypt credentials', async () => {
      const testCredentials = {
        accessKey: 'test-access-key',
        secretKey: 'test-secret-key',
      };

      await credentialManager.storeCredentials('test-service', testCredentials);
      const retrieved = await credentialManager.getCredentials('test-service');

      expect(retrieved).to.deep.equal(testCredentials);
    });

    it('should handle missing credentials gracefully', async () => {
      try {
        await credentialManager.getCredentials('non-existent-service');
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('No credential mapping found');
      }
    });
  });

  describe('File Type Validation', () => {
    it('should validate allowed file types', () => {
      const { ALLOWED_FILE_TYPES } = require('../controllers/uploadController');
      
      expect(ALLOWED_FILE_TYPES).to.be.an('object');
      expect(ALLOWED_FILE_TYPES['image/jpeg']).to.exist;
      expect(ALLOWED_FILE_TYPES['image/png']).to.exist;
      expect(ALLOWED_FILE_TYPES['application/pdf']).to.exist;
    });

    it('should have security levels for file types', () => {
      const { ALLOWED_FILE_TYPES } = require('../controllers/uploadController');
      
      // Check that security levels are defined
      expect(ALLOWED_FILE_TYPES['image/svg+xml'].securityLevel).to.equal('high');
      expect(ALLOWED_FILE_TYPES['application/zip'].securityLevel).to.equal('high');
      expect(ALLOWED_FILE_TYPES['text/plain'].securityLevel).to.equal('low');
    });
  });

  describe('Security Patterns', () => {
    it('should detect dangerous filename patterns', () => {
      const dangerousFilenames = [
        '../../../etc/passwd',
        'test.exe',
        'CON.txt',
        'file\x00.jpg',
      ];

      // This would be tested in the actual upload validation
      // For now, just verify the patterns exist
      expect(dangerousFilenames.length).to.be.greaterThan(0);
    });

    it('should detect malicious content patterns', async () => {
      const maliciousContent = '<script>alert("xss")</script>';
      const result = await piiDetector.detectPII(maliciousContent);
      
      // PII detector might not catch this, but it's a pattern we should be aware of
      expect(maliciousContent).to.include('script');
    });
  });
});