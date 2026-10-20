import { describe, it, expect } from 'vitest';
import { createEndedSessionRecord } from '../../src/auth/ended-session-record.js';

describe('ended session record', () => {
  it('HARD-21 the ended session record keeps a bounded number of sessions', () => {
    let clock = 1_000;
    const record = createEndedSessionRecord({ maxKeys: 10_000, ttlMs: 60_000, now: () => clock });

    // 10 001 distinct sessions: the record never holds more than its bound and drops the oldest.
    for (let i = 0; i <= 10_000; i += 1) expect(record.claim(`session-${i}`)).toBe(true);
    expect(record.size).toBeLessThanOrEqual(10_000);
    expect(record.claim('session-10000'), 'the newest key is still held').toBe(false);
    expect(record.claim('session-0'), 'the oldest key was dropped').toBe(true);

    // A key claimed again within the window answers false; after the window it answers true.
    expect(record.claim('session-0'), 'claimed again within the window').toBe(false);
    clock += 60_001;
    expect(record.claim('session-0'), 'claimed after the window').toBe(true);

    // A released key can be claimed again at once.
    expect(record.claim('session-released')).toBe(true);
    record.release('session-released');
    expect(record.claim('session-released')).toBe(true);
  });
});
