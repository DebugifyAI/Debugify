const request = require('supertest');
const express = require('express');
const { 
  preUploadValidation, 
  postUploadValidation, 
  validateFilename,
  validateArtifactSecurity,
} = require('../middleware/uploadSecurityValidation');

// Mock dependencies
jest.mock('../utils/PIIDetector');
jest.mock('../utils/ImageSecurityScanner');
jest.mock('../middleware/auditLogger');
jest.mock('../controllers/uploadController');

const { piiDetector } = require('../utils/PIIDetector');
const { imageSecurityScanner } = require('../utils/ImageSecurityScanner');
const { auditLogger } = require('../middleware/auditLogger');
const { ALLOWED_FILE_TYPES } = require('../controllers/uploadController');

// Mock ALLOWED_FILE_TYPES
ALLOWED_FILE_TYPES['image/jpeg'] = {
  maxSize: 50 * 1024 * 1024,
  extensions: ['.jpg', '.jpeg'],
  securityLevel: 'medium',
};
ALLOWED_FILE_TYPES['image/svg+xml'] = {
  maxSize: 5 * 1024 * 1024,
  extensions: ['.svg'],
  securityLevel: 'high',
};
ALLOWED_FILE_TYPES['text/plain'] = {
  maxSize: 50 * 1024 * 1024,
  extensions: ['.txt'],
  securityLevel: 'low',
};

describe('Upload Security Validation', () => {
  let app;
  let mockReq;
  let mockRes;
  let mockNext;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    
    mockReq = {
      body: {},
      user: { id: 1 },
      params: {},
    };
    
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    
    mockNext = jest.fn();

    // Reset mocks
    jest.clearAllMocks();
    auditLogger.logSecurityEvent = jest.fn();
    piiDetector.detectPIIInImage = jest.fn();
    imageSecurityScanner.scanImage = jest.fn();
  });

  describe('preUploadValidation', () => {
    it('should pass validation for valid file upload request', async () => {
      mockReq.body = {
        filename: 'test.jpg',
        contentType: 'image/jpeg',
        fileSize: 1024 * 1024, // 1MB
      };

      await preUploadValidation(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
      expect(mockReq.uploadValidation).toEqual({
        contentType: 'image/jpeg',
        filename: 'test.jpg',
        fileSize: 1024 * 1024,
        securityLevel: 'medium',
      });
    });

    it('should reject upload with missing required fields', async () => {
      mockReq.body = {
        filename: 'test.jpg',
        // Missing contentType
      };

      await preUploadValidation(mockReq, mockRes, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        message: 'filename and contentType are required',
        code: 'MISSING_REQUIRED_FIELDS',
      });
      expect(auditLogger.logSecurityEvent).toHaveBeenCalledWith(
        'validation_failure',
        expect.any(Object),
        mockReq
      );
    });

    it('should reject disallowed file types', async () => {
      mockReq.body = {
        filename: 'malicious.exe',
        contentType: 'application/x-executable',
        fileSize: 1024,
      };

      await preUploadValidation(mockReq, mockRes, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        message: 'File type application/x-executable is not allowed',
        code: 'FILE_TYPE_NOT_ALLOWED',
        allowedTypes: expect.any(Array),
      });
      expect(auditLogger.logSecurityEvent).toHaveBeenCalledWith(
        'file_type_violation',
        expect.any(Object),
        mockReq
      );
    });

    it('should reject files exceeding size limits', async () => {
      mockReq.body = {
        filename: 'huge.jpg',
        contentType: 'image/jpeg',
        fileSize: 100 * 1024 * 1024, // 100MB (exceeds 50MB limit)
      };

      await preUploadValidation(mockReq, mockRes, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        message: expect.stringContaining('exceeds maximum allowed size'),
        code: 'FILE_SIZE_EXCEEDED',
        maxSize: 50 * 1024 * 1024,
      });
      expect(auditLogger.logSecurityEvent).toHaveBeenCalledWith(
        'file_size_violation',
        expect.any(Object),
        mockReq
      );
    });

    it('should reject dangerous filenames', async () => {
      const dangerousFilenames = [
        '../../../etc/passwd',
        'file\x00.jpg',
        'CON.jpg',
        'malicious.exe',
        '  spaced.jpg  ',
        'файл.jpg', // Cyrillic characters
      ];

      for (const filename of dangerousFilenames) {
        mockReq.body = {
          filename,
          contentType: 'image/jpeg',
          fileSize: 1024,
        };

        await preUploadValidation(mockReq, mockRes, mockNext);

        expect(mockNext).not.toHaveBeenCalled();
        expect(mockRes.status).toHaveBeenCalledWith(400);
        expect(mockRes.json).toHaveBeenCalledWith({
          message: 'Invalid filename',
          errors: expect.any(Array),
          code: 'INVALID_FILENAME',
        });

        // Reset mocks for next iteration
        jest.clearAllMocks();
        auditLogger.logSecurityEvent = jest.fn();
      }
    });
  });

  describe('postUploadValidation', () => {
    beforeEach(() => {
      imageSecurityScanner.scanImage.mockResolvedValue({
        isSecure: true,
        threats: [],
        warnings: [],
        steganographyRisk: 'low',
        malwareRisk: 'low',
        overallRisk: 'low',
      });

      piiDetector.detectPIIInImage.mockResolvedValue({
        hasPII: false,
        riskLevel: 'low',
        detections: [],
      });
    });

    it('should pass validation for secure artifacts', async () => {
      mockReq.body = {
        artifacts: [
          {
            id: 1,
            contentType: 'image/jpeg',
            s3Key: 'test/image.jpg',
            metadata: { originalname: 'test.jpg' },
          },
        ],
      };

      await postUploadValidation(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
      expect(mockReq.validationResults).toHaveLength(1);
      expect(mockReq.validationResults[0].isSecure).toBe(true);
    });

    it('should detect and block high-severity security threats', async () => {
      imageSecurityScanner.scanImage.mockResolvedValue({
        isSecure: false,
        threats: ['Malicious content detected', 'Virus signature found'],
        warnings: [],
        steganographyRisk: 'high',
        malwareRisk: 'high',
        overallRisk: 'high',
      });

      mockReq.body = {
        artifacts: [
          {
            id: 1,
            contentType: 'image/jpeg',
            s3Key: 'test/malicious.jpg',
            metadata: { originalname: 'malicious.jpg' },
          },
        ],
      };

      await postUploadValidation(mockReq, mockRes, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        message: 'Security threats detected in uploaded files',
        threats: expect.any(Array),
        code: 'SECURITY_THREATS_DETECTED',
      });
      expect(auditLogger.logSecurityEvent).toHaveBeenCalledWith(
        'security_threats_detected',
        expect.any(Object),
        mockReq
      );
    });

    it('should allow medium-severity threats with warnings', async () => {
      imageSecurityScanner.scanImage.mockResolvedValue({
        isSecure: false,
        threats: ['Suspicious pattern detected'],
        warnings: ['Unusual file structure'],
        steganographyRisk: 'medium',
        malwareRisk: 'low',
        overallRisk: 'medium',
      });

      mockReq.body = {
        artifacts: [
          {
            id: 1,
            contentType: 'image/jpeg',
            s3Key: 'test/suspicious.jpg',
            metadata: { originalname: 'suspicious.jpg' },
          },
        ],
      };

      await postUploadValidation(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.securityWarnings).toBeDefined();
      expect(mockReq.securityWarnings).toHaveLength(1);
    });

    it('should detect PII in image OCR text', async () => {
      piiDetector.detectPIIInImage.mockResolvedValue({
        hasPII: true,
        riskLevel: 'high',
        detections: [
          { type: 'ssn', value: '***-**-****', confidence: 0.95 },
        ],
      });

      mockReq.body = {
        artifacts: [
          {
            id: 1,
            contentType: 'image/jpeg',
            s3Key: 'test/document.jpg',
            ocrText: 'Social Security Number: 123-45-6789',
            metadata: { originalname: 'document.jpg' },
          },
        ],
      };

      await postUploadValidation(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.validationResults[0].piiDetected).toBe(true);
      expect(mockReq.validationResults[0].warnings).toContain(
        expect.stringContaining('PII detected')
      );
    });

    it('should handle validation errors gracefully', async () => {
      imageSecurityScanner.scanImage.mockRejectedValue(new Error('Scanner failed'));

      mockReq.body = {
        artifacts: [
          {
            id: 1,
            contentType: 'image/jpeg',
            s3Key: 'test/error.jpg',
            metadata: { originalname: 'error.jpg' },
          },
        ],
      };

      await postUploadValidation(mockReq, mockRes, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        message: 'Security validation failed',
        code: 'VALIDATION_ERROR',
      });
    });
  });

  describe('validateFilename', () => {
    it('should validate safe filenames', () => {
      const safeFilenames = [
        'document.pdf',
        'image_001.jpg',
        'data-file.csv',
        'report.2024.txt',
        'file-with-dashes.png',
      ];

      safeFilenames.forEach(filename => {
        const result = validateFilename(filename);
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });

    it('should reject dangerous filenames', () => {
      const dangerousFilenames = [
        { name: '../../../etc/passwd', reason: 'directory traversal' },
        { name: 'file\x00.jpg', reason: 'null bytes' },
        { name: 'CON.jpg', reason: 'Windows reserved name' },
        { name: 'malicious.exe', reason: 'executable extension' },
        { name: '  spaced.jpg  ', reason: 'leading/trailing whitespace' },
        { name: 'file<script>.jpg', reason: 'invalid characters' },
        { name: 'файл.jpg', reason: 'homograph attack' },
        { name: '\u202efile.jpg', reason: 'Unicode direction override' },
      ];

      dangerousFilenames.forEach(({ name, reason }) => {
        const result = validateFilename(name);
        expect(result.isValid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      });
    });

    it('should reject empty or oversized filenames', () => {
      const invalidFilenames = [
        '',
        'a'.repeat(256), // Too long
      ];

      invalidFilenames.forEach(filename => {
        const result = validateFilename(filename);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain(
          expect.stringContaining('between 1 and 255 characters')
        );
      });
    });
  });

  describe('validateArtifactSecurity', () => {
    beforeEach(() => {
      imageSecurityScanner.scanImage.mockResolvedValue({
        isSecure: true,
        threats: [],
        warnings: [],
        steganographyRisk: 'low',
        malwareRisk: 'low',
        overallRisk: 'low',
      });

      piiDetector.detectPIIInImage.mockResolvedValue({
        hasPII: false,
        riskLevel: 'low',
        detections: [],
      });
    });

    it('should validate secure image artifacts', async () => {
      const artifact = {
        id: 1,
        contentType: 'image/jpeg',
        s3Key: 'test/secure.jpg',
        metadata: { originalname: 'secure.jpg' },
      };

      const result = await validateArtifactSecurity(artifact, mockReq);

      expect(result.isSecure).toBe(true);
      expect(result.threats).toHaveLength(0);
      expect(result.piiDetected).toBe(false);
      expect(imageSecurityScanner.scanImage).toHaveBeenCalled();
    });

    it('should detect insecure image artifacts', async () => {
      imageSecurityScanner.scanImage.mockResolvedValue({
        isSecure: false,
        threats: ['Steganography detected'],
        warnings: ['Suspicious entropy'],
        steganographyRisk: 'high',
        malwareRisk: 'low',
        overallRisk: 'high',
      });

      const artifact = {
        id: 1,
        contentType: 'image/png',
        s3Key: 'test/suspicious.png',
        metadata: { originalname: 'suspicious.png' },
      };

      const result = await validateArtifactSecurity(artifact, mockReq);

      expect(result.isSecure).toBe(false);
      expect(result.threats).toContain('Steganography detected');
      expect(result.warnings).toContain('Suspicious entropy');
    });

    it('should handle text-based files appropriately', async () => {
      const artifact = {
        id: 1,
        contentType: 'text/plain',
        s3Key: 'test/document.txt',
        metadata: { originalname: 'document.txt' },
      };

      const result = await validateArtifactSecurity(artifact, mockReq);

      expect(result.isSecure).toBe(true);
      expect(result.warnings).toContain(
        expect.stringContaining('PII scanning recommended')
      );
      expect(imageSecurityScanner.scanImage).not.toHaveBeenCalled();
    });

    it('should skip validation for artifacts without content info', async () => {
      const artifact = {
        id: 1,
        // Missing contentType and s3Key
      };

      const result = await validateArtifactSecurity(artifact, mockReq);

      expect(result.isSecure).toBe(true);
      expect(result.threats).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe('Integration Tests', () => {
    it('should handle complete upload security validation flow', async () => {
      // Setup express app with middleware
      app.post('/test-upload', preUploadValidation, (req, res) => {
        res.json({ success: true, validation: req.uploadValidation });
      });

      const response = await request(app)
        .post('/test-upload')
        .send({
          filename: 'test-document.pdf',
          contentType: 'application/pdf',
          fileSize: 5 * 1024 * 1024, // 5MB
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.validation).toBeDefined();
    });

    it('should reject malicious upload attempts', async () => {
      app.post('/test-upload', preUploadValidation, (req, res) => {
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/test-upload')
        .send({
          filename: '../../../etc/passwd',
          contentType: 'text/plain',
          fileSize: 1024,
        });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('INVALID_FILENAME');
    });

    it('should handle post-upload validation with security threats', async () => {
      imageSecurityScanner.scanImage.mockResolvedValue({
        isSecure: false,
        threats: ['Malicious script detected'],
        warnings: [],
        steganographyRisk: 'low',
        malwareRisk: 'high',
        overallRisk: 'high',
      });

      app.post('/test-confirm', postUploadValidation, (req, res) => {
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/test-confirm')
        .send({
          artifacts: [
            {
              id: 1,
              contentType: 'image/svg+xml',
              s3Key: 'test/malicious.svg',
              metadata: { originalname: 'malicious.svg' },
            },
          ],
        });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('SECURITY_THREATS_DETECTED');
    });
  });

  describe('Performance Tests', () => {
    it('should handle multiple artifacts efficiently', async () => {
      const artifacts = Array.from({ length: 10 }, (_, i) => ({
        id: i + 1,
        contentType: 'image/jpeg',
        s3Key: `test/image${i}.jpg`,
        metadata: { originalname: `image${i}.jpg` },
      }));

      mockReq.body = { artifacts };

      const startTime = Date.now();
      await postUploadValidation(mockReq, mockRes, mockNext);
      const endTime = Date.now();

      expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds
      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.validationResults).toHaveLength(10);
    });
  });
});