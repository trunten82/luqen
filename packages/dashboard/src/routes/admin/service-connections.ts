/**
 * Admin API surface for the three outbound service connections
 * (compliance, branding, LLM) — Phase 06 plan 03.
 *
 * Endpoints (all require the `admin.system` permission — non-admins get 403):
 *
 *   GET  /admin/service-connections
 *     → List the three connections. Secrets are NEVER returned; a `hasSecret`
 *       boolean and a `source: 'db' | 'config'` discriminator accompany each
 *       row. Rows missing from the DB are synthesized from config values with
 *       `source: 'config'` (per-service fallback, CONTEXT D-14 / W3).
 *
 *   POST /admin/service-connections/:id
 *     → Upsert url/clientId/clientSecret. Empty clientSecret means
 *       "blank-to-keep" (preserve ciphertext). On success, the registry is
 *       asked to rebuild the live client via `reload(:id)`. A reload failure
 *       returns 500 but leaves the DB row updated — the old client remains
 *       active (exception safety is guaranteed by the registry, P02 D-09).
 *       An audit_log entry is written on every save.
 *
 *   POST /admin/service-connections/:id/test
 *     → Validate candidate values against OAuth2 + /health (via
 *       `testServiceConnection`). Does not save anything. If the posted
 *       clientSecret is empty, falls back to the stored (decrypted) secret.
 *
 *   POST /admin/service-connections/:id/clear-secret
 *     → Wipe the stored secret (sets empty string placeholder), audit logs,
 *       and calls `reload(:id)` so the runtime client is rebuilt without the
 *       old credentials.
 *
 * NOTE on the permission key: the phase plan refers to `dashboard.admin` but
 * the actual permission registered in `src/permissions.ts` is `admin.system`.
 * We use `admin.system` to match the existing code (Rule 3 — blocking fix,
 * documented in the plan SUMMARY).
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import type { StorageAdapter } from '../../db/index.js';
import type { ServiceClientRegistry } from '../../services/service-client-registry.js';
import type {
  ServiceConnection,
  ServiceConnectionsRepository,
  ServiceId,
} from '../../db/service-connections-repository.js';
import { requirePermission } from '../../auth/middleware.js';
import { toastHtml, escapeHtml } from './helpers.js';
import { t as translate } from '../../i18n/index.js';
import type { Locale } from '../../i18n/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const VIEWS_DIR = join(__dirname, '..', '..', 'views');

// Lazy-compiled Handlebars templates for HTMX fragment responses. Compiled on
// first use and cached for the lifetime of the process. The global handlebars
// singleton already has the `t`, `eq`, etc. helpers registered by server.ts
// before any route runs, so these compiled templates can use them freely.
type HbsTemplate = (data: Record<string, unknown>) => string;
let cachedRowTemplate: HbsTemplate | null = null;
let cachedEditRowTemplate: HbsTemplate | null = null;

async function getRowTemplate(): Promise<HbsTemplate> {
  if (cachedRowTemplate !== null) return cachedRowTemplate;
  const hbs = (await import('handlebars')).default;
  const src = readFileSync(
    join(VIEWS_DIR, 'admin', 'partials', 'service-connection-row.hbs'),
    'utf-8',
  );
  cachedRowTemplate = hbs.compile(src) as HbsTemplate;
  return cachedRowTemplate;
}

async function getEditRowTemplate(): Promise<HbsTemplate> {
  if (cachedEditRowTemplate !== null) return cachedEditRowTemplate;
  const hbs = (await import('handlebars')).default;
  const src = readFileSync(
    join(VIEWS_DIR, 'admin', 'partials', 'service-connection-edit-row.hbs'),
    'utf-8',
  );
  cachedEditRowTemplate = hbs.compile(src) as HbsTemplate;
  return cachedEditRowTemplate;
}

function resolveLocale(request: FastifyRequest): Locale {
  const session = request.session as { get?(key: string): unknown } | undefined;
  const fromSession =
    typeof session?.get === 'function'
      ? (session.get('locale') as Locale | undefined)
      : undefined;
  return fromSession ?? 'en';
}

function isHtmxRequest(request: FastifyRequest): boolean {
  return request.headers['hx-request'] === 'true';
}

// Fastify instance decorations set by server.ts (plan 06-02).
declare module 'fastify' {
  interface FastifyInstance {
    serviceClientRegistry?: ServiceClientRegistry;
    serviceConnectionsRepo?: ServiceConnectionsRepository;
  }
}

// ---------------------------------------------------------------------------
// Public wire shapes — secrets are NEVER included.
// ---------------------------------------------------------------------------

interface PublicServiceConnection {
  readonly serviceId: ServiceId;
  readonly url: string;
  readonly clientId: string;
  readonly hasSecret: boolean;
  readonly source: 'db' | 'config';
  readonly updatedAt: string | null;
  readonly updatedBy: string | null;
}

const VALID_SERVICE_IDS: ReadonlySet<string> = new Set(['compliance', 'branding', 'llm']);

interface ConfigSnapshot {
  readonly complianceUrl: string;
  readonly complianceClientId: string;
  readonly complianceClientSecret: string;
  readonly brandingUrl: string;
  readonly brandingClientId: string;
  readonly brandingClientSecret: string;
  readonly llmUrl?: string;
  readonly llmClientId: string;
  readonly llmClientSecret: string;
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

export async function registerServiceConnectionsRoutes(
  fastify: FastifyInstance,
  storage: StorageAdapter,
  config: ConfigSnapshot,
): Promise<void> {
  const repo = fastify.serviceConnectionsRepo;
  const registry = fastify.serviceClientRegistry;

  if (repo === undefined || registry === undefined) {
    throw new Error(
      'registerServiceConnectionsRoutes: fastify.serviceConnectionsRepo and ' +
        'fastify.serviceClientRegistry must be decorated before registration.',
    );
  }

  // ── GET /admin/service-connections ────────────────────────────────────────
  // Content-negotiated: returns the full admin page (HTML) when the client
  // accepts text/html, and the masked JSON list otherwise. HTMX requests hit
  // the same endpoint for the initial page load.
  fastify.get(
    '/admin/service-connections',
    { preHandler: requirePermission('admin.system') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const dbRows = await repo.list();
      const byId = new Map<ServiceId, ServiceConnection>(
        dbRows.map((row) => [row.serviceId, row]),
      );

      const connections: PublicServiceConnection[] = (
        ['compliance', 'branding', 'llm'] as const
      ).map((id) => {
        const dbRow = byId.get(id);
        if (dbRow !== undefined) {
          return maskConnection(dbRow);
        }
        return synthesizeFromConfig(id, config);
      });

      const accept = String(request.headers.accept ?? '');
      if (accept.includes('text/html') || isHtmxRequest(request)) {
        return reply.view('admin/service-connections.hbs', {
          pageTitle: 'Service Connections',
          currentPath: '/admin/service-connections',
          user: request.user,
          connections,
        });
      }

      return reply.code(200).send({ connections });
    },
  );

  // ── GET /admin/service-connections/:id/edit ──────────────────────────────
  // Returns the inline edit-row partial as an HTML fragment. HTMX-only.
  fastify.get(
    '/admin/service-connections/:id/edit',
    { preHandler: requirePermission('admin.system') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id?: string };
      if (id === undefined || !VALID_SERVICE_IDS.has(id)) {
        return reply.code(400).send({ ok: false, error: 'invalid_service_id' });
      }
      const serviceId = id as ServiceId;

      const stored = await repo.get(serviceId);
      const row: PublicServiceConnection =
        stored !== null ? maskConnection(stored) : synthesizeFromConfig(serviceId, config);

      const render = await getEditRowTemplate();
      const html = render({ ...row, locale: resolveLocale(request) });
      return reply.code(200).type('text/html').send(html);
    },
  );

  // ── GET /admin/service-connections/:id/row ────────────────────────────────
  // Re-renders the read-only row partial. Used by the Cancel button and by the
  // successful-save response path. HTMX-only.
  fastify.get(
    '/admin/service-connections/:id/row',
    { preHandler: requirePermission('admin.system') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id?: string };
      if (id === undefined || !VALID_SERVICE_IDS.has(id)) {
        return reply.code(400).send({ ok: false, error: 'invalid_service_id' });
      }
      const serviceId = id as ServiceId;

      const stored = await repo.get(serviceId);
      const row: PublicServiceConnection =
        stored !== null ? maskConnection(stored) : synthesizeFromConfig(serviceId, config);

      const render = await getRowTemplate();
      const html = render({ ...row, locale: resolveLocale(request) });
      return reply.code(200).type('text/html').send(html);
    },
  );

  // ── POST /admin/service-connections/:id ───────────────────────────────────
  fastify.post(
    '/admin/service-connections/:id',
    { preHandler: requirePermission('admin.system') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id?: string };
      if (id === undefined || !VALID_SERVICE_IDS.has(id)) {
        return reply.code(400).send({ ok: false, error: 'invalid_service_id' });
      }
      const serviceId = id as ServiceId;

      const body = (request.body ?? {}) as {
        url?: unknown;
        clientId?: unknown;
        clientSecret?: unknown;
      };

      if (typeof body.url !== 'string' || body.url.trim() === '') {
        return reply.code(400).send({ ok: false, error: 'invalid_url' });
      }
      if (typeof body.clientId !== 'string') {
        return reply.code(400).send({ ok: false, error: 'invalid_client_id' });
      }
      if (body.clientSecret !== undefined && typeof body.clientSecret !== 'string') {
        return reply.code(400).send({ ok: false, error: 'invalid_client_secret' });
      }

      const url = body.url.trim();
      const clientId = body.clientId;
      // Empty string or missing → keep existing ciphertext (null = preserve).
      // Non-empty string → replace with encrypted new value.
      const clientSecretInput: string | null =
        body.clientSecret === undefined || body.clientSecret === ''
          ? null
          : body.clientSecret;

      const userId = request.user?.id ?? null;
      const username = request.user?.username ?? 'unknown';

      // Persist first — DB is the source of truth. Reload may still fail and
      // leave the old live client in place (exception safe by design).
      await repo.upsert({
        serviceId,
        url,
        clientId,
        clientSecret: clientSecretInput,
        updatedBy: userId,
      });

      // Audit log — never include secret values.
      void storage.audit.log({
        actor: username,
        ...(userId !== null ? { actorId: userId } : {}),
        action: 'service_connection.update',
        resourceType: 'service_connection',
        resourceId: serviceId,
        details: {
          url,
          clientId,
          secretChanged: clientSecretInput !== null,
        },
        ipAddress: request.ip,
      });

      // Rebuild the live client. If construction throws, the DB row stays
      // updated and the old in-memory client remains active (P02 D-09).
      let reloadError: string | null = null;
      try {
        await registry.reload(serviceId);
      } catch (err) {
        reloadError = err instanceof Error ? err.message : 'reload failed';
        fastify.log.error(
          { err, serviceId },
          'service_connection.reload_failed',
        );
      }

      const refreshed = await repo.get(serviceId);
      const connection: PublicServiceConnection =
        refreshed !== null
          ? maskConnection(refreshed)
          : synthesizeFromConfig(serviceId, config);

      // HTMX HTML response: re-rendered row partial + out-of-band toast swap
      // targeting the global #toast-container (layouts/main.hbs) via the
      // reusable toastHtml() helper. On reload failure we return 500 so the
      // client-side code can style the toast distinctly, but the row is still
      // re-rendered (DB row was written — only the runtime client swap failed).
      if (isHtmxRequest(request)) {
        const locale = resolveLocale(request);
        const render = await getRowTemplate();
        const rowHtml = render({ ...connection, locale });
        if (reloadError !== null) {
          const toast = toastHtml(
            `${translate('admin.serviceConnections.toast.reloadFailed', locale)} — ${reloadError}`,
            'error',
          );
          return reply.code(500).type('text/html').send(`${rowHtml}\n${toast}`);
        }
        const toast = toastHtml(
          translate('admin.serviceConnections.toast.saved', locale),
          'success',
        );
        return reply.code(200).type('text/html').send(`${rowHtml}\n${toast}`);
      }

      if (reloadError !== null) {
        return reply.code(500).send({
          ok: false,
          error: 'reload_failed',
          message: reloadError,
        });
      }

      return reply.code(200).send({ ok: true, connection });
    },
  );

  // ── POST /admin/service-connections/:id/test ──────────────────────────────
  fastify.post(
    '/admin/service-connections/:id/test',
    { preHandler: requirePermission('admin.system') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id?: string };
      if (id === undefined || !VALID_SERVICE_IDS.has(id)) {
        return reply.code(400).send({ ok: false, error: 'invalid_service_id' });
      }
      const serviceId = id as ServiceId;

      const body = (request.body ?? {}) as {
        url?: unknown;
        clientId?: unknown;
        clientSecret?: unknown;
      };

      if (typeof body.url !== 'string' || body.url.trim() === '') {
        return reply.code(400).send({ ok: false, error: 'invalid_url' });
      }
      if (typeof body.clientId !== 'string') {
        return reply.code(400).send({ ok: false, error: 'invalid_client_id' });
      }
      if (body.clientSecret !== undefined && typeof body.clientSecret !== 'string') {
        return reply.code(400).send({ ok: false, error: 'invalid_client_secret' });
      }

      const url = body.url.trim();
      const clientId = body.clientId;
      let clientSecret = (body.clientSecret as string | undefined) ?? '';

      // Blank secret → fall back to the stored decrypted secret so the user
      // can re-test without re-typing the value the UI intentionally blanks.
      if (clientSecret === '') {
        const stored = await repo.get(serviceId);
        if (stored === null || stored.clientSecret === '') {
          return reply.code(400).send({ ok: false, error: 'no_secret' });
        }
        clientSecret = stored.clientSecret;
      }

      // Lazy import keeps the test helper out of the cold-start path and
      // makes the handler easier to spy on in unit tests.
      const { testServiceConnection } = await import(
        '../../services/service-connection-tester.js'
      );
      const result = await testServiceConnection({ url, clientId, clientSecret });

      if (isHtmxRequest(request)) {
        const locale = resolveLocale(request);
        if (result.ok) {
          const label = translate(
            'admin.serviceConnections.test.success',
            locale,
            { latencyMs: String(result.latencyMs) },
          );
          return reply
            .code(200)
            .type('text/html')
            .send(`<span class="badge badge--success">${escapeHtml(label)}</span>`);
        }
        const key =
          result.step === 'oauth'
            ? 'admin.serviceConnections.test.failureOauth'
            : 'admin.serviceConnections.test.failureHealth';
        const label = translate(key, locale, { error: result.error });
        return reply
          .code(200)
          .type('text/html')
          .send(`<span class="badge badge--error">${escapeHtml(label)}</span>`);
      }

      return reply.code(200).send(result);
    },
  );

  // ── POST /admin/service-connections/:id/clear-secret ──────────────────────
  fastify.post(
    '/admin/service-connections/:id/clear-secret',
    { preHandler: requirePermission('admin.system') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id?: string };
      if (id === undefined || !VALID_SERVICE_IDS.has(id)) {
        return reply.code(400).send({ ok: false, error: 'invalid_service_id' });
      }
      const serviceId = id as ServiceId;

      const userId = request.user?.id ?? null;
      const username = request.user?.username ?? 'unknown';

      await repo.clearSecret(serviceId, userId);

      void storage.audit.log({
        actor: username,
        ...(userId !== null ? { actorId: userId } : {}),
        action: 'service_connection.clear_secret',
        resourceType: 'service_connection',
        resourceId: serviceId,
        ipAddress: request.ip,
      });

      try {
        await registry.reload(serviceId);
      } catch (err) {
        fastify.log.error(
          { err, serviceId },
          'service_connection.reload_failed_after_clear',
        );
        // Still return 200 — the secret is cleared; reload failure just
        // means the registry could not build a new client without creds.
      }

      if (isHtmxRequest(request)) {
        const stored = await repo.get(serviceId);
        const connection: PublicServiceConnection =
          stored !== null ? maskConnection(stored) : synthesizeFromConfig(serviceId, config);
        const locale = resolveLocale(request);
        const render = await getRowTemplate();
        const rowHtml = render({ ...connection, locale });
        const toast = toastHtml(
          translate('admin.serviceConnections.toast.secretCleared', locale),
          'success',
        );
        return reply.code(200).type('text/html').send(`${rowHtml}\n${toast}`);
      }

      return reply.code(200).send({ ok: true });
    },
  );
}

// ---------------------------------------------------------------------------
// Helpers — mask and synthesize
// ---------------------------------------------------------------------------

/**
 * Strip the decrypted clientSecret from a repository row and project it into
 * the public wire shape. The `clientSecret` field is NEVER included in the
 * returned object, only a `hasSecret` boolean.
 */
function maskConnection(row: ServiceConnection): PublicServiceConnection {
  return {
    serviceId: row.serviceId,
    url: row.url,
    clientId: row.clientId,
    hasSecret: row.hasSecret,
    source: row.source,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
}

/**
 * Synthesize a fallback row for a service that has no DB entry yet. Marks the
 * result with `source: 'config'` — this is the only code path in the entire
 * codebase that produces that discriminator value.
 */
function synthesizeFromConfig(
  serviceId: ServiceId,
  config: ConfigSnapshot,
): PublicServiceConnection {
  switch (serviceId) {
    case 'compliance':
      return {
        serviceId,
        url: config.complianceUrl,
        clientId: config.complianceClientId,
        hasSecret: config.complianceClientSecret !== '',
        source: 'config',
        updatedAt: null,
        updatedBy: null,
      };
    case 'branding':
      return {
        serviceId,
        url: config.brandingUrl,
        clientId: config.brandingClientId,
        hasSecret: config.brandingClientSecret !== '',
        source: 'config',
        updatedAt: null,
        updatedBy: null,
      };
    case 'llm':
      return {
        serviceId,
        url: config.llmUrl ?? '',
        clientId: config.llmClientId,
        hasSecret: config.llmClientSecret !== '',
        source: 'config',
        updatedAt: null,
        updatedBy: null,
      };
  }
}
