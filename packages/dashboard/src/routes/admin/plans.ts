/**
 * Phase 82 — Pricing & packaging reference page.
 *
 * Renders the canonical Free / Pro / Agency feature matrix (the single
 * platform-side source of truth in src/plan-matrix.ts) plus the per-tier
 * pricing anchors. Pricing is left as a configurable placeholder pending the
 * in-flight enterprise-pricing research — the page shows a clear TODO rather
 * than inventing a published price.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requirePermission } from '../../auth/middleware.js';
import { HtmlPageSchema } from '../../api/schemas/envelope.js';
import { escapeHtml } from './helpers.js';
import { PLAN_FEATURES, PLAN_ORDER, PRICING_ANCHORS, ORG_PLANS } from '../../plan-matrix.js';
import type { OrgPlan } from '../../db/interfaces/entitlement-repository.js';

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function renderPlans(currentPlan: OrgPlan): string {
  const tiers = ORG_PLANS as readonly OrgPlan[];

  const head = tiers.map((t) =>
    `<th class="num">${escapeHtml(cap(t))}${t === currentPlan ? ' <span class="badge">current</span>' : ''}</th>`,
  ).join('');

  const rows = PLAN_FEATURES.map((f) => {
    const cells = tiers.map((t) => {
      const on = PLAN_ORDER[t] >= PLAN_ORDER[f.minTier];
      return `<td class="num" aria-label="${on ? 'Included' : 'Not included'}">${on ? '<span style="color:#1a7f37">✓</span>' : '<span class="text-muted">–</span>'}</td>`;
    }).join('');
    return `<tr><td>${escapeHtml(f.label)} <span class="text-muted">(${escapeHtml(f.surface)})</span></td>${cells}</tr>`;
  }).join('\n');

  const pricing = PRICING_ANCHORS.map((p) =>
    `<tr><td>${escapeHtml(cap(p.plan))}</td><td>${p.priceLabel === null ? '<span class="text-muted">TBD</span>' : escapeHtml(p.priceLabel)}</td><td class="text-muted">${escapeHtml(p.note)}</td></tr>`,
  ).join('\n');

  return `<section aria-label="Plans &amp; pricing">
    <h1>Plans &amp; pricing</h1>
    <p class="text-muted mb-md">The single source of truth for what each commercial tier unlocks across the dashboard, the LLM
      service, and the WordPress plugin. Monetisation is <strong>admin-controlled — there is no billing integration</strong>;
      a plan is a per-organisation configuration value set by an administrator.</p>

    <section class="card mb-md" aria-labelledby="matrix-h">
      <h2 id="matrix-h" class="card__title">Feature matrix</h2>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Capability</th>${head}</tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </section>

    <section class="card" aria-labelledby="pricing-h">
      <h2 id="pricing-h" class="card__title">Pricing anchors</h2>
      <p class="alert alert--warning">Pro and Agency price anchors are <strong>placeholders pending the enterprise-pricing
        research</strong>. They are not published Luqen prices — set the published figure as configuration once the research lands.</p>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Plan</th><th>Price</th><th>Note</th></tr></thead>
        <tbody>${pricing}</tbody>
      </table></div>
    </section>
  </section>`;
}

export async function plansRoutes(server: FastifyInstance): Promise<void> {
  server.get(
    '/admin/plans',
    { preHandler: requirePermission('admin.system', 'admin.org'), schema: { ...HtmlPageSchema } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // The matrix is global; we just highlight the caller-relevant column if a
      // plan is resolvable. Default to 'free' — this is a read-only reference.
      return reply.view('admin/plans.hbs', {
        pageTitle: 'Plans & pricing',
        currentPath: '/admin/plans',
        user: request.user,
        bodyHtml: renderPlans('free'),
      });
    },
  );
}
