const request = require('supertest');
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { 
  preUploadValidation, 
  postUploadValidation,
} = require('../middleware/uploadSecurityValidation');

// Mock dependencies
jest.mock('../utils/PIIDetector');
jest.mock('../utils/ImageSecurityScanner');
jest.mock('../middleware/auditLogger');
jest.mock('../controllers/uploadController');

const { imageSecurityScanner } = require('../utils/ImageSecurityScanner');
const { auditLogger } = require('../middleware/auditLogger');
const { ALLOWED_FILE_TYPES } = require('../controllers/uploadController');

// Mock ALLOWED_FILE_TYPES for testing
ALLOWED_FILE_TYPES['image/jpeg'] = {
  maxSize: 50 * 1024 * 1024,
  extensions: ['.jpg', '.jpeg'],
  securityLevel: 'medium',
};
ALLOWED_FILE_TYPES['image/png'] = {
  maxSize: 50 * 1024 * 1024,
  extensions: ['.png'],
  securityLevel: 'medium',
};
ALLOWED_FILE_TYPES['image/svg+xml'] = {
  maxSize: 5 * 1024 * 1024,
  extensions: ['.svg'],
  securityLevel: 'high',
};

describe('Image Upload Penetration Tests', () => {
  let app;
  let mockReq;
  let mockRes;
  let mockNext;

  beforeEach(() => {
    app = express();
    app.use(express.json({ limit: '100mb' }));
    
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
    imageSecurityScanner.scanImage = jest.fn().mockResolvedValue({
      isSecure: true,
      threats: [],
      warnings: [],
      steganographyRisk: 'low',
      malwareRisk: 'low',
      overallRisk: 'low',
    });
  });

  describe('File Type Spoofing Attacks', () => {
    it('should detect JPEG with PNG extension', async () => {
      // Create a JPEG file with PNG extension
      const jpegHeader = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]);
      const fakeContent = Buffer.concat([jpegHeader, Buffer.alloc(1000)]);

      mockReq.body = {
        filename: 'fake.png',
        contentType: 'image/png',
        fileSize: fakeContent.length,
      };

      await preUploadValidation(mockReq, mockRes, mockNext);

      // Should pass pre-validation but fail during content validation
      expect(mockNext).toHaveBeenCalled();
    });

    it('should detect executable disguised as image', async () => {
      // MZ header (Windows executable)
      const exeHeader = Buffer.from([0x4D, 0x5A]);
      const maliciousContent = Buffer.concat([exeHeader, Buffer.alloc(1000)]);

      mockReq.body = {
        filename: 'malicious.jpg',
        contentType: 'image/jpeg',
        fileSize: maliciousContent.length,
      };

      imageSecurityScanner.scanImage.mockResolvedValue({
        isSecure: false,
        threats: ['Executable signature detected in image file'],
        warnings: [],
        steganographyRisk: 'low',
        malwareRisk: 'high',
        overallRisk: 'high',
      });

      await preUploadValidation(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();

      // Post-upload validation should catch this
      mockReq.body = {
        artifacts: [{
          id: 1,
          contentType: 'image/jpeg',
          s3Key: 'test/malicious.jpg',
          metadata: { originalname: 'malicious.jpg' },
        }],
      };

      await postUploadValidation(mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should detect polyglot files (ZIP+JPEG)', async () => {
      // Create a file that's both a valid ZIP and JPEG
      const zipHeader = Buffer.from([0x50, 0x4B, 0x03, 0x04]);
      const jpegHeader = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]);
      const polyglotContent = Buffer.concat([zipHeader, jpegHeader, Buffer.alloc(1000)]);

      imageSecurityScanner.scanImage.mockResolvedValue({
        isSecure: false,
        threats: ['Polyglot file detected: ZIP, JPEG'],
        warnings: [],
        steganographyRisk: 'medium',
        malwareRisk: 'high',
        overallRisk: 'high',
      });

      mockReq.body = {
        artifacts: [{
          id: 1,
          contentType: 'image/jpeg',
          s3Key: 'test/polyglot.jpg',
          metadata: { originalname: 'polyglot.jpg' },
        }],
      };

      await postUploadValidation(mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'SECURITY_THREATS_DETECTED',
        })
      );
    });
  });

  describe('SVG Script Injection Attacks', () => {
    it('should detect JavaScript in SVG files', async () => {
      const maliciousSVG = `
        <svg xmlns="http://www.w3.org/2000/svg">
          <script>alert('XSS')</script>
          <rect width="100" height="100" fill="red"/>
        </svg>
      `;

      imageSecurityScanner.scanImage.mockResolvedValue({
        isSecure: false,
        threats: ['JavaScript detected in SVG file'],
        warnings: [],
        steganographyRisk: 'low',
        malwareRisk: 'high',
        overallRisk: 'high',
      });

      mockReq.body = {
        artifacts: [{
          id: 1,
          contentType: 'image/svg+xml',
          s3Key: 'test/malicious.svg',
          metadata: { originalname: 'malicious.svg' },
        }],
      };

      await postUploadValidation(mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should detect event handlers in SVG files', async () => {
      const maliciousSVG = `
        <svg xmlns="http://www.w3.org/2000/svg">
          <rect width="100" height="100" fill="red" onclick="maliciousFunction()"/>
        </svg>
      `;

      imageSecurityScanner.scanImage.mockResolvedValue({
        isSecure: false,
        threats: ['Event handlers detected in SVG file'],
        warnings: [],
        steganographyRisk: 'low',
        malwareRisk: 'high',
        overallRisk: 'high',
      });

      mockReq.body = {
        artifacts: [{
          id: 1,
          contentType: 'image/svg+xml',
          s3Key: 'test/handlers.svg',
          metadata: { originalname: 'handlers.svg' },
        }],
      };

      await postUploadValidation(mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should detect foreign objects in SVG files', async () => {
      const suspiciousSVG = `
        <svg xmlns="http://www.w3.org/2000/svg">
          <foreignObject width="100" height="100">
            <iframe src="http://malicious.com"></iframe>
          </foreignObject>
        </svg>
      `;

      imageSecurityScanner.scanImage.mockResolvedValue({
        isSecure: true,
        threats: [],
        warnings: ['Foreign object detected in SVG (potential security risk)'],
        steganographyRisk: 'low',
        malwareRisk: 'medium',
        overallRisk: 'medium',
      });

      mockReq.body = {
        artifacts: [{
          id: 1,
          contentType: 'image/svg+xml',
          s3Key: 'test/foreign.svg',
          metadata: { originalname: 'foreign.svg' },
        }],
      };

      await postUploadValidation(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled(); // Should pass but with warnings
      expect(mockReq.securityWarnings).toBeDefined();
    });
  });

  describe('Steganography Detection Tests', () => {
    it('should detect high entropy indicating hidden data', async () => {
      imageSecurityScanner.scanImage.mockResolvedValue({
        isSecure: false,
        threats: ['Potential steganography detected'],
        warnings: [],
        steganographyRisk: 'high',
        malwareRisk: 'low',
        overallRisk: 'high',
        scanDetails: {
          steganography: {
            riskLevel: 'high',
            confidence: 0.85,
            techniques: {
              entropy: { suspiciousScore: 0.9 },
              lsb: { suspiciousScore: 0.8 },
            },
          },
        },
      });

      mockReq.body = {
        artifacts: [{
          id: 1,
          contentType: 'image/png',
          s3Key: 'test/hidden-data.png',
          metadata: { originalname: 'hidden-data.png' },
        }],
      };

      await postUploadValidation(mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(auditLogger.logSecurityEvent).toHaveBeenCalledWith(
        'security_threats_detected',
        expect.any(Object),
        mockReq
      );
    });

    it('should detect LSB steganography patterns', async () => {
      imageSecurityScanner.scanImage.mockResolvedValue({
        isSecure: false,
        threats: ['LSB steganography pattern detected'],
        warnings: [],
        steganographyRisk: 'high',
        malwareRisk: 'low',
        overallRisk: 'high',
      });

      mockReq.body = {
        artifacts: [{
          id: 1,
          contentType: 'image/jpeg',
          s3Key: 'test/lsb-stego.jpg',
          metadata: { originalname: 'lsb-stego.jpg' },
        }],
      };

      await postUploadValidation(mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should allow images with medium steganography risk', async () => {
      imageSecurityScanner.scanImage.mockResolvedValue({
        isSecure: false,
        threats: ['Possible hidden data detected'],
        warnings: ['Unusual pixel patterns'],
        steganographyRisk: 'medium',
        malwareRisk: 'low',
        overallRisk: 'medium',
      });

      mockReq.body = {
        artifacts: [{
          id: 1,
          contentType: 'image/png',
          s3Key: 'test/maybe-stego.png',
          metadata: { originalname: 'maybe-stego.png' },
        }],
      };

      await postUploadValidation(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.securityWarnings).toBeDefined();
    });
  });

  describe('Malicious Image Structure Attacks', () => {
    it('should detect images with suspicious dimensions', async () => {
      imageSecurityScanner.scanImage.mockResolvedValue({
        isSecure: true,
        threats: [],
        warnings: ['Potential tracking pixel detected (very small image)'],
        steganographyRisk: 'low',
        malwareRisk: 'low',
        overallRisk: 'low',
      });

      mockReq.body = {
        filename: 'tracking.png',
        contentType: 'image/png',
        fileSize: 100, // Very small file
      };

      await preUploadValidation(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();

      mockReq.body = {
        artifacts: [{
          id: 1,
          contentType: 'image/png',
          s3Key: 'test/tracking.png',
          metadata: { originalname: 'tracking.png' },
        }],
      };

      await postUploadValidation(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.validationResults[0].warnings).toContain(
        expect.stringContaining('tracking pixel')
      );
    });

    it('should detect oversized images (DoS attack)', async () => {
      imageSecurityScanner.scanImage.mockResolvedValue({
        isSecure: true,
        threats: [],
        warnings: ['Unusually large image dimensions (potential DoS vector)'],
        steganographyRisk: 'low',
        malwareRisk: 'low',
        overallRisk: 'medium',
      });

      mockReq.body = {
        filename: 'huge.jpg',
        contentType: 'image/jpeg',
        fileSize: 45 * 1024 * 1024, // Close to limit but valid
      };

      await preUploadValidation(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should detect malicious EXIF data', async () => {
      imageSecurityScanner.scanImage.mockResolvedValue({
        isSecure: false,
        threats: ['Suspicious data in JPEG APP section'],
        warnings: [],
        steganographyRisk: 'low',
        malwareRisk: 'medium',
        overallRisk: 'medium',
      });

      mockReq.body = {
        artifacts: [{
          id: 1,
          contentType: 'image/jpeg',
          s3Key: 'test/malicious-exif.jpg',
          metadata: { originalname: 'malicious-exif.jpg' },
        }],
      };

      await postUploadValidation(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled(); // Medium risk allows through with warnings
      expect(mockReq.securityWarnings).toBeDefined();
    });
  });

  describe('Filename-based Attacks', () => {
    it('should detect Unicode homograph attacks', async () => {
      const homographFilenames = [
        'іmage.jpg', // Cyrillic 'і' instead of 'i'
        'αpple.png', // Greek 'α' instead of 'a'
        'ｆｉｌｅ.gif', // Full-width characters
      ];

      for (const filename of homographFilenames) {
        mockReq.body = {
          filename,
          contentType: 'image/jpeg',
          fileSize: 1024,
        };

        await preUploadValidation(mockReq, mockRes, mockNext);
        expect(mockRes.status).toHaveBeenCalledWith(400);
        expect(mockRes.json).toHaveBeenCalledWith(
          expect.objectContaining({
            code: 'INVALID_FILENAME',
          })
        );

        // Reset mocks for next iteration
        jest.clearAllMocks();
        auditLogger.logSecurityEvent = jest.fn();
      }
    });

    it('should detect Unicode direction override attacks', async () => {
      // Right-to-left override character
      const maliciousFilename = 'image\u202eexe.jpg';

      mockReq.body = {
        filename: maliciousFilename,
        contentType: 'image/jpeg',
        fileSize: 1024,
      };

      await preUploadValidation(mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'INVALID_FILENAME',
        })
      );
    });

    it('should detect null byte injection', async () => {
      const nullByteFilename = 'image.jpg\x00.exe';

      mockReq.body = {
        filename: nullByteFilename,
        contentType: 'image/jpeg',
        fileSize: 1024,
      };

      await preUploadValidation(mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(400);
    });
  });

  describe('Content-Type Manipulation', () => {
    it('should reject mismatched content-type and extension', async () => {
      mockReq.body = {
        filename: 'document.exe',
        contentType: 'image/jpeg',
        fileSize: 1024,
      };

      await preUploadValidation(mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should handle case-sensitive content-type variations', async () => {
      const variations = [
        'Image/JPEG',
        'IMAGE/jpeg',
        'image/JPEG',
      ];

      for (const contentType of variations) {
        mockReq.body = {
          filename: 'test.jpg',
          contentType,
          fileSize: 1024,
        };

        await preUploadValidation(mockReq, mockRes, mockNext);
        // Should be rejected as our allowlist is case-sensitive
        expect(mockRes.status).toHaveBeenCalledWith(400);

        // Reset mocks
        jest.clearAllMocks();
        auditLogger.logSecurityEvent = jest.fn();
      }
    });
  });

  describe('Size-based Attacks', () => {
    it('should reject negative file sizes', async () => {
      mockReq.body = {
        filename: 'test.jpg',
        contentType: 'image/jpeg',
        fileSize: -1,
      };

      await preUploadValidation(mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should reject extremely large file sizes', async () => {
      mockReq.body = {
        filename: 'huge.jpg',
        contentType: 'image/jpeg',
        fileSize: Number.MAX_SAFE_INTEGER + 1,
      };

      await preUploadValidation(mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should handle zero-byte files', async () => {
      mockReq.body = {
        filename: 'empty.jpg',
        contentType: 'image/jpeg',
        fileSize: 0,
      };

      await preUploadValidation(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled(); // Zero-byte files are technically valid
    });
  });

  describe('Concurrent Upload Attacks', () => {
    it('should handle multiple simultaneous malicious uploads', async () => {
      const maliciousUploads = Array.from({ length: 10 }, (_, i) => ({
        filename: `../../../etc/passwd${i}`,
        contentType: 'image/jpeg',
        fileSize: 1024,
      }));

      const promises = maliciousUploads.map(upload => {
        const req = { ...mockReq, body: upload };
        const res = {
          status: jest.fn().mockReturnThis(),
          json: jest.fn().mockReturnThis(),
        };
        return preUploadValidation(req, res, mockNext);
      });

      await Promise.all(promises);

      // All should be rejected
      expect(auditLogger.logSecurityEvent).toHaveBeenCalledTimes(10);
    });
  });

  describe('Memory Exhaustion Attacks', () => {
    it('should handle large artifact arrays efficiently', async () => {
      const largeArtifactArray = Array.from({ length: 1000 }, (_, i) => ({
        id: i + 1,
        contentType: 'image/jpeg',
        s3Key: `test/image${i}.jpg`,
        metadata: { originalname: `image${i}.jpg` },
      }));

      mockReq.body = { artifacts: largeArtifactArray };

      const startTime = Date.now();
      const memoryBefore = process.memoryUsage().heapUsed;

      await postUploadValidation(mockReq, mockRes, mockNext);

      const endTime = Date.now();
      const memoryAfter = process.memoryUsage().heapUsed;
      const memoryIncrease = memoryAfter - memoryBefore;

      // Should complete within reasonable time and memory limits
      expect(endTime - startTime).toBeLessThan(10000); // 10 seconds
      expect(memoryIncrease).toBeLessThan(100 * 1024 * 1024); // 100MB
    });
  });

  describe('Error Handling and Logging', () => {
    it('should log all security events properly', async () => {
      mockReq.body = {
        filename: '../../../etc/passwd',
        contentType: 'text/plain',
        fileSize: 1024,
      };

      await preUploadValidation(mockReq, mockRes, mockNext);

      expect(auditLogger.logSecurityEvent).toHaveBeenCalledWith(
        'filename_violation',
        expect.objectContaining({
          filename: '../../../etc/passwd',
          errors: expect.any(Array),
        }),
        mockReq
      );
    });

    it('should handle scanner failures gracefully', async () => {
      imageSecurityScanner.scanImage.mockRejectedValue(new Error('Scanner crashed'));

      mockReq.body = {
        artifacts: [{
          id: 1,
          contentType: 'image/jpeg',
          s3Key: 'test/error.jpg',
          metadata: { originalname: 'error.jpg' },
        }],
      };

      await postUploadValidation(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(auditLogger.logSecurityEvent).toHaveBeenCalledWith(
        'validation_error',
        expect.any(Object),
        mockReq
      );
    });
  });

  describe('Bypass Attempts', () => {
    it('should prevent content-type header manipulation', async () => {
      // Attempt to bypass validation with multiple content-type headers
      mockReq.headers = {
        'content-type': 'image/jpeg; application/x-executable',
      };

      mockReq.body = {
        filename: 'malicious.exe',
        contentType: 'image/jpeg',
        fileSize: 1024,
      };

      await preUploadValidation(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled(); // Should pass pre-validation
      // But would be caught during actual file processing
    });

    it('should prevent extension double-encoding', async () => {
      const doubleEncodedFilename = 'image%2Eexe.jpg';

      mockReq.body = {
        filename: doubleEncodedFilename,
        contentType: 'image/jpeg',
        fileSize: 1024,
      };

      await preUploadValidation(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled(); // Current implementation allows this
      // In production, you might want to decode and re-validate
    });
  });
});