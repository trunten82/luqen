import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import type { DbAdapter } from '../../src/db/adapter.js';
import {
  createWebhookSignature,
  verifyWebhookSignature,
  dispatchWebhook,
} from '../../src/engine/webhooks.js';

describe('webhooks', () => {
  let db: DbAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await db.initialize();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await db.close();
  });

  describe('createWebhookSignature', () => {
    it('returns sha256=<hex> format', () => {
      const sig = createWebhookSignature('hello world', 'secret');
      expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    });

    it('produces consistent signatures for same inputs', () => {
      const sig1 = createWebhookSignature('body', 'secret');
      const sig2 = createWebhookSignature('body', 'secret');
      expect(sig1).toBe(sig2);
    });

    it('produces different signatures for different bodies', () => {
      const sig1 = createWebhookSignature('body1', 'secret');
      const sig2 = createWebhookSignature('body2', 'secret');
      expect(sig1).not.toBe(sig2);
    });

    it('produces different signatures for different secrets', () => {
      const sig1 = createWebhookSignature('body', 'secret1');
      const sig2 = createWebhookSignature('body', 'secret2');
      expect(sig1).not.toBe(sig2);
    });
  });

  describe('verifyWebhookSignature', () => {
    it('returns true for a matching signature', () => {
      const body = JSON.stringify({ event: 'test' });
      const secret = 'my-secret';
      const sig = createWebhookSignature(body, secret);
      expect(verifyWebhookSignature(body, sig, secret)).toBe(true);
    });

    it('returns false for a tampered body', () => {
      const body = JSON.stringify({ event: 'test' });
      const secret = 'my-secret';
      const sig = createWebhookSignature(body, secret);
      expect(verifyWebhookSignature('tampered', sig, secret)).toBe(false);
    });

    it('returns false for wrong secret', () => {
      const body = JSON.stringify({ event: 'test' });
      const sig = createWebhookSignature(body, 'correct-secret');
      expect(verifyWebhookSignature(body, sig, 'wrong-secret')).toBe(false);
    });

    it('returns false for malformed signature', () => {
      expect(verifyWebhookSignature('body', 'invalid', 'secret')).toBe(false);
    });

    it('returns false when signature length does not match', () => {
      // sha256=<wronglength> - starts with sha256= but wrong length
      expect(verifyWebhookSignature('body', 'sha256=abc123', 'secret')).toBe(false);
    });
  });

  describe('dispatchWebhook', () => {
    it('fires POST requests to all active webhooks subscribed to the event', async () => {
      // Create two active webhooks subscribed to 'proposal.created'
      await db.createWebhook({
        url: 'https://example.com/hook1',
        secret: 'secret1',
        events: ['proposal.created', 'proposal.approved'],
      });
      await db.createWebhook({
        url: 'https://example.com/hook2',
        secret: 'secret2',
        events: ['proposal.created'],
      });

      const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal('fetch', mockFetch);

      dispatchWebhook(db, 'proposal.created', { id: '123', summary: 'test' });

      // Allow microtask queue to flush
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockFetch).toHaveBeenCalledTimes(2);
      // Both calls should target the correct URLs
      const urls = mockFetch.mock.calls.map((c: [string, ...unknown[]]) => c[0]);
      expect(urls).toContain('https://example.com/hook1');
      expect(urls).toContain('https://example.com/hook2');
    });

    it('does not dispatch to webhooks not subscribed to the event', async () => {
      await db.createWebhook({
        url: 'https://example.com/hook-other',
        secret: 'secret',
        events: ['proposal.approved'],
      });

      const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal('fetch', mockFetch);

      dispatchWebhook(db, 'proposal.created', { id: '123' });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('includes HMAC signature header in request', async () => {
      await db.createWebhook({
        url: 'https://example.com/hook',
        secret: 'my-secret',
        events: ['test.event'],
      });

      const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal('fetch', mockFetch);

      dispatchWebhook(db, 'test.event', { foo: 'bar' });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [_url, options] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
      expect(options.headers['X-Pally-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
    });

    it('retries on fetch failure', async () => {
      await db.createWebhook({
        url: 'https://retry-server.com/hook',
        secret: 'secret',
        events: ['retry.event'],
      });

      let callCount = 0;
      const mockFetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount < 2) {
          throw new Error('Network error');
        }
        return { ok: true, status: 200 };
      });
      vi.stubGlobal('fetch', mockFetch);

      dispatchWebhook(db, 'retry.event', {});
      // Wait for retries to complete (BASE_DELAY_MS * 2^0 = 250ms + execution)
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(mockFetch.mock.calls.length).toBeGreaterThan(1);
    });

    it('is fire-and-forget — does not block the caller', async () => {
      await db.createWebhook({
        url: 'https://slow-server.com/hook',
        secret: 'secret',
        events: ['slow.event'],
      });

      let fetchCalled = false;
      const mockFetch = vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        fetchCalled = true;
        return { ok: true, status: 200 };
      });
      vi.stubGlobal('fetch', mockFetch);

      const start = Date.now();
      dispatchWebhook(db, 'slow.event', {});
      const elapsed = Date.now() - start;

      // Should return almost immediately (well under 100ms)
      expect(elapsed).toBeLessThan(100);
      expect(fetchCalled).toBe(false);
    });
  });
});
