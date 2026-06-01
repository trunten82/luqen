/**
 * Phase 82 — Pricing & packaging: the canonical Free / Pro / Agency feature
 * matrix and pricing anchors.
 *
 * This is the single platform-side source of truth for which capabilities each
 * commercial tier unlocks. It is intentionally aligned with the WordPress
 * plugin's `Luqen_Entitlement::FEATURES` catalogue so the two surfaces describe
 * the same product. The per-org plan it keys on is the `org_entitlements`
 * model (Phase 80) — `EntitlementRepository.plan`.
 *
 * Monetisation is admin-controlled — there is no billing integration. PRICE
 * ANCHORS are deliberately left as configurable placeholders (null) pending the
 * in-flight enterprise-pricing research; do not hardcode published prices here.
 */

import { ORG_PLANS, type OrgPlan } from './db/interfaces/entitlement-repository.js';

export const PLAN_ORDER: Record<OrgPlan, number> = { free: 0, pro: 1, agency: 2 };

export interface PlanFeature {
  /** Stable key. */
  readonly key: string;
  /** Human label for the matrix. */
  readonly label: string;
  /** Minimum tier that unlocks the feature. */
  readonly minTier: OrgPlan;
  /** Which product surface owns the gate (for documentation). */
  readonly surface: 'wordpress' | 'dashboard' | 'platform';
}

/**
 * Capability catalogue. The WordPress-surfaced rows mirror
 * `Luqen_Entitlement::FEATURES` in the plugin; the platform rows cover the
 * dashboard/LLM monetised capabilities (metered AI fixes, agency console).
 */
export const PLAN_FEATURES: readonly PlanFeature[] = [
  // Always-free baseline.
  { key: 'single_page_scan', label: 'Single-page accessibility scan', minTier: 'free', surface: 'platform' },
  { key: 'gutenberg_fixes', label: 'Per-post Gutenberg fixes', minTier: 'free', surface: 'wordpress' },
  { key: 'issues_list', label: 'Basic issues list', minTier: 'free', surface: 'platform' },
  { key: 'a11y_statement', label: 'Accessibility statement', minTier: 'free', surface: 'platform' },
  // Pro conversion bundle (mirrors the WP plugin gate).
  { key: 'full_site_scan', label: 'Full-site & bulk scanning', minTier: 'pro', surface: 'wordpress' },
  { key: 'scan_history', label: 'Scan / audit history', minTier: 'pro', surface: 'wordpress' },
  { key: 'excel_export', label: 'Excel (xlsx) export', minTier: 'pro', surface: 'wordpress' },
  { key: 'cpt_scan', label: 'Custom post type & WooCommerce scanning', minTier: 'pro', surface: 'wordpress' },
  { key: 'multisite', label: 'Multisite network bulk fixes', minTier: 'pro', surface: 'wordpress' },
  { key: 'vpat', label: 'VPAT / ACR + evidence pack + secure sharing', minTier: 'pro', surface: 'platform' },
  { key: 'metered_ai_fixes', label: 'Credit-metered AI fix suggestions', minTier: 'pro', surface: 'platform' },
  // Agency tier.
  { key: 'agency_console', label: 'Multi-client agency console', minTier: 'agency', surface: 'dashboard' },
  { key: 'white_label', label: 'White-label / rebrandable client reports', minTier: 'agency', surface: 'dashboard' },
  { key: 'partner_seat', label: 'Partner/resale seat (N client sites)', minTier: 'agency', surface: 'dashboard' },
];

/** Whether a plan unlocks a given feature key. */
export function planAllows(plan: OrgPlan, featureKey: string): boolean {
  const feature = PLAN_FEATURES.find((f) => f.key === featureKey);
  if (feature === undefined) return true; // unknown capability is unrestricted
  return PLAN_ORDER[plan] >= PLAN_ORDER[feature.minTier];
}

/** All feature keys a plan unlocks. */
export function featuresForPlan(plan: OrgPlan): readonly string[] {
  return PLAN_FEATURES.filter((f) => PLAN_ORDER[plan] >= PLAN_ORDER[f.minTier]).map((f) => f.key);
}

/**
 * Per-tier pricing anchor. `priceLabel` is null until the enterprise-pricing
 * research lands — an administrator sets the published price as configuration.
 * The `validatedRange` notes are the only figures referenced so far (WP-shelf
 * comparable validation), NOT published Luqen prices.
 */
export interface PricingAnchor {
  readonly plan: OrgPlan;
  readonly priceLabel: string | null;
  readonly note: string;
}

export const PRICING_ANCHORS: readonly PricingAnchor[] = [
  { plan: 'free', priceLabel: '$0', note: 'Always free — single-page scans, Gutenberg fixes, accessibility statement.' },
  { plan: 'pro', priceLabel: null, note: 'TODO (pending enterprise-pricing research). WP-shelf comparable validated near ~$190/yr; not a published Luqen price.' },
  { plan: 'agency', priceLabel: null, note: 'TODO (pending enterprise-pricing research). WP-shelf comparable validated near ~$2,250/yr per 25 sites; not a published Luqen price.' },
];

export function pricingAnchorFor(plan: OrgPlan): PricingAnchor {
  return PRICING_ANCHORS.find((p) => p.plan === plan) ?? { plan, priceLabel: null, note: '' };
}

export { ORG_PLANS };
