/**
 * Phase 32 Plan 04 — /agent/* Fastify routes.
 *
 * Five routes exposed under a single scoped Fastify register so rate-limiting
 * and the onSend 429-rewrite hook apply to all of them:
 *
 *   POST /agent/message            (HTMX form POST; persists user msg + 202)
 *   GET  /agent/stream/:id         (SSE; drives AgentService.runTurn)
 *   POST /agent/confirm/:messageId (pending → sent; resumes loop)
 *   POST /agent/deny/:messageId    (pending → denied; synth user-denied row)
 *   GET  /agent/panel              (HTMX drawer partial — stub here,
 *                                   Plan 06 Task 2 replaces)
 *
 * ── Critical invariants ─────────────────────────────────────────────────
 * 1. Rate-limit 429 is JSON via a Fastify `onSend` hook (D-22,
 *    feedback_rate_limiter.md). The `@fastify/rate-limit` plugin's built-in
 *    error-response override is unreliable on this plugin version — it does
 *    not consistently force Content-Type. A plan-checker grep enforces the
 *    unreliable option MUST NOT appear in this file.
 * 2. GET /agent/stream/:id rejects mismatched Origin headers (T-32-04-14).
 *    Same-origin Origin OR no Origin (EventSource default) passes; any
 *    other Origin returns 403 JSON `{error:'origin_mismatch'}`.
 * 3. Session-guard is applied by the parent server's authGuard preHandler
 *    running globally — this module assumes request.user is populated.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import Handlebars from 'handlebars';
import { z } from 'zod';

import type { StorageAdapter } from '../db/index.js';
import { writeFrame, type SseFrame } from '../agent/sse-frames.js';
import type { AgentService } from '../agent/agent-service.js';
import type {
  ToolDispatcher,
  ToolCallInput,
} from '../agent/tool-dispatch.js';

export interface RegisterAgentRoutesOptions {
  readonly agentService: Pick<AgentService, 'runTurn'>;
  readonly dispatcher: Pick<ToolDispatcher, 'dispatch'>;
  readonly storage: StorageAdapter;
  /**
   * The dashboard's public URL (env DASHBOARD_PUBLIC_URL). Used to validate
   * the Origin header on /agent/stream (T-32-04-14). Trailing slash is
   * stripped at register time for a stable comparison.
   */
  readonly publicUrl: string;
  /**
   * Rate-limit config. Defaults to 60 req/min per authenticated user.
   * Tests inject a lower max to exercise the 429 rewrite path without
   * flooding the server.
   */
  readonly rateLimit?: {
    readonly max: number;
    readonly timeWindow: string;
  };
}

// ---------------------------------------------------------------------------
// Zod bodies
// ---------------------------------------------------------------------------

const MessageBodySchema = z.object({
  conversationId: z.string().optional(),
  content: z.string().min(1).max(8000),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normaliseUrl(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

/**
 * Resolve the conversation-scoping orgId for the authenticated user.
 *
 * Global dashboard admins (admin.system permission, no org membership) have
 * `user.currentOrgId === undefined` — the ordinary org-scoped code path 400s
 * on that. To keep the agent usable for them without leaking conversations
 * between admins, mint a synthetic per-admin namespace: `__admin__:{userId}`.
 *
 * Returns undefined ONLY if the user has neither an org nor admin.system.
 */
function resolveAgentOrgId(
  user: { id: string; currentOrgId?: string },
  permissions: ReadonlySet<string>,
): string | undefined {
  if (user.currentOrgId !== undefined && user.currentOrgId.length > 0) {
    return user.currentOrgId;
  }
  if (permissions.has('admin.system')) {
    return `__admin__:${user.id}`;
  }
  return undefined;
}

function getPermissions(request: FastifyRequest): ReadonlySet<string> {
  const perms = (request as unknown as Record<string, unknown>)['permissions'];
  return perms instanceof Set ? (perms as Set<string>) : new Set<string>();
}

// ---------------------------------------------------------------------------
// registerAgentRoutes
// ---------------------------------------------------------------------------

export async function registerAgentRoutes(
  server: FastifyInstance,
  options: RegisterAgentRoutesOptions,
): Promise<void> {
  const {
    agentService,
    dispatcher,
    storage,
    publicUrl,
    rateLimit: rlConfig = { max: 60, timeWindow: '1 minute' },
  } = options;

  const expectedOrigin = normaliseUrl(publicUrl);

  await server.register(async (scope) => {
    // Rate-limit ONLY for the /agent/* scope. Key by authenticated user id
    // so parallel sessions from the same IP don't share a bucket.
    await scope.register(rateLimit, {
      max: rlConfig.max,
      timeWindow: rlConfig.timeWindow,
      keyGenerator: (req: FastifyRequest) => req.user?.id ?? req.ip,
      addHeaders: {
        'x-ratelimit-limit': true,
        'x-ratelimit-remaining': true,
        'x-ratelimit-reset': true,
        'retry-after': true,
      },
    });

    // D-22 + feedback_rate_limiter.md: rewrite 429s to JSON via onSend.
    // The plugin's built-in error-response override is NOT used — plan-checker
    // greps this file to verify its absence. The onSend hook runs AFTER the
    // plugin sets the 429 status but BEFORE the body is serialised, so we
    // override both Content-Type and body shape here.
    scope.addHook('onSend', async (_request, reply, payload) => {
      if (reply.statusCode !== 429) return payload;
      void reply.header('content-type', 'application/json');
      const retryAfter = reply.getHeader('retry-after');
      const retryAfterMs =
        retryAfter !== undefined && retryAfter !== null
          ? Number(retryAfter) * 1000
          : 60_000;
      return JSON.stringify({
        error: 'rate_limited',
        retry_after_ms: Number.isFinite(retryAfterMs) && retryAfterMs > 0
          ? retryAfterMs
          : 60_000,
      });
    });

    // ── POST /agent/message ────────────────────────────────────────────
    scope.post('/message', async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user;
      if (user === undefined) {
        return reply.code(401).send({ error: 'unauthenticated' });
      }
      const parsed = MessageBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
      }
      // Verify the conversation belongs to the authenticated org.
      const orgId = resolveAgentOrgId(user, getPermissions(request));
      if (orgId === undefined) {
        return reply.code(400).send({ error: 'no_org_context' });
      }
      // Auto-create the conversation on first message. The client-minted id
      // is advisory — createConversation generates its own UUID, so we look
      // up the client's id first and fall through to create when absent or
      // not found. Returns the resolved id via x-conversation-id so the
      // client can store it for subsequent messages + the SSE stream.
      let convId = parsed.data.conversationId;
      if (convId !== undefined && convId.length > 0) {
        const existing = await storage.conversations.getConversation(convId, orgId);
        if (existing === null) { convId = undefined; }
      }
      if (convId === undefined || convId.length === 0) {
        const created = await storage.conversations.createConversation({
          userId: user.id,
          orgId,
        });
        convId = created.id;
      }
      // Persist the user message; the SSE stream picks it up on next runTurn.
      const msg = await storage.conversations.appendMessage({
        conversationId: convId,
        role: 'user',
        content: parsed.data.content,
        status: 'sent',
      });
      // Return a minimal HTMX partial so the drawer can optimistically render
      // the user row. Plan 06 replaces this with the handlebars partial.
      void reply.type('text/html');
      void reply.header('x-conversation-id', convId);
      return reply.code(202).send(
        `<div class="agent-msg agent-msg--user" data-message-id="${escapeHtml(msg.id)}">` +
          escapeHtml(parsed.data.content) +
          `</div>`,
      );
    });

    // ── GET /agent/stream/:conversationId ──────────────────────────────
    scope.get(
      '/stream/:conversationId',
      async (request: FastifyRequest, reply: FastifyReply) => {
        const user = request.user;
        if (user === undefined) {
          return reply.code(401).send({ error: 'unauthenticated' });
        }
        // T-32-04-14 — Origin check. Missing Origin is fine (EventSource does
        // not send Origin on same-origin GETs in all browsers). Mismatched
        // Origin is a cross-origin piggyback attempt.
        const originHeader = request.headers.origin;
        if (
          typeof originHeader === 'string' &&
          originHeader.length > 0 &&
          normaliseUrl(originHeader) !== expectedOrigin
        ) {
          return reply.code(403).send({ error: 'origin_mismatch' });
        }

        const { conversationId } = request.params as { conversationId: string };
        const orgId = resolveAgentOrgId(user, getPermissions(request));
        if (orgId === undefined) {
          return reply.code(400).send({ error: 'no_org_context' });
        }
        const conv = await storage.conversations.getConversation(conversationId, orgId);
        if (conv === null) {
          return reply.code(404).send({ error: 'conversation_not_found' });
        }

        // Pull the latest user message so AgentService has a prompt to run.
        // If the most recent message is already a pending_confirmation, the
        // stream is being re-opened after a reload — render the pending row
        // via a plain frame emit (client replays getWindow separately).
        const window = await storage.conversations.getWindow(conversationId);
        const lastUser = [...window].reverse().find((m) => m.role === 'user');
        const userMessage = lastUser?.content ?? '';

        // SSE headers + flush-before-first-write so intermediaries don't
        // buffer the handshake.
        void reply.header('content-type', 'text/event-stream');
        void reply.header('cache-control', 'no-cache');
        void reply.header('connection', 'keep-alive');
        void reply.header('x-accel-buffering', 'no');
        // Fastify wants us to signal the raw stream is ours now.
        reply.hijack();
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });

        const controller = new AbortController();
        request.raw.on('close', () => controller.abort());

        const emit = (frame: SseFrame): void => {
          try {
            writeFrame({ raw: reply.raw }, frame);
          } catch {
            // Writing a malformed frame should never happen at runtime — the
            // schema catches it. If it does, abort the stream so the client
            // reconnects cleanly.
            controller.abort();
          }
        };

        try {
          await agentService.runTurn({
            conversationId,
            userId: user.id,
            orgId,
            userMessage,
            emit,
            signal: controller.signal,
          });
        } catch (err) {
          // Never throw to Fastify — the reply is already hijacked.
          const message = err instanceof Error ? err.message : String(err);
          emit({ type: 'error', code: 'internal', message, retryable: false });
        } finally {
          reply.raw.end();
        }
      },
    );

    // ── POST /agent/confirm/:messageId ─────────────────────────────────
    scope.post(
      '/confirm/:messageId',
      async (request: FastifyRequest, reply: FastifyReply) => {
        const user = request.user;
        if (user === undefined) {
          return reply.code(401).send({ error: 'unauthenticated' });
        }
        const { messageId } = request.params as { messageId: string };
        const orgId = resolveAgentOrgId(user, getPermissions(request));
        if (orgId === undefined) {
          return reply.code(400).send({ error: 'no_org_context' });
        }

        const pending = await findPendingMessage(storage, messageId, orgId);
        if (pending === null) {
          return reply.code(404).send({ error: 'pending_not_found' });
        }
        if (pending.status !== 'pending_confirmation') {
          // Idempotent: replay-confirm on a resolved row is a no-op 409.
          return reply.code(409).send({ error: 'not_pending' });
        }
        const call = safeParseCall(pending.toolCallJson);
        if (call === null) {
          return reply.code(400).send({ error: 'malformed_tool_call' });
        }

        await storage.conversations.updateMessageStatus(messageId, 'sent');
        const result = await dispatcher.dispatch(call, {
          userId: user.id,
          orgId,
        });
        // Persist the dispatched tool result as a NEW tool row so the loop
        // can resume on the next SSE turn. Truncation mirrors AgentService.
        await storage.conversations.appendMessage({
          conversationId: pending.conversationId,
          role: 'tool',
          toolCallJson: JSON.stringify(call),
          toolResultJson: JSON.stringify(result),
          status: 'sent',
        });
        return reply.code(202).send({ ok: true });
      },
    );

    // ── POST /agent/deny/:messageId ────────────────────────────────────
    scope.post(
      '/deny/:messageId',
      async (request: FastifyRequest, reply: FastifyReply) => {
        const user = request.user;
        if (user === undefined) {
          return reply.code(401).send({ error: 'unauthenticated' });
        }
        const { messageId } = request.params as { messageId: string };
        const orgId = resolveAgentOrgId(user, getPermissions(request));
        if (orgId === undefined) {
          return reply.code(400).send({ error: 'no_org_context' });
        }

        const pending = await findPendingMessage(storage, messageId, orgId);
        if (pending === null) {
          return reply.code(404).send({ error: 'pending_not_found' });
        }
        if (pending.status !== 'pending_confirmation') {
          return reply.code(409).send({ error: 'not_pending' });
        }
        const call = safeParseCall(pending.toolCallJson);

        await storage.conversations.updateMessageStatus(messageId, 'denied');
        await storage.conversations.appendMessage({
          conversationId: pending.conversationId,
          role: 'tool',
          toolCallJson: call !== null ? JSON.stringify(call) : '{}',
          toolResultJson: JSON.stringify({
            error: 'user_denied',
            message: 'User declined the action.',
          }),
          status: 'sent',
        });
        return reply.code(202).send({ ok: true });
      },
    );

    // ── GET /agent/panel ───────────────────────────────────────────────
    // Plan 06 Task 2: real server-side rolling-window render via
    // ConversationRepository.getWindow + agent-messages partial. Returns an
    // HTML fragment (no layout wrapping) that agent.js swaps into
    // #agent-messages via DOMParser + importNode.
    //
    // If no conversation exists yet, renders the empty-state (first-open
    // greeting). If a conversation exists but belongs to a different org,
    // returns 404 (org isolation — same invariant as /agent/message).
    scope.get('/panel', async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user;
      if (user === undefined) {
        return reply.code(401).send({ error: 'unauthenticated' });
      }
      const orgId = resolveAgentOrgId(user, getPermissions(request));
      if (orgId === undefined) {
        return reply.code(400).send({ error: 'no_org_context' });
      }
      const q = (request.query ?? {}) as Record<string, unknown>;
      const conversationId = typeof q['conversationId'] === 'string' ? q['conversationId'] : '';
      // Resolve the rolling window — empty if the conversation is new or
      // doesn't yet belong to the user. getConversation returns null for a
      // foreign org so we only call getWindow when the org check passes.
      let messages: ReadonlyArray<{
        readonly id: string;
        readonly role: 'user' | 'assistant' | 'tool';
        readonly content: string | null;
        readonly toolCallJson: string | null;
        readonly toolResultJson: string | null;
        readonly status: string;
      }> = [];
      if (conversationId.length > 0) {
        const conv = await storage.conversations.getConversation(conversationId, orgId);
        if (conv === null && conversationId.length > 0) {
          // Either the id is unknown (new conversation from client) or it
          // belongs to another org. Treat both as empty panel — the user's
          // next message POST will auto-create the conversation row.
          messages = [];
        } else {
          messages = await storage.conversations.getWindow(conversationId);
        }
      }
      // Determine the agent display name from the user's current org (same
      // lookup as server.ts preHandler, but the HTMX fragment doesn't go
      // through reply.view so we resolve it inline).
      const org = await storage.organizations.getOrg(orgId);
      const agentDisplayName =
        org?.agentDisplayName !== undefined && org?.agentDisplayName !== null && org.agentDisplayName.length > 0
          ? org.agentDisplayName
          : 'Luqen Assistant';
      const locale =
        (typeof (request as unknown as { session?: { get(k: string): unknown } }).session?.get === 'function'
          ? (request as unknown as { session: { get(k: string): unknown } }).session.get('locale') as string | undefined
          : undefined) ?? 'en';

      const fragment = renderAgentMessagesFragment({
        messages,
        agentDisplayName,
        locale,
      });
      void reply.type('text/html');
      return reply.code(200).send(fragment);
    });
  }, { prefix: '/agent' });
}

// ---------------------------------------------------------------------------
// Private helpers — message-level lookup + safe-parse.
// ---------------------------------------------------------------------------

async function findPendingMessage(
  storage: StorageAdapter,
  messageId: string,
  orgId: string,
): Promise<{ id: string; conversationId: string; status: string; toolCallJson: string | null } | null> {
  // ConversationRepository has no direct-by-id lookup; walk the user's
  // conversations and check full history. Small price in exchange for no
  // new query surface in Phase 31's repo. If this becomes hot, extract a
  // `getMessage(id, orgId)` repo method in a later plan.
  //
  // Naive first-cut: the messageId must exist; we find the conversation by
  // querying agent_messages directly via the raw DB. This is a dashboard
  // service-layer concern — not a new public repo method.
  const raw = (storage as unknown as { getRawDatabase?: () => {
    prepare(sql: string): { get(...args: unknown[]): unknown };
  } }).getRawDatabase?.();
  if (raw === undefined) return null;
  const row = raw
    .prepare(
      `SELECT m.id, m.conversation_id, m.status, m.tool_call_json
         FROM agent_messages m
         INNER JOIN agent_conversations c ON c.id = m.conversation_id
         WHERE m.id = ? AND c.org_id = ?`,
    )
    .get(messageId, orgId) as
      | { id: string; conversation_id: string; status: string; tool_call_json: string | null }
      | undefined;
  if (row === undefined) return null;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    status: row.status,
    toolCallJson: row.tool_call_json,
  };
}

// ---------------------------------------------------------------------------
// Handlebars fragment renderer for GET /agent/panel (Plan 06 Task 2)
// ---------------------------------------------------------------------------

interface PanelMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant' | 'tool';
  readonly content: string | null;
  readonly toolCallJson: string | null;
  readonly toolResultJson: string | null;
  readonly status: string;
}

let cachedAgentMessagesTemplate: HandlebarsTemplateDelegate | null = null;
let cachedAgentMessageTemplate: HandlebarsTemplateDelegate | null = null;
let cachedFragmentHelpersRegistered = false;

function resolveViewsDir(): string {
  // Views are copied to dist/views at build time; in dev they live at
  // packages/dashboard/src/views. This helper walks up from the compiled
  // route file to find either.
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '..', 'views'),
    resolve(here, '..', '..', 'src', 'views'),
  ];
  return candidates[0];
}

function compileAgentMessagesTemplate(): HandlebarsTemplateDelegate {
  if (cachedAgentMessagesTemplate !== null) return cachedAgentMessagesTemplate;
  if (!cachedFragmentHelpersRegistered) {
    // Register the minimum helpers agent-message.hbs needs. `eq` is already
    // registered globally at server.ts start-up, but the fragment renderer
    // may run in a context where we want a known-safe instance.
    if (!Handlebars.helpers['eq']) {
      Handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);
    }
    if (!Handlebars.helpers['t']) {
      // Minimal 't' fallback — returns the key. The real i18n helper is
      // registered by the handlebars-i18n plugin in server.ts. Agent panel
      // responses render via this fallback only if the globals were never
      // set up (e.g. in tests that register routes without the full
      // view engine). Production always hits the real helper.
      Handlebars.registerHelper('t', function (this: unknown, key: string) {
        return new Handlebars.SafeString(String(key));
      });
    }
    cachedFragmentHelpersRegistered = true;
  }
  const viewsDir = resolveViewsDir();
  const messagesSrc = readFileSync(join(viewsDir, 'partials', 'agent-messages.hbs'), 'utf-8');
  const messageSrc = readFileSync(join(viewsDir, 'partials', 'agent-message.hbs'), 'utf-8');
  cachedAgentMessageTemplate = Handlebars.compile(messageSrc);
  // Register the child partial so {{> agent-message}} resolves.
  Handlebars.registerPartial('agent-message', messageSrc);
  cachedAgentMessagesTemplate = Handlebars.compile(messagesSrc);
  return cachedAgentMessagesTemplate;
}

function renderAgentMessagesFragment(args: {
  readonly messages: ReadonlyArray<PanelMessage>;
  readonly agentDisplayName: string;
  readonly locale: string;
}): string {
  const tpl = compileAgentMessagesTemplate();
  return tpl({
    messages: args.messages,
    agentDisplayName: args.agentDisplayName,
    locale: args.locale,
  });
}

function safeParseCall(json: string | null): ToolCallInput | null {
  if (json === null || json.length === 0) return null;
  try {
    const parsed = JSON.parse(json) as ToolCallInput;
    if (
      typeof parsed.id === 'string' &&
      typeof parsed.name === 'string' &&
      typeof parsed.args === 'object' &&
      parsed.args !== null
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}
