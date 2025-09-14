const redis = require('redis');
const config = require('../config');

class RedisAdapter {
  constructor() {
    this.client = null;
    this.isConnected = false;
  }

  async connect() {
    if (this.isConnected) return this.client;

    try {
      this.client = redis.createClient({
        host: config.redis.host,
        port: config.redis.port
      });

      this.client.on('error', (err) => {
        console.error('Redis error:', err);
        this.isConnected = false;
      });

      this.client.on('connect', () => {
        console.log('Connected to Redis');
        this.isConnected = true;
      });

      await this.client.connect();
      return this.client;
    } catch (error) {
      console.error('Failed to connect to Redis:', error);
      // For development, we'll create a mock Redis client
      return this.createMockClient();
    }
  }

  createMockClient() {
    console.log('Using mock Redis client for development');
    const mockStorage = new Map();
    
    return {
      set: async (key, value, options) => {
        mockStorage.set(key, value);
        if (options && options.ex) {
          setTimeout(() => mockStorage.delete(key), options.ex * 1000);
        }
        return 'OK';
      },
      get: async (key) => {
        return mockStorage.get(key) || null;
      },
      del: async (key) => {
        return mockStorage.delete(key) ? 1 : 0;
      },
      keys: async (pattern) => {
        const keys = Array.from(mockStorage.keys());
        if (pattern === '*') return keys;
        const regex = new RegExp(pattern.replace(/\*/g, '.*'));
        return keys.filter(key => regex.test(key));
      },
      exists: async (key) => {
        return mockStorage.has(key) ? 1 : 0;
      }
    };
  }

  async getClient() {
    if (!this.client || !this.isConnected) {
      await this.connect();
    }
    return this.client;
  }
}

const redisAdapter = new RedisAdapter();

// Initialize connection
redisAdapter.connect().catch(console.error);

// Export methods that match Redis client interface
module.exports = {
  set: async (key, value, options) => {
    const client = await redisAdapter.getClient();
    return client.set(key, value, options);
  },
  get: async (key) => {
    const client = await redisAdapter.getClient();
    return client.get(key);
  },
  del: async (key) => {
    const client = await redisAdapter.getClient();
    return client.del(key);
  },
  keys: async (pattern) => {
    const client = await redisAdapter.getClient();
    return client.keys(pattern);
  },
  exists: async (key) => {
    const client = await redisAdapter.getClient();
    return client.exists(key);
  }
};