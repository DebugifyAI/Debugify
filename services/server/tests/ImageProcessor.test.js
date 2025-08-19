const ImageProcessor = require('../services/ImageProcessor');
const sharp = require('sharp');
const fs = require('fs').promises;
const path = require('path');

describe('ImageProcessor', () => {
  let imageProcessor;
  let testImageBuffer;
  let testImageWithTextBuffer;

  beforeAll(async () => {
    imageProcessor = new ImageProcessor();
    
    // Create test images
    testImageBuffer = await sharp({
      create: {
        width: 800,
        height: 600,
        channels: 3,
        background: { r: 255, g: 255, b: 255 }
      }
    })
    .png()
    .toBuffer();

    // Create test image with text overlay for OCR testing
    testImageWithTextBuffer = await sharp({
      create: {
        width: 400,
        height: 200,
        channels: 3,
        background: { r: 255, g: 255, b: 255 }
      }
    })
    .composite([{
      input: Buffer.from(`
        <svg width="400" height="200">
          <text x="20" y="50" font-family="Arial" font-size="24" fill="black">
            Hello World Test
          </text>
          <text x="20" y="100" font-family="Arial" font-size="18" fill="black">
            API Key: sk-test123456789012345678901234567890123456
          </text>
          <text x="20" y="150" font-family="Arial" font-size="16" fill="black">
            function testCode() { return true; }
          </text>
        </svg>
      `),
      top: 0,
      left: 0
    }])
    .png()
    .toBuffer();
  });

  describe('constructor', () => {
    test('should initialize with default configuration', () => {
      expect(imageProcessor.supportedFormats).toContain('jpeg');
      expect(imageProcessor.supportedFormats).toContain('png');
      expect(imageProcessor.supportedFormats).toContain('webp');
      expect(imageProcessor.thumbnailSizes).toHaveLength(3);
    });

    test('should have sensitive data patterns configured', () => {
      expect(imageProcessor.sensitivePatterns.apiKeys).toBeDefined();
      expect(imageProcessor.sensitivePatterns.credentials).toBeDefined();
      expect(imageProcessor.sensitivePatterns.pii).toBeDefined();
    });
  });

  describe('isValidImage', () => {
    test('should validate supported image formats', async () => {
      const isValid = await imageProcessor.isValidImage(testImageBuffer);
      expect(isValid).toBe(true);
    });

    test('should reject invalid image data', async () => {
      const invalidBuffer = Buffer.from('not an image');
      const isValid = await imageProcessor.isValidImage(invalidBuffer);
      expect(isValid).toBe(false);
    });
  });

  describe('extractMetadata', () => {
    test('should extract basic image metadata', async () => {
      const metadata = await imageProcessor.extractMetadata(testImageBuffer);
      
      expect(metadata).toHaveProperty('format');
      expect(metadata).toHaveProperty('width');
      expect(metadata).toHaveProperty('height');
      expect(metadata).toHaveProperty('size');
      expect(metadata).toHaveProperty('aspectRatio');
      expect(metadata.width).toBe(800);
      expect(metadata.height).toBe(600);
      expect(metadata.aspectRatio).toBeCloseTo(1.33, 2);
    });

    test('should handle metadata extraction errors gracefully', async () => {
      const invalidBuffer = Buffer.from('invalid');
      
      await expect(imageProcessor.extractMetadata(invalidBuffer))
        .rejects.toThrow('Metadata extraction failed');
    });
  });

  describe('generateVariants', () => {
    test('should generate thumbnail variants in multiple formats', async () => {
      const variants = await imageProcessor.generateVariants(testImageBuffer, ['webp', 'jpeg']);
      
      expect(variants).toHaveProperty('small');
      expect(variants).toHaveProperty('medium');
      expect(variants).toHaveProperty('large');
      expect(variants).toHaveProperty('webOptimized');
      
      expect(variants.small).toHaveProperty('webp');
      expect(variants.small).toHaveProperty('jpeg');
      expect(Buffer.isBuffer(variants.small.webp)).toBe(true);
      expect(Buffer.isBuffer(variants.small.jpeg)).toBe(true);
    });

    test('should maintain aspect ratio in thumbnails', async () => {
      const variants = await imageProcessor.generateVariants(testImageBuffer);
      
      // Check that small thumbnail maintains reasonable dimensions
      const smallWebp = variants.small.webp;
      const metadata = await sharp(smallWebp).metadata();
      
      expect(metadata.width).toBeLessThanOrEqual(150);
      expect(metadata.height).toBeLessThanOrEqual(150);
    });

    test('should handle variant generation errors', async () => {
      const invalidBuffer = Buffer.from('invalid');
      
      await expect(imageProcessor.generateVariants(invalidBuffer))
        .rejects.toThrow('Variant generation failed');
    });
  });

  describe('extractTextOCR', () => {
    test('should extract text from images with OCR', async () => {
      const ocrResult = await imageProcessor.extractTextOCR(testImageWithTextBuffer);
      
      expect(ocrResult).toHaveProperty('text');
      expect(ocrResult).toHaveProperty('confidence');
      expect(ocrResult).toHaveProperty('words');
      expect(ocrResult).toHaveProperty('lines');
      expect(ocrResult).toHaveProperty('paragraphs');
      
      // Note: OCR results may vary, so we check for structure rather than exact content
      expect(typeof ocrResult.text).toBe('string');
      expect(typeof ocrResult.confidence).toBe('number');
      expect(Array.isArray(ocrResult.words)).toBe(true);
    }, 30000); // OCR can be slow

    test('should handle OCR errors gracefully', async () => {
      const invalidBuffer = Buffer.from('invalid');
      const ocrResult = await imageProcessor.extractTextOCR(invalidBuffer);
      
      expect(ocrResult.text).toBe('');
      expect(ocrResult.confidence).toBe(0);
      expect(ocrResult.words).toEqual([]);
    });

    test('should support multiple languages', async () => {
      const ocrResult = await imageProcessor.extractTextOCR(testImageWithTextBuffer, ['eng', 'spa']);
      
      expect(ocrResult).toHaveProperty('text');
      expect(ocrResult).toHaveProperty('confidence');
    }, 30000);
  });

  describe('detectVisualElements', () => {
    test('should analyze visual elements in images', async () => {
      const elements = await imageProcessor.detectVisualElements(testImageBuffer);
      
      expect(elements).toHaveProperty('hasButtons');
      expect(elements).toHaveProperty('hasText');
      expect(elements).toHaveProperty('hasCharts');
      expect(elements).toHaveProperty('hasDiagrams');
      expect(elements).toHaveProperty('hasCode');
      expect(elements).toHaveProperty('layout');
      expect(elements).toHaveProperty('colorAnalysis');
      
      expect(typeof elements.hasButtons).toBe('boolean');
      expect(elements.layout).toHaveProperty('type');
    });

    test('should handle visual element detection errors', async () => {
      const invalidBuffer = Buffer.from('invalid');
      const elements = await imageProcessor.detectVisualElements(invalidBuffer);
      
      expect(elements.hasButtons).toBe(false);
      expect(elements.layout.type).toBe('unknown');
    });
  });

  describe('analyzeLayout', () => {
    test('should classify landscape images correctly', () => {
      const layout = imageProcessor.analyzeLayout(1920, 800);
      expect(layout.type).toBe('banner');
      expect(layout.orientation).toBe('landscape');
    });

    test('should classify portrait images correctly', () => {
      const layout = imageProcessor.analyzeLayout(400, 1000);
      expect(layout.type).toBe('mobile');
      expect(layout.orientation).toBe('portrait');
    });

    test('should classify desktop images correctly', () => {
      const layout = imageProcessor.analyzeLayout(1600, 900);
      expect(layout.type).toBe('desktop');
      expect(layout.orientation).toBe('landscape');
    });

    test('should classify square images correctly', () => {
      const layout = imageProcessor.analyzeLayout(500, 500);
      expect(layout.type).toBe('square');
      expect(layout.orientation).toBe('neutral');
    });
  });

  describe('analyzeColors', () => {
    test('should analyze color composition', async () => {
      const colorAnalysis = await imageProcessor.analyzeColors(testImageBuffer);
      
      expect(colorAnalysis).toHaveProperty('channels');
      expect(colorAnalysis).toHaveProperty('isGrayscale');
      expect(colorAnalysis).toHaveProperty('hasTransparency');
      
      expect(Array.isArray(colorAnalysis.channels)).toBe(true);
      expect(typeof colorAnalysis.isGrayscale).toBe('boolean');
      expect(typeof colorAnalysis.hasTransparency).toBe('boolean');
    });

    test('should handle color analysis errors', async () => {
      const invalidBuffer = Buffer.from('invalid');
      const colorAnalysis = await imageProcessor.analyzeColors(invalidBuffer);
      
      expect(colorAnalysis).toEqual({});
    });
  });

  describe('detectSensitiveData', () => {
    test('should detect API keys in text', async () => {
      const text = 'API Key: sk-test123456789012345678901234567890123456';
      const flags = await imageProcessor.detectSensitiveData(text);
      
      expect(flags.hasApiKeys).toBe(true);
      expect(flags.detectedPatterns.length).toBeGreaterThan(0);
      expect(flags.detectedPatterns[0].type).toBe('api_key');
    });

    test('should detect credentials in text', async () => {
      const text = 'password: mySecretPassword123';
      const flags = await imageProcessor.detectSensitiveData(text);
      
      expect(flags.hasCredentials).toBe(true);
      expect(flags.detectedPatterns.some(p => p.type === 'credentials')).toBe(true);
    });

    test('should detect PII in text', async () => {
      const text = 'Email: test@example.com SSN: 123-45-6789';
      const flags = await imageProcessor.detectSensitiveData(text);
      
      expect(flags.hasPII).toBe(true);
      expect(flags.detectedPatterns.some(p => p.type === 'pii')).toBe(true);
    });

    test('should handle OCR result objects', async () => {
      const ocrResult = { text: 'sk-test123456789012345678901234567890123456' };
      const flags = await imageProcessor.detectSensitiveData(ocrResult);
      
      expect(flags.hasApiKeys).toBe(true);
    });

    test('should return clean flags for safe text', async () => {
      const text = 'This is just normal text content';
      const flags = await imageProcessor.detectSensitiveData(text);
      
      expect(flags.hasApiKeys).toBe(false);
      expect(flags.hasCredentials).toBe(false);
      expect(flags.hasPII).toBe(false);
      expect(flags.detectedPatterns).toEqual([]);
    });
  });

  describe('extractCodeSnippets', () => {
    test('should extract JavaScript code snippets', () => {
      const ocrResult = {
        text: 'function testFunction() { return true; } const x = 5;'
      };
      
      const snippets = imageProcessor.extractCodeSnippets(ocrResult);
      
      expect(snippets.hasCode).toBe(true);
      expect(snippets.snippets.length).toBeGreaterThan(0);
      expect(snippets.snippets[0].language).toBe('javascript');
    });

    test('should extract HTML code snippets', () => {
      const ocrResult = {
        text: '<div class="container"><p>Hello World</p></div>'
      };
      
      const snippets = imageProcessor.extractCodeSnippets(ocrResult);
      
      expect(snippets.hasCode).toBe(true);
      expect(snippets.snippets.some(s => s.language === 'html')).toBe(true);
    });

    test('should handle text without code', () => {
      const ocrResult = {
        text: 'This is just regular text without any code'
      };
      
      const snippets = imageProcessor.extractCodeSnippets(ocrResult);
      
      expect(snippets.hasCode).toBe(false);
      expect(snippets.snippets).toEqual([]);
      expect(snippets.totalSnippets).toBe(0);
    });
  });

  describe('detectLanguage', () => {
    test('should detect JavaScript', () => {
      const code = 'function test() { const x = 5; }';
      expect(imageProcessor.detectLanguage(code)).toBe('javascript');
    });

    test('should detect Python', () => {
      const code = 'def test(): import os';
      expect(imageProcessor.detectLanguage(code)).toBe('python');
    });

    test('should detect HTML', () => {
      const code = '<div><p>Hello</p></div>';
      expect(imageProcessor.detectLanguage(code)).toBe('html');
    });

    test('should detect Java', () => {
      const code = 'class TestClass { public void test() {} }';
      expect(imageProcessor.detectLanguage(code)).toBe('java');
    });

    test('should return unknown for unrecognized code', () => {
      const code = 'some random text';
      expect(imageProcessor.detectLanguage(code)).toBe('unknown');
    });
  });

  describe('detectImageRelationships', () => {
    test('should group images by similar dimensions', () => {
      const imageResults = [
        { metadata: { width: 800, height: 600 }, ocrText: 'text1' },
        { metadata: { width: 800, height: 600 }, ocrText: 'text2' },
        { metadata: { width: 1920, height: 1080 }, ocrText: 'text3' }
      ];
      
      const relationships = imageProcessor.detectImageRelationships(imageResults);
      
      expect(relationships.groups.length).toBeGreaterThan(0);
      expect(relationships.groups[0].type).toBe('same_dimensions');
      expect(relationships.groups[0].count).toBe(2);
    });

    test('should detect text similarities', () => {
      const imageResults = [
        { metadata: { width: 800, height: 600 }, ocrText: 'hello world test example' },
        { metadata: { width: 900, height: 700 }, ocrText: 'hello world test sample' },
        { metadata: { width: 1000, height: 800 }, ocrText: 'completely different text' }
      ];
      
      const relationships = imageProcessor.detectImageRelationships(imageResults);
      
      expect(relationships.similarities.length).toBeGreaterThanOrEqual(0);
      if (relationships.similarities.length > 0) {
        expect(relationships.similarities[0].type).toBe('text_similarity');
        expect(relationships.similarities[0].similarity).toBeGreaterThan(0);
      }
    });
  });

  describe('calculateTextSimilarity', () => {
    test('should calculate high similarity for similar texts', () => {
      const text1 = 'hello world test';
      const text2 = 'hello world example';
      
      const similarity = imageProcessor.calculateTextSimilarity(text1, text2);
      expect(similarity).toBeGreaterThanOrEqual(0.5);
    });

    test('should calculate low similarity for different texts', () => {
      const text1 = 'hello world';
      const text2 = 'completely different';
      
      const similarity = imageProcessor.calculateTextSimilarity(text1, text2);
      expect(similarity).toBeLessThan(0.5);
    });

    test('should handle empty texts', () => {
      expect(imageProcessor.calculateTextSimilarity('', 'test')).toBe(0);
      expect(imageProcessor.calculateTextSimilarity('test', '')).toBe(0);
      expect(imageProcessor.calculateTextSimilarity('', '')).toBe(0);
    });
  });

  describe('processImage', () => {
    test('should perform comprehensive image processing', async () => {
      const results = await imageProcessor.processImage(testImageBuffer);
      
      expect(results).toHaveProperty('metadata');
      expect(results).toHaveProperty('variants');
      expect(results).toHaveProperty('ocrText');
      expect(results).toHaveProperty('visualElements');
      expect(results).toHaveProperty('sensitiveDataFlags');
      expect(results).toHaveProperty('processingTime');
      
      expect(typeof results.processingTime).toBe('number');
      expect(results.processingTime).toBeGreaterThan(0);
    }, 30000);

    test('should handle processing errors', async () => {
      const invalidBuffer = Buffer.from('invalid');
      
      await expect(imageProcessor.processImage(invalidBuffer))
        .rejects.toThrow('Image processing failed');
    });

    test('should accept processing options', async () => {
      const options = {
        formats: ['webp'],
        languages: ['eng']
      };
      
      const results = await imageProcessor.processImage(testImageBuffer, options);
      
      expect(results.variants.small).toHaveProperty('webp');
      expect(results.variants.small.jpeg).toBeUndefined();
    }, 30000);
  });

  describe('getCapabilities', () => {
    test('should return processor capabilities', () => {
      const capabilities = imageProcessor.getCapabilities();
      
      expect(capabilities).toHaveProperty('supportedFormats');
      expect(capabilities).toHaveProperty('thumbnailSizes');
      expect(capabilities).toHaveProperty('maxImageSize');
      expect(capabilities).toHaveProperty('ocrLanguages');
      expect(capabilities).toHaveProperty('features');
      
      expect(Array.isArray(capabilities.supportedFormats)).toBe(true);
      expect(Array.isArray(capabilities.ocrLanguages)).toBe(true);
      expect(Array.isArray(capabilities.features)).toBe(true);
      expect(typeof capabilities.maxImageSize).toBe('number');
    });
  });
});