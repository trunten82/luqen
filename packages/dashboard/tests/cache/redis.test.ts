import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRedisClient, RedisScanQueue, SsePublisher } from '../../src/cache/redis.js';

// ── Mock ioredis ──────────────────────────────────────────────────────────────

vi.mock('ioredis', () => {
  function MockRedis(this: Record<string, unknown>) {
    Object.assign(this, mockRedisInstance);
  }
  return { default: MockRedis, Redis: MockRedis };
});

const mockRedisInstance = {
  rpush: vi.fn(),
  lpop: vi.fn(),
  llen: vi.fn(),
  publish: vi.fn(),
  subscribe: vi.fn(),
  on: vi.fn(),
  unsubscribe: vi.fn(),
  disconnect: vi.fn(),
  duplicate: vi.fn(),
};

// ── createRedisClient ─────────────────────────────────────────────────────────

describe('createRedisClient', () => {
  it('returns null when no URL is provided', () => {
    expect(createRedisClient(undefined)).toBeNull();
  });

  it('returns null when URL is empty string', () => {
    expect(createRedisClient('')).toBeNull();
  });

  it('returns a Redis instance when URL is provided', () => {
    const client = createRedisClient('redis://localhost:6379');
    expect(client).not.toBeNull();
  });
});

// ── RedisScanQueue ────────────────────────────────────────────────────────────

function makeMockRedis() {
  return {
    rpush: vi.fn<() => Promise<number>>(),
    lpop: vi.fn<() => Promise<string | null>>(),
    llen: vi.fn<() => Promise<number>>(),
    publish: vi.fn<() => Promise<number>>(),
    subscribe: vi.fn<() => Promise<void>>(),
    on: vi.fn(),
    unsubscribe: vi.fn<() => Promise<void>>(),
    disconnect: vi.fn(),
    duplicate: vi.fn(),
  };
}

describe('RedisScanQueue', () => {
  let mockRedis: ReturnType<typeof makeMockRedis>;
  let queue: RedisScanQueue;

  beforeEach(() => {
    mockRedis = makeMockRedis();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    queue = new RedisScanQueue(mockRedis as any);
  });

  describe('enqueue', () => {
    it('pushes serialised item to the right end of the list', async () => {
      mockRedis.rpush.mockResolvedValue(1);
      await queue.enqueue('scan-1', { siteUrl: 'https://example.com' });
      expect(mockRedis.rpush).toHaveBeenCalledWith(
        'pally:scan:queue',
        JSON.stringify({ scanId: 'scan-1', config: { siteUrl: 'https://example.com' } }),
      );
    });
  });

  describe('dequeue', () => {
    it('returns parsed item when queue is not empty', async () => {
      const item = { scanId: 'scan-1', config: { siteUrl: 'https://example.com' } };
      mockRedis.lpop.mockResolvedValue(JSON.stringify(item));
      const result = await queue.dequeue();
      expect(mockRedis.lpop).toHaveBeenCalledWith('pally:scan:queue');
      expect(result).toEqual(item);
    });

    it('returns null when queue is empty', async () => {
      mockRedis.lpop.mockResolvedValue(null);
      const result = await queue.dequeue();
      expect(result).toBeNull();
    });
  });

  describe('getQueueLength', () => {
    it('returns the queue length', async () => {
      mockRedis.llen.mockResolvedValue(5);
      const len = await queue.getQueueLength();
      expect(mockRedis.llen).toHaveBeenCalledWith('pally:scan:queue');
      expect(len).toBe(5);
    });
  });
});

// ── SsePublisher ──────────────────────────────────────────────────────────────

describe('SsePublisher', () => {
  let mockRedis: ReturnType<typeof makeMockRedis>;
  let publisher: SsePublisher;

  beforeEach(() => {
    mockRedis = makeMockRedis();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    publisher = new SsePublisher(mockRedis as any);
  });

  describe('publish', () => {
    it('publishes serialised event to the scan channel', async () => {
      mockRedis.publish.mockResolvedValue(1);
      const event = { type: 'complete', data: {} };
      await publisher.publish('scan-1', event);
      expect(mockRedis.publish).toHaveBeenCalledWith(
        'pally:sse:scan-1',
        JSON.stringify(event),
      );
    });
  });

  describe('subscribe', () => {
    it('creates a duplicate connection and subscribes to the scan channel', () => {
      const mockSub = makeMockRedis();
      mockSub.subscribe.mockResolvedValue(undefined);
      mockRedis.duplicate.mockReturnValue(mockSub);

      publisher.subscribe('scan-1', vi.fn());

      expect(mockRedis.duplicate).toHaveBeenCalled();
      expect(mockSub.subscribe).toHaveBeenCalledWith('pally:sse:scan-1');
    });

    it('calls the callback with parsed event on message', () => {
      const mockSub = {
        ...makeMockRedis(),
        _messageHandler: null as ((channel: string, msg: string) => void) | null,
      };
      mockSub.subscribe.mockResolvedValue(undefined);
      mockSub.on.mockImplementation((event: string, handler: (channel: string, msg: string) => void) => {
        if (event === 'message') {
          mockSub._messageHandler = handler;
        }
      });
      mockRedis.duplicate.mockReturnValue(mockSub);

      const callback = vi.fn();
      publisher.subscribe('scan-1', callback);

      const event = { type: 'scan_complete', data: {} };
      mockSub._messageHandler?.('pally:sse:scan-1', JSON.stringify(event));

      expect(callback).toHaveBeenCalledWith(event);
    });

    it('returns an unsubscribe function that disconnects', () => {
      const mockSub = makeMockRedis();
      mockSub.subscribe.mockResolvedValue(undefined);
      mockSub.unsubscribe.mockResolvedValue(undefined);
      mockRedis.duplicate.mockReturnValue(mockSub);

      const unsubscribe = publisher.subscribe('scan-1', vi.fn());
      unsubscribe();

      expect(mockSub.unsubscribe).toHaveBeenCalledWith('pally:sse:scan-1');
      expect(mockSub.disconnect).toHaveBeenCalled();
    });
  });
});
