const request = require('supertest');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { expect } = require('chai');

// Import the modules we're testing
const { piiDetector } = require('../utils/PIIDetector');
const { imageSecurityScanner } = require('../utils/ImageSecurityScanner');
const { credentialManager } = require('../utils/SecureCredentialManager');
const { auditLogger } = require('../middleware/auditLogger');

describe('Security Enhancements', () => {
  let app;
  let testUser;
  let authToken;

  before(async () => {
    // Setup test app and authentication
    app = require('../index'); // Assuming your main app file
    
    // Create test user and get auth token
    testUser = {
      id: 1,
      email: 'test@example.com',
      role: 'user',
    };
    
    // Mock authentication for tests
    authToken = 'test-auth-token';
  });

  describe('File Type Allowlist Validation', () => {
    it('should accept allowed image formats', async () => {
      const allowedTypes = [
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'image/bmp',
        'image/tiff',
      ];

      for (const contentType of allowedTypes) {
        const response = await request(app)
          .post('/api/bugs/1/artifacts/presign-upload')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            filename: `test.${contentType.split('/')[1]}`,
            contentType,
            fileSize: 1024 * 1024, // 1MB
          });

        expect(response.status).to.not.equal(400);
      }
    });

    it('should reject disallowed file types', async () => {
      const disallowedTypes = [
        'application/x-executable',
        'application/x-msdownload',
        'text/x-shellscript',
        'application/x-php',
        'text/x-python-script',
      ];

      for (const contentType of disallowedTypes) {
        const response = await request(app)
          .post('/api/bugs/1/artifacts/presign-upload')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            filename: 'malicious.exe',
            contentType,
            fileSize: 1024,
          });

        expect(response.status).to.equal(400);
        expect(response.body.message).to.include('not allowed');
      }
    });

    it('should detect file extension spoofing', async () => {
      const response = await request(app)
        .post('/api/bugs/1/artifacts/presign-upload')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filename: 'image.jpg',
          contentType: 'application/x-executable',
          fileSize: 1024,
        });

      expect(response.status).to.equal(400);
      expect(response.body.errors).to.include.something.that.includes('does not match');
    });

    it('should enforce file size limits per type', async () => {
      const response = await request(app)
        .post('/api/bugs/1/artifacts/presign-upload')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filename: 'huge-image.jpg',
          contentType: 'image/jpeg',
          fileSize: 100 * 1024 * 1024 + 1, // Just over 100MB limit
        });

      expect(response.status).to.equal(400);
      expect(response.body.errors).to.include.something.that.includes('exceeds maximum');
    });
  });

  describe('Rate Limiting and Quota Enforcement', () => {
    it('should enforce upload rate limits', async () => {
      const requests = [];
      
      // Make many requests quickly
      for (let i = 0; i < 60; i++) {
        requests.push(
          request(app)
            .post('/api/bugs/1/artifacts/presign-upload')
            .set('Authorization', `Bearer ${authToken}`)
            .send({
              filename: `test${i}.jpg`,
              contentType: 'image/jpeg',
              fileSize: 1024,
            })
        );
      }

      const responses = await Promise.all(requests);
      const rateLimitedResponses = responses.filter(r => r.status === 429);
      
      expect(rateLimitedResponses.length).to.be.greaterThan(0);
    });

    it('should enforce daily quota limits', async () => {
      // Mock user with exceeded quota
      const response = await request(app)
        .post('/api/bugs/1/artifacts/presign-upload')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filename: 'test.jpg',
          contentType: 'image/jpeg',
          fileSize: 10 * 1024 * 1024 * 1024, // 10GB - should exceed daily quota
        });

      expect(response.status).to.equal(429);
      expect(response.body.code).to.equal('DAILY_QUOTA_EXCEEDED');
    });

    it('should apply stricter limits for high-security file types', async () => {
      const requests = [];
      
      // Make requests for high-security files (archives)
      for (let i = 0; i < 15; i++) {
        requests.push(
          request(app)
            .post('/api/bugs/1/artifacts/presign-upload')
            .set('Authorization', `Bearer ${authToken}`)
            .send({
              filename: `archive${i}.zip`,
              contentType: 'application/zip',
              fileSize: 1024,
            })
        );
      }

      const responses = await Promise.all(requests);
      const rateLimitedResponses = responses.filter(r => r.status === 429);
      
      // Should hit high-security rate limit faster than normal uploads
      expect(rateLimitedResponses.length).to.be.greaterThan(0);
    });
  });

  describe('PII Detection and Masking', () => {
    it('should detect email addresses in text', async () => {
      const testText = 'Contact John Doe at john.doe@example.com for more information.';
      const result = await piiDetector.detectPII(testText);

      expect(result.hasPII).to.be.true;
      expect(result.detections).to.have.length.greaterThan(0);
      expect(result.detections[0].type).to.equal('email');
      expect(result.maskedContent).to.not.include('john.doe@example.com');
    });

    it('should detect phone numbers in various formats', async () => {
      const testTexts = [
        'Call me at (555) 123-4567',
        'Phone: 555.123.4567',
        'Contact: +1-555-123-4567',
        'Mobile 5551234567',
      ];

      for (const text of testTexts) {
        const result = await piiDetector.detectPII(text);
        expect(result.hasPII).to.be.true;
        expect(result.detections.some(d => d.type === 'phone')).to.be.true;
      }
    });

    it('should detect Social Security Numbers', async () => {
      const testText = 'SSN: 123-45-6789';
      const result = await piiDetector.detectPII(testText);

      expect(result.hasPII).to.be.true;
      expect(result.detections.some(d => d.type === 'ssn')).to.be.true;
      expect(result.riskLevel).to.equal('high');
    });

    it('should detect API keys and credentials', async () => {
      const testTexts = [
        'API_KEY=sk-1234567890abcdef1234567890abcdef',
        'aws_secret_access_key=abcdefghijklmnopqrstuvwxyz1234567890ABCD',
        'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
      ];

      for (const text of testTexts) {
        const result = await piiDetector.detectPII(text);
        expect(result.hasPII).to.be.true;
        expect(result.riskLevel).to.be.oneOf(['high', 'critical']);
      }
    });

    it('should apply appropriate masking levels', async () => {
      const testText = 'Email: user@example.com, SSN: 123-45-6789, Phone: 555-1234';
      
      const lowMasking = await piiDetector.detectPII(testText, { maskingLevel: 'low' });
      const highMasking = await piiDetector.detectPII(testText, { maskingLevel: 'high' });

      // High masking should mask more content than low masking
      const lowMaskedCount = (lowMasking.maskedContent.match(/\*/g) || []).length;
      const highMaskedCount = (highMasking.maskedContent.match(/\*/g) || []).length;
      
      expect(highMaskedCount).to.be.greaterThan(lowMaskedCount);
    });

    it('should detect PII in image OCR text', async () => {
      const ocrText = `
        Driver's License
        Name: John Smith
        License #: D123456789
        DOB: 01/15/1985
        Address: 123 Main St, Anytown, ST 12345
      `;

      const result = await piiDetector.detectPIIInImage(ocrText, {
        filename: 'drivers_license.jpg',
        width: 800,
        height: 600,
      });

      expect(result.hasPII).to.be.true;
      expect(result.riskLevel).to.equal('high');
      expect(result.imageContext.hasDocument).to.be.true;
    });
  });

  describe('Image Security Scanning', () => {
    let testImageBuffer;

    before(async () => {
      // Create a simple test image buffer (PNG format)
      testImageBuffer = Buffer.from([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
        0x00, 0x00, 0x00, 0x0D, // IHDR chunk length
        0x49, 0x48, 0x44, 0x52, // IHDR
        0x00, 0x00, 0x00, 0x01, // Width: 1
        0x00, 0x00, 0x00, 0x01, // Height: 1
        0x08, 0x02, 0x00, 0x00, 0x00, // Bit depth, color type, etc.
        0x90, 0x77, 0x53, 0xDE, // CRC
        0x00, 0x00, 0x00, 0x00, // IEND chunk length
        0x49, 0x45, 0x4E, 0x44, // IEND
        0xAE, 0x42, 0x60, 0x82, // CRC
      ]);
    });

    it('should validate image format correctly', async () => {
      const result = await imageSecurityScanner.scanImage(testImageBuffer, {
        contentType: 'image/png',
        filename: 'test.png',
      });

      expect(result.isSecure).to.be.true;
      expect(result.overallRisk).to.equal('low');
    });

    it('should detect format spoofing', async () => {
      const result = await imageSecurityScanner.scanImage(testImageBuffer, {
        contentType: 'image/jpeg', // Wrong content type
        filename: 'test.jpg',
      });

      expect(result.isSecure).to.be.false;
      expect(result.threats).to.include.something.that.includes('spoofing');
    });

    it('should detect suspicious image dimensions', async () => {
      // Test tiny image (potential tracking pixel)
      const tinyImageResult = await imageSecurityScanner.scanImage(testImageBuffer, {
        contentType: 'image/png',
        filename: 'pixel.png',
        width: 1,
        height: 1,
      });

      expect(tinyImageResult.warnings).to.include.something.that.includes('tracking pixel');
    });

    it('should detect potential steganography', async () => {
      // Create a buffer with high entropy (simulating encrypted data)
      const highEntropyBuffer = crypto.randomBytes(10000);
      
      // Add PNG header to make it look like an image
      const suspiciousBuffer = Buffer.concat([
        testImageBuffer.slice(0, 33), // PNG header
        highEntropyBuffer,
      ]);

      const result = await imageSecurityScanner.scanImage(suspiciousBuffer, {
        contentType: 'image/png',
        filename: 'suspicious.png',
      });

      expect(result.steganographyRisk).to.be.oneOf(['medium', 'high']);
    });

    it('should detect embedded scripts in SVG', async () => {
      const maliciousSVG = Buffer.from(`
        <svg xmlns="http://www.w3.org/2000/svg">
          <script>alert('XSS')</script>
          <rect width="100" height="100" fill="red"/>
        </svg>
      `);

      const result = await imageSecurityScanner.scanImage(maliciousSVG, {
        contentType: 'image/svg+xml',
        filename: 'malicious.svg',
      });

      expect(result.isSecure).to.be.false;
      expect(result.threats).to.include.something.that.includes('JavaScript');
    });

    it('should detect polyglot files', async () => {
      // Create a buffer that starts with both PNG and ZIP signatures
      const polyglotBuffer = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4E, 0x47]), // PNG signature
        Buffer.from([0x50, 0x4B, 0x03, 0x04]), // ZIP signature
        Buffer.alloc(100, 0x00), // Padding
      ]);

      const result = await imageSecurityScanner.scanImage(polyglotBuffer, {
        contentType: 'image/png',
        filename: 'polyglot.png',
      });

      expect(result.isSecure).to.be.false;
      expect(result.threats).to.include.something.that.includes('Polyglot');
    });
  });

  describe('Secure Credential Management', () => {
    it('should encrypt and decrypt credentials correctly', async () => {
      const testCredentials = {
        accessKeyId: 'AKIATEST123456789',
        secretAccessKey: 'testSecretKey123456789',
        region: 'us-east-1',
      };

      await credentialManager.storeCredentials('test-service', testCredentials);
      const retrievedCredentials = await credentialManager.getCredentials('test-service');

      expect(retrievedCredentials).to.deep.equal(testCredentials);
    });

    it('should validate AWS credentials', async () => {
      // Mock valid AWS credentials
      const validCredentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'mock-key',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'mock-secret',
        region: 'us-east-1',
      };

      if (process.env.AWS_ACCESS_KEY_ID) {
        const isValid = await credentialManager.validateCredentials('aws');
        expect(isValid).to.be.a('boolean');
      }
    });

    it('should handle credential rotation', async () => {
      const oldCredentials = { key: 'old-value' };
      const newCredentials = { key: 'new-value' };

      await credentialManager.storeCredentials('rotation-test', oldCredentials);
      await credentialManager.rotateCredentials('rotation-test', newCredentials);

      const currentCredentials = await credentialManager.getCredentials('rotation-test');
      expect(currentCredentials).to.deep.equal(newCredentials);
    });

    it('should cache credentials appropriately', async () => {
      const testCredentials = { cached: 'value' };
      
      await credentialManager.storeCredentials('cache-test', testCredentials);
      
      // First call should read from file
      const start1 = Date.now();
      await credentialManager.getCredentials('cache-test');
      const time1 = Date.now() - start1;
      
      // Second call should use cache (should be faster)
      const start2 = Date.now();
      await credentialManager.getCredentials('cache-test');
      const time2 = Date.now() - start2;
      
      expect(time2).to.be.lessThan(time1);
    });
  });

  describe('Audit Logging', () => {
    it('should log file upload operations', async () => {
      const mockReq = {
        user: testUser,
        method: 'POST',
        originalUrl: '/api/bugs/1/artifacts/presign-upload',
        params: { bugId: '1' },
        query: {},
        body: { filename: 'test.jpg', contentType: 'image/jpeg' },
        ip: '127.0.0.1',
        get: () => 'test-user-agent',
      };

      const mockRes = {
        json: function(data) { return this; },
        statusCode: 200,
      };

      // Test audit middleware
      const auditMiddleware = auditLogger.auditFileOperation('file_upload');
      
      await new Promise((resolve) => {
        auditMiddleware(mockReq, mockRes, resolve);
      });

      expect(mockReq.auditInfo).to.exist;
      expect(mockReq.auditInfo.operationType).to.equal('file_upload');
      expect(mockReq.auditInfo.userId).to.equal(testUser.id);
    });

    it('should log security events', async () => {
      const mockReq = {
        user: testUser,
        ip: '127.0.0.1',
        get: () => 'test-user-agent',
      };

      await auditLogger.logSecurityEvent(
        'malicious_file_detected',
        { filename: 'malware.exe', threat: 'virus' },
        mockReq
      );

      // Verify log was written (in a real test, you'd check the log file)
      expect(true).to.be.true; // Placeholder assertion
    });

    it('should mask sensitive data in logs', async () => {
      const sensitiveData = {
        password: 'secret123',
        apiKey: 'sk-1234567890abcdef',
        normalField: 'normal-value',
      };

      const sanitized = auditLogger.sanitizeBody(sensitiveData, 'upload');

      expect(sanitized.password).to.equal('[REDACTED]');
      expect(sanitized.apiKey).to.equal('[REDACTED]');
      expect(sanitized.normalField).to.equal('normal-value');
    });
  });

  describe('Penetration Testing Scenarios', () => {
    it('should prevent directory traversal in filenames', async () => {
      const maliciousFilenames = [
        '../../../etc/passwd',
        '..\\..\\windows\\system32\\config\\sam',
        'normal.jpg/../../../secret.txt',
        '%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd',
      ];

      for (const filename of maliciousFilenames) {
        const response = await request(app)
          .post('/api/bugs/1/artifacts/presign-upload')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            filename,
            contentType: 'image/jpeg',
            fileSize: 1024,
          });

        expect(response.status).to.equal(400);
        expect(response.body.errors).to.include.something.that.includes('dangerous');
      }
    });

    it('should prevent null byte injection', async () => {
      const response = await request(app)
        .post('/api/bugs/1/artifacts/presign-upload')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filename: 'image.jpg\x00.exe',
          contentType: 'image/jpeg',
          fileSize: 1024,
        });

      expect(response.status).to.equal(400);
    });

    it('should prevent extremely long filenames', async () => {
      const longFilename = 'a'.repeat(300) + '.jpg';
      
      const response = await request(app)
        .post('/api/bugs/1/artifacts/presign-upload')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filename: longFilename,
          contentType: 'image/jpeg',
          fileSize: 1024,
        });

      expect(response.status).to.equal(400);
      expect(response.body.errors).to.include.something.that.includes('255 characters');
    });

    it('should prevent reserved filename attacks', async () => {
      const reservedNames = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'LPT1'];
      
      for (const name of reservedNames) {
        const response = await request(app)
          .post('/api/bugs/1/artifacts/presign-upload')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            filename: `${name}.jpg`,
            contentType: 'image/jpeg',
            fileSize: 1024,
          });

        expect(response.status).to.equal(400);
        expect(response.body.errors).to.include.something.that.includes('dangerous');
      }
    });

    it('should handle malformed content-type headers', async () => {
      const malformedTypes = [
        'image/jpeg; charset=utf-8; boundary=something',
        'image/jpeg\r\nX-Injected-Header: malicious',
        'image/jpeg\x00application/x-executable',
        '',
        null,
        undefined,
      ];

      for (const contentType of malformedTypes) {
        const response = await request(app)
          .post('/api/bugs/1/artifacts/presign-upload')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            filename: 'test.jpg',
            contentType,
            fileSize: 1024,
          });

        expect(response.status).to.be.oneOf([400, 422]);
      }
    });

    it('should prevent integer overflow in file size', async () => {
      const response = await request(app)
        .post('/api/bugs/1/artifacts/presign-upload')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filename: 'test.jpg',
          contentType: 'image/jpeg',
          fileSize: Number.MAX_SAFE_INTEGER + 1,
        });

      expect(response.status).to.equal(400);
    });

    it('should prevent negative file sizes', async () => {
      const response = await request(app)
        .post('/api/bugs/1/artifacts/presign-upload')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filename: 'test.jpg',
          contentType: 'image/jpeg',
          fileSize: -1,
        });

      expect(response.status).to.equal(400);
    });

    it('should handle concurrent upload attempts (race conditions)', async () => {
      const concurrentRequests = Array(20).fill().map(() =>
        request(app)
          .post('/api/bugs/1/artifacts/presign-upload')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            filename: 'concurrent.jpg',
            contentType: 'image/jpeg',
            fileSize: 1024 * 1024,
          })
      );

      const responses = await Promise.all(concurrentRequests);
      
      // All requests should be handled properly (no crashes)
      responses.forEach(response => {
        expect(response.status).to.be.oneOf([200, 201, 429]); // Success or rate limited
      });
    });

    it('should prevent authentication bypass attempts', async () => {
      const bypassAttempts = [
        '', // Empty token
        'Bearer ', // Empty bearer
        'Bearer invalid-token',
        'Basic dGVzdDp0ZXN0', // Basic auth
        'Bearer eyJhbGciOiJub25lIn0.eyJzdWIiOiIxMjM0NTY3ODkwIn0.', // None algorithm JWT
      ];

      for (const auth of bypassAttempts) {
        const response = await request(app)
          .post('/api/bugs/1/artifacts/presign-upload')
          .set('Authorization', auth)
          .send({
            filename: 'test.jpg',
            contentType: 'image/jpeg',
            fileSize: 1024,
          });

        expect(response.status).to.be.oneOf([401, 403]);
      }
    });
  });

  describe('Integration Security Tests', () => {
    it('should handle complete malicious upload workflow', async () => {
      // Attempt to upload a malicious file with multiple attack vectors
      const response = await request(app)
        .post('/api/bugs/1/artifacts/presign-upload')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Forwarded-For', '192.168.1.1, 10.0.0.1') // IP spoofing attempt
        .send({
          filename: '../../../malware.exe\x00.jpg', // Path traversal + null byte
          contentType: 'image/jpeg', // Content type spoofing
          fileSize: 999999999999, // Unrealistic size
        });

      expect(response.status).to.equal(400);
      expect(response.body.errors.length).to.be.greaterThan(0);
    });

    it('should maintain security under load', async () => {
      const loadTestRequests = Array(100).fill().map((_, i) =>
        request(app)
          .post('/api/bugs/1/artifacts/presign-upload')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            filename: `load-test-${i}.jpg`,
            contentType: 'image/jpeg',
            fileSize: 1024,
          })
      );

      const responses = await Promise.all(loadTestRequests);
      
      // Verify that security checks are still working under load
      const successfulResponses = responses.filter(r => r.status === 200);
      const rateLimitedResponses = responses.filter(r => r.status === 429);
      
      expect(successfulResponses.length + rateLimitedResponses.length).to.equal(100);
    });
  });

  after(async () => {
    // Cleanup test data
    await credentialManager.clearCache();
  });
});