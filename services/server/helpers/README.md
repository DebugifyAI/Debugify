# Services Documentation

This directory contains the core services for the S3 upload pipeline with comprehensive file processing capabilities.

## Services Overview

### ImageProcessor

A comprehensive image processing service that provides:

- **Image Manipulation**: Generate multiple optimized variants (thumbnails, web-optimized versions)
- **OCR Text Extraction**: Advanced OCR using Tesseract.js with multiple language support
- **Visual Element Detection**: Identify UI components, charts, diagrams, and code snippets
- **Metadata Extraction**: EXIF data, dimensions, color analysis, and image characteristics
- **Sensitive Data Detection**: Scan for API keys, credentials, PII in extracted text
- **Code Snippet Extraction**: Extract and format code from screenshots with syntax detection
- **Image Relationship Detection**: Group related images and detect similarities

**Key Features:**
- Supports multiple image formats (JPEG, PNG, WebP, TIFF, GIF, BMP)
- Generates optimized variants for different use cases
- Advanced OCR with confidence scoring and text positioning
- Comprehensive security scanning for sensitive information
- Memory-efficient processing for large images

### ContentParser

A unified content parsing system that handles multiple file formats:

- **Text Files**: Plain text, Markdown with word/line counting and paragraph extraction
- **Structured Data**: JSON, XML, CSV with validation and metadata extraction
- **Log Files**: JSON logs, Apache/Nginx logs, generic logs with pattern recognition
- **Code Files**: JavaScript, Python, Java, C++, HTML, CSS, SQL with syntax analysis
- **Images**: Integration with ImageProcessor for OCR and visual analysis
- **Documents**: PDF, DOC, DOCX (placeholder for future implementation)

**Key Features:**
- Extensible parser registry for adding new file types
- Comprehensive log parsing with error/warning detection
- Code analysis with function/import extraction
- Automatic file type detection and appropriate parser selection
- Graceful error handling with detailed error reporting
- Integration with image processing for visual content

### FileValidator

A security-focused file validation service that provides:

- **File Type Validation**: Verify file extensions and MIME types
- **Security Scanning**: Virus scanning integration and malicious pattern detection
- **Size Validation**: Enforce file size limits and prevent oversized uploads
- **Content Validation**: Deep content inspection for security threats

## Usage Examples

### Basic Content Parsing

```javascript
const ContentParser = require('./services/ContentParser');
const parser = new ContentParser();

// Parse any supported file type
const result = await parser.parseContent(fileBuffer, 'document.json');
console.log('Extracted text:', result.extractedText);
console.log('Structured data:', result.structuredData);
console.log('Metadata:', result.metadata);
```

### Image Processing

```javascript
const ImageProcessor = require('./services/ImageProcessor');
const processor = new ImageProcessor();

// Process image with comprehensive analysis
const result = await processor.processImage(imageBuffer, {
  formats: ['webp', 'jpeg'],
  languages: ['eng', 'spa']
});

console.log('OCR Text:', result.ocrText);
console.log('Image variants:', Object.keys(result.variants));
console.log('Sensitive data flags:', result.sensitiveDataFlags);
```

### File Validation

```javascript
const FileValidator = require('./services/FileValidator');
const validator = new FileValidator();

// Validate file before processing
const isValid = await validator.validateFile(fileBuffer, 'upload.jpg');
console.log('File is valid:', isValid);
```

## Supported File Types

### Images
- JPEG, JPG, PNG, WebP, TIFF, GIF, BMP
- Advanced OCR text extraction
- Visual element detection
- Metadata and EXIF extraction

### Text & Documents
- TXT, MD (Markdown)
- PDF, DOC, DOCX (basic support)
- Rich text analysis and metadata

### Structured Data
- JSON with validation and structure analysis
- XML with tag extraction and content parsing
- CSV with column analysis and data summaries

### Code Files
- JavaScript, TypeScript, Python, Java, C++, C
- HTML, CSS, SQL
- Function and import extraction
- Comment detection and code statistics

### Log Files
- JSON structured logs
- Apache/Nginx access logs
- Generic timestamped logs
- Error/warning/info level detection

## Configuration

### Image Processing Options

```javascript
const options = {
  formats: ['webp', 'jpeg', 'png'],  // Output formats
  languages: ['eng', 'spa', 'fra'],  // OCR languages
  generateVariants: true,             // Create thumbnails
  detectSensitiveData: true          // Scan for credentials/PII
};
```

### Parser Registry

The ContentParser uses a registry system that can be extended:

```javascript
// Add custom parser
parser.parsers.set('custom', async (content, filename) => {
  // Custom parsing logic
  return {
    extractedText: '...',
    metadata: {},
    structuredData: {}
  };
});
```

## Error Handling

All services implement comprehensive error handling:

- **Graceful Degradation**: Continue processing even if some features fail
- **Detailed Error Messages**: Specific error information for debugging
- **Fallback Mechanisms**: Alternative processing methods when primary fails
- **Validation Errors**: Clear feedback for invalid inputs

## Performance Considerations

- **Streaming Processing**: Handle large files efficiently
- **Memory Management**: Optimize memory usage for image processing
- **Concurrent Processing**: Support parallel file processing
- **Caching**: Cache frequently accessed parsed content
- **Resource Limits**: Configurable limits for processing time and memory

## Security Features

- **Input Validation**: Comprehensive file type and content validation
- **Sensitive Data Detection**: Automatic scanning for credentials, API keys, PII
- **Virus Scanning**: Integration with antivirus engines
- **Content Sanitization**: Safe handling of potentially malicious content
- **Access Control**: Validation of file permissions and user access

## Testing

Comprehensive test suites are provided for all services:

```bash
# Run all service tests
npm test -- --testPathPattern="ImageProcessor|ContentParser|FileValidator"

# Run specific service tests
npm test -- --testPathPattern=ImageProcessor.test.js
npm test -- --testPathPattern=ContentParser.test.js
```

## Future Enhancements

- **PDF Text Extraction**: Full PDF parsing with pdf-parse library
- **Document Processing**: Complete DOC/DOCX support with mammoth
- **Advanced OCR**: Integration with cloud OCR services for better accuracy
- **Machine Learning**: Content classification and intelligent tagging
- **Real-time Processing**: WebSocket-based progress updates
- **Batch Processing**: Efficient handling of multiple files simultaneously