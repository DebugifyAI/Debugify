#!/usr/bin/env node

/**
 * LLM Integration Demo with Ollama Support
 * Demonstrates the LLM service capabilities with local Ollama models and fallback providers
 */

require('dotenv').config();

const LLMService = require('../services/LLMService');
const ImageProcessor = require('../helpers/ImageProcessor');
const OllamaManager = require('../utils/OllamaManager');

async function demonstrateOllamaSetup() {
  console.log('🦙 Ollama Setup and Health Check...\n');

  const ollamaManager = new OllamaManager();
  
  // Check Ollama health
  console.log('🔍 Checking Ollama server status...');
  const healthReport = await ollamaManager.getHealthReport();
  
  console.log('📊 Ollama Health Report:');
  console.log(`Server Running: ${healthReport.server.running ? '✅' : '❌'}`);
  console.log(`Server Version: ${healthReport.server.version || 'Unknown'}`);
  console.log(`Total Models: ${healthReport.models.total}`);
  console.log(`Essential Models:`);
  console.log(`  Text: ${healthReport.models.essential.text ? '✅' : '❌'}`);
  console.log(`  Vision: ${healthReport.models.essential.vision ? '✅' : '❌'}`);
  console.log(`  Code: ${healthReport.models.essential.code ? '✅' : '❌'}`);
  
  if (healthReport.recommendations.length > 0) {
    console.log('\n💡 Recommendations:');
    healthReport.recommendations.forEach(rec => console.log(`  - ${rec}`));
  }
  
  console.log('\n');
  return healthReport;
}

async function demonstrateLLMCapabilities() {
  console.log('🤖 LLM Integration Demo Starting...\n');

  const llmService = new LLMService();
  
  // Display service capabilities
  console.log('📋 LLM Service Capabilities:');
  const capabilities = llmService.getCapabilities();
  console.log(JSON.stringify(capabilities, null, 2));
  console.log('\n');

  // Test text analysis
  console.log('📝 Testing Text Analysis...');
  const sampleLogText = `
2024-01-15 10:30:15 ERROR [DatabaseConnection] Connection timeout after 30 seconds
2024-01-15 10:30:16 WARN [UserService] Failed login attempt for user: admin
2024-01-15 10:30:17 INFO [AuthController] Rate limiting applied to IP: 192.168.1.100
2024-01-15 10:30:18 ERROR [PaymentService] Payment processing failed: Invalid card number
2024-01-15 10:30:19 DEBUG [CacheService] Cache miss for key: user_session_12345
  `;

  try {
    const textAnalysis = await llmService.analyzeContent({
      text: sampleLogText,
      metadata: { filename: 'application.log' },
    }, {
      type: 'text',
      analysisType: 'logAnalysis',
    });

    if (textAnalysis.success) {
      console.log('✅ Text Analysis Result:');
      console.log(textAnalysis.analysis.substring(0, 200) + '...');
      console.log(`📊 Tokens used: ${textAnalysis.metadata.totalTokens}`);
      console.log(`💰 Estimated cost: $${textAnalysis.metadata.estimatedCost}`);
    } else {
      console.log('❌ Text Analysis Failed:', textAnalysis.error);
    }
  } catch (error) {
    console.log('❌ Text Analysis Error:', error.message);
  }

  console.log('\n');

  // Test image analysis (mock)
  console.log('🖼️  Testing Image Analysis (Mock)...');
  const mockImageContent = {
    ocrText: 'function calculateTotal(items) {\n  return items.reduce((sum, item) => sum + item.price, 0);\n}',
    visualElements: {
      hasCode: true,
      hasButtons: false,
      hasCharts: false,
      complexity: 'medium',
    },
    metadata: {
      filename: 'code-screenshot.png',
      width: 800,
      height: 600,
    },
  };

  try {
    const imageAnalysis = await llmService.analyzeContent(mockImageContent, {
      type: 'image',
      analysisType: 'codeImage',
    });

    if (imageAnalysis.success) {
      console.log('✅ Image Analysis Result:');
      console.log(imageAnalysis.analysis.substring(0, 200) + '...');
      console.log(`📊 Tokens used: ${imageAnalysis.metadata.totalTokens}`);
      console.log(`💰 Estimated cost: $${imageAnalysis.metadata.estimatedCost}`);
    } else {
      console.log('❌ Image Analysis Failed:', imageAnalysis.error);
    }
  } catch (error) {
    console.log('❌ Image Analysis Error:', error.message);
  }

  console.log('\n');

  // Display usage statistics
  console.log('📈 Usage Statistics:');
  const stats = llmService.getUsageStats();
  console.log(JSON.stringify(stats, null, 2));

  console.log('\n🎉 Demo completed!');
}

async function demonstrateImageProcessing() {
  console.log('🖼️  Image Processing Demo Starting...\n');

  const imageProcessor = new ImageProcessor();

  // Display processor capabilities
  console.log('📋 Image Processor Capabilities:');
  const capabilities = imageProcessor.getCapabilities();
  console.log(JSON.stringify(capabilities, null, 2));
  console.log('\n');

  // Test sensitive data detection
  console.log('🔍 Testing Sensitive Data Detection...');
  const testTexts = [
    'API Key: sk-1234567890abcdef1234567890abcdef',
    'Password: mySecretPassword123',
    'Email: user@example.com',
    'Credit Card: 4532-1234-5678-9012',
    'Normal text without sensitive data',
  ];

  for (const text of testTexts) {
    const result = await imageProcessor.detectSensitiveData(text);
    console.log(`Text: "${text.substring(0, 30)}..."`);
    console.log(`  Has API Keys: ${result.hasApiKeys}`);
    console.log(`  Has Credentials: ${result.hasCredentials}`);
    console.log(`  Has PII: ${result.hasPII}`);
    console.log(`  Patterns: ${result.detectedPatterns.length}`);
    console.log('');
  }

  // Test code snippet extraction
  console.log('💻 Testing Code Snippet Extraction...');
  const codeText = `
function calculateTotal(items) {
  return items.reduce((sum, item) => sum + item.price, 0);
}

class UserService {
  constructor(database) {
    this.db = database;
  }
}

if (user.isAuthenticated()) {
  console.log('User is logged in');
}
  `;

  const codeResult = imageProcessor.extractCodeSnippets({ text: codeText });
  console.log(`Found ${codeResult.snippets.length} code snippets:`);
  codeResult.snippets.forEach((snippet, index) => {
    console.log(`  ${index + 1}. Language: ${snippet.language}`);
    console.log(`     Code: ${snippet.code.substring(0, 50)}...`);
  });

  console.log('\n🎉 Image Processing Demo completed!');
}

// Main execution
async function main() {
  try {
    await demonstrateOllamaSetup();
    console.log('\n' + '='.repeat(60) + '\n');
    await demonstrateImageProcessing();
    console.log('\n' + '='.repeat(60) + '\n');
    await demonstrateLLMCapabilities();
  } catch (error) {
    console.error('Demo failed:', error);
    process.exit(1);
  }
}

// Run the demo if this file is executed directly
if (require.main === module) {
  main();
}

module.exports = {
  demonstrateOllamaSetup,
  demonstrateLLMCapabilities,
  demonstrateImageProcessing,
};