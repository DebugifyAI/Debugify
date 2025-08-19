const path = require('path');
const fs = require('fs').promises;
const ImageProcessor = require('./ImageProcessor');

/**
 * Content parsing and extraction system with support for multiple file formats
 * Handles text extraction, log parsing, and integrates with image processing
 */
class ContentParser {
  constructor() {
    this.imageProcessor = new ImageProcessor();
    // Supported file types and their parsers
    this.parsers = new Map([
      // Text formats
      ['txt', this.parseText.bind(this)],
      ['md', this.parseText.bind(this)],
      ['log', this.parseLogFile.bind(this)],

      // Structured data formats
      ['json', this.parseJSON.bind(this)],
      ['xml', this.parseXML.bind(this)],
      ['csv', this.parseCSV.bind(this)],

      // Document formats (basic text extraction)
      ['pdf', this.parsePDF.bind(this)],
      ['doc', this.parseDocument.bind(this)],
      ['docx', this.parseDocument.bind(this)],

      // Image formats
      ['jpg', this.parseImage.bind(this)],
      ['jpeg', this.parseImage.bind(this)],
      ['png', this.parseImage.bind(this)],
      ['gif', this.parseImage.bind(this)],
      ['bmp', this.parseImage.bind(this)],
      ['tiff', this.parseImage.bind(this)],
      ['webp', this.parseImage.bind(this)],

      // Code files
      ['js', this.parseCode.bind(this)],
      ['ts', this.parseCode.bind(this)],
      ['py', this.parseCode.bind(this)],
      ['java', this.parseCode.bind(this)],
      ['cpp', this.parseCode.bind(this)],
      ['c', this.parseCode.bind(this)],
      ['html', this.parseCode.bind(this)],
      ['css', this.parseCode.bind(this)],
      ['sql', this.parseCode.bind(this)]
    ]);
    // Common log patterns
    this.logPatterns = {
      apache: /^(\S+) \S+ \S+ \[([^\]]+)\] "([^"]*)" (\d+) (\d+|-) "([^"]*)" "([^"]*)"/,
      nginx: /^(\S+) - \S+ \[([^\]]+)\] "([^"]*)" (\d+) (\d+|-) "([^"]*)" "([^"]*)"/,
      json: /^\{.*\}$/,
      timestamp: /\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}/,
      error: /(error|exception|fail|fatal|critical)/i,
      warning: /(warn|warning|caution)/i,
      info: /(info|information|notice)/i,
      debug: /(debug|trace|verbose)/i
    };
  }

  /**
   * Parse content based on file type and return structured results
   * @param {Buffer} content - File content buffer
   * @param {string} filename - Original filename
   * @param {Object} options - Parsing options
   * @returns {Object} Parsed content results
   */
  async parseContent(content, filename, options = {}) {
    try {
      const extension = this.getFileExtension(filename).toLowerCase();
      const parser = this.parsers.get(extension);
      if (!parser) {
        const result = await this.parseUnknown(content, filename);
        return {
          ...result,
          fileType: extension,
          filename
        };
      }
      const startTime = Date.now();
      const result = await parser(content, filename, options);
      const processingTime = Date.now() - startTime;
      return {
        ...result,
        fileType: extension,
        filename,
        processingTime,
        success: true
      };
    } catch (error) {
      return {
        fileType: this.getFileExtension(filename),
        filename,
        success: false,
        error: error.message,
        extractedText: '',
        metadata: {},
        structuredData: null
      };
    }
  }

  /**
   * Parse plain text files
   * @param {Buffer} content - File content
   * @param {string} filename - Filename
   * @returns {Object} Parsed text content
   */
  async parseText(content, filename) {
    const text = content.toString('utf-8')
    return {
      extractedText: text,
      metadata: {
        lineCount: text.split('\n').length,
        wordCount: text.split(/\s+/).filter(w => w.length > 0).length,
        characterCount: text.length,
        encoding: 'utf-8'
      },
      structuredData: {
        lines: text.split('\n'),
        paragraphs: text.split(/\n\s*\n/).filter(p => p.trim().length > 0)
      }
    };
  }

  /**
   * Parse log files with pattern recognition
   * @param {Buffer} content - File content
   * @param {string} filename - Filename
   * @returns {Object} Parsed log content
   */
  async parseLogFile(content, filename) {
    const text = content.toString('utf-8');
    const lines = text.split('\n').filter(line => line.trim().length > 0);
    
    const logEntries = [];
    const logStats = {
      totalLines: lines.length,
      errorCount: 0,
      warningCount: 0,
      infoCount: 0,
      debugCount: 0,
      timeRange: { start: null, end: null }
    };
    
    for (const line of lines) {
      const entry = this.parseLogLine(line);
      if (entry) {
        logEntries.push(entry);
        
        // Update statistics
        if (entry.level) {
          logStats[`${entry.level}Count`]++;
        }
        
        if (entry.timestamp) {
          if (!logStats.timeRange.start || entry.timestamp < logStats.timeRange.start) {
            logStats.timeRange.start = entry.timestamp;
          }
          if (!logStats.timeRange.end || entry.timestamp > logStats.timeRange.end) {
            logStats.timeRange.end = entry.timestamp;
          }
        }
      }
    }
    
    return {
      extractedText: text,
      metadata: {
        logFormat: this.detectLogFormat(lines[0] || ''),
        ...logStats
      },
      structuredData: {
        entries: logEntries,
        statistics: logStats
      }
    };
  }

  /**
   * Parse individual log line
   * @param {string} line - Log line
   * @returns {Object|null} Parsed log entry
   */
  parseLogLine(line) {
    // Try JSON format first
    if (this.logPatterns.json.test(line.trim())) {
      try {
        const jsonEntry = JSON.parse(line.trim());
        return {
          timestamp: jsonEntry.timestamp || jsonEntry.time || jsonEntry['@timestamp'],
          level: this.extractLogLevel(jsonEntry.level || jsonEntry.severity || line),
          message: jsonEntry.message || jsonEntry.msg || line,
          raw: line,
          format: 'json',
          data: jsonEntry
        };
      } catch (e) {
        // Fall through to other parsers
      }
    }
    
    // Try Apache/Nginx format
    const apacheMatch = line.match(this.logPatterns.apache);
    if (apacheMatch) {
      return {
        timestamp: apacheMatch[2],
        level: this.extractLogLevel(line),
        message: apacheMatch[3],
        raw: line,
        format: 'apache',
        data: {
          ip: apacheMatch[1],
          request: apacheMatch[3],
          status: parseInt(apacheMatch[4]),
          size: apacheMatch[5] !== '-' ? parseInt(apacheMatch[5], 10) : 0,
          referer: apacheMatch[6],
          userAgent: apacheMatch[7]
        }
      };
    }
    
    // Extract timestamp if present
    const timestampMatch = line.match(this.logPatterns.timestamp);
    
    return {
      timestamp: timestampMatch ? timestampMatch[0] : null,
      level: this.extractLogLevel(line),
      message: line,
      raw: line,
      format: 'generic'
    };
  }

  /**
   * Extract log level from line
   * @param {string} line - Log line
   * @returns {string} Log level
   */
  extractLogLevel(line) {
    const lowerLine = line.toLowerCase();
    
    if (this.logPatterns.error.test(lowerLine)) return 'error';
    if (this.logPatterns.warning.test(lowerLine)) return 'warning';
    if (this.logPatterns.debug.test(lowerLine)) return 'debug';
    if (this.logPatterns.info.test(lowerLine)) return 'info';
    
    return 'unknown';
  }

  /**
   * Detect log format from first line
   * @param {string} firstLine - First line of log
   * @returns {string} Detected format
   */
  detectLogFormat(firstLine) {
    if (this.logPatterns.json.test(firstLine.trim())) return 'json';
    if (this.logPatterns.apache.test(firstLine)) return 'apache';
    if (this.logPatterns.nginx.test(firstLine)) return 'nginx';
    if (this.logPatterns.timestamp.test(firstLine)) return 'timestamped';
    return 'generic';
  }

  /**
   * Parse JSON files
   * @param {Buffer} content - File content
   * @param {string} filename - Filename
   * @returns {Object} Parsed JSON content
   */
  async parseJSON(content, filename) {
    try {
      const text = content.toString('utf-8');
      const jsonData = JSON.parse(text);
      
      return {
        extractedText: JSON.stringify(jsonData, null, 2),
        metadata: {
          isArray: Array.isArray(jsonData),
          keyCount: typeof jsonData === 'object' ? Object.keys(jsonData).length : 0,
          size: text.length
        },
        structuredData: jsonData
      };
    } catch (error) {
      throw new Error(`Invalid JSON format: ${error.message}`);
    }
  }

  /**
   * Parse XML files (basic implementation)
   * @param {Buffer} content - File content
   * @param {string} filename - Filename
   * @returns {Object} Parsed XML content
   */
  async parseXML(content, filename) {
    const text = content.toString('utf-8');
    
    // Basic XML parsing - extract text content and structure
    const textContent = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const tags = text.match(/<[^/>][^>]*>/g) || [];
    const uniqueTags = [...new Set(tags.map(tag => tag.replace(/[<>]/g, '').split(' ')[0]))];
    
    return {
      extractedText: textContent,
      metadata: {
        tagCount: tags.length,
        uniqueTagCount: uniqueTags.length,
        rootElement: this.extractRootElement(text)
      },
      structuredData: {
        textContent,
        tags: uniqueTags,
        rawXML: text
      }
    };
  }

  /**
   * Extract root element from XML
   * @param {string} xml - XML content
   * @returns {string} Root element name
   */
  extractRootElement(xml) {
    const match = xml.match(/<([^>\s]+)[^>]*>/);
    return match ? match[1] : 'unknown';
  }

  /**
   * Parse CSV files
   * @param {Buffer} content - File content
   * @param {string} filename - Filename
   * @returns {Object} Parsed CSV content
   */
  async parseCSV(content, filename) {
    const text = content.toString('utf-8');
    const lines = text.split('\n').filter(line => line.trim().length > 0);
    
    if (lines.length === 0) {
      throw new Error('Empty CSV file');
    }
    
    // Simple CSV parsing (doesn't handle quoted commas)
    const headers = lines[0].split(',').map(h => h.trim());
    const rows = lines.slice(1).map(line => {
      const values = line.split(',').map(v => v.trim());
      const row = {};
      headers.forEach((header, index) => {
        row[header] = values[index] || '';
      });
      return row;
    });
    
    return {
      extractedText: text,
      metadata: {
        rowCount: rows.length,
        columnCount: headers.length,
        headers
      },
      structuredData: {
        headers,
        rows,
        summary: this.generateCSVSummary(rows, headers)
      }
    };
  }

  /**
   * Generate CSV summary statistics
   * @param {Array} rows - CSV rows
   * @param {Array} headers - CSV headers
   * @returns {Object} Summary statistics
   */
  generateCSVSummary(rows, headers) {
    const summary = {};
    
    headers.forEach(header => {
      const values = rows.map(row => row[header]).filter(v => v && v.length > 0);
      summary[header] = {
        totalValues: values.length,
        uniqueValues: new Set(values).size,
        sampleValues: values.slice(0, 5)
      };
    });
    
    return summary;
  }

  /**
   * Parse PDF files (placeholder - would need pdf-parse library)
   * @param {Buffer} content - File content
   * @param {string} filename - Filename
   * @returns {Object} Parsed PDF content
   */
  async parsePDF(content, filename) {
    // This is a placeholder implementation
    // In production, you would use a library like pdf-parse
    return {
      extractedText: '[PDF content extraction requires pdf-parse library]',
      metadata: {
        fileSize: content.length,
        format: 'pdf',
        note: 'PDF parsing not fully implemented'
      },
      structuredData: {
        pages: [],
        text: '[PDF content extraction requires pdf-parse library]'
      }
    };
  }

  /**
   * Parse document files (placeholder - would need mammoth or similar)
   * @param {Buffer} content - File content
   * @param {string} filename - Filename
   * @returns {Object} Parsed document content
   */
  async parseDocument(content, filename) {
    // This is a placeholder implementation
    // In production, you would use libraries like mammoth for .docx
    return {
      extractedText: '[Document content extraction requires mammoth library]',
      metadata: {
        fileSize: content.length,
        format: this.getFileExtension(filename),
        note: 'Document parsing not fully implemented'
      },
      structuredData: {
        text: '[Document content extraction requires mammoth library]'
      }
    };
  }

  /**
   * Parse image files using ImageProcessor
   * @param {Buffer} content - File content
   * @param {string} filename - Filename
   * @param {Object} options - Processing options
   * @returns {Object} Parsed image content
   */
  async parseImage(content, filename, options = {}) {
    const imageResults = await this.imageProcessor.processImage(content, options);
    
    return {
      extractedText: imageResults.ocrText.text || imageResults.ocrText,
      metadata: {
        ...imageResults.metadata,
        hasText: Boolean(imageResults.ocrText.text || imageResults.ocrText),
        processingTime: imageResults.processingTime
      },
      structuredData: {
        imageAnalysis: imageResults,
        ocrData: imageResults.ocrText,
        visualElements: imageResults.visualElements,
        sensitiveDataFlags: imageResults.sensitiveDataFlags
      }
    };
  }

  /**
   * Parse code files
   * @param {Buffer} content - File content
   * @param {string} filename - Filename
   * @returns {Object} Parsed code content
   */
  async parseCode(content, filename) {
    const text = content.toString('utf-8');
    const lines = text.split('\n');
    const extension = this.getFileExtension(filename);
    
    // Basic code analysis
    const codeStats = {
      totalLines: lines.length,
      codeLines: lines.filter(line => line.trim().length > 0 && !this.isComment(line, extension)).length,
      commentLines: lines.filter(line => this.isComment(line, extension)).length,
      blankLines: lines.filter(line => line.trim().length === 0).length
    };
    
    return {
      extractedText: text,
      metadata: {
        language: this.detectProgrammingLanguage(extension),
        ...codeStats
      },
      structuredData: {
        lines,
        functions: this.extractFunctions(text, extension),
        imports: this.extractImports(text, extension),
        statistics: codeStats
      }
    };
  }

  /**
   * Check if line is a comment
   * @param {string} line - Code line
   * @param {string} extension - File extension
   * @returns {boolean} True if comment
   */
  isComment(line, extension) {
    const trimmed = line.trim();
    
    switch (extension) {
      case 'js':
      case 'ts':
      case 'java':
      case 'cpp':
      case 'c':
        return trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*');
      case 'py':
        return trimmed.startsWith('#');
      case 'html':
        return trimmed.startsWith('<!--');
      case 'css':
        return trimmed.startsWith('/*');
      case 'sql':
        return trimmed.startsWith('--') || trimmed.startsWith('/*');
      default:
        return false;
    }
  }

  /**
   * Detect programming language from extension
   * @param {string} extension - File extension
   * @returns {string} Programming language
   */
  detectProgrammingLanguage(extension) {
    const languageMap = {
      js: 'JavaScript',
      ts: 'TypeScript',
      py: 'Python',
      java: 'Java',
      cpp: 'C++',
      c: 'C',
      html: 'HTML',
      css: 'CSS',
      sql: 'SQL'
    };
    
    return languageMap[extension] || 'Unknown';
  }

  /**
   * Extract function definitions from code
   * @param {string} code - Code content
   * @param {string} extension - File extension
   * @returns {Array} Function definitions
   */
  extractFunctions(code, extension) {
    const functions = [];
    
    // Basic function extraction patterns
    const patterns = {
      js: /function\s+(\w+)\s*\([^)]*\)/g,
      ts: /(?:function\s+(\w+)|(\w+)\s*:\s*\([^)]*\)\s*=>)/g,
      py: /def\s+(\w+)\s*\([^)]*\):/g,
      java: /(?:public|private|protected)?\s*(?:static)?\s*\w+\s+(\w+)\s*\([^)]*\)/g
    };
    
    const pattern = patterns[extension];
    if (pattern) {
      let match;
      while ((match = pattern.exec(code)) !== null) {
        functions.push({
          name: match[1] || match[2],
          line: code.substring(0, match.index).split('\n').length
        });
      }
    }
    
    return functions;
  }

  /**
   * Extract import statements from code
   * @param {string} code - Code content
   * @param {string} extension - File extension
   * @returns {Array} Import statements
   */
  extractImports(code, extension) {
    const imports = [];
    
    const patterns = {
      js: /import\s+.*\s+from\s+['"]([^'"]+)['"]/g,
      ts: /import\s+.*\s+from\s+['"]([^'"]+)['"]/g,
      py: /(?:import\s+(\w+)|from\s+(\w+)\s+import)/g,
      java: /import\s+([^;]+);/g
    };
    
    const pattern = patterns[extension];
    if (pattern) {
      let match;
      while ((match = pattern.exec(code)) !== null) {
        imports.push(match[1] || match[2]);
      }
    }
    
    return imports;
  }

  /**
   * Parse unknown file types
   * @param {Buffer} content - File content
   * @param {string} filename - Filename
   * @returns {Object} Basic parsing results
   */
  async parseUnknown(content, filename) {
    // Try to parse as text if it's likely text content
    const sample = content.slice(0, 1024).toString('utf-8');
    const isLikelyText = /^[\x20-\x7E\s]*$/.test(sample);
    
    if (isLikelyText) {
      const textResult = await this.parseText(content, filename);
      return {
        ...textResult,
        success: true
      };
    }
    
    return {
      extractedText: '',
      metadata: {
        fileSize: content.length,
        isBinary: true,
        format: 'unknown'
      },
      structuredData: {
        binaryData: true,
        size: content.length
      },
      success: true
    };
  }

  /**
   * Get file extension from filename
   * @param {string} filename - Filename
   * @returns {string} File extension
   */
  getFileExtension(filename) {
    return path.extname(filename).slice(1).toLowerCase();
  }

  /**
   * Get supported file types
   * @returns {Array} Supported extensions
   */
  getSupportedTypes() {
    return Array.from(this.parsers.keys());
  }

  /**
   * Check if file type is supported
   * @param {string} filename - Filename
   * @returns {boolean} True if supported
   */
  isSupported(filename) {
    const extension = this.getFileExtension(filename);
    return this.parsers.has(extension);
  }

  /**
   * Get parser capabilities and statistics
   * @returns {Object} Parser capabilities
   */
  getCapabilities() {
    return {
      supportedTypes: this.getSupportedTypes(),
      imageProcessing: this.imageProcessor.getCapabilities(),
      features: [
        'text_extraction',
        'log_parsing',
        'structured_data_parsing',
        'image_ocr',
        'code_analysis',
        'metadata_extraction'
      ],
      logFormats: ['json', 'apache', 'nginx', 'generic'],
      documentFormats: ['pdf', 'doc', 'docx'],
      imageFormats: this.imageProcessor.supportedFormats
    };
  }
}

module.exports = ContentParser;