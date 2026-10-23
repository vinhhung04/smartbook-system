/**
 * Redis Client for Borrow Service
 *
 * Simple Redis wrapper with graceful degradation (works without Redis).
 * Mirrors services/auth-service/src/lib/redis.js and
 * services/inventory-service/src/lib/redis.js — same key conventions, same
 * Redis instance (REDIS_URL), so token revocation set by auth-service is
 * honored here too (see middlewares/auth.middleware.js authenticateToken).
 */

const { createClient } = require('redis');

class RedisClient {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.everReady = false;
  }

  async connect() {
    if (this.isConnected) return this.client;

    const redisUrl = process.env.REDIS_URL || 'redis://redis:6379';

    this.client = createClient({
      url: redisUrl,
      socket: {
        // Before the first successful connection: give up after ~5 s so callers
        // that await connect() are not blocked (a background retry follows).
        // Once connected: never give up - a client that stopped reconnecting
        // after an outage left token-revocation checks off until the service
        // restarted (Phase 5).
        reconnectStrategy: (retries) => {
          if (!this.everReady && retries > 10) return new Error('Max retries reached');
          return Math.min(retries * 100, 3000);
        },
      },
      // Fail fast while disconnected instead of queueing commands until Redis is
      // back (a queued revocation lookup would hang the request).
      disableOfflineQueue: true,
    });

    this.client.on('error', (err) => {
      console.warn('[Redis] Error:', err.message);
    });

    this.client.on('ready', () => {
      this.everReady = true;
      this.isConnected = true;
      console.log('[Redis] Connected');
    });

    this.client.on('end', () => {
      this.isConnected = false;
    });

    try {
      await this.client.connect();
      this.isConnected = true;
    } catch (err) {
      console.warn('[Redis] Connection failed, retrying in the background:', err.message);
      this.isConnected = false;
      // unref: a background retry must not keep a finished process alive
      const retry = setTimeout(() => { this.connect().catch(() => {}); }, 10000);
      retry.unref?.();
    }

    return this.client;
  }

  // Strict reads/writes for token revocation: throw when Redis cannot answer,
  // so "unreachable" is never mistaken for "no such key" (see
  // @smartbook/shared/token-revocation).
  async getStrict(key) {
    if (!this.client || !this.client.isReady) throw new Error('Redis is not connected');
    return this.client.get(key);
  }

  async setStrict(key, value, ttlSeconds = 3600) {
    if (!this.client || !this.client.isReady) throw new Error('Redis is not connected');
    await this.client.setEx(key, ttlSeconds, value);
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
}

module.exports = new RedisClient();
