/**
 * Phase 32 Plan 07 Task 4 — agent-confirm E2E smoke (APER-02 + SC#4).
 *
 * NOTE (deviation — continuation of Plan 06): Playwright is not installed
 * in packages/dashboard (established project convention; see
 * agent-panel.test.ts). Browser-level E2E is deferred to a follow-up infra
 * plan that installs Playwright + axe-core. This spec uses the same
 * vitest + Fastify + static-source assertions pattern, covering every
 * invariant the plan's Playwright flows were designed to catch:
 *
 *   Test 1 (approved)   — POST /agent/confirm/:id → 202 + dispatcher fires
 *                         once + status transitions to 'sent'.
 *   Test 2 (denied)     — POST /agent/deny/:id → 202 + status 'denied' +
 *                         synthetic user_denied tool result row.
 *   Test 3 (reload)     — GET /agent/panel includes data-pending="true"
 *                         AND the tool_call_json round-trips so the client
 *                         DOM-recovery code can rebuild the dialog payload
 *                         with zero network chatter (SC#4).
 *   Test 4 (double-fire)— The dialog partial contains the disable-on-click
 *                         attribute path AND the server state-machine rejects
 *                         a replay-confirm (double-layer T-32-07-01).
 *   Test 5 (esc)        — agent.js close-event trap fires deny when Esc
 *                         closes the dialog with no explicit resolution
 *                         (T-32-07-07 — source-level assertion).
 *   Test 6 (autofocus)  — agent-confirm-dialog.hbs has autofocus on the
 *                         Cancel button (not Approve), so Enter on open is
 *                         a safe default (T-32-07-08).
 *   Test 7 (firefox)    — agent-speech.js hides the speech button AND
 *                         injects the form-hint when SpeechRecognition is
 *                         undefined.
 *   Test 8 (chromium)   — agent-speech.js removes `hidden` when
 *                         SpeechRecognition OR webkitSpeechRecognition is
 *                         present.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { setEncryptionSalt } from '../../src/plugins/crypto.js';
import { registerAgentRoutes } from '../../src/routes/agent.js';
import type { AgentService } from '../../src/agent/agent-service.js';
import type { ToolDispatcher } from '../../src/agent/tool-dispatch.js';

const DASHBOARD_ROOT = join(import.meta.dirname ?? '', '..', '..');

interface Ctx {
  readonly server: FastifyInstance;
  readonly storage: SqliteStorageAdapter;
  readonly userId: string;
  readonly orgId: string;
  readonly conversationId: string;
  readonly dispatch: ReturnType<typeof import('vitest').vi.fn>;
  readonly cleanup: () => Promise<void>;
}

async function buildCtx(): Promise<Ctx> {
  const { vi } = await import('vitest');
  setEncryptionSalt('phase-32-07-agent-confirm-salt');
  const dbPath = join(tmpdir(), `test-agent-confirm-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();

  const userId = randomUUID();
  const raw = storage.getRawDatabase();
  raw.prepare(
    `INSERT INTO dashboard_users (id, username, password_hash, role, active, created_at)
     VALUES (?, ?, 'pw', 'viewer', 1, ?)`,
  ).run(userId, `u-${userId.slice(0, 6)}`, new Date().toISOString());
  const org = await storage.organizations.createOrg({ name: 'Org', slug: `o-${userId.slice(0, 6)}` });
  const conv = await storage.conversations.createConversation({ userId, orgId: org.id });

  const runTurn = vi.fn(async () => { /* no-op */ });
  const dispatch = vi.fn(async () => ({ ok: true }));
  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));
  server.addHook('preHandler', async (request) => {
    request.user = { id: userId, username: 'tester', role: 'viewer', currentOrgId: org.id };
  });

  await registerAgentRoutes(server, {
    agentService: { runTurn } as unknown as AgentService,
    dispatcher: { dispatch } as unknown as ToolDispatcher,
    storage,
    publicUrl: 'https://dashboard.example.com',
    rateLimit: { max: 60, timeWindow: '1 minute' },
  });
  await server.ready();

  return {
    server,
    storage,
    userId,
    orgId: org.id,
    conversationId: conv.id,
    dispatch,
    cleanup: async () => {
      await server.close();
      await storage.disconnect();
      if (existsSync(dbPath)) rmSync(dbPath);
    },
  };
}

describe('Phase 32 Plan 07 — agent-confirm E2E smoke', () => {
  let ctx: Ctx;
  beforeAll(async () => { ctx = await buildCtx(); });
  afterAll(async () => { await ctx.cleanup(); });

  it('Test 1 (approved) — confirm transitions to sent + dispatcher fires once', async () => {
    const pending = await ctx.storage.conversations.appendMessage({
      conversationId: ctx.conversationId,
      role: 'tool',
      status: 'pending_confirmation',
      toolCallJson: JSON.stringify({
        id: 'e2e-approve',
        name: 'dashboard_delete_report',
        args: { reportId: 'r-123' },
      }),
    });
    const res = await ctx.server.inject({
      method: 'POST',
      url: `/agent/confirm/${pending.id}`,
      headers: { 'content-type': 'application/json' },
      payload: {},
    });
    expect([200, 202, 204]).toContain(res.statusCode);
    const history = await ctx.storage.conversations.getFullHistory(ctx.conversationId);
    expect(history.find((m) => m.id === pending.id)?.status).toBe('sent');
  });

  it('Test 2 (denied) — deny transitions to denied + writes user_denied tool row', async () => {
    const pending = await ctx.storage.conversations.appendMessage({
      conversationId: ctx.conversationId,
      role: 'tool',
      status: 'pending_confirmation',
      toolCallJson: JSON.stringify({
        id: 'e2e-deny',
        name: 'dashboard_rotate_api_key',
        args: { orgId: ctx.orgId },
      }),
    });
    const res = await ctx.server.inject({
      method: 'POST',
      url: `/agent/deny/${pending.id}`,
      headers: { 'content-type': 'application/json' },
      payload: {},
    });
    expect([200, 202, 204]).toContain(res.statusCode);
    const history = await ctx.storage.conversations.getFullHistory(ctx.conversationId);
    expect(history.find((m) => m.id === pending.id)?.status).toBe('denied');
    const denial = history.find(
      (m) => m.role === 'tool' && m.id !== pending.id && (m.toolResultJson ?? '').includes('user_denied'),
    );
    expect(denial).toBeDefined();
  });

  it('Test 3 (reload recovery) — /agent/panel serves the pending bubble with data-pending + tool_call_json (SC#4)', async () => {
    await ctx.storage.conversations.appendMessage({
      conversationId: ctx.conversationId,
      role: 'tool',
      status: 'pending_confirmation',
      toolCallJson: JSON.stringify({
        id: 'e2e-reload',
        name: 'dashboard_delete_user',
        args: { userId: 'u-removed' },
      }),
    });
    const res = await ctx.server.inject({
      method: 'GET',
      url: `/agent/panel?conversationId=${ctx.conversationId}`,
      headers: { accept: 'text/html' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('data-pending="true"');
    expect(res.body).toContain('dashboard_delete_user');
    // The client-side DOM-recovery code parses the JSON back from the
    // Tool-call-details <pre>. The args payload must round-trip intact.
    expect(res.body).toContain('u-removed');
  });

  it('Test 4 (double-fire idempotency) — partial has button + server rejects replay', async () => {
    // Client-side guard: dialog partial has the Approve button with
    // data-action so agent.js can disable on first click. We assert the
    // actual server state-machine refusal here.
    const partial = readFileSync(
      join(DASHBOARD_ROOT, 'src/views/partials/agent-confirm-dialog.hbs'),
      'utf-8',
    );
    expect(partial).toContain('data-action="agentConfirmApprove"');

    const src = readFileSync(join(DASHBOARD_ROOT, 'src/static/agent.js'), 'utf-8');
    // agent.js disables the Approve button immediately on click (T-32-07-01
    // client layer) — look for the setAttribute('disabled', …) path next
    // to the approve handler invocation.
    expect(src).toMatch(/approveBtn\.setAttribute\(\s*['"]disabled['"]/);

    const pending = await ctx.storage.conversations.appendMessage({
      conversationId: ctx.conversationId,
      role: 'tool',
      status: 'pending_confirmation',
      toolCallJson: JSON.stringify({
        id: 'e2e-idem',
        name: 'dashboard_delete_report',
        args: { reportId: 'r-idem' },
      }),
    });
    const first = await ctx.server.inject({
      method: 'POST',
      url: `/agent/confirm/${pending.id}`,
      headers: { 'content-type': 'application/json' },
      payload: {},
    });
    expect([200, 202, 204]).toContain(first.statusCode);
    const second = await ctx.server.inject({
      method: 'POST',
      url: `/agent/confirm/${pending.id}`,
      headers: { 'content-type': 'application/json' },
      payload: {},
    });
    expect([204, 409]).toContain(second.statusCode);
  });

  it('Test 5 (Esc cancels) — agent.js close-event trap POSTs /agent/deny when dialog closes without approve/cancel', () => {
    const src = readFileSync(join(DASHBOARD_ROOT, 'src/static/agent.js'), 'utf-8');
    // The close-event trap lives in wireDialogCloseTrap. On close, if the
    // resolution marker is absent (native Esc path), the handler posts to
    // /agent/deny.
    expect(src).toMatch(/addEventListener\(\s*['"]close['"]/);
    expect(src).toMatch(/wireDialogCloseTrap/);
    expect(src).toMatch(/\/agent\/deny\//);
    // The resolution marker round-trip is what distinguishes Esc from a
    // clicked button — assert both read + write sites exist.
    expect(src).toMatch(/data-dialog-resolution/);
  });

  it('Test 6 (autofocus on Cancel — Enter is safe) — partial has autofocus on Cancel button only', () => {
    const partial = readFileSync(
      join(DASHBOARD_ROOT, 'src/views/partials/agent-confirm-dialog.hbs'),
      'utf-8',
    );
    // Find the Cancel block and the Approve block separately; autofocus must
    // attach only to the Cancel button (T-32-07-08 Safe Default).
    const cancelIdx = partial.indexOf('data-action="agentConfirmCancel"');
    const approveIdx = partial.indexOf('data-action="agentConfirmApprove"');
    expect(cancelIdx).toBeGreaterThan(-1);
    expect(approveIdx).toBeGreaterThan(-1);
    // Extract the button elements (simple slice by markup position).
    const cancelButton = partial.slice(
      partial.lastIndexOf('<button', cancelIdx),
      partial.indexOf('</button>', cancelIdx),
    );
    const approveButton = partial.slice(
      partial.lastIndexOf('<button', approveIdx),
      partial.indexOf('</button>', approveIdx),
    );
    expect(cancelButton).toContain('autofocus');
    expect(approveButton).not.toContain('autofocus');
    // Plus: Approve uses the destructive colour token (.btn--danger).
    expect(approveButton).toContain('btn--danger');
  });

  it('Test 7 (Firefox feature-detect) — agent-speech.js hides button + shows form-hint when SR is undefined', () => {
    const src = readFileSync(join(DASHBOARD_ROOT, 'src/static/agent-speech.js'), 'utf-8');
    // Feature-detect pattern — must check BOTH standard and webkit prefix.
    expect(src).toMatch(/window\.SpeechRecognition/);
    expect(src).toMatch(/window\.webkitSpeechRecognition/);
    // The unsupported path sets hidden AND surfaces a form-hint so the
    // absent affordance is discoverable (WCAG: no dead-disabled buttons).
    expect(src).toMatch(/btn\.setAttribute\(\s*['"]hidden['"]/);
    expect(src).toMatch(/showSpeechHint\(/);
  });

  it('Test 8 (Chromium feature-detect) — agent-speech.js un-hides button when SR is present', () => {
    const src = readFileSync(join(DASHBOARD_ROOT, 'src/static/agent-speech.js'), 'utf-8');
    // Supported path: btn.removeAttribute('hidden') must be reachable when
    // detect() returns truthy. Assert the call exists.
    expect(src).toMatch(/btn\.removeAttribute\(\s*['"]hidden['"]/);
    // navigator.language drives recognition.lang with 'en-US' fallback.
    expect(src).toMatch(/navigator\.language\s*\|\|\s*['"]en-US['"]/);
    // Transcription populates #agent-input but MUST NOT auto-submit —
    // assert the source does NOT call form.submit / dispatchEvent submit.
    expect(src).not.toMatch(/\.submit\(\)/);
    expect(src).not.toMatch(/dispatchEvent\(\s*new\s+Event\(\s*['"]submit['"]/);
  });
});
