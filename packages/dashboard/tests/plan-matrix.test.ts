import { describe, it, expect } from 'vitest';
import {
  PLAN_FEATURES,
  planAllows,
  featuresForPlan,
  pricingAnchorFor,
  PRICING_ANCHORS,
} from '../src/plan-matrix.js';

describe('plan matrix (Phase 82)', () => {
  it('free unlocks only the free-tier features', () => {
    const free = featuresForPlan('free');
    expect(free).toContain('single_page_scan');
    expect(free).not.toContain('full_site_scan');
    expect(free).not.toContain('agency_console');
  });

  it('pro unlocks the conversion bundle but not agency features', () => {
    expect(planAllows('pro', 'full_site_scan')).toBe(true);
    expect(planAllows('pro', 'vpat')).toBe(true);
    expect(planAllows('pro', 'metered_ai_fixes')).toBe(true);
    expect(planAllows('pro', 'agency_console')).toBe(false);
    expect(planAllows('pro', 'white_label')).toBe(false);
  });

  it('agency unlocks everything', () => {
    for (const f of PLAN_FEATURES) {
      expect(planAllows('agency', f.key)).toBe(true);
    }
  });

  it('treats an unknown capability as unrestricted', () => {
    expect(planAllows('free', 'something_unlisted')).toBe(true);
  });

  it('mirrors the WordPress plugin Pro gate catalogue', () => {
    // The WP plugin (Luqen_Entitlement::FEATURES) gates exactly these as 'pro'.
    const wpProGates = ['full_site_scan', 'scan_history', 'excel_export', 'cpt_scan', 'multisite', 'vpat'];
    for (const key of wpProGates) {
      const f = PLAN_FEATURES.find((x) => x.key === key);
      expect(f, `matrix should include ${key}`).toBeDefined();
      expect(f?.minTier).toBe('pro');
    }
  });

  it('leaves Pro/Agency price anchors as null placeholders (pending research)', () => {
    expect(pricingAnchorFor('free').priceLabel).toBe('$0');
    expect(pricingAnchorFor('pro').priceLabel).toBeNull();
    expect(pricingAnchorFor('agency').priceLabel).toBeNull();
    expect(PRICING_ANCHORS).toHaveLength(3);
  });
});
