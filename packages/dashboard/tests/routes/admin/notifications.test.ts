/**
 * Phase 48 Plan 01 — admin notification template routes.
 *
 * Coverage:
 *   - GET /admin/notifications visibility per role (admin.system / admin.org / viewer)
 *   - GET /admin/notifications/:id/edit cross-org → 404, system tpl by org-admin → 403
 *   - PATCH /admin/notifications/:id update flow + audit + cross-org 404
 *   - PATCH validation (subject/body/voice/signature length, blank subject)
 *   - POST /admin/notifications/override creates org clone + audit
 *   - POST /admin/notifications/override duplicate rejected
 *   - DELETE org template OK; DELETE system template forbidden; cross-org 404
 *   - GET /admin/notifications/:id/history returns history list
 *   - Viewer (no admin perms / no compliance.manage) → 403
 */

import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../../src/db/sqlite/index.js';
import { setEncryptionSalt } from '../../../src/plugins/crypto.js';
import { notificationRoutes } from '../../../src/routes/admin/notifications.js';
import { registerSession } from '../../../src/auth/session.js';
import { seedSystemNotificationTemplates } from '../../../src/notifications/seed-templates.js';

type Viewer = 'admin' | 'admin-org-A' | 'admin-org-B' | 'compliance-manager-A' | 'viewer';

interface Fixture {
  readonly server: FastifyInstance;
  readonly storage: SqliteStorageAdapter;
  readonly orgAId: string;
  readonly orgBId: string;
  readonly cleanup: () => Promise<void>;
}

async function buildFixture(viewer: Viewer): Promise<Fixture> {
  setEncryptionSalt(`p48-salt-${randomUUID()}`);
  const dbPath = join(tmpdir(), `notif-routes-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();

  // Seed 12 system templates (4 events x 3 channels)
  await seedSystemNotificationTemplates(storage.notificationTemplates);

  const orgA = await storage.organizations.createOrg({ name: 'OrgA', slug: `a-${randomUUID()}` });
  const orgB = await storage.organizations.createOrg({ name: 'OrgB', slug: `b-${randomUUID()}` });

  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));
  await registerSession(server, 'test-session-secret-at-least-32b');

  server.decorateReply('view', function (this: FastifyReply, template: string, data: unknown) {
    return this.code(200)
      .header('content-type', 'application/json')
      .send(JSON.stringify({ template, data }));
  });

  server.addHook('preHandler', async (request) => {
    const setPerms = (perms: string[]): void => {
      (request as unknown as Record<string, unknown>)['permissions'] = new Set(perms);
    };
    if (viewer === 'admin') {
      request.user = { id: 'sysadmin', username: 'sysadmin', role: 'admin', currentOrgId: 'system' };
      setPerms(['admin.system', 'admin.org', 'compliance.manage']);
    } else if (viewer === 'admin-org-A') {
      request.user = { id: 'orga-admin', username: 'orga-admin', role: 'user', currentOrgId: orgA.id };
      setPerms(['admin.org']);
    } else if (viewer === 'admin-org-B') {
      request.user = { id: 'orgb-admin', username: 'orgb-admin', role: 'user', currentOrgId: orgB.id };
      setPerms(['admin.org']);
    } else if (viewer === 'compliance-manager-A') {
      request.user = { id: 'cm-a', username: 'cm-a', role: 'user', currentOrgId: orgA.id };
      setPerms(['compliance.manage']);
    } else {
      request.user = { id: 'viewer', username: 'viewer', role: 'viewer', currentOrgId: orgA.id };
      setPerms(['compliance.view']);
    }
  });

  await notificationRoutes(server, storage);
  await server.ready();

  const cleanup = async (): Promise<void> => {
    await server.close();
    await storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
  };

  return { server, storage, orgAId: orgA.id, orgBId: orgB.id, cleanup };
}

async function findSystemEmailScanComplete(storage: SqliteStorageAdapter): Promise<{ id: string }> {
  const list = await storage.notificationTemplates.list({
    eventType: 'scan.complete',
    channel: 'email',
    scope: 'system',
  });
  if (list.length === 0) throw new Error('seed missing');
  return { id: list[0]!.id };
}

describe('GET /admin/notifications — visibility & gating', () => {
  let fx: Fixture;
  afterEach(async () => fx?.cleanup());

  it('viewer (no admin/compliance.manage perms) → 403', async () => {
    fx = await buildFixture('viewer');
    const res = await fx.server.inject({ method: 'GET', url: '/admin/notifications' });
    expect(res.statusCode).toBe(403);
  });

  it('admin sees system templates by default channel (email)', async () => {
    fx = await buildFixture('admin');
    const res = await fx.server.inject({ method: 'GET', url: '/admin/notifications' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { systemTemplates: unknown[]; orgTemplates: unknown[]; canEditSystem: boolean } };
    expect(body.data.systemTemplates.length).toBe(4); // 4 events for email
    expect(body.data.canEditSystem).toBe(true);
  });

  it('admin-org-A sees system templates but no other-org templates', async () => {
    fx = await buildFixture('admin-org-A');
    // Pre-create an org-B override
    const sys = await findSystemEmailScanComplete(fx.storage);
    const sysTpl = await fx.storage.notificationTemplates.getById(sys.id);
    await fx.storage.notificationTemplates.create({
      eventType: 'scan.complete',
      channel: 'email',
      scope: 'org',
      orgId: fx.orgBId,
      subjectTemplate: sysTpl!.subjectTemplate,
      bodyTemplate: sysTpl!.bodyTemplate,
      llmEnabled: false,
    });
    const res = await fx.server.inject({ method: 'GET', url: '/admin/notifications' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { systemTemplates: Array<{ scope: string }>; orgTemplates: Array<{ orgId: string }>; canEditSystem: boolean } };
    expect(body.data.systemTemplates.length).toBe(4);
    expect(body.data.orgTemplates).toEqual([]); // org-B template hidden from org-A
    expect(body.data.canEditSystem).toBe(false);
  });

  it('compliance-manager-A is gated (compliance.manage opens the page)', async () => {
    fx = await buildFixture('compliance-manager-A');
    const res = await fx.server.inject({ method: 'GET', url: '/admin/notifications?channel=slack' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { channel: string } };
    expect(body.data.channel).toBe('slack');
  });
});

describe('GET /admin/notifications/:id/edit — RBAC', () => {
  let fx: Fixture;
  afterEach(async () => fx?.cleanup());

  it('admin can edit a system template', async () => {
    fx = await buildFixture('admin');
    const sys = await findSystemEmailScanComplete(fx.storage);
    const res = await fx.server.inject({ method: 'GET', url: `/admin/notifications/${sys.id}/edit` });
    expect(res.statusCode).toBe(200);
  });

  it('org-admin gets 403 on system template edit', async () => {
    fx = await buildFixture('admin-org-A');
    const sys = await findSystemEmailScanComplete(fx.storage);
    const res = await fx.server.inject({ method: 'GET', url: `/admin/notifications/${sys.id}/edit` });
    expect(res.statusCode).toBe(403);
  });

  it('cross-org edit returns 404 (no leak)', async () => {
    fx = await buildFixture('admin-org-A');
    const sys = await findSystemEmailScanComplete(fx.storage);
    const sysTpl = await fx.storage.notificationTemplates.getById(sys.id);
    const orgB = await fx.storage.notificationTemplates.create({
      eventType: 'scan.complete',
      channel: 'email',
      scope: 'org',
      orgId: fx.orgBId,
      subjectTemplate: sysTpl!.subjectTemplate,
      bodyTemplate: sysTpl!.bodyTemplate,
      llmEnabled: false,
    });
    const res = await fx.server.inject({ method: 'GET', url: `/admin/notifications/${orgB.id}/edit` });
    expect(res.statusCode).toBe(404);
  });

  it('unknown template id → 404', async () => {
    fx = await buildFixture('admin');
    const res = await fx.server.inject({ method: 'GET', url: `/admin/notifications/${randomUUID()}/edit` });
    expect(res.statusCode).toBe(404);
  });
});

describe('PATCH /admin/notifications/:id', () => {
  let fx: Fixture;
  afterEach(async () => fx?.cleanup());

  it('admin updates system template; audit row written', async () => {
    fx = await buildFixture('admin');
    const sys = await findSystemEmailScanComplete(fx.storage);
    const res = await fx.server.inject({
      method: 'PATCH',
      url: `/admin/notifications/${sys.id}`,
      payload: { subjectTemplate: 'New subject', bodyTemplate: 'New body' },
    });
    expect(res.statusCode).toBe(200);
    const after = await fx.storage.notificationTemplates.getById(sys.id);
    expect(after?.subjectTemplate).toBe('New subject');
    expect(after?.version).toBe(2);
    // Audit
    const audit = await fx.storage.audit.query({ action: 'notification.update', limit: 5, offset: 0 });
    expect(audit.entries.length).toBe(1);
    expect(audit.entries[0]!.resourceId).toBe(sys.id);
  });

  it('cross-org PATCH returns 404 and does not mutate', async () => {
    fx = await buildFixture('admin-org-A');
    const sys = await findSystemEmailScanComplete(fx.storage);
    const sysTpl = await fx.storage.notificationTemplates.getById(sys.id);
    const orgB = await fx.storage.notificationTemplates.create({
      eventType: 'scan.complete',
      channel: 'email',
      scope: 'org',
      orgId: fx.orgBId,
      subjectTemplate: sysTpl!.subjectTemplate,
      bodyTemplate: sysTpl!.bodyTemplate,
      llmEnabled: false,
    });
    const res = await fx.server.inject({
      method: 'PATCH',
      url: `/admin/notifications/${orgB.id}`,
      payload: { subjectTemplate: 'leaked' },
    });
    expect(res.statusCode).toBe(404);
    const unchanged = await fx.storage.notificationTemplates.getById(orgB.id);
    expect(unchanged?.subjectTemplate).toBe(sysTpl!.subjectTemplate);
  });

  it('rejects subject longer than 200 chars', async () => {
    fx = await buildFixture('admin');
    const sys = await findSystemEmailScanComplete(fx.storage);
    const res = await fx.server.inject({
      method: 'PATCH',
      url: `/admin/notifications/${sys.id}`,
      payload: { subjectTemplate: 'x'.repeat(201) },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects body longer than 5000 chars', async () => {
    fx = await buildFixture('admin');
    const sys = await findSystemEmailScanComplete(fx.storage);
    const res = await fx.server.inject({
      method: 'PATCH',
      url: `/admin/notifications/${sys.id}`,
      payload: { bodyTemplate: 'b'.repeat(5001) },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects blank subject', async () => {
    fx = await buildFixture('admin');
    const sys = await findSystemEmailScanComplete(fx.storage);
    const res = await fx.server.inject({
      method: 'PATCH',
      url: `/admin/notifications/${sys.id}`,
      payload: { subjectTemplate: '   ' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects voice longer than 500 chars', async () => {
    fx = await buildFixture('admin');
    const sys = await findSystemEmailScanComplete(fx.storage);
    const res = await fx.server.inject({
      method: 'PATCH',
      url: `/admin/notifications/${sys.id}`,
      payload: { voice: 'v'.repeat(501) },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects signature longer than 1000 chars', async () => {
    fx = await buildFixture('admin');
    const sys = await findSystemEmailScanComplete(fx.storage);
    const res = await fx.server.inject({
      method: 'PATCH',
      url: `/admin/notifications/${sys.id}`,
      payload: { signature: 's'.repeat(1001) },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /admin/notifications/override', () => {
  let fx: Fixture;
  afterEach(async () => fx?.cleanup());

  it('org admin clones a system template into their org + audit', async () => {
    fx = await buildFixture('admin-org-A');
    const sys = await findSystemEmailScanComplete(fx.storage);
    const res = await fx.server.inject({
      method: 'POST',
      url: '/admin/notifications/override',
      payload: { sourceId: sys.id },
    });
    expect(res.statusCode).toBe(200);
    const overrides = await fx.storage.notificationTemplates.list({ scope: 'org', orgId: fx.orgAId });
    expect(overrides).toHaveLength(1);
    expect(overrides[0]!.eventType).toBe('scan.complete');

    const audit = await fx.storage.audit.query({ action: 'notification.create', limit: 5, offset: 0 });
    expect(audit.entries.length).toBe(1);
  });

  it('rejects duplicate override for same event/channel/org', async () => {
    fx = await buildFixture('admin-org-A');
    const sys = await findSystemEmailScanComplete(fx.storage);
    await fx.server.inject({ method: 'POST', url: '/admin/notifications/override', payload: { sourceId: sys.id } });
    const res = await fx.server.inject({ method: 'POST', url: '/admin/notifications/override', payload: { sourceId: sys.id } });
    expect(res.statusCode).toBe(409);
  });

  it('global admin without an active org is rejected', async () => {
    fx = await buildFixture('admin'); // currentOrgId='system'
    const sys = await findSystemEmailScanComplete(fx.storage);
    const res = await fx.server.inject({ method: 'POST', url: '/admin/notifications/override', payload: { sourceId: sys.id } });
    expect(res.statusCode).toBe(400);
  });
});

describe('DELETE /admin/notifications/:id', () => {
  let fx: Fixture;
  afterEach(async () => fx?.cleanup());

  it('org admin deletes own org template + audit', async () => {
    fx = await buildFixture('admin-org-A');
    const sys = await findSystemEmailScanComplete(fx.storage);
    const sysTpl = await fx.storage.notificationTemplates.getById(sys.id);
    const created = await fx.storage.notificationTemplates.create({
      eventType: 'scan.complete',
      channel: 'email',
      scope: 'org',
      orgId: fx.orgAId,
      subjectTemplate: sysTpl!.subjectTemplate,
      bodyTemplate: sysTpl!.bodyTemplate,
      llmEnabled: false,
    });
    const res = await fx.server.inject({ method: 'DELETE', url: `/admin/notifications/${created.id}` });
    expect(res.statusCode).toBe(200);
    expect(await fx.storage.notificationTemplates.getById(created.id)).toBeNull();
    const audit = await fx.storage.audit.query({ action: 'notification.delete', limit: 5, offset: 0 });
    expect(audit.entries.length).toBe(1);
  });

  it('system template delete forbidden for admin', async () => {
    fx = await buildFixture('admin');
    const sys = await findSystemEmailScanComplete(fx.storage);
    const res = await fx.server.inject({ method: 'DELETE', url: `/admin/notifications/${sys.id}` });
    expect(res.statusCode).toBe(403);
  });

  it('cross-org delete → 404', async () => {
    fx = await buildFixture('admin-org-A');
    const sys = await findSystemEmailScanComplete(fx.storage);
    const sysTpl = await fx.storage.notificationTemplates.getById(sys.id);
    const orgB = await fx.storage.notificationTemplates.create({
      eventType: 'scan.complete',
      channel: 'email',
      scope: 'org',
      orgId: fx.orgBId,
      subjectTemplate: sysTpl!.subjectTemplate,
      bodyTemplate: sysTpl!.bodyTemplate,
      llmEnabled: false,
    });
    const res = await fx.server.inject({ method: 'DELETE', url: `/admin/notifications/${orgB.id}` });
    expect(res.statusCode).toBe(404);
    expect(await fx.storage.notificationTemplates.getById(orgB.id)).not.toBeNull();
  });
});

describe('GET /admin/notifications/:id/history', () => {
  let fx: Fixture;
  afterEach(async () => fx?.cleanup());

  it('returns chronological history after updates', async () => {
    fx = await buildFixture('admin');
    const sys = await findSystemEmailScanComplete(fx.storage);
    await fx.storage.notificationTemplates.update(sys.id, { subjectTemplate: 'v2' }, 'sysadmin');
    await fx.storage.notificationTemplates.update(sys.id, { subjectTemplate: 'v3' }, 'sysadmin');
    const res = await fx.server.inject({ method: 'GET', url: `/admin/notifications/${sys.id}/history` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { history: Array<{ version: number }> } };
    // 2 history rows after 2 updates (snapshots of v1 and v2)
    expect(body.data.history.length).toBe(2);
  });

  it('cross-org history returns 404', async () => {
    fx = await buildFixture('admin-org-A');
    const sys = await findSystemEmailScanComplete(fx.storage);
    const sysTpl = await fx.storage.notificationTemplates.getById(sys.id);
    const orgB = await fx.storage.notificationTemplates.create({
      eventType: 'scan.complete',
      channel: 'email',
      scope: 'org',
      orgId: fx.orgBId,
      subjectTemplate: sysTpl!.subjectTemplate,
      bodyTemplate: sysTpl!.bodyTemplate,
      llmEnabled: false,
    });
    const res = await fx.server.inject({ method: 'GET', url: `/admin/notifications/${orgB.id}/history` });
    expect(res.statusCode).toBe(404);
  });
});
