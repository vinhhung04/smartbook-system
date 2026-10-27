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

  // Atomic read-and-delete (refresh-token rotation: a token can be consumed once).
  async getDelStrict(key) {
    if (!this.client || !this.client.isReady) throw new Error('Redis is not connected');
    return this.client.getDel(key);
  }

  async delStrict(key) {
    if (!this.client || !this.client.isReady) throw new Error('Redis is not connected');
    await this.client.del(key);
  }

  async disconnect() {
    if (this.client) {
      await this.client.quit();
      this.isConnected = false;
    }
  }

  // Cache operations
  async get(key) {
    if (!this.isConnected) return null;
    try {
      return await this.client.get(key);
    } catch (err) {
      console.error('[Redis] Get error:', err.message);
      return null;
    }
  }

  async set(key, value, ttlSeconds = 3600) {
    if (!this.isConnected) return false;
    try {
      await this.client.setEx(key, ttlSeconds, value);
      return true;
    } catch (err) {
      console.error('[Redis] Set error:', err.message);
      return false;
    }
  }

  async del(key) {
    if (!this.isConnected) return false;
    try {
      await this.client.del(key);
      return true;
    } catch (err) {
      console.error('[Redis] Del error:', err.message);
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
      console.error('[Redis] DelPattern error:', err.message);
      return false;
    }
  }

  // Rate limiting
  async checkRateLimit(key, maxRequests, windowSeconds) {
    if (!this.isConnected) return { allowed: true, remaining: maxRequests };

    try {
      const current = await this.client.incr(key);

      if (current === 1) {
        await this.client.expire(key, windowSeconds);
      }

      const remaining = Math.max(0, maxRequests - current);
      return {
        allowed: current <= maxRequests,
        remaining,
        resetIn: await this.client.ttl(key)
      };
    } catch (err) {
      console.error('[Redis] Rate limit error:', err.message);
      return { allowed: true, remaining: maxRequests };
    }
  }

  // Session management
  async setSession(userId, sessionData, ttlSeconds = 86400) {
    if (!this.isConnected) return false;
    try {
      const key = `session:${userId}`;
      await this.client.setEx(key, ttlSeconds, JSON.stringify(sessionData));
      return true;
    } catch (err) {
      console.error('[Redis] SetSession error:', err.message);
      return false;
    }
  }

  async getSession(userId) {
    if (!this.isConnected) return null;
    try {
      const key = `session:${userId}`;
      const data = await this.client.get(key);
      return data ? JSON.parse(data) : null;
    } catch (err) {
      console.error('[Redis] GetSession error:', err.message);
      return null;
    }
  }

  async deleteSession(userId) {
    if (!this.isConnected) return false;
    try {
      const key = `session:${userId}`;
      await this.client.del(key);
      return true;
    } catch (err) {
      console.error('[Redis] DeleteSession error:', err.message);
      return false;
    }
  }

  // Pub/Sub for real-time notifications
  async publish(channel, message) {
    if (!this.isConnected) return false;
    try {
      await this.client.publish(channel, JSON.stringify(message));
      return true;
    } catch (err) {
      console.error('[Redis] Publish error:', err.message);
      return false;
    }
  }

  async subscribe(channel, callback) {
    if (!this.isConnected) return null;
    try {
      const subscriber = this.client.duplicate();
      await subscriber.connect();
      await subscriber.subscribe(channel, (message) => {
        callback(JSON.parse(message));
      });
      return subscriber;
    } catch (err) {
      console.error('[Redis] Subscribe error:', err.message);
      return null;
    }
  }

  // Cache helper for API responses
  async cached(key, ttlSeconds, fetchFn) {
    if (!this.isConnected) return fetchFn();

    try {
      const cached = await this.client.get(key);
      if (cached) {
        return JSON.parse(cached);
      }

      const fresh = await fetchFn();
      await this.client.setEx(key, ttlSeconds, JSON.stringify(fresh));
      return fresh;
    } catch (err) {
      console.error('[Redis] Cached error:', err.message);
      return fetchFn();
    }
  }
}

module.exports = new RedisClient();
