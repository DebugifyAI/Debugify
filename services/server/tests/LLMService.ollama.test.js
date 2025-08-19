const LLMService = require('../services/LLMService');
const OllamaManager = require('../utils/OllamaManager');
const axios = require('axios');

// Mock axios
jest.mock('axios');

describe('LLMService Ollama Integration', () => {
  let llmService;
  let ollamaManager;

  beforeEach(() => {
    // Set up environment variables for testing
    process.env.OLLAMA_BASE_URL = 'http://localhost:11434';
    process.env.OLLAMA_TEXT_MODEL = 'llama3.2:3b';
    process.env.OLLAMA_VISION_MODEL = 'llava:7b';
    process.env.OLLAMA_CODE_MODEL = 'codellama:7b';
    
    llmService = new LLMService();
    ollamaManager = new OllamaManager();
    
    // Reset usage tracking
    llmService.resetUsageStats();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Ollama provider configuration', () => {
    it('should have Ollama as default provider', () => {
      expect(llmService.defaultProvider).toBe('ollama');
    });

    it('should configure Ollama provider correctly', () => {
      const ollamaConfig = llmService.providers.ollama;
      
      expect(ollamaConfig).toBeDefined();
      expect(ollamaConfig.name).toBe('Ollama');
      expect(ollamaConfig.type).toBe('local');
      expect(ollamaConfig.baseURL).toBe('http://localhost:11434');
      expect(ollamaConfig.apiKey).toBeNull();
      expect(ollamaConfig.models.text).toBe('llama3.2:3b');
      expect(ollamaConfig.models.vision).toBe('llava:7b');
      expect(ollamaConfig.models.code).toBe('codellama:7b');
    });

    it('should have zero pricing for local models', () => {
      const ollamaConfig = llmService.providers.ollama;
      
      Object.values(ollamaConfig.pricing).forEach(pricing => {
        expect(pricing.input).toBe(0);
        expect(pricing.output).toBe(0);
      });
    });
  });

  describe('Provider availability and selection', () => {
    it('should consider Ollama available without API key', () => {
      expect(llmService.isProviderAvailable('ollama')).toBe(true);
    });

    it('should select appropriate models for content types', () => {
      expect(llmService.selectModel('ollama', 'text')).toBe('llama3.2:3b');
      expect(llmService.selectModel('ollama', 'image')).toBe('llava:7b');
      expect(llmService.selectModel('ollama', 'code')).toBe('codellama:7b');
      expect(llmService.selectModel('ollama', 'vision')).toBe('llava:7b');
    });

    it('should get best provider with Ollama health check', async () => {
      // Mock successful Ollama health check and model list
      axios.get
        .mockResolvedValueOnce({ status: 200 }) // Health check
        .mockResolvedValueOnce({ // Model list
          status: 200,
          data: { models: [{ name: 'llama3.2:3b' }, { name: 'llava:7b' }] },
        });

      const provider = await llmService.getBestProvider('text');
      expect(provider).toBe('ollama');
    });

    it('should fallback to external providers when Ollama fails', async () => {
      // Mock Ollama health check failure
      axios.get.mockRejectedValueOnce(new Error('Connection refused'));
      
      // Set up external provider
      process.env.OPENAI_API_KEY = 'test-key';
      llmService = new LLMService();

      const provider = await llmService.getBestProvider('text');
      expect(provider).toBe('openai');
    });
  });

  describe('Ollama API requests', () => {
    beforeEach(() => {
      // Mock successful health check
      axios.get.mockResolvedValue({
        status: 200,
        data: { models: [] },
      });
    });

    it('should make text request to Ollama', async () => {
      const mockResponse = {
        data: {
          response: 'This is a test response from Ollama',
          model: 'llama3.2:3b',
          done: true,
          context: [1, 2, 3],
        },
      };

      axios.post.mockResolvedValueOnce(mockResponse);

      const chunk = {
        type: 'text',
        prompt: 'Test prompt',
        data: { text: 'Test content' },
      };

      const result = await llmService.makeOllamaTextRequest(chunk, 'llama3.2:3b', {});

      expect(result.analysis).toBe('This is a test response from Ollama');
      expect(result.usage.totalTokens).toBeGreaterThan(0);
      expect(result.metadata.model).toBe('llama3.2:3b');
      
      expect(axios.post).toHaveBeenCalledWith(
        'http://localhost:11434/api/generate',
        expect.objectContaining({
          model: 'llama3.2:3b',
          stream: false,
        }),
        expect.objectContaining({
          headers: { 'Content-Type': 'application/json' },
          timeout: 120000,
        }),
      );
    });

    it('should make vision request to Ollama', async () => {
      const mockResponse = {
        data: {
          response: 'This image shows a test screenshot',
          model: 'llava:7b',
          done: true,
        },
      };

      axios.post.mockResolvedValueOnce(mockResponse);

      const chunk = {
        type: 'image',
        prompt: 'Analyze this image',
        data: {
          imageBuffer: Buffer.from('fake-image-data'),
          ocrText: 'Sample OCR text',
          visualElements: { hasButtons: true },
        },
      };

      const result = await llmService.makeOllamaVisionRequest(chunk, 'llava:7b', {});

      expect(result.analysis).toBe('This image shows a test screenshot');
      expect(result.metadata.hasImage).toBe(true);
      
      const requestBody = axios.post.mock.calls[0][1];
      expect(requestBody.images).toHaveLength(1);
      expect(requestBody.prompt).toContain('Analyze this image');
      expect(requestBody.prompt).toContain('Sample OCR text');
    });

    it('should handle Ollama server not running', async () => {
      axios.get.mockRejectedValueOnce({ code: 'ECONNREFUSED' });

      await expect(llmService.checkOllamaHealth()).rejects.toThrow('Ollama health check failed');
    });

    it('should handle model not found error', async () => {
      axios.post.mockRejectedValueOnce({
        response: { status: 404 },
      });

      const chunk = {
        type: 'text',
        prompt: 'Test',
        data: { text: 'Test' },
      };

      await expect(
        llmService.makeOllamaTextRequest(chunk, 'nonexistent:model', {}),
      ).rejects.toThrow('Model \'nonexistent:model\' not found in Ollama');
    });
  });

  describe('Content analysis with Ollama', () => {
    beforeEach(() => {
      // Mock successful health check and model availability
      axios.get.mockResolvedValue({
        status: 200,
        data: { models: [{ name: 'llama3.2:3b' }, { name: 'llava:7b' }] },
      });
    });

    it('should analyze text content with Ollama', async () => {
      axios.post.mockResolvedValueOnce({
        data: {
          response: 'Detailed analysis of the log entries...',
          model: 'llama3.2:3b',
          done: true,
        },
      });

      const content = {
        text: 'ERROR: Database connection failed',
        metadata: { filename: 'app.log' },
      };

      const result = await llmService.analyzeContent(content, {
        type: 'text',
        analysisType: 'logAnalysis',
      });

      expect(result.success).toBe(true);
      expect(result.analysis).toContain('Detailed analysis');
      expect(result.metadata.provider).toBe('ollama');
      expect(result.metadata.model).toBe('llama3.2:3b');
      expect(result.metadata.isLocal).toBe(true);
      expect(result.metadata.estimatedCost).toBe(0);
    });

    it('should analyze image content with Ollama vision model', async () => {
      axios.post.mockResolvedValueOnce({
        data: {
          response: 'This screenshot shows a web application interface...',
          model: 'llava:7b',
          done: true,
        },
      });

      const content = {
        imageBuffer: Buffer.from('fake-image-data'),
        ocrText: 'Login button, Username field',
        visualElements: { hasButtons: true, hasText: true },
      };

      const result = await llmService.analyzeContent(content, {
        type: 'image',
        analysisType: 'screenshot',
      });

      expect(result.success).toBe(true);
      expect(result.analysis).toContain('screenshot shows');
      expect(result.metadata.provider).toBe('ollama');
      expect(result.metadata.model).toBe('llava:7b');
      expect(result.metadata.isLocal).toBe(true);
    });

    it('should fallback to external provider when Ollama fails', async () => {
      // Set up external provider first
      process.env.OPENAI_API_KEY = 'test-key';
      llmService = new LLMService();

      // Mock Ollama health check failure
      axios.get.mockRejectedValueOnce(new Error('Connection refused'));

      // Mock successful OpenAI fallback
      axios.post.mockResolvedValueOnce({
        data: {
          choices: [{ message: { content: 'OpenAI fallback response' } }],
          usage: { total_tokens: 100 },
        },
      });

      const content = { text: 'Test content' };

      const result = await llmService.analyzeContent(content, {
        type: 'text',
        analysisType: 'general',
      });

      expect(result.success).toBe(true);
      expect(result.analysis).toBe('OpenAI fallback response');
      expect(result.metadata.provider).toBe('openai');
      // Note: attemptedFallbacks is only set when the primary provider fails during processing
      // In this case, we're selecting the fallback provider from the start
    });
  });

  describe('Usage tracking with local models', () => {
    it('should track usage with zero cost for Ollama', async () => {
      const usage = {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      };

      llmService.trackUsage('ollama', 'llama3.2:3b', {
        ...usage,
        estimatedCost: 0,
      });

      const stats = llmService.getUsageStats();
      
      expect(stats.totalRequests).toBe(1);
      expect(stats.totalTokens).toBe(150);
      expect(stats.totalCost).toBe(0);
      expect(stats.requestsByProvider.ollama).toBe(1);
      expect(stats.costsByProvider.ollama).toBe(0);
    });
  });

  describe('Service capabilities with Ollama', () => {
    it('should include Ollama features in capabilities', () => {
      const capabilities = llmService.getCapabilities();
      
      expect(capabilities.providers).toContain('ollama');
      expect(capabilities.defaultProvider).toBe('ollama');
      expect(capabilities.supportedContentTypes).toContain('code');
      expect(capabilities.features).toContain('local_llm_support');
      expect(capabilities.features).toContain('ollama_integration');
      expect(capabilities.features).toContain('privacy_focused');
      expect(capabilities.features).toContain('zero_cost_local_processing');
      expect(capabilities.localCapabilities.provider).toBe('ollama');
    });
  });
});

describe('OllamaManager', () => {
  let ollamaManager;

  beforeEach(() => {
    ollamaManager = new OllamaManager();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Server management', () => {
    it('should check server health', async () => {
      axios.get.mockResolvedValueOnce({ status: 200 });

      const isRunning = await ollamaManager.isServerRunning();
      expect(isRunning).toBe(true);
      
      expect(axios.get).toHaveBeenCalledWith(
        'http://localhost:11434/api/tags',
        { timeout: 5000 },
      );
    });

    it('should handle server not running', async () => {
      axios.get.mockRejectedValueOnce(new Error('Connection refused'));

      const isRunning = await ollamaManager.isServerRunning();
      expect(isRunning).toBe(false);
    });

    it('should get server info', async () => {
      const mockServerInfo = { version: '0.1.0' };
      axios.get.mockResolvedValueOnce({ data: mockServerInfo });

      const info = await ollamaManager.getServerInfo();
      expect(info).toEqual(mockServerInfo);
    });
  });

  describe('Model management', () => {
    it('should list models', async () => {
      const mockModels = [
        { name: 'llama3.2:3b', size: 1000000 },
        { name: 'llava:7b', size: 2000000 },
      ];
      
      axios.get.mockResolvedValueOnce({ data: { models: mockModels } });

      const models = await ollamaManager.listModels();
      expect(models).toEqual(mockModels);
    });

    it('should check if model is installed', async () => {
      const mockModels = [{ name: 'llama3.2:3b' }];
      axios.get.mockResolvedValueOnce({ data: { models: mockModels } });

      const isInstalled = await ollamaManager.isModelInstalled('llama3.2:3b');
      expect(isInstalled).toBe(true);

      const isNotInstalled = await ollamaManager.isModelInstalled('nonexistent:model');
      expect(isNotInstalled).toBe(false);
    });

    it('should test model functionality', async () => {
      const mockResponse = {
        data: {
          response: 'Model is working correctly.',
          model: 'llama3.2:3b',
          total_duration: 1000000000, // 1 second in nanoseconds
        },
      };
      
      axios.post.mockResolvedValueOnce(mockResponse);

      const result = await ollamaManager.testModel('llama3.2:3b');
      
      expect(result.success).toBe(true);
      expect(result.working).toBe(true);
      expect(result.response).toBe('Model is working correctly.');
      expect(result.processingTime).toBe(1000);
    });
  });

  describe('Health reporting', () => {
    it('should generate comprehensive health report', async () => {
      // Mock server running
      axios.get
        .mockResolvedValueOnce({ status: 200 }) // Health check
        .mockResolvedValueOnce({ data: { version: '0.1.0' } }) // Server info
        .mockResolvedValueOnce({ // List models
          data: {
            models: [
              { name: 'llama3.2:3b', size: 1000000 },
              { name: 'llava:7b', size: 2000000 },
            ],
          },
        });

      // Mock test model
      axios.post.mockResolvedValueOnce({
        data: {
          response: 'Model is working correctly.',
          model: 'llama3.2:3b',
          total_duration: 500000000,
        },
      });

      const report = await ollamaManager.getHealthReport();

      expect(report.server.running).toBe(true);
      expect(report.server.version).toBe('0.1.0');
      expect(report.models.total).toBe(2);
      expect(report.models.essential.text).toBe(true);
      expect(report.models.essential.vision).toBe(true);
      expect(report.performance).toBeDefined();
      expect(report.recommendations).toBeInstanceOf(Array);
    });

    it('should handle server not running in health report', async () => {
      axios.get.mockRejectedValueOnce(new Error('Connection refused'));

      const report = await ollamaManager.getHealthReport();

      expect(report.server.running).toBe(false);
      expect(report.recommendations).toContain('Ollama server is not running. Please start the Ollama service.');
    });
  });
});