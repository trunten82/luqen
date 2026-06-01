/**
 * Phase 72-03 — Admin LLM usage page.
 *
 * Surfaces the llm_usage rows persisted by Phase 72-02 capability
 * instrumentation. Displays a KPI strip (call count, totals, average
 * latency) and a row table with org/capability filter support.
 *
 * Permissions:
 *   - admin.system  → may query usage for any org or system-wide.
 *   - admin.org     → may query usage for own org only (orgId is
 *                     forced server-side to the caller's current org).
 *
 * No cost calculation yet — Phase 72 deliberately ships tokens-only
 * until a pricing decision is made.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Type } from '@sinclair/typebox';
import { requirePermission } from '../../auth/middleware.js';
import { HtmlPageSchema, ErrorEnvelope } from '../../api/schemas/envelope.js';
import type { LLMClient, LlmUsageRow, LlmUsageTotals, LlmUsageSummaryRow, LlmUsageGroupBy, LlmCreditBalance } from '../../llm-client.js';
import { escapeHtml } from './helpers.js';
import { buildXlsx } from '../api/export.js';
import type { StorageAdapter } from '../../db/index.js';
import { ORG_PLANS, type OrgPlan } from '../../db/interfaces/entitlement-repository.js';

/**
 * Phase 80 — AI-fix credit + plan card. Shown when a specific org is selected.
 * Lets an admin see the balance/consumption and set the allocation, top up, or
 * change the org's commercial plan. Monetisation is admin-controlled (no billing).
 */
function renderCreditsCard(opts: {
  orgId: string;
  credits: LlmCreditBalance | null;
  plan: OrgPlan;
  csrfToken: string;
  notice: string | null;
}): string {
  const csrf = `<input type="hidden" name="_csrf" value="${escapeHtml(opts.csrfToken)}">`;
  const org = `<input type="hidden" name="orgId" value="${escapeHtml(opts.orgId)}">`;
  const c = opts.credits;
  const balanceLine = c === null
    ? `<p class="alert alert--warning">Could not read the credit balance from the LLM service.</p>`
    : `<p><strong>Balance:</strong> ${c.balance} &nbsp;·&nbsp; <strong>Allocated:</strong> ${c.allocated} &nbsp;·&nbsp; <strong>Used:</strong> ${c.used}</p>`;
  const planOptions = ORG_PLANS
    .map((p) => `<option value="${p}"${p === opts.plan ? ' selected' : ''}>${p}</option>`)
    .join('');
  const notice = opts.notice !== null
    ? `<p class="alert alert--success">${escapeHtml(opts.notice)}</p>`
    : '';
  return `<section class="card mb-md" aria-labelledby="credits-heading">
    <h2 id="credits-heading" class="card__title">AI fix credits &amp; plan — ${escapeHtml(opts.orgId)}</h2>
    ${notice}
    ${balanceLine}
    <div class="filter-row" style="gap:1.5rem;flex-wrap:wrap">
      <form method="post" action="/admin/llm-usage/credits" class="filter-row" style="gap:.5rem">
        ${csrf}${org}<input type="hidden" name="op" value="set">
        <label class="field"><span class="field__label">Set allocation</span>
          <input type="number" name="allocated" min="0" value="${c ? c.allocated : 0}" class="input" style="width:7rem"></label>
        <div class="field field--actions"><button type="submit" class="btn btn--secondary">Set</button></div>
      </form>
      <form method="post" action="/admin/llm-usage/credits" class="filter-row" style="gap:.5rem">
        ${csrf}${org}<input type="hidden" name="op" value="topup">
        <label class="field"><span class="field__label">Top up by</span>
          <input type="number" name="delta" value="50" class="input" style="width:7rem"></label>
        <div class="field field--actions"><button type="submit" class="btn btn--secondary">Top up</button></div>
      </form>
      <form method="post" action="/admin/llm-usage/plan" class="filter-row" style="gap:.5rem">
        ${csrf}${org}
        <label class="field"><span class="field__label">Plan</span>
          <select name="plan" class="input">${planOptions}</select></label>
        <div class="field field--actions"><button type="submit" class="btn btn--secondary">Save plan</button></div>
      </form>
    </div>
  </section>`;
}

const UsageQuery = Type.Object(
  {
    orgId: Type.Optional(Type.String()),
    capability: Type.Optional(Type.String()),
    from: Type.Optional(Type.String()),
    to: Type.Optional(Type.String()),
    groupBy: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

const GROUP_BY_OPTIONS: ReadonlyArray<{ value: LlmUsageGroupBy; label: string }> = [
  { value: 'capability', label: 'Capability' },
  { value: 'model',      label: 'Model' },
  { value: 'provider',   label: 'Provider' },
  { value: 'org',        label: 'Org' },
  { value: 'day',        label: 'Day' },
];

function isValidGroupBy(s: string): s is LlmUsageGroupBy {
  return GROUP_BY_OPTIONS.some((o) => o.value === s);
}

/**
 * Accept a `YYYY-MM-DD` or full ISO timestamp. Returns a full ISO
 * string clamped to the start (00:00) or end (23:59:59.999) of the
 * day when the input is date-only. Returns null on invalid input.
 */
function normalizeDate(raw: string | undefined, mode: 'start' | 'end'): string | null {
  if (raw === undefined || raw === '') return null;
  // YYYY-MM-DD only?
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  const stamp = dateOnly
    ? (mode === 'start' ? `${raw}T00:00:00.000Z` : `${raw}T23:59:59.999Z`)
    : raw;
  const parsed = new Date(stamp);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

const USAGE_XLSX_HEADERS: ReadonlyArray<string> = [
  'When (UTC)', 'Org', 'Capability', 'Provider', 'Model',
  'Prompt tokens', 'Completion tokens', 'Total tokens',
  'Input cost (USD)', 'Output cost (USD)', 'Total cost (USD)',
  'Latency (ms)', 'Status', 'Error class',
];

function usageRowsToXlsxRows(rows: ReadonlyArray<LlmUsageRow>): ReadonlyArray<ReadonlyArray<string>> {
  return rows.map((r) => [
    r.occurredAt,
    r.orgId ?? '',
    r.capability,
    r.providerType,
    r.modelName,
    String(r.promptTokens),
    String(r.completionTokens),
    String(r.totalTokens),
    r.inputCostUsd === null ? '' : r.inputCostUsd.toFixed(6),
    r.outputCostUsd === null ? '' : r.outputCostUsd.toFixed(6),
    r.totalCostUsd === null ? '' : r.totalCostUsd.toFixed(6),
    String(r.latencyMs),
    r.status,
    r.errorClass ?? '',
  ]);
}

function isSystemAdmin(request: FastifyRequest): boolean {
  const user = request.user as
    | { permissions?: ReadonlyArray<string> }
    | undefined;
  const perms = user?.permissions ?? [];
  return perms.includes('admin.system');
}

function callerOrgId(request: FastifyRequest): string | undefined {
  const user = request.user as { orgId?: string } | undefined;
  return user?.orgId;
}

function fmtUsd(value: number | null): string {
  if (value === null) return '<span class="text-muted">—</span>';
  // 4-decimal precision for per-row figures, since costs are often
  // fractions of a cent. Aggregate totals render with 2 decimals.
  return `$${value.toFixed(4)}`;
}

function fmtUsdTotal(value: number): string {
  return `$${value.toFixed(2)}`;
}

function renderRow(row: LlmUsageRow): string {
  const statusBadge = row.status === 'ok'
    ? '<span class="badge badge--success">ok</span>'
    : `<span class="badge badge--danger">error${row.errorClass ? ` · ${escapeHtml(row.errorClass)}` : ''}</span>`;
  return `<tr>
    <td data-label="When"><code>${escapeHtml(row.occurredAt)}</code></td>
    <td data-label="Org">${row.orgId === null ? '<em>system</em>' : escapeHtml(row.orgId)}</td>
    <td data-label="Capability"><code>${escapeHtml(row.capability)}</code></td>
    <td data-label="Provider">${escapeHtml(row.providerType)}</td>
    <td data-label="Model">${escapeHtml(row.modelName)}</td>
    <td data-label="Prompt" class="num">${row.promptTokens}</td>
    <td data-label="Completion" class="num">${row.completionTokens}</td>
    <td data-label="Total" class="num"><strong>${row.totalTokens}</strong></td>
    <td data-label="Cost" class="num">${fmtUsd(row.totalCostUsd)}</td>
    <td data-label="Latency" class="num">${row.latencyMs} ms</td>
    <td data-label="Status">${statusBadge}</td>
  </tr>`;
}

function renderEmpty(): string {
  return '<tr><td colspan="11" class="table__empty">No LLM activity recorded for the selected filters.</td></tr>';
}

function renderTotals(t: LlmUsageTotals): string {
  const priceCoverage = t.callCount === 0
    ? ''
    : t.rowsWithUnknownPrice === 0
      ? `${t.rowsWithKnownPrice} priced`
      : `${t.rowsWithKnownPrice} priced · ${t.rowsWithUnknownPrice} unpriced model${t.rowsWithUnknownPrice === 1 ? '' : 's'}`;
  return `
  <div class="kpi-strip">
    <div class="kpi"><div class="kpi__label">Calls</div><div class="kpi__value">${t.callCount}</div><div class="kpi__sub">${t.okCount} ok · ${t.errorCount} error</div></div>
    <div class="kpi"><div class="kpi__label">Total tokens</div><div class="kpi__value">${t.totalTokens}</div><div class="kpi__sub">prompt ${t.promptTokens} · completion ${t.completionTokens}</div></div>
    <div class="kpi"><div class="kpi__label">Spend (USD)</div><div class="kpi__value">${fmtUsdTotal(t.totalCostUsd)}</div><div class="kpi__sub">${priceCoverage}</div></div>
    <div class="kpi"><div class="kpi__label">Avg latency</div><div class="kpi__value">${t.avgLatencyMs} ms</div><div class="kpi__sub">per call</div></div>
  </div>`;
}

const CAPABILITY_OPTIONS = [
  'generate-fix',
  'extract-requirements',
  'analyse-report',
  'discover-branding',
  'agent-conversation',
  'generate-notification-content',
] as const;

function renderBreakdown(
  groupBy: LlmUsageGroupBy,
  rows: ReadonlyArray<LlmUsageSummaryRow>,
): string {
  if (rows.length === 0) {
    return `<p class="text-muted">No rows match the current filters.</p>`;
  }
  const groupLabel = GROUP_BY_OPTIONS.find((o) => o.value === groupBy)?.label ?? groupBy;
  const body = rows.map((r) => {
    const coverage = r.unpricedRows > 0
      ? `<span class="text-muted"> (+${r.unpricedRows} unpriced)</span>`
      : '';
    return `<tr>
      <td data-label="${escapeHtml(groupLabel)}">${escapeHtml(r.key)}</td>
      <td data-label="Calls" class="num">${r.callCount}<small class="text-muted"> · ${r.okCount} ok · ${r.errorCount} err</small></td>
      <td data-label="Tokens" class="num">${r.totalTokens}</td>
      <td data-label="Cost (USD)" class="num"><strong>$${r.totalCostUsd.toFixed(4)}</strong>${coverage}</td>
      <td data-label="Avg latency" class="num">${r.avgLatencyMs} ms</td>
    </tr>`;
  }).join('\n');
  return `<table class="table">
    <thead>
      <tr>
        <th>${escapeHtml(groupLabel)}</th>
        <th class="num">Calls</th>
        <th class="num">Total tokens</th>
        <th class="num">Cost (USD)</th>
        <th class="num">Avg latency</th>
      </tr>
    </thead>
    <tbody>${body}</tbody>
  </table>`;
}

function renderPage(opts: {
  readonly llmConnected: boolean;
  readonly canFilterCrossOrg: boolean;
  readonly currentOrgId: string;
  readonly filterOrgId: string;
  readonly filterCapability: string;
  readonly filterFrom: string;
  readonly filterTo: string;
  readonly groupBy: LlmUsageGroupBy;
  readonly rows: ReadonlyArray<LlmUsageRow>;
  readonly summary: ReadonlyArray<LlmUsageSummaryRow>;
  readonly totals: LlmUsageTotals;
  readonly errorMessage: string | null;
  readonly credits?: LlmCreditBalance | null;
  readonly plan?: OrgPlan;
  readonly csrfToken?: string;
  readonly creditNotice?: string | null;
}): string {
  if (!opts.llmConnected) {
    return `<section aria-label="LLM Usage" class="card">
      <h2 class="card__title">LLM Usage</h2>
      <p>The LLM service is not connected. Configure it under <a href="/admin/service-connections">Service Connections</a> to see usage data.</p>
    </section>`;
  }
  if (opts.errorMessage !== null) {
    return `<section aria-label="LLM Usage" class="card">
      <h2 class="card__title">LLM Usage</h2>
      <p class="alert alert--danger">${escapeHtml(opts.errorMessage)}</p>
    </section>`;
  }
  const orgOptions = opts.canFilterCrossOrg
    ? `<input type="text" name="orgId" value="${escapeHtml(opts.filterOrgId)}" placeholder="Any org (leave blank)" class="input">`
    : `<input type="text" value="${escapeHtml(opts.currentOrgId)}" disabled class="input">`;
  const capOptions = CAPABILITY_OPTIONS
    .map((c) => `<option value="${c}"${c === opts.filterCapability ? ' selected' : ''}>${c}</option>`)
    .join('');

  const groupByOptions = GROUP_BY_OPTIONS.map((o) =>
    `<option value="${o.value}"${o.value === opts.groupBy ? ' selected' : ''}>${o.label}</option>`,
  ).join('');

  // Preserve the current filters in the CSV export link.
  const exportQs = new URLSearchParams();
  if (opts.filterOrgId !== '') exportQs.set('orgId', opts.filterOrgId);
  if (opts.filterCapability !== '') exportQs.set('capability', opts.filterCapability);
  if (opts.filterFrom !== '') exportQs.set('from', opts.filterFrom);
  if (opts.filterTo !== '') exportQs.set('to', opts.filterTo);
  const exportUrl = `/admin/llm-usage/export.xlsx${exportQs.toString() === '' ? '' : `?${exportQs.toString()}`}`;

  return `<section aria-label="LLM Usage">
    <p class="text-muted mb-md">Per-inference token usage, latency and USD spend across all capabilities. Costs are computed from the hard-coded pricing registry (Phase 74); rows whose model is not in the registry render with an empty cost cell.</p>

    ${renderTotals(opts.totals)}

    ${opts.filterOrgId !== '' ? renderCreditsCard({
      orgId: opts.filterOrgId,
      credits: opts.credits ?? null,
      plan: opts.plan ?? 'free',
      csrfToken: opts.csrfToken ?? '',
      notice: opts.creditNotice ?? null,
    }) : ''}

    <form method="get" action="/admin/llm-usage" class="filter-row mb-md" role="search">
      <label class="field">
        <span class="field__label">Org</span>
        ${orgOptions}
      </label>
      <label class="field">
        <span class="field__label">Capability</span>
        <select name="capability" class="input">
          <option value=""${opts.filterCapability === '' ? ' selected' : ''}>Any</option>
          ${capOptions}
        </select>
      </label>
      <label class="field">
        <span class="field__label">From</span>
        <input type="date" name="from" value="${escapeHtml(opts.filterFrom)}" class="input">
      </label>
      <label class="field">
        <span class="field__label">To</span>
        <input type="date" name="to" value="${escapeHtml(opts.filterTo)}" class="input">
      </label>
      <label class="field">
        <span class="field__label">Group by</span>
        <select name="groupBy" class="input">
          ${groupByOptions}
        </select>
      </label>
      <div class="field field--actions">
        <button type="submit" class="btn btn--primary">Apply</button>
        <a href="/admin/llm-usage" class="btn btn--ghost">Reset</a>
        <a href="${exportUrl}" class="btn btn--secondary" aria-label="Download current filter as Excel">Export Excel</a>
      </div>
    </form>

    <section class="card mb-md" aria-labelledby="breakdown-heading">
      <h2 id="breakdown-heading" class="card__title">Breakdown by ${escapeHtml(GROUP_BY_OPTIONS.find((o) => o.value === opts.groupBy)?.label ?? opts.groupBy)}</h2>
      ${renderBreakdown(opts.groupBy, opts.summary)}
    </section>

    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>When (UTC)</th>
            <th>Org</th>
            <th>Capability</th>
            <th>Provider</th>
            <th>Model</th>
            <th class="num">Prompt</th>
            <th class="num">Completion</th>
            <th class="num">Total</th>
            <th class="num">Cost (USD)</th>
            <th class="num">Latency</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${opts.rows.length === 0 ? renderEmpty() : opts.rows.map(renderRow).join('\n')}
        </tbody>
      </table>
    </div>
  </section>`;
}

export async function llmUsageRoutes(
  server: FastifyInstance,
  getLLMClient: () => LLMClient | null,
  storage: StorageAdapter,
): Promise<void> {
  server.get(
    '/admin/llm-usage',
    {
      preHandler: requirePermission('admin.system', 'admin.org'),
      schema: {
        ...HtmlPageSchema,
        querystring: UsageQuery,
        response: { ...HtmlPageSchema.response, 502: ErrorEnvelope },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const llmClient = getLLMClient();
      const q = request.query as { orgId?: string; capability?: string; from?: string; to?: string; groupBy?: string };
      const isAdmin = isSystemAdmin(request);
      const callerOrg = callerOrgId(request) ?? '';
      const filterOrgId = isAdmin
        ? (q.orgId ?? '')
        : callerOrg;
      const filterCapability = q.capability ?? '';
      const fromIso = normalizeDate(q.from, 'start');
      const toIso = normalizeDate(q.to, 'end');
      const filterFrom = q.from ?? '';
      const filterTo = q.to ?? '';
      const groupBy: LlmUsageGroupBy = q.groupBy !== undefined && isValidGroupBy(q.groupBy)
        ? q.groupBy
        : 'capability';

      if (llmClient === null) {
        const body = renderPage({
          llmConnected: false,
          canFilterCrossOrg: isAdmin,
          currentOrgId: callerOrg,
          filterOrgId,
          filterCapability,
          filterFrom,
          filterTo,
          groupBy,
          summary: [],
          rows: [],
          totals: {
            callCount: 0, okCount: 0, errorCount: 0,
            promptTokens: 0, completionTokens: 0, totalTokens: 0,
            avgLatencyMs: 0,
            totalCostUsd: 0,
            rowsWithKnownPrice: 0, rowsWithUnknownPrice: 0,
          },
          errorMessage: null,
        });
        return reply.view('admin/llm-usage.hbs', {
          pageTitle: 'LLM Usage',
          currentPath: '/admin/llm-usage',
          user: request.user,
          bodyHtml: body,
        });
      }

      try {
        const filterArgs = {
          ...(filterOrgId !== '' ? { orgId: filterOrgId } : {}),
          ...(filterCapability !== '' ? { capability: filterCapability } : {}),
          ...(fromIso !== null ? { from: fromIso } : {}),
          ...(toIso !== null ? { to: toIso } : {}),
        };
        const [usage, summary, credits, planRec] = await Promise.all([
          llmClient.listUsage({ ...filterArgs, limit: 500 }),
          llmClient.summarizeUsage({ ...filterArgs, groupBy }),
          filterOrgId !== '' ? llmClient.getCredits(filterOrgId) : Promise.resolve(null),
          filterOrgId !== '' && storage.entitlements !== undefined
            ? storage.entitlements.get(filterOrgId)
            : Promise.resolve(null),
        ]);
        const creditNotice = ((request.query as { credit?: string }).credit === 'saved')
          ? 'Credits / plan updated.'
          : null;
        const body = renderPage({
          llmConnected: true,
          canFilterCrossOrg: isAdmin,
          currentOrgId: callerOrg,
          filterOrgId,
          filterCapability,
          filterFrom,
          filterTo,
          groupBy,
          rows: usage.rows,
          summary: summary.rows,
          totals: usage.totals,
          errorMessage: null,
          credits,
          plan: planRec?.plan ?? 'free',
          csrfToken: (request as unknown as { csrfToken?: () => string }).csrfToken?.() ?? '',
          creditNotice,
        });
        return reply.view('admin/llm-usage.hbs', {
          pageTitle: 'LLM Usage',
          currentPath: '/admin/llm-usage',
          user: request.user,
          bodyHtml: body,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to fetch usage data';
        const body = renderPage({
          llmConnected: true,
          canFilterCrossOrg: isAdmin,
          currentOrgId: callerOrg,
          filterOrgId,
          filterCapability,
          filterFrom,
          filterTo,
          groupBy,
          summary: [],
          rows: [],
          totals: {
            callCount: 0, okCount: 0, errorCount: 0,
            promptTokens: 0, completionTokens: 0, totalTokens: 0,
            avgLatencyMs: 0,
            totalCostUsd: 0,
            rowsWithKnownPrice: 0, rowsWithUnknownPrice: 0,
          },
          errorMessage: `LLM usage query failed: ${message}`,
        });
        return reply.view('admin/llm-usage.hbs', {
          pageTitle: 'LLM Usage',
          currentPath: '/admin/llm-usage',
          user: request.user,
          bodyHtml: body,
        });
      }
    },
  );

  // Phase 80 — set / top up an org's AI-fix credit allocation.
  server.post(
    '/admin/llm-usage/credits',
    { preHandler: requirePermission('admin.system', 'admin.org'), schema: { ...HtmlPageSchema } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const llmClient = getLLMClient();
      const body = (request.body ?? {}) as Record<string, string | undefined>;
      const isAdmin = isSystemAdmin(request);
      const callerOrg = callerOrgId(request) ?? '';
      const orgId = isAdmin ? (body.orgId ?? '') : callerOrg;
      const updatedBy = (request.user as { id?: string } | undefined)?.id;
      if (llmClient === null || orgId === '') {
        return reply.redirect(`/admin/llm-usage${orgId !== '' ? `?orgId=${encodeURIComponent(orgId)}` : ''}`);
      }
      try {
        if (body.op === 'topup') {
          await llmClient.topupCredits(orgId, Number.parseInt(body.delta ?? '0', 10) || 0, updatedBy);
        } else {
          await llmClient.setCreditAllocation(orgId, Math.max(0, Number.parseInt(body.allocated ?? '0', 10) || 0), updatedBy);
        }
      } catch { /* surface nothing — the page will re-read the live balance */ }
      return reply.redirect(`/admin/llm-usage?orgId=${encodeURIComponent(orgId)}&credit=saved`);
    },
  );

  // Phase 80 — set an org's commercial plan (the entitlement foundation).
  server.post(
    '/admin/llm-usage/plan',
    { preHandler: requirePermission('admin.system', 'admin.org'), schema: { ...HtmlPageSchema } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = (request.body ?? {}) as Record<string, string | undefined>;
      const isAdmin = isSystemAdmin(request);
      const callerOrg = callerOrgId(request) ?? '';
      const orgId = isAdmin ? (body.orgId ?? '') : callerOrg;
      const updatedBy = (request.user as { id?: string } | undefined)?.id;
      const plan = (ORG_PLANS as readonly string[]).includes(body.plan ?? '') ? (body.plan as OrgPlan) : 'free';
      if (storage.entitlements !== undefined && orgId !== '') {
        await storage.entitlements.setPlan(orgId, plan, updatedBy);
      }
      return reply.redirect(`/admin/llm-usage?orgId=${encodeURIComponent(orgId)}&credit=saved`);
    },
  );

  // Phase 75 — Excel export. CSV is retired project-wide
  // (feedback_exports_excel_only); the shared buildXlsx helper from
  // routes/api/export.ts handles header styling + auto-filter +
  // frozen-pane. Re-uses listUsage so the same server-side org
  // scoping (admin.org forced to caller's org) applies identically.
  // Higher row cap (10k) since exports usually want history.
  server.get(
    '/admin/llm-usage/export.xlsx',
    {
      preHandler: requirePermission('admin.system', 'admin.org'),
      schema: {
        querystring: UsageQuery,
        tags: ['html-page'],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const llmClient = getLLMClient();
      if (llmClient === null) {
        return reply.code(503).header('content-type', 'text/plain').send('LLM service not connected');
      }
      const q = request.query as { orgId?: string; capability?: string; from?: string; to?: string };
      const isAdmin = isSystemAdmin(request);
      const callerOrg = callerOrgId(request) ?? '';
      const filterOrgId = isAdmin ? (q.orgId ?? '') : callerOrg;
      const fromIso = normalizeDate(q.from, 'start');
      const toIso = normalizeDate(q.to, 'end');
      try {
        const { rows } = await llmClient.listUsage({
          ...(filterOrgId !== '' ? { orgId: filterOrgId } : {}),
          ...(q.capability !== undefined && q.capability !== '' ? { capability: q.capability } : {}),
          ...(fromIso !== null ? { from: fromIso } : {}),
          ...(toIso !== null ? { to: toIso } : {}),
          limit: 10000,
        });
        const buffer = await buildXlsx(
          'LLM Usage',
          USAGE_XLSX_HEADERS,
          usageRowsToXlsxRows(rows),
          [22, 26, 28, 12, 26, 14, 14, 14, 16, 16, 16, 12, 10, 22],
        );
        const stamp = new Date().toISOString().slice(0, 10);
        reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        reply.header('Content-Disposition', `attachment; filename="luqen-llm-usage-${stamp}.xlsx"`);
        return reply.send(buffer);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown';
        return reply.code(502).header('content-type', 'text/plain')
          .send(`LLM usage export failed: ${message}`);
      }
    },
  );
}
