/**
 * Phase 81 — Agency tier console.
 *
 * A multi-client overview for agency/partner users: the organisations the
 * signed-in user can access, each with its commercial plan and managed WP-site
 * count, plus the agency partner-seat entitlement (AGENCY-04: an agency plan
 * covering N client sites). White-label reports (AGENCY-02) and per-client
 * VPAT/ACR (AGENCY-03) are delivered by the per-org Report Identity + branding
 * logo already threaded through the VPAT/ACR pipeline; this page links to them.
 *
 * Monetisation is admin-controlled — the partner seat size is set by a system
 * administrator (no billing).
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requirePermission } from '../../auth/middleware.js';
import { HtmlPageSchema } from '../../api/schemas/envelope.js';
import { escapeHtml } from './helpers.js';
import type { StorageAdapter } from '../../db/index.js';

function isSystemAdmin(request: FastifyRequest): boolean {
  const perms = (request.user as { permissions?: ReadonlyArray<string> } | undefined)?.permissions ?? [];
  return perms.includes('admin.system');
}

interface ClientRow {
  readonly id: string;
  readonly name: string;
  readonly plan: string;
  readonly sites: number;
}

function renderAgency(opts: {
  rows: ReadonlyArray<ClientRow>;
  totalSites: number;
  currentOrgId: string;
  currentPlan: string;
  maxClientSites: number | null;
  canManage: boolean;
  csrf: string;
  saved: boolean;
}): string {
  const savedBanner = opts.saved
    ? `<p class="alert alert--success">Partner seat updated.</p>`
    : '';

  const seatLabel = opts.maxClientSites === null
    ? 'unlimited'
    : String(opts.maxClientSites);
  const overLimit = opts.maxClientSites !== null && opts.totalSites > opts.maxClientSites;

  const summary = `<section class="card mb-md" aria-labelledby="agency-summary">
    <h2 id="agency-summary" class="card__title">Partner seat</h2>
    ${savedBanner}
    <p><strong>Plan:</strong> ${escapeHtml(opts.currentPlan)} &nbsp;·&nbsp;
       <strong>Managing:</strong> ${opts.totalSites} site${opts.totalSites === 1 ? '' : 's'} across ${opts.rows.length} client org${opts.rows.length === 1 ? '' : 's'} &nbsp;·&nbsp;
       <strong>Seat covers:</strong> ${escapeHtml(seatLabel)} site${opts.maxClientSites === 1 ? '' : 's'}</p>
    ${overLimit ? `<p class="alert alert--warning">This account is managing more sites than the partner seat covers. Contact your Luqen administrator to expand the seat.</p>` : ''}
    ${opts.canManage ? `
    <form method="post" action="/admin/agency/seat" class="filter-row" style="gap:.5rem;align-items:flex-end">
      <input type="hidden" name="_csrf" value="${escapeHtml(opts.csrf)}">
      <input type="hidden" name="orgId" value="${escapeHtml(opts.currentOrgId)}">
      <label class="field"><span class="field__label">Client sites covered (blank = unlimited)</span>
        <input type="number" name="maxClientSites" min="0" value="${opts.maxClientSites ?? ''}" class="input" style="width:10rem"></label>
      <div class="field field--actions"><button type="submit" class="btn btn--secondary">Save seat</button></div>
    </form>` : `<p class="text-muted">The partner seat size is managed by your Luqen administrator.</p>`}
  </section>`;

  const clientRows = opts.rows.length === 0
    ? `<tr><td colspan="4" class="text-muted">You don't manage any client organisations yet.</td></tr>`
    : opts.rows.map((r) => `<tr>
        <td>${escapeHtml(r.name)}${r.id === opts.currentOrgId ? ' <span class="badge">current</span>' : ''}</td>
        <td>${escapeHtml(r.plan)}</td>
        <td class="num">${r.sites}</td>
        <td><a href="/admin/report-identity" class="btn btn--ghost btn--sm">White-label</a></td>
      </tr>`).join('\n');

  return `<section aria-label="Agency console">
    <h1>Agency console</h1>
    <p class="text-muted mb-md">Manage your client organisations from one place. Each client's reports carry that client's own
      legal identity and logo (configured under <a href="/admin/report-identity">Report identity</a>), so VPAT/ACR conformance
      reports are white-labelled per client. Switch to a client organisation to run scans or generate its report.</p>

    ${summary}

    <section class="card" aria-labelledby="agency-clients">
      <h2 id="agency-clients" class="card__title">Client organisations</h2>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Organisation</th><th>Plan</th><th class="num">Sites</th><th>Reports</th></tr></thead>
          <tbody>${clientRows}</tbody>
        </table>
      </div>
    </section>
  </section>`;
}

export async function agencyRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
): Promise<void> {
  server.get(
    '/admin/agency',
    { preHandler: requirePermission('admin.system', 'admin.org'), schema: { ...HtmlPageSchema } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = (request.user as { id?: string } | undefined)?.id;
      const currentOrgId = (request.user as { currentOrgId?: string } | undefined)?.currentOrgId ?? '';
      const orgs = userId !== undefined ? await storage.organizations.getUserOrgs(userId) : [];

      const rows: ClientRow[] = await Promise.all(orgs.map(async (o) => {
        const ent = storage.entitlements !== undefined ? await storage.entitlements.get(o.id) : null;
        const sites = await storage.wpSites.list({ orgId: o.id });
        return { id: o.id, name: o.name, plan: ent?.plan ?? 'free', sites: sites.length };
      }));
      const totalSites = rows.reduce((s, r) => s + r.sites, 0);
      const currentEnt = storage.entitlements !== undefined ? await storage.entitlements.get(currentOrgId) : null;

      const body = renderAgency({
        rows,
        totalSites,
        currentOrgId,
        currentPlan: currentEnt?.plan ?? 'free',
        maxClientSites: currentEnt?.maxClientSites ?? null,
        canManage: isSystemAdmin(request),
        csrf: (request as unknown as { csrfToken?: () => string }).csrfToken?.() ?? '',
        saved: (request.query as { saved?: string }).saved === '1',
      });
      return reply.view('admin/agency.hbs', {
        pageTitle: 'Agency console',
        currentPath: '/admin/agency',
        user: request.user,
        bodyHtml: body,
      });
    },
  );

  // System admin only — the partner seat is operator-controlled.
  server.post(
    '/admin/agency/seat',
    { preHandler: requirePermission('admin.system'), schema: { ...HtmlPageSchema } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!isSystemAdmin(request)) {
        return reply.code(403).send({ error: 'forbidden', statusCode: 403 });
      }
      if (storage.entitlements === undefined) {
        return reply.redirect('/admin/agency');
      }
      const body = (request.body ?? {}) as Record<string, string | undefined>;
      const orgId = body.orgId ?? (request.user as { currentOrgId?: string } | undefined)?.currentOrgId ?? '';
      const raw = (body.maxClientSites ?? '').trim();
      const max = raw === '' ? null : Math.max(0, Number.parseInt(raw, 10) || 0);
      const updatedBy = (request.user as { id?: string } | undefined)?.id;
      if (orgId !== '') {
        await storage.entitlements.setMaxClientSites(orgId, max, updatedBy);
      }
      return reply.redirect('/admin/agency?saved=1');
    },
  );
}
