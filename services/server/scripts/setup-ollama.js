#!/usr/bin/env node

/**
 * Ollama Setup Script
 * Automatically installs and configures recommended models for the LLM service
 */

require('dotenv').config();

const OllamaManager = require('../utils/OllamaManager');

async function setupOllama() {
  console.log('🦙 Ollama Setup Script Starting...\n');

  const ollamaManager = new OllamaManager();

  try {
    // Check if Ollama server is running
    console.log('🔍 Checking Ollama server status...');
    const isRunning = await ollamaManager.isServerRunning();
    
    if (!isRunning) {
      console.error('❌ Ollama server is not running!');
      console.log('\n📋 To start Ollama:');
      console.log('  Local installation: ollama serve');
      console.log('  Docker: docker run -d -v ollama:/root/.ollama -p 11434:11434 --name ollama ollama/ollama');
      console.log('  Docker Compose: docker-compose up ollama -d');
      process.exit(1);
    }

    console.log('✅ Ollama server is running');

    // Get server info
    try {
      const serverInfo = await ollamaManager.getServerInfo();
      console.log(`📊 Server Version: ${serverInfo.version || 'Unknown'}`);
    } catch (error) {
      console.warn('⚠️  Could not get server version');
    }

    // List current models
    console.log('\n📦 Checking current models...');
    const currentModels = await ollamaManager.listModels();
    console.log(`Found ${currentModels.length} installed models:`);
    
    if (currentModels.length > 0) {
      currentModels.forEach(model => {
        const sizeGB = (model.size / (1024 * 1024 * 1024)).toFixed(1);
        console.log(`  - ${model.name} (${sizeGB}GB)`);
      });
    } else {
      console.log('  No models installed yet');
    }

    // Setup essential models
    console.log('\n🚀 Setting up essential models...');
    
    const essentialModels = [
      'llama3.2:3b',    // Fast text model
      'llava:7b',       // Vision model
      'codellama:7b',   // Code model
    ];

    for (const modelName of essentialModels) {
      console.log(`\n📥 Checking model: ${modelName}`);
      
      const isInstalled = await ollamaManager.isModelInstalled(modelName);
      
      if (isInstalled) {
        console.log(`✅ ${modelName} is already installed`);
        
        // Test the model
        console.log(`🧪 Testing ${modelName}...`);
        const testResult = await ollamaManager.testModel(modelName);
        
        if (testResult.success && testResult.working) {
          console.log(`✅ ${modelName} is working correctly`);
          if (testResult.processingTime) {
            console.log(`⏱️  Response time: ${testResult.processingTime}ms`);
          }
        } else {
          console.log(`❌ ${modelName} test failed: ${testResult.error || 'Unknown error'}`);
        }
      } else {
        console.log(`📦 Installing ${modelName}...`);
        console.log('⏳ This may take several minutes depending on your internet connection...');
        
        try {
          let lastStatus = '';
          
          const success = await ollamaManager.pullModel(modelName, (progress) => {
            if (progress.status && progress.status !== lastStatus) {
              console.log(`   ${progress.status}`);
              lastStatus = progress.status;
            }
          });
          
          if (success) {
            console.log(`✅ Successfully installed ${modelName}`);
            
            // Test the newly installed model
            console.log(`🧪 Testing ${modelName}...`);
            const testResult = await ollamaManager.testModel(modelName);
            
            if (testResult.success && testResult.working) {
              console.log(`✅ ${modelName} is working correctly`);
            } else {
              console.log(`⚠️  ${modelName} installed but test failed`);
            }
          } else {
            console.log(`❌ Failed to install ${modelName}`);
          }
        } catch (error) {
          console.error(`❌ Error installing ${modelName}: ${error.message}`);
        }
      }
    }

    // Generate final health report
    console.log('\n📊 Generating health report...');
    const healthReport = await ollamaManager.getHealthReport();
    
    console.log('\n🏥 Ollama Health Report:');
    console.log(`Server Status: ${healthReport.server.running ? '✅ Running' : '❌ Not Running'}`);
    console.log(`Total Models: ${healthReport.models.total}`);
    console.log(`Essential Models:`);
    console.log(`  Text Model: ${healthReport.models.essential.text ? '✅' : '❌'}`);
    console.log(`  Vision Model: ${healthReport.models.essential.vision ? '✅' : '❌'}`);
    console.log(`  Code Model: ${healthReport.models.essential.code ? '✅' : '❌'}`);
    
    if (healthReport.performance) {
      console.log(`Performance:`);
      console.log(`  Test Response Time: ${healthReport.performance.testResponseTime}ms`);
      console.log(`  Test Success: ${healthReport.performance.testSuccess ? '✅' : '❌'}`);
    }

    if (healthReport.recommendations.length > 0) {
      console.log('\n💡 Recommendations:');
      healthReport.recommendations.forEach(rec => console.log(`  - ${rec}`));
    }

    console.log('\n🎉 Ollama setup completed!');
    console.log('\n📋 Next steps:');
    console.log('  1. The LLM service will now use Ollama as the default provider');
    console.log('  2. External providers (OpenAI, Anthropic) will be used as fallbacks');
    console.log('  3. Run the demo: node examples/llm-integration-demo.js');
    console.log('  4. Start the worker: npm run worker');

  } catch (error) {
    console.error('❌ Setup failed:', error.message);
    console.log('\n🔧 Troubleshooting:');
    console.log('  1. Make sure Ollama is installed: https://ollama.ai/download');
    console.log('  2. Start Ollama server: ollama serve');
    console.log('  3. Check if port 11434 is available');
    console.log('  4. Verify network connectivity');
    process.exit(1);
  }
}

// Additional utility functions
async function listModels() {
  const ollamaManager = new OllamaManager();
  
  try {
    const models = await ollamaManager.listModels();
    
    console.log('📦 Installed Ollama Models:');
    if (models.length === 0) {
      console.log('  No models installed');
    } else {
      models.forEach(model => {
        const sizeGB = (model.size / (1024 * 1024 * 1024)).toFixed(1);
        const modified = new Date(model.modified_at).toLocaleDateString();
        console.log(`  - ${model.name} (${sizeGB}GB, modified: ${modified})`);
      });
    }
  } catch (error) {
    console.error('❌ Failed to list models:', error.message);
  }
}

async function healthCheck() {
  const ollamaManager = new OllamaManager();
  
  try {
    const report = await ollamaManager.getHealthReport();
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error('❌ Health check failed:', error.message);
  }
}

async function installModel(modelName) {
  const ollamaManager = new OllamaManager();
  
  try {
    console.log(`📦 Installing model: ${modelName}`);
    
    const success = await ollamaManager.pullModel(modelName, (progress) => {
      if (progress.status) {
        console.log(`   ${progress.status}`);
      }
    });
    
    if (success) {
      console.log(`✅ Successfully installed ${modelName}`);
    } else {
      console.log(`❌ Failed to install ${modelName}`);
    }
  } catch (error) {
    console.error(`❌ Installation failed: ${error.message}`);
  }
}

// CLI interface
if (require.main === module) {
  const command = process.argv[2];
  const arg = process.argv[3];

  switch (command) {
    case 'setup':
      setupOllama();
      break;
    case 'list':
      listModels();
      break;
    case 'health':
      healthCheck();
      break;
    case 'install':
      if (!arg) {
        console.error('❌ Please specify a model name: node setup-ollama.js install <model-name>');
        process.exit(1);
      }
      installModel(arg);
      break;
    default:
      console.log('🦙 Ollama Setup Script');
      console.log('\nUsage:');
      console.log('  node setup-ollama.js setup    - Setup essential models');
      console.log('  node setup-ollama.js list     - List installed models');
      console.log('  node setup-ollama.js health   - Show health report');
      console.log('  node setup-ollama.js install <model> - Install specific model');
      console.log('\nExamples:');
      console.log('  node setup-ollama.js setup');
      console.log('  node setup-ollama.js install mistral:7b');
      console.log('  node setup-ollama.js list');
      break;
  }
}

module.exports = {
  setupOllama,
  listModels,
  healthCheck,
  installModel,
};