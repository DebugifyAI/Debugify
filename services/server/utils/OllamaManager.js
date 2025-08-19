const axios = require('axios');
const { spawn } = require('child_process');

/**
 * Ollama Management Utility
 * Handles Ollama server management, model installation, and health monitoring
 */
class OllamaManager {
  constructor() {
    this.baseURL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    this.defaultModels = {
      text: 'llama3.2:3b',
      vision: 'llava:7b',
      code: 'codellama:7b',
      embedding: 'nomic-embed-text',
    };
    this.recommendedModels = [
      'llama3.2:3b',    // Fast, efficient for general text
      'llama3.2:1b',    // Ultra-fast for simple tasks
      'llava:7b',       // Vision capabilities
      'codellama:7b',   // Code analysis and generation
      'mistral:7b',     // Alternative text model
      'phi3:3.8b',      // Microsoft's efficient model
    ];
  }

  /**
   * Check if Ollama server is running and accessible
   * @returns {Promise<boolean>} True if server is healthy
   */
  async isServerRunning() {
    try {
      const response = await axios.get(`${this.baseURL}/api/tags`, {
        timeout: 5000,
      });
      return response.status === 200;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get server version and information
   * @returns {Promise<Object>} Server information
   */
  async getServerInfo() {
    try {
      const response = await axios.get(`${this.baseURL}/api/version`, {
        timeout: 5000,
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get Ollama server info: ${error.message}`);
    }
  }

  /**
   * List all available models on the server
   * @returns {Promise<Array>} List of installed models
   */
  async listModels() {
    try {
      const response = await axios.get(`${this.baseURL}/api/tags`, {
        timeout: 10000,
      });
      return response.data.models || [];
    } catch (error) {
      throw new Error(`Failed to list Ollama models: ${error.message}`);
    }
  }

  /**
   * Check if a specific model is installed
   * @param {string} modelName - Name of the model to check
   * @returns {Promise<boolean>} True if model is installed
   */
  async isModelInstalled(modelName) {
    try {
      const models = await this.listModels();
      return models.some(model => model.name === modelName);
    } catch (error) {
      return false;
    }
  }

  /**
   * Pull/install a model from Ollama registry
   * @param {string} modelName - Name of the model to install
   * @param {Function} progressCallback - Optional progress callback
   * @returns {Promise<boolean>} True if installation successful
   */
  async pullModel(modelName, progressCallback = null) {
    try {
      console.log(`Starting to pull model: ${modelName}`);
      
      const response = await axios.post(
        `${this.baseURL}/api/pull`,
        { name: modelName },
        {
          timeout: 600000, // 10 minutes timeout for model downloads
          responseType: 'stream',
        }
      );

      return new Promise((resolve, reject) => {
        let lastProgress = '';
        
        response.data.on('data', (chunk) => {
          const lines = chunk.toString().split('\n').filter(line => line.trim());
          
          for (const line of lines) {
            try {
              const data = JSON.parse(line);
              
              if (data.status) {
                if (progressCallback) {
                  progressCallback(data);
                }
                
                if (data.status !== lastProgress) {
                  console.log(`Model ${modelName}: ${data.status}`);
                  lastProgress = data.status;
                }
              }
              
              if (data.status === 'success') {
                console.log(`Successfully pulled model: ${modelName}`);
                resolve(true);
                return;
              }
              
              if (data.error) {
                reject(new Error(data.error));
                return;
              }
            } catch (parseError) {
              // Ignore JSON parse errors for partial chunks
            }
          }
        });

        response.data.on('end', () => {
          console.log(`Model pull completed: ${modelName}`);
          resolve(true);
        });

        response.data.on('error', (error) => {
          reject(new Error(`Model pull failed: ${error.message}`));
        });
      });

    } catch (error) {
      throw new Error(`Failed to pull model ${modelName}: ${error.message}`);
    }
  }

  /**
   * Remove/delete a model from the server
   * @param {string} modelName - Name of the model to remove
   * @returns {Promise<boolean>} True if removal successful
   */
  async removeModel(modelName) {
    try {
      await axios.delete(`${this.baseURL}/api/delete`, {
        data: { name: modelName },
        timeout: 30000,
      });
      
      console.log(`Successfully removed model: ${modelName}`);
      return true;
      
    } catch (error) {
      throw new Error(`Failed to remove model ${modelName}: ${error.message}`);
    }
  }

  /**
   * Get detailed information about a specific model
   * @param {string} modelName - Name of the model
   * @returns {Promise<Object>} Model information
   */
  async getModelInfo(modelName) {
    try {
      const response = await axios.post(
        `${this.baseURL}/api/show`,
        { name: modelName },
        { timeout: 10000 }
      );
      
      return response.data;
      
    } catch (error) {
      throw new Error(`Failed to get model info for ${modelName}: ${error.message}`);
    }
  }

  /**
   * Setup recommended models for the LLM service
   * @param {Function} progressCallback - Optional progress callback
   * @returns {Promise<Object>} Installation results
   */
  async setupRecommendedModels(progressCallback = null) {
    const results = {
      installed: [],
      failed: [],
      skipped: [],
    };

    console.log('Setting up recommended Ollama models...');

    for (const modelName of this.recommendedModels) {
      try {
        const isInstalled = await this.isModelInstalled(modelName);
        
        if (isInstalled) {
          console.log(`Model ${modelName} is already installed`);
          results.skipped.push(modelName);
          continue;
        }

        console.log(`Installing model: ${modelName}`);
        const success = await this.pullModel(modelName, progressCallback);
        
        if (success) {
          results.installed.push(modelName);
        } else {
          results.failed.push(modelName);
        }
        
      } catch (error) {
        console.error(`Failed to install ${modelName}:`, error.message);
        results.failed.push(modelName);
      }
    }

    return results;
  }

  /**
   * Ensure essential models are available
   * @returns {Promise<boolean>} True if essential models are available
   */
  async ensureEssentialModels() {
    const essentialModels = [
      this.defaultModels.text,
      this.defaultModels.vision,
    ];

    for (const modelName of essentialModels) {
      const isInstalled = await this.isModelInstalled(modelName);
      
      if (!isInstalled) {
        console.log(`Installing essential model: ${modelName}`);
        try {
          await this.pullModel(modelName);
        } catch (error) {
          console.error(`Failed to install essential model ${modelName}:`, error.message);
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Test model functionality with a simple prompt
   * @param {string} modelName - Name of the model to test
   * @returns {Promise<Object>} Test results
   */
  async testModel(modelName) {
    try {
      const testPrompt = 'Hello! Please respond with "Model is working correctly."';
      
      const response = await axios.post(
        `${this.baseURL}/api/generate`,
        {
          model: modelName,
          prompt: testPrompt,
          stream: false,
          options: {
            temperature: 0.1,
            num_predict: 50,
          },
        },
        { timeout: 30000 }
      );

      const result = response.data;
      const isWorking = result.response && result.response.toLowerCase().includes('working');

      return {
        success: true,
        working: isWorking,
        response: result.response,
        model: result.model,
        processingTime: result.total_duration ? Math.round(result.total_duration / 1000000) : null,
      };

    } catch (error) {
      return {
        success: false,
        working: false,
        error: error.message,
      };
    }
  }

  /**
   * Get system resource usage and performance metrics
   * @returns {Promise<Object>} Performance metrics
   */
  async getPerformanceMetrics() {
    try {
      // Test with a small model for performance baseline
      const testModel = this.defaultModels.text;
      const startTime = Date.now();
      
      const testResult = await this.testModel(testModel);
      const responseTime = Date.now() - startTime;

      const models = await this.listModels();
      const serverInfo = await this.getServerInfo();

      return {
        serverInfo,
        modelCount: models.length,
        testResponseTime: responseTime,
        testModel,
        testSuccess: testResult.success,
        availableModels: models.map(m => ({
          name: m.name,
          size: m.size,
          modified: m.modified_at,
        })),
      };

    } catch (error) {
      throw new Error(`Failed to get performance metrics: ${error.message}`);
    }
  }

  /**
   * Generate a comprehensive health report
   * @returns {Promise<Object>} Health report
   */
  async getHealthReport() {
    const report = {
      timestamp: new Date().toISOString(),
      server: {
        running: false,
        accessible: false,
        version: null,
      },
      models: {
        total: 0,
        essential: {
          text: false,
          vision: false,
          code: false,
        },
        recommended: [],
        missing: [],
      },
      performance: null,
      recommendations: [],
    };

    try {
      // Check server status
      report.server.running = await this.isServerRunning();
      
      if (report.server.running) {
        report.server.accessible = true;
        
        try {
          const serverInfo = await this.getServerInfo();
          report.server.version = serverInfo.version;
        } catch (error) {
          console.warn('Could not get server version:', error.message);
        }

        // Check models
        const models = await this.listModels();
        report.models.total = models.length;
        
        const modelNames = models.map(m => m.name);
        
        // Check essential models
        report.models.essential.text = modelNames.includes(this.defaultModels.text);
        report.models.essential.vision = modelNames.includes(this.defaultModels.vision);
        report.models.essential.code = modelNames.includes(this.defaultModels.code);

        // Check recommended models
        for (const modelName of this.recommendedModels) {
          if (modelNames.includes(modelName)) {
            report.models.recommended.push(modelName);
          } else {
            report.models.missing.push(modelName);
          }
        }

        // Get performance metrics
        try {
          report.performance = await this.getPerformanceMetrics();
        } catch (error) {
          console.warn('Could not get performance metrics:', error.message);
        }

        // Generate recommendations
        if (!report.models.essential.text) {
          report.recommendations.push(`Install essential text model: ${this.defaultModels.text}`);
        }
        if (!report.models.essential.vision) {
          report.recommendations.push(`Install essential vision model: ${this.defaultModels.vision}`);
        }
        if (report.models.missing.length > 0) {
          report.recommendations.push(`Consider installing recommended models: ${report.models.missing.join(', ')}`);
        }
        if (report.performance?.testResponseTime > 10000) {
          report.recommendations.push('Response times are slow. Consider using smaller models or upgrading hardware.');
        }

      } else {
        report.recommendations.push('Ollama server is not running. Please start the Ollama service.');
      }

    } catch (error) {
      report.error = error.message;
      report.recommendations.push('Failed to generate complete health report. Check Ollama installation.');
    }

    return report;
  }
}

module.exports = OllamaManager;