/**
 * Phase 48 — Admin notification template editor routes.
 *
 * Surface: HTMX-driven CRUD over notification_templates (Phase 47 schema).
 * Permission gate: any of `admin.system`, `admin.org`, `compliance.manage`.
 * Row-level RBAC:
 *   - admin.system   → may read/write any template (system + any org).
 *   - admin.org      → may read system templates and own-org templates;
 *                      may create org overrides scoped to current org;
 *                      cross-org read/write returns 404 (parity with v3.2.1).
 *   - viewer         → 403 at route gate.
 *
 * Audit: every mutation writes an audit_log entry with action prefix
 * `notification.` and resourceType `notification_template`. View / list
 * / history reads are NOT audited (too noisy, no security value).
 *
 * LLM toggle is surfaced in the form UI but its runtime effect is
 * Phase 50 territory; here we only persist the boolean.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Type } from '@sinclair/typebox';
import type { StorageAdapter } from '../../db/index.js';
import type {
  NotificationTemplate,
  NotificationChannel,
  NotificationEventType,
} from '../../db/types.js';
import { requirePermission } from '../../auth/middleware.js';
import { toastHtml, escapeHtml } from './helpers.js';
import { ErrorEnvelope, HtmlPageSchema } from '../../api/schemas/envelope.js';

// ── Validation ───────────────────────────────────────────────────────────────

const SUBJECT_MAX = 200;
const BODY_MAX = 5000;
const VOICE_MAX = 500;
const SIGNATURE_MAX = 1000;

const ALLOWED_CHANNELS: ReadonlyArray<NotificationChannel> = ['email', 'slack', 'teams'];
const ALLOWED_EVENTS: ReadonlyArray<NotificationEventType> = [
  'scan.complete',
  'scan.failed',
  'violation.found',
  'regulation.changed',
];

// ── TypeBox shapes ────────────────────────────────────────────────────────────

const NotificationListQuery = Type.Object(
  {
    channel: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

const NotificationIdParams = Type.Object(
  { id: Type.String() },
  { additionalProperties: true },
);

const NotificationUpdateBody = Type.Object(
  {
    subjectTemplate: Type.Optional(Type.String()),
    bodyTemplate: Type.Optional(Type.String()),
    voice: Type.Optional(Type.String()),
    signature: Type.Optional(Type.String()),
    llmEnabled: Type.Optional(Type.Union([Type.String(), Type.Boolean()])),
  },
  { additionalProperties: true },
);

const OverrideCreateBody = Type.Object(
  {
    sourceId: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

const HtmlPartialResponse = {
  tags: ['html-page'],
  produces: ['text/html'],
  response: {
    200: Type.String(),
    400: ErrorEnvelope,
    401: ErrorEnvelope,
    403: ErrorEnvelope,
    404: ErrorEnvelope,
    500: ErrorEnvelope,
  },
} as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function isSystemAdmin(request: FastifyRequest): boolean {
  return request.user?.role === 'admin';
}

function getOrgId(request: FastifyRequest): string | undefined {
  return request.user?.currentOrgId;
}

/**
 * Row-level scope check. Returns true when the caller may read/write the
 * given template; false otherwise. Cross-org attempts surface as `false`
 * and the route translates that into a 404 (parity with v3.2.1 cross-user
 * leak fix and the Phase 51 cross-org read pattern — never reveal that the
 * resource exists for another tenant).
 */
function canAccess(template: NotificationTemplate, request: FastifyRequest): boolean {
  if (isSystemAdmin(request)) return true;
  if (template.scope === 'system') return true; // org admins may READ system
  return template.orgId === getOrgId(request);
}

/** Stricter check: write/delete. System templates are admin.system only. */
function canMutate(template: NotificationTemplate, request: FastifyRequest): boolean {
  if (template.scope === 'system') return isSystemAdmin(request);
  if (isSystemAdmin(request)) return true;
  return template.orgId === getOrgId(request);
}

function parseChannel(value: string | undefined): NotificationChannel {
  if (value && (ALLOWED_CHANNELS as readonly string[]).includes(value)) {
    return value as NotificationChannel;
  }
  return 'email';
}

function validateUpdateBody(body: {
  subjectTemplate?: string;
  bodyTemplate?: string;
  voice?: string;
  signature?: string;
}): string | null {
  if (body.subjectTemplate !== undefined && body.subjectTemplate.length > SUBJECT_MAX) {
    return `Subject must be ${SUBJECT_MAX} characters or fewer.`;
  }
  if (body.bodyTemplate !== undefined && body.bodyTemplate.length > BODY_MAX) {
    return `Body must be ${BODY_MAX} characters or fewer.`;
  }
  if (body.voice !== undefined && body.voice.length > VOICE_MAX) {
    return `Voice must be ${VOICE_MAX} characters or fewer.`;
  }
  if (body.signature !== undefined && body.signature.length > SIGNATURE_MAX) {
    return `Signature must be ${SIGNATURE_MAX} characters or fewer.`;
  }
  if (body.subjectTemplate !== undefined && body.subjectTemplate.trim() === '') {
    return 'Subject is required.';
  }
  if (body.bodyTemplate !== undefined && body.bodyTemplate.trim() === '') {
    return 'Body is required.';
  }
  return null;
}

function logMutation(
  storage: StorageAdapter,
  request: FastifyRequest,
  verb: string,
  template: NotificationTemplate | { id: string; orgId: string | null; scope: string; eventType: string; channel: string },
  extra: Record<string, unknown> = {},
): void {
  void storage.audit.log({
    actor: request.user?.username ?? 'unknown',
    actorId: request.user?.id,
    action: `notification.${verb}`,
    resourceType: 'notification_template',
    resourceId: template.id,
    details: {
      scope: template.scope,
      orgId: template.orgId,
      eventType: template.eventType,
      channel: template.channel,
      ...extra,
    },
    ipAddress: request.ip,
    orgId: template.orgId ?? request.user?.currentOrgId,
  });
}

// ── Route module ──────────────────────────────────────────────────────────────

export async function notificationRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
): Promise<void> {
  const repo = storage.notificationTemplates;

  // GET /admin/notifications — main page (with optional ?channel filter)
  server.get(
    '/admin/notifications',
    {
      preHandler: requirePermission('admin.system', 'admin.org', 'compliance.manage'),
      schema: { ...HtmlPageSchema, querystring: NotificationListQuery },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as { channel?: string };
      const channel = parseChannel(query.channel);
      const callerOrgId = getOrgId(request);

      const all = await repo.list({ channel });

      // Visibility filter: system templates always visible; org templates
      // only visible to the owner org or system admins.
      const visible = all.filter((t) => canAccess(t, request));

      const systemTemplates = visible.filter((t) => t.scope === 'system');
      const orgTemplates = visible.filter((t) => t.scope === 'org');

      const isHtmx = request.headers['hx-request'] === 'true';
      const view = isHtmx ? 'admin/notifications-tab.hbs' : 'admin/notifications.hbs';

      return reply.view(view, {
        pageTitle: 'Notification Templates',
        currentPath: '/admin/notifications',
        user: request.user,
        channel,
        channels: ALLOWED_CHANNELS,
        systemTemplates,
        orgTemplates,
        canEditSystem: isSystemAdmin(request),
        canCreateOverride: callerOrgId !== undefined && callerOrgId !== 'system',
        currentOrgId: callerOrgId ?? null,
      });
    },
  );

  // GET /admin/notifications/:id/view — read-only modal
  server.get(
    '/admin/notifications/:id/view',
    {
      preHandler: requirePermission('admin.system', 'admin.org', 'compliance.manage'),
      schema: { params: NotificationIdParams, ...HtmlPartialResponse },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const tpl = await repo.getById(id);
      if (tpl === null || !canAccess(tpl, request)) {
        return reply.code(404).header('content-type', 'text/html').send(toastHtml('Template not found.', 'error'));
      }
      return reply.view('admin/notification-view.hbs', { template: tpl });
    },
  );

  // GET /admin/notifications/:id/edit — edit form modal
  server.get(
    '/admin/notifications/:id/edit',
    {
      preHandler: requirePermission('admin.system', 'admin.org', 'compliance.manage'),
      schema: { params: NotificationIdParams, ...HtmlPartialResponse },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const tpl = await repo.getById(id);
      // Cross-org or not-found → 404 (no leak).
      if (tpl === null || !canAccess(tpl, request)) {
        return reply.code(404).header('content-type', 'text/html').send(toastHtml('Template not found.', 'error'));
      }
      // Org admin trying to edit a system template → reject (read-only for them).
      if (!canMutate(tpl, request)) {
        return reply.code(403).header('content-type', 'text/html').send(toastHtml('You cannot edit system templates.', 'error'));
      }
      return reply.view('admin/notification-form.hbs', {
        template: tpl,
        limits: { subject: SUBJECT_MAX, body: BODY_MAX, voice: VOICE_MAX, signature: SIGNATURE_MAX },
      });
    },
  );

  // PATCH /admin/notifications/:id — update
  server.patch(
    '/admin/notifications/:id',
    {
      preHandler: requirePermission('admin.system', 'admin.org', 'compliance.manage'),
      schema: { params: NotificationIdParams, body: NotificationUpdateBody, ...HtmlPartialResponse },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as {
        subjectTemplate?: string;
        bodyTemplate?: string;
        voice?: string;
        signature?: string;
        llmEnabled?: string | boolean;
      };

      const existing = await repo.getById(id);
      if (existing === null || !canAccess(existing, request)) {
        return reply.code(404).header('content-type', 'text/html').send(toastHtml('Template not found.', 'error'));
      }
      if (!canMutate(existing, request)) {
        return reply.code(403).header('content-type', 'text/html').send(toastHtml('You cannot edit this template.', 'error'));
      }

      const validationErr = validateUpdateBody(body);
      if (validationErr !== null) {
        return reply.code(400).header('content-type', 'text/html').send(toastHtml(validationErr, 'error'));
      }

      // llm_enabled is parked behind a tooltip in the UI; we never let the
      // body change it before Phase 50. Persist whatever is already on the
      // row.
      const updated = await repo.update(
        id,
        {
          subjectTemplate: body.subjectTemplate?.trim(),
          bodyTemplate: body.bodyTemplate ?? undefined,
          voice: body.voice !== undefined ? (body.voice.trim() === '' ? null : body.voice) : undefined,
          signature: body.signature !== undefined ? (body.signature.trim() === '' ? null : body.signature) : undefined,
        },
        request.user?.username ?? 'unknown',
      );

      logMutation(storage, request, 'update', updated, { fromVersion: existing.version, toVersion: updated.version });

      return reply
        .code(200)
        .header('content-type', 'text/html')
        .send(
          `${renderRow(updated, isSystemAdmin(request))}\n` +
            `<div id="modal-container" hx-swap-oob="true"></div>\n` +
            toastHtml(`Template "${updated.eventType}" updated to v${updated.version}.`),
        );
    },
  );

  // POST /admin/notifications/override — clone a system template into the caller's org
  server.post(
    '/admin/notifications/override',
    {
      preHandler: requirePermission('admin.system', 'admin.org', 'compliance.manage'),
      schema: { body: OverrideCreateBody, ...HtmlPartialResponse },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { sourceId } = request.body as { sourceId?: string };
      if (!sourceId?.trim()) {
        return reply.code(400).header('content-type', 'text/html').send(toastHtml('sourceId is required.', 'error'));
      }
      const source = await repo.getById(sourceId.trim());
      if (source === null) {
        return reply.code(404).header('content-type', 'text/html').send(toastHtml('Source template not found.', 'error'));
      }
      if (source.scope !== 'system') {
        return reply.code(400).header('content-type', 'text/html').send(toastHtml('Only system templates can be overridden.', 'error'));
      }
      const orgId = getOrgId(request);
      if (orgId === undefined || orgId === '' || orgId === 'system') {
        return reply.code(400).header('content-type', 'text/html').send(toastHtml('Select an organization before creating an override.', 'error'));
      }

      // Reject if an override already exists for this (event, channel, org).
      const existing = await repo.list({
        eventType: source.eventType,
        channel: source.channel,
        scope: 'org',
        orgId,
      });
      if (existing.length > 0) {
        return reply.code(409).header('content-type', 'text/html').send(toastHtml('An override already exists for this event/channel.', 'error'));
      }

      const created = await repo.create({
        eventType: source.eventType,
        channel: source.channel,
        scope: 'org',
        orgId,
        subjectTemplate: source.subjectTemplate,
        bodyTemplate: source.bodyTemplate,
        voice: source.voice,
        signature: source.signature,
        llmEnabled: source.llmEnabled,
        updatedBy: request.user?.username ?? 'unknown',
      });

      logMutation(storage, request, 'create', created, { clonedFrom: source.id });

      return reply
        .code(200)
        .header('content-type', 'text/html')
        .send(
          `${renderRow(created, isSystemAdmin(request))}\n` +
            toastHtml(`Override created for ${created.eventType} (${created.channel}).`),
        );
    },
  );

  // DELETE /admin/notifications/:id — delete org template (system protected)
  server.delete(
    '/admin/notifications/:id',
    {
      preHandler: requirePermission('admin.system', 'admin.org', 'compliance.manage'),
      schema: { params: NotificationIdParams, ...HtmlPartialResponse },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const existing = await repo.getById(id);
      if (existing === null || !canAccess(existing, request)) {
        return reply.code(404).header('content-type', 'text/html').send(toastHtml('Template not found.', 'error'));
      }
      if (existing.scope === 'system') {
        return reply.code(403).header('content-type', 'text/html').send(toastHtml('System templates cannot be deleted.', 'error'));
      }
      if (!canMutate(existing, request)) {
        return reply.code(403).header('content-type', 'text/html').send(toastHtml('You cannot delete this template.', 'error'));
      }

      await repo.delete(id);
      logMutation(storage, request, 'delete', existing);

      return reply
        .code(200)
        .header('content-type', 'text/html')
        .send(toastHtml(`Override for ${existing.eventType} (${existing.channel}) deleted.`));
    },
  );

  // GET /admin/notifications/:id/history — version history modal
  server.get(
    '/admin/notifications/:id/history',
    {
      preHandler: requirePermission('admin.system', 'admin.org', 'compliance.manage'),
      schema: { params: NotificationIdParams, ...HtmlPartialResponse },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const tpl = await repo.getById(id);
      if (tpl === null || !canAccess(tpl, request)) {
        return reply.code(404).header('content-type', 'text/html').send(toastHtml('Template not found.', 'error'));
      }
      const history = await repo.listHistory(id);
      // Most recent first for display.
      const ordered = [...history].reverse();
      return reply.view('admin/notification-history.hbs', {
        template: tpl,
        history: ordered,
      });
    },
  );

  // Re-export validation constants so views can mirror max-length attributes.
  // (Compile-time only; tree-shaken when unused.)
  void ALLOWED_EVENTS;
}

// ── Row renderer (shared by PATCH and override-create) ───────────────────────

function renderRow(t: NotificationTemplate, canEditSystem: boolean): string {
  const eventLabel = escapeHtml(t.eventType);
  const channel = escapeHtml(t.channel);
  const subject = escapeHtml(t.subjectTemplate.slice(0, 80));
  const updated = new Date(t.updatedAt).toLocaleString();
  const updatedBy = escapeHtml(t.updatedBy ?? '—');
  const scopeBadge = t.scope === 'system'
    ? '<span class="badge badge--neutral">System</span>'
    : '<span class="badge badge--info">Org</span>';

  const editVisible = t.scope === 'system' ? canEditSystem : true;
  const editBtn = editVisible
    ? `<button hx-get="/admin/notifications/${encodeURIComponent(t.id)}/edit"
              hx-target="#modal-container"
              hx-swap="innerHTML"
              class="btn btn--sm btn--secondary"
              aria-label="Edit ${eventLabel}">Edit</button>`
    : '';

  const deleteBtn = t.scope === 'org'
    ? `<button hx-delete="/admin/notifications/${encodeURIComponent(t.id)}"
              hx-confirm="Delete this org override? This cannot be undone."
              hx-target="closest tr"
              hx-swap="outerHTML swap:300ms"
              class="btn btn--sm btn--danger"
              aria-label="Delete ${eventLabel}">Delete</button>`
    : '';

  return `<tr id="notification-${escapeHtml(t.id)}">
  <td data-label="Event">${eventLabel}</td>
  <td data-label="Channel">${channel}</td>
  <td data-label="Scope">${scopeBadge}</td>
  <td data-label="Subject" class="cell--wrap">${subject}</td>
  <td data-label="Version">v${t.version}</td>
  <td data-label="Updated">${escapeHtml(updated)}</td>
  <td data-label="Updated By">${updatedBy}</td>
  <td>
    <button hx-get="/admin/notifications/${encodeURIComponent(t.id)}/view"
            hx-target="#modal-container"
            hx-swap="innerHTML"
            class="btn btn--sm btn--ghost"
            aria-label="View ${eventLabel}">View</button>
    ${editBtn}
    <button hx-get="/admin/notifications/${encodeURIComponent(t.id)}/history"
            hx-target="#modal-container"
            hx-swap="innerHTML"
            class="btn btn--sm btn--ghost"
            aria-label="History for ${eventLabel}">History</button>
    ${deleteBtn}
  </td>
</tr>`;
}
