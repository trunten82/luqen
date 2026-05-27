import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Type } from '@sinclair/typebox';
import { requirePermission } from '../../auth/middleware.js';
import { generateApiKey } from '../../auth/api-key.js';
import { toastHtml, escapeHtml } from './helpers.js';
import type { StorageAdapter } from '../../db/index.js';
import { API_KEY_ROLES, type ApiKeyRole } from '../../db/types.js';
import { ErrorEnvelope, HtmlPageSchema } from '../../api/schemas/envelope.js';

// Phase 41.1-03 — local TypeBox shapes for OpenAPI fidelity.
// Routes here return HTMX partials (text/html), so request bodies/params are
// typed; responses are advertised as String per the dashboard HTML pattern.
const ApiKeyCreateBody = Type.Object(
  {
    label: Type.Optional(Type.String()),
    role: Type.Optional(Type.String()),
    orgId: Type.Optional(Type.String()),
    ttl: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

const TTL_ALLOWED_DAYS = new Set([0, 30, 90, 180, 365]);

function resolveExpiresAt(ttlRaw: string | undefined): string | null {
  // Mirrors org-api-keys: 0 = never, otherwise N days from now.
  const ttl = Number.parseInt((ttlRaw ?? '90').trim(), 10);
  if (!Number.isFinite(ttl) || !TTL_ALLOWED_DAYS.has(ttl)) return null;
  if (ttl === 0) return null;
  return new Date(Date.now() + ttl * 86400 * 1000).toISOString();
}

const ApiKeyIdParams = Type.Object(
  { id: Type.String() },
  { additionalProperties: true },
);

const ApiKeyListQuery = Type.Object(
  { orgId: Type.Optional(Type.String()) },
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

interface ApiKeyRow {
  readonly id: string;
  readonly label: string;
  readonly active: number;
  readonly created_at: string;
  readonly last_used_at: string | null;
  readonly role: string;
  readonly org_id?: string;
  readonly expires_at?: string | null;
}

function statusBadge(active: number, expired: boolean = false): string {
  if (active && expired) return '<span class="badge badge--warning">Expired</span>';
  return active
    ? '<span class="badge badge--completed">Active</span>'
    : '<span class="badge badge--failed">Revoked</span>';
}

function isExpired(expiresAt: string | null | undefined): boolean {
  return expiresAt != null && new Date(expiresAt).getTime() < Date.now();
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

function keyRowHtml(row: ApiKeyRow): string {
  const expired = isExpired(row.expires_at);
  const deleteBtn = row.active
    ? ''
    : `<button hx-delete="/admin/api-keys/${encodeURIComponent(row.id)}"
              hx-target="#api-key-${row.id}"
              hx-swap="outerHTML"
              hx-confirm="Permanently delete this revoked key?"
              class="btn btn--sm btn--danger">Delete</button>`;
  return `<tr id="api-key-${row.id}">
  <td data-label="Label">${escapeHtml(row.label)}</td>
  <td data-label="Role">${roleBadge(row.role ?? 'admin')}</td>
  <td data-label="Organization">${escapeHtml(row.org_id ?? 'system')}</td>
  <td data-label="Status">${statusBadge(row.active, expired)}</td>
  <td data-label="Created">${formatDate(row.created_at)}</td>
  <td data-label="Expires">${row.expires_at ? formatDate(row.expires_at) : '<span class="text-muted">Never</span>'}</td>
  <td data-label="Last Used">${formatDate(row.last_used_at)}</td>
  <td>
    <button hx-get="/admin/api-keys/${encodeURIComponent(row.id)}/view"
            hx-target="#modal-container"
            hx-swap="innerHTML"
            class="btn btn--sm btn--secondary"
            aria-label="View ${escapeHtml(row.label)}">View</button>
    ${deleteBtn}
  </td>
</tr>`;
}

export async function apiKeyRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
): Promise<void> {
  // GET /admin/api-keys — list all keys (supports ?orgId= filter)
  server.get(
    '/admin/api-keys',
    {
      preHandler: requirePermission('admin.system'),
      schema: {
        ...HtmlPageSchema,
        querystring: ApiKeyListQuery,
        response: {
          200: Type.String(),
          401: ErrorEnvelope,
          403: ErrorEnvelope,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as { orgId?: string };
      const orgIdFilter = query.orgId?.trim() || undefined;
      const keys = await storage.apiKeys.listKeys(orgIdFilter) as unknown as readonly ApiKeyRow[];
      const activeKeys = keys.filter((k) => k.active === 1);
      const revokedKeys = keys.filter((k) => k.active === 0);

      return reply.view('admin/api-keys.hbs', {
        pageTitle: 'API Keys',
        currentPath: '/admin/api-keys',
        user: request.user,
        keys,
        activeKeys,
        revokedKeys,
        revokedCount: revokedKeys.length,
        orgIdFilter,
      });
    },
  );

  // GET /admin/api-keys/:id/view — view key detail with revoke option
  server.get(
    '/admin/api-keys/:id/view',
    {
      preHandler: requirePermission('admin.system'),
      schema: {
        params: ApiKeyIdParams,
        ...HtmlPartialResponse,
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const rawKey = await storage.apiKeys.listKeys();
      const row = (rawKey as unknown as ApiKeyRow[]).find(k => k.id === id);

      if (row === undefined) {
        return reply.code(404).header('content-type', 'text/html').send(toastHtml('API key not found.', 'error'));
      }

      return reply.view('admin/api-key-view.hbs', {
        key: {
          ...row,
          createdDisplay: formatDate(row.created_at),
          lastUsedDisplay: formatDate(row.last_used_at),
        },
      });
    },
  );

  // GET /admin/api-keys/new — modal form to create a new key
  server.get(
    '/admin/api-keys/new',
    {
      preHandler: requirePermission('admin.system'),
      schema: HtmlPartialResponse,
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.view('admin/api-key-form.hbs', {});
    },
  );

  // POST /admin/api-keys — create new API key
  server.post(
    '/admin/api-keys',
    {
      preHandler: requirePermission('admin.system'),
      schema: {
        body: ApiKeyCreateBody,
        ...HtmlPartialResponse,
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as { label?: string; role?: string; orgId?: string; ttl?: string };
      const label = body.label?.trim() || 'default';
      const role: ApiKeyRole = API_KEY_ROLES.includes(body.role as ApiKeyRole)
        ? (body.role as ApiKeyRole)
        : 'admin';
      const orgId = body.orgId?.trim() || 'system';
      const expiresAt = resolveExpiresAt(body.ttl);

      if (label.length > 100) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml('Label must be 100 characters or fewer.', 'error'));
      }

      try {
        const plaintextKey = generateApiKey();
        const id = await storage.apiKeys.storeKey(plaintextKey, label, orgId, role, expiresAt);

        const row: ApiKeyRow = {
          id,
          label,
          active: 1,
          created_at: new Date().toISOString(),
          last_used_at: null,
          role,
          org_id: orgId,
          expires_at: expiresAt,
        };

        void storage.audit.log({ actor: request.user?.username ?? 'unknown', actorId: request.user?.id, action: 'api_key.create', resourceType: 'api_key', resourceId: id, details: { label, role, orgId, expiresAt }, ipAddress: request.ip });

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
        const message =
          err instanceof Error ? err.message : 'Failed to create API key';
        return reply
          .code(500)
          .header('content-type', 'text/html')
          .send(toastHtml(message, 'error'));
      }
    },
  );

  // DELETE /admin/api-keys/:id — permanently delete a revoked key.
  // Only revoked keys can be deleted (deleteKey filters on active = 0);
  // active keys must be revoked first.
  server.delete(
    '/admin/api-keys/:id',
    {
      preHandler: requirePermission('admin.system'),
      schema: {
        params: ApiKeyIdParams,
        ...HtmlPartialResponse,
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const all = await storage.apiKeys.listKeys();
      const row = (all as unknown as ApiKeyRow[]).find((k) => k.id === id);
      if (row === undefined) {
        return reply.code(404).header('content-type', 'text/html').send(toastHtml('API key not found.', 'error'));
      }
      if (row.active !== 0) {
        return reply.code(400).header('content-type', 'text/html').send(toastHtml('Revoke the key before deleting.', 'error'));
      }
      const deleted = await storage.apiKeys.deleteKey(id, row.org_id ?? 'system');
      if (!deleted) {
        return reply.code(404).header('content-type', 'text/html').send(toastHtml('Key could not be deleted.', 'error'));
      }
      void storage.audit.log({
        actor: request.user?.username ?? 'unknown',
        actorId: request.user?.id,
        action: 'api_key.purge',
        resourceType: 'api_key',
        resourceId: id,
        details: { label: row.label },
        ipAddress: request.ip,
      });
      // Empty body replaces the table row; toast announces success.
      return reply.code(200).header('content-type', 'text/html').send(toastHtml(`API key "${escapeHtml(row.label)}" deleted.`));
    },
  );

  // POST /admin/api-keys/:id/revoke — revoke an API key
  server.post(
    '/admin/api-keys/:id/revoke',
    {
      preHandler: requirePermission('admin.system'),
      schema: {
        params: ApiKeyIdParams,
        ...HtmlPartialResponse,
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      try {
        await storage.apiKeys.revokeKey(id);

        const allKeys = await storage.apiKeys.listKeys();
        const row = (allKeys as unknown as ApiKeyRow[]).find(k => k.id === id);

        if (row === undefined) {
          return reply
            .code(404)
            .header('content-type', 'text/html')
            .send(toastHtml('API key not found.', 'error'));
        }

        void storage.audit.log({ actor: request.user?.username ?? 'unknown', actorId: request.user?.id, action: 'api_key.delete', resourceType: 'api_key', resourceId: id, details: { label: row.label }, ipAddress: request.ip });

        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(
            `${keyRowHtml(row)}\n${toastHtml(`API key "${escapeHtml(row.label)}" revoked successfully.`)}`,
          );
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to revoke API key';
        return reply
          .code(500)
          .header('content-type', 'text/html')
          .send(toastHtml(message, 'error'));
      }
    },
  );
}
