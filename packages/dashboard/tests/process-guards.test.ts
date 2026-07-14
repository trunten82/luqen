/**
 * Regression: an unhandled ProtocolError from pa11y/puppeteer's request
 * interception crashed the whole dashboard process (live outage 2026-07-13,
 * `Fetch.continueRequest: Invalid header: cookie age-gate-ok=…`). The serve
 * entry must install an unhandledRejection handler that logs and keeps the
 * service alive instead of letting Node exit.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  makeUnhandledRejectionHandler,
  registerProcessGuards,
} from '../src/process-guards.js';

describe('process guards', () => {
  it('handler logs the rejection reason and does not throw', () => {
    const log = { error: vi.fn() };
    const handler = makeUnhandledRejectionHandler(log);

    const reason = new Error('ProtocolError: Fetch.continueRequest: Invalid header');
    expect(() => handler(reason)).not.toThrow();

    expect(log.error).toHaveBeenCalledTimes(1);
    const [obj, msg] = log.error.mock.calls[0];
    expect(obj).toEqual({ err: reason });
    expect(String(msg)).toContain('kept alive');
  });

  it('registerProcessGuards installs the handler on unhandledRejection', () => {
    const log = { error: vi.fn() };
    const handler = registerProcessGuards(log);
    try {
      expect(process.listeners('unhandledRejection')).toContain(handler);
    } finally {
      process.removeListener('unhandledRejection', handler);
    }
  });

  it('serve entry wires the guard (source check)', async () => {
    const { readFileSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const cli = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../src/cli.ts'),
      'utf-8',
    );
    expect(cli).toContain('registerProcessGuards');
  });
});
