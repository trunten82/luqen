/**
 * Phase 50-03 — preview pane + test-send route tests.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../../src/db/sqlite/index.js';
import { setEncryptionSalt } from '../../../src/plugins/crypto.js';
import {
  notificationRoutes,
  validateRecipientForChannel,
  resetTestSendRateLimit,
} from '../../../src/routes/admin/notifications.js';
import { registerSession } from '../../../src/auth/session.js';
import { seedSystemNotificationTemplates } from '../../../src/notifications/seed-templates.js';
import type { LuqenEvent, PluginInstance } from '../../../src/plugins/types.js';
import type { PluginManager } from '../../../src/plugins/manager.js';
import type { LLMClient } from '../../../src/llm-client.js';

type Viewer = 'admin' | 'admin-org-A' | 'admin-org-B' | 'viewer';

interface PluginCapture {
  received: LuqenEvent[];
  throws: boolean;
}

function makePluginManager(captures: { email: PluginCapture; slack?: PluginCapture; teams?: PluginCapture }): PluginManager {
  const list = [
    {
      id: 'plugin-email',
      packageName: '@luqen/plugin-notify-email',
      channel: 'email' as const,
      instance: {
        manifest: { name: 'notify-email', displayName: 'Email', type: 'notification' as const, version: '1.0.0', description: '', configSchema: [] },
        activate: async () => {},
        deactivate: async () => {},
        healthCheck: async () => true,
        send: async (event: LuqenEvent) => {
          if (captures.email.throws) throw new Error('plugin failure');
          captures.email.received.push(event);
        },
      } as unknown as PluginInstance,
    },
  ];
  return {
    getActiveNotificationPlugins: () => list,
  } as unknown as PluginManager;
}

interface Fixture {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  orgAId: string;
  orgBId: string;
  templateId: string;
  emailCapture: PluginCapture;
  llmMock: ReturnType<typeof vi.fn>;
  cleanup: () => Promise<void>;
}

async function buildFixture(
  viewer: Viewer,
  opts: { llmEnabled?: boolean; noPluginManager?: boolean; testSendWindowMs?: number; llmReturns?: unknown } = {},
): Promise<Fixture> {
  setEncryptionSalt(`p50-salt-${randomUUID()}`);
  const dbPath = join(tmpdir(), `notif-preview-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  await seedSystemNotificationTemplates(storage.notificationTemplates);

  const orgA = await storage.organizations.createOrg({ name: 'OrgA', slug: `a-${randomUUID()}` });
  const orgB = await storage.organizations.createOrg({ name: 'OrgB', slug: `b-${randomUUID()}` });

  // Find scan.complete email system template; clone into orgA so org admins
  // can edit it (system templates require admin.system).
  const sys = (await storage.notificationTemplates.list({
    eventType: 'scan.complete',
    channel: 'email',
    scope: 'system',
  }))[0]!;
  const tpl = await storage.notificationTemplates.create({
    eventType: 'scan.complete',
    channel: 'email',
    scope: 'org',
    orgId: orgA.id,
    subjectTemplate: sys.subjectTemplate,
    bodyTemplate: sys.bodyTemplate,
    voice: sys.voice,
    signature: sys.signature,
    llmEnabled: opts.llmEnabled === true,
    updatedBy: 'seed',
  });

  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));
  await registerSession(server, 'test-session-secret-at-least-32b');

  server.decorateReply('view', function (this: FastifyReply, template: string, data: unknown) {
    return this.code(200).header('content-type', 'application/json').send(JSON.stringify({ template, data }));
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
    } else {
      request.user = { id: 'viewer', username: 'viewer', role: 'viewer', currentOrgId: orgA.id };
      setPerms(['compliance.view']);
    }
  });

  const emailCapture: PluginCapture = { received: [], throws: false };
  const pluginManager = opts.noPluginManager ? undefined : makePluginManager({ email: emailCapture });

  const llmMock = vi.fn();
  if (opts.llmReturns !== undefined) {
    llmMock.mockResolvedValue(opts.llmReturns);
  } else {
    llmMock.mockResolvedValue(null);
  }
  const fakeClient = {
    generateNotificationContent: llmMock,
  } as unknown as LLMClient;
  const getLLMClient = () => fakeClient;

  resetTestSendRateLimit();
  await notificationRoutes(server, storage, {
    ...(pluginManager !== undefined ? { pluginManager } : {}),
    getLLMClient,
    ...(opts.testSendWindowMs !== undefined ? { testSendWindowMs: opts.testSendWindowMs } : {}),
  });
  await server.ready();

  return {
    server,
    storage,
    orgAId: orgA.id,
    orgBId: orgB.id,
    templateId: tpl.id,
    emailCapture,
    llmMock,
    cleanup: async () => {
      await server.close();
      await storage.disconnect();
      if (existsSync(dbPath)) rmSync(dbPath);
    },
  };
}

// ---------------------------------------------------------------------------

describe('validateRecipientForChannel', () => {
  it('email — accepts valid', () => {
    expect(validateRecipientForChannel('a@b.com', 'email')).toBeNull();
  });
  it('email — rejects invalid', () => {
    expect(validateRecipientForChannel('not-an-email', 'email')).toMatch(/email/);
  });
  it('slack — accepts channel ID', () => {
    expect(validateRecipientForChannel('C0123ABCDEF', 'slack')).toBeNull();
  });
  it('slack — accepts https webhook', () => {
    expect(validateRecipientForChannel('https://hooks.slack.com/x', 'slack')).toBeNull();
  });
  it('slack — rejects junk', () => {
    expect(validateRecipientForChannel('foo', 'slack')).toMatch(/slack/i);
  });
  it('teams — requires https webhook', () => {
    expect(validateRecipientForChannel('https://outlook.office.com/x', 'teams')).toBeNull();
    expect(validateRecipientForChannel('http://x', 'teams')).toMatch(/https/);
  });
  it('rejects empty string', () => {
    expect(validateRecipientForChannel('', 'email')).toMatch(/required/i);
  });
});

// ---------------------------------------------------------------------------

describe('POST /admin/notifications/:id/preview', () => {
  let fx: Fixture;
  afterEach(async () => fx?.cleanup());

  it('viewer is rejected (403)', async () => {
    fx = await buildFixture('viewer');
    const res = await fx.server.inject({
      method: 'POST',
      url: `/admin/notifications/${fx.templateId}/preview`,
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it('cross-org admin gets 404', async () => {
    fx = await buildFixture('admin-org-B');
    const res = await fx.server.inject({
      method: 'POST',
      url: `/admin/notifications/${fx.templateId}/preview`,
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns deterministic preview when useLlm=false', async () => {
    fx = await buildFixture('admin-org-A');
    const res = await fx.server.inject({
      method: 'POST',
      url: `/admin/notifications/${fx.templateId}/preview`,
      payload: { useLlm: 'false' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { template: string; data: { useLlm: boolean; rendered: { subject: string } } };
    expect(body.template).toBe('admin/notification-preview.hbs');
    expect(body.data.useLlm).toBe(false);
    expect(body.data.rendered.subject).toBeTruthy();
    expect(fx.llmMock).not.toHaveBeenCalled();
  });

  it('returns LLM preview when useLlm=true and template.llmEnabled=true', async () => {
    fx = await buildFixture('admin-org-A', {
      llmEnabled: true,
      llmReturns: {
        subject: 'LLM SUBJ',
        body: 'LLM BODY',
        model: 'M', provider: 'P', latencyMs: 1, tokensIn: 1, tokensOut: 1,
      },
    });
    const res = await fx.server.inject({
      method: 'POST',
      url: `/admin/notifications/${fx.templateId}/preview`,
      payload: { useLlm: 'true' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { useLlm: boolean; rendered: { subject: string } } };
    expect(body.data.useLlm).toBe(true);
    expect(body.data.rendered.subject).toContain('LLM SUBJ');
    expect(fx.llmMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to deterministic with banner when LLM returns null', async () => {
    fx = await buildFixture('admin-org-A', { llmEnabled: true, llmReturns: null });
    const res = await fx.server.inject({
      method: 'POST',
      url: `/admin/notifications/${fx.templateId}/preview`,
      payload: { useLlm: 'true' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { llmFallbackBanner: string; rendered: { subject: string } } };
    expect(body.data.llmFallbackBanner).toContain('warning');
    expect(body.data.rendered.subject).not.toContain('LLM SUBJ');
  });

  it('ignores useLlm=true when template.llmEnabled=false', async () => {
    fx = await buildFixture('admin-org-A', { llmEnabled: false });
    const res = await fx.server.inject({
      method: 'POST',
      url: `/admin/notifications/${fx.templateId}/preview`,
      payload: { useLlm: 'true' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { useLlm: boolean } };
    expect(body.data.useLlm).toBe(false);
    expect(fx.llmMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------

describe('POST /admin/notifications/:id/test-send', () => {
  let fx: Fixture;
  afterEach(async () => fx?.cleanup());

  it('returns 400 when recipient is missing', async () => {
    fx = await buildFixture('admin-org-A');
    const res = await fx.server.inject({
      method: 'POST',
      url: `/admin/notifications/${fx.templateId}/test-send`,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when recipient is invalid for channel', async () => {
    fx = await buildFixture('admin-org-A');
    const res = await fx.server.inject({
      method: 'POST',
      url: `/admin/notifications/${fx.templateId}/test-send`,
      payload: { recipient: 'not-an-email' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('happy path: dispatches via plugin and writes audit log', async () => {
    fx = await buildFixture('admin-org-A');
    const res = await fx.server.inject({
      method: 'POST',
      url: `/admin/notifications/${fx.templateId}/test-send`,
      payload: { recipient: 'tester@example.com' },
    });
    expect(res.statusCode).toBe(200);
    expect(fx.emailCapture.received).toHaveLength(1);
    expect(fx.emailCapture.received[0].data.recipient).toBe('tester@example.com');
    expect(fx.emailCapture.received[0].data.isTestSend).toBe(true);

    const auditQ = await fx.storage.audit.query({ resourceType: 'notification_template', action: 'notification.test_send' });
    const testSendEntries = auditQ.entries.filter((e) => e.resourceId === fx.templateId);
    expect(testSendEntries.length).toBeGreaterThanOrEqual(1);
  });

  it('returns 503 when no plugin is active for the channel', async () => {
    fx = await buildFixture('admin-org-A', { noPluginManager: true });
    const res = await fx.server.inject({
      method: 'POST',
      url: `/admin/notifications/${fx.templateId}/test-send`,
      payload: { recipient: 'tester@example.com' },
    });
    expect(res.statusCode).toBe(503);
  });

  it('rate-limits to 1/min/admin/template (429 on second send within window)', async () => {
    fx = await buildFixture('admin-org-A', { testSendWindowMs: 60_000 });
    const first = await fx.server.inject({
      method: 'POST',
      url: `/admin/notifications/${fx.templateId}/test-send`,
      payload: { recipient: 'tester@example.com' },
    });
    expect(first.statusCode).toBe(200);
    const second = await fx.server.inject({
      method: 'POST',
      url: `/admin/notifications/${fx.templateId}/test-send`,
      payload: { recipient: 'other@example.com' },
    });
    expect(second.statusCode).toBe(429);
  });

  it('cross-org admin gets 404', async () => {
    fx = await buildFixture('admin-org-B');
    const res = await fx.server.inject({
      method: 'POST',
      url: `/admin/notifications/${fx.templateId}/test-send`,
      payload: { recipient: 'tester@example.com' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('viewer is rejected (403)', async () => {
    fx = await buildFixture('viewer');
    const res = await fx.server.inject({
      method: 'POST',
      url: `/admin/notifications/${fx.templateId}/test-send`,
      payload: { recipient: 'tester@example.com' },
    });
    expect(res.statusCode).toBe(403);
  });
});
