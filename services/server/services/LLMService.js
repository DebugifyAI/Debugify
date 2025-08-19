const axios = require('axios');

/**
 * LLM Integration Service with Ollama local LLM support and fallback providers
 * Prioritizes local Ollama models for privacy and cost efficiency
 */
class LLMService {
  constructor() {
    this.providers = {
      ollama: {
        name: 'Ollama',
        baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
        apiKey: null, // Ollama doesn't require API keys
        type: 'local',
        models: {
          text: process.env.OLLAMA_TEXT_MODEL || 'llama3.2:3b',
          vision: process.env.OLLAMA_VISION_MODEL || 'llava:7b',
          code: process.env.OLLAMA_CODE_MODEL || 'codellama:7b',
          embedding: process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text',
        },
        maxTokens: {
          'llama3.2:3b': 8192,
          'llama3.2:1b': 8192,
          'llama3.1:8b': 32768,
          'llava:7b': 4096,
          'codellama:7b': 16384,
          'codellama:13b': 16384,
          'mistral:7b': 8192,
          'phi3:3.8b': 4096,
        },
        pricing: {
          // Local models have no API costs
          'llama3.2:3b': { input: 0, output: 0 },
          'llama3.2:1b': { input: 0, output: 0 },
          'llama3.1:8b': { input: 0, output: 0 },
          'llava:7b': { input: 0, output: 0 },
          'codellama:7b': { input: 0, output: 0 },
          'codellama:13b': { input: 0, output: 0 },
          'mistral:7b': { input: 0, output: 0 },
          'phi3:3.8b': { input: 0, output: 0 },
        },
        capabilities: {
          streaming: true,
          embeddings: true,
          multimodal: true,
          codeGeneration: true,
        },
      },
      openai: {
        name: 'OpenAI',
        baseURL: 'https://api.openai.com/v1',
        apiKey: process.env.OPENAI_API_KEY,
        type: 'external',
        models: {
          text: 'gpt-4o-mini',
          vision: 'gpt-4o',
          code: 'gpt-4o-mini',
        },
        maxTokens: {
          'gpt-4o-mini': 128000,
          'gpt-4o': 128000,
        },
        pricing: {
          'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
          'gpt-4o': { input: 0.0025, output: 0.01 },
        },
        capabilities: {
          streaming: true,
          embeddings: true,
          multimodal: true,
          codeGeneration: true,
        },
      },
      anthropic: {
        name: 'Anthropic',
        baseURL: 'https://api.anthropic.com/v1',
        apiKey: process.env.ANTHROPIC_API_KEY,
        type: 'external',
        models: {
          text: 'claude-3-haiku-20240307',
          vision: 'claude-3-sonnet-20240229',
          code: 'claude-3-haiku-20240307',
        },
        maxTokens: {
          'claude-3-haiku-20240307': 200000,
          'claude-3-sonnet-20240229': 200000,
        },
        pricing: {
          'claude-3-haiku-20240307': { input: 0.00025, output: 0.00125 },
          'claude-3-sonnet-20240229': { input: 0.003, output: 0.015 },
        },
        capabilities: {
          streaming: true,
          embeddings: false,
          multimodal: true,
          codeGeneration: true,
        },
      },
    };

    this.defaultProvider = 'ollama';
    this.fallbackProviders = ['openai', 'anthropic'];
    this.retryConfig = {
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 30000,
      backoffFactor: 2,
      jitter: 0.1,
    };

    this.usageTracking = {
      totalRequests: 0,
      totalTokens: 0,
      totalCost: 0,
      requestsByProvider: {},
      costsByProvider: {},
    };

    this.promptTemplates = this.initializePromptTemplates();
  }

  /**
   * Initialize specialized prompt templates for different analysis types
   * @returns {Object} Prompt templates
   */
  initializePromptTemplates() {
    return {
      imageAnalysis: {
        screenshot: `Analyze this screenshot and provide a detailed description including:
1. What type of application or interface is shown
2. Key UI elements and their purposes
3. Any visible text content
4. User workflow or process being demonstrated
5. Notable features or functionality
6. Any errors, warnings, or issues visible

Be specific and technical in your analysis.`,

        diagram: `Analyze this diagram/chart and provide:
1. Type of diagram (flowchart, architecture, network, etc.)
2. Main components and their relationships
3. Data flow or process flow if applicable
4. Key insights or patterns
5. Technical details visible
6. Purpose and context of the diagram

Focus on technical accuracy and completeness.`,

        codeImage: `Analyze this code screenshot and provide:
1. Programming language(s) identified
2. Code structure and organization
3. Key functions, classes, or components
4. Coding patterns or frameworks used
5. Any visible errors or issues
6. Code quality observations
7. Suggestions for improvement if applicable

Provide technical insights suitable for code review.`,

        general: `Analyze this image comprehensively and describe:
1. Visual content and composition
2. Text content if any
3. Technical elements or interfaces
4. Context and purpose
5. Notable features or details
6. Potential use case or application

Provide a thorough technical analysis.`,
      },

      textAnalysis: {
        logAnalysis: `Analyze these log entries and provide:
1. Log type and format identification
2. Error patterns and frequency
3. Performance indicators
4. Security concerns if any
5. Operational insights
6. Recommended actions
7. Summary of key findings

Focus on actionable technical insights.`,

        codeReview: `Review this code and provide:
1. Code quality assessment
2. Security vulnerabilities
3. Performance considerations
4. Best practice adherence
5. Potential bugs or issues
6. Improvement suggestions
7. Overall recommendations

Provide constructive technical feedback.`,

        documentSummary: `Summarize this document focusing on:
1. Main topics and themes
2. Key technical information
3. Action items or requirements
4. Important decisions or conclusions
5. Technical specifications
6. Implementation details

Provide a concise but comprehensive summary.`,
      },
    };
  }

  /**
   * Analyze content using appropriate LLM provider and model
   * @param {Object} content - Content to analyze
   * @param {Object} options - Analysis options
   * @returns {Object} Analysis results
   */
  async analyzeContent(content, options = {}) {
    const {
      type = 'text',
      analysisType = 'general',
      provider = null, // Let the system choose the best provider
      model = null,
      maxTokens = null,
      temperature = 0.1,
      forceProvider = false, // Force use of specific provider
    } = options;

    let selectedProvider = provider;
    let lastError = null;

    try {
      // Auto-select best provider if not specified or not forced
      if (!selectedProvider || !forceProvider) {
        try {
          selectedProvider = await this.getBestProvider(type);
        } catch (error) {
          if (provider && this.isProviderAvailable(provider)) {
            selectedProvider = provider;
          } else {
            throw new Error(`No suitable LLM providers available: ${error.message}`);
          }
        }
      }

      // Validate provider availability
      if (!this.isProviderAvailable(selectedProvider)) {
        throw new Error(`Provider ${selectedProvider} is not available or configured`);
      }

      // Prepare content for analysis
      const preparedContent = await this.prepareContent(content, type, analysisType);

      // Select appropriate model
      const selectedModel = model || this.selectModel(selectedProvider, type);

      // Chunk content if necessary
      const chunks = await this.chunkContent(preparedContent, selectedProvider, selectedModel);

      // Process chunks
      const results = [];
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const chunkResult = await this.processChunk(
          chunk,
          selectedProvider,
          selectedModel,
          analysisType,
          {
            maxTokens,
            temperature,
            chunkIndex: i,
            totalChunks: chunks.length,
          }
        );
        results.push(chunkResult);
      }

      // Combine results if multiple chunks
      const finalResult = await this.combineChunkResults(results, analysisType);

      // Track usage and costs
      this.trackUsage(selectedProvider, selectedModel, finalResult.usage);

      return {
        success: true,
        analysis: finalResult.analysis,
        metadata: {
          provider: selectedProvider,
          model: selectedModel,
          analysisType,
          chunksProcessed: chunks.length,
          totalTokens: finalResult.usage.totalTokens,
          estimatedCost: finalResult.usage.estimatedCost,
          processingTime: finalResult.processingTime,
          isLocal: this.providers[selectedProvider]?.type === 'local',
        },
      };

    } catch (error) {
      lastError = error;
      console.error(`LLM analysis failed with ${selectedProvider}:`, error.message);

      // Try fallback providers if the primary failed and we're not forcing a specific provider
      if (!forceProvider && selectedProvider !== 'ollama') {
        console.log('Attempting fallback to other providers...');
        
        for (const fallbackProvider of this.fallbackProviders) {
          if (fallbackProvider === selectedProvider) continue;
          
          if (this.isProviderAvailable(fallbackProvider)) {
            try {
              console.log(`Trying fallback provider: ${fallbackProvider}`);
              
              return this.analyzeContent(content, {
                ...options,
                provider: fallbackProvider,
                forceProvider: true,
              });
              
            } catch (fallbackError) {
              console.warn(`Fallback provider ${fallbackProvider} also failed:`, fallbackError.message);
              lastError = fallbackError;
            }
          }
        }
      }

      return {
        success: false,
        error: lastError.message,
        metadata: {
          provider: selectedProvider,
          analysisType,
          failedAt: new Date().toISOString(),
          attemptedFallbacks: !forceProvider,
        },
      };
    }
  }

  /**
   * Prepare content for LLM analysis based on type
   * @param {Object} content - Raw content
   * @param {string} type - Content type (text, image, mixed)
   * @param {string} analysisType - Analysis type
   * @returns {Object} Prepared content
   */
  async prepareContent(content, type, analysisType) {
    const prepared = {
      type,
      analysisType,
      prompt: this.getPromptTemplate(type, analysisType),
      data: null,
    };

    switch (type) {
      case 'text':
        prepared.data = {
          text: typeof content === 'string' ? content : content.text || '',
          metadata: content.metadata || {},
        };
        break;

      case 'image':
        prepared.data = {
          imageBuffer: content.imageBuffer || content.buffer,
          imageUrl: content.imageUrl,
          ocrText: content.ocrText || '',
          visualElements: content.visualElements || {},
          metadata: content.metadata || {},
        };
        break;

      case 'mixed':
        prepared.data = {
          text: content.text || '',
          images: content.images || [],
          metadata: content.metadata || {},
        };
        break;

      default:
        throw new Error(`Unsupported content type: ${type}`);
    }

    return prepared;
  }

  /**
   * Get appropriate prompt template
   * @param {string} type - Content type
   * @param {string} analysisType - Analysis type
   * @returns {string} Prompt template
   */
  getPromptTemplate(type, analysisType) {
    if (type === 'image') {
      return this.promptTemplates.imageAnalysis[analysisType] || 
             this.promptTemplates.imageAnalysis.general;
    } else {
      return this.promptTemplates.textAnalysis[analysisType] || 
             this.promptTemplates.textAnalysis.documentSummary;
    }
  }

  /**
   * Select appropriate model for content type and provider
   * @param {string} provider - LLM provider
   * @param {string} type - Content type
   * @returns {string} Model name
   */
  selectModel(provider, type) {
    const providerConfig = this.providers[provider];
    if (!providerConfig) {
      throw new Error(`Unknown provider: ${provider}`);
    }

    // Handle different content types
    switch (type) {
      case 'image':
      case 'vision':
      case 'mixed':
        return providerConfig.models.vision;
      case 'code':
        return providerConfig.models.code || providerConfig.models.text;
      case 'text':
      default:
        return providerConfig.models.text;
    }
  }

  /**
   * Check if provider is available and configured
   * @param {string} provider - Provider name
   * @returns {boolean} True if available
   */
  isProviderAvailable(provider) {
    const config = this.providers[provider];
    if (!config) return false;
    
    // Ollama doesn't require API keys
    if (provider === 'ollama') {
      return true; // We'll check health during actual requests
    }
    
    // External providers require API keys
    return config.apiKey && config.apiKey.length > 0;
  }

  /**
   * Get the best available provider for the given content type
   * @param {string} contentType - Content type (text, image, code)
   * @returns {string} Best available provider
   */
  async getBestProvider(contentType = 'text') {
    // Always try Ollama first for privacy and cost benefits
    if (this.isProviderAvailable('ollama')) {
      try {
        await this.checkOllamaHealth();
        
        // Check if Ollama has appropriate models for the content type
        const models = await this.getOllamaModels();
        const hasAppropriateModel = this.hasAppropriateOllamaModel(models, contentType);
        
        if (hasAppropriateModel) {
          return 'ollama';
        }
      } catch (error) {
        console.warn(`Ollama not available: ${error.message}`);
      }
    }
    
    // Fallback to external providers
    for (const provider of this.fallbackProviders) {
      if (this.isProviderAvailable(provider)) {
        return provider;
      }
    }
    
    throw new Error('No LLM providers are available');
  }

  /**
   * Check if Ollama has appropriate models for content type
   * @param {Array} models - Available Ollama models
   * @param {string} contentType - Content type
   * @returns {boolean} True if appropriate model exists
   */
  hasAppropriateOllamaModel(models, contentType) {
    const modelNames = models.map(m => m.name);
    const config = this.providers.ollama;
    
    switch (contentType) {
      case 'image':
      case 'vision':
        return modelNames.some(name => 
          name.includes('llava') || 
          name.includes('vision') ||
          name === config.models.vision
        );
      case 'code':
        return modelNames.some(name => 
          name.includes('codellama') || 
          name.includes('code') ||
          name === config.models.code
        );
      case 'text':
      default:
        return modelNames.some(name => 
          name.includes('llama') || 
          name.includes('mistral') ||
          name.includes('phi') ||
          name === config.models.text
        );
    }
  }

  /**
   * Chunk content to fit within model context limits
   * @param {Object} content - Prepared content
   * @param {string} provider - LLM provider
   * @param {string} model - Model name
   * @returns {Array} Content chunks
   */
  async chunkContent(content, provider, model) {
    const maxTokens = this.providers[provider].maxTokens[model];
    const reservedTokens = 2000; // Reserve for prompt and response
    const availableTokens = maxTokens - reservedTokens;

    if (content.type === 'image') {
      // Images are processed as single chunks
      return [content];
    }

    const text = content.data.text || '';
    const estimatedTokens = this.estimateTokens(text);

    if (estimatedTokens <= availableTokens) {
      return [content];
    }

    // Split text into chunks
    const chunks = [];
    const words = text.split(/\s+/);
    const wordsPerChunk = Math.floor((availableTokens * 0.75) / 1.3); // Rough token estimation

    for (let i = 0; i < words.length; i += wordsPerChunk) {
      const chunkWords = words.slice(i, i + wordsPerChunk);
      const chunkContent = {
        ...content,
        data: {
          ...content.data,
          text: chunkWords.join(' '),
          chunkInfo: {
            index: Math.floor(i / wordsPerChunk),
            total: Math.ceil(words.length / wordsPerChunk),
            isPartial: true,
          },
        },
      };
      chunks.push(chunkContent);
    }

    return chunks;
  }

  /**
   * Process a single content chunk with retry logic
   * @param {Object} chunk - Content chunk
   * @param {string} provider - LLM provider
   * @param {string} model - Model name
   * @param {string} analysisType - Analysis type
   * @param {Object} options - Processing options
   * @returns {Object} Processing result
   */
  async processChunk(chunk, provider, model, analysisType, options = {}) {
    const startTime = Date.now();
    let lastError = null;

    for (let attempt = 0; attempt < this.retryConfig.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const delay = this.calculateRetryDelay(attempt);
          console.log(`Retrying LLM request (attempt ${attempt + 1}) after ${delay}ms`);
          await this.sleep(delay);
        }

        const result = await this.makeProviderRequest(chunk, provider, model, options);
        
        const processingTime = Date.now() - startTime;
        
        return {
          analysis: result.analysis,
          usage: {
            inputTokens: result.usage?.inputTokens || 0,
            outputTokens: result.usage?.outputTokens || 0,
            totalTokens: result.usage?.totalTokens || 0,
            estimatedCost: this.calculateCost(provider, model, result.usage),
          },
          processingTime,
          attempt: attempt + 1,
        };

      } catch (error) {
        lastError = error;
        console.warn(`LLM request attempt ${attempt + 1} failed:`, error.message);

        // Don't retry on certain errors
        if (this.isNonRetryableError(error)) {
          break;
        }
      }
    }

    throw new Error(`LLM processing failed after ${this.retryConfig.maxRetries} attempts: ${lastError.message}`);
  }

  /**
   * Make request to specific LLM provider
   * @param {Object} chunk - Content chunk
   * @param {string} provider - Provider name
   * @param {string} model - Model name
   * @param {Object} options - Request options
   * @returns {Object} Provider response
   */
  async makeProviderRequest(chunk, provider, model, options = {}) {
    switch (provider) {
      case 'ollama':
        return this.makeOllamaRequest(chunk, model, options);
      case 'openai':
        return this.makeOpenAIRequest(chunk, model, options);
      case 'anthropic':
        return this.makeAnthropicRequest(chunk, model, options);
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  /**
   * Make request to Ollama API
   * @param {Object} chunk - Content chunk
   * @param {string} model - Model name
   * @param {Object} options - Request options
   * @returns {Object} Ollama response
   */
  async makeOllamaRequest(chunk, model, options = {}) {
    const config = this.providers.ollama;
    
    try {
      // Check if Ollama is available
      await this.checkOllamaHealth();
      
      // Prepare the request based on content type
      if (chunk.type === 'image') {
        return this.makeOllamaVisionRequest(chunk, model, options);
      }
      
      return this.makeOllamaTextRequest(chunk, model, options);
      
    } catch (error) {
      console.warn(`Ollama request failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Make text request to Ollama
   * @param {Object} chunk - Content chunk
   * @param {string} model - Model name
   * @param {Object} options - Request options
   * @returns {Object} Ollama response
   */
  async makeOllamaTextRequest(chunk, model, options = {}) {
    const config = this.providers.ollama;
    
    // Construct the prompt
    const systemPrompt = 'You are a technical analyst providing detailed, accurate analysis of content. Focus on technical insights and actionable information.';
    const userPrompt = `${chunk.prompt}\n\nContent to analyze:\n${chunk.data.text}`;
    
    const requestBody = {
      model,
      prompt: `${systemPrompt}\n\nUser: ${userPrompt}\n\nAssistant:`,
      stream: false,
      options: {
        temperature: options.temperature || 0.1,
        num_predict: options.maxTokens || 4000,
        top_k: 40,
        top_p: 0.9,
      },
    };

    const startTime = Date.now();
    
    try {
      const response = await axios.post(
        `${config.baseURL}/api/generate`,
        requestBody,
        {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 120000, // 2 minutes for local processing
        }
      );

      const result = response.data;
      const processingTime = Date.now() - startTime;
      
      // Estimate token usage (Ollama doesn't provide exact counts)
      const inputTokens = this.estimateTokens(requestBody.prompt);
      const outputTokens = this.estimateTokens(result.response || '');
      
      return {
        analysis: result.response,
        usage: {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
        },
        metadata: {
          model: result.model,
          processingTime,
          done: result.done,
          context: result.context,
        },
      };

    } catch (error) {
      if (error.code === 'ECONNREFUSED') {
        throw new Error('Ollama server is not running. Please start Ollama service.');
      } else if (error.code === 'ECONNABORTED') {
        throw new Error('Ollama request timeout');
      } else if (error.response?.status === 404) {
        throw new Error(`Model '${model}' not found in Ollama. Please pull the model first.`);
      } else {
        throw new Error(`Ollama API request failed: ${error.message}`);
      }
    }
  }

  /**
   * Make vision request to Ollama (for multimodal models)
   * @param {Object} chunk - Content chunk
   * @param {string} model - Model name
   * @param {Object} options - Request options
   * @returns {Object} Ollama response
   */
  async makeOllamaVisionRequest(chunk, model, options = {}) {
    const config = this.providers.ollama;
    
    // Prepare the prompt with image context
    let prompt = chunk.prompt;
    
    // Add OCR text if available
    if (chunk.data.ocrText) {
      prompt += `\n\nExtracted text from image:\n${chunk.data.ocrText}`;
    }
    
    // Add visual elements context if available
    if (chunk.data.visualElements) {
      const elements = chunk.data.visualElements;
      prompt += `\n\nVisual elements detected:`;
      if (elements.hasButtons) prompt += '\n- UI buttons detected';
      if (elements.hasCharts) prompt += '\n- Charts or graphs detected';
      if (elements.hasCode) prompt += '\n- Code snippets detected';
      if (elements.complexity) prompt += `\n- Visual complexity: ${elements.complexity}`;
    }

    const requestBody = {
      model,
      prompt,
      stream: false,
      options: {
        temperature: options.temperature || 0.1,
        num_predict: options.maxTokens || 4000,
      },
    };

    // Add image data if available
    if (chunk.data.imageBuffer) {
      requestBody.images = [chunk.data.imageBuffer.toString('base64')];
    }

    const startTime = Date.now();
    
    try {
      const response = await axios.post(
        `${config.baseURL}/api/generate`,
        requestBody,
        {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 180000, // 3 minutes for vision processing
        }
      );

      const result = response.data;
      const processingTime = Date.now() - startTime;
      
      // Estimate token usage
      const inputTokens = this.estimateTokens(requestBody.prompt) + 
                         (chunk.data.imageBuffer ? 1000 : 0); // Rough estimate for image tokens
      const outputTokens = this.estimateTokens(result.response || '');
      
      return {
        analysis: result.response,
        usage: {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
        },
        metadata: {
          model: result.model,
          processingTime,
          done: result.done,
          hasImage: !!chunk.data.imageBuffer,
        },
      };

    } catch (error) {
      if (error.code === 'ECONNREFUSED') {
        throw new Error('Ollama server is not running. Please start Ollama service.');
      } else if (error.response?.status === 404) {
        throw new Error(`Vision model '${model}' not found in Ollama. Please pull a multimodal model like llava.`);
      } else {
        throw new Error(`Ollama vision request failed: ${error.message}`);
      }
    }
  }

  /**
   * Check if Ollama server is healthy and available
   * @returns {Promise<boolean>} True if healthy
   */
  async checkOllamaHealth() {
    const config = this.providers.ollama;
    
    try {
      const response = await axios.get(`${config.baseURL}/api/tags`, {
        timeout: 5000,
      });
      
      return response.status === 200;
      
    } catch (error) {
      throw new Error(`Ollama health check failed: ${error.message}`);
    }
  }

  /**
   * Get available Ollama models
   * @returns {Promise<Array>} List of available models
   */
  async getOllamaModels() {
    const config = this.providers.ollama;
    
    try {
      const response = await axios.get(`${config.baseURL}/api/tags`, {
        timeout: 10000,
      });
      
      return response.data.models || [];
      
    } catch (error) {
      console.warn(`Failed to get Ollama models: ${error.message}`);
      return [];
    }
  }

  /**
   * Make request to OpenAI API
   * @param {Object} chunk - Content chunk
   * @param {string} model - Model name
   * @param {Object} options - Request options
   * @returns {Object} OpenAI response
   */
  async makeOpenAIRequest(chunk, model, options = {}) {
    const config = this.providers.openai;
    const messages = [];

    // Add system message
    messages.push({
      role: 'system',
      content: 'You are a technical analyst providing detailed, accurate analysis of content. Focus on technical insights and actionable information.',
    });

    // Add user message with content
    if (chunk.type === 'image') {
      const userMessage = {
        role: 'user',
        content: [
          { type: 'text', text: chunk.prompt },
        ],
      };

      // Add image content
      if (chunk.data.imageBuffer) {
        const base64Image = chunk.data.imageBuffer.toString('base64');
        userMessage.content.push({
          type: 'image_url',
          image_url: {
            url: `data:image/jpeg;base64,${base64Image}`,
            detail: 'high',
          },
        });
      }

      // Add OCR text if available
      if (chunk.data.ocrText) {
        userMessage.content.push({
          type: 'text',
          text: `\n\nExtracted text from image:\n${chunk.data.ocrText}`,
        });
      }

      messages.push(userMessage);
    } else {
      messages.push({
        role: 'user',
        content: `${chunk.prompt}\n\nContent to analyze:\n${chunk.data.text}`,
      });
    }

    const requestBody = {
      model,
      messages,
      max_tokens: options.maxTokens || 4000,
      temperature: options.temperature || 0.1,
    };

    try {
      const response = await axios.post(
        `${config.baseURL}/chat/completions`,
        requestBody,
        {
          headers: {
            'Authorization': `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 60000,
        }
      );

      const result = response.data;
      
      return {
        analysis: result.choices[0].message.content,
        usage: {
          inputTokens: result.usage?.prompt_tokens || 0,
          outputTokens: result.usage?.completion_tokens || 0,
          totalTokens: result.usage?.total_tokens || 0,
        },
      };

    } catch (error) {
      if (error.response) {
        throw new Error(`OpenAI API error: ${error.response.status} - ${error.response.data?.error?.message || 'Unknown error'}`);
      } else if (error.code === 'ECONNABORTED') {
        throw new Error('OpenAI API request timeout');
      } else {
        throw new Error(`OpenAI API request failed: ${error.message}`);
      }
    }
  }

  /**
   * Make request to Anthropic API
   * @param {Object} chunk - Content chunk
   * @param {string} model - Model name
   * @param {Object} options - Request options
   * @returns {Object} Anthropic response
   */
  async makeAnthropicRequest(chunk, model, options = {}) {
    const config = this.providers.anthropic;
    
    let content = '';
    
    if (chunk.type === 'image') {
      content = chunk.prompt;
      
      // Add image if available
      if (chunk.data.imageBuffer) {
        const base64Image = chunk.data.imageBuffer.toString('base64');
        content += `\n\n[Image provided as base64 data]`;
        // Note: Anthropic's vision API format may differ - adjust as needed
      }
      
      // Add OCR text if available
      if (chunk.data.ocrText) {
        content += `\n\nExtracted text from image:\n${chunk.data.ocrText}`;
      }
    } else {
      content = `${chunk.prompt}\n\nContent to analyze:\n${chunk.data.text}`;
    }

    const requestBody = {
      model,
      max_tokens: options.maxTokens || 4000,
      temperature: options.temperature || 0.1,
      messages: [
        {
          role: 'user',
          content,
        },
      ],
    };

    try {
      const response = await axios.post(
        `${config.baseURL}/messages`,
        requestBody,
        {
          headers: {
            'x-api-key': config.apiKey,
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01',
          },
          timeout: 60000,
        }
      );

      const result = response.data;
      
      return {
        analysis: result.content[0].text,
        usage: {
          inputTokens: result.usage?.input_tokens || 0,
          outputTokens: result.usage?.output_tokens || 0,
          totalTokens: (result.usage?.input_tokens || 0) + (result.usage?.output_tokens || 0),
        },
      };

    } catch (error) {
      if (error.response) {
        throw new Error(`Anthropic API error: ${error.response.status} - ${error.response.data?.error?.message || 'Unknown error'}`);
      } else if (error.code === 'ECONNABORTED') {
        throw new Error('Anthropic API request timeout');
      } else {
        throw new Error(`Anthropic API request failed: ${error.message}`);
      }
    }
  }

  /**
   * Combine results from multiple chunks
   * @param {Array} results - Chunk results
   * @param {string} analysisType - Analysis type
   * @returns {Object} Combined result
   */
  async combineChunkResults(results, analysisType) {
    if (results.length === 1) {
      return results[0];
    }

    // Combine analyses
    const combinedAnalysis = results.map((result, index) => 
      `## Part ${index + 1}/${results.length}\n\n${result.analysis}`
    ).join('\n\n---\n\n');

    // Sum up usage
    const totalUsage = results.reduce((acc, result) => ({
      inputTokens: acc.inputTokens + result.usage.inputTokens,
      outputTokens: acc.outputTokens + result.usage.outputTokens,
      totalTokens: acc.totalTokens + result.usage.totalTokens,
      estimatedCost: acc.estimatedCost + result.usage.estimatedCost,
    }), { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0 });

    const totalProcessingTime = results.reduce((acc, result) => acc + result.processingTime, 0);

    return {
      analysis: combinedAnalysis,
      usage: totalUsage,
      processingTime: totalProcessingTime,
    };
  }

  // Helper methods

  /**
   * Estimate token count for text
   * @param {string} text - Text to estimate
   * @returns {number} Estimated token count
   */
  estimateTokens(text) {
    // Rough estimation: 1 token ≈ 0.75 words
    return Math.ceil(text.split(/\s+/).length * 1.3);
  }

  /**
   * Calculate retry delay with exponential backoff and jitter
   * @param {number} attempt - Attempt number (0-based)
   * @returns {number} Delay in milliseconds
   */
  calculateRetryDelay(attempt) {
    const baseDelay = this.retryConfig.baseDelay;
    const backoffFactor = this.retryConfig.backoffFactor;
    const jitter = this.retryConfig.jitter;
    const maxDelay = this.retryConfig.maxDelay;

    const exponentialDelay = baseDelay * Math.pow(backoffFactor, attempt);
    const jitterAmount = exponentialDelay * jitter * (Math.random() * 2 - 1);
    const finalDelay = exponentialDelay + jitterAmount;

    return Math.min(Math.max(finalDelay, baseDelay), maxDelay);
  }

  /**
   * Check if error should not be retried
   * @param {Error} error - Error object
   * @returns {boolean} True if non-retryable
   */
  isNonRetryableError(error) {
    const nonRetryablePatterns = [
      /invalid.*api.*key/i,
      /unauthorized/i,
      /forbidden/i,
      /not.*found/i,
      /bad.*request/i,
      /invalid.*model/i,
    ];

    return nonRetryablePatterns.some(pattern => pattern.test(error.message));
  }

  /**
   * Calculate cost for API usage
   * @param {string} provider - Provider name
   * @param {string} model - Model name
   * @param {Object} usage - Usage statistics
   * @returns {number} Estimated cost in USD
   */
  calculateCost(provider, model, usage) {
    const pricing = this.providers[provider]?.pricing?.[model];
    if (!pricing || !usage) return 0;

    const inputCost = (usage.inputTokens / 1000) * pricing.input;
    const outputCost = (usage.outputTokens / 1000) * pricing.output;

    return Math.round((inputCost + outputCost) * 10000) / 10000; // Round to 4 decimal places
  }

  /**
   * Track usage statistics
   * @param {string} provider - Provider name
   * @param {string} model - Model name
   * @param {Object} usage - Usage statistics
   */
  trackUsage(provider, model, usage) {
    this.usageTracking.totalRequests++;
    this.usageTracking.totalTokens += usage.totalTokens;
    this.usageTracking.totalCost += usage.estimatedCost;

    if (!this.usageTracking.requestsByProvider[provider]) {
      this.usageTracking.requestsByProvider[provider] = 0;
      this.usageTracking.costsByProvider[provider] = 0;
    }

    this.usageTracking.requestsByProvider[provider]++;
    this.usageTracking.costsByProvider[provider] += usage.estimatedCost;
  }

  /**
   * Sleep for specified milliseconds
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise} Sleep promise
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get usage statistics
   * @returns {Object} Usage statistics
   */
  getUsageStats() {
    return { ...this.usageTracking };
  }

  /**
   * Reset usage statistics
   */
  resetUsageStats() {
    this.usageTracking = {
      totalRequests: 0,
      totalTokens: 0,
      totalCost: 0,
      requestsByProvider: {},
      costsByProvider: {},
    };
  }

  /**
   * Get service capabilities
   * @returns {Object} Service capabilities
   */
  getCapabilities() {
    return {
      providers: Object.keys(this.providers),
      defaultProvider: this.defaultProvider,
      supportedContentTypes: ['text', 'image', 'mixed', 'code'],
      analysisTypes: {
        image: Object.keys(this.promptTemplates.imageAnalysis),
        text: Object.keys(this.promptTemplates.textAnalysis),
      },
      features: [
        'local_llm_support',
        'ollama_integration',
        'multi_provider_support',
        'automatic_provider_selection',
        'fallback_providers',
        'automatic_chunking',
        'retry_with_backoff',
        'cost_tracking',
        'usage_monitoring',
        'image_analysis',
        'vision_api_support',
        'code_analysis',
        'prompt_templates',
        'privacy_focused',
        'zero_cost_local_processing',
      ],
      localCapabilities: {
        provider: 'ollama',
        features: this.providers.ollama?.capabilities || {},
        models: this.providers.ollama?.models || {},
      },
    };
  }
}

module.exports = LLMService;