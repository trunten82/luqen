/**
 * /admin/oauth-keys — Phase 31.1 Plan 04 Task 2.
 *
 * Admin-only visibility into the OAuth signing-key set, with a manual
 * "Rotate now" button that invokes `performKeyRotation` (Task 1). Both
 * routes require `admin.system` via `requirePermission`.
 *
 * The POST handler writes an `agent_audit_log` row with
 * tool_name='oauth.key_rotated' so manual rotations are traceable
 * alongside the scheduler's automatic ones (T-31.1-04-04).
 *
 * CSRF: the surrounding dashboard-wide CSRF preHandler already validates
 * the _csrf body field on every POST request that isn't in the
 * `isCsrfExempt` list. This route is NOT exempt, so the preHandler runs
 * the standard check.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Type } from '@sinclair/typebox';
import type { StorageAdapter } from '../../db/adapter.js';
import { requirePermission } from '../../auth/middleware.js';
import { performKeyRotation } from '../../auth/oauth-key-rotation.js';
import { ErrorEnvelope, HtmlPageSchema } from '../../api/schemas/envelope.js';

// Phase 41.1-03 — local TypeBox shapes.
const RotateResponse = {
  tags: ['html-page'],
  produces: ['text/html'],
  response: {
    200: Type.String(),
    302: Type.Null(),
    401: ErrorEnvelope,
    403: ErrorEnvelope,
    500: Type.String(),
  },
} as const;

interface OauthKeysRouteDeps {
  readonly csrfToken?: string;
}

export async function registerOauthKeysRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
  encryptionKey: string,
): Promise<void> {
  server.get(
    '/admin/oauth-keys',
    {
      preHandler: requirePermission('admin.system'),
      schema: HtmlPageSchema,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const keys = await storage.oauthSigningKeys.listPublishableKeys();
      const rows = keys.map((k) => ({
        kid: k.kid,
        createdAtDisplay: new Date(k.createdAt).toLocaleString(),
        retiredAtDisplay: k.retiredAt !== null ? new Date(k.retiredAt).toLocaleString() : '—',
        removedAtDisplay: k.removedAt !== null ? new Date(k.removedAt).toLocaleString() : '—',
        isCurrent: k.retiredAt === null,
      }));

      const replyAny = reply as FastifyReply & { generateCsrf?: () => string };
      const csrfToken =
        typeof replyAny.generateCsrf === 'function'
          ? replyAny.generateCsrf()
          : (request as unknown as OauthKeysRouteDeps).csrfToken ?? '';

      return reply.view('admin/oauth-keys.hbs', {
        pageTitle: 'OAuth Signing Keys',
        currentPath: '/admin/oauth-keys',
        user: request.user,
        keys: rows,
        csrfToken,
      });
    },
  );

  server.post(
    '/admin/oauth-keys/rotate',
    {
      preHandler: requirePermission('admin.system'),
      schema: RotateResponse,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const startedAt = Date.now();
      try {
        const result = await performKeyRotation(storage, encryptionKey);
        await storage.agentAudit.append({
          userId: request.user?.id ?? 'system',
          orgId: request.user?.currentOrgId ?? 'system',
          toolName: 'oauth.key_rotated',
          argsJson: JSON.stringify({
            newKid: result.newKid,
            retiredKid: result.retiredKid,
            trigger: 'manual',
          }),
          outcome: 'success',
          latencyMs: Date.now() - startedAt,
        });
        const toast = `Rotated: new kid=${result.newKid}, retired=${result.retiredKid ?? 'none'}`;
        return reply.redirect(
          `/admin/oauth-keys?toast=${encodeURIComponent(toast)}`,
          302,
        );
      } catch (err) {
        await storage.agentAudit.append({
          userId: request.user?.id ?? 'system',
          orgId: request.user?.currentOrgId ?? 'system',
          toolName: 'oauth.key_rotated',
          argsJson: JSON.stringify({ trigger: 'manual' }),
          outcome: 'error',
          outcomeDetail: err instanceof Error ? err.message : String(err),
          latencyMs: Date.now() - startedAt,
        });
        return reply
          .code(500)
          .header('content-type', 'text/html')
          .send('<div class="toast toast--error">Failed to rotate key</div>');
      }
    },
  );
}
