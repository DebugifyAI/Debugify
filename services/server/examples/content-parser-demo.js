const ContentParser = require('../helpers/ContentParser');
const fs = require('fs').promises;
const sharp = require('sharp');

/**
 * Demo script showing ContentParser capabilities
 */
async function demonstrateContentParser() {
  const parser = new ContentParser();
  
  console.log('=== Content Parser Demo ===\n');
  
  // Show capabilities
  console.log('Parser Capabilities:');
  const capabilities = parser.getCapabilities();
  console.log('- Supported file types:', capabilities.supportedTypes.join(', '));
  console.log('- Features:', capabilities.features.join(', '));
  console.log('- Log formats:', capabilities.logFormats.join(', '));
  console.log();
  
  // Demo 1: Parse JSON file
  console.log('1. Parsing JSON file:');
  const jsonContent = Buffer.from(JSON.stringify({
    name: 'Demo API',
    version: '1.0.0',
    endpoints: ['/users', '/posts', '/comments']
  }, null, 2));
  
  const jsonResult = await parser.parseContent(jsonContent, 'api.json');
  console.log('- Success:', jsonResult.success);
  console.log('- File type:', jsonResult.fileType);
  console.log('- Keys found:', Object.keys(jsonResult.structuredData));
  console.log('- Processing time:', jsonResult.processingTime, 'ms');
  console.log();
  
  // Demo 2: Parse log file
  console.log('2. Parsing log file:');
  const logContent = Buffer.from(`{"timestamp":"2023-01-01T10:00:00Z","level":"info","message":"Server started"}
{"timestamp":"2023-01-01T10:01:00Z","level":"error","message":"Database connection failed"}
{"timestamp":"2023-01-01T10:02:00Z","level":"warn","message":"High memory usage detected"}`);
  
  const logResult = await parser.parseContent(logContent, 'app.log');
  console.log('- Success:', logResult.success);
  console.log('- Log format:', logResult.metadata.logFormat);
  console.log('- Total entries:', logResult.structuredData.entries.length);
  console.log('- Error count:', logResult.metadata.errorCount);
  console.log('- Warning count:', logResult.metadata.warningCount);
  console.log();
  
  // Demo 3: Parse JavaScript code
  console.log('3. Parsing JavaScript code:');
  const jsContent = Buffer.from(`// API Server
const express = require('express');
const app = express();

function startServer() {
  app.listen(3000, () => {
    console.log('Server running on port 3000');
  });
}

const middleware = (req, res, next) => {
  console.log('Request received');
  next();
};

startServer();`);
  
  const jsResult = await parser.parseContent(jsContent, 'server.js');
  console.log('- Success:', jsResult.success);
  console.log('- Language:', jsResult.metadata.language);
  console.log('- Total lines:', jsResult.metadata.totalLines);
  console.log('- Code lines:', jsResult.metadata.codeLines);
  console.log('- Functions found:', jsResult.structuredData.functions.map(f => f.name));
  console.log('- Imports:', jsResult.structuredData.imports);
  console.log();
  
  // Demo 4: Parse CSV data
  console.log('4. Parsing CSV data:');
  const csvContent = Buffer.from(`name,age,department,salary
John Doe,28,Engineering,75000
Jane Smith,32,Marketing,68000
Bob Johnson,45,Sales,82000
Alice Brown,29,Engineering,78000`);
  
  const csvResult = await parser.parseContent(csvContent, 'employees.csv');
  console.log('- Success:', csvResult.success);
  console.log('- Rows:', csvResult.metadata.rowCount);
  console.log('- Columns:', csvResult.metadata.columnCount);
  console.log('- Headers:', csvResult.metadata.headers);
  console.log('- Sample data:', csvResult.structuredData.rows[0]);
  console.log();
  
  // Demo 5: Parse image (create a simple test image)
  console.log('5. Parsing image file:');
  try {
    const testImage = await sharp({
      create: {
        width: 300,
        height: 200,
        channels: 3,
        background: { r: 255, g: 255, b: 255 }
      }
    })
    .composite([{
      input: Buffer.from(`
        <svg width="300" height="200">
          <text x="20" y="50" font-family="Arial" font-size="24" fill="black">
            Sample Image Text
          </text>
          <text x="20" y="100" font-family="Arial" font-size="18" fill="black">
            Processing Demo
          </text>
        </svg>
      `),
      top: 0,
      left: 0
    }])
    .png()
    .toBuffer();
    
    const imageResult = await parser.parseContent(testImage, 'demo.png');
    console.log('- Success:', imageResult.success);
    console.log('- Dimensions:', `${imageResult.metadata.width}x${imageResult.metadata.height}`);
    console.log('- Format:', imageResult.metadata.format);
    console.log('- Has text:', imageResult.metadata.hasText);
    console.log('- OCR text preview:', (imageResult.extractedText || '').substring(0, 50) + '...');
    console.log('- Processing time:', imageResult.metadata.processingTime, 'ms');
  } catch (error) {
    console.log('- Image processing failed:', error.message);
  }
  console.log();
  
  // Demo 6: Parse unknown file type
  console.log('6. Parsing unknown file type:');
  const unknownContent = Buffer.from('This is some unknown file content that looks like text');
  const unknownResult = await parser.parseContent(unknownContent, 'mystery.xyz');
  console.log('- Success:', unknownResult.success);
  console.log('- File type:', unknownResult.fileType);
  console.log('- Treated as binary:', unknownResult.metadata.isBinary || false);
  console.log('- Extracted text length:', unknownResult.extractedText.length);
  console.log();
  
  console.log('=== Demo Complete ===');
}

// Run the demo if this file is executed directly
if (require.main === module) {
  demonstrateContentParser().catch(console.error);
}

module.exports = { demonstrateContentParser };