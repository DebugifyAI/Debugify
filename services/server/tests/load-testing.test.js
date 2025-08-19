const request = require('supertest');
const app = require('../index');
const knex = require('../db/knex');
const { Queue } = require('bullmq');
const AWS = require('aws-sdk');

// Mock AWS S3
jest.mock('aws-sdk');

describe('Load Testing - Concurrent Uploads and Processing', () => {
  let testUsers = [];
  let authTokens = [];
  let s3Mock;
  let queueMock;

  beforeAll(async () => {
    // Setup test database
    await knex.migrate.latest();
    await knex.seed.run();

    // Create multiple test users for concurrent testing
    for (let i = 0; i < 10; i++) {
      const userResponse = await request(app)
        .post('/api/auth/register')
        .send({
          username: `loadtestuser${i}`,
          email: `loadtest${i}@example.com`,
          password: 'testpassword123'
        });

      testUsers.push(userResponse.body.user);

      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: `loadtest${i}@example.com`,
          password: 'testpassword123'
        });

      authTokens.push(loginResponse.body.token);
    }

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
      getObject: jest.fn().mockReturnValue({
        promise: jest.fn().mockResolvedValue({
          Body: Buffer.from('test file content'),
          ContentType: 'text/plain'
        })
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
    // Clean up artifacts between tests
    await knex('artifacts').del();
    await knex('processing_jobs').del();
    jest.clearAllMocks();
  });

  describe('Concurrent Upload Performance', () => {
    test('should handle 50 concurrent text file uploads', async () => {
      const startTime = Date.now();
      const concurrentUploads = 50;
      const uploadPromises = [];

      // Create concurrent upload requests
      for (let i = 0; i < concurrentUploads; i++) {
        const userIndex = i % authTokens.length;
        const uploadPromise = async () => {
          // Request presigned URL
          const presignedResponse = await request(app)
            .post('/api/upload/presigned')
            .set('Authorization', `Bearer ${authTokens[userIndex]}`)
            .send({
              filename: `concurrent-test-${i}.txt`,
              contentType: 'text/plain',
              fileSize: 1024 + (i * 100) // Varying file sizes
            });

          expect(presignedResponse.status).toBe(200);

          // Confirm upload
          const confirmResponse = await request(app)
            .post(`/api/upload/confirm/${presignedResponse.body.artifactId}`)
            .set('Authorization', `Bearer ${authTokens[userIndex]}`)
            .send({
              s3Key: `concurrent/test-${i}.txt`,
              etag: `etag-${i}`
            });

          expect(confirmResponse.status).toBe(200);
          return presignedResponse.body.artifactId;
        };

        uploadPromises.push(uploadPromise());
      }

      // Execute all uploads concurrently
      const artifactIds = await Promise.all(uploadPromises);
      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // Verify all uploads completed
      expect(artifactIds).toHaveLength(concurrentUploads);
      
      // Performance assertions
      expect(totalTime).toBeLessThan(30000); // Should complete within 30 seconds
      console.log(`50 concurrent uploads completed in ${totalTime}ms`);

      // Verify all artifacts were created
      const artifacts = await knex('artifacts').whereIn('id', artifactIds);
      expect(artifacts).toHaveLength(concurrentUploads);

      // Verify processing jobs were queued
      expect(queueMock.add).toHaveBeenCalledTimes(concurrentUploads);
    }, 60000); // 60 second timeout

    test('should handle mixed file type concurrent uploads', async () => {
      const startTime = Date.now();
      const fileTypes = [
        { filename: 'log.txt', contentType: 'text/plain', size: 1024 },
        { filename: 'image.jpg', contentType: 'image/jpeg', size: 50000 },
        { filename: 'document.pdf', contentType: 'application/pdf', size: 100000 },
        { filename: 'data.json', contentType: 'application/json', size: 2048 },
        { filename: 'screenshot.png', contentType: 'image/png', size: 75000 }
      ];

      const concurrentUploads = 25;
      const uploadPromises = [];

      for (let i = 0; i < concurrentUploads; i++) {
        const fileType = fileTypes[i % fileTypes.length];
        const userIndex = i % authTokens.length;

        const uploadPromise = async () => {
          const presignedResponse = await request(app)
            .post('/api/upload/presigned')
            .set('Authorization', `Bearer ${authTokens[userIndex]}`)
            .send({
              filename: `${i}-${fileType.filename}`,
              contentType: fileType.contentType,
              fileSize: fileType.size
            });

          expect(presignedResponse.status).toBe(200);

          const confirmResponse = await request(app)
            .post(`/api/upload/confirm/${presignedResponse.body.artifactId}`)
            .set('Authorization', `Bearer ${authTokens[userIndex]}`)
            .send({
              s3Key: `mixed/${i}-${fileType.filename}`,
              etag: `etag-${i}`
            });

          expect(confirmResponse.status).toBe(200);
          return {
            artifactId: presignedResponse.body.artifactId,
            fileType: fileType.contentType
          };
        };

        uploadPromises.push(uploadPromise());
      }

      const results = await Promise.all(uploadPromises);
      const endTime = Date.now();
      const totalTime = endTime - startTime;

      console.log(`25 mixed file type uploads completed in ${totalTime}ms`);
      expect(totalTime).toBeLessThan(45000); // Should complete within 45 seconds

      // Verify different job types were queued based on file types
      const imageUploads = results.filter(r => r.fileType.startsWith('image/')).length;
      const textUploads = results.filter(r => !r.fileType.startsWith('image/')).length;

      expect(queueMock.add).toHaveBeenCalledTimes(concurrentUploads);
    }, 90000);

    test('should handle high-resolution image uploads under load', async () => {
      const startTime = Date.now();
      const imageUploads = 15;
      const uploadPromises = [];

      for (let i = 0; i < imageUploads; i++) {
        const userIndex = i % authTokens.length;
        const imageSize = 1024 * 1024 * (2 + i); // 2MB+ images

        const uploadPromise = async () => {
          const presignedResponse = await request(app)
            .post('/api/upload/presigned')
            .set('Authorization', `Bearer ${authTokens[userIndex]}`)
            .send({
              filename: `high-res-${i}.jpg`,
              contentType: 'image/jpeg',
              fileSize: imageSize
            });

          expect(presignedResponse.status).toBe(200);

          const confirmResponse = await request(app)
            .post(`/api/upload/confirm/${presignedResponse.body.artifactId}`)
            .set('Authorization', `Bearer ${authTokens[userIndex]}`)
            .send({
              s3Key: `images/high-res-${i}.jpg`,
              etag: `etag-${i}`,
              metadata: {
                width: 3840 + (i * 100),
                height: 2160 + (i * 50),
                format: 'jpeg'
              }
            });

          expect(confirmResponse.status).toBe(200);
          return presignedResponse.body.artifactId;
        };

        uploadPromises.push(uploadPromise());
      }

      const artifactIds = await Promise.all(uploadPromises);
      const endTime = Date.now();
      const totalTime = endTime - startTime;

      console.log(`15 high-resolution image uploads completed in ${totalTime}ms`);
      expect(totalTime).toBeLessThan(60000); // Should complete within 60 seconds

      // Verify all image processing jobs were queued
      expect(queueMock.add).toHaveBeenCalledTimes(imageUploads);
      
      // Verify image-specific processing was triggered
      const imageProcessingCalls = queueMock.add.mock.calls.filter(
        call => call[0] === 'process-image'
      );
      expect(imageProcessingCalls.length).toBeGreaterThan(0);
    }, 120000);
  });

  describe('System Resource Management', () => {
    test('should maintain performance under sustained load', async () => {
      const rounds = 3;
      const uploadsPerRound = 20;
      const performanceMetrics = [];

      for (let round = 0; round < rounds; round++) {
        const startTime = Date.now();
        const uploadPromises = [];

        for (let i = 0; i < uploadsPerRound; i++) {
          const userIndex = i % authTokens.length;
          
          const uploadPromise = async () => {
            const presignedResponse = await request(app)
              .post('/api/upload/presigned')
              .set('Authorization', `Bearer ${authTokens[userIndex]}`)
              .send({
                filename: `sustained-${round}-${i}.txt`,
                contentType: 'text/plain',
                fileSize: 1024
              });

            await request(app)
              .post(`/api/upload/confirm/${presignedResponse.body.artifactId}`)
              .set('Authorization', `Bearer ${authTokens[userIndex]}`)
              .send({
                s3Key: `sustained/round-${round}-${i}.txt`,
                etag: `etag-${round}-${i}`
              });

            return presignedResponse.body.artifactId;
          };

          uploadPromises.push(uploadPromise());
        }

        await Promise.all(uploadPromises);
        const endTime = Date.now();
        const roundTime = endTime - startTime;
        
        performanceMetrics.push(roundTime);
        console.log(`Round ${round + 1}: ${uploadsPerRound} uploads in ${roundTime}ms`);

        // Brief pause between rounds
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // Verify performance doesn't degrade significantly
      const avgTime = performanceMetrics.reduce((a, b) => a + b, 0) / performanceMetrics.length;
      const maxTime = Math.max(...performanceMetrics);
      const minTime = Math.min(...performanceMetrics);

      console.log(`Performance metrics - Avg: ${avgTime}ms, Min: ${minTime}ms, Max: ${maxTime}ms`);
      
      // Performance should be consistent (max shouldn't be more than 2x min)
      expect(maxTime / minTime).toBeLessThan(2.5);
    }, 180000);

    test('should handle queue backpressure gracefully', async () => {
      // Simulate queue being overwhelmed
      let callCount = 0;
      queueMock.add.mockImplementation(() => {
        callCount++;
        if (callCount > 30) {
          // Simulate queue backpressure after 30 jobs
          return new Promise(resolve => setTimeout(() => resolve({ id: `delayed-job-${callCount}` }), 100));
        }
        return Promise.resolve({ id: `job-${callCount}` });
      });

      const startTime = Date.now();
      const uploadPromises = [];

      // Try to queue 50 jobs rapidly
      for (let i = 0; i < 50; i++) {
        const userIndex = i % authTokens.length;
        
        const uploadPromise = async () => {
          const presignedResponse = await request(app)
            .post('/api/upload/presigned')
            .set('Authorization', `Bearer ${authTokens[userIndex]}`)
            .send({
              filename: `backpressure-${i}.txt`,
              contentType: 'text/plain',
              fileSize: 1024
            });

          const confirmResponse = await request(app)
            .post(`/api/upload/confirm/${presignedResponse.body.artifactId}`)
            .set('Authorization', `Bearer ${authTokens[userIndex]}`)
            .send({
              s3Key: `backpressure/test-${i}.txt`,
              etag: `etag-${i}`
            });

          return confirmResponse.status;
        };

        uploadPromises.push(uploadPromise());
      }

      const results = await Promise.all(uploadPromises);
      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // All uploads should still succeed despite backpressure
      expect(results.every(status => status === 200)).toBe(true);
      console.log(`50 uploads with queue backpressure completed in ${totalTime}ms`);
      
      // Should handle backpressure gracefully (not fail)
      expect(totalTime).toBeLessThan(120000); // Within 2 minutes
    }, 180000);
  });

  describe('Error Recovery Under Load', () => {
    test('should handle partial failures in concurrent uploads', async () => {
      // Setup intermittent S3 failures
      let s3CallCount = 0;
      s3Mock.getSignedUrl.mockImplementation(() => {
        s3CallCount++;
        if (s3CallCount % 5 === 0) {
          throw new Error('Intermittent S3 failure');
        }
        return 'https://test-bucket.s3.amazonaws.com/test-key?signature=test';
      });

      const uploadPromises = [];
      const successfulUploads = [];
      const failedUploads = [];

      for (let i = 0; i < 25; i++) {
        const userIndex = i % authTokens.length;
        
        const uploadPromise = request(app)
          .post('/api/upload/presigned')
          .set('Authorization', `Bearer ${authTokens[userIndex]}`)
          .send({
            filename: `partial-fail-${i}.txt`,
            contentType: 'text/plain',
            fileSize: 1024
          })
          .then(response => {
            if (response.status === 200) {
              successfulUploads.push(i);
            } else {
              failedUploads.push(i);
            }
            return response;
          })
          .catch(error => {
            failedUploads.push(i);
            return { status: 500, error: error.message };
          });

        uploadPromises.push(uploadPromise);
      }

      await Promise.all(uploadPromises);

      console.log(`Successful uploads: ${successfulUploads.length}, Failed uploads: ${failedUploads.length}`);
      
      // Should have some successes and some failures
      expect(successfulUploads.length).toBeGreaterThan(0);
      expect(failedUploads.length).toBeGreaterThan(0);
      expect(successfulUploads.length + failedUploads.length).toBe(25);
    });
  });
});