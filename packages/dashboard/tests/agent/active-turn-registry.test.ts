/**
 * Phase 43 Plan 02 — ActiveTurnRegistry unit tests.
 *
 * Covers the small but load-bearing surface used by the cancel route:
 *   - register returns a fresh controller
 *   - cancel aborts the controller signal and returns true
 *   - cancel on an unknown id is a no-op false (idempotent / safe)
 *   - double-cancel is idempotent (second call returns false)
 *   - cleanup evicts the entry without aborting (natural-completion path)
 *   - isActive is a faithful probe of presence
 *   - register on an already-active id aborts the prior controller
 *     (race: new SSE arrives before old one's finally fires)
 */

import { describe, it, expect } from 'vitest';
import { ActiveTurnRegistry } from '../../src/agent/active-turn-registry.js';

describe('ActiveTurnRegistry', () => {
  it('register returns a fresh AbortController and marks the id active', () => {
    const reg = new ActiveTurnRegistry();
    const ctrl = reg.register('conv-1');
    expect(ctrl).toBeInstanceOf(AbortController);
    expect(ctrl.signal.aborted).toBe(false);
    expect(reg.isActive('conv-1')).toBe(true);
  });

  it('cancel aborts the registered signal and returns true', () => {
    const reg = new ActiveTurnRegistry();
    const ctrl = reg.register('conv-1');
    const result = reg.cancel('conv-1');
    expect(result).toBe(true);
    expect(ctrl.signal.aborted).toBe(true);
    expect(reg.isActive('conv-1')).toBe(false);
  });

  it('cancel on an unknown id returns false and does not throw', () => {
    const reg = new ActiveTurnRegistry();
    expect(reg.cancel('never-registered')).toBe(false);
  });

  it('double-cancel is idempotent — second call returns false', () => {
    const reg = new ActiveTurnRegistry();
    reg.register('conv-1');
    expect(reg.cancel('conv-1')).toBe(true);
    expect(reg.cancel('conv-1')).toBe(false);
  });

  it('cleanup evicts the entry without aborting the controller', () => {
    const reg = new ActiveTurnRegistry();
    const ctrl = reg.register('conv-1');
    reg.cleanup('conv-1');
    expect(reg.isActive('conv-1')).toBe(false);
    // Natural-completion path: signal must remain unaborted so any post-
    // runTurn cleanup that observes the signal does not mis-classify
    // a successful run as cancelled.
    expect(ctrl.signal.aborted).toBe(false);
  });

  it('cleanup on an unknown id is a no-op (no throw)', () => {
    const reg = new ActiveTurnRegistry();
    expect(() => reg.cleanup('never-registered')).not.toThrow();
  });

  it('isActive returns false for unknown ids', () => {
    const reg = new ActiveTurnRegistry();
    expect(reg.isActive('never-registered')).toBe(false);
  });

  it('re-register on an already-active id aborts the prior controller', () => {
    const reg = new ActiveTurnRegistry();
    const first = reg.register('conv-1');
    const second = reg.register('conv-1');
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
    expect(second).not.toBe(first);
    expect(reg.isActive('conv-1')).toBe(true);
  });

  it('separate ids are independent', () => {
    const reg = new ActiveTurnRegistry();
    const a = reg.register('conv-a');
    const b = reg.register('conv-b');
    expect(reg.cancel('conv-a')).toBe(true);
    expect(a.signal.aborted).toBe(true);
    expect(b.signal.aborted).toBe(false);
    expect(reg.isActive('conv-b')).toBe(true);
  });
});
