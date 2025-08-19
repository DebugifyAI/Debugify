const sharp = require('sharp');
const aws = require('aws-sdk');

// Configure AWS S3
const s3 = new aws.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1',
});

/**
 * Image optimization service for upload processing
 */
class ImageOptimizationService {
  constructor(s3Instance = null) {
    this.s3 = s3Instance || s3;
    this.supportedFormats = ['jpeg', 'jpg', 'png', 'webp', 'gif', 'bmp', 'tiff'];
    this.maxDimension = 4096; // Maximum width or height
    this.qualitySettings = {
      thumbnail: { width: 150, height: 150, quality: 80 },
      small: { width: 400, height: 400, quality: 85 },
      medium: { width: 800, height: 800, quality: 90 },
      large: { width: 1920, height: 1920, quality: 95 },
    };
  }

  /**
   * Check if file is an image based on content type
   */
  isImage(contentType) {
    return Boolean(contentType && contentType.startsWith('image/'));
  }

  /**
   * Get image format from content type
   */
  getImageFormat(contentType) {
    const formatMap = {
      'image/jpeg': 'jpeg',
      'image/jpg': 'jpeg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'image/bmp': 'bmp',
      'image/tiff': 'tiff',
    };
    return formatMap[contentType] || 'jpeg';
  }

  /**
   * Validate image dimensions and size
   */
  async validateImage(imageBuffer, contentType, maxSizeBytes = 50 * 1024 * 1024) {
    const errors = [];

    try {
      const metadata = await sharp(imageBuffer).metadata();

      // Check dimensions
      if (metadata.width > this.maxDimension || metadata.height > this.maxDimension) {
        errors.push(`Image dimensions ${metadata.width}x${metadata.height} exceed maximum allowed ${this.maxDimension}x${this.maxDimension}`);
      }

      // Check file size
      if (imageBuffer.length > maxSizeBytes) {
        errors.push(`Image size ${imageBuffer.length} bytes exceeds maximum allowed ${maxSizeBytes} bytes`);
      }

      // Check if format is supported by checking the content type directly
      const formatMap = {
        'image/jpeg': 'jpeg',
        'image/jpg': 'jpeg',
        'image/png': 'png',
        'image/webp': 'webp',
        'image/gif': 'gif',
        'image/bmp': 'bmp',
        'image/tiff': 'tiff',
      };
      
      if (!formatMap[contentType]) {
        const format = contentType.replace('image/', '');
        errors.push(`Image format ${format} is not supported`);
      }

      return {
        valid: errors.length === 0,
        errors,
        metadata,
      };
    } catch (error) {
      return {
        valid: false,
        errors: [`Invalid image file: ${error.message}`],
        metadata: null,
      };
    }
  }

  /**
   * Generate optimized image variants
   */
  async generateVariants(imageBuffer, originalFormat = 'jpeg') {
    const variants = {};

    try {
      const originalMetadata = await sharp(imageBuffer).metadata();

      // Generate different sizes
      for (const [variantName, settings] of Object.entries(this.qualitySettings)) {
        try {
          let pipeline = sharp(imageBuffer);

          // Resize if image is larger than variant size
          if (originalMetadata.width > settings.width || originalMetadata.height > settings.height) {
            pipeline = pipeline.resize(settings.width, settings.height, {
              fit: 'inside',
              withoutEnlargement: true,
            });
          }

          // Convert to WebP for better compression (except for thumbnails which stay as JPEG)
          const outputFormat = variantName === 'thumbnail' ? 'jpeg' : 'webp';
          
          if (outputFormat === 'webp') {
            pipeline = pipeline.webp({ quality: settings.quality });
          } else {
            pipeline = pipeline.jpeg({ quality: settings.quality });
          }

          const optimizedBuffer = await pipeline.toBuffer();
          const optimizedMetadata = await sharp(optimizedBuffer).metadata();

          variants[variantName] = {
            buffer: optimizedBuffer,
            format: outputFormat,
            size: optimizedBuffer.length,
            width: optimizedMetadata.width,
            height: optimizedMetadata.height,
            quality: settings.quality,
          };
        } catch (error) {
          console.error(`Error generating ${variantName} variant:`, error);
          // Continue with other variants even if one fails
        }
      }

      // Check if we have any successful variants
      if (Object.keys(variants).length === 0) {
        throw new Error('Failed to generate any image variants');
      }

      return variants;
    } catch (error) {
      console.error('Error generating image variants:', error);
      throw new Error(`Failed to generate image variants: ${error.message}`);
    }
  }

  /**
   * Upload image variants to S3
   */
  async uploadVariants(variants, baseS3Key, bucket) {
    const uploadedVariants = {};

    for (const [variantName, variantData] of Object.entries(variants)) {
      try {
        // Generate S3 key for variant
        const variantKey = this.generateVariantS3Key(baseS3Key, variantName, variantData.format);
        
        const uploadParams = {
          Bucket: bucket,
          Key: variantKey,
          Body: variantData.buffer,
          ContentType: `image/${variantData.format}`,
          Metadata: {
            'variant-type': variantName,
            'original-key': baseS3Key,
            width: variantData.width.toString(),
            height: variantData.height.toString(),
            quality: variantData.quality.toString(),
          },
        };

        const result = await this.s3.upload(uploadParams).promise();

        uploadedVariants[variantName] = {
          s3Key: variantKey,
          s3Url: result.Location,
          etag: result.ETag,
          size: variantData.size,
          width: variantData.width,
          height: variantData.height,
          format: variantData.format,
          quality: variantData.quality,
        };
      } catch (error) {
        console.error(`Error uploading ${variantName} variant:`, error);
        // Continue with other variants even if one fails
      }
    }

    return uploadedVariants;
  }

  /**
   * Generate S3 key for image variant
   */
  generateVariantS3Key(originalKey, variantName, format) {
    const keyParts = originalKey.split('.');
    if (keyParts.length > 1) {
      const extension = keyParts.pop();
      const baseName = keyParts.join('.');
      return `${baseName}_${variantName}.${format}`;
    }
    
    return `${originalKey}_${variantName}.${format}`;
  }

  /**
   * Optimize image for upload (compress and convert if needed)
   */
  async optimizeForUpload(imageBuffer, contentType, targetSizeBytes = 5 * 1024 * 1024) {
    try {
      const originalMetadata = await sharp(imageBuffer).metadata();
      const originalSize = imageBuffer.length;

      // If image is already small enough and in a good format, return as-is
      if (originalSize <= targetSizeBytes && (contentType === 'image/webp' || contentType === 'image/jpeg')) {
        return {
          buffer: imageBuffer,
          contentType,
          metadata: originalMetadata,
          optimized: false,
          compressionRatio: 1,
        };
      }

      let pipeline = sharp(imageBuffer);
      let quality = 90;
      let optimizedBuffer;
      let attempts = 0;
      const maxAttempts = 5;

      // Try different quality settings to reach target size
      do {
        pipeline = sharp(imageBuffer);

        // Resize if image is very large
        if (originalMetadata.width > 2048 || originalMetadata.height > 2048) {
          pipeline = pipeline.resize(2048, 2048, {
            fit: 'inside',
            withoutEnlargement: true,
          });
        }

        // Convert to WebP for better compression
        pipeline = pipeline.webp({ quality });
        optimizedBuffer = await pipeline.toBuffer();

        // Reduce quality if still too large
        if (optimizedBuffer.length > targetSizeBytes && attempts < maxAttempts) {
          quality -= 15;
          attempts += 1;
        } else {
          break;
        }
      } while (optimizedBuffer.length > targetSizeBytes && quality > 30);

      const optimizedMetadata = await sharp(optimizedBuffer).metadata();

      return {
        buffer: optimizedBuffer,
        contentType: 'image/webp',
        metadata: optimizedMetadata,
        optimized: true,
        compressionRatio: originalSize / optimizedBuffer.length,
        originalSize,
        optimizedSize: optimizedBuffer.length,
        qualityUsed: quality,
      };
    } catch (error) {
      console.error('Error optimizing image for upload:', error);
      throw new Error(`Failed to optimize image: ${error.message}`);
    }
  }

  /**
   * Extract comprehensive image metadata
   */
  async extractMetadata(imageBuffer) {
    try {
      const metadata = await sharp(imageBuffer).metadata();
      
      return {
        width: metadata.width,
        height: metadata.height,
        format: metadata.format,
        size: imageBuffer.length,
        channels: metadata.channels,
        depth: metadata.depth,
        density: metadata.density,
        colorSpace: metadata.space,
        hasAlpha: metadata.hasAlpha,
        isAnimated: metadata.pages > 1,
        pages: metadata.pages,
        orientation: metadata.orientation,
        exif: metadata.exif ? this.parseExifData(metadata.exif) : null,
      };
    } catch (error) {
      console.error('Error extracting image metadata:', error);
      return null;
    }
  }

  /**
   * Parse EXIF data from image
   */
  parseExifData(exifBuffer) {
    try {
      // This is a simplified EXIF parser
      // In a production environment, you might want to use a dedicated EXIF library
      return {
        hasExif: true,
        size: exifBuffer.length,
        // Add more EXIF parsing as needed
      };
    } catch (error) {
      console.error('Error parsing EXIF data:', error);
      return { hasExif: false };
    }
  }

  /**
   * Process image upload with optimization and variant generation
   */
  async processImageUpload(s3Bucket, s3Key, contentType) {
    try {
      // Download original image from S3
      const originalObject = await this.s3.getObject({
        Bucket: s3Bucket,
        Key: s3Key,
      }).promise();

      const imageBuffer = originalObject.Body;

      // Validate image
      const validation = await this.validateImage(imageBuffer, contentType);
      if (!validation.valid) {
        throw new Error(`Image validation failed: ${validation.errors.join(', ')}`);
      }

      // Extract metadata
      const metadata = await this.extractMetadata(imageBuffer);

      // Generate variants
      const variants = await this.generateVariants(imageBuffer, this.getImageFormat(contentType));

      // Upload variants to S3
      const uploadedVariants = await this.uploadVariants(variants, s3Key, s3Bucket);

      return {
        success: true,
        metadata,
        variants: uploadedVariants,
        originalSize: imageBuffer.length,
        variantCount: Object.keys(uploadedVariants).length,
      };
    } catch (error) {
      console.error('Error processing image upload:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

module.exports = ImageOptimizationService;