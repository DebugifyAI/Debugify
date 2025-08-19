# Workers Documentation

This directory contains specialized workers for processing different types of content in the S3 upload pipeline.

## ImageWorker

The `ImageWorker` is a specialized BullMQ worker designed for comprehensive image processing tasks.

### Features

- **Parallel Image Variant Generation**: Creates multiple optimized versions (thumbnails, web-optimized, full resolution)
- **Advanced OCR Processing**: Extracts text with positioning, confidence scores, and language detection
- **Visual Element Detection**: Identifies UI components, charts, diagrams, and code snippets
- **Sensitive Data Scanning**: Detects credentials, PII, API keys, and other sensitive information
- **Quality Assessment**: Analyzes image quality and provides enhancement suggestions
- **Memory-Efficient Processing**: Optimized for large images and batch operations

### Usage

```javascript
const ImageWorker = require('./ImageWorker');
const redisConfig = { host: 'localhost', port: 6379 };

const imageWorker = new ImageWorker(redisConfig);

// The worker automatically processes jobs from the 'imageProcessing' queue
// Jobs should have the format:
// {
//   artifactId: 123,
//   processingOptions: {
//     formats: ['webp', 'jpeg'],
//     languages: ['eng', 'spa'],
//     generateVariants: true,
//     performOCR: true
//   }
// }
```

### Processing Pipeline

1. **Download Image**: Retrieves image from S3 with size validation
2. **Metadata Extraction**: Extracts EXIF data, dimensions, and format information
3. **Variant Generation**: Creates multiple optimized versions in parallel
4. **OCR Processing**: Extracts text with advanced positioning and confidence scoring
5. **Visual Analysis**: Detects UI components, charts, and visual elements
6. **Code Detection**: Identifies and extracts code snippets from screenshots
7. **Sensitive Data Scanning**: Scans for credentials, API keys, and PII
8. **Quality Assessment**: Evaluates image quality and suggests improvements
9. **Storage**: Uploads variants and processed content to S3
10. **Database Update**: Updates artifact record with processing results

### Configuration

- **Concurrency**: 2 (CPU-intensive processing)
- **Max Image Size**: 50MB
- **Supported Formats**: JPEG, PNG, WebP, TIFF, GIF, BMP
- **OCR Languages**: English, Spanish, French, German, Italian, Portuguese, Russian, Chinese, Japanese

## LLMWorker

The `LLMWorker` handles AI analysis of processed content using multiple LLM providers.

### Features

- **Multi-Provider Support**: OpenAI, Anthropic with automatic failover
- **Intelligent Content Routing**: Automatically selects appropriate models and analysis types
- **Cost Optimization**: Tracks usage and optimizes API calls
- **Retry Logic**: Exponential backoff for transient failures
- **Structured Output**: Extracts key findings, recommendations, and technical details

### Usage

```javascript
const LLMWorker = require('./LLMWorker');
const redisConfig = { host: 'localhost', port: 6379 };

const llmWorker = new LLMWorker(redisConfig);

// The worker processes jobs from the 'llmAnalysis' queue
// Jobs should have the format:
// {
//   artifactId: 123,
//   analysisOptions: {
//     provider: 'openai',
//     analysisType: 'screenshot',
//     maxTokens: 4000
//   }
// }
```

### Analysis Types

#### Image Analysis
- **Screenshot**: UI analysis, workflow documentation
- **Diagram**: Architecture diagrams, flowcharts, network topology
- **Code Image**: Code review from screenshots
- **General**: Comprehensive visual analysis

#### Text Analysis
- **Log Analysis**: Error detection, performance insights
- **Code Review**: Security vulnerabilities, best practices
- **Document Summary**: Key points extraction, action items

### Configuration

- **Concurrency**: 2 (API rate limits)
- **Retry Attempts**: 3 with exponential backoff
- **Max Tokens**: Configurable per provider/model
- **Cost Tracking**: Real-time usage and cost monitoring

## LLMService

The `LLMService` provides a unified interface for multiple LLM providers with **Ollama local LLM support** as the primary provider.

### Features

- **Local LLM Support**: Ollama integration for privacy and cost efficiency
- **Provider Abstraction**: Unified API for Ollama, OpenAI, Anthropic, and future providers
- **Automatic Provider Selection**: Intelligent routing with fallback support
- **Zero-Cost Local Processing**: No API costs for local Ollama models
- **Automatic Chunking**: Handles large content that exceeds context limits
- **Specialized Prompts**: Optimized templates for different analysis types
- **Cost Tracking**: Detailed usage statistics and cost estimation
- **Image Analysis**: Vision API support with local multimodal models

### Supported Providers

#### Ollama (Primary - Local)
- **Text Model**: llama3.2:3b (8K context, fast and efficient)
- **Vision Model**: llava:7b (4K context, multimodal capabilities)
- **Code Model**: codellama:7b (16K context, specialized for code)
- **Features**: 
  - Privacy-focused (no data leaves your infrastructure)
  - Zero API costs
  - Customizable models
  - GPU acceleration support
  - Offline operation

#### OpenAI (Fallback)
- **Text Model**: gpt-4o-mini (128K context)
- **Vision Model**: gpt-4o (128K context)
- **Features**: High-quality analysis, fast processing

#### Anthropic (Fallback)
- **Text Model**: claude-3-haiku-20240307 (200K context)
- **Vision Model**: claude-3-sonnet-20240229 (200K context)
- **Features**: Large context windows, detailed analysis

### Usage

```javascript
const LLMService = require('../services/LLMService');

const llmService = new LLMService();

// Analyze text content (automatically uses Ollama if available)
const textResult = await llmService.analyzeContent({
  text: 'ERROR: Database connection timeout after 30 seconds',
  metadata: { filename: 'app.log' }
}, {
  type: 'text',
  analysisType: 'logAnalysis'
  // No provider specified - will use Ollama by default
});

// Analyze image content with local vision model
const imageResult = await llmService.analyzeContent({
  imageBuffer: imageBuffer,
  ocrText: 'Login button, Username field',
  visualElements: { hasButtons: true, hasText: true }
}, {
  type: 'image',
  analysisType: 'screenshot'
  // Will use llava:7b model locally
});

// Force specific provider if needed
const externalResult = await llmService.analyzeContent({
  text: 'Complex analysis requiring external API',
}, {
  type: 'text',
  provider: 'openai',
  forceProvider: true // Skip Ollama, use OpenAI directly
});
```

### Ollama Setup

```bash
# Install Ollama
curl -fsSL https://ollama.ai/install.sh | sh

# Start Ollama server
ollama serve

# Setup essential models for the LLM service
node scripts/setup-ollama.js setup

# Or install specific models
ollama pull llama3.2:3b
ollama pull llava:7b
ollama pull codellama:7b
```

### Docker Setup with Ollama

```yaml
# docker-compose.yml includes Ollama service
services:
  ollama:
    image: ollama/ollama:latest
    ports:
      - "11434:11434"
    volumes:
      - ollama_data:/root/.ollama
    # GPU support (optional)
    # deploy:
    #   resources:
    #     reservations:
    #       devices:
    #         - driver: nvidia
    #           count: 1
    #           capabilities: [gpu]
```

## Queue Management

The workers use Redis-backed BullMQ queues for reliable job processing.

### Queue Configuration

```javascript
const { 
  enqueueImageProcessingJob,
  enqueueLLMAnalysisJob,
  enqueueCompleteProcessing 
} = require('../queues/imageProcessingQueue');

// Process single image
const imageJobId = await enqueueImageProcessingJob(artifactId, {
  formats: ['webp', 'jpeg'],
  languages: ['eng']
});

// Process with LLM analysis
const llmJobId = await enqueueLLMAnalysisJob(artifactId, {
  provider: 'openai',
  analysisType: 'screenshot'
});

// Complete pipeline
const { imageJobId, llmJobId } = await enqueueCompleteProcessing(artifactId, {
  image: { formats: ['webp'] },
  llm: { provider: 'anthropic' }
});
```

### Monitoring

- **Job Progress**: Real-time progress updates via WebSocket
- **Error Handling**: Comprehensive error classification and retry logic
- **Performance Metrics**: Processing times, success rates, cost tracking
- **Queue Statistics**: Job counts, throughput, failure rates

## Testing

Comprehensive test suites are provided for all components:

```bash
# Run all worker tests
npm test -- --testPathPattern="Worker"

# Run simple functionality tests
npm test -- --testPathPattern="simple"

# Run with coverage
npm test -- --coverage
```

### Test Categories

- **Unit Tests**: Individual method testing with mocks
- **Integration Tests**: End-to-end processing workflows
- **Performance Tests**: Memory usage and processing speed benchmarks
- **Error Handling Tests**: Failure scenarios and recovery

## Performance Considerations

### ImageWorker Optimization

- **Memory Management**: Streaming processing for large images
- **Parallel Processing**: Concurrent variant generation
- **CPU Efficiency**: Optimized algorithms for image analysis
- **Storage Optimization**: Compressed variants and efficient S3 usage

### LLMWorker Optimization

- **Request Batching**: Minimize API calls where possible
- **Caching**: Response caching for similar content
- **Load Balancing**: Distribute requests across providers
- **Cost Management**: Intelligent model selection based on content complexity

## Error Handling

### Retry Strategies

- **Exponential Backoff**: Increasing delays between retries
- **Jitter**: Random delays to prevent thundering herd
- **Circuit Breaker**: Temporary failure isolation
- **Dead Letter Queue**: Manual intervention for persistent failures

### Error Classification

- **Transient Errors**: Network timeouts, rate limits (retry)
- **Validation Errors**: Invalid content, security issues (fail immediately)
- **Processing Errors**: LLM failures, parsing issues (retry with different strategy)
- **System Errors**: Database failures, S3 outages (alert and retry)

## Security

### Data Protection

- **Encryption**: All data encrypted at rest and in transit
- **Access Control**: Role-based permissions for processing
- **Audit Logging**: Complete processing history and access logs
- **PII Detection**: Automatic identification and flagging of sensitive data

### API Security

- **Key Management**: Secure credential storage and rotation
- **Rate Limiting**: Prevent abuse and manage costs
- **Input Validation**: Comprehensive content validation
- **Sandboxing**: Isolated processing environments

## Deployment

### Docker Configuration

```dockerfile
# Worker container
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
CMD ["node", "worker.js"]
```

### Environment Variables

```bash
# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# AWS Configuration
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=us-east-1

# LLM Provider Keys
OPENAI_API_KEY=
ANTHROPIC_API_KEY=

# Processing Configuration
MAX_IMAGE_SIZE=52428800  # 50MB
MAX_CONCURRENT_JOBS=5
ENABLE_WORKER_HEALTH_CHECK=true
```

### Scaling

- **Horizontal Scaling**: Multiple worker instances
- **Queue Partitioning**: Separate queues for different content types
- **Load Balancing**: Distribute work across available workers
- **Auto-scaling**: Dynamic worker scaling based on queue depth

## Monitoring and Alerting

### Metrics

- **Processing Throughput**: Jobs per minute/hour
- **Success Rate**: Percentage of successful processing
- **Average Processing Time**: Performance benchmarks
- **Cost Tracking**: LLM API usage and costs
- **Error Rates**: Failure patterns and trends

### Alerts

- **High Error Rate**: > 5% failures in 5 minutes
- **Queue Backup**: > 100 pending jobs
- **Processing Delays**: > 10 minutes average processing time
- **Cost Threshold**: Daily LLM costs > $100
- **System Health**: Worker availability and Redis connectivity

## Future Enhancements

### Planned Features

- **Additional LLM Providers**: Google Gemini, local models
- **Advanced Vision Analysis**: Object detection, scene understanding
- **Real-time Processing**: WebSocket-based live analysis
- **Batch Processing**: Efficient handling of multiple files
- **Custom Models**: Fine-tuned models for specific use cases

### Performance Improvements

- **GPU Acceleration**: CUDA support for image processing
- **Distributed Processing**: Multi-node worker clusters
- **Caching Layer**: Redis-based result caching
- **Compression**: Advanced image compression algorithms
- **Streaming**: Real-time processing for large files