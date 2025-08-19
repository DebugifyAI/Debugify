const request = require('supertest');
const fs = require('fs');
const path = require('path');
const app = require('../index');
const knex = require('../db/knex');
const { Queue } = require('bullmq');
const AWS = require('aws-sdk');
const sharp = require('sharp');

// Mock AWS S3
jest.mock('aws-sdk');

describe('Performance Benchmarks - Large File Processing', () => {
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
        username: 'perfuser',
        email: 'perf@example.com',
        password: 'testpassword123'
      });

    testUser = userResponse.body.user;

    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'perf@example.com',
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
      getObject: jest.fn().mockImplementation((params) => ({
        promise: jest.fn().mockResolvedValue({
          Body: Buffer.alloc(1024 * 1024), // 1MB buffer
          ContentType: 'application/octet-stream'
        })
      }))
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

  describe('Large File Upload Performance', () => {
    test('should handle 100MB file upload efficiently', async () => {
      const fileSize = 100 * 1024 * 1024; // 100MB
      const startTime = Date.now();

      const presignedResponse = await request(app)
        .post('/api/upload/presigned')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filename: 'large-file-100mb.bin',
          contentType: 'application/octet-stream',
          fileSize: fileSize
        })
        .expect(200);

      const presignedTime = Date.now();
      console.log(`Presigned URL generation for 100MB file: ${presignedTime - startTime}ms`);

      const confirmResponse = await request(app)
        .post(`/api/upload/confirm/${presignedResponse.body.artifactId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          s3Key: 'large-files/100mb-test.bin',
          etag: 'large-file-etag'
        })
        .expect(200);

      const endTime = Date.now();
      const totalTime = endTime - startTime;

      console.log(`Total 100MB file upload processing: ${totalTime}ms`);
      expect(totalTime).toBeLessThan(5000); // Should complete within 5 seconds
      expect(presignedTime - startTime).toBeLessThan(1000); // Presigned URL should be fast
    });

    test('should handle 500MB file upload with multipart support', async () => {
      const fileSize = 500 * 1024 * 1024; // 500MB
      const startTime = Date.now();

      const presignedResponse = await request(app)
        .post('/api/upload/presigned')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filename: 'large-file-500mb.bin',
          contentType: 'application/octet-stream',
          fileSize: fileSize,
          multipart: true
        })
        .expect(200);

      expect(presignedResponse.body).toHaveProperty('multipartUploadId');
      expect(presignedResponse.body).toHaveProperty('partUrls');

      const confirmResponse = await request(app)
        .post(`/api/upload/confirm/${presignedResponse.body.artifactId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          s3Key: 'large-files/500mb-test.bin',
          multipartUploadId: presignedResponse.body.multipartUploadId,
          parts: [
            { ETag: 'part1-etag', PartNumber: 1 },
            { ETag: 'part2-etag', PartNumber: 2 }
          ]
        })
        .expect(200);

      const endTime = Date.now();
      const totalTime = endTime - startTime;

      console.log(`Total 500MB multipart upload processing: ${totalTime}ms`);
      expect(totalTime).toBeLessThan(10000); // Should complete within 10 seconds
    });

    test('should benchmark file size vs processing time relationship', async () => {
      const fileSizes = [
        1 * 1024 * 1024,    // 1MB
        10 * 1024 * 1024,   // 10MB
        50 * 1024 * 1024,   // 50MB
        100 * 1024 * 1024   // 100MB
      ];

      const benchmarkResults = [];

      for (const fileSize of fileSizes) {
        const startTime = Date.now();

        const presignedResponse = await request(app)
          .post('/api/upload/presigned')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            filename: `benchmark-${fileSize / (1024 * 1024)}mb.bin`,
            contentType: 'application/octet-stream',
            fileSize: fileSize
          })
          .expect(200);

        await request(app)
          .post(`/api/upload/confirm/${presignedResponse.body.artifactId}`)
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            s3Key: `benchmark/test-${fileSize}.bin`,
            etag: `etag-${fileSize}`
          })
          .expect(200);

        const endTime = Date.now();
        const processingTime = endTime - startTime;

        benchmarkResults.push({
          fileSize: fileSize / (1024 * 1024), // MB
          processingTime: processingTime
        });

        console.log(`${fileSize / (1024 * 1024)}MB file: ${processingTime}ms`);
      }

      // Verify processing time scales reasonably with file size
      const timePerMB = benchmarkResults.map(r => r.processingTime / r.fileSize);
      const avgTimePerMB = timePerMB.reduce((a, b) => a + b, 0) / timePerMB.length;
      
      console.log(`Average processing time per MB: ${avgTimePerMB.toFixed(2)}ms`);
      expect(avgTimePerMB).toBeLessThan(100); // Should be less than 100ms per MB
    });
  });

  describe('High-Resolution Image Processing Performance', () => {
    test('should process 4K image efficiently', async () => {
      // Create a test 4K image buffer
      const width = 3840;
      const height = 2160;
      const testImageBuffer = await sharp({
        create: {
          width: width,
          height: height,
          channels: 3,
          background: { r: 255, g: 0, b: 0 }
        }
      })
      .jpeg()
      .toBuffer();

      // Mock S3 to return our test image
      s3Mock.getObject.mockReturnValueOnce({
        promise: jest.fn().mockResolvedValue({
          Body: testImageBuffer,
          ContentType: 'image/jpeg'
        })
      });

      const startTime = Date.now();

      const presignedResponse = await request(app)
        .post('/api/upload/presigned')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filename: '4k-test-image.jpg',
          contentType: 'image/jpeg',
          fileSize: testImageBuffer.length
        })
        .expect(200);

      const confirmResponse = await request(app)
        .post(`/api/upload/confirm/${presignedResponse.body.artifactId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          s3Key: 'images/4k-test.jpg',
          etag: '4k-image-etag',
          metadata: {
            width: width,
            height: height,
            format: 'jpeg'
          }
        })
        .expect(200);

      const endTime = Date.now();
      const totalTime = endTime - startTime;

      console.log(`4K image upload processing: ${totalTime}ms`);
      expect(totalTime).toBeLessThan(8000); // Should complete within 8 seconds

      // Verify image processing job was queued
      expect(queueMock.add).toHaveBeenCalledWith(
        'process-image',
        expect.objectContaining({
          artifactId: presignedResponse.body.artifactId,
          s3Key: 'images/4k-test.jpg'
        })
      );
    });

    test('should benchmark image processing by resolution', async () => {
      const resolutions = [
        { name: 'HD', width: 1920, height: 1080 },
        { name: '2K', width: 2560, height: 1440 },
        { name: '4K', width: 3840, height: 2160 },
        { name: '8K', width: 7680, height: 4320 }
      ];

      const imageProcessingResults = [];

      for (const resolution of resolutions) {
        const testImageBuffer = await sharp({
          create: {
            width: resolution.width,
            height: resolution.height,
            channels: 3,
            background: { r: 0, g: 255, b: 0 }
          }
        })
        .jpeg({ quality: 90 })
        .toBuffer();

        s3Mock.getObject.mockReturnValueOnce({
          promise: jest.fn().mockResolvedValue({
            Body: testImageBuffer,
            ContentType: 'image/jpeg'
          })
        });

        const startTime = Date.now();

        const presignedResponse = await request(app)
          .post('/api/upload/presigned')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            filename: `${resolution.name.toLowerCase()}-test.jpg`,
            contentType: 'image/jpeg',
            fileSize: testImageBuffer.length
          })
          .expect(200);

        await request(app)
          .post(`/api/upload/confirm/${presignedResponse.body.artifactId}`)
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            s3Key: `images/${resolution.name.toLowerCase()}-test.jpg`,
            etag: `${resolution.name.toLowerCase()}-etag`,
            metadata: {
              width: resolution.width,
              height: resolution.height,
              format: 'jpeg'
            }
          })
          .expect(200);

        const endTime = Date.now();
        const processingTime = endTime - startTime;
        const megapixels = (resolution.width * resolution.height) / (1024 * 1024);

        imageProcessingResults.push({
          resolution: resolution.name,
          megapixels: megapixels,
          fileSize: testImageBuffer.length / (1024 * 1024), // MB
          processingTime: processingTime
        });

        console.log(`${resolution.name} (${megapixels.toFixed(1)}MP): ${processingTime}ms`);
      }

      // Verify processing time scales reasonably with image size
      const timePerMegapixel = imageProcessingResults.map(r => r.processingTime / r.megapixels);
      const avgTimePerMP = timePerMegapixel.reduce((a, b) => a + b, 0) / timePerMegapixel.length;
      
      console.log(`Average processing time per megapixel: ${avgTimePerMP.toFixed(2)}ms`);
      expect(avgTimePerMP).toBeLessThan(500); // Should be less than 500ms per megapixel
    });

    test('should handle batch image processing efficiently', async () => {
      const batchSize = 10;
      const imagePromises = [];

      for (let i = 0; i < batchSize; i++) {
        const testImageBuffer = await sharp({
          create: {
            width: 1920,
            height: 1080,
            channels: 3,
            background: { r: i * 25, g: 128, b: 255 - (i * 25) }
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

        const imagePromise = async () => {
          const presignedResponse = await request(app)
            .post('/api/upload/presigned')
            .set('Authorization', `Bearer ${authToken}`)
            .send({
              filename: `batch-image-${i}.jpg`,
              contentType: 'image/jpeg',
              fileSize: testImageBuffer.length
            });

          await request(app)
            .post(`/api/upload/confirm/${presignedResponse.body.artifactId}`)
            .set('Authorization', `Bearer ${authToken}`)
            .send({
              s3Key: `images/batch/image-${i}.jpg`,
              etag: `batch-etag-${i}`,
              metadata: {
                width: 1920,
                height: 1080,
                format: 'jpeg'
              }
            });

          return presignedResponse.body.artifactId;
        };

        imagePromises.push(imagePromise());
      }

      const startTime = Date.now();
      const artifactIds = await Promise.all(imagePromises);
      const endTime = Date.now();
      const totalTime = endTime - startTime;

      console.log(`Batch processing ${batchSize} HD images: ${totalTime}ms`);
      expect(totalTime).toBeLessThan(30000); // Should complete within 30 seconds
      expect(artifactIds).toHaveLength(batchSize);

      // Verify all image processing jobs were queued
      const imageProcessingCalls = queueMock.add.mock.calls.filter(
        call => call[0] === 'process-image'
      );
      expect(imageProcessingCalls).toHaveLength(batchSize);
    });
  });

  describe('Memory and Resource Usage', () => {
    test('should handle large file processing without memory leaks', async () => {
      const initialMemory = process.memoryUsage();
      const fileCount = 20;
      const fileSize = 10 * 1024 * 1024; // 10MB each

      for (let i = 0; i < fileCount; i++) {
        const presignedResponse = await request(app)
          .post('/api/upload/presigned')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            filename: `memory-test-${i}.bin`,
            contentType: 'application/octet-stream',
            fileSize: fileSize
          })
          .expect(200);

        await request(app)
          .post(`/api/upload/confirm/${presignedResponse.body.artifactId}`)
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            s3Key: `memory-test/file-${i}.bin`,
            etag: `memory-etag-${i}`
          })
          .expect(200);

        // Force garbage collection if available
        if (global.gc) {
          global.gc();
        }
      }

      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
      const memoryIncreasePerFile = memoryIncrease / fileCount;

      console.log(`Memory increase per file: ${(memoryIncreasePerFile / (1024 * 1024)).toFixed(2)}MB`);
      
      // Memory increase should be reasonable (less than 5MB per file)
      expect(memoryIncreasePerFile).toBeLessThan(5 * 1024 * 1024);
    });

    test('should maintain consistent performance under sustained load', async () => {
      const rounds = 5;
      const filesPerRound = 10;
      const performanceData = [];

      for (let round = 0; round < rounds; round++) {
        const roundStartTime = Date.now();
        const roundPromises = [];

        for (let i = 0; i < filesPerRound; i++) {
          const filePromise = async () => {
            const presignedResponse = await request(app)
              .post('/api/upload/presigned')
              .set('Authorization', `Bearer ${authToken}`)
              .send({
                filename: `sustained-${round}-${i}.txt`,
                contentType: 'text/plain',
                fileSize: 1024 * 1024 // 1MB
              });

            await request(app)
              .post(`/api/upload/confirm/${presignedResponse.body.artifactId}`)
              .set('Authorization', `Bearer ${authToken}`)
              .send({
                s3Key: `sustained/round-${round}-file-${i}.txt`,
                etag: `sustained-etag-${round}-${i}`
              });
          };

          roundPromises.push(filePromise());
        }

        await Promise.all(roundPromises);
        const roundEndTime = Date.now();
        const roundTime = roundEndTime - roundStartTime;

        performanceData.push(roundTime);
        console.log(`Round ${round + 1}: ${filesPerRound} files in ${roundTime}ms`);

        // Brief pause between rounds
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Analyze performance consistency
      const avgTime = performanceData.reduce((a, b) => a + b, 0) / performanceData.length;
      const maxTime = Math.max(...performanceData);
      const minTime = Math.min(...performanceData);
      const variance = maxTime - minTime;

      console.log(`Performance variance: ${variance}ms (${((variance / avgTime) * 100).toFixed(1)}%)`);
      
      // Performance should be consistent (variance less than 50% of average)
      expect(variance / avgTime).toBeLessThan(0.5);
    });
  });
});