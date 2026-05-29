# Requirements — Milestone v3.5.0: Commercial positioning & agency monetization

Derived from the deep-research findings (2026-05-29). Genuine-remediation positioning + the freemium→Pro→Agency monetization spine the WP-shelf competitors prove converts.

**Research provenance:** overlay collapse (FTC $1M / NFB revocation / sued-despite-widget) verified 3-0; Equalize Digital freemium gate (full-site scan, audit history, Excel export, CPT, multisite) verified 3-0; Elementor Ally credit-metered AI fixes verified 3-0. Enterprise pricing + market-size + jurisdiction-uniqueness + agency-demand specifics from a follow-up run (in flight) feed PRICE-* and refine AGENCY-*.

---

## Active Requirements

### POS — Positioning (anti-overlay)
- [ ] **POS-01**: A prospective user reading the WP plugin `readme.txt` sees Luqen framed as genuine source-level remediation, with an explicit anti-overlay section naming the risk (overlays don't deliver compliance or prevent lawsuits).
- [ ] **POS-02**: A user viewing a scan report / the dashboard landing sees genuine-remediation positioning (real fixes in your source, not a widget).
- [ ] **POS-03**: A user can read a "why not an overlay" comparison surface citing the verified evidence (FTC settlement, NFB revocation, lawsuits-despite-widget rate).

### GATE — Pro feature gating (WP plugin)
- [ ] **GATE-01**: A free-tier WP user is limited on full-site/bulk scanning; a Pro-entitled user can run full-site/bulk scans.
- [ ] **GATE-02**: A Pro user can view retained audit history for a post/page across scans.
- [ ] **GATE-03**: A Pro user can export findings to Excel (xlsx; no CSV per project rule).
- [ ] **GATE-04**: A Pro user can scan custom post types / WooCommerce products.
- [ ] **GATE-05**: A Pro/agency user can run the plugin across a multisite network.
- [ ] **GATE-06**: The plugin enforces free-vs-Pro entitlement (in enterprise mode entitlement derives from the connected Luqen instance's org plan; a standalone license-key path is stubbed for future).

### CREDIT — Credit-metered AI fixes
- [ ] **CREDIT-01**: Each `generate-fix` call decrements an org credit balance, recorded on top of the existing `llm_usage` ledger.
- [ ] **CREDIT-02**: An admin can set/top-up a per-org credit allocation; the system maintains a balance + consumption ledger.
- [ ] **CREDIT-03**: When an org's credits are exhausted, `generate-fix` is gated and degrades gracefully to the deterministic fix fallback (never hard-errors the user flow).
- [ ] **CREDIT-04**: A dashboard user sees remaining credit balance and consumption against allocation on `/admin/llm-usage`.
- [ ] **CREDIT-05**: A WP plugin user sees remaining credits / a paywall prompt when AI fixes are metered out.

### AGENCY — Agency tier
- [ ] **AGENCY-01**: An agency user manages multiple client orgs/sites from a single multi-client console.
- [ ] **AGENCY-02**: An agency can generate white-label / rebrandable client reports (agency logo + name, not Luqen branding).
- [ ] **AGENCY-03**: An agency can generate a VPAT / ACR (Accessibility Conformance Report) for a client site.
- [ ] **AGENCY-04**: The platform models a partner/resale entitlement (agency plan covering N client sites).
- [ ] **AGENCY-05**: An agency can apply white-label theming (logo, colors) to client-facing dashboard/report surfaces.

### PRICE — Pricing & packaging
- [ ] **PRICE-01**: Free/Pro/Agency tiers are codified as an explicit feature matrix (which capabilities each tier unlocks).
- [ ] **PRICE-02**: Pricing anchors are documented (informed by the in-flight enterprise-pricing research; WP anchors free→~$190/yr Pro→~$2,250/yr/25-site Agency already validated).
- [ ] **PRICE-03**: A per-org plan/entitlement model drives feature availability platform-wide (single source of truth consumed by dashboard + LLM + WP).

---

## Future Requirements (deferred)
- External billing integration (Stripe/Freemius) + self-serve checkout — this milestone keeps plan/credit allocation admin-controlled.
- Standalone WP.org license-key issuance + a hosted licensing service (only the entitlement hook is stubbed in GATE-06).
- Usage-based overage billing / auto-top-up.
- Per-end-user (vs per-org) credit attribution.

## Out of Scope (explicit)
- Payment processing / PCI handling — deliberately excluded; Core Value keeps admins in control via the dashboard, not a billing pipeline.
- Reviving the removed LLM provider plugins (superseded by @luqen/llm).
- Overlay/widget functionality of any kind — Luqen is the genuine-remediation antithesis of overlays; building one would undercut POS-*.

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| POS-01 | Phase 78 | Pending |
| POS-02 | Phase 78 | Pending |
| POS-03 | Phase 78 | Pending |
| GATE-01 | Phase 79 | Pending |
| GATE-02 | Phase 79 | Pending |
| GATE-03 | Phase 79 | Pending |
| GATE-04 | Phase 79 | Pending |
| GATE-05 | Phase 79 | Pending |
| GATE-06 | Phase 79 | Pending |
| CREDIT-01 | Phase 80 | Pending |
| CREDIT-02 | Phase 80 | Pending |
| CREDIT-03 | Phase 80 | Pending |
| CREDIT-04 | Phase 80 | Pending |
| CREDIT-05 | Phase 80 | Pending |
| AGENCY-01 | Phase 81 | Pending |
| AGENCY-02 | Phase 81 | Pending |
| AGENCY-03 | Phase 81 | Pending |
| AGENCY-04 | Phase 81 | Pending |
| AGENCY-05 | Phase 81 | Pending |
| PRICE-01 | Phase 82 | Pending |
| PRICE-02 | Phase 82 | Pending |
| PRICE-03 | Phase 82 | Pending |

**Coverage: 22/22 requirements mapped — no orphans, no duplicates.**
