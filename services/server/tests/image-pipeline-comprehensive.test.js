const request = require('supertest');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const app = require('../index');
const knex = require('../db/knex');
const { Queue } = require('bullmq');
const AWS = require('aws-sdk');

// Mock AWS S3
jest.mock('aws-sdk');

describe('Comprehensive Image Processing Pipeline Tests', () => {
  let testUser;
  let authToken;
  let s3Mock;
  let queueMock;

  beforeAll(async () => {
    // Setup test database
    await knex.migrate.latest();
    await knex.seed.run();

    // Create test user
    const userResponse = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'imageuser',
        email: 'image@example.com',
        password: 'testpassword123'
      });

    testUser = userResponse.body.user;

    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'image@example.com',
        password: 'testpassword123'
      });

    authToken = loginResponse.body.token;

    // Setup AWS S3 mock
    s3Mock = {
      getSignedUrl: jest.fn().mockReturnValue('https://test-bucket.s3.amazonaws.com/test-key?signature=test'),
      upload: jest.fn().mockReturnValue({
        promise: jest.fn().mockResolvedValue({
          Location: 'https://test-bucket.s3.amazonaws.com/test-key',
          Key: 'test-key',
          Bucket: 'test-bucket'
        })
      }),
      getObject: jest.fn(),
      putObject: jest.fn().mockReturnValue({
        promise: jest.fn().mockResolvedValue({ ETag: 'test-etag' })
      })
    };

    AWS.S3.mockImplementation(() => s3Mock);

    // Setup queue mock
    queueMock = {
      add: jest.fn().mockResolvedValue({ id: 'test-job-id' }),
      getJob: jest.fn().mockResolvedValue({
        id: 'test-job-id',
        progress: 100,
        returnvalue: { status: 'completed' }
      })
    };

    Queue.mockImplementation(() => queueMock);
  });

  afterAll(async () => {
    await knex.destroy();
  });

  beforeEach(async () => {
    await knex('artifacts').del();
    await knex('processing_jobs').del();
    jest.clearAllMocks();
  });

  describe('Image Format Support', () => {
    const imageFormats = [
      { format: 'jpeg', contentType: 'image/jpeg', extension: 'jpg' },
      { format: 'png', contentType: 'image/png', extension: 'png' },
      { format: 'webp', contentType: 'image/webp', extension: 'webp' },
      { format: 'gif', contentType: 'image/gif', extension: 'gif' },
      { format: 'tiff', contentType: 'image/tiff', extension: 'tiff' },
      { format: 'bmp', contentType: 'image/bmp', extension: 'bmp' }
    ];

    test.each(imageFormats)('should process $format images correctly', async ({ format, contentType, extension }) => {
      // Create test image in specified format
      const testImageBuffer = await sharp({
        create: {
          width: 800,
          height: 600,
          channels: 3,
          background: { r: 255, g: 128, b: 0 }
        }
      })
      .toFormat(format)
      .toBuffer();

      // Mock S3 to return our test image
      s3Mock.getObject.mockReturnValueOnce({
        promise: jest.fn().mockResolvedValue({
          Body: testImageBuffer,
          ContentType: contentType
        })
      });

      const presignedResponse = await request(app)
        .post('/api/upload/presigned')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filename: `test-image.${extension}`,
          contentType: contentType,
          fileSize: testImageBuffer.length
        })
        .expect(200);

      const confirmResponse = await request(app)
        .post(`/api/upload/confirm/${presignedResponse.body.artifactId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          s3Key: `images/test-image.${extension}`,
          etag: 'test-etag',
          metadata: {
            width: 800,
            height: 600,
            format: format
          }
        })
        .expect(200);

      // Verify image processing job was queued
      expect(queueMock.add).toHaveBeenCalledWith(
        'process-image',
        expect.objectContaining({
          artifactId: presignedResponse.body.artifactId,
          s3Key: `images/test-image.${extension}`
        })
      );
    });

    test('should reject unsupported image formats', async () => {
      const unsupportedFormats = [
        { contentType: 'image/x-icon', extension: 'ico' },
        { contentType: 'image/svg+xml', extension: 'svg' },
        { contentType: 'image/x-portable-pixmap', extension: 'ppm' }
      ];

      for (const { contentType, extension } of unsupportedFormats) {
        const response = await request(app)
          .post('/api/upload/presigned')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            filename: `unsupported.${extension}`,
            contentType: contentType,
            fileSize: 1024
          });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('Unsupported image format');
      }
    });
  });

  describe('Image Size and Resolution Handling', () => {
    const resolutionTests = [
      { name: 'thumbnail', width: 150, height: 150 },
      { name: 'small', width: 640, height: 480 },
      { name: 'medium', width: 1280, height: 720 },
      { name: 'large', width: 1920, height: 1080 },
      { name: '4K', width: 3840, height: 2160 },
      { name: '8K', width: 7680, height: 4320 }
    ];

    test.each(resolutionTests)('should handle $name resolution ($width x $height)', async ({ name, width, height }) => {
      const testImageBuffer = await sharp({
        create: {
          width: width,
          height: height,
          channels: 3,
          background: { r: 0, g: 255, b: 0 }
        }
      })
      .jpeg()
      .toBuffer();

      s3Mock.getObject.mockReturnValueOnce({
        promise: jest.fn().mockResolvedValue({
          Body: testImageBuffer,
          ContentType: 'image/jpeg'
        })
      });

      const presignedResponse = await request(app)
        .post('/api/upload/presigned')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filename: `${name}-test.jpg`,
          contentType: 'image/jpeg',
          fileSize: testImageBuffer.length
        })
        .expect(200);

      const confirmResponse = await request(app)
        .post(`/api/upload/confirm/${presignedResponse.body.artifactId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          s3Key: `images/${name}-test.jpg`,
          etag: 'test-etag',
          metadata: {
            width: width,
            height: height,
            format: 'jpeg'
          }
        })
        .expect(200);

      expect(queueMock.add).toHaveBeenCalledWith(
        'process-image',
        expect.objectContaining({
          artifactId: presignedResponse.body.artifactId
        })
      );
    });

    test('should reject images with invalid dimensions', async () => {
      const invalidDimensions = [
        { width: 0, height: 100 },
        { width: 100, height: 0 },
        { width: -100, height: 100 },
        { width: 100, height: -100 },
        { width: 50000, height: 50000 } // Extremely large
      ];

      for (const { width, height } of invalidDimensions) {
        const response = await request(app)
          .post('/api/upload/presigned')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            filename: 'invalid-dimensions.jpg',
            contentType: 'image/jpeg',
            fileSize: 1024,
            metadata: {
              width: width,
              height: height
            }
          });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('Invalid image dimensions');
      }
    });
  });

  describe('Image Variant Generation', () => {
    test('should generate all required image variants', async () => {
      const originalImage = await sharp({
        create: {
          width: 1920,
          height: 1080,
          channels: 3,
          background: { r: 255, g: 0, b: 0 }
        }
      })
      .jpeg({ quality: 90 })
      .toBuffer();

      s3Mock.getObject.mockReturnValueOnce({
        promise: jest.fn().mockResolvedValue({
          Body: originalImage,
          ContentType: 'image/jpeg'
        })
      });

      const presignedResponse = await request(app)
        .post('/api/upload/presigned')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filename: 'variant-test.jpg',
          contentType: 'image/jpeg',
          fileSize: originalImage.length,
          processingOptions: {
            generateVariants: true,
            variantSizes: ['thumbnail', 'web', 'large']
          }
        })
        .expect(200);

      const artifactId = presignedResponse.body.artifactId;

      await request(app)
        .post(`/api/upload/confirm/${artifactId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          s3Key: 'images/variant-test.jpg',
          etag: 'test-etag',
          metadata: {
            width: 1920,
            height: 1080,
            format: 'jpeg'
          }
        })
        .expect(200);

      // Simulate variant generation completion
      await knex('artifacts')
        .where('id', artifactId)
        .update({
          status: 'completed',
          image_variants: JSON.stringify({
            thumbnail: 'images/variant-test-thumb.webp',
            web: 'images/variant-test-web.webp',
            large: 'images/variant-test-large.webp',
            original: 'images/variant-test.jpg'
          })
        });

      const artifact = await request(app)
        .get(`/api/artifacts/${artifactId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(artifact.body.imageVariants).toBeTruthy();
      expect(artifact.body.imageVariants.thumbnail).toBeTruthy();
      expect(artifact.body.imageVariants.web).toBeTruthy();
      expect(artifact.body.imageVariants.large).toBeTruthy();
      expect(artifact.body.imageVariants.original).toBeTruthy();
    });

    test('should optimize image formats for web delivery', async () => {
      const pngImage = await sharp({
        create: {
          width: 800,
          height: 600,
          channels: 4,
          background: { r: 255, g: 255, b: 255, alpha: 0.5 }
        }
      })
      .png()
      .toBuffer();

      s3Mock.getObject.mockReturnValueOnce({
        promise: jest.fn().mockResolvedValue({
          Body: pngImage,
          ContentType: 'image/png'
        })
      });

      const presignedResponse = await request(app)
        .post('/api/upload/presigned')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filename: 'optimization-test.png',
          contentType: 'image/png',
          fileSize: pngImage.length,
          processingOptions: {
            optimizeForWeb: true,
            targetFormat: 'webp'
          }
        })
        .expect(200);

      const artifactId = presignedResponse.body.artifactId;

      await request(app)
        .post(`/api/upload/confirm/${artifactId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          s3Key: 'images/optimization-test.png',
          etag: 'test-etag'
        })
        .expect(200);

      // Verify optimization job was queued with correct parameters
      expect(queueMock.add).toHaveBeenCalledWith(
        'process-image',
        expect.objectContaining({
          processingOptions: expect.objectContaining({
            optimizeForWeb: true,
            targetFormat: 'webp'
          })
        })
      );
    });
  });

  describe('OCR Text Extraction', () => {
    test('should extract text from images with text content', async () => {
      // Create image with text overlay
      const textImage = await sharp({
        create: {
          width: 800,
          height: 200,
          channels: 3,
          background: { r: 255, g: 255, b: 255 }
        }
      })
      .composite([{
        input: Buffer.from(`
          <svg width="800" height="200">
            <text x="50" y="100" font-family="Arial" font-size="24" fill="black">
              Hello World! This is a test image with text content.
            </text>
          </svg>
        `),
        top: 0,
        left: 0
      }])
      .jpeg()
      .toBuffer();

      s3Mock.getObject.mockReturnValueOnce({
        promise: jest.fn().mockResolvedValue({
          Body: textImage,
          ContentType: 'image/jpeg'
        })
      });

      const presignedResponse = await request(app)
        .post('/api/upload/presigned')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filename: 'ocr-test.jpg',
          contentType: 'image/jpeg',
          fileSize: textImage.length,
          processingOptions: {
            enableOCR: true,
            ocrLanguages: ['eng']
          }
        })
        .expect(200);

      const artifactId = presignedResponse.body.artifactId;

      await request(app)
        .post(`/api/upload/confirm/${artifactId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          s3Key: 'images/ocr-test.jpg',
          etag: 'test-etag'
        })
        .expect(200);

      // Simulate OCR completion
      await knex('artifacts')
        .where('id', artifactId)
        .update({
          status: 'completed',
          ocr_text: 'Hello World! This is a test image with text content.',
          image_metadata: JSON.stringify({
            ocrConfidence: 0.95,
            detectedLanguage: 'eng',
            textRegions: [
              {
                text: 'Hello World! This is a test image with text content.',
                bbox: { x: 50, y: 75, width: 700, height: 50 },
                confidence: 0.95
              }
            ]
          })
        });

      const artifact = await request(app)
        .get(`/api/artifacts/${artifactId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(artifact.body.ocrText).toBe('Hello World! This is a test image with text content.');
      expect(artifact.body.imageMetadata.ocrConfidence).toBe(0.95);
    });

    test('should handle multilingual OCR', async () => {
      const multilingualImage = await sharp({
        create: {
          width: 800,
          height: 300,
          channels: 3,
          background: { r: 255, g: 255, b: 255 }
        }
      })
      .jpeg()
      .toBuffer();

      s3Mock.getObject.mockReturnValueOnce({
        promise: jest.fn().mockResolvedValue({
          Body: multilingualImage,
          ContentType: 'image/jpeg'
        })
      });

      const presignedResponse = await request(app)
        .post('/api/upload/presigned')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filename: 'multilingual-ocr.jpg',
          contentType: 'image/jpeg',
          fileSize: multilingualImage.length,
          processingOptions: {
            enableOCR: true,
            ocrLanguages: ['eng', 'spa', 'fra']
          }
        })
        .expect(200);

      const artifactId = presignedResponse.body.artifactId;

      await request(app)
        .post(`/api/upload/confirm/${artifactId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          s3Key: 'images/multilingual-ocr.jpg',
          etag: 'test-etag'
        })
        .expect(200);

      // Verify OCR job was queued with multiple languages
      expect(queueMock.add).toHaveBeenCalledWith(
        'process-image',
        expect.objectContaining({
          processingOptions: expect.objectContaining({
            enableOCR: true,
            ocrLanguages: ['eng', 'spa', 'fra']
          })
        })
      );
    });
  });

  describe('Visual Element Detection', () => {
    test('should detect UI components in screenshots', async () => {
      const screenshotImage = await sharp({
        create: {
          width: 1200,
          height: 800,
          channels: 3,
          background: { r: 240, g: 240, b: 240 }
        }
      })
      .jpeg()
      .toBuffer();

      s3Mock.getObject.mockReturnValueOnce({
        promise: jest.fn().mockResolvedValue({
          Body: screenshotImage,
          ContentType: 'image/jpeg'
        })
      });

      const presignedResponse = await request(app)
        .post('/api/upload/presigned')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filename: 'ui-screenshot.jpg',
          contentType: 'image/jpeg',
          fileSize: screenshotImage.length,
          processingOptions: {
            detectVisualElements: true,
            elementTypes: ['buttons', 'textFields', 'menus', 'icons']
          }
        })
        .expect(200);

      const artifactId = presignedResponse.body.artifactId;

      await request(app)
        .post(`/api/upload/confirm/${artifactId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          s3Key: 'images/ui-screenshot.jpg',
          etag: 'test-etag'
        })
        .expect(200);

      // Simulate visual element detection completion
      await knex('artifacts')
        .where('id', artifactId)
        .update({
          status: 'completed',
          visual_elements: JSON.stringify({
            buttons: [
              {
                type: 'button',
                text: 'Submit',
                bbox: { x: 100, y: 200, width: 80, height: 30 },
                confidence: 0.95,
                style: {
                  backgroundColor: '#007bff',
                  textColor: '#ffffff'
                }
              }
            ],
            textFields: [
              {
                type: 'input',
                placeholder: 'Enter username',
                bbox: { x: 50, y: 150, width: 200, height: 25 },
                confidence: 0.88
              }
            ],
            menus: [],
            icons: [
              {
                type: 'icon',
                name: 'search',
                bbox: { x: 20, y: 20, width: 24, height: 24 },
                confidence: 0.92
              }
            ]
          })
        });

      const artifact = await request(app)
        .get(`/api/artifacts/${artifactId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(artifact.body.visualElements.buttons).toHaveLength(1);
      expect(artifact.body.visualElements.textFields).toHaveLength(1);
      expect(artifact.body.visualElements.icons).toHaveLength(1);
    });

    test('should detect charts and diagrams', async () => {
      const chartImage = await sharp({
        create: {
          width: 800,
          height: 600,
          channels: 3,
          background: { r: 255, g: 255, b: 255 }
        }
      })
      .jpeg()
      .toBuffer();

      s3Mock.getObject.mockReturnValueOnce({
        promise: jest.fn().mockResolvedValue({
          Body: chartImage,
          ContentType: 'image/jpeg'
        })
      });

      const presignedResponse = await request(app)
        .post('/api/upload/presigned')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filename: 'chart-diagram.jpg',
          contentType: 'image/jpeg',
          fileSize: chartImage.length,
          processingOptions: {
            detectVisualElements: true,
            elementTypes: ['charts', 'diagrams', 'graphs']
          }
        })
        .expect(200);

      const artifactId = presignedResponse.body.artifactId;

      await request(app)
        .post(`/api/upload/confirm/${artifactId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          s3Key: 'images/chart-diagram.jpg',
          etag: 'test-etag'
        })
        .expect(200);

      // Simulate chart detection completion
      await knex('artifacts')
        .where('id', artifactId)
        .update({
          status: 'completed',
          visual_elements: JSON.stringify({
            charts: [
              {
                type: 'bar_chart',
                title: 'Sales Data',
                bbox: { x: 100, y: 100, width: 600, height: 400 },
                confidence: 0.89,
                dataPoints: 12
              }
            ],
            diagrams: [
              {
                type: 'flowchart',
                bbox: { x: 50, y: 50, width: 700, height: 500 },
                confidence: 0.85,
                nodes: 8,
                connections: 12
              }
            ]
          })
        });

      const artifact = await request(app)
        .get(`/api/artifacts/${artifactId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(artifact.body.visualElements.charts).toHaveLength(1);
      expect(artifact.body.visualElements.diagrams).toHaveLength(1);
    });
  });

  describe('Code Extraction from Images', () => {
    test('should extract code snippets from screenshots', async () => {
      const codeScreenshot = await sharp({
        create: {
          width: 1000,
          height: 600,
          channels: 3,
          background: { r: 30, g: 30, b: 30 } // Dark background like IDE
        }
      })
      .jpeg()
      .toBuffer();

      s3Mock.getObject.mockReturnValueOnce({
        promise: jest.fn().mockResolvedValue({
          Body: codeScreenshot,
          ContentType: 'image/jpeg'
        })
      });

      const presignedResponse = await request(app)
        .post('/api/upload/presigned')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filename: 'code-screenshot.jpg',
          contentType: 'image/jpeg',
          fileSize: codeScreenshot.length,
          processingOptions: {
            extractCode: true,
            detectSyntax: true
          }
        })
        .expect(200);

      const artifactId = presignedResponse.body.artifactId;

      await request(app)
        .post(`/api/upload/confirm/${artifactId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          s3Key: 'images/code-screenshot.jpg',
          etag: 'test-etag'
        })
        .expect(200);

      // Simulate code extraction completion
      await knex('artifacts')
        .where('id', artifactId)
        .update({
          status: 'completed',
          visual_elements: JSON.stringify({
            codeBlocks: [
              {
                language: 'javascript',
                code: 'function hello() {\n  console.log("Hello, World!");\n}',
                bbox: { x: 50, y: 100, width: 900, height: 400 },
                confidence: 0.92,
                syntaxHighlighting: true
              }
            ]
          })
        });

      const artifact = await request(app)
        .get(`/api/artifacts/${artifactId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(artifact.body.visualElements.codeBlocks).toHaveLength(1);
      expect(artifact.body.visualElements.codeBlocks[0].language).toBe('javascript');
      expect(artifact.body.visualElements.codeBlocks[0].code).toContain('function hello()');
    });
  });

  describe('Sensitive Data Detection in Images', () => {
    test('should detect PII in image content', async () => {
      const piiImage = await sharp({
        create: {
          width: 800,
          height: 400,
          channels: 3,
          background: { r: 255, g: 255, b: 255 }
        }
      })
      .jpeg()
      .toBuffer();

      s3Mock.getObject.mockReturnValueOnce({
        promise: jest.fn().mockResolvedValue({
          Body: piiImage,
          ContentType: 'image/jpeg'
        })
      });

      const presignedResponse = await request(app)
        .post('/api/upload/presigned')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filename: 'pii-document.jpg',
          contentType: 'image/jpeg',
          fileSize: piiImage.length,
          processingOptions: {
            scanSensitiveData: true,
            enableOCR: true
          }
        })
        .expect(200);

      const artifactId = presignedResponse.body.artifactId;

      await request(app)
        .post(`/api/upload/confirm/${artifactId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          s3Key: 'images/pii-document.jpg',
          etag: 'test-etag'
        })
        .expect(200);

      // Simulate PII detection completion
      await knex('artifacts')
        .where('id', artifactId)
        .update({
          status: 'completed',
          ocr_text: 'John Doe\nSSN: 123-45-6789\nEmail: john@example.com\nPhone: (555) 123-4567',
          sensitive_data_flags: JSON.stringify({
            hasPII: true,
            hasCredentials: false,
            hasAPIKeys: false,
            detectedTypes: ['ssn', 'email', 'phone', 'name'],
            confidenceScore: 0.94,
            maskedContent: 'John Doe\nSSN: ***-**-****\nEmail: ****@example.com\nPhone: (***) ***-****'
          })
        });

      const artifact = await request(app)
        .get(`/api/artifacts/${artifactId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(artifact.body.sensitiveDataFlags.hasPII).toBe(true);
      expect(artifact.body.sensitiveDataFlags.detectedTypes).toContain('ssn');
      expect(artifact.body.sensitiveDataFlags.detectedTypes).toContain('email');
      expect(artifact.body.sensitiveDataFlags.maskedContent).toContain('***-**-****');
    });

    test('should detect credentials and API keys in images', async () => {
      const credentialsImage = await sharp({
        create: {
          width: 800,
          height: 300,
          channels: 3,
          background: { r: 255, g: 255, b: 255 }
        }
      })
      .jpeg()
      .toBuffer();

      s3Mock.getObject.mockReturnValueOnce({
        promise: jest.fn().mockResolvedValue({
          Body: credentialsImage,
          ContentType: 'image/jpeg'
        })
      });

      const presignedResponse = await request(app)
        .post('/api/upload/presigned')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filename: 'credentials-screenshot.jpg',
          contentType: 'image/jpeg',
          fileSize: credentialsImage.length,
          processingOptions: {
            scanSensitiveData: true,
            enableOCR: true
          }
        })
        .expect(200);

      const artifactId = presignedResponse.body.artifactId;

      await request(app)
        .post(`/api/upload/confirm/${artifactId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          s3Key: 'images/credentials-screenshot.jpg',
          etag: 'test-etag'
        })
        .expect(200);

      // Simulate credentials detection completion
      await knex('artifacts')
        .where('id', artifactId)
        .update({
          status: 'completed',
          ocr_text: 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\nAWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY\nAPI_KEY=sk-1234567890abcdef',
          sensitive_data_flags: JSON.stringify({
            hasPII: false,
            hasCredentials: true,
            hasAPIKeys: true,
            detectedTypes: ['aws_access_key', 'aws_secret_key', 'api_key'],
            confidenceScore: 0.98,
            riskLevel: 'high'
          })
        });

      const artifact = await request(app)
        .get(`/api/artifacts/${artifactId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(artifact.body.sensitiveDataFlags.hasCredentials).toBe(true);
      expect(artifact.body.sensitiveDataFlags.hasAPIKeys).toBe(true);
      expect(artifact.body.sensitiveDataFlags.riskLevel).toBe('high');
    });
  });

  describe('Error Handling and Edge Cases', () => {
    test('should handle corrupted image files gracefully', async () => {
      const corruptedImage = Buffer.from('This is not an image file');

      s3Mock.getObject.mockReturnValueOnce({
        promise: jest.fn().mockResolvedValue({
          Body: corruptedImage,
          ContentType: 'image/jpeg'
        })
      });

      const presignedResponse = await request(app)
        .post('/api/upload/presigned')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filename: 'corrupted.jpg',
          contentType: 'image/jpeg',
          fileSize: corruptedImage.length
        })
        .expect(200);

      const artifactId = presignedResponse.body.artifactId;

      const confirmResponse = await request(app)
        .post(`/api/upload/confirm/${artifactId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          s3Key: 'images/corrupted.jpg',
          etag: 'test-etag'
        })
        .expect(200);

      // Simulate processing failure
      await knex('artifacts')
        .where('id', artifactId)
        .update({
          status: 'failed',
          last_error: 'Invalid image format: Unable to decode image data'
        });

      const artifact = await request(app)
        .get(`/api/artifacts/${artifactId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(artifact.body.status).toBe('failed');
      expect(artifact.body.lastError).toContain('Invalid image format');
    });

    test('should handle extremely large images', async () => {
      const largeImageSize = 50 * 1024 * 1024; // 50MB

      const response = await request(app)
        .post('/api/upload/presigned')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filename: 'huge-image.jpg',
          contentType: 'image/jpeg',
          fileSize: largeImageSize,
          metadata: {
            width: 10000,
            height: 10000
          }
        });

      // Should either accept with special handling or reject
      if (response.status === 200) {
        // If accepted, should have special processing flags
        expect(response.body.processingOptions).toHaveProperty('largeImageHandling');
      } else {
        expect(response.status).toBe(400);
        expect(response.body.error).toContain('Image too large');
      }
    });

    test('should handle images with no text content', async () => {
      const noTextImage = await sharp({
        create: {
          width: 400,
          height: 300,
          channels: 3,
          background: { r: 100, g: 150, b: 200 }
        }
      })
      .jpeg()
      .toBuffer();

      s3Mock.getObject.mockReturnValueOnce({
        promise: jest.fn().mockResolvedValue({
          Body: noTextImage,
          ContentType: 'image/jpeg'
        })
      });

      const presignedResponse = await request(app)
        .post('/api/upload/presigned')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filename: 'no-text.jpg',
          contentType: 'image/jpeg',
          fileSize: noTextImage.length,
          processingOptions: {
            enableOCR: true
          }
        })
        .expect(200);

      const artifactId = presignedResponse.body.artifactId;

      await request(app)
        .post(`/api/upload/confirm/${artifactId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          s3Key: 'images/no-text.jpg',
          etag: 'test-etag'
        })
        .expect(200);

      // Simulate OCR completion with no text found
      await knex('artifacts')
        .where('id', artifactId)
        .update({
          status: 'completed',
          ocr_text: '',
          image_metadata: JSON.stringify({
            ocrConfidence: 0.0,
            textRegions: [],
            hasText: false
          })
        });

      const artifact = await request(app)
        .get(`/api/artifacts/${artifactId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(artifact.body.ocrText).toBe('');
      expect(artifact.body.imageMetadata.hasText).toBe(false);
    });
  });
});