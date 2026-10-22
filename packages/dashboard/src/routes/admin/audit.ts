import { bypassesOrgScope } from '../../permissions.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Type } from '@sinclair/typebox';
import { requirePermission } from '../../auth/middleware.js';
import type { StorageAdapter } from '../../db/index.js';
import { HtmlPageSchema } from '../../api/schemas/envelope.js';
import type { AuditEntry } from '../../db/types.js';
import type { AuthUser } from '../../auth/middleware.js';
import { ISSUE_DISMISSAL_AUDIT_ACTIONS, type DismissalKeySnapshot } from '../../db/interfaces/issue-dismissal-repository.js';
import type { Locale } from '../../i18n/index.js';
import { resolveLocale } from '../../services/vpat-share-service.js';
import {
  actorLabelText,
  describeActor,
  isApiKeyActor,
  orgKeyMap,
  type ScanOrgKeys,
} from '../../services/issue-dismissals/actor-label.js';
import { mayTouchDismissalOrg } from '../../services/issue-dismissals/scan-access.js';
import { actionOptions, resourceTypeOptions } from './audit-filter-options.js';

// Phase 41.1-03 — TypeBox query shape for OpenAPI fidelity. Single HTML route
// returns the audit-log page; only schema/querystring required.
const AuditQuerySchema = Type.Object(
  {
    actor: Type.Optional(Type.String()),
    action: Type.Optional(Type.String()),
    resourceType: Type.Optional(Type.String()),
    from: Type.Optional(Type.String()),
    to: Type.Optional(Type.String()),
    limit: Type.Optional(Type.String()),
    offset: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

interface AuditQueryParams {
  actor?: string;
  action?: string;
  resourceType?: string;
  from?: string;
  to?: string;
  limit?: string;
  offset?: string;
}

/** The viewer's UI language from the secure session, else 'en' (the rule routes/reports.ts sessionLocale uses). */
function sessionLocale(request: FastifyRequest): Locale {
  const session = request.session as { get?(key: string): unknown } | undefined;
  return resolveLocale(
    typeof session?.get === 'function' ? (session.get('locale') as string | undefined) : undefined,
  ) as Locale;
}

/** An audit row as the page prints it: the entry plus the Actor label (ACT-02). */
export type DisplayedAuditEntry = AuditEntry & { readonly actorLabel: string };

/**
 * The marking key's stored snapshot, only when this audit row is the mark row of that very dismissal:
 * same organization and same server-set actor id. A failed read leaves the snapshot out (the error
 * NAME only is logged; driver messages can quote input) and never fails the page.
 */
async function snapshotFor(
  storage: StorageAdapter,
  entry: AuditEntry,
  log: FastifyRequest['log'],
): Promise<DismissalKeySnapshot | null> {
  if (entry.action !== ISSUE_DISMISSAL_AUDIT_ACTIONS.mark || entry.resourceId === null) return null;
  try {
    const dismissal = await storage.issueDismissals?.getById(entry.resourceId);
    if (dismissal === undefined || dismissal === null) return null;
    if (dismissal.orgId !== entry.orgId || dismissal.createdById !== entry.actorId) return null;
    return dismissal.createdByKeySnapshot ?? null;
  } catch (err) {
    log.warn({ errorName: err instanceof Error ? err.name : 'UnknownError' }, 'Audit Log: dismissal snapshot not readable, generic key label shown');
    return null;
  }
}

/**
 * New display rows (the query result is never mutated). The Actor label comes from the shared actor
 * label, so an API key reads as it does on the report page and in the Excel export and the stored
 * `api-key:<row id>` never reaches the page. Key names are read only for organizations the viewer may
 * touch, from that organization's own key rows.
 */
async function withActorLabels(
  storage: StorageAdapter,
  user: AuthUser | undefined,
  entries: readonly AuditEntry[],
  locale: Locale,
  log: FastifyRequest['log'],
): Promise<readonly DisplayedAuditEntry[]> {
  const keyActorOrgs = new Set(
    entries.filter((e) => isApiKeyActor(e.actor, e.actorId) && e.orgId !== null).map((e) => e.orgId as string),
  );
  const keysByOrg = new Map<string, ScanOrgKeys>();
  for (const orgId of keyActorOrgs) {
    if (mayTouchDismissalOrg(user, orgId)) keysByOrg.set(orgId, await orgKeyMap(storage, orgId, log, '-'));
  }
  const rows: DisplayedAuditEntry[] = [];
  for (const entry of entries) {
    const keyActor = isApiKeyActor(entry.actor, entry.actorId);
    const orgKeys = entry.orgId === null ? undefined : keysByOrg.get(entry.orgId);
    const snapshot = keyActor && orgKeys !== undefined ? await snapshotFor(storage, entry, log) : null;
    const description = describeActor({
      actor: entry.actor,
      actorId: entry.actorId,
      snapshot,
      keys: orgKeys ?? new Map(),
      showKeyNames: orgKeys !== undefined,
    });
    rows.push({ ...entry, actorLabel: actorLabelText(description, locale) });
  }
  return rows;
}

export async function auditRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
): Promise<void> {
  server.get(
    '/admin/audit-log',
    {
      preHandler: requirePermission('audit.view'),
      schema: {
        ...HtmlPageSchema,
        querystring: AuditQuerySchema,
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const q = request.query as AuditQueryParams;

      const limit = Math.min(Math.max(parseInt(q.limit ?? '50', 10) || 50, 1), 200);
      const offset = Math.max(parseInt(q.offset ?? '0', 10) || 0, 0);

      const isGlobalAdmin = bypassesOrgScope(request.user);
      const orgId = isGlobalAdmin ? undefined : request.user?.currentOrgId;

      const result = await storage.audit.query({
        actor: q.actor || undefined,
        action: q.action || undefined,
        resourceType: q.resourceType || undefined,
        from: q.from || undefined,
        to: q.to || undefined,
        orgId,
        limit,
        offset,
      });

      const hasMore = offset + limit < result.total;
      const entries = await withActorLabels(storage, request.user, result.entries, sessionLocale(request), request.log);

      return reply.view('admin/audit-log.hbs', {
        pageTitle: 'Audit Log',
        currentPath: '/admin/audit-log',
        user: request.user,
        entries,
        actionOptions: actionOptions(q.action ?? ''),
        resourceTypeOptions: resourceTypeOptions(q.resourceType ?? ''),
        total: result.total,
        limit,
        offset,
        nextOffset: offset + limit,
        hasMore,
        filters: {
          actor: q.actor ?? '',
          action: q.action ?? '',
          resourceType: q.resourceType ?? '',
          from: q.from ?? '',
          to: q.to ?? '',
        },
      });
    },
  );
}
