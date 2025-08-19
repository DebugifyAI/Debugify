const LLMService = require('../services/LLMService');
const axios = require('axios');

// Mock axios
jest.mock('axios');

describe('LLMService', () => {
  let llmService;

  beforeEach(() => {
    // Set up environment variables for testing
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    
    llmService = new LLMService();
    
    // Reset usage tracking
    llmService.resetUsageStats();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize with correct providers', () => {
      expect(llmService.providers).toHaveProperty('openai');
      expect(llmService.providers).toHaveProperty('anthropic');
      expect(llmService.defaultProvider).toBe('openai');
    });

    it('should initialize prompt templates', () => {
      expect(llmService.promptTemplates).toHaveProperty('imageAnalysis');
      expect(llmService.promptTemplates).toHaveProperty('textAnalysis');
      expect(llmService.promptTemplates.imageAnalysis).toHaveProperty('screenshot');
      expect(llmService.promptTemplates.imageAnalysis).toHaveProperty('diagram');
      expect(llmService.promptTemplates.imageAnalysis).toHaveProperty('codeImage');
    });
  });

  describe('analyzeContent', () => {
    const mockContent = {
      text: 'Sample text content for analysis',
      metadata: { filename: 'test.txt' },
    };

    beforeEach(() => {
      // Mock successful OpenAI response
      axios.post.mockResolvedValue({
        data: {
          choices: [
            {
              message: {
                content: 'This is a detailed analysis of the provided content.',
              },
            },
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 50,
            total_tokens: 150,
          },
        },
      });
    });

    it('should analyze text content successfully', async () => {
      const result = await llmService.analyzeContent(mockContent, {
        type: 'text',
        analysisType: 'documentSummary',
      });

      expect(result.success).toBe(true);
      expect(result.analysis).toContain('detailed analysis');
      expect(result.metadata).toHaveProperty('provider', 'openai');
      expect(result.metadata).toHaveProperty('totalTokens', 150);
      expect(axios.post).toHaveBeenCalledWith(
        'https://api.openai.com/v1/chat/completions',
        expect.objectContaining({
          model: 'gpt-4o-mini',
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'system' }),
            expect.objectContaining({ role: 'user' }),
          ]),
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-openai-key',
          }),
        })
      );
    });

    it('should analyze image content with vision model', async () => {
      const imageContent = {
        imageBuffer: Buffer.from('fake-image-data'),
        ocrText: 'Extracted text from image',
        metadata: { filename: 'screenshot.png' },
      };

      const result = await llmService.analyzeContent(imageContent, {
        type: 'image',
        analysisType: 'screenshot',
      });

      expect(result.success).toBe(true);
      expect(result.metadata.model).toBe('gpt-4o'); // Vision model
      
      const requestBody = axios.post.mock.calls[0][1];
      expect(requestBody.messages[1].content).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'text' }),
          expect.objectContaining({ type: 'image_url' }),
        ])
      );
    });

    it('should handle provider unavailability', async () => {
      const result = await llmService.analyzeContent(mockContent, {
        provider: 'nonexistent',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not available or configured');
    });

    it('should handle API errors gracefully', async () => {
      axios.post.mockRejectedValue({
        response: {
          status: 429,
          data: { error: { message: 'Rate limit exceeded' } },
        },
      });

      const result = await llmService.analyzeContent(mockContent);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Rate limit exceeded');
    });

    it('should retry on transient errors', async () => {
      // First call fails, second succeeds
      axios.post
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          data: {
            choices: [{ message: { content: 'Success after retry' } }],
            usage: { total_tokens: 100 },
          },
        });

      const result = await llmService.analyzeContent(mockContent);

      expect(result.success).toBe(true);
      expect(result.analysis).toBe('Success after retry');
      expect(axios.post).toHaveBeenCalledTimes(2);
    });
  });

  describe('content preparation', () => {
    it('should prepare text content correctly', async () => {
      const content = { text: 'Sample text', metadata: { type: 'log' } };
      const prepared = await llmService.prepareContent(content, 'text', 'logAnalysis');

      expect(prepared.type).toBe('text');
      expect(prepared.analysisType).toBe('logAnalysis');
      expect(prepared.data.text).toBe('Sample text');
      expect(prepared.prompt).toContain('log entries');
    });

    it('should prepare image content correctly', async () => {
      const content = {
        imageBuffer: Buffer.from('image-data'),
        ocrText: 'OCR text',
        visualElements: { hasButtons: true },
      };
      const prepared = await llmService.prepareContent(content, 'image', 'screenshot');

      expect(prepared.type).toBe('image');
      expect(prepared.analysisType).toBe('screenshot');
      expect(prepared.data.imageBuffer).toEqual(Buffer.from('image-data'));
      expect(prepared.data.ocrText).toBe('OCR text');
      expect(prepared.prompt).toContain('screenshot');
    });

    it('should handle mixed content', async () => {
      const content = {
        text: 'Document text',
        images: [{ buffer: Buffer.from('img1') }],
      };
      const prepared = await llmService.prepareContent(content, 'mixed', 'general');

      expect(prepared.type).toBe('mixed');
      expect(prepared.data.text).toBe('Document text');
      expect(prepared.data.images).toHaveLength(1);
    });
  });

  describe('content chunking', () => {
    it('should not chunk small content', async () => {
      const content = {
        type: 'text',
        data: { text: 'Short text content' },
      };

      const chunks = await llmService.chunkContent(content, 'openai', 'gpt-4o-mini');
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toEqual(content);
    });

    it('should chunk large text content', async () => {
      const largeText = 'word '.repeat(50000); // Large text
      const content = {
        type: 'text',
        data: { text: largeText },
      };

      const chunks = await llmService.chunkContent(content, 'openai', 'gpt-4o-mini');
      expect(chunks.length).toBeGreaterThan(1);
      
      chunks.forEach((chunk, index) => {
        expect(chunk.data.chunkInfo.index).toBe(index);
        expect(chunk.data.chunkInfo.isPartial).toBe(true);
      });
    });

    it('should not chunk image content', async () => {
      const content = {
        type: 'image',
        data: { imageBuffer: Buffer.from('image-data') },
      };

      const chunks = await llmService.chunkContent(content, 'openai', 'gpt-4o');
      expect(chunks).toHaveLength(1);
    });
  });

  describe('provider requests', () => {
    describe('OpenAI', () => {
      it('should make correct OpenAI text request', async () => {
        const chunk = {
          type: 'text',
          prompt: 'Analyze this text',
          data: { text: 'Sample content' },
        };

        axios.post.mockResolvedValue({
          data: {
            choices: [{ message: { content: 'Analysis result' } }],
            usage: { total_tokens: 100 },
          },
        });

        const result = await llmService.makeOpenAIRequest(chunk, 'gpt-4o-mini');

        expect(result.analysis).toBe('Analysis result');
        expect(result.usage.totalTokens).toBe(100);
        expect(axios.post).toHaveBeenCalledWith(
          'https://api.openai.com/v1/chat/completions',
          expect.objectContaining({
            model: 'gpt-4o-mini',
            messages: expect.arrayContaining([
              expect.objectContaining({ role: 'system' }),
              expect.objectContaining({ role: 'user' }),
            ]),
          }),
          expect.any(Object)
        );
      });

      it('should make correct OpenAI image request', async () => {
        const chunk = {
          type: 'image',
          prompt: 'Analyze this image',
          data: {
            imageBuffer: Buffer.from('image-data'),
            ocrText: 'OCR text',
          },
        };

        axios.post.mockResolvedValue({
          data: {
            choices: [{ message: { content: 'Image analysis' } }],
            usage: { total_tokens: 200 },
          },
        });

        const result = await llmService.makeOpenAIRequest(chunk, 'gpt-4o');

        expect(result.analysis).toBe('Image analysis');
        
        const requestBody = axios.post.mock.calls[0][1];
        const userMessage = requestBody.messages.find(m => m.role === 'user');
        expect(userMessage.content).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ type: 'text' }),
            expect.objectContaining({ type: 'image_url' }),
            expect.objectContaining({ type: 'text', text: expect.stringContaining('OCR text') }),
          ])
        );
      });
    });

    describe('Anthropic', () => {
      it('should make correct Anthropic request', async () => {
        const chunk = {
          type: 'text',
          prompt: 'Analyze this text',
          data: { text: 'Sample content' },
        };

        axios.post.mockResolvedValue({
          data: {
            content: [{ text: 'Anthropic analysis' }],
            usage: { input_tokens: 50, output_tokens: 75 },
          },
        });

        const result = await llmService.makeAnthropicRequest(chunk, 'claude-3-haiku-20240307');

        expect(result.analysis).toBe('Anthropic analysis');
        expect(result.usage.totalTokens).toBe(125);
        expect(axios.post).toHaveBeenCalledWith(
          'https://api.anthropic.com/v1/messages',
          expect.objectContaining({
            model: 'claude-3-haiku-20240307',
            messages: expect.arrayContaining([
              expect.objectContaining({ role: 'user' }),
            ]),
          }),
          expect.objectContaining({
            headers: expect.objectContaining({
              'x-api-key': 'test-anthropic-key',
              'anthropic-version': '2023-06-01',
            }),
          })
        );
      });
    });
  });

  describe('result combination', () => {
    it('should return single result as-is', async () => {
      const results = [{
        analysis: 'Single analysis',
        usage: { totalTokens: 100, estimatedCost: 0.01 },
        processingTime: 1000,
      }];

      const combined = await llmService.combineChunkResults(results, 'general');
      expect(combined).toEqual(results[0]);
    });

    it('should combine multiple chunk results', async () => {
      const results = [
        {
          analysis: 'Part 1 analysis',
          usage: { inputTokens: 50, outputTokens: 25, totalTokens: 75, estimatedCost: 0.005 },
          processingTime: 500,
        },
        {
          analysis: 'Part 2 analysis',
          usage: { inputTokens: 60, outputTokens: 30, totalTokens: 90, estimatedCost: 0.007 },
          processingTime: 600,
        },
      ];

      const combined = await llmService.combineChunkResults(results, 'general');

      expect(combined.analysis).toContain('Part 1/2');
      expect(combined.analysis).toContain('Part 2/2');
      expect(combined.usage.totalTokens).toBe(165);
      expect(combined.usage.estimatedCost).toBe(0.012);
      expect(combined.processingTime).toBe(1100);
    });
  });

  describe('utility methods', () => {
    it('should estimate tokens correctly', () => {
      const text = 'This is a sample text with multiple words';
      const tokens = llmService.estimateTokens(text);
      
      // Should be approximately 1.3 * word count
      const wordCount = text.split(/\s+/).length;
      expect(tokens).toBeCloseTo(wordCount * 1.3, 0);
    });

    it('should calculate retry delay with exponential backoff', () => {
      const delay1 = llmService.calculateRetryDelay(0);
      const delay2 = llmService.calculateRetryDelay(1);
      const delay3 = llmService.calculateRetryDelay(2);

      expect(delay1).toBeGreaterThanOrEqual(1000);
      expect(delay2).toBeGreaterThan(delay1);
      expect(delay3).toBeGreaterThan(delay2);
      expect(delay3).toBeLessThanOrEqual(30000); // Max delay
    });

    it('should identify non-retryable errors', () => {
      expect(llmService.isNonRetryableError(new Error('Invalid API key'))).toBe(true);
      expect(llmService.isNonRetryableError(new Error('Unauthorized'))).toBe(true);
      expect(llmService.isNonRetryableError(new Error('Bad request'))).toBe(true);
      expect(llmService.isNonRetryableError(new Error('Network timeout'))).toBe(false);
    });

    it('should calculate costs correctly', () => {
      const usage = { inputTokens: 1000, outputTokens: 500 };
      const cost = llmService.calculateCost('openai', 'gpt-4o-mini', usage);
      
      // (1000/1000 * 0.00015) + (500/1000 * 0.0006) = 0.00015 + 0.0003 = 0.00045
      expect(cost).toBeCloseTo(0.00045, 5);
    });

    it('should track usage statistics', () => {
      const usage = { totalTokens: 100, estimatedCost: 0.01 };
      
      llmService.trackUsage('openai', 'gpt-4o-mini', usage);
      llmService.trackUsage('anthropic', 'claude-3-haiku-20240307', usage);

      const stats = llmService.getUsageStats();
      
      expect(stats.totalRequests).toBe(2);
      expect(stats.totalTokens).toBe(200);
      expect(stats.totalCost).toBe(0.02);
      expect(stats.requestsByProvider.openai).toBe(1);
      expect(stats.requestsByProvider.anthropic).toBe(1);
    });
  });

  describe('provider availability', () => {
    it('should check provider availability correctly', () => {
      expect(llmService.isProviderAvailable('openai')).toBe(true);
      expect(llmService.isProviderAvailable('anthropic')).toBe(true);
      expect(llmService.isProviderAvailable('nonexistent')).toBe(false);
    });

    it('should handle missing API keys', () => {
      delete process.env.OPENAI_API_KEY;
      const service = new LLMService();
      
      expect(service.isProviderAvailable('openai')).toBe(false);
    });
  });

  describe('model selection', () => {
    it('should select correct models for content types', () => {
      expect(llmService.selectModel('openai', 'text')).toBe('gpt-4o-mini');
      expect(llmService.selectModel('openai', 'image')).toBe('gpt-4o');
      expect(llmService.selectModel('anthropic', 'text')).toBe('claude-3-haiku-20240307');
      expect(llmService.selectModel('anthropic', 'image')).toBe('claude-3-sonnet-20240229');
    });

    it('should throw error for unknown provider', () => {
      expect(() => llmService.selectModel('unknown', 'text')).toThrow('Unknown provider');
    });
  });

  describe('prompt templates', () => {
    it('should get correct prompt for image analysis', () => {
      const prompt = llmService.getPromptTemplate('image', 'screenshot');
      expect(prompt).toContain('screenshot');
      expect(prompt).toContain('UI elements');
    });

    it('should get correct prompt for text analysis', () => {
      const prompt = llmService.getPromptTemplate('text', 'logAnalysis');
      expect(prompt).toContain('log entries');
      expect(prompt).toContain('error patterns');
    });

    it('should fallback to general prompts', () => {
      const imagePrompt = llmService.getPromptTemplate('image', 'unknown');
      expect(imagePrompt).toBe(llmService.promptTemplates.imageAnalysis.general);

      const textPrompt = llmService.getPromptTemplate('text', 'unknown');
      expect(textPrompt).toBe(llmService.promptTemplates.textAnalysis.documentSummary);
    });
  });

  describe('capabilities', () => {
    it('should return service capabilities', () => {
      const capabilities = llmService.getCapabilities();
      
      expect(capabilities).toHaveProperty('providers');
      expect(capabilities).toHaveProperty('supportedContentTypes');
      expect(capabilities).toHaveProperty('analysisTypes');
      expect(capabilities).toHaveProperty('features');
      
      expect(capabilities.providers).toContain('openai');
      expect(capabilities.providers).toContain('anthropic');
      expect(capabilities.supportedContentTypes).toContain('text');
      expect(capabilities.supportedContentTypes).toContain('image');
      expect(capabilities.features).toContain('multi_provider_support');
      expect(capabilities.features).toContain('image_analysis');
    });
  });
});