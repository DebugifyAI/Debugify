const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

/**
 * Secure credential management system for AWS and LLM services
 * Implements encryption at rest, rotation, and secure access patterns
 */
class SecureCredentialManager {
  constructor() {
    this.encryptionKey = this.getOrCreateEncryptionKey();
    this.credentialCache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
    this.credentialPath = process.env.CREDENTIAL_PATH || path.join(__dirname, '../config/credentials');
    this.initializeCredentialStorage();
  }

  async initializeCredentialStorage() {
    try {
      await fs.mkdir(this.credentialPath, { recursive: true });
    } catch (error) {
      console.error('Failed to create credential storage directory:', error);
    }
  }

  /**
   * Get or create master encryption key
   */
  getOrCreateEncryptionKey() {
    // In production, this should come from a secure key management service
    const keyFromEnv = process.env.CREDENTIAL_ENCRYPTION_KEY;
    
    if (keyFromEnv) {
      return Buffer.from(keyFromEnv, 'hex');
    }
    
    // Generate a new key if none exists (development only)
    if (process.env.NODE_ENV === 'development') {
      console.warn('Using generated encryption key for development. Set CREDENTIAL_ENCRYPTION_KEY in production.');
      return crypto.randomBytes(32);
    }
    
    throw new Error('CREDENTIAL_ENCRYPTION_KEY must be set in production');
  }

  /**
   * Encrypt sensitive data
   */
  encrypt(data) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher('aes-256-cbc', this.encryptionKey);
    
    let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return {
      iv: iv.toString('hex'),
      data: encrypted,
    };
  }

  /**
   * Decrypt sensitive data
   */
  decrypt(encryptedData) {
    const decipher = crypto.createDecipher('aes-256-cbc', this.encryptionKey);
    
    let decrypted = decipher.update(encryptedData.data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return JSON.parse(decrypted);
  }

  /**
   * Store encrypted credentials
   */
  async storeCredentials(service, credentials) {
    try {
      const encrypted = this.encrypt(credentials);
      const credentialFile = path.join(this.credentialPath, `${service}.json`);
      
      const credentialData = {
        service,
        encrypted,
        createdAt: new Date().toISOString(),
        lastRotated: new Date().toISOString(),
        version: 1,
      };
      
      await fs.writeFile(credentialFile, JSON.stringify(credentialData, null, 2));
      
      // Clear cache for this service
      this.credentialCache.delete(service);
      
      console.log(`Credentials stored for service: ${service}`);
    } catch (error) {
      console.error(`Failed to store credentials for ${service}:`, error);
      throw new Error('Credential storage failed');
    }
  }

  /**
   * Retrieve and decrypt credentials
   */
  async getCredentials(service) {
    try {
      // Check cache first
      const cached = this.credentialCache.get(service);
      if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
        return cached.credentials;
      }

      const credentialFile = path.join(this.credentialPath, `${service}.json`);
      
      try {
        const credentialData = JSON.parse(await fs.readFile(credentialFile, 'utf8'));
        const credentials = this.decrypt(credentialData.encrypted);
        
        // Cache the credentials
        this.credentialCache.set(service, {
          credentials,
          timestamp: Date.now(),
        });
        
        return credentials;
      } catch (fileError) {
        // Fall back to environment variables if file doesn't exist
        return this.getCredentialsFromEnv(service);
      }
    } catch (error) {
      console.error(`Failed to retrieve credentials for ${service}:`, error);
      throw new Error('Credential retrieval failed');
    }
  }

  /**
   * Get credentials from environment variables (fallback)
   */
  getCredentialsFromEnv(service) {
    const envMappings = {
      aws: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        region: process.env.AWS_REGION || 'us-east-1',
        sessionToken: process.env.AWS_SESSION_TOKEN,
      },
      openai: {
        apiKey: process.env.OPENAI_API_KEY,
        organization: process.env.OPENAI_ORGANIZATION,
      },
      anthropic: {
        apiKey: process.env.ANTHROPIC_API_KEY,
      },
      ollama: {
        baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
        apiKey: process.env.OLLAMA_API_KEY,
      },
    };

    const credentials = envMappings[service];
    
    if (!credentials) {
      throw new Error(`No credential mapping found for service: ${service}`);
    }

    // Filter out undefined values
    const filteredCredentials = Object.fromEntries(
      Object.entries(credentials).filter(([, value]) => value !== undefined)
    );

    if (Object.keys(filteredCredentials).length === 0) {
      throw new Error(`No credentials found for service: ${service}`);
    }

    return filteredCredentials;
  }

  /**
   * Rotate credentials for a service
   */
  async rotateCredentials(service, newCredentials) {
    try {
      // Store old credentials as backup
      const oldCredentials = await this.getCredentials(service).catch(() => null);
      
      if (oldCredentials) {
        const backupFile = path.join(
          this.credentialPath, 
          `${service}.backup.${Date.now()}.json`
        );
        
        const backupData = {
          service,
          encrypted: this.encrypt(oldCredentials),
          backedUpAt: new Date().toISOString(),
        };
        
        await fs.writeFile(backupFile, JSON.stringify(backupData, null, 2));
      }

      // Store new credentials
      await this.storeCredentials(service, newCredentials);
      
      console.log(`Credentials rotated for service: ${service}`);
    } catch (error) {
      console.error(`Failed to rotate credentials for ${service}:`, error);
      throw new Error('Credential rotation failed');
    }
  }

  /**
   * Validate credentials for a service
   */
  async validateCredentials(service) {
    try {
      const credentials = await this.getCredentials(service);
      
      switch (service) {
        case 'aws':
          return this.validateAWSCredentials(credentials);
        case 'openai':
          return this.validateOpenAICredentials(credentials);
        case 'anthropic':
          return this.validateAnthropicCredentials(credentials);
        case 'ollama':
          return this.validateOllamaCredentials(credentials);
        default:
          throw new Error(`Validation not implemented for service: ${service}`);
      }
    } catch (error) {
      console.error(`Credential validation failed for ${service}:`, error);
      return false;
    }
  }

  /**
   * AWS credential validation
   */
  async validateAWSCredentials(credentials) {
    try {
      const AWS = require('aws-sdk');
      const sts = new AWS.STS({
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        region: credentials.region,
        sessionToken: credentials.sessionToken,
      });

      await sts.getCallerIdentity().promise();
      return true;
    } catch (error) {
      console.error('AWS credential validation failed:', error.message);
      return false;
    }
  }

  /**
   * OpenAI credential validation
   */
  async validateOpenAICredentials(credentials) {
    try {
      const response = await fetch('https://api.openai.com/v1/models', {
        headers: {
          'Authorization': `Bearer ${credentials.apiKey}`,
          'OpenAI-Organization': credentials.organization || '',
        },
      });

      return response.ok;
    } catch (error) {
      console.error('OpenAI credential validation failed:', error.message);
      return false;
    }
  }

  /**
   * Anthropic credential validation
   */
  async validateAnthropicCredentials(credentials) {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': credentials.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'test' }],
        }),
      });

      // Even if the request fails due to content, a 400 with proper error indicates valid auth
      return response.status !== 401 && response.status !== 403;
    } catch (error) {
      console.error('Anthropic credential validation failed:', error.message);
      return false;
    }
  }

  /**
   * Ollama credential validation
   */
  async validateOllamaCredentials(credentials) {
    try {
      const response = await fetch(`${credentials.baseUrl}/api/tags`, {
        headers: credentials.apiKey ? {
          'Authorization': `Bearer ${credentials.apiKey}`,
        } : {},
      });

      return response.ok;
    } catch (error) {
      console.error('Ollama credential validation failed:', error.message);
      return false;
    }
  }

  /**
   * Clear credential cache
   */
  clearCache(service = null) {
    if (service) {
      this.credentialCache.delete(service);
    } else {
      this.credentialCache.clear();
    }
  }

  /**
   * Get credential status for monitoring
   */
  async getCredentialStatus() {
    const services = ['aws', 'openai', 'anthropic', 'ollama'];
    const status = {};

    for (const service of services) {
      try {
        const credentials = await this.getCredentials(service);
        const isValid = await this.validateCredentials(service);
        
        status[service] = {
          configured: !!credentials,
          valid: isValid,
          lastChecked: new Date().toISOString(),
        };
      } catch (error) {
        status[service] = {
          configured: false,
          valid: false,
          error: error.message,
          lastChecked: new Date().toISOString(),
        };
      }
    }

    return status;
  }

  /**
   * Cleanup old backup files
   */
  async cleanupBackups(maxAge = 30 * 24 * 60 * 60 * 1000) { // 30 days
    try {
      const files = await fs.readdir(this.credentialPath);
      const backupFiles = files.filter(file => file.includes('.backup.'));
      
      for (const file of backupFiles) {
        const filePath = path.join(this.credentialPath, file);
        const stats = await fs.stat(filePath);
        
        if (Date.now() - stats.mtime.getTime() > maxAge) {
          await fs.unlink(filePath);
          console.log(`Cleaned up old backup file: ${file}`);
        }
      }
    } catch (error) {
      console.error('Backup cleanup failed:', error);
    }
  }
}

// Create singleton instance
const credentialManager = new SecureCredentialManager();

// Helper functions for easy access
const getAWSCredentials = () => credentialManager.getCredentials('aws');
const getOpenAICredentials = () => credentialManager.getCredentials('openai');
const getAnthropicCredentials = () => credentialManager.getCredentials('anthropic');
const getOllamaCredentials = () => credentialManager.getCredentials('ollama');

module.exports = {
  SecureCredentialManager,
  credentialManager,
  getAWSCredentials,
  getOpenAICredentials,
  getAnthropicCredentials,
  getOllamaCredentials,
};