/**
 * HARD-14 (report page half) — GET /reports/:id supplies scanControls only to a viewer the
 * retry and cancel routes would accept: scans.create AND the scan-control organization
 * predicate (a global admin on any scan, an org user on their own org's scan, no 'system'
 * exception). The JSON view stub returns the view data the handler passed to reply.view.
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
      ...(user.orgScopedApiKey === true ? { orgScopedApiKey: true } : {}),
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
const VIEW_AND_CREATE = ['reports.view', 'scans.create'];

describe('GET /reports/:id — scanControls', () => {
  it('HARD-14 report page offers retry and cancel only to a viewer who may control the scan', async () => {
    const orgA = await seedOrg(store.storage, 'org_a');
    const orgB = await seedOrg(store.storage, 'org_b');
    const ownScan = await seedScan(store.storage, { orgId: orgA });
    const systemScan = await seedScan(store.storage, { orgId: 'system' });

    // Offered: a global admin on a scan of another org, and an org user on their own org's scan.
    const admin = await reportPage({ role: 'admin', currentOrgId: orgB }, VIEW_AND_CREATE, ownScan);
    expect(admin.status).toBe(200);
    expect(admin.data['scanControls']).toBeTruthy();
    const member = await reportPage({ role: 'user', currentOrgId: orgA }, VIEW_AND_CREATE, ownScan);
    expect(member.status).toBe(200);
    expect(member.data['scanControls']).toBeTruthy();

    // Not offered, each with the page itself open to the viewer (positive control: reportData).
    const onSystem = await reportPage({ role: 'user', currentOrgId: orgA }, VIEW_AND_CREATE, systemScan);
    expect(onSystem.status).toBe(200);
    expect(onSystem.data['reportData']).toBeTruthy();
    expect('scanControls' in onSystem.data).toBe(false);

    const noPermission = await reportPage({ role: 'user', currentOrgId: orgA }, VIEW, ownScan);
    expect(noPermission.status).toBe(200);
    expect(noPermission.data['reportData']).toBeTruthy();
    expect('scanControls' in noPermission.data).toBe(false);

    // An org-scoped admin key is contained to its own org: offered there. On another org's scan the
    // page itself is refused (404), so there is no page to carry a control.
    const keyOwnOrg = await reportPage(
      { role: 'admin', orgScopedApiKey: true, currentOrgId: orgA },
      VIEW_AND_CREATE,
      ownScan,
    );
    expect(keyOwnOrg.status).toBe(200);
    expect(keyOwnOrg.data['scanControls']).toBeTruthy();
    const keyOtherOrg = await reportPage(
      { role: 'admin', orgScopedApiKey: true, currentOrgId: orgB },
      VIEW_AND_CREATE,
      ownScan,
    );
    expect(keyOtherOrg.status).toBe(404);
  });
});
