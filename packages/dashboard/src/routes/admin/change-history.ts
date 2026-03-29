import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { listUpdateProposals } from '../../compliance-client.js';
import { requirePermission } from '../../auth/middleware.js';
import { getToken, getOrgId } from './helpers.js';

interface ChangeHistoryQuery {
  from?: string;
  to?: string;
  action?: string;
  search?: string;
  page?: string;
}

const PAGE_SIZE = 50;
const RESOLVED_STATUSES = ['acknowledged', 'reviewed', 'dismissed', 'approved', 'rejected'];

function formatDate(iso: string | undefined): string {
  if (!iso) return '';
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '';
  return new Date(ts).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

export async function changeHistoryRoutes(
  server: FastifyInstance,
  baseUrl: string,
): Promise<void> {
  server.get(
    '/admin/change-history',
    { preHandler: requirePermission('compliance.view', 'audit.view') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as ChangeHistoryQuery;
      let error: string | undefined;
      let entries: Array<Record<string, string>> = [];

      try {
        const all = await listUpdateProposals(baseUrl, getToken(request), undefined, getOrgId(request));
        entries = filterAndFormat(all, query);
      } catch (err) {
        error = err instanceof Error ? err.message : 'Failed to load change history';
      }

      const page = Math.max(1, parseInt(query.page ?? '1', 10) || 1);
      const totalPages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
      const paginated = entries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
      const prevPage = page > 1 ? page - 1 : null;
      const nextPage = page < totalPages ? page + 1 : null;

      return reply.view('admin/change-history.hbs', {
        pageTitle: 'Change History',
        currentPath: '/admin/change-history',
        user: request.user,
        entries: paginated,
        total: entries.length,
        page,
        totalPages,
        prevPage,
        nextPage,
        filters: {
          from: query.from ?? '',
          to: query.to ?? '',
          action: query.action ?? '',
          search: query.search ?? '',
        },
        error,
      });
    },
  );

  server.get(
    '/admin/change-history/export',
    { preHandler: requirePermission('compliance.view', 'audit.view') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as ChangeHistoryQuery;
      try {
        const all = await listUpdateProposals(baseUrl, getToken(request), undefined, getOrgId(request));
        const entries = filterAndFormat(all, query);
        const csv = toCsv(entries);
        return reply
          .code(200)
          .header('content-type', 'text/csv; charset=utf-8')
          .header('content-disposition', `attachment; filename="change-history-${new Date().toISOString().slice(0, 10)}.csv"`)
          .send(csv);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to export';
        return reply.code(500).send({ error: message });
      }
    },
  );
}

function filterAndFormat(
  proposals: ReadonlyArray<{
    id: string;
    status: string;
    source: string;
    type: string;
    summary: string;
    detectedAt: string;
    orgId?: string;
    acknowledgedBy?: string;
    acknowledgedAt?: string;
    notes?: string;
  }>,
  query: ChangeHistoryQuery,
): Array<Record<string, string>> {
  let filtered = proposals.filter((p) => RESOLVED_STATUSES.includes(p.status));

  if (query.action) filtered = filtered.filter((p) => p.status === query.action);
  if (query.search) {
    const term = query.search.toLowerCase();
    filtered = filtered.filter(
      (p) => p.source.toLowerCase().includes(term) || p.summary.toLowerCase().includes(term),
    );
  }
  if (query.from) {
    const fromTs = Date.parse(query.from);
    if (!Number.isNaN(fromTs)) {
      filtered = filtered.filter((p) => Date.parse(p.acknowledgedAt ?? p.detectedAt) >= fromTs);
    }
  }
  if (query.to) {
    const toTs = Date.parse(query.to) + 86400000;
    if (!Number.isNaN(toTs)) {
      filtered = filtered.filter((p) => Date.parse(p.acknowledgedAt ?? p.detectedAt) < toTs);
    }
  }

  filtered.sort(
    (a, b) =>
      Date.parse(b.acknowledgedAt ?? b.detectedAt) - Date.parse(a.acknowledgedAt ?? a.detectedAt),
  );

  return filtered.map((p) => ({
    date: formatDate(p.acknowledgedAt ?? p.detectedAt),
    source: p.source,
    summary: p.summary,
    type: !p.orgId || p.orgId === 'system' ? 'Official' : 'Custom',
    action: p.status,
    by: p.acknowledgedBy ?? '',
    notes: p.notes ?? '',
  }));
}

function toCsv(entries: ReadonlyArray<Record<string, string>>): string {
  const headers = ['Date', 'Source', 'Summary', 'Type', 'Action', 'By', 'Notes'];
  const escape = (v: string): string => `"${v.replace(/"/g, '""')}"`;
  const rows = entries.map((e) =>
    [e.date, e.source, e.summary, e.type, e.action, e.by, e.notes].map(escape).join(','),
  );
  return [headers.join(','), ...rows].join('\n');
}
