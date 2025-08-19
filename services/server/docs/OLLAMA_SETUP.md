# Ollama Integration Setup Guide

This guide walks you through setting up Ollama for local LLM processing in the S3 Upload Pipeline.

## Overview

The LLM service has been refactored to prioritize **Ollama** as the primary provider for:
- **Privacy**: All processing happens locally, no data sent to external APIs
- **Cost Efficiency**: Zero API costs for unlimited usage
- **Performance**: Direct hardware utilization with GPU acceleration support
- **Reliability**: No dependency on external service availability

## Quick Start

### 1. Install Ollama

#### macOS/Linux
```bash
curl -fsSL https://ollama.ai/install.sh | sh
```

#### Windows
Download from [ollama.ai](https://ollama.ai/download) and run the installer.

#### Docker
```bash
docker run -d \
  -v ollama:/root/.ollama \
  -p 11434:11434 \
  --name ollama \
  ollama/ollama
```

### 2. Start Ollama Server

```bash
ollama serve
```

The server will start on `http://localhost:11434`

### 3. Setup Essential Models

Use our automated setup script:

```bash
cd services/server
node scripts/setup-ollama.js setup
```

Or install models manually:

```bash
# Essential models for the LLM service
ollama pull llama3.2:3b    # Fast text analysis (2GB)
ollama pull llava:7b       # Vision/image analysis (4GB)
ollama pull codellama:7b   # Code analysis (4GB)

# Optional: Smaller/faster alternatives
ollama pull llama3.2:1b    # Ultra-fast text (1GB)
ollama pull phi3:3.8b      # Microsoft's efficient model (2GB)
```

### 4. Verify Setup

```bash
# Check health
node scripts/setup-ollama.js health

# List installed models
node scripts/setup-ollama.js list

# Run integration demo
node examples/llm-integration-demo.js
```

## Docker Compose Setup

The project includes Ollama in the Docker Compose configuration:

```yaml
# docker-compose.yml
services:
  ollama:
    image: ollama/ollama:latest
    ports:
      - "11434:11434"
    volumes:
      - ollama_data:/root/.ollama
    environment:
      OLLAMA_HOST: 0.0.0.0
      OLLAMA_ORIGINS: "*"
    restart: unless-stopped
```

### Start with Docker Compose

```bash
# Start all services including Ollama
docker-compose up -d

# Setup models in the container
docker-compose exec ollama ollama pull llama3.2:3b
docker-compose exec ollama ollama pull llava:7b
docker-compose exec ollama ollama pull codellama:7b

# Or use the setup script
docker-compose exec server node scripts/setup-ollama.js setup
```

### GPU Support (Optional)

For NVIDIA GPU acceleration, uncomment the GPU configuration in `docker-compose.yml`:

```yaml
ollama:
  # ... other config
  deploy:
    resources:
      reservations:
        devices:
          - driver: nvidia
            count: 1
            capabilities: [gpu]
```

## Configuration

### Environment Variables

```bash
# Ollama Configuration
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_TEXT_MODEL=llama3.2:3b
OLLAMA_VISION_MODEL=llava:7b
OLLAMA_CODE_MODEL=codellama:7b

# Fallback Providers (optional)
OPENAI_API_KEY=your_openai_key
ANTHROPIC_API_KEY=your_anthropic_key
```

### Model Selection

The service automatically selects appropriate models based on content type:

| Content Type | Default Model | Purpose |
|--------------|---------------|---------|
| Text | `llama3.2:3b` | General text analysis, logs, documents |
| Image/Vision | `llava:7b` | Screenshot analysis, diagram interpretation |
| Code | `codellama:7b` | Code review, programming assistance |

## Model Recommendations

### Essential Models (Required)

1. **llama3.2:3b** (2GB)
   - Fast, efficient text processing
   - Good for logs, documents, general analysis
   - 8K context window

2. **llava:7b** (4GB)
   - Multimodal vision capabilities
   - Analyzes screenshots, diagrams, images with text
   - 4K context window

3. **codellama:7b** (4GB)
   - Specialized for code analysis
   - Code review, bug detection, optimization suggestions
   - 16K context window

### Optional Models (Performance/Alternatives)

1. **llama3.2:1b** (1GB)
   - Ultra-fast for simple tasks
   - Good for basic text classification
   - Lower quality but very fast

2. **llama3.1:8b** (5GB)
   - Higher quality text analysis
   - Better reasoning capabilities
   - 32K context window

3. **mistral:7b** (4GB)
   - Alternative text model
   - Good multilingual support
   - 8K context window

4. **phi3:3.8b** (2GB)
   - Microsoft's efficient model
   - Good balance of speed and quality
   - 4K context window

## Usage Examples

### Automatic Provider Selection

```javascript
const LLMService = require('./services/LLMService');
const llmService = new LLMService();

// Will automatically use Ollama if available, fallback to external providers
const result = await llmService.analyzeContent({
  text: 'ERROR: Database connection timeout',
  metadata: { filename: 'app.log' }
}, {
  type: 'text',
  analysisType: 'logAnalysis'
});

console.log(`Provider used: ${result.metadata.provider}`); // 'ollama'
console.log(`Cost: $${result.metadata.estimatedCost}`);    // 0
console.log(`Local processing: ${result.metadata.isLocal}`); // true
```

### Force Specific Provider

```javascript
// Force Ollama (will fail if not available)
const ollamaResult = await llmService.analyzeContent(content, {
  provider: 'ollama',
  forceProvider: true
});

// Force external provider (skip Ollama)
const externalResult = await llmService.analyzeContent(content, {
  provider: 'openai',
  forceProvider: true
});
```

### Image Analysis with Local Vision Model

```javascript
const imageResult = await llmService.analyzeContent({
  imageBuffer: screenshotBuffer,
  ocrText: 'Login button, Username field',
  visualElements: { hasButtons: true, hasText: true }
}, {
  type: 'image',
  analysisType: 'screenshot'
});

// Uses llava:7b locally for privacy
```

## Performance Optimization

### Hardware Requirements

**Minimum:**
- 8GB RAM
- 4GB free disk space
- CPU: Any modern processor

**Recommended:**
- 16GB+ RAM
- 10GB+ free disk space
- GPU: NVIDIA with 8GB+ VRAM (optional but significantly faster)

### Model Size vs Performance

| Model | Size | Speed | Quality | Use Case |
|-------|------|-------|---------|----------|
| llama3.2:1b | 1GB | Very Fast | Good | Simple tasks, classification |
| llama3.2:3b | 2GB | Fast | Very Good | General purpose, recommended |
| llama3.1:8b | 5GB | Medium | Excellent | Complex analysis, reasoning |
| llava:7b | 4GB | Medium | Very Good | Vision tasks, multimodal |
| codellama:7b | 4GB | Medium | Excellent | Code analysis, programming |

### Performance Tips

1. **Use appropriate model sizes** for your hardware
2. **Enable GPU acceleration** if available
3. **Adjust concurrency** in worker configuration based on resources
4. **Monitor memory usage** during processing
5. **Use smaller models** for simple tasks to improve speed

## Troubleshooting

### Common Issues

#### 1. Ollama Server Not Running
```bash
# Error: Connection refused
# Solution: Start Ollama server
ollama serve
```

#### 2. Model Not Found
```bash
# Error: Model 'llama3.2:3b' not found
# Solution: Pull the model
ollama pull llama3.2:3b
```

#### 3. Out of Memory
```bash
# Error: Out of memory
# Solutions:
# - Use smaller models (llama3.2:1b instead of llama3.1:8b)
# - Reduce worker concurrency
# - Add more RAM or enable swap
```

#### 4. Slow Performance
```bash
# Solutions:
# - Use GPU acceleration
# - Use smaller models for simple tasks
# - Increase RAM
# - Reduce concurrent processing
```

### Health Check Commands

```bash
# Check Ollama server status
curl http://localhost:11434/api/tags

# List installed models
ollama list

# Test model functionality
ollama run llama3.2:3b "Hello, are you working?"

# Check system resources
docker stats ollama  # If using Docker
```

### Logs and Debugging

```bash
# Ollama server logs
journalctl -u ollama  # Linux systemd
docker logs ollama    # Docker

# Application logs
npm run worker  # Check worker output for LLM processing logs
```

## Migration from External Providers

### Gradual Migration

1. **Install Ollama** alongside existing setup
2. **Test with non-critical workloads** first
3. **Monitor performance** and adjust models as needed
4. **Gradually increase** Ollama usage
5. **Keep external providers** as fallbacks

### Cost Comparison

| Provider | Model | Cost per 1M tokens | Ollama Equivalent |
|----------|-------|-------------------|-------------------|
| OpenAI | gpt-4o-mini | $0.15 input, $0.60 output | llama3.2:3b (Free) |
| OpenAI | gpt-4o | $2.50 input, $10.00 output | llama3.1:8b (Free) |
| Anthropic | claude-3-haiku | $0.25 input, $1.25 output | llama3.2:3b (Free) |

**Example savings:** Processing 10M tokens/month with gpt-4o-mini costs ~$75/month. With Ollama: $0.

## Security and Privacy

### Data Privacy Benefits

- **No external API calls** - all processing happens locally
- **No data logging** by third parties
- **Full control** over model behavior and updates
- **Compliance friendly** - data never leaves your infrastructure
- **Audit trail** - complete visibility into processing

### Security Considerations

- **Network isolation** - Ollama can run completely offline
- **Access control** - standard Docker/system security applies
- **Model integrity** - verify model checksums if needed
- **Resource limits** - prevent resource exhaustion attacks

## Advanced Configuration

### Custom Models

```bash
# Create custom model with specific parameters
ollama create mymodel -f Modelfile

# Example Modelfile for specialized use case
FROM llama3.2:3b
PARAMETER temperature 0.1
PARAMETER top_p 0.9
SYSTEM "You are a specialized log analyzer..."
```

### Performance Tuning

```bash
# Environment variables for Ollama
export OLLAMA_NUM_PARALLEL=2        # Parallel requests
export OLLAMA_MAX_LOADED_MODELS=3   # Models in memory
export OLLAMA_FLASH_ATTENTION=1     # Enable flash attention (if supported)
```

### Monitoring and Metrics

```javascript
// Get usage statistics
const stats = llmService.getUsageStats();
console.log(`Total requests: ${stats.totalRequests}`);
console.log(`Total cost: $${stats.totalCost}`); // Should be 0 for Ollama
console.log(`Ollama requests: ${stats.requestsByProvider.ollama}`);

// Get performance metrics
const ollamaManager = new OllamaManager();
const metrics = await ollamaManager.getPerformanceMetrics();
console.log(`Average response time: ${metrics.testResponseTime}ms`);
```

## Support and Resources

### Documentation
- [Ollama Official Docs](https://ollama.ai/docs)
- [Model Library](https://ollama.ai/library)
- [API Reference](https://github.com/ollama/ollama/blob/main/docs/api.md)

### Community
- [Ollama GitHub](https://github.com/ollama/ollama)
- [Discord Community](https://discord.gg/ollama)

### Getting Help

1. **Check logs** first for error details
2. **Run health check** to identify issues
3. **Verify models** are properly installed
4. **Check system resources** (RAM, disk space)
5. **Consult troubleshooting** section above

For project-specific issues, check the application logs and ensure all dependencies are properly configured.