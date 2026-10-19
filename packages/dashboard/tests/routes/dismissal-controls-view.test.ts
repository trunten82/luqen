/**
 * Phase 89 Plan 04 — GET /reports/:id supplies dismissalControls only to a viewer the mark
 * API would accept (D-01, recorded deviation: route-computed, not a global perm flag).
 *
 * The gate is `issues.dismiss` AND `reports.view_technical` AND mayTouchDismissalOrg(user,
 * scan.orgId). The report page itself lets org users onto 'system' scans; the mark route does not,
 * so the control must not render there. The controls carry the finding's raw selector, so a viewer
 * without technical-details access gets none (HARD-02). The JSON view stub returns the view data
 * the handler passed to reply.view.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { reportRoutes } from '../../src/routes/reports.js';
import {
  openStore,
  seedOrg,
  seedScan,
  type HarnessUser,
  type Store,
} from '../helpers/issue-dismissal-route-harness.js';
import {
  DISMISSAL_COMMENT_MAX_LENGTH,
  DISMISSAL_REASON_MAX_LENGTH,
} from '../../src/services/issue-dismissals/validate-input.js';

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

async function reportPage(
  user: HarnessUser,
  permissions: readonly string[],
  scanId: string,
): Promise<{ status: number; data: Record<string, unknown> }> {
  server = Fastify({ logger: false });
  server.decorateReply('view', function (this: FastifyReply, template: string, data: unknown) {
    return this.code(200).header('content-type', 'application/json').send(JSON.stringify({ template, data }));
  });
  server.addHook('preHandler', async (request) => {
    request.user = {
      id: user.id ?? 'u-tester',
      username: user.username ?? 'tester',
      role: user.role,
      ...(user.currentOrgId !== undefined ? { currentOrgId: user.currentOrgId } : {}),
    } as never;
    (request as unknown as { permissions: Set<string> }).permissions = new Set(permissions);
  });
  await reportRoutes(server, store.storage, () => null);
  await server.ready();
  const res = await server.inject({ method: 'GET', url: `/reports/${scanId}` });
  const body = res.statusCode === 200 ? (JSON.parse(res.body) as { data: Record<string, unknown> }) : { data: {} };
  return { status: res.statusCode, data: body.data };
}

const VIEW = ['reports.view'];
const VIEW_AND_DISMISS = ['reports.view', 'reports.view_technical', 'issues.dismiss'];
const DISMISS_WITHOUT_TECHNICAL = ['reports.view', 'issues.dismiss'];

describe('GET /reports/:id — dismissalControls', () => {
  it('a permitted global admin gets dismissal controls on the report page', async () => {
    const org = await seedOrg(store.storage, 'org_a');
    const scan = await seedScan(store.storage, { orgId: org });
    const { status, data } = await reportPage({ role: 'admin', currentOrgId: org }, VIEW_AND_DISMISS, scan);
    expect(status).toBe(200);
    expect(data['dismissalControls']).toEqual({
      reasonMax: DISMISSAL_REASON_MAX_LENGTH,
      commentMax: DISMISSAL_COMMENT_MAX_LENGTH,
    });
  });

  it("an org user with the permission on their own org's scan gets dismissal controls", async () => {
    const org = await seedOrg(store.storage, 'org_a');
    const scan = await seedScan(store.storage, { orgId: org });
    const { status, data } = await reportPage({ role: 'user', currentOrgId: org }, VIEW_AND_DISMISS, scan);
    expect(status).toBe(200);
    expect(data['dismissalControls']).toBeDefined();
  });

  it('an org user with the permission on a system scan gets no dismissal controls', async () => {
    const org = await seedOrg(store.storage, 'org_a');
    const scan = await seedScan(store.storage, { orgId: 'system' });
    const { status, data } = await reportPage({ role: 'user', currentOrgId: org }, VIEW_AND_DISMISS, scan);
    // Positive control: the report page itself IS open to this viewer, so the absence below is
    // the dismissal gate and not a refused page.
    expect(status).toBe(200);
    expect(data['reportData']).toBeTruthy();
    expect('dismissalControls' in data).toBe(false);
  });

  it('a viewer without issues.dismiss gets no dismissal controls key at all', async () => {
    const org = await seedOrg(store.storage, 'org_a');
    const scan = await seedScan(store.storage, { orgId: org });
    const { status, data } = await reportPage({ role: 'admin', currentOrgId: org }, VIEW, scan);
    expect(status).toBe(200);
    expect(data['reportData']).toBeTruthy();
    expect('dismissalControls' in data).toBe(false);
  });

  it('HARD-02 dismiss controls need technical details permission', async () => {
    const org = await seedOrg(store.storage, 'org_a');
    const scan = await seedScan(store.storage, { orgId: org });
    const without = await reportPage({ role: 'user', currentOrgId: org }, DISMISS_WITHOUT_TECHNICAL, scan);
    // Positive control: the page itself is open to this viewer, so the absence is the gate.
    expect(without.status).toBe(200);
    expect(without.data['reportData']).toBeTruthy();
    expect('dismissalControls' in without.data).toBe(false);
    await server!.close();
    server = undefined;

    const withBoth = await reportPage({ role: 'user', currentOrgId: org }, VIEW_AND_DISMISS, scan);
    expect(withBoth.status).toBe(200);
    expect(withBoth.data['dismissalControls']).toBeDefined();
  });

  it('a viewer with no current org on a system scan gets no dismissal controls', async () => {
    const scan = await seedScan(store.storage, { orgId: 'system' });
    const { status, data } = await reportPage({ role: 'user' }, VIEW_AND_DISMISS, scan);
    expect(status).toBe(200);
    expect(data['reportData']).toBeTruthy();
    expect('dismissalControls' in data).toBe(false);
  });
});
