import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requirePermission } from '../../auth/middleware.js';
import { generateApiKey } from '../../auth/api-key.js';
import { toastHtml, escapeHtml } from './helpers.js';
import type { StorageAdapter } from '../../db/index.js';
import { API_KEY_ROLES, API_KEY_RATE_LIMITS, type ApiKeyRole } from '../../db/types.js';

interface OrgApiKeyRow {
  readonly id: string;
  readonly label: string;
  readonly active: boolean;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  readonly role: ApiKeyRole;
  readonly orgId: string;
  readonly rateLimit: number;
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
      const keys: OrgApiKeyRow[] = records.map(k => ({
        id: k.id,
        label: k.label,
        active: k.active,
        createdAt: k.createdAt,
        lastUsedAt: k.lastUsedAt,
        role: k.role,
        orgId: k.orgId,
        rateLimit: API_KEY_RATE_LIMITS[k.role],
      }));

      return reply.view('admin/org-api-keys.hbs', {
        pageTitle: 'Organization API Keys',
        currentPath: '/admin/org-api-keys',
        user: request.user,
        keys,
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

      const body = request.body as { label?: string; role?: string };
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

      try {
        const plaintextKey = generateApiKey();
        const id = await storage.apiKeys.storeKey(plaintextKey, label, orgId, role);

        const row: OrgApiKeyRow = {
          id,
          label,
          active: true,
          createdAt: new Date().toISOString(),
          lastUsedAt: null,
          role,
          orgId,
          rateLimit: API_KEY_RATE_LIMITS[role],
        };

        void storage.audit.log({
          actor: request.user?.username ?? 'unknown',
          actorId: request.user?.id,
          action: 'api_key.create',
          resourceType: 'api_key',
          resourceId: id,
          details: { label, role, orgId },
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
        // org_id guard enforced at DB level: AND org_id = ? prevents cross-org revocation
        await storage.apiKeys.revokeKey(id, orgId);

        const records = await storage.apiKeys.listKeys(orgId);
        const record = records.find(k => k.id === id);

        if (record === undefined) {
          return reply
            .code(404)
            .header('content-type', 'text/html')
            .send(toastHtml('API key not found.', 'error'));
        }

        const row: OrgApiKeyRow = {
          ...record,
          rateLimit: API_KEY_RATE_LIMITS[record.role],
        };

        void storage.audit.log({
          actor: request.user?.username ?? 'unknown',
          actorId: request.user?.id,
          action: 'api_key.delete',
          resourceType: 'api_key',
          resourceId: id,
          details: { label: record.label, orgId },
          ipAddress: request.ip,
        });

        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(
            `${keyRowHtml(row)}\n${toastHtml(`API key "${escapeHtml(record.label)}" revoked.`)}`,
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
}
