const ContentParser = require('../services/ContentParser');
const sharp = require('sharp');

describe('ContentParser', () => {
  let contentParser;
  let testImageBuffer;

  beforeAll(async () => {
    contentParser = new ContentParser();
    
    // Create test image for image parsing tests
    testImageBuffer = await sharp({
      create: {
        width: 200,
        height: 100,
        channels: 3,
        background: { r: 255, g: 255, b: 255 }
      }
    })
    .png()
    .toBuffer();
  });

  describe('constructor', () => {
    test('should initialize with parsers and patterns', () => {
      expect(contentParser.parsers).toBeDefined();
      expect(contentParser.logPatterns).toBeDefined();
      expect(contentParser.imageProcessor).toBeDefined();
    });

    test('should have parsers for common file types', () => {
      expect(contentParser.parsers.has('txt')).toBe(true);
      expect(contentParser.parsers.has('json')).toBe(true);
      expect(contentParser.parsers.has('log')).toBe(true);
      expect(contentParser.parsers.has('jpg')).toBe(true);
      expect(contentParser.parsers.has('js')).toBe(true);
    });
  });

  describe('getFileExtension', () => {
    test('should extract file extensions correctly', () => {
      expect(contentParser.getFileExtension('test.txt')).toBe('txt');
      expect(contentParser.getFileExtension('image.JPG')).toBe('jpg');
      expect(contentParser.getFileExtension('script.js')).toBe('js');
      expect(contentParser.getFileExtension('data.json')).toBe('json');
    });

    test('should handle files without extensions', () => {
      expect(contentParser.getFileExtension('README')).toBe('');
    });
  });

  describe('isSupported', () => {
    test('should identify supported file types', () => {
      expect(contentParser.isSupported('test.txt')).toBe(true);
      expect(contentParser.isSupported('data.json')).toBe(true);
      expect(contentParser.isSupported('image.png')).toBe(true);
      expect(contentParser.isSupported('script.js')).toBe(true);
    });

    test('should identify unsupported file types', () => {
      expect(contentParser.isSupported('test.xyz')).toBe(false);
      expect(contentParser.isSupported('binary.exe')).toBe(false);
    });
  });

  describe('parseText', () => {
    test('should parse plain text files', async () => {
      const content = Buffer.from('Hello World\nThis is a test\n\nAnother paragraph');
      const result = await contentParser.parseText(content, 'test.txt');
      
      expect(result.extractedText).toBe('Hello World\nThis is a test\n\nAnother paragraph');
      expect(result.metadata.lineCount).toBe(4);
      expect(result.metadata.wordCount).toBe(8); // "Hello World This is a test Another paragraph" = 8 words
      expect(result.structuredData.lines).toHaveLength(4);
      expect(result.structuredData.paragraphs).toHaveLength(2);
    });

    test('should handle empty text files', async () => {
      const content = Buffer.from('');
      const result = await contentParser.parseText(content, 'empty.txt');
      
      expect(result.extractedText).toBe('');
      expect(result.metadata.lineCount).toBe(1);
      expect(result.metadata.wordCount).toBe(0);
    });
  });

  describe('parseJSON', () => {
    test('should parse valid JSON files', async () => {
      const jsonData = { name: 'test', value: 123, items: [1, 2, 3] };
      const content = Buffer.from(JSON.stringify(jsonData));
      const result = await contentParser.parseJSON(content, 'test.json');
      
      expect(result.structuredData).toEqual(jsonData);
      expect(result.metadata.isArray).toBe(false);
      expect(result.metadata.keyCount).toBe(3);
    });

    test('should parse JSON arrays', async () => {
      const jsonData = [1, 2, 3, 4, 5];
      const content = Buffer.from(JSON.stringify(jsonData));
      const result = await contentParser.parseJSON(content, 'array.json');
      
      expect(result.structuredData).toEqual(jsonData);
      expect(result.metadata.isArray).toBe(true);
    });

    test('should handle invalid JSON', async () => {
      const content = Buffer.from('{ invalid json }');
      
      await expect(contentParser.parseJSON(content, 'invalid.json'))
        .rejects.toThrow('Invalid JSON format');
    });
  });

  describe('parseXML', () => {
    test('should parse XML files', async () => {
      const xmlContent = `<?xml version="1.0"?>
        <root>
          <item id="1">First item</item>
          <item id="2">Second item</item>
        </root>`;
      const content = Buffer.from(xmlContent);
      const result = await contentParser.parseXML(content, 'test.xml');
      
      expect(result.extractedText).toContain('First item');
      expect(result.extractedText).toContain('Second item');
      expect(result.metadata.rootElement).toBe('?xml');
      expect(result.structuredData.tags).toContain('root');
      expect(result.structuredData.tags).toContain('item');
    });
  });

  describe('parseCSV', () => {
    test('should parse CSV files', async () => {
      const csvContent = `name,age,city
John,25,New York
Jane,30,Los Angeles
Bob,35,Chicago`;
      const content = Buffer.from(csvContent);
      const result = await contentParser.parseCSV(content, 'test.csv');
      
      expect(result.metadata.rowCount).toBe(3);
      expect(result.metadata.columnCount).toBe(3);
      expect(result.metadata.headers).toEqual(['name', 'age', 'city']);
      expect(result.structuredData.rows[0]).toEqual({
        name: 'John',
        age: '25',
        city: 'New York'
      });
    });

    test('should handle empty CSV files', async () => {
      const content = Buffer.from('');
      
      await expect(contentParser.parseCSV(content, 'empty.csv'))
        .rejects.toThrow('Empty CSV file');
    });
  });

  describe('parseLogFile', () => {
    test('should parse JSON log format', async () => {
      const logContent = `{"timestamp":"2023-01-01T10:00:00Z","level":"info","message":"Server started"}
{"timestamp":"2023-01-01T10:01:00Z","level":"error","message":"Database connection failed"}`;
      const content = Buffer.from(logContent);
      const result = await contentParser.parseLogFile(content, 'app.log');
      
      expect(result.metadata.logFormat).toBe('json');
      expect(result.metadata.totalLines).toBe(2);
      expect(result.metadata.errorCount).toBe(1);
      expect(result.metadata.infoCount).toBe(1);
      expect(result.structuredData.entries).toHaveLength(2);
      expect(result.structuredData.entries[0].level).toBe('info');
    });

    test('should parse Apache log format', async () => {
      const logContent = `127.0.0.1 - - [01/Jan/2023:10:00:00 +0000] "GET /index.html HTTP/1.1" 200 1234 "-" "Mozilla/5.0"`;
      const content = Buffer.from(logContent);
      const result = await contentParser.parseLogFile(content, 'access.log');
      
      expect(result.metadata.logFormat).toBe('apache');
      expect(result.structuredData.entries[0].format).toBe('apache');
      expect(result.structuredData.entries[0].data.ip).toBe('127.0.0.1');
      expect(result.structuredData.entries[0].data.status).toBe(200);
    });

    test('should parse generic log format', async () => {
      const logContent = `2023-01-01 10:00:00 INFO Server started successfully
2023-01-01 10:01:00 ERROR Failed to connect to database`;
      const content = Buffer.from(logContent);
      const result = await contentParser.parseLogFile(content, 'generic.log');
      
      expect(result.structuredData.entries).toHaveLength(2);
      expect(result.structuredData.entries[0].level).toBe('info');
      expect(result.structuredData.entries[1].level).toBe('error');
    });
  });

  describe('extractLogLevel', () => {
    test('should extract log levels correctly', () => {
      expect(contentParser.extractLogLevel('ERROR: Something went wrong')).toBe('error');
      expect(contentParser.extractLogLevel('WARN: This is a warning')).toBe('warning');
      expect(contentParser.extractLogLevel('INFO: Information message')).toBe('info');
      expect(contentParser.extractLogLevel('DEBUG: Debug information')).toBe('debug');
      expect(contentParser.extractLogLevel('Some random message')).toBe('unknown');
    });
  });

  describe('detectLogFormat', () => {
    test('should detect JSON log format', () => {
      const jsonLine = '{"timestamp":"2023-01-01","level":"info","message":"test"}';
      expect(contentParser.detectLogFormat(jsonLine)).toBe('json');
    });

    test('should detect Apache log format', () => {
      const apacheLine = '127.0.0.1 - - [01/Jan/2023:10:00:00 +0000] "GET /" 200 1234 "-" "Mozilla"';
      expect(contentParser.detectLogFormat(apacheLine)).toBe('apache');
    });

    test('should detect timestamped format', () => {
      const timestampLine = '2023-01-01 10:00:00 Some log message';
      expect(contentParser.detectLogFormat(timestampLine)).toBe('timestamped');
    });

    test('should default to generic format', () => {
      const genericLine = 'Some random log message without timestamp';
      expect(contentParser.detectLogFormat(genericLine)).toBe('generic');
    });
  });

  describe('parseCode', () => {
    test('should parse JavaScript files', async () => {
      const jsContent = `// This is a comment
function testFunction() {
  return true;
}

const arrow = () => {
  console.log('test');
};`;
      const content = Buffer.from(jsContent);
      const result = await contentParser.parseCode(content, 'test.js');
      
      expect(result.metadata.language).toBe('JavaScript');
      expect(result.metadata.totalLines).toBe(8);
      expect(result.metadata.commentLines).toBe(1);
      expect(result.structuredData.functions).toHaveLength(1);
      expect(result.structuredData.functions[0].name).toBe('testFunction');
    });

    test('should parse Python files', async () => {
      const pyContent = `# Python comment
import os
from datetime import datetime

def hello_world():
    print("Hello, World!")
    return True`;
      const content = Buffer.from(pyContent);
      const result = await contentParser.parseCode(content, 'test.py');
      
      expect(result.metadata.language).toBe('Python');
      expect(result.metadata.commentLines).toBe(1);
      expect(result.structuredData.functions).toHaveLength(1);
      expect(result.structuredData.functions[0].name).toBe('hello_world');
      expect(result.structuredData.imports).toContain('os');
      expect(result.structuredData.imports).toContain('datetime');
    });
  });

  describe('isComment', () => {
    test('should identify JavaScript comments', () => {
      expect(contentParser.isComment('// This is a comment', 'js')).toBe(true);
      expect(contentParser.isComment('/* Block comment */', 'js')).toBe(true);
      expect(contentParser.isComment('const x = 5;', 'js')).toBe(false);
    });

    test('should identify Python comments', () => {
      expect(contentParser.isComment('# This is a comment', 'py')).toBe(true);
      expect(contentParser.isComment('print("hello")', 'py')).toBe(false);
    });

    test('should identify HTML comments', () => {
      expect(contentParser.isComment('<!-- HTML comment -->', 'html')).toBe(true);
      expect(contentParser.isComment('<div>content</div>', 'html')).toBe(false);
    });
  });

  describe('detectProgrammingLanguage', () => {
    test('should detect languages from extensions', () => {
      expect(contentParser.detectProgrammingLanguage('js')).toBe('JavaScript');
      expect(contentParser.detectProgrammingLanguage('py')).toBe('Python');
      expect(contentParser.detectProgrammingLanguage('java')).toBe('Java');
      expect(contentParser.detectProgrammingLanguage('unknown')).toBe('Unknown');
    });
  });

  describe('parseImage', () => {
    test('should parse image files using ImageProcessor', async () => {
      const result = await contentParser.parseImage(testImageBuffer, 'test.png');
      
      expect(result).toHaveProperty('extractedText');
      expect(result).toHaveProperty('metadata');
      expect(result).toHaveProperty('structuredData');
      expect(result.structuredData).toHaveProperty('imageAnalysis');
      expect(result.structuredData).toHaveProperty('ocrData');
      expect(result.metadata).toHaveProperty('width');
      expect(result.metadata).toHaveProperty('height');
    }, 30000);
  });

  describe('parseUnknown', () => {
    test('should parse text-like unknown files as text', async () => {
      const content = Buffer.from('This looks like text content');
      const result = await contentParser.parseUnknown(content, 'unknown.xyz');
      
      expect(result.extractedText).toBe('This looks like text content');
      expect(result.metadata.isBinary).toBeUndefined();
    });

    test('should handle binary unknown files', async () => {
      const content = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xFF]);
      const result = await contentParser.parseUnknown(content, 'binary.xyz');
      
      expect(result.extractedText).toBe('');
      expect(result.metadata.isBinary).toBe(true);
      expect(result.structuredData.binaryData).toBe(true);
    });
  });

  describe('parseContent', () => {
    test('should parse content based on file extension', async () => {
      const content = Buffer.from('{"test": "data"}');
      const result = await contentParser.parseContent(content, 'test.json');
      
      expect(result.success).toBe(true);
      expect(result.fileType).toBe('json');
      expect(result.filename).toBe('test.json');
      expect(result.processingTime).toBeGreaterThanOrEqual(0);
      expect(result.structuredData.test).toBe('data');
    });

    test('should handle unsupported file types', async () => {
      const content = Buffer.from('some content');
      const result = await contentParser.parseContent(content, 'test.xyz');
      
      expect(result.success).toBe(true);
      expect(result.fileType).toBe('xyz');
    });

    test('should handle parsing errors gracefully', async () => {
      const content = Buffer.from('invalid json {');
      const result = await contentParser.parseContent(content, 'test.json');
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid JSON format');
      expect(result.extractedText).toBe('');
    });

    test('should pass options to parsers', async () => {
      const options = { formats: ['webp'] };
      const result = await contentParser.parseContent(testImageBuffer, 'test.png', options);
      
      expect(result.success).toBe(true);
      expect(result.fileType).toBe('png');
    }, 30000);
  });

  describe('generateCSVSummary', () => {
    test('should generate CSV column summaries', () => {
      const rows = [
        { name: 'John', age: '25', city: 'NYC' },
        { name: 'Jane', age: '30', city: 'LA' },
        { name: 'Bob', age: '25', city: 'NYC' }
      ];
      const headers = ['name', 'age', 'city'];
      
      const summary = contentParser.generateCSVSummary(rows, headers);
      
      expect(summary.name.totalValues).toBe(3);
      expect(summary.name.uniqueValues).toBe(3);
      expect(summary.age.uniqueValues).toBe(2);
      expect(summary.city.uniqueValues).toBe(2);
    });
  });

  describe('extractFunctions', () => {
    test('should extract JavaScript functions', () => {
      const code = `function test() { return true; }
const arrow = () => { return false; }`;
      const functions = contentParser.extractFunctions(code, 'js');
      
      expect(functions).toHaveLength(1);
      expect(functions[0].name).toBe('test');
    });

    test('should extract Python functions', () => {
      const code = `def hello():
    pass

def world(param):
    return param`;
      const functions = contentParser.extractFunctions(code, 'py');
      
      expect(functions).toHaveLength(2);
      expect(functions[0].name).toBe('hello');
      expect(functions[1].name).toBe('world');
    });
  });

  describe('extractImports', () => {
    test('should extract JavaScript imports', () => {
      const code = `import React from 'react';
import { useState } from 'react';
import utils from './utils';`;
      const imports = contentParser.extractImports(code, 'js');
      
      expect(imports).toContain('react');
      expect(imports).toContain('./utils');
    });

    test('should extract Python imports', () => {
      const code = `import os
from datetime import datetime
import json`;
      const imports = contentParser.extractImports(code, 'py');
      
      expect(imports).toContain('os');
      expect(imports).toContain('datetime');
      expect(imports).toContain('json');
    });
  });

  describe('getSupportedTypes', () => {
    test('should return list of supported file types', () => {
      const types = contentParser.getSupportedTypes();
      
      expect(Array.isArray(types)).toBe(true);
      expect(types).toContain('txt');
      expect(types).toContain('json');
      expect(types).toContain('jpg');
      expect(types).toContain('js');
    });
  });

  describe('getCapabilities', () => {
    test('should return parser capabilities', () => {
      const capabilities = contentParser.getCapabilities();
      
      expect(capabilities).toHaveProperty('supportedTypes');
      expect(capabilities).toHaveProperty('imageProcessing');
      expect(capabilities).toHaveProperty('features');
      expect(capabilities).toHaveProperty('logFormats');
      expect(capabilities).toHaveProperty('documentFormats');
      expect(capabilities).toHaveProperty('imageFormats');
      
      expect(Array.isArray(capabilities.supportedTypes)).toBe(true);
      expect(Array.isArray(capabilities.features)).toBe(true);
      expect(capabilities.features).toContain('text_extraction');
      expect(capabilities.features).toContain('log_parsing');
      expect(capabilities.features).toContain('image_ocr');
    });
  });
});