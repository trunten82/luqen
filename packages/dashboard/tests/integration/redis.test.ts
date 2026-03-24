import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { Redis } from 'ioredis';
import { createRedisClient, RedisScanQueue, SsePublisher } from '../../src/cache/redis.js';

const REDIS_URL = process.env['TEST_REDIS_URL'] ?? 'redis://localhost:6379';
const QUEUE_KEY = 'luqen:scan:queue';

describe('Redis integration', () => {
  let redis: InstanceType<typeof Redis>;
  let skipTests = false;

  beforeAll(async () => {
    try {
      redis = createRedisClient(REDIS_URL) as InstanceType<typeof Redis>;
      await redis.connect();
      await redis.ping();
    } catch {
      skipTests = true;
    }
  });

  afterEach(async () => {
    if (!skipTests) {
      await redis.del(QUEUE_KEY);
    }
  });

  afterAll(async () => {
    if (!skipTests) {
      await redis.del(QUEUE_KEY);
      await redis.disconnect();
    }
  });

  // ── createRedisClient ───────────────────────────────────────────────────

  describe('createRedisClient', () => {
    it('returns null when no URL provided', ({ skip }) => {
      if (skipTests) skip();
      expect(createRedisClient()).toBeNull();
      expect(createRedisClient(undefined)).toBeNull();
    });

    it('connects to real Redis with valid URL', async ({ skip }) => {
      if (skipTests) skip();
      const client = createRedisClient(REDIS_URL) as InstanceType<typeof Redis>;
      await client.connect();
      const pong = await client.ping();
      expect(pong).toBe('PONG');
      await client.disconnect();
    });

    it('fails to connect with wrong port', async ({ skip }) => {
      if (skipTests) skip();
      const redisUrl = new URL(REDIS_URL);
      const badClient = createRedisClient(
        `redis://${redisUrl.hostname}:59999`,
      ) as InstanceType<typeof Redis>;

      await expect(badClient.connect()).rejects.toThrow();
      try { await badClient.disconnect(); } catch { /* ignore */ }
    });
  });

  // ── RedisScanQueue ──────────────────────────────────────────────────────

  describe('RedisScanQueue', () => {
    it('enqueues and dequeues a single item', async ({ skip }) => {
      if (skipTests) skip();
      const queue = new RedisScanQueue(redis);
      await queue.enqueue('scan-1', { url: 'https://example.com' });

      const length = await queue.getQueueLength();
      expect(length).toBe(1);

      const item = await queue.dequeue();
      expect(item).toEqual({
        scanId: 'scan-1',
        config: { url: 'https://example.com' },
      });
    });

    it('returns null when queue is empty', async ({ skip }) => {
      if (skipTests) skip();
      const queue = new RedisScanQueue(redis);
      const item = await queue.dequeue();
      expect(item).toBeNull();
    });

    it('getQueueLength returns 0 for empty queue', async ({ skip }) => {
      if (skipTests) skip();
      const queue = new RedisScanQueue(redis);
      const length = await queue.getQueueLength();
      expect(length).toBe(0);
    });

    it('enqueues 3 items and dequeues in FIFO order', async ({ skip }) => {
      if (skipTests) skip();
      const queue = new RedisScanQueue(redis);

      await queue.enqueue('scan-a', { page: 1 });
      await queue.enqueue('scan-b', { page: 2 });
      await queue.enqueue('scan-c', { page: 3 });

      expect(await queue.getQueueLength()).toBe(3);

      const first = await queue.dequeue();
      expect(first?.scanId).toBe('scan-a');

      const second = await queue.dequeue();
      expect(second?.scanId).toBe('scan-b');

      const third = await queue.dequeue();
      expect(third?.scanId).toBe('scan-c');

      expect(await queue.getQueueLength()).toBe(0);
    });
  });

  // ── SsePublisher ────────────────────────────────────────────────────────
  //
  // SsePublisher.subscribe calls redis.duplicate() which inherits options
  // from the parent. We need a client WITHOUT lazyConnect/enableOfflineQueue
  // so the duplicated subscriber can auto-connect and queue commands.

  describe('SsePublisher', () => {
    let pubSubRedis: InstanceType<typeof Redis>;

    beforeAll(async () => {
      if (skipTests) return;
      pubSubRedis = new Redis(REDIS_URL);
      await pubSubRedis.ping();
    });

    afterAll(async () => {
      if (skipTests || !pubSubRedis) return;
      await pubSubRedis.disconnect();
    });

    it('publishes and receives messages via pub/sub', async ({ skip }) => {
      if (skipTests) skip();
      const publisher = new SsePublisher(pubSubRedis);
      const scanId = 'test-sse-' + Date.now();
      const received: object[] = [];

      const unsubscribe = publisher.subscribe(scanId, (event) => {
        received.push(event);
      });

      // Give the subscriber time to connect and subscribe
      await new Promise((r) => setTimeout(r, 500));

      await publisher.publish(scanId, { progress: 50 });
      await publisher.publish(scanId, { progress: 100, done: true });

      // Give messages time to arrive
      await new Promise((r) => setTimeout(r, 500));

      expect(received).toHaveLength(2);
      expect(received[0]).toEqual({ progress: 50 });
      expect(received[1]).toEqual({ progress: 100, done: true });

      unsubscribe();
    });

    it('unsubscribe stops receiving messages', async ({ skip }) => {
      if (skipTests) skip();
      const publisher = new SsePublisher(pubSubRedis);
      const scanId = 'test-unsub-' + Date.now();
      const received: object[] = [];

      const unsubscribe = publisher.subscribe(scanId, (event) => {
        received.push(event);
      });

      await new Promise((r) => setTimeout(r, 500));

      await publisher.publish(scanId, { msg: 'before' });
      await new Promise((r) => setTimeout(r, 300));

      unsubscribe();
      await new Promise((r) => setTimeout(r, 200));

      await publisher.publish(scanId, { msg: 'after' });
      await new Promise((r) => setTimeout(r, 300));

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({ msg: 'before' });
    });
  });
});
