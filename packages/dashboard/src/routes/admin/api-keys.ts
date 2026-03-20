import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type Database from 'better-sqlite3';
import { adminGuard } from '../../auth/middleware.js';
import { generateApiKey, hashApiKey, storeApiKey } from '../../auth/api-key.js';
import { toastHtml, escapeHtml } from './helpers.js';

interface ApiKeyRow {
  readonly id: string;
  readonly label: string;
  readonly active: number;
  readonly created_at: string;
  readonly last_used_at: string | null;
}

function statusBadge(active: number): string {
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

function keyRowHtml(row: ApiKeyRow): string {
  const revokeBtn = row.active
    ? `<button hx-post="/admin/api-keys/${encodeURIComponent(row.id)}/revoke"
              hx-confirm="Revoke API key &quot;${escapeHtml(row.label)}&quot;?"
              hx-target="closest tr"
              hx-swap="outerHTML"
              class="btn btn--sm btn--danger"
              aria-label="Revoke ${escapeHtml(row.label)}">Revoke</button>`
    : '';

  return `<tr id="api-key-${row.id}">
  <td data-label="Label">${escapeHtml(row.label)}</td>
  <td data-label="Status">${statusBadge(row.active)}</td>
  <td data-label="Created">${formatDate(row.created_at)}</td>
  <td data-label="Last Used">${formatDate(row.last_used_at)}</td>
  <td data-label="Actions">${revokeBtn}</td>
</tr>`;
}

export async function apiKeyRoutes(
  server: FastifyInstance,
  db: Database.Database,
): Promise<void> {
  // GET /admin/api-keys — list all keys
  server.get(
    '/admin/api-keys',
    { preHandler: adminGuard },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const keys = db
        .prepare(
          'SELECT id, label, active, created_at, last_used_at FROM api_keys ORDER BY created_at DESC',
        )
        .all() as readonly ApiKeyRow[];

      return reply.view('admin/api-keys.hbs', {
        pageTitle: 'API Keys',
        currentPath: '/admin/api-keys',
        user: request.user,
        keys,
      });
    },
  );

  // GET /admin/api-keys/new — modal form to create a new key
  server.get(
    '/admin/api-keys/new',
    { preHandler: adminGuard },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.view('admin/api-key-form.hbs', {});
    },
  );

  // POST /admin/api-keys — create new API key
  server.post(
    '/admin/api-keys',
    { preHandler: adminGuard },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as { label?: string };
      const label = body.label?.trim() || 'default';

      if (label.length > 100) {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send(toastHtml('Label must be 100 characters or fewer.', 'error'));
      }

      try {
        const plaintextKey = generateApiKey();
        const id = storeApiKey(db, plaintextKey, label);

        const row: ApiKeyRow = {
          id,
          label,
          active: 1,
          created_at: new Date().toISOString(),
          last_used_at: null,
        };

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

  // POST /admin/api-keys/:id/revoke — revoke an API key
  server.post(
    '/admin/api-keys/:id/revoke',
    { preHandler: adminGuard },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      try {
        db.prepare('UPDATE api_keys SET active = 0 WHERE id = @id').run({ id });

        const row = db
          .prepare(
            'SELECT id, label, active, created_at, last_used_at FROM api_keys WHERE id = @id',
          )
          .get({ id }) as ApiKeyRow | undefined;

        if (row === undefined) {
          return reply
            .code(404)
            .header('content-type', 'text/html')
            .send(toastHtml('API key not found.', 'error'));
        }

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
