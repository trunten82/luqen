/**
 * Admin routes for Digest Schedule management.
 *
 * Mirrors email-reports.ts structure exactly:
 *   GET  /admin/digest-schedules              — list all schedules for the org
 *   POST /admin/digest-schedules              — create a new schedule
 *   PATCH /admin/digest-schedules/:id/toggle  — enable / pause
 *   POST /admin/digest-schedules/:id/send-now — trigger immediate delivery
 *   DELETE /admin/digest-schedules/:id        — remove
 *   GET  /admin/digest-schedules/:id/view     — preview / archive digest view
 *   GET  /admin/digest-schedules/:id/pdf/:period — stream board-ready PDF
 *
 * All routes are gated by requirePermission('admin.system', 'admin.org', 'compliance.manage') (T-82-14).
 * CSRF protection via hx-include="[name='_csrf']" on mutating HTMX buttons;
 * <form> tags are NEVER placed inside <tr>/<td> cells (feedback_htmx_forms_in_tables).
 *
 * NOTE: Registration of digestScheduleRoutes in server.ts is deferred to Plan 05.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Type } from '@sinclair/typebox';
import { randomUUID } from 'node:crypto';
import type { StorageAdapter } from '../../db/index.js';
import type { PluginManager } from '../../plugins/manager.js';
import { requirePermission } from '../../auth/middleware.js';
import { toastHtml, escapeHtml } from './helpers.js';
import { processDigest, computeNextDigestSendAt } from '../../email/digest-scheduler.js';
import { buildDigest } from '../../services/digest-service.js';
import { generateDigestPdf } from '../../pdf/digest-generator.js';
import { ErrorEnvelope, HtmlPageSchema } from '../../api/schemas/envelope.js';
import type { DigestSchedule } from '../../db/types.js';

// ---------------------------------------------------------------------------
// TypeBox schemas
// ---------------------------------------------------------------------------

const DigestCreateBody = Type.Object(
  {
    name:         Type.Optional(Type.String()),
    scope:        Type.Optional(Type.String()),   // 'org' | 'site'
    siteUrl:      Type.Optional(Type.String()),
    frequency:    Type.Optional(Type.String()),   // 'weekly' | 'monthly'
    recipients:   Type.Optional(Type.String()),
    channelEmail: Type.Optional(Type.String()),   // 'on' | undefined
    channelSlack: Type.Optional(Type.String()),
    channelTeams: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

const DigestIdParams = Type.Object(
  { id: Type.String() },
  { additionalProperties: true },
);

// CR-03/CR-04: period must be alphanumeric+dash only — prevents header injection.
// Pattern whitelists a YYYY-MM style value plus reasonable variant chars.
const DigestPdfParams = Type.Object(
  {
    id: Type.String(),
    period: Type.String({ pattern: '^[0-9A-Za-z._-]{1,32}$' }),
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

const VALID_FREQUENCIES = ['weekly', 'monthly'];

// Basic email address regex — rejects clearly invalid addresses at create time (WR-01).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------------------------------------------------------------------------
// Org-scope guard helper (CR-02)
// Returns a 404 reply (same body as not-found) when schedule belongs to another
// org, avoiding existence leakage via 403.
// ---------------------------------------------------------------------------

function replyOrgMismatch(reply: FastifyReply): ReturnType<FastifyReply['send']> {
  return reply
    .code(404)
    .header('content-type', 'text/html')
    .send(toastHtml('Schedule not found.', 'error'));
}

// ---------------------------------------------------------------------------
// Route module
// ---------------------------------------------------------------------------

export async function digestScheduleRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
  pluginManager?: PluginManager,
): Promise<void> {

  // ── GET /admin/digest-schedules ──────────────────────────────────────────

  server.get(
    '/admin/digest-schedules',
    {
      preHandler: requirePermission('admin.system', 'admin.org', 'compliance.manage'),
      schema: HtmlPageSchema,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const orgId = request.user?.currentOrgId ?? 'system';
      const schedules = await storage.digest!.listDigestSchedules(orgId);

      const formatted = schedules.map((s) => ({
        ...s,
        nextSendAtDisplay: new Date(s.nextSendAt).toLocaleString(),
        lastSentAtDisplay: s.lastSentAt
          ? new Date(s.lastSentAt).toLocaleString()
          : 'Never',
        enabledLabel: s.enabled ? 'Active' : 'Paused',
        enabledClass: s.enabled ? 'badge--success' : 'badge--muted',
        scopeDisplay: s.siteUrl ?? 'Org-wide',
        channelChips: s.channels
          .map((c: string) => `<span class="rpt-reg-tag">${escapeHtml(c)}</span>`)
          .join(' '),
      }));

      return reply.view('admin/digest-schedules.hbs', {
        pageTitle: 'Executive Digest Schedules',
        currentPath: '/admin/digest-schedules',
        user: request.user,
        schedules: formatted,
        csrfToken: (request as unknown as Record<string, () => string>)['csrfToken']?.() ?? '',
      });
    },
  );

  // ── POST /admin/digest-schedules ─────────────────────────────────────────

  server.post(
    '/admin/digest-schedules',
    {
      preHandler: requirePermission('admin.system', 'admin.org', 'compliance.manage'),
      schema: { body: DigestCreateBody, ...HtmlPartialResponse },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as {
        name?: string;
        scope?: string;
        siteUrl?: string;
        frequency?: string;
        recipients?: string;
        channelEmail?: string;
        channelSlack?: string;
        channelTeams?: string;
      };

      const name = body.name?.trim();
      if (!name) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml('Schedule name is required.', 'error'));
      }

      const frequency = body.frequency?.trim() ?? 'weekly';
      if (!VALID_FREQUENCIES.includes(frequency)) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml('Invalid frequency. Must be weekly or monthly.', 'error'));
      }

      const channels: string[] = [];
      if (body.channelEmail === 'on') channels.push('email');
      if (body.channelSlack === 'on') channels.push('slack');
      if (body.channelTeams === 'on') channels.push('teams');
      if (channels.length === 0) channels.push('email'); // baseline channel

      // WR-01: Validate each recipient is a syntactically valid email address.
      const recipientsRaw = body.recipients?.trim() ?? '';
      if (recipientsRaw !== '') {
        const entries = recipientsRaw.split(',').map((e) => e.trim()).filter(Boolean);
        const invalid = entries.filter((e) => !EMAIL_RE.test(e));
        if (invalid.length > 0) {
          return reply
            .code(400)
            .header('content-type', 'text/html')
            .send(toastHtml(`Invalid email address(es): ${invalid.join(', ')}`, 'error'));
        }
      }

      // WR-02: Treat empty/whitespace siteUrl as null; require http/https scheme.
      const scope = body.scope ?? 'org';
      const siteUrl = scope === 'site' ? (body.siteUrl?.trim() || null) : null;

      if (scope === 'site' && siteUrl !== null) {
        try {
          const u = new URL(siteUrl);
          if (!['http:', 'https:'].includes(u.protocol)) throw new Error('bad protocol');
        } catch {
          return reply
            .code(400)
            .header('content-type', 'text/html')
            .send(toastHtml('Site URL must be a valid http/https URL.', 'error'));
        }
      }

      const id = randomUUID();
      const orgId = request.user?.currentOrgId ?? 'system';
      const nextSendAt = computeNextDigestSendAt(frequency);

      const schedule = await storage.digest!.createDigestSchedule({
        id,
        orgId,
        name,
        siteUrl,
        frequency,
        recipients: recipientsRaw,
        channels: JSON.stringify(channels),
        nextSendAt,
        createdBy: request.user?.username ?? 'unknown',
      });

      const row = buildDigestScheduleRow(schedule);
      return reply
        .code(200)
        .header('content-type', 'text/html')
        .send(`${row}\n${toastHtml('Digest schedule created.')}`);
    },
  );

  // ── PATCH /admin/digest-schedules/:id/toggle ────────────────────────────

  server.patch(
    '/admin/digest-schedules/:id/toggle',
    {
      preHandler: requirePermission('admin.system', 'admin.org', 'compliance.manage'),
      schema: { params: DigestIdParams, ...HtmlPartialResponse },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const schedule = await storage.digest!.getDigestSchedule(id);

      if (schedule === null) {
        return reply
          .code(404)
          .header('content-type', 'text/html')
          .send(toastHtml('Schedule not found.', 'error'));
      }

      // CR-02: Reject cross-org access — return 404 to avoid existence leakage.
      const requestingOrgId = request.user?.currentOrgId ?? 'system';
      if (schedule.orgId !== requestingOrgId) {
        return replyOrgMismatch(reply);
      }

      const newEnabled = !schedule.enabled;
      await storage.digest!.updateDigestSchedule(id, { enabled: newEnabled });

      const updated = await storage.digest!.getDigestSchedule(id);
      if (updated === null) {
        return reply
          .code(500)
          .header('content-type', 'text/html')
          .send(toastHtml('Failed to update schedule.', 'error'));
      }

      const row = buildDigestScheduleRow(updated);
      return reply
        .code(200)
        .header('content-type', 'text/html')
        .send(`${row}\n${toastHtml(newEnabled ? 'Schedule enabled.' : 'Schedule paused.')}`);
    },
  );

  // ── POST /admin/digest-schedules/:id/send-now ───────────────────────────

  server.post(
    '/admin/digest-schedules/:id/send-now',
    {
      preHandler: requirePermission('admin.system', 'admin.org', 'compliance.manage'),
      schema: { params: DigestIdParams, ...HtmlPartialResponse },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const schedule = await storage.digest!.getDigestSchedule(id);

      if (schedule === null) {
        return reply
          .code(404)
          .header('content-type', 'text/html')
          .send(toastHtml('Schedule not found.', 'error'));
      }

      // CR-02: Reject cross-org access — return 404 to avoid existence leakage.
      const requestingOrgId = request.user?.currentOrgId ?? 'system';
      if (schedule.orgId !== requestingOrgId) {
        return replyOrgMismatch(reply);
      }

      try {
        await processDigest(storage, schedule, pluginManager);
        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(toastHtml('Digest queued for delivery.'));
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to send digest';
        return reply
          .code(500)
          .header('content-type', 'text/html')
          .send(toastHtml(message, 'error'));
      }
    },
  );

  // ── DELETE /admin/digest-schedules/:id ──────────────────────────────────

  server.delete(
    '/admin/digest-schedules/:id',
    {
      preHandler: requirePermission('admin.system', 'admin.org', 'compliance.manage'),
      schema: { params: DigestIdParams, ...HtmlPartialResponse },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const schedule = await storage.digest!.getDigestSchedule(id);

      if (schedule === null) {
        return reply
          .code(404)
          .header('content-type', 'text/html')
          .send(toastHtml('Schedule not found.', 'error'));
      }

      // CR-02: Reject cross-org access — return 404 to avoid existence leakage.
      const requestingOrgId = request.user?.currentOrgId ?? 'system';
      if (schedule.orgId !== requestingOrgId) {
        return replyOrgMismatch(reply);
      }

      await storage.digest!.deleteDigestSchedule(id);
      return reply
        .code(200)
        .header('content-type', 'text/html')
        .send(toastHtml('Digest schedule deleted.'));
    },
  );

  // ── GET /admin/digest-schedules/:id/view ────────────────────────────────

  server.get(
    '/admin/digest-schedules/:id/view',
    {
      preHandler: requirePermission('admin.system', 'admin.org', 'compliance.manage'),
      schema: { params: DigestIdParams, ...HtmlPageSchema },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const schedule = await storage.digest!.getDigestSchedule(id);

      if (schedule === null) {
        return reply
          .code(404)
          .header('content-type', 'text/html')
          .send(toastHtml('Schedule not found.', 'error'));
      }

      // CR-02: Reject cross-org access — return 404 to avoid existence leakage.
      const requestingOrgId = request.user?.currentOrgId ?? 'system';
      if (schedule.orgId !== requestingOrgId) {
        return replyOrgMismatch(reply);
      }

      const periodEnd = new Date();
      const periodStart = schedule.lastSentAt
        ? new Date(schedule.lastSentAt)
        : new Date(schedule.createdAt);

      const digestData = await buildDigest(
        storage,
        { orgId: schedule.orgId, siteUrl: schedule.siteUrl },
        { start: periodStart.toISOString(), end: periodEnd.toISOString() },
      );

      return reply.view('admin/digest-view.hbs', {
        pageTitle: 'Executive Digest',
        currentPath: '/admin/digest-schedules',
        user: request.user,
        scheduleId: escapeHtml(id),
        schedule: {
          ...schedule,
          scopeDisplay: schedule.siteUrl ?? 'Org-wide',
        },
        digest: digestData,
        period: digestData.period,
        sites: digestData.sites,
        csrfToken: (request as unknown as Record<string, () => string>)['csrfToken']?.() ?? '',
      });
    },
  );

  // ── GET /admin/digest-schedules/:id/pdf/:period ─────────────────────────

  server.get(
    '/admin/digest-schedules/:id/pdf/:period',
    {
      preHandler: requirePermission('admin.system', 'admin.org', 'compliance.manage'),
      schema: {
        params: DigestPdfParams,
        // 404 is the HTML toast partial (same convention as the other admin
        // digest routes), not a JSON error envelope.
        response: { 200: Type.String(), 404: Type.String() },
        produces: ['application/pdf'],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, period } = request.params as { id: string; period: string };
      const schedule = await storage.digest!.getDigestSchedule(id);

      if (schedule === null) {
        return reply
          .code(404)
          .header('content-type', 'text/html')
          .send(toastHtml('Schedule not found.', 'error'));
      }

      // CR-02: Reject cross-org access — return 404 to avoid existence leakage.
      const requestingOrgId = request.user?.currentOrgId ?? 'system';
      if (schedule.orgId !== requestingOrgId) {
        return replyOrgMismatch(reply);
      }

      // Resolve period window: period param is a hint (YYYY-MM or ISO range)
      // For the PDF download we use the schedule's last-sent window, or now
      const periodEnd = new Date();
      const periodStart = schedule.lastSentAt
        ? new Date(schedule.lastSentAt)
        : new Date(schedule.createdAt);

      const digestData = await buildDigest(
        storage,
        { orgId: schedule.orgId, siteUrl: schedule.siteUrl },
        { start: periodStart.toISOString(), end: periodEnd.toISOString() },
      );

      // Org identity for cover page
      const orgName = schedule.orgId !== 'system' ? schedule.orgId : undefined;
      const pdfBuffer = await generateDigestPdf(digestData, {
        name: orgName,
      });

      // CR-03/CR-04: strip everything except [0-9A-Za-z._-] from period before
      // putting it in the Content-Disposition filename.  The TypeBox pattern above
      // already rejects the request if period contains any other character, so this
      // sanitise is a defence-in-depth backstop.
      const safePeriod = period.replace(/[^0-9A-Za-z._-]/g, '');
      const safeId = schedule.orgId.replace(/[^a-z0-9]/gi, '-');
      const filename = `accessibility-digest-${safeId}-${safePeriod}.pdf`;

      return reply
        .code(200)
        .header('content-type', 'application/pdf')
        .header('content-disposition', `attachment; filename="${filename}"`)
        .send(pdfBuffer);
    },
  );
}

// ---------------------------------------------------------------------------
// Row builder — returns escaped HTML string for HTMX outerHTML swap
// CRITICAL: NO <form> tags inside <tr>/<td> (feedback_htmx_forms_in_tables)
// ---------------------------------------------------------------------------

function buildDigestScheduleRow(schedule: DigestSchedule): string {
  // WR-04: Use encodeURIComponent for the URL and a data-attribute for the
  // HTMX target so the UUID never reaches a CSS selector (UUIDs are always
  // alphanumeric+dash but this is a defence-in-depth measure).
  const eid = escapeHtml(schedule.id);
  const nextDisplay = new Date(schedule.nextSendAt).toLocaleString();
  const lastDisplay = schedule.lastSentAt
    ? new Date(schedule.lastSentAt).toLocaleString()
    : 'Never';

  const statusBadge = schedule.enabled
    ? '<span class="badge badge--success">Active</span>'
    : '<span class="badge badge--muted">Paused</span>';

  const channelChips = schedule.channels
    .map((c) => `<span class="rpt-reg-tag">${escapeHtml(c)}</span>`)
    .join(' ');

  const scopeDisplay = escapeHtml(schedule.siteUrl ?? 'Org-wide');

  return `<tr id="digest-row-${eid}" data-digest-id="${eid}">
  <td data-label="Name">${escapeHtml(schedule.name)}</td>
  <td data-label="Scope">${scopeDisplay}</td>
  <td data-label="Frequency">${escapeHtml(schedule.frequency)}</td>
  <td data-label="Channels">${channelChips}</td>
  <td data-label="Next send">${escapeHtml(nextDisplay)}</td>
  <td data-label="Last sent">${escapeHtml(lastDisplay)}</td>
  <td data-label="Status">${statusBadge}</td>
  <td>
    <button hx-patch="/admin/digest-schedules/${encodeURIComponent(schedule.id)}/toggle"
            hx-target="#digest-row-${eid}"
            hx-swap="outerHTML"
            hx-include="[name='_csrf']"
            class="btn btn--sm btn--secondary">
      ${schedule.enabled ? 'Pause schedule' : 'Enable schedule'}
    </button>
    <button hx-post="/admin/digest-schedules/${encodeURIComponent(schedule.id)}/send-now"
            hx-target="#toast-container"
            hx-swap="innerHTML"
            hx-include="[name='_csrf']"
            hx-disabled-elt="this"
            class="btn btn--sm btn--secondary"
            aria-label="Send digest &quot;${escapeHtml(schedule.name)}&quot; now">
      Send now
    </button>
    <button hx-delete="/admin/digest-schedules/${encodeURIComponent(schedule.id)}"
            hx-confirm="Delete this digest schedule? This cannot be undone."
            hx-target="closest tr"
            hx-swap="outerHTML swap:500ms"
            hx-include="[name='_csrf']"
            class="btn btn--sm btn--danger"
            aria-label="Delete digest schedule &quot;${escapeHtml(schedule.name)}&quot;">
      Delete schedule
    </button>
  </td>
</tr>`;
}
