# Artifact Management System

## Overview

The Artifact Management System provides comprehensive download, batch operations, lifecycle management, and caching capabilities for uploaded artifacts. This system enhances the existing S3 upload pipeline with advanced features for managing and retrieving processed content.

## Features Implemented

### 1. Enhanced Download URL Generation
- **Security Improvements**: Time-limited presigned URLs with configurable expiration
- **Variant Support**: Download original files or processed variants (thumbnails, web-optimized, etc.)
- **Custom Headers**: Support for content-type and content-disposition headers
- **Caching**: In-memory cache for frequently accessed URLs to improve performance
- **Audit Logging**: Complete audit trail for all download URL generations

### 2. Batch Download Capabilities
- **ZIP Archive Generation**: Create compressed archives of multiple artifacts
- **Image Variant Inclusion**: Option to include all image variants in batch downloads
- **Size Limits**: Configurable maximum total size limits for batch operations
- **Compression Levels**: Adjustable compression levels for optimal performance
- **Streaming**: Memory-efficient streaming of large files directly from S3

### 3. Artifact Lifecycle Management
- **Automated Cleanup**: Configurable cleanup policies for old artifacts
- **Dry Run Support**: Test cleanup operations without actual deletion
- **Batch Processing**: Efficient batch deletion of artifacts and variants
- **Size Tracking**: Monitor storage usage and cleanup impact
- **Error Handling**: Graceful handling of cleanup failures with detailed reporting

### 4. Compressed Storage Options
- **Large Result Compression**: Automatic compression for large analysis results
- **Format Support**: JSON and text format support with optional compression
- **Efficient Retrieval**: Optimized retrieval of compressed content
- **Cache Integration**: Compressed content caching for improved performance

### 5. Caching Layer
- **In-Memory Cache**: Fast access to frequently requested content
- **Configurable Timeout**: Adjustable cache expiration times
- **Cache Statistics**: Monitoring and management of cache performance
- **Memory Management**: Efficient memory usage with automatic cleanup

### 6. Image Gallery Functionality
- **Visual Artifact Display**: Organized gallery view for image artifacts
- **Metadata Integration**: Rich metadata display including OCR text and visual elements
- **Variant Preview**: Support for displaying multiple image variants
- **Pagination**: Efficient pagination for large image collections
- **Sorting Options**: Flexible sorting by date, size, or other criteria

## API Endpoints

### Enhanced Download URLs
```
GET /api/artifacts/:artifactId/download
Query Parameters:
- variant: Image variant name (thumbnail, web, full)
- expiresIn: URL expiration time in seconds (default: 3600)
- disposition: Content disposition (attachment, inline)
```

### Batch Downloads
```
POST /api/bugs/:bugId/batch-download
Body:
{
  "artifactIds": [1, 2, 3],
  "includeVariants": true,
  "compressionLevel": 6
}
```

### Image Gallery
```
GET /api/bugs/:bugId/image-gallery
Query Parameters:
- includeVariants: Include image variants (default: true)
- sortBy: Sort field (created_at, size_bytes, etc.)
- sortOrder: Sort direction (asc, desc)
- limit: Number of items per page (default: 50)
- offset: Pagination offset (default: 0)
```

### Processed Content
```
GET /api/artifacts/:artifactId/processed-content
Query Parameters:
- format: Content format (json, text)
- compress: Enable compression (default: true)
```

### Artifact Information
```
GET /api/artifacts/:artifactId/info
Returns comprehensive artifact metadata including variants and processing status
```

### Admin Endpoints
```
POST /api/admin/artifacts/cleanup
Body:
{
  "olderThanDays": 90,
  "includeProcessed": false,
  "dryRun": true,
  "batchSize": 100
}

GET /api/admin/artifacts/cache-stats
POST /api/admin/artifacts/clear-cache
```

## Performance Characteristics

### Download URL Generation
- **Single URL**: < 100ms
- **Concurrent (100 requests)**: < 500ms
- **Cache Hit**: < 10ms

### Batch Downloads
- **Small batch (5 files)**: < 200ms
- **Medium batch (25 files)**: < 1 second
- **Large batch (100 files)**: < 3 seconds

### Image Gallery
- **Small gallery (10 images)**: < 300ms
- **Large gallery (50 images)**: < 1 second
- **Without variants**: 20% faster

### Processed Content Caching
- **First request**: < 200ms
- **Cached request**: < 10ms
- **Concurrent requests**: < 300ms

## Configuration

### Environment Variables
```bash
# AWS Configuration
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_REGION=us-east-1
AWS_S3_BUCKET_NAME=your_bucket_name

# Cache Configuration
ARTIFACT_CACHE_TIMEOUT=300000  # 5 minutes in milliseconds

# Cleanup Configuration
ARTIFACT_CLEANUP_BATCH_SIZE=100
ARTIFACT_CLEANUP_MAX_AGE_DAYS=90
```

### Service Configuration
```javascript
// In ArtifactManagementService constructor
this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
this.maxBatchSize = 1024 * 1024 * 1024; // 1GB
```

## Security Features

### Access Control
- **Team-based Authorization**: Users can only access artifacts from their teams
- **Audit Logging**: Complete audit trail for all operations
- **Rate Limiting**: Built-in rate limiting for download operations
- **Secure URLs**: Time-limited presigned URLs with automatic expiration

### Data Protection
- **Encrypted Storage**: S3 server-side encryption
- **Secure Credentials**: Integration with SecureCredentialManager
- **Input Validation**: Comprehensive validation of all inputs
- **Error Handling**: Secure error messages without information leakage

## Monitoring and Analytics

### Cache Statistics
```javascript
{
  "size": 150,
  "timeout": 300000,
  "entries": ["artifact-1-original", "artifact-2-thumbnail", ...]
}
```

### Cleanup Results
```javascript
{
  "processed": 25,
  "deleted": 75,
  "errors": 0,
  "totalSize": 1048576,
  "details": [...]
}
```

### Performance Metrics
- Download URL generation time
- Cache hit/miss ratios
- Batch download completion times
- Memory usage statistics

## Testing

### Test Coverage
- **Unit Tests**: Complete coverage of service methods
- **Integration Tests**: End-to-end API testing
- **Performance Tests**: Load and stress testing
- **Security Tests**: Authorization and input validation

### Test Files
- `tests/artifactManagement.test.js` - Comprehensive unit tests
- `tests/artifactManagement.performance.test.js` - Performance benchmarks
- `tests/artifactManagement.simple.test.js` - Basic functionality tests

### Running Tests
```bash
# Run all artifact management tests
npm test -- --testPathPattern=artifactManagement

# Run performance tests specifically
npm test -- tests/artifactManagement.performance.test.js

# Run with coverage
npm run test:coverage
```

## Usage Examples

### Generate Download URL
```javascript
const result = await artifactManagementService.generateDownloadUrl(123, {
  variant: 'thumbnail',
  expiresIn: 7200,
  userId: 456
});

console.log(result.url); // https://signed-url.com
console.log(result.expiresAt); // 2023-12-01T14:00:00Z
```

### Create Batch Download
```javascript
const result = await artifactManagementService.generateBatchDownload([1, 2, 3], {
  includeVariants: true,
  compressionLevel: 6,
  userId: 456
});

result.archive.pipe(response);
```

### Get Image Gallery
```javascript
const gallery = await artifactManagementService.getImageGallery(bugId, {
  includeVariants: true,
  limit: 20,
  offset: 0
});

console.log(gallery.items.length); // 20
console.log(gallery.hasMore); // true
```

## Error Handling

### Common Error Codes
- `ARTIFACT_NOT_FOUND` - Artifact does not exist
- `ACCESS_DENIED` - User lacks permission
- `VALIDATION_FAILED` - Invalid input parameters
- `SIZE_LIMIT_EXCEEDED` - Batch download too large
- `INTERNAL_ERROR` - Server error

### Error Response Format
```javascript
{
  "message": "Artifact not found",
  "code": "ARTIFACT_NOT_FOUND",
  "details": {...}
}
```

## Deployment Considerations

### Production Setup
1. Configure AWS credentials and S3 bucket
2. Set up Redis for caching (optional)
3. Configure monitoring and alerting
4. Set up scheduled cleanup jobs
5. Configure rate limiting and security policies

### Scaling Considerations
- Cache can be moved to Redis for multi-instance deployments
- S3 operations can be distributed across multiple regions
- Batch downloads can be queued for large operations
- Cleanup operations should be scheduled during low-traffic periods

### Monitoring Setup
- Track download URL generation performance
- Monitor cache hit ratios
- Alert on cleanup failures
- Track storage usage and costs

## Maintenance

### Regular Tasks
- Monitor cache performance and adjust timeout settings
- Review cleanup policies and adjust retention periods
- Analyze download patterns and optimize caching
- Update security policies and access controls

### Troubleshooting
- Check AWS credentials and permissions
- Verify S3 bucket configuration
- Monitor memory usage for cache optimization
- Review audit logs for security issues

## Future Enhancements

### Planned Features
- Redis-based distributed caching
- Advanced image processing and analysis
- Content delivery network (CDN) integration
- Advanced analytics and reporting
- Automated cost optimization

### Performance Improvements
- Lazy loading for large galleries
- Progressive image loading
- Background cleanup processing
- Predictive caching based on usage patterns