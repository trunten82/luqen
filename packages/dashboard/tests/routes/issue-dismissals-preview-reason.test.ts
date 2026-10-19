/**
 * HARD-01: the dismissal preview names WHY a selector is refused, so the dialog can say it.
 * Plain Fastify + real SQLite through the shared route harness; the report is never loaded for a
 * refused selector.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { CODE, openStore, buildRouteServer, seedOrg, seedScan, type Store } from '../helpers/issue-dismissal-route-harness.js';
import { DISMISSAL_SELECTOR_MAX_LENGTH } from '../../src/services/issue-dismissals/validate-input.js';

let store: Store;
let server: FastifyInstance | undefined;

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
});
