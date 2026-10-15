/**
 * The scan-start limiter that lives next to initiateScanAuthorized (D-90-07).
 *
 * Every limiter here takes an injected clock that the test moves by
 * assignment; nothing sleeps and no timers are driven. Address fixtures are
 * RFC 5737 documentation addresses.
 */
import { describe, it, expect } from 'vitest';
import {
  createScanStartLimiter,
  scanStartKey,
  SCAN_START_LIMIT,
  SCAN_START_WINDOW_MS,
} from '../../src/services/scan-service.js';

const T0 = 1_000_000;

function fakeClock(): { now: () => number; set: (ms: number) => void } {
  let t = T0;
  return { now: () => t, set: (ms: number) => { t = ms; } };
}

describe('scan start limiter', () => {
  it('SCAN-02 rate limit allows 30 starts in ten minutes and refuses the 31st with a retry time', () => {
    expect(SCAN_START_LIMIT).toBe(30);
    expect(SCAN_START_WINDOW_MS).toBe(600_000);
    const clock = fakeClock();
    const limiter = createScanStartLimiter({ now: clock.now });

    for (let i = 0; i < 30; i += 1) {
      expect(limiter.check('user:a')).toEqual({ allowed: true });
      limiter.record('user:a');
    }
    const refused = limiter.check('user:a');
    expect(refused.allowed).toBe(false);
    if (!refused.allowed) {
      expect(refused.retryAfterMs).toBeGreaterThan(0);
      expect(refused.retryAfterMs).toBeLessThanOrEqual(SCAN_START_WINDOW_MS);
    }
  });

  it('SCAN-02 rate limit allows a start again once the oldest start leaves the window', () => {
    const clock = fakeClock();
    const limiter = createScanStartLimiter({ now: clock.now });

    for (let i = 0; i < 30; i += 1) {
      clock.set(T0 + i * 1000);
      expect(limiter.check('user:a').allowed).toBe(true);
      limiter.record('user:a');
    }
    clock.set(T0 + 30 * 1000);
    expect(limiter.check('user:a').allowed).toBe(false);

    // The first start (at T0) is still inside the window one millisecond early.
    clock.set(T0 + SCAN_START_WINDOW_MS - 1);
    expect(limiter.check('user:a').allowed).toBe(false);

    clock.set(T0 + SCAN_START_WINDOW_MS + 1);
    expect(limiter.check('user:a').allowed).toBe(true);
  });

  it('SCAN-02 rate limit keeps one bucket per key', () => {
    const clock = fakeClock();
    const limiter = createScanStartLimiter({ now: clock.now });

    for (let i = 0; i < 30; i += 1) {
      limiter.check('user:a');
      limiter.record('user:a');
    }
    expect(limiter.check('user:a').allowed).toBe(false);
    expect(limiter.check('user:b').allowed).toBe(true);
  });

  it('SCAN-02 rate limit forgets keys idle for a full window', () => {
    // The memory bound, pinned directly: attempts beyond the limit never
    // leave a key holding more than SCAN_START_LIMIT timestamps.
    const boundClock = fakeClock();
    const boundStore = new Map<string, readonly number[]>();
    const bounded = createScanStartLimiter({ now: boundClock.now, store: boundStore });
    for (let i = 0; i < 40; i += 1) {
      bounded.check('user:busy');
      bounded.record('user:busy');
    }
    expect(boundStore.get('user:busy')?.length).toBe(SCAN_START_LIMIT);

    const clock = fakeClock();
    const store = new Map<string, readonly number[]>();
    const limiter = createScanStartLimiter({ now: clock.now, store });
    for (let i = 0; i < 500; i += 1) {
      limiter.check(`user:idle-${i}`);
      limiter.record(`user:idle-${i}`);
    }
    expect(store.size).toBe(500);

    // A check only prunes its own key, so only the sweep can remove the 500.
    clock.set(T0 + SCAN_START_WINDOW_MS + 1);
    limiter.check('user:new');
    limiter.record('user:new');
    expect(store.size).toBe(1);
  });

  it('SCAN-02 rate limit keys a signed in user by user id whatever the address', () => {
    expect(scanStartKey({ userId: 'user-1', apiKeyId: undefined, clientIp: '203.0.113.7' })).toBe('user:user-1');
    expect(scanStartKey({ userId: 'user-1', apiKeyId: undefined, clientIp: '198.51.100.7' })).toBe('user:user-1');
  });

  it('SCAN-02 rate limit keys an api key by its key id and falls back to the caller address', () => {
    expect(scanStartKey({ userId: 'api-key', apiKeyId: 'key-fabrikam', clientIp: '203.0.113.7' })).toBe(
      'api-key:key-fabrikam',
    );
    expect(scanStartKey({ userId: 'api-key', apiKeyId: undefined, clientIp: '203.0.113.7' })).toBe(
      'ip:203.0.113.7',
    );
    expect(scanStartKey({ userId: undefined, apiKeyId: undefined, clientIp: '203.0.113.7' })).toBe(
      'ip:203.0.113.7',
    );
    expect(scanStartKey({ userId: undefined, apiKeyId: undefined, clientIp: undefined })).toBe('ip:unknown');
  });
});
