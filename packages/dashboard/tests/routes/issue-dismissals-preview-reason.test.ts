/**
 * HARD-01: the dismissal preview names WHY a selector is refused, so the dialog can say it.
 * Plain Fastify + real SQLite through the shared route harness; the report is never loaded for a
 * refused selector.
 */
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { CODE, openStore, buildRouteServer, seedOrg, seedScan, type Store } from '../helpers/issue-dismissal-route-harness.js';
import * as validateInput from '../../src/services/issue-dismissals/validate-input.js';
import {
  DISMISSAL_PREVIEW_SELECTOR_MAX_LENGTH,
  DISMISSAL_SELECTOR_MAX_LENGTH,
} from '../../src/services/issue-dismissals/validate-input.js';

// The selector classifiers, wrapped so a test can count how often the route asks them (behaviour unchanged).
vi.mock('../../src/services/issue-dismissals/validate-input.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/issue-dismissals/validate-input.js')>();
  return {
    ...actual,
    isWholePageSelector: vi.fn(actual.isWholePageSelector),
    validateDismissalSelector: vi.fn(actual.validateDismissalSelector),
    dismissalRefusalReason: vi.fn(actual.dismissalRefusalReason),
  };
});

/** Calls of the exported selector classifiers since the last reset. */
function classifications(): number {
  return [validateInput.isWholePageSelector, validateInput.validateDismissalSelector, validateInput.dismissalRefusalReason]
    .map((fn) => vi.mocked(fn).mock.calls.length)
    .reduce((a, b) => a + b, 0);
}

function resetClassifications(): void {
  for (const fn of [validateInput.isWholePageSelector, validateInput.validateDismissalSelector, validateInput.dismissalRefusalReason]) {
    vi.mocked(fn).mockClear();
  }
}

let store: Store;
let server: FastifyInstance | undefined;

/** Listens on a free loopback port: the request goes through Node's HTTP parser, as in production. */
async function listening(target: FastifyInstance): Promise<number> {
  await target.listen({ host: '127.0.0.1', port: 0 });
  return (target.server.address() as AddressInfo).port;
}

/** A GET over a real connection; resolves with the status and the body text. */
function getOverSocket(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        body += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

beforeEach(async () => {
  store = await openStore();
});

afterEach(async () => {
  if (server !== undefined) {
    await server.close();
    server = undefined;
  }
  await store.cleanup();
});

describe('preview refusal reason', () => {
  it('HARD-01 the preview names an over long selector as its own reason', async () => {
    const org = await seedOrg(store.storage, 'org_a');
    const scan = await seedScan(store.storage, { orgId: org });
    const spy = vi.spyOn(store.storage.scans, 'getReport');
    server = await buildRouteServer(store.storage, {
      user: { role: 'user', currentOrgId: org },
      permissions: ['issues.dismiss', 'reports.view'],
    });
    const ask = (selector: string) =>
      server!.inject({ method: 'GET', url: `/api/v1/scans/${scan}/dismissals/preview`, query: { code: CODE, selector } });

    const overLong = `#${'a'.repeat(DISMISSAL_SELECTOR_MAX_LENGTH)}`;
    expect(overLong).toHaveLength(DISMISSAL_SELECTOR_MAX_LENGTH + 1);
    const long = await ask(overLong);
    expect(long.statusCode).toBe(200);
    expect(long.json()).toEqual({ occurrences: 0, pages: 0, refused: true, reason: 'selector-too-long' });

    const whole = await ask('html');
    expect(whole.statusCode).toBe(200);
    expect(whole.json()).toEqual({ occurrences: 0, pages: 0, refused: true, reason: 'selector' });

    // Control: the same selector shape at the limit is not refused.
    const atLimit = await ask(overLong.slice(0, DISMISSAL_SELECTOR_MAX_LENGTH));
    expect(atLimit.statusCode).toBe(200);
    expect(atLimit.json().refused).toBeUndefined();
    // Only the control loaded the report: a refused selector is answered before it.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('HARD-01 the preview answers 400 for a selector over the request bound', async () => {
    const org = await seedOrg(store.storage, 'org_a');
    const scan = await seedScan(store.storage, { orgId: org });
    const spy = vi.spyOn(store.storage.scans, 'getReport');
    server = await buildRouteServer(store.storage, {
      user: { role: 'user', currentOrgId: org },
      permissions: ['issues.dismiss', 'reports.view'],
    });
    const ask = (selector: string) =>
      server!.inject({ method: 'GET', url: `/api/v1/scans/${scan}/dismissals/preview`, query: { code: CODE, selector } });

    const overBound = `#${'a'.repeat(DISMISSAL_PREVIEW_SELECTOR_MAX_LENGTH)}`;
    expect(overBound).toHaveLength(DISMISSAL_PREVIEW_SELECTOR_MAX_LENGTH + 1);
    expect((await ask(overBound)).statusCode).toBe(400);
    // Control: at the bound the selector is answered as refused for its length.
    const atBound = await ask(overBound.slice(0, DISMISSAL_PREVIEW_SELECTOR_MAX_LENGTH));
    expect(atBound.statusCode).toBe(200);
    expect(atBound.json()).toEqual({ occurrences: 0, pages: 0, refused: true, reason: 'selector-too-long' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('HARD-01 over a real connection a selector at the request bound is answered and one character over it gets 400', async () => {
    const org = await seedOrg(store.storage, 'org_a');
    const scan = await seedScan(store.storage, { orgId: org });
    const spy = vi.spyOn(store.storage.scans, 'getReport');
    server = await buildRouteServer(store.storage, {
      user: { role: 'user', currentOrgId: org },
      permissions: ['issues.dismiss', 'reports.view'],
    });
    const port = await listening(server);
    const path = (selector: string): string =>
      `/api/v1/scans/${scan}/dismissals/preview?${new URLSearchParams({ code: CODE, selector }).toString()}`;

    // The documented bound is 8192 characters.
    const atBound = `#${'a'.repeat(8191)}`;
    expect(atBound).toHaveLength(8192);
    const answered = await getOverSocket(port, path(atBound));
    expect(answered.status).toBe(200);
    expect(JSON.parse(answered.body)).toEqual({ occurrences: 0, pages: 0, refused: true, reason: 'selector-too-long' });

    const over = await getOverSocket(port, path(`${atBound}a`));
    expect(over.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it('HARD-01 over a real connection a preview url over the header size limit is refused with 431 before validation', async () => {
    const org = await seedOrg(store.storage, 'org_a');
    const scan = await seedScan(store.storage, { orgId: org });
    const spy = vi.spyOn(store.storage.scans, 'getReport');
    server = await buildRouteServer(store.storage, {
      user: { role: 'user', currentOrgId: org },
      permissions: ['issues.dismiss', 'reports.view'],
    });
    const port = await listening(server);
    // Within the bound in characters, but every '>' is three bytes once encoded in the URL.
    const selector = `#a${'>'.repeat(5998)}`;
    expect(selector.length).toBeLessThan(8192);
    const query = new URLSearchParams({ code: CODE, selector }).toString();
    expect(query.length).toBeGreaterThan(16 * 1024);
    const res = await getOverSocket(port, `/api/v1/scans/${scan}/dismissals/preview?${query}`);
    expect(res.status).toBe(431);
    expect(spy).not.toHaveBeenCalled();
  });

  it('HARD-01 the preview classifies a selector once', async () => {
    const org = await seedOrg(store.storage, 'org_a');
    const scan = await seedScan(store.storage, { orgId: org });
    server = await buildRouteServer(store.storage, {
      user: { role: 'user', currentOrgId: org },
      permissions: ['issues.dismiss', 'reports.view'],
    });
    const ask = (selector: string) =>
      server!.inject({ method: 'GET', url: `/api/v1/scans/${scan}/dismissals/preview`, query: { code: CODE, selector } });

    const counts: Record<string, number> = {};
    for (const [label, selector] of [
      ['whole page', 'html'],
      ['over the limit', `#${'a'.repeat(DISMISSAL_SELECTOR_MAX_LENGTH)}`],
      ['accepted', '#hero > p'],
    ] as const) {
      resetClassifications();
      const res = await ask(selector);
      expect(res.statusCode, label).toBe(200);
      counts[label] = classifications();
    }
    expect(counts).toEqual({ 'whole page': 1, 'over the limit': 1, accepted: 1 });
  });
});
