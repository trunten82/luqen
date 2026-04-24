/**
 * Phase 33-01 — Agent audit log viewer (APER-04).
 *
 * GET  /admin/audit      — HTML viewer with filter bar + pagination
 * GET  /admin/audit.csv  — CSV export of the same filtered set
 *
 * Permission gate: admin.system OR admin.org. admin.system holders see all
 * orgs (orgId=null in the repository call); admin.org holders are scoped to
 * their currentOrgId. An admin.org user attempting ?orgId= override returns
 * 403. See also the existing cross-org-403 pattern in routes/admin/organizations.ts.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { StorageAdapter } from '../../db/index.js';
import { requirePermission } from '../../auth/middleware.js';
import type { AgentAuditFilters } from '../../db/interfaces/agent-audit-repository.js';

const PAGE_SIZE = 50;

const OUTCOME_VALUES = ['success', 'error', 'timeout', 'denied'] as const;

const AuditQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  userId: z.string().optional(),
  toolName: z.string().optional(),
  outcome: z.enum(OUTCOME_VALUES).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  orgId: z.string().optional(),
});

type ParsedAuditQuery = z.infer<typeof AuditQuerySchema>;

interface ResolvedScope {
  readonly orgId: string | null; // null === cross-org (admin.system)
  readonly filters: AgentAuditFilters;
  readonly limit: number;
  readonly offset: number;
}

function getPermissions(request: FastifyRequest): ReadonlySet<string> {
  const perms = (request as unknown as Record<string, unknown>)['permissions'];
  return perms instanceof Set ? (perms as Set<string>) : new Set<string>();
}

function resolveScope(
  query: ParsedAuditQuery,
  user: { currentOrgId?: string },
  permissions: ReadonlySet<string>,
): { ok: true; scope: ResolvedScope } | { ok: false; status: number; error: string } {
  const isDashboardAdmin = permissions.has('admin.system');
  const isOrgAdmin = permissions.has('admin.org');
  if (!isDashboardAdmin && !isOrgAdmin) {
    return { ok: false, status: 403, error: 'forbidden' };
  }

  let orgId: string | null;
  if (isDashboardAdmin) {
    // Dashboard admin: honour ?orgId= override (allows filtering a single
    // org's audit trail), otherwise cross-org.
    orgId = typeof query.orgId === 'string' && query.orgId.length > 0 ? query.orgId : null;
  } else {
    // Org admin: scoped to their current org. Reject explicit cross-org override.
    if (query.orgId !== undefined && query.orgId !== (user.currentOrgId ?? '')) {
      return { ok: false, status: 403, error: 'cross_org_forbidden' };
    }
    const currentOrgId = user.currentOrgId;
    if (currentOrgId === undefined || currentOrgId.length === 0) {
      return { ok: false, status: 400, error: 'no_org_context' };
    }
    orgId = currentOrgId;
  }

  const filters: AgentAuditFilters = {
    ...(query.from !== undefined ? { from: query.from } : {}),
    ...(query.to !== undefined ? { to: query.to } : {}),
    ...(query.userId !== undefined ? { userId: query.userId } : {}),
    ...(query.toolName !== undefined ? { toolName: query.toolName } : {}),
    ...(query.outcome !== undefined ? { outcome: query.outcome } : {}),
  };

  const limit = query.limit ?? PAGE_SIZE;
  const offset = query.offset ?? 0;

  return { ok: true, scope: { orgId, filters, limit, offset } };
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

function toCsvRow(values: readonly string[]): string {
  return values.map(csvEscape).join(',');
}

export async function agentAuditRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
): Promise<void> {
  server.get(
    '/admin/audit',
    { preHandler: requirePermission('admin.system', 'admin.org') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user;
      if (user === undefined) {
        return reply.code(401).send({ error: 'unauthenticated' });
      }
      const parsed = AuditQuerySchema.safeParse(request.query ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_query', issues: parsed.error.issues });
      }
      const perms = getPermissions(request);
      const resolution = resolveScope(parsed.data, user, perms);
      if (!resolution.ok) {
        return reply.code(resolution.status).send({ error: resolution.error });
      }
      const { scope } = resolution;

      const [rows, total, users, toolNames] = await Promise.all([
        storage.agentAudit.listForOrg(scope.orgId, scope.filters, {
          limit: scope.limit,
          offset: scope.offset,
        }),
        storage.agentAudit.countForOrg(scope.orgId, scope.filters),
        storage.agentAudit.distinctUsers(scope.orgId),
        storage.agentAudit.distinctToolNames(scope.orgId),
      ]);

      // Display rows — format created_at, shorten args preview.
      const displayRows = rows.map((r) => ({
        id: r.id,
        timestamp: new Date(r.createdAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'medium' }),
        userId: r.userId,
        orgId: r.orgId,
        toolName: r.toolName,
        outcome: r.outcome,
        latencyMs: r.latencyMs,
        argsPreview: r.argsJson.length > 120 ? r.argsJson.slice(0, 120) + '…' : r.argsJson,
        outcomeDetail: r.outcomeDetail ?? '',
      }));

      const currentPage = Math.floor(scope.offset / scope.limit) + 1;
      const totalPages = Math.max(1, Math.ceil(total / scope.limit));

      return reply.view('admin/agent-audit.hbs', {
        pageTitle: 'Agent Audit Log',
        currentPath: '/admin/audit',
        user,
        isDashboardAdmin: perms.has('admin.system'),
        rows: displayRows,
        total,
        users,
        toolNames,
        outcomeValues: OUTCOME_VALUES,
        filters: parsed.data,
        pagination: {
          limit: scope.limit,
          offset: scope.offset,
          currentPage,
          totalPages,
          prev: scope.offset > 0 ? Math.max(0, scope.offset - scope.limit) : null,
          next: scope.offset + scope.limit < total ? scope.offset + scope.limit : null,
        },
      });
    },
  );

  server.get(
    '/admin/audit.csv',
    { preHandler: requirePermission('admin.system', 'admin.org') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user;
      if (user === undefined) {
        return reply.code(401).send({ error: 'unauthenticated' });
      }
      const parsed = AuditQuerySchema.safeParse(request.query ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_query' });
      }
      const perms = getPermissions(request);
      const resolution = resolveScope(parsed.data, user, perms);
      if (!resolution.ok) {
        return reply.code(resolution.status).send({ error: resolution.error });
      }
      const { scope } = resolution;

      // CSV export: cap at 10k rows regardless of page size to keep the
      // response bounded (mitigates T-31-10 unbounded query DOS, same
      // rationale as the HTML path's 500-row limit).
      const MAX_EXPORT_ROWS = 10_000;
      const rows = await storage.agentAudit.listForOrg(scope.orgId, scope.filters, {
        limit: MAX_EXPORT_ROWS,
        offset: 0,
      });

      const header = toCsvRow([
        'timestamp',
        'user_id',
        'org_id',
        'tool_name',
        'outcome',
        'latency_ms',
        'args',
        'outcome_detail',
      ]);
      const body = rows
        .map((r) => toCsvRow([
          r.createdAt,
          r.userId,
          r.orgId,
          r.toolName,
          r.outcome,
          String(r.latencyMs),
          r.argsJson,
          r.outcomeDetail ?? '',
        ]))
        .join('\n');

      void reply.header('content-type', 'text/csv; charset=utf-8');
      void reply.header(
        'content-disposition',
        `attachment; filename="agent-audit-${new Date().toISOString().slice(0, 10)}.csv"`,
      );
      return reply.send(header + '\n' + body + '\n');
    },
  );
}
