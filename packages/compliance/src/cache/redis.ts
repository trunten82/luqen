import Redis from 'ioredis';

/**
 * Creates a Redis client if a URL is provided. Returns null when Redis is not
 * configured, allowing the application to fall back to in-memory behaviour.
 */
export function createRedisClient(url?: string): Redis | null {
  if (!url) return null;
  const client = new Redis(url, {
    // Avoid crash-looping the process when Redis is temporarily unavailable
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
  });

  client.on('error', (err: Error) => {
    // Log but do not throw — Redis is optional
    console.error('[compliance:redis] connection error:', err.message);
  });

  return client;
}

export class ComplianceCache {
  constructor(private readonly redis: Redis) {}

  async getCachedCheck(key: string): Promise<string | null> {
    try {
      return await this.redis.get(`compliance:check:${key}`);
    } catch {
      return null;
    }
  }

  async setCachedCheck(
    key: string,
    result: string,
    ttlSeconds = 300,
  ): Promise<void> {
    try {
      await this.redis.setex(`compliance:check:${key}`, ttlSeconds, result);
    } catch {
      // Non-fatal — cache write failure just means a cache miss next time
    }
  }

  async invalidate(pattern: string): Promise<void> {
    try {
      const keys = await this.redis.keys(`compliance:${pattern}`);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } catch {
      // Non-fatal
    }
  }
}
