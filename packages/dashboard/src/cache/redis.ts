import { Redis } from 'ioredis';

type RedisInstance = InstanceType<typeof Redis>;

/**
 * Creates a Redis client if a URL is provided. Returns null when Redis is not
 * configured, allowing the application to fall back to in-memory behaviour.
 */
export function createRedisClient(url?: string): RedisInstance | null {
  if (!url) return null;
  const client = new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
  });

  client.on('error', (err: Error) => {
    console.error('[dashboard:redis] connection error:', err.message);
  });

  return client;
}

// ── Scan queue ────────────────────────────────────────────────────────────────

export interface QueuedScan {
  readonly scanId: string;
  readonly config: object;
}

export class RedisScanQueue {
  private static readonly KEY = 'pally:scan:queue';

  constructor(private readonly redis: RedisInstance) {}

  async enqueue(scanId: string, config: object): Promise<void> {
    const item: QueuedScan = { scanId, config };
    await this.redis.rpush(RedisScanQueue.KEY, JSON.stringify(item));
  }

  async dequeue(): Promise<QueuedScan | null> {
    const item = await this.redis.lpop(RedisScanQueue.KEY);
    return item !== null ? (JSON.parse(item) as QueuedScan) : null;
  }

  async getQueueLength(): Promise<number> {
    return this.redis.llen(RedisScanQueue.KEY);
  }
}

// ── SSE pub/sub ───────────────────────────────────────────────────────────────

export class SsePublisher {
  constructor(private readonly redis: RedisInstance) {}

  async publish(scanId: string, event: object): Promise<void> {
    await this.redis.publish(`pally:sse:${scanId}`, JSON.stringify(event));
  }

  /**
   * Subscribe to SSE events for a scan. Returns an unsubscribe function that
   * closes the dedicated subscriber connection.
   */
  subscribe(scanId: string, callback: (event: object) => void): () => void {
    const sub = this.redis.duplicate();
    const channel = `pally:sse:${scanId}`;

    // duplicate() creates a disconnected copy; connect it now
    sub.subscribe(channel).catch((err: Error) => {
      console.error('[dashboard:redis] subscribe error:', err.message);
    });

    sub.on('message', (_channel: string, msg: string) => {
      try {
        callback(JSON.parse(msg) as object);
      } catch {
        // Malformed message — ignore
      }
    });

    return () => {
      sub.unsubscribe(channel).catch(() => undefined);
      sub.disconnect();
    };
  }
}
