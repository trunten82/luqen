import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  listSources,
  listUpdateProposals,
  scanSources,
  type MonitoredSource,
  type UpdateProposal,
} from '../../compliance-client.js';
import { requirePermission } from '../../auth/middleware.js';
import { getToken, getOrgId, toastHtml } from './helpers.js';

// ── Public types for testing ─────────────────────────────────────────────────

export type MonitorSource = MonitoredSource;
export type MonitorProposal = UpdateProposal;

export interface MonitorSourceView {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly type: string;
  readonly schedule: string;
  readonly lastCheckedDisplay: string;
  readonly stale: boolean;
}

export interface MonitorProposalView {
  readonly id: string;
  readonly status: string;
  readonly source: string;
  readonly type: string;
  readonly summary: string;
  readonly detectedAt: string;
  readonly detectedAtDisplay: string;
}

export interface MonitorViewData {
  readonly sourcesCount: number;
  readonly pendingProposalsCount: number;
  readonly lastScanTime: string;
  readonly sources: readonly MonitorSourceView[];
  readonly proposals: readonly MonitorProposalView[];
}

// ── Pure helpers (exported for testing) ──────────────────────────────────────

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export function isSourceStale(lastChecked: string | undefined): boolean {
  if (lastChecked === undefined) return true;
  const ts = Date.parse(lastChecked);
  if (Number.isNaN(ts)) return true;
  return Date.now() - ts > STALE_THRESHOLD_MS;
}

export function formatLastChecked(lastChecked: string | undefined): string {
  if (lastChecked === undefined) return 'Never';
  const ts = Date.parse(lastChecked);
  if (Number.isNaN(ts)) return 'Never';
  return new Date(ts).toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function buildMonitorViewData(
  sources: readonly MonitorSource[],
  proposals: readonly MonitorProposal[],
): MonitorViewData {
  const sourcesView: MonitorSourceView[] = sources.map((s) => ({
    id: s.id,
    name: s.name,
    url: s.url,
    type: s.type,
    schedule: s.schedule,
    lastCheckedDisplay: formatLastChecked(s.lastChecked),
    stale: isSourceStale(s.lastChecked),
  }));

  const proposalsView: MonitorProposalView[] = proposals.map((p) => ({
    id: p.id,
    status: p.status,
    source: p.source,
    type: p.type,
    summary: p.summary,
    detectedAt: p.detectedAt,
    detectedAtDisplay: formatLastChecked(p.detectedAt),
  }));

  const pendingProposalsCount = proposals.filter((p) => p.status === 'pending').length;

  // Determine last scan time from most recently checked source
  const checkedDates = sources
    .filter((s) => s.lastChecked !== undefined)
    .map((s) => Date.parse(s.lastChecked as string))
    .filter((ts) => !Number.isNaN(ts));

  const lastScanTime =
    checkedDates.length > 0
      ? formatLastChecked(new Date(Math.max(...checkedDates)).toISOString())
      : 'Never';

  return {
    sourcesCount: sources.length,
    pendingProposalsCount,
    lastScanTime,
    sources: sourcesView,
    proposals: proposalsView,
  };
}

// ── Route handler ────────────────────────────────────────────────────────────

export async function monitorRoutes(
  server: FastifyInstance,
  complianceUrl: string,
): Promise<void> {
  // GET /admin/monitor — main monitor dashboard
  server.get(
    '/admin/monitor',
    { preHandler: requirePermission('admin.system', 'compliance.view') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const token = getToken(request);
      const orgId = getOrgId(request);
      let error: string | undefined;

      const [sourcesResult, proposalsResult] = await Promise.allSettled([
        listSources(complianceUrl, token, orgId),
        listUpdateProposals(complianceUrl, token, undefined, orgId),
      ]);

      const sources =
        sourcesResult.status === 'fulfilled' ? sourcesResult.value : [];
      const proposals =
        proposalsResult.status === 'fulfilled' ? proposalsResult.value : [];

      if (sourcesResult.status === 'rejected') {
        error = sourcesResult.reason instanceof Error
          ? sourcesResult.reason.message
          : 'Failed to load sources';
      }

      const viewData = buildMonitorViewData(sources, proposals);

      return reply.view('admin/monitor.hbs', {
        pageTitle: 'Monitor',
        currentPath: '/admin/monitor',
        user: request.user,
        error,
        ...viewData,
      });
    },
  );

  // POST /admin/monitor/trigger — manually trigger a scan
  server.post(
    '/admin/monitor/trigger',
    { preHandler: requirePermission('admin.system', 'compliance.manage') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const result = await scanSources(complianceUrl, getToken(request), true);
        const html = `<div class="alert alert--success"><strong>Scan complete:</strong> ${result.scanned} source(s) checked, ${result.proposalsCreated} proposal(s) created.</div>`;

        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(html);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to trigger scan';
        return reply
          .code(500)
          .header('content-type', 'text/html')
          .send(toastHtml(message, 'error'));
      }
    },
  );
}
