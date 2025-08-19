/**
 * Error Handling System Demo
 * Demonstrates the comprehensive error handling and retry mechanisms
 */

const { ErrorClassification } = require('../utils/ErrorClassification');
const RetryManager = require('../utils/RetryManager');
const ErrorRecoveryManager = require('../utils/ErrorRecoveryManager');

// Mock Redis configuration for demo
const mockRedisConfig = {
  host: 'localhost',
  port: 6379,
  maxRetriesPerRequest: null,
};

async function demonstrateErrorClassification() {
  console.log('\n🔍 === Error Classification Demo ===');
  
  const errors = [
    new Error('ECONNREFUSED connection refused'),
    new Error('Rate limit exceeded'),
    new Error('Validation failed: invalid input'),
    new Error('Virus detected in file'),
    new Error('Invalid image format: corrupt JPEG'),
    new Error('OpenAI API error: model not found'),
    new Error('Out of memory: heap limit exceeded'),
  ];

  errors.forEach((error, index) => {
    const classification = ErrorClassification.classifyError(error);
    console.log(`\n${index + 1}. Error: "${error.message}"`);
    console.log(`   Category: ${classification.category}`);
    console.log(`   Retryable: ${classification.classification.retryable}`);
    console.log(`   Severity: ${classification.classification.severity}`);
    console.log(`   Alert Required: ${classification.classification.alertRequired}`);
  });
}

async function demonstrateRetryManager() {
  console.log('\n🔄 === Retry Manager Demo ===');
  
  const retryManager = new RetryManager();
  
  // Simulate a flaky operation that succeeds on the 3rd attempt
  let attemptCount = 0;
  const flakyOperation = async (attempt, context) => {
    attemptCount++;
    console.log(`   Attempt ${attemptCount}: ${context?.operation || 'unknown operation'}`);
    
    if (attemptCount < 3) {
      throw new Error(`Temporary failure on attempt ${attemptCount}`);
    }
    
    return { success: true, attempt: attemptCount, result: 'Operation completed successfully' };
  };

  try {
    console.log('\n📝 Testing retry with exponential backoff...');
    const result = await retryManager.executeWithRetry(flakyOperation, {
      maxRetries: 3,
      baseDelay: 100, // Short delay for demo
      backoffMultiplier: 2,
    }, { operation: 'flaky_network_request' });

    console.log(`✅ Success after ${result.attempt} attempts:`, result.result);
  } catch (error) {
    console.error('❌ Operation failed:', error.message);
  }
}

async function demonstrateImageProcessingErrorRecovery() {
  console.log('\n🖼️ === Image Processing Error Recovery Demo ===');
  
  const recoveryManager = new ErrorRecoveryManager(mockRedisConfig, {
    enableDeadLetterQueue: false, // Disable for demo
    enableAlerting: false,
  });

  // Simulate image processing that fails initially but succeeds with reduced quality
  let qualityLevel = 'high';
  const imageProcessingOperation = async (attempt, context) => {
    console.log(`   Processing image with quality: ${context.quality || 'high'}`);
    
    if (context.quality === 'low' && context.maxDimensions) {
      qualityLevel = 'low';
      return {
        success: true,
        quality: 'low',
        dimensions: context.maxDimensions,
        result: 'processed_image_low_quality.jpg',
      };
    }
    
    throw new Error('Image too large for processing: memory limit exceeded');
  };

  try {
    const imageError = new Error('Image processing failed: out of memory');
    const result = await recoveryManager.handleError(
      imageError,
      { 
        imageProcessing: true,
        originalSize: '50MB',
        format: 'jpeg',
      },
      imageProcessingOperation
    );

    console.log(`✅ Image processing recovered:`, {
      success: result.success,
      strategy: result.strategy,
      action: result.action,
      finalQuality: qualityLevel,
    });
  } catch (error) {
    console.error('❌ Image processing recovery failed:', error.message);
  } finally {
    await recoveryManager.close();
  }
}

async function demonstrateLLMServiceRecovery() {
  console.log('\n🤖 === LLM Service Error Recovery Demo ===');
  
  const recoveryManager = new ErrorRecoveryManager(mockRedisConfig, {
    enableDeadLetterQueue: false,
    enableAlerting: false,
  });

  // Simulate LLM service that fails with primary provider but succeeds with fallback
  let providerUsed = 'openai';
  const llmOperation = async (attempt, context) => {
    console.log(`   Using LLM provider: ${context.provider || 'openai'}`);
    
    if (context.provider === 'ollama' && context.useAlternativeProvider) {
      providerUsed = 'ollama';
      return {
        success: true,
        provider: 'ollama',
        model: 'llama2',
        result: 'Analysis completed with local model',
      };
    }
    
    throw new Error('OpenAI API error: rate limit exceeded');
  };

  try {
    const llmError = new Error('LLM service unavailable');
    const result = await recoveryManager.handleError(
      llmError,
      { 
        llmProvider: 'openai',
        model: 'gpt-4',
        analysis: true,
      },
      llmOperation
    );

    console.log(`✅ LLM service recovered:`, {
      success: result.success,
      strategy: result.strategy,
      action: result.action,
      finalProvider: providerUsed,
    });
  } catch (error) {
    console.error('❌ LLM service recovery failed:', error.message);
  } finally {
    await recoveryManager.close();
  }
}

async function demonstrateCircuitBreaker() {
  console.log('\n⚡ === Circuit Breaker Demo ===');
  
  const retryManager = new RetryManager();
  const circuitBreaker = retryManager.createCircuitBreaker({
    failureThreshold: 3,
    resetTimeout: 2000, // 2 seconds for demo
  });

  // Simulate a consistently failing service
  const failingService = async () => {
    throw new Error('Service is down');
  };

  console.log('\n📝 Testing circuit breaker with failing service...');
  
  // Try to call the failing service multiple times
  for (let i = 1; i <= 5; i++) {
    try {
      console.log(`\n   Call ${i}:`);
      await circuitBreaker.execute(failingService);
    } catch (error) {
      console.log(`   ❌ ${error.message}`);
      
      const state = circuitBreaker.getState();
      console.log(`   Circuit state: ${state.state}, Failures: ${state.failures}`);
    }
  }

  console.log('\n⏰ Waiting for circuit breaker reset...');
  await new Promise(resolve => setTimeout(resolve, 2100)); // Wait for reset

  // Try again after reset
  try {
    console.log('\n   Call after reset:');
    await circuitBreaker.execute(failingService);
  } catch (error) {
    console.log(`   ❌ ${error.message}`);
    
    const state = circuitBreaker.getState();
    console.log(`   Circuit state: ${state.state}, Failures: ${state.failures}`);
  }
}

async function demonstrateErrorRecoveryStatistics() {
  console.log('\n📊 === Error Recovery Statistics Demo ===');
  
  const recoveryManager = new ErrorRecoveryManager(mockRedisConfig, {
    enableDeadLetterQueue: false,
    enableAlerting: false,
  });

  // Simulate some errors to generate statistics
  const errors = [
    { error: new Error('Network timeout'), context: { networkRequest: true } },
    { error: new Error('Image processing failed'), context: { imageProcessing: true } },
    { error: new Error('Database connection lost'), context: { databaseOperation: true } },
  ];

  for (const { error, context } of errors) {
    try {
      await recoveryManager.handleError(error, context, null);
    } catch (e) {
      // Ignore for demo
    }
  }

  const stats = recoveryManager.getStatistics();
  console.log('\n📈 Recovery Statistics:');
  console.log(`   Total Errors: ${stats.totalErrors}`);
  console.log(`   Recovered Errors: ${stats.recoveredErrors}`);
  console.log(`   Permanent Failures: ${stats.permanentFailures}`);
  console.log(`   Recovery Rate: ${(stats.recoveryRate * 100).toFixed(1)}%`);
  console.log(`   Registered Strategies: ${stats.strategies.join(', ')}`);

  await recoveryManager.close();
}

async function runDemo() {
  console.log('🚀 Starting Error Handling System Demo\n');
  
  try {
    await demonstrateErrorClassification();
    await demonstrateRetryManager();
    await demonstrateImageProcessingErrorRecovery();
    await demonstrateLLMServiceRecovery();
    await demonstrateCircuitBreaker();
    await demonstrateErrorRecoveryStatistics();
    
    console.log('\n✅ Demo completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Demo failed:', error);
  }
}

// Run the demo if this file is executed directly
if (require.main === module) {
  runDemo().catch(console.error);
}

module.exports = {
  demonstrateErrorClassification,
  demonstrateRetryManager,
  demonstrateImageProcessingErrorRecovery,
  demonstrateLLMServiceRecovery,
  demonstrateCircuitBreaker,
  demonstrateErrorRecoveryStatistics,
  runDemo,
};