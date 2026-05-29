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
import type { LLMClient, LlmUsageRow, LlmUsageTotals } from '../../llm-client.js';
import { escapeHtml } from './helpers.js';

const UsageQuery = Type.Object(
  {
    orgId: Type.Optional(Type.String()),
    capability: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

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

function renderPage(opts: {
  readonly llmConnected: boolean;
  readonly canFilterCrossOrg: boolean;
  readonly currentOrgId: string;
  readonly filterOrgId: string;
  readonly filterCapability: string;
  readonly rows: ReadonlyArray<LlmUsageRow>;
  readonly totals: LlmUsageTotals;
  readonly errorMessage: string | null;
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

  return `<section aria-label="LLM Usage">
    <p class="text-muted mb-md">Per-inference token usage and latency across all capabilities. Cost figures are not yet calculated (Phase 72 deliberately ships tokens-only until a pricing source is chosen).</p>

    ${renderTotals(opts.totals)}

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
      <div class="field field--actions">
        <button type="submit" class="btn btn--primary">Apply</button>
        <a href="/admin/llm-usage" class="btn btn--ghost">Reset</a>
      </div>
    </form>

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
      const q = request.query as { orgId?: string; capability?: string };
      const isAdmin = isSystemAdmin(request);
      const callerOrg = callerOrgId(request) ?? '';
      const filterOrgId = isAdmin
        ? (q.orgId ?? '')
        : callerOrg;
      const filterCapability = q.capability ?? '';

      if (llmClient === null) {
        const body = renderPage({
          llmConnected: false,
          canFilterCrossOrg: isAdmin,
          currentOrgId: callerOrg,
          filterOrgId,
          filterCapability,
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
        const { rows, totals } = await llmClient.listUsage({
          ...(filterOrgId !== '' ? { orgId: filterOrgId } : {}),
          ...(filterCapability !== '' ? { capability: filterCapability } : {}),
          limit: 500,
        });
        const body = renderPage({
          llmConnected: true,
          canFilterCrossOrg: isAdmin,
          currentOrgId: callerOrg,
          filterOrgId,
          filterCapability,
          rows,
          totals,
          errorMessage: null,
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
}
