/**
 * Admin API surface for the system brand guideline library — Phase 08 plan 02
 * (SYS-01, SYS-04).
 *
 * Endpoints (all gated on the `admin.system` permission — non-admins get 403):
 *
 *   GET  /admin/system-brand-guidelines
 *     → List all guidelines where org_id='system'. When the request carries
 *       `hx-request: true` the response is a plain HTML fragment (no layout);
 *       otherwise the full admin page is rendered via @fastify/view (with a
 *       direct handlebars.compile fallback for tests and environments where
 *       the view engine is not registered).
 *
 *   GET  /admin/system-brand-guidelines/new
 *     → Modal fragment for the "create" form. Reuses the existing branding
 *       guideline form template; POST target is /admin/system-brand-guidelines
 *       so the new row lands with org_id='system'.
 *
 *   POST /admin/system-brand-guidelines
 *     → Create a new row with org_id='system'. Manual body validation
 *       (matches the dashboard's existing admin-route style — no Zod). Writes
 *       an audit_log entry. Returns a redirect to the detail page on HTMX and
 *       JSON on programmatic callers.
 *
 *   GET  /admin/system-brand-guidelines/:id
 *     → Detail view. Reuses `branding-guideline-detail.hbs` verbatim (D-10) —
 *       the only divergence is a `scope: 'system'` flag and a back-link to
 *       the system admin list. Rejects with 404 when the target row's orgId
 *       is not 'system' (prevents using this route to view org-owned rows).
 *
 *   POST /admin/system-brand-guidelines/:id
 *     → Update name/description for a system guideline. Verifies the target's
 *       orgId before touching it. Audit-logged.
 *
 *   POST /admin/system-brand-guidelines/:id/delete
 *     → Delete a system guideline. Verifies the target's orgId first. If the
 *       row is still linked to any sites, returns a 409 with a toast
 *       rendering `admin.systemBrand.deleteBlocked` — matches the UI-SPEC
 *       delete-blocked contract. Audit-logged on success.
 *
 * System sentinel: `'system'` is the canonical org_id for all globally-scoped
 * resources in Luqen (CONTEXT D-01). No new table, no schema fork.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Type } from '@sinclair/typebox';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { StorageAdapter } from '../../db/adapter.js';
import { requirePermission } from '../../auth/middleware.js';
import { toastHtml, escapeHtml } from './helpers.js';
import { ErrorEnvelope, HtmlPageSchema } from '../../api/schemas/envelope.js';

// Phase 41.1-03 — local TypeBox shapes for system brand guideline routes.
// Routes return HTML or JSON depending on `hx-request`, so response shapes
// are intentionally permissive (additionalProperties: true). Bodies are
// validated only at the handler level (loose); we accept arbitrary JSON to
// avoid breaking tests that POST minimal payloads.
const LooseBody = Type.Object({}, { additionalProperties: true });

const SystemBrandIdParams = Type.Object(
  { id: Type.String() },
  { additionalProperties: true },
);

// Permissive JSON object shape for the non-HTMX path's `{ ok, guideline }`
// envelope. Stays open (additionalProperties: true) so handler can include
// the full guideline shape verbatim.
const SuccessJson = Type.Object({}, { additionalProperties: true });

const MixedHtmlOrJsonResponse = {
  tags: ['html-page'],
  // Handlers branch between text/html and application/json based on
  // hx-request, so the response schema unions both shapes via permissive
  // objects/strings. ErrorEnvelope guards 4xx/5xx.
  response: {
    200: Type.Union([Type.String(), SuccessJson]),
    201: SuccessJson,
    204: Type.Null(),
    400: ErrorEnvelope,
    401: ErrorEnvelope,
    403: ErrorEnvelope,
    404: ErrorEnvelope,
    409: ErrorEnvelope,
    500: ErrorEnvelope,
  },
} as const;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const VIEWS_DIR = join(__dirname, '..', '..', 'views');

const SYSTEM_ORG_ID = 'system';

type HbsTemplate = (data: Record<string, unknown>) => string;

let cachedListTemplate: HbsTemplate | null = null;
let cachedDetailTemplate: HbsTemplate | null = null;
let helpersRegistered = false;

async function ensureHelpers(): Promise<void> {
  if (helpersRegistered) return;
  const hbs = (await import('handlebars')).default;
  const i18n = await import('../../i18n/index.js');
  // Idempotent: loadTranslations simply rewrites the in-memory map if called
  // twice. Production server.ts calls it once during bootstrap; this covers
  // test environments and any direct-compile fallback paths.
  i18n.loadTranslations();
  const translate = i18n.t;

  // Register the row partial so the list template can reference it via
  // `{{> system-brand-guideline-row this}}`. Same partial file that
  // server.ts wires into @fastify/view for production requests.
  if (!hbs.partials['system-brand-guideline-row']) {
    const rowSrc = readFileSync(
      join(VIEWS_DIR, 'admin', 'partials', 'system-brand-guideline-row.hbs'),
      'utf-8',
    );
    hbs.registerPartial('system-brand-guideline-row', rowSrc);
  }

  // Register only the helpers actually used by the two templates this module
  // compiles directly. In production server.ts registers the same helpers on
  // the same singleton before this module ever runs, so these calls become
  // idempotent no-ops. In tests — where server.ts is not imported — this is
  // the only place the helpers land on the handlebars singleton.
  if (!hbs.helpers['t']) {
    hbs.registerHelper('t', function (key: string, options: { hash?: Record<string, string> }) {
      const params = options?.hash ?? {};
      return translate(key, 'en', params);
    });
  }
  if (!hbs.helpers['eq']) {
    hbs.registerHelper('eq', (a: unknown, b: unknown) => a === b);
  }
  if (!hbs.helpers['startsWith']) {
    hbs.registerHelper('startsWith', (str: string, prefix: string) =>
      typeof str === 'string' && typeof prefix === 'string' && str.startsWith(prefix),
    );
  }
  if (!hbs.helpers['gt']) {
    hbs.registerHelper('gt', (a: unknown, b: unknown) => Number(a) > Number(b));
  }
  helpersRegistered = true;
}

async function getListTemplate(): Promise<HbsTemplate> {
  if (cachedListTemplate !== null) return cachedListTemplate;
  await ensureHelpers();
  const hbs = (await import('handlebars')).default;
  const src = readFileSync(
    join(VIEWS_DIR, 'admin', 'system-brand-guidelines.hbs'),
    'utf-8',
  );
  cachedListTemplate = hbs.compile(src) as HbsTemplate;
  return cachedListTemplate;
}

async function getDetailTemplate(): Promise<HbsTemplate> {
  if (cachedDetailTemplate !== null) return cachedDetailTemplate;
  await ensureHelpers();
  const hbs = (await import('handlebars')).default;
  const src = readFileSync(
    join(VIEWS_DIR, 'admin', 'branding-guideline-detail.hbs'),
    'utf-8',
  );
  cachedDetailTemplate = hbs.compile(src) as HbsTemplate;
  return cachedDetailTemplate;
}

function isHtmxRequest(request: FastifyRequest): boolean {
  return request.headers['hx-request'] === 'true';
}

/**
 * Register the admin CRUD routes for the system brand guideline library.
 */
export async function systemBrandGuidelineRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
  getLLMClient?: () => unknown | null,
): Promise<void> {
  // ── GET /admin/system-brand-guidelines ────────────────────────────────────
  server.get(
    '/admin/system-brand-guidelines',
    {
      preHandler: requirePermission('admin.system'),
      schema: HtmlPageSchema,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const guidelines = await storage.branding.listSystemGuidelines();

      const viewCtx: Record<string, unknown> = {
        pageTitle: 'System brand guidelines',
        currentPath: '/admin/system-brand-guidelines',
        user: request.user,
        guidelines,
      };

      // HTMX fragment — render the list template directly (no layout).
      if (isHtmxRequest(request)) {
        const render = await getListTemplate();
        return reply.code(200).type('text/html').send(render(viewCtx));
      }

      // Full page. Prefer @fastify/view when present (production path), fall
      // back to direct compile for tests and any environment where the view
      // engine is not registered on this server instance.
      if (typeof (reply as { view?: unknown }).view === 'function') {
        return (reply as unknown as {
          view: (page: string, ctx: Record<string, unknown>) => FastifyReply;
        }).view('admin/system-brand-guidelines.hbs', viewCtx);
      }
      const render = await getListTemplate();
      return reply.code(200).type('text/html').send(render(viewCtx));
    },
  );

  // ── GET /admin/system-brand-guidelines/new ────────────────────────────────
  server.get(
    '/admin/system-brand-guidelines/new',
    {
      preHandler: requirePermission('admin.system'),
      schema: HtmlPageSchema,
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const viewCtx = { scope: 'system', postUrl: '/admin/system-brand-guidelines' };
      if (typeof (reply as { view?: unknown }).view === 'function') {
        return (reply as unknown as {
          view: (page: string, ctx: Record<string, unknown>) => FastifyReply;
        }).view('admin/branding-guideline-form.hbs', viewCtx);
      }
      // Minimal inline fallback — only used in tests that don't hit this
      // route. Keeps the handler dependency-free.
      return reply
        .code(200)
        .type('text/html')
        .send('<div data-scope="system"></div>');
    },
  );

  // ── POST /admin/system-brand-guidelines  (create) ─────────────────────────
  server.post(
    '/admin/system-brand-guidelines',
    {
      preHandler: requirePermission('admin.system'),
      schema: { body: LooseBody, ...MixedHtmlOrJsonResponse },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = (request.body ?? {}) as {
        name?: unknown;
        description?: unknown;
      };

      if (typeof body.name !== 'string' || body.name.trim() === '') {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml('Name is required.', 'error'));
      }
      if (
        body.description !== undefined &&
        body.description !== null &&
        typeof body.description !== 'string'
      ) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml('Invalid description.', 'error'));
      }

      const name = body.name.trim();
      const description =
        typeof body.description === 'string' && body.description.trim() !== ''
          ? body.description.trim()
          : undefined;

      const guideline = await storage.branding.createGuideline({
        id: randomUUID(),
        orgId: SYSTEM_ORG_ID,
        name,
        ...(description !== undefined ? { description } : {}),
        ...(request.user?.id !== undefined ? { createdBy: request.user.id } : {}),
      });

      const userId = request.user?.id ?? null;
      const username = request.user?.username ?? 'unknown';
      await storage.audit.log({
        actor: username,
        ...(userId !== null ? { actorId: userId } : {}),
        action: 'system_brand_guideline.create',
        resourceType: 'system_brand_guideline',
        resourceId: guideline.id,
        details: { name, description: description ?? null },
        ipAddress: request.ip,
      });

      if (isHtmxRequest(request)) {
        return reply
          .code(200)
          .header('HX-Redirect', `/admin/system-brand-guidelines/${guideline.id}`)
          .header('content-type', 'text/html')
          .send(toastHtml(`System brand guideline "${escapeHtml(name)}" created.`));
      }
      return reply.code(201).send({ ok: true, guideline });
    },
  );

  // ── GET /admin/system-brand-guidelines/:id  (detail) ──────────────────────
  server.get(
    '/admin/system-brand-guidelines/:id',
    {
      preHandler: requirePermission('admin.system'),
      schema: { params: SystemBrandIdParams, ...HtmlPageSchema },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const guideline = await storage.branding.getGuideline(id);

      if (guideline === null || guideline.orgId !== SYSTEM_ORG_ID) {
        return reply
          .code(404)
          .header('content-type', 'text/html')
          .send(toastHtml('System brand guideline not found.', 'error'));
      }

      const [colors, fonts, selectors, sites] = await Promise.all([
        storage.branding.listColors(id),
        storage.branding.listFonts(id),
        storage.branding.listSelectors(id),
        storage.branding.getSiteAssignments(id),
      ]);

      const viewCtx: Record<string, unknown> = {
        pageTitle: `System brand — ${guideline.name}`,
        currentPath: '/admin/system-brand-guidelines',
        user: request.user,
        guideline,
        colors,
        fonts,
        selectors,
        sites: sites.map((url) => ({ siteUrl: url })),
        llmEnabled: typeof getLLMClient === 'function' ? getLLMClient() !== null : false,
        scope: 'system',
        backLink: '/admin/system-brand-guidelines',
      };

      if (typeof (reply as { view?: unknown }).view === 'function') {
        return (reply as unknown as {
          view: (page: string, ctx: Record<string, unknown>) => FastifyReply;
        }).view('admin/branding-guideline-detail.hbs', viewCtx);
      }
      const render = await getDetailTemplate();
      return reply.code(200).type('text/html').send(render(viewCtx));
    },
  );

  // ── POST /admin/system-brand-guidelines/:id  (update) ─────────────────────
  server.post(
    '/admin/system-brand-guidelines/:id',
    {
      preHandler: requirePermission('admin.system'),
      schema: { params: SystemBrandIdParams, body: LooseBody, ...MixedHtmlOrJsonResponse },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const existing = await storage.branding.getGuideline(id);
      if (existing === null || existing.orgId !== SYSTEM_ORG_ID) {
        return reply
          .code(404)
          .header('content-type', 'text/html')
          .send(toastHtml('System brand guideline not found.', 'error'));
      }

      const body = (request.body ?? {}) as {
        name?: unknown;
        description?: unknown;
      };

      const update: { name?: string; description?: string } = {};
      if (typeof body.name === 'string' && body.name.trim() !== '') {
        update.name = body.name.trim();
      }
      if (typeof body.description === 'string') {
        update.description = body.description.trim();
      }

      if (update.name === undefined && update.description === undefined) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml('Nothing to update.', 'error'));
      }

      const updated = await storage.branding.updateGuideline(id, update);

      const userId = request.user?.id ?? null;
      const username = request.user?.username ?? 'unknown';
      await storage.audit.log({
        actor: username,
        ...(userId !== null ? { actorId: userId } : {}),
        action: 'system_brand_guideline.update',
        resourceType: 'system_brand_guideline',
        resourceId: id,
        details: update,
        ipAddress: request.ip,
      });

      if (isHtmxRequest(request)) {
        return reply
          .header('HX-Redirect', `/admin/system-brand-guidelines/${id}`)
          .code(204)
          .send();
      }
      return reply.code(200).send({ ok: true, guideline: updated });
    },
  );

  // ── POST /admin/system-brand-guidelines/:id/delete ────────────────────────
  server.post(
    '/admin/system-brand-guidelines/:id/delete',
    {
      preHandler: requirePermission('admin.system'),
      schema: { params: SystemBrandIdParams, ...MixedHtmlOrJsonResponse },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const existing = await storage.branding.getGuideline(id);
      if (existing === null || existing.orgId !== SYSTEM_ORG_ID) {
        return reply
          .code(404)
          .header('content-type', 'text/html')
          .send(toastHtml('System brand guideline not found.', 'error'));
      }

      // Block delete when sites are still linked to this template.
      const sites = await storage.branding.getSiteAssignments(id);
      if (sites.length > 0) {
        const msg = `Cannot delete "${escapeHtml(existing.name)}" — ${sites.length} sites are currently linked to it. Unlink first, then retry.`;
        return reply
          .code(409)
          .header('content-type', 'text/html')
          .send(toastHtml(msg, 'error'));
      }

      await storage.branding.deleteGuideline(id);

      const userId = request.user?.id ?? null;
      const username = request.user?.username ?? 'unknown';
      await storage.audit.log({
        actor: username,
        ...(userId !== null ? { actorId: userId } : {}),
        action: 'system_brand_guideline.delete',
        resourceType: 'system_brand_guideline',
        resourceId: id,
        details: { name: existing.name },
        ipAddress: request.ip,
      });

      if (isHtmxRequest(request)) {
        return reply
          .code(200)
          .header('content-type', 'text/html')
          .header('HX-Redirect', '/admin/system-brand-guidelines')
          .send(toastHtml(`System brand guideline "${escapeHtml(existing.name)}" deleted.`));
      }
      return reply.code(200).send({ ok: true });
    },
  );
}
