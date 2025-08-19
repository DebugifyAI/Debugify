# S3 Upload Pipeline API Documentation

## Overview

The S3 Upload Pipeline API provides comprehensive file upload, processing, and analysis capabilities with advanced image processing features. This API supports direct S3 uploads via presigned URLs, real-time processing status updates, and intelligent content analysis using LLM integration.

## Base URL

- **Production:** `https://api.yourcompany.com`
- **Staging:** `https://staging-api.yourcompany.com`
- **Development:** `http://localhost:3001`

## Authentication

All API endpoints require JWT authentication via the `Authorization` header:

```
Authorization: Bearer <jwt_token>
```

### Obtaining a Token

```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 1,
    "email": "user@example.com",
    "username": "user"
  }
}
```

## Upload Endpoints

### Request Presigned Upload URL

Generate a presigned S3 URL for direct file upload.

```http
POST /api/upload/presigned
Authorization: Bearer <token>
Content-Type: application/json

{
  "filename": "document.pdf",
  "contentType": "application/pdf",
  "fileSize": 1048576,
  "multipart": false
}
```

**Parameters:**
- `filename` (string, required): Original filename
- `contentType` (string, required): MIME type of the file
- `fileSize` (number, required): File size in bytes
- `multipart` (boolean, optional): Enable multipart upload for files >100MB

**Response:**
```json
{
  "uploadUrl": "https://bucket.s3.amazonaws.com/key?signature=...",
  "artifactId": 123,
  "s3Key": "uploads/user-1/document-uuid.pdf",
  "expiresAt": "2024-01-01T12:00:00Z",
  "multipartUploadId": null,
  "partUrls": null
}
```

**For Multipart Uploads:**
```json
{
  "uploadUrl": null,
  "artifactId": 124,
  "s3Key": "uploads/user-1/large-file-uuid.bin",
  "multipartUploadId": "upload-id-123",
  "partUrls": [
    "https://bucket.s3.amazonaws.com/key?partNumber=1&uploadId=...",
    "https://bucket.s3.amazonaws.com/key?partNumber=2&uploadId=..."
  ]
}
```

### Confirm Upload Completion

Notify the system that the S3 upload has completed and trigger processing.

```http
POST /api/upload/confirm/{artifactId}
Authorization: Bearer <token>
Content-Type: application/json

{
  "s3Key": "uploads/user-1/document-uuid.pdf",
  "etag": "d41d8cd98f00b204e9800998ecf8427e",
  "metadata": {
    "width": 1920,
    "height": 1080,
    "format": "jpeg"
  }
}
```

**For Multipart Uploads:**
```json
{
  "s3Key": "uploads/user-1/large-file-uuid.bin",
  "multipartUploadId": "upload-id-123",
  "parts": [
    { "ETag": "etag1", "PartNumber": 1 },
    { "ETag": "etag2", "PartNumber": 2 }
  ]
}
```

**Response:**
```json
{
  "message": "Upload confirmed and processing started",
  "artifactId": 123,
  "jobId": "job-uuid-456",
  "estimatedProcessingTime": 30000
}
```

## Image Processing Endpoints

### Upload Image with Processing Options

Enhanced endpoint for image uploads with specific processing requirements.

```http
POST /api/upload/image
Authorization: Bearer <token>
Content-Type: application/json

{
  "filename": "screenshot.png",
  "contentType": "image/png",
  "fileSize": 2048576,
  "processingOptions": {
    "generateVariants": true,
    "variantSizes": ["thumbnail", "web", "large"],
    "enableOCR": true,
    "ocrLanguages": ["eng", "spa"],
    "detectVisualElements": true,
    "extractCode": true,
    "scanSensitiveData": true
  }
}
```

**Response:**
```json
{
  "uploadUrl": "https://bucket.s3.amazonaws.com/images/key?signature=...",
  "artifactId": 125,
  "s3Key": "images/user-1/screenshot-uuid.png",
  "processingOptions": {
    "generateVariants": true,
    "variantSizes": ["thumbnail", "web", "large"],
    "enableOCR": true,
    "ocrLanguages": ["eng", "spa"],
    "detectVisualElements": true,
    "extractCode": true,
    "scanSensitiveData": true
  }
}
```

## Artifact Management Endpoints

### Get Artifact Details

Retrieve detailed information about an uploaded artifact.

```http
GET /api/artifacts/{artifactId}
Authorization: Bearer <token>
```

**Response:**
```json
{
  "id": 123,
  "filename": "document.pdf",
  "contentType": "application/pdf",
  "fileSize": 1048576,
  "s3Key": "uploads/user-1/document-uuid.pdf",
  "status": "completed",
  "uploadedAt": "2024-01-01T10:00:00Z",
  "processedAt": "2024-01-01T10:02:30Z",
  "validationStatus": "passed",
  "contentSummary": "Technical documentation containing API specifications...",
  "processingStages": [
    {
      "stage": "validation",
      "status": "completed",
      "startedAt": "2024-01-01T10:00:30Z",
      "completedAt": "2024-01-01T10:00:45Z"
    },
    {
      "stage": "parsing",
      "status": "completed",
      "startedAt": "2024-01-01T10:00:45Z",
      "completedAt": "2024-01-01T10:01:30Z"
    },
    {
      "stage": "llm_analysis",
      "status": "completed",
      "startedAt": "2024-01-01T10:01:30Z",
      "completedAt": "2024-01-01T10:02:30Z"
    }
  ],
  "imageVariants": null,
  "ocrText": null,
  "visualElements": null,
  "sensitiveDataFlags": null
}
```

**For Image Artifacts:**
```json
{
  "id": 125,
  "filename": "screenshot.png",
  "contentType": "image/png",
  "fileSize": 2048576,
  "s3Key": "images/user-1/screenshot-uuid.png",
  "status": "completed",
  "imageVariants": {
    "thumbnail": "images/user-1/screenshot-uuid-thumb.webp",
    "web": "images/user-1/screenshot-uuid-web.webp",
    "large": "images/user-1/screenshot-uuid-large.webp",
    "original": "images/user-1/screenshot-uuid.png"
  },
  "imageMetadata": {
    "width": 1920,
    "height": 1080,
    "format": "png",
    "colorSpace": "srgb",
    "hasAlpha": true,
    "exif": {
      "camera": "iPhone 13 Pro",
      "timestamp": "2024-01-01T09:30:00Z"
    }
  },
  "ocrText": "Login\nUsername: [text field]\nPassword: [text field]\nSubmit Button",
  "visualElements": {
    "buttons": [
      {
        "x": 100,
        "y": 200,
        "width": 80,
        "height": 30,
        "text": "Submit",
        "confidence": 0.95
      }
    ],
    "textFields": [
      {
        "x": 50,
        "y": 150,
        "width": 200,
        "height": 25,
        "placeholder": "Username",
        "confidence": 0.88
      }
    ],
    "charts": [],
    "diagrams": []
  },
  "sensitiveDataFlags": {
    "hasPII": false,
    "hasCredentials": false,
    "hasAPIKeys": false,
    "confidenceScore": 0.92
  }
}
```

### List User Artifacts

Get a paginated list of artifacts for the authenticated user.

```http
GET /api/artifacts?page=1&limit=20&status=completed&type=image
Authorization: Bearer <token>
```

**Query Parameters:**
- `page` (number, optional): Page number (default: 1)
- `limit` (number, optional): Items per page (default: 20, max: 100)
- `status` (string, optional): Filter by status (pending, processing, completed, failed)
- `type` (string, optional): Filter by content type (image, document, text, etc.)
- `search` (string, optional): Search in filename or content summary

**Response:**
```json
{
  "artifacts": [
    {
      "id": 123,
      "filename": "document.pdf",
      "contentType": "application/pdf",
      "status": "completed",
      "uploadedAt": "2024-01-01T10:00:00Z",
      "fileSize": 1048576,
      "contentSummary": "Technical documentation..."
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "totalPages": 3,
    "hasNext": true,
    "hasPrev": false
  }
}
```

### Download Artifact

Generate a presigned download URL for an artifact or its variants.

```http
GET /api/artifacts/{artifactId}/download?variant=web
Authorization: Bearer <token>
```

**Query Parameters:**
- `variant` (string, optional): For images, specify variant (thumbnail, web, large, original)

**Response:**
```json
{
  "downloadUrl": "https://bucket.s3.amazonaws.com/key?signature=...",
  "filename": "screenshot-web.webp",
  "contentType": "image/webp",
  "fileSize": 156789,
  "expiresAt": "2024-01-01T13:00:00Z"
}
```

## Processing Status Endpoints

### Get Processing Status

Get real-time processing status for an artifact.

```http
GET /api/artifacts/{artifactId}/status
Authorization: Bearer <token>
```

**Response:**
```json
{
  "artifactId": 123,
  "status": "processing",
  "progress": 65,
  "currentStage": "llm_analysis",
  "estimatedCompletion": "2024-01-01T10:03:00Z",
  "stages": [
    {
      "name": "validation",
      "status": "completed",
      "progress": 100,
      "duration": 15000
    },
    {
      "name": "parsing",
      "status": "completed",
      "progress": 100,
      "duration": 45000
    },
    {
      "name": "llm_analysis",
      "status": "processing",
      "progress": 30,
      "estimatedDuration": 60000
    }
  ],
  "error": null
}
```

### Get Processing Progress (WebSocket)

Connect to real-time progress updates via WebSocket.

```javascript
const socket = io('wss://api.yourcompany.com', {
  auth: {
    token: 'your-jwt-token'
  }
});

socket.emit('subscribe-artifact', { artifactId: 123 });

socket.on('processing-update', (data) => {
  console.log('Progress update:', data);
  // {
  //   artifactId: 123,
  //   progress: 75,
  //   stage: 'llm_analysis',
  //   message: 'Analyzing document content...'
  // }
});

socket.on('processing-complete', (data) => {
  console.log('Processing completed:', data);
  // {
  //   artifactId: 123,
  //   status: 'completed',
  //   processingTime: 120000,
  //   results: { ... }
  // }
});
```

## Analysis Results Endpoints

### Get LLM Analysis Results

Retrieve AI-generated analysis and insights for an artifact.

```http
GET /api/artifacts/{artifactId}/analysis
Authorization: Bearer <token>
```

**Response:**
```json
{
  "artifactId": 123,
  "analysisResults": [
    {
      "id": 456,
      "analysisType": "document_summary",
      "provider": "openai",
      "model": "gpt-4",
      "confidence": 0.92,
      "createdAt": "2024-01-01T10:02:30Z",
      "tokenUsage": {
        "prompt": 1500,
        "completion": 300,
        "total": 1800
      },
      "structuredOutput": {
        "summary": "This document contains API specifications for a file upload system...",
        "keyPoints": [
          "Supports multiple file formats",
          "Includes image processing capabilities",
          "Real-time progress tracking"
        ],
        "actionItems": [
          "Review security configurations",
          "Test with large files"
        ],
        "sentiment": "neutral",
        "complexity": "medium"
      },
      "rawOutput": "This technical document outlines..."
    }
  ]
}
```

### Get Image Analysis Results

Retrieve detailed image analysis including OCR, visual elements, and AI insights.

```http
GET /api/artifacts/{artifactId}/image-analysis
Authorization: Bearer <token>
```

**Response:**
```json
{
  "artifactId": 125,
  "imageAnalysis": {
    "ocrResults": {
      "text": "Login\nUsername: [text field]\nPassword: [text field]\nSubmit Button",
      "confidence": 0.94,
      "language": "eng",
      "textRegions": [
        {
          "text": "Login",
          "bbox": { "x": 100, "y": 50, "width": 60, "height": 25 },
          "confidence": 0.98
        }
      ]
    },
    "visualElements": {
      "buttons": [
        {
          "type": "button",
          "text": "Submit",
          "bbox": { "x": 100, "y": 200, "width": 80, "height": 30 },
          "confidence": 0.95,
          "style": {
            "backgroundColor": "#007bff",
            "textColor": "#ffffff",
            "borderRadius": "4px"
          }
        }
      ],
      "inputFields": [
        {
          "type": "text",
          "placeholder": "Username",
          "bbox": { "x": 50, "y": 150, "width": 200, "height": 25 },
          "confidence": 0.88
        }
      ],
      "charts": [],
      "diagrams": []
    },
    "codeExtraction": {
      "hasCode": false,
      "codeBlocks": []
    },
    "aiInsights": {
      "description": "This appears to be a login screen with username and password fields...",
      "uiType": "login_form",
      "accessibility": {
        "score": 0.75,
        "issues": [
          "Missing alt text for images",
          "Low color contrast on submit button"
        ]
      },
      "suggestions": [
        "Add proper form labels",
        "Improve color contrast",
        "Consider adding password visibility toggle"
      ]
    }
  }
}
```

## Batch Operations

### Batch Upload

Upload multiple files in a single request.

```http
POST /api/upload/batch
Authorization: Bearer <token>
Content-Type: application/json

{
  "files": [
    {
      "filename": "doc1.pdf",
      "contentType": "application/pdf",
      "fileSize": 1048576
    },
    {
      "filename": "image1.jpg",
      "contentType": "image/jpeg",
      "fileSize": 2048576
    }
  ],
  "processingOptions": {
    "priority": "normal",
    "enableLLMAnalysis": true
  }
}
```

**Response:**
```json
{
  "batchId": "batch-uuid-789",
  "uploads": [
    {
      "filename": "doc1.pdf",
      "artifactId": 126,
      "uploadUrl": "https://bucket.s3.amazonaws.com/...",
      "s3Key": "uploads/user-1/doc1-uuid.pdf"
    },
    {
      "filename": "image1.jpg",
      "artifactId": 127,
      "uploadUrl": "https://bucket.s3.amazonaws.com/...",
      "s3Key": "images/user-1/image1-uuid.jpg"
    }
  ]
}
```

### Batch Download

Download multiple artifacts as a compressed archive.

```http
POST /api/artifacts/batch-download
Authorization: Bearer <token>
Content-Type: application/json

{
  "artifactIds": [123, 124, 125],
  "format": "zip",
  "includeVariants": true,
  "includeAnalysis": true
}
```

**Response:**
```json
{
  "downloadUrl": "https://bucket.s3.amazonaws.com/batch/archive-uuid.zip",
  "filename": "artifacts-2024-01-01.zip",
  "fileSize": 15728640,
  "expiresAt": "2024-01-01T15:00:00Z",
  "contents": [
    {
      "artifactId": 123,
      "filename": "document.pdf",
      "path": "documents/document.pdf"
    },
    {
      "artifactId": 125,
      "filename": "screenshot.png",
      "path": "images/screenshot.png",
      "variants": [
        "images/variants/screenshot-thumb.webp",
        "images/variants/screenshot-web.webp"
      ]
    }
  ]
}
```

## Error Responses

All endpoints return consistent error responses:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "File type not allowed",
    "details": {
      "field": "contentType",
      "allowedTypes": ["image/jpeg", "image/png", "text/plain"]
    },
    "timestamp": "2024-01-01T10:00:00Z",
    "requestId": "req-uuid-123"
  }
}
```

### Common Error Codes

- `AUTHENTICATION_REQUIRED` (401): Missing or invalid JWT token
- `AUTHORIZATION_FAILED` (403): Insufficient permissions
- `VALIDATION_ERROR` (400): Invalid request parameters
- `FILE_TOO_LARGE` (413): File exceeds size limits
- `UNSUPPORTED_FILE_TYPE` (415): File type not allowed
- `PROCESSING_FAILED` (422): File processing encountered an error
- `RATE_LIMIT_EXCEEDED` (429): Too many requests
- `INTERNAL_ERROR` (500): Server error
- `SERVICE_UNAVAILABLE` (503): External service unavailable

## Rate Limits

- **Upload requests:** 100 per 15 minutes per user
- **Status checks:** 1000 per hour per user
- **Download requests:** 500 per hour per user
- **API calls:** 10,000 per hour per user

Rate limit headers are included in all responses:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1704110400
```

## SDKs and Examples

### JavaScript/Node.js Example

```javascript
const S3PipelineClient = require('@yourcompany/s3-pipeline-client');

const client = new S3PipelineClient({
  baseURL: 'https://api.yourcompany.com',
  token: 'your-jwt-token'
});

// Upload a file
async function uploadFile(file) {
  try {
    // Request presigned URL
    const { uploadUrl, artifactId } = await client.requestUpload({
      filename: file.name,
      contentType: file.type,
      fileSize: file.size
    });
    
    // Upload to S3
    await fetch(uploadUrl, {
      method: 'PUT',
      body: file,
      headers: {
        'Content-Type': file.type
      }
    });
    
    // Confirm upload
    const result = await client.confirmUpload(artifactId, {
      s3Key: uploadUrl.split('?')[0].split('/').pop(),
      etag: 'calculated-etag'
    });
    
    console.log('Upload completed:', result);
    
    // Monitor progress
    client.onProgress(artifactId, (progress) => {
      console.log(`Progress: ${progress.progress}%`);
    });
    
    return artifactId;
  } catch (error) {
    console.error('Upload failed:', error);
    throw error;
  }
}
```

### Python Example

```python
import requests
from s3_pipeline_client import S3PipelineClient

client = S3PipelineClient(
    base_url='https://api.yourcompany.com',
    token='your-jwt-token'
)

def upload_image(file_path):
    with open(file_path, 'rb') as f:
        file_data = f.read()
    
    # Request presigned URL
    response = client.request_upload(
        filename='image.jpg',
        content_type='image/jpeg',
        file_size=len(file_data),
        processing_options={
            'enable_ocr': True,
            'detect_visual_elements': True
        }
    )
    
    # Upload to S3
    upload_response = requests.put(
        response['upload_url'],
        data=file_data,
        headers={'Content-Type': 'image/jpeg'}
    )
    
    if upload_response.status_code == 200:
        # Confirm upload
        result = client.confirm_upload(
            response['artifact_id'],
            s3_key=response['s3_key'],
            etag=upload_response.headers.get('ETag')
        )
        return result
    else:
        raise Exception(f"Upload failed: {upload_response.status_code}")
```

## Webhooks

Configure webhooks to receive notifications about processing events:

```http
POST /api/webhooks
Authorization: Bearer <token>
Content-Type: application/json

{
  "url": "https://yourapp.com/webhooks/s3-pipeline",
  "events": [
    "artifact.processing.completed",
    "artifact.processing.failed",
    "batch.processing.completed"
  ],
  "secret": "webhook-secret-key"
}
```

**Webhook Payload Example:**
```json
{
  "event": "artifact.processing.completed",
  "timestamp": "2024-01-01T10:02:30Z",
  "data": {
    "artifactId": 123,
    "filename": "document.pdf",
    "status": "completed",
    "processingTime": 120000,
    "analysisResults": {
      "summary": "Document analysis completed successfully"
    }
  },
  "signature": "sha256=calculated-hmac-signature"
}
```