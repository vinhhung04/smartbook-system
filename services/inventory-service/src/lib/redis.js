/**
 * Redis Client for Inventory Service
 * 
 * Simple Redis wrapper with graceful degradation (works without Redis).
 */

const { createClient } = require('redis');

class RedisClient {
  constructor() {
    this.client = null;
    this.isConnected = false;
  }

  async connect() {
    if (this.isConnected) return this.client;

    const redisUrl = process.env.REDIS_URL || 'redis://redis:6379';

    this.client = createClient({
      url: redisUrl,
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 10) {
            console.log('[Redis] Max retries reached, stopping reconnection');
            return new Error('Max retries reached');
          }
          return Math.min(retries * 100, 3000);
        }
      }
    });

    this.client.on('error', (err) => {
      console.warn('[Redis] Error:', err.message);
    });

    this.client.on('connect', () => {
      console.log('[Redis] Connected');
    });

    try {
      await this.client.connect();
      this.isConnected = true;
    } catch (err) {
      console.warn('[Redis] Connection failed, running without cache:', err.message);
      this.isConnected = false;
    }

    return this.client;
  }

  async disconnect() {
    if (this.client) {
      await this.client.quit();
      this.isConnected = false;
    }
  }

  async get(key) {
    if (!this.isConnected) return null;
    try {
      return await this.client.get(key);
    } catch (err) {
      console.warn('[Redis] Get error:', err.message);
      return null;
    }
  }

  async set(key, value, ttlSeconds = 3600) {
    if (!this.isConnected) return false;
    try {
      await this.client.setEx(key, ttlSeconds, value);
      return true;
    } catch (err) {
      console.warn('[Redis] Set error:', err.message);
      return false;
    }
  }

  async del(key) {
    if (!this.isConnected) return false;
    try {
      await this.client.del(key);
      return true;
    } catch (err) {
      console.warn('[Redis] Del error:', err.message);
      return false;
    }
  }

  async delPattern(pattern) {
    if (!this.isConnected) return false;
    try {
      const keys = await this.client.keys(pattern);
      if (keys.length > 0) {
        await this.client.del(keys);
      }
      return true;
    } catch (err) {
      console.warn('[Redis] DelPattern error:', err.message);
      return false;
    }
  }
}

module.exports = new RedisClient();
