import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ComplianceCache, createRedisClient } from '../../src/cache/redis.js';

// ── Mock ioredis ──────────────────────────────────────────────────────────────

vi.mock('ioredis', () => {
  function MockRedis(this: Record<string, unknown>) {
    this.get = vi.fn();
    this.setex = vi.fn();
    this.keys = vi.fn();
    this.del = vi.fn();
    this.on = vi.fn();
  }
  return { default: MockRedis, Redis: MockRedis };
});

// ── createRedisClient ─────────────────────────────────────────────────────────

describe('createRedisClient', () => {
  it('returns null when no URL is provided', () => {
    const client = createRedisClient(undefined);
    expect(client).toBeNull();
  });

  it('returns null when URL is empty string', () => {
    const client = createRedisClient('');
    expect(client).toBeNull();
  });

  it('returns a Redis instance when URL is provided', () => {
    const client = createRedisClient('redis://localhost:6379');
    expect(client).not.toBeNull();
  });
});

// ── ComplianceCache ───────────────────────────────────────────────────────────

function makeMockRedis() {
  return {
    get: vi.fn<() => Promise<string | null>>(),
    setex: vi.fn<() => Promise<'OK'>>(),
    keys: vi.fn<() => Promise<string[]>>(),
    del: vi.fn<() => Promise<number>>(),
    on: vi.fn(),
  };
}

describe('ComplianceCache', () => {
  let mockRedis: ReturnType<typeof makeMockRedis>;
  let cache: ComplianceCache;

  beforeEach(() => {
    mockRedis = makeMockRedis();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cache = new ComplianceCache(mockRedis as any);
  });

  describe('getCachedCheck', () => {
    it('returns cached value when key exists', async () => {
      mockRedis.get.mockResolvedValue('{"result":"ok"}');
      const result = await cache.getCachedCheck('abc123');
      expect(mockRedis.get).toHaveBeenCalledWith('compliance:check:abc123');
      expect(result).toBe('{"result":"ok"}');
    });

    it('returns null when key does not exist', async () => {
      mockRedis.get.mockResolvedValue(null);
      const result = await cache.getCachedCheck('missing');
      expect(result).toBeNull();
    });

    it('returns null and swallows error on Redis failure', async () => {
      mockRedis.get.mockRejectedValue(new Error('connection refused'));
      const result = await cache.getCachedCheck('bad');
      expect(result).toBeNull();
    });
  });

  describe('setCachedCheck', () => {
    it('calls setex with correct key, ttl, and value', async () => {
      mockRedis.setex.mockResolvedValue('OK');
      await cache.setCachedCheck('abc123', '{"result":"ok"}');
      expect(mockRedis.setex).toHaveBeenCalledWith(
        'compliance:check:abc123',
        300,
        '{"result":"ok"}',
      );
    });

    it('respects custom ttl', async () => {
      mockRedis.setex.mockResolvedValue('OK');
      await cache.setCachedCheck('key', 'value', 60);
      expect(mockRedis.setex).toHaveBeenCalledWith('compliance:check:key', 60, 'value');
    });

    it('swallows error on Redis failure (non-fatal)', async () => {
      mockRedis.setex.mockRejectedValue(new Error('timeout'));
      // Should not throw
      await expect(cache.setCachedCheck('key', 'value')).resolves.toBeUndefined();
    });
  });

  describe('invalidate', () => {
    it('deletes all keys matching the pattern', async () => {
      mockRedis.keys.mockResolvedValue(['compliance:check:a', 'compliance:check:b']);
      mockRedis.del.mockResolvedValue(2);
      await cache.invalidate('check:*');
      expect(mockRedis.keys).toHaveBeenCalledWith('compliance:check:*');
      expect(mockRedis.del).toHaveBeenCalledWith('compliance:check:a', 'compliance:check:b');
    });

    it('does not call del when no keys match', async () => {
      mockRedis.keys.mockResolvedValue([]);
      await cache.invalidate('check:*');
      expect(mockRedis.del).not.toHaveBeenCalled();
    });

    it('swallows error on Redis failure (non-fatal)', async () => {
      mockRedis.keys.mockRejectedValue(new Error('timeout'));
      await expect(cache.invalidate('*')).resolves.toBeUndefined();
    });
  });
});
