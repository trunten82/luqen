import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requirePermission } from '../../auth/middleware.js';
import { generateApiKey } from '../../auth/api-key.js';
import { toastHtml, escapeHtml } from './helpers.js';
import type { StorageAdapter } from '../../db/index.js';
import { API_KEY_ROLES, API_KEY_RATE_LIMITS, type ApiKeyRole } from '../../db/types.js';

// ---------------------------------------------------------------------------
// TTL whitelist
// ---------------------------------------------------------------------------

export const ALLOWED_TTL_DAYS = [0, 30, 90, 180, 365] as const;
type AllowedTtl = typeof ALLOWED_TTL_DAYS[number];

function isAllowedTtl(n: number): n is AllowedTtl {
  return (ALLOWED_TTL_DAYS as readonly number[]).includes(n);
}

export function parseTtl(raw: string | undefined): { valid: true; ttlDays: AllowedTtl } | { valid: false } {
  const ttlDays = (raw === undefined || raw === '') ? 90 : Number(raw);
  if (!Number.isFinite(ttlDays) || !isAllowedTtl(ttlDays)) {
    return { valid: false };
  }
  return { valid: true, ttlDays };
}

export function computeExpiresAt(ttlDays: number): string | null {
  return ttlDays > 0
    ? new Date(Date.now() + ttlDays * 86400 * 1000).toISOString()
    : null;
}

interface OrgApiKeyRow {
  readonly id: string;
  readonly label: string;
  readonly active: boolean;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  readonly role: ApiKeyRole;
  readonly orgId: string;
  readonly rateLimit: number;
  readonly expiresAt: string | null;
  readonly expired: boolean;
}

// View model for the GET handler — passed to org-api-keys.hbs
interface OrgApiKeyView {
  readonly id: string;
  readonly label: string;
  readonly active: boolean;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  readonly role: ApiKeyRole;
  readonly orgId: string;
  readonly rateLimit: number;
  readonly expiresAt: string | null;
  readonly expired: boolean;
}

function statusBadge(active: boolean): string {
  return active
    ? '<span class="badge badge--completed">Active</span>'
    : '<span class="badge badge--failed">Revoked</span>';
}

function formatDate(iso: string | null): string {
  if (iso === null) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function roleBadge(role: string): string {
  if (role === 'admin') return '<span class="badge badge--warning">Admin</span>';
  if (role === 'read-only') return '<span class="badge badge--info">Read Only</span>';
  if (role === 'scan-only') return '<span class="badge badge--info">Scan Only</span>';
  return `<span class="badge">${escapeHtml(role)}</span>`;
}

function keyRowHtml(row: OrgApiKeyRow): string {
  const revokeButton = row.active
    ? `<button hx-post="/admin/org-api-keys/${encodeURIComponent(row.id)}/revoke"
            hx-target="#org-api-key-${row.id}"
            hx-swap="outerHTML"
            hx-confirm="Revoke this API key?"
            class="btn btn--sm btn--danger">Revoke</button>`
    : '';

  return `<tr id="org-api-key-${row.id}">
  <td data-label="Label">${escapeHtml(row.label)}</td>
  <td data-label="Role">${roleBadge(row.role)}</td>
  <td data-label="Rate Limit">${row.rateLimit} req/min</td>
  <td data-label="Status">${statusBadge(row.active)}</td>
  <td data-label="Created">${formatDate(row.createdAt)}</td>
  <td data-label="Last Used">${formatDate(row.lastUsedAt)}</td>
  <td>${revokeButton}</td>
</tr>`;
}

// ---------------------------------------------------------------------------
// Revoked-row HTML helper (used by the revoke OOB response)
// Note: uses hardcoded English to match pre-Phase-14 route helper convention.
// TODO(future): migrate route helpers to use the i18n helper in a future phase.
// ---------------------------------------------------------------------------
function revokedRowInnerHtml(row: OrgApiKeyView): string {
  // T-14-15: escapeHtml on all user-supplied label content (XSS mitigation)
  const expiredSuffix = row.expired
    ? ' <small class="text-muted">(Expired)</small>'
    : '';
  const deleteButton = `<button hx-delete="/admin/org-api-keys/${encodeURIComponent(row.id)}"
          hx-target="#org-api-key-${row.id}"
          hx-swap="outerHTML"
          hx-confirm="Permanently delete this revoked key?"
          class="btn btn--sm btn--danger">Delete</button>`;
  return `<td data-label="Label">${escapeHtml(row.label)}</td>
  <td data-label="Role">${roleBadge(row.role)}</td>
  <td data-label="Rate Limit">${row.rateLimit} req/min</td>
  <td data-label="Status"><span class="badge badge--error">Revoked</span>${expiredSuffix}</td>
  <td data-label="Created">${formatDate(row.createdAt)}</td>
  <td data-label="Last Used">${formatDate(row.lastUsedAt)}</td>
  <td>${deleteButton}</td>`;
}

export async function orgApiKeyRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
): Promise<void> {
  // GET /admin/org-api-keys — list org-scoped keys
  server.get(
    '/admin/org-api-keys',
    { preHandler: requirePermission('admin.org') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const orgId = request.user?.currentOrgId;

      if (orgId === undefined || orgId === null) {
        return reply.redirect('/home?toast=Select+an+organization+first+to+manage+API+keys');
      }

      const records = await storage.apiKeys.listKeys(orgId);
      const now = Date.now();

      const toView = (k: typeof records[number]): OrgApiKeyView => ({
        id: k.id,
        label: k.label,
        active: k.active,
        createdAt: k.createdAt,
        lastUsedAt: k.lastUsedAt,
        role: k.role,
        orgId: k.orgId,
        rateLimit: API_KEY_RATE_LIMITS[k.role],
        expiresAt: k.expiresAt,
        expired: k.expiresAt !== null && new Date(k.expiresAt).getTime() < now,
      });

      const activeKeys = records.filter(k => k.active).map(toView);
      const revokedKeys = records.filter(k => !k.active).map(toView);

      return reply.view('admin/org-api-keys.hbs', {
        pageTitle: 'Organization API Keys',
        currentPath: '/admin/org-api-keys',
        user: request.user,
        activeKeys,
        revokedKeys,
        revokedCount: revokedKeys.length,
        orgId,
      });
    },
  );

  // GET /admin/org-api-keys/new — render creation form modal
  server.get(
    '/admin/org-api-keys/new',
    { preHandler: requirePermission('admin.org') },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.view('admin/org-api-key-form.hbs', { orgScoped: true });
    },
  );

  // POST /admin/org-api-keys — create org-scoped key
  server.post(
    '/admin/org-api-keys',
    { preHandler: requirePermission('admin.org') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const orgId = request.user?.currentOrgId;

      if (orgId === undefined || orgId === null) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml('Select an organization first to manage API keys.', 'error'));
      }

      const body = request.body as { label?: string; role?: string; ttl?: string };
      const label = body.label?.trim() || 'default';
      const role: ApiKeyRole = API_KEY_ROLES.includes(body.role as ApiKeyRole)
        ? (body.role as ApiKeyRole)
        : 'admin';

      if (label.length > 100) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml('Label must be 100 characters or fewer.', 'error'));
      }

      const ttlResult = parseTtl(body.ttl);
      if (!ttlResult.valid) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml('Invalid expiry option.', 'error'));
      }
      const expiresAt = computeExpiresAt(ttlResult.ttlDays);

      try {
        const plaintextKey = generateApiKey();
        const id = await storage.apiKeys.storeKey(plaintextKey, label, orgId, role, expiresAt);

        const row: OrgApiKeyRow = {
          id,
          label,
          active: true,
          createdAt: new Date().toISOString(),
          lastUsedAt: null,
          role,
          orgId,
          rateLimit: API_KEY_RATE_LIMITS[role],
          expiresAt,
          expired: false,
        };

        void storage.audit.log({
          actor: request.user?.username ?? 'unknown',
          actorId: request.user?.id,
          action: 'api_key.create',
          resourceType: 'api_key',
          resourceId: id,
          details: { label, role, orgId, expiresAt },
          ipAddress: request.ip,
        });

        const newKeyAlert = `<div id="new-key-alert" hx-swap-oob="true" class="alert alert--warning" role="alert" style="margin-bottom:var(--space-md)">
  <div class="alert__body">
    <p class="alert__title">New API Key Generated</p>
    <p>Save this key now — it will not be shown again:</p>
    <code style="display:block;padding:var(--space-sm);background:var(--bg-tertiary);border-radius:var(--border-radius);word-break:break-all;margin-top:var(--space-xs)">${plaintextKey}</code>
  </div>
</div>`;

        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(
            `${keyRowHtml(row)}\n<div id="modal-container" hx-swap-oob="true"></div>\n${newKeyAlert}\n${toastHtml(`API key "${escapeHtml(label)}" created successfully.`)}`,
          );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create API key';
        return reply
          .code(500)
          .header('content-type', 'text/html')
          .send(toastHtml(message, 'error'));
      }
    },
  );

  // POST /admin/org-api-keys/:id/revoke — revoke key with org_id guard
  server.post(
    '/admin/org-api-keys/:id/revoke',
    { preHandler: requirePermission('admin.org') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const orgId = request.user?.currentOrgId;

      if (orgId === undefined || orgId === null) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml('Select an organization first to manage API keys.', 'error'));
      }

      try {
        // Capture pre-revoke revoked count to detect the "first revoke" edge case.
        const beforeRecords = await storage.apiKeys.listKeys(orgId);
        const beforeRevokedCount = beforeRecords.filter(k => !k.active).length;

        // org_id guard enforced at DB level: AND org_id = ? prevents cross-org revocation
        await storage.apiKeys.revokeKey(id, orgId);

        const afterRecords = await storage.apiKeys.listKeys(orgId);
        const record = afterRecords.find(k => k.id === id);

        if (record === undefined) {
          return reply
            .code(404)
            .header('content-type', 'text/html')
            .send(toastHtml('API key not found.', 'error'));
        }

        void storage.audit.log({
          actor: request.user?.username ?? 'unknown',
          actorId: request.user?.id,
          action: 'api_key.revoke',
          resourceType: 'api_key',
          resourceId: id,
          details: { label: record.label, orgId },
          ipAddress: request.ip,
        });

        // Edge case: this is the first revoke — the <details> revoked section
        // does not exist in the DOM yet, so OOB swaps into #org-api-keys-revoked-body
        // would silently fail. Trigger a full page refresh instead.
        if (beforeRevokedCount === 0) {
          return reply
            .code(200)
            .header('HX-Refresh', 'true')
            .header('content-type', 'text/html')
            .send('');
        }

        const newRevokedCount = afterRecords.filter(k => !k.active).length;
        const row: OrgApiKeyView = {
          id: record.id,
          label: record.label,
          active: record.active,
          createdAt: record.createdAt,
          lastUsedAt: record.lastUsedAt,
          role: record.role,
          orgId: record.orgId,
          rateLimit: API_KEY_RATE_LIMITS[record.role],
          expiresAt: record.expiresAt,
          expired: record.expiresAt !== null && new Date(record.expiresAt).getTime() < Date.now(),
        };

        // Main response body: empty string — the revoke button's hx-target is the active
        // row with hx-swap=outerHTML, so the empty body removes the active row.
        // OOB 1 (wrapped in <template> per feedback_htmx_oob_in_table.md): appends
        //   the new revoked row to #org-api-keys-revoked-body.
        // OOB 2: updates the count span in the <details> summary.
        // Tail: success toast.
        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(
            `<template><tr id="org-api-key-${row.id}" hx-swap-oob="beforeend:#org-api-keys-revoked-body">${revokedRowInnerHtml(row)}</tr></template>` +
            `<span id="org-api-keys-revoked-count" hx-swap-oob="true">${newRevokedCount}</span>` +
            toastHtml(`API key "${escapeHtml(record.label)}" revoked.`),
          );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to revoke API key';
        return reply
          .code(500)
          .header('content-type', 'text/html')
          .send(toastHtml(message, 'error'));
      }
    },
  );

  // DELETE /admin/org-api-keys/:id — hard-delete a revoked key (org-scoped)
  server.delete(
    '/admin/org-api-keys/:id',
    { preHandler: requirePermission('admin.org') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const orgId = request.user?.currentOrgId;

      if (orgId === undefined || orgId === null) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml('Select an organization first to manage API keys.', 'error'));
      }

      try {
        // Look up label BEFORE delete for the audit entry
        const records = await storage.apiKeys.listKeys(orgId);
        const record = records.find(k => k.id === id);

        const ok = await storage.apiKeys.deleteKey(id, orgId);
        if (!ok) {
          return reply
            .code(404)
            .header('content-type', 'text/html')
            .send(toastHtml('API key not found, still active, or not in your organization.', 'error'));
        }

        void storage.audit.log({
          actor: request.user?.username ?? 'unknown',
          actorId: request.user?.id,
          action: 'api_key.delete',
          resourceType: 'api_key',
          resourceId: id,
          details: { label: record?.label ?? '(unknown)', orgId },
          ipAddress: request.ip,
        });

        const afterDeleteRecords = await storage.apiKeys.listKeys(orgId);
        const remainingRevoked = afterDeleteRecords.filter(k => !k.active).length;

        // Empty body removes the row via the button's hx-swap=outerHTML.
        // OOB updates the count span in the <details> summary.
        // If remainingRevoked === 0 the <details> section will linger with "(0)"
        // until the next full page load — acceptable v1 trade-off.
        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(
            `<span id="org-api-keys-revoked-count" hx-swap-oob="true">${remainingRevoked}</span>` +
            toastHtml(`API key "${escapeHtml(record?.label ?? '')}" deleted.`),
          );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to delete API key';
        return reply
          .code(500)
          .header('content-type', 'text/html')
          .send(toastHtml(message, 'error'));
      }
    },
  );
}
