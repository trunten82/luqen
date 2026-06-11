# Requirements — Milestone v3.5.0: Anti-overlay wedge — dev + exec first wave

Derived from the verified 2026-06 market-positioning brief (`.planning/MARKET-POSITIONING-2026-06.md`).
First wave = A1 (CI regression gate) + A3 (MCP fix tools) + B1 (jurisdiction legal-exposure scoring,
flagship) + B5 (scheduled exec digest). WordPress-leaned. All reporting stays conservative — never
"compliant"; exposure-indication + good-faith framing only.

**Supersedes** the reversed v3.5.0 "Commercial positioning & agency monetization" requirements
(POS-* shipped in Phase 78; GATE/CREDIT/AGENCY/PRICE-* are reversed — see Out of Scope).

---

## Active Requirements

### CIGATE — CI regression gate (developer; A1)
- [ ] **CIGATE-01**: A developer can run a CLI scan in fail-on-regression mode (e.g. `luqen scan --fail-on=new`) that exits non-zero when the scan introduces accessibility findings not present in a stored baseline.
- [ ] **CIGATE-02**: A developer can create and update a baseline of accepted findings for a target.
- [ ] **CIGATE-03**: A developer using the provided GitHub Action receives a PR comment summarizing new vs fixed findings (with WCAG criterion + jurisdiction context) on each pull request.
- [ ] **CIGATE-04**: A developer can configure the gate's failure threshold (severity / new-only) and the gate degrades gracefully with conservative output (never asserts "compliant").
- [ ] **CIGATE-05**: A WordPress author publishing/updating a post is warned (optionally blocked) when the edit introduces new accessibility violations versus the last scan.

### MCPFIX — MCP fix tools for coding agents (developer / agent-native; A3)
- [ ] **MCPFIX-01**: An agent/IDE (Cursor, Claude Code) connected to the Luqen MCP server can invoke a tool to scan a URL/page/HTML and receive structured accessibility findings.
- [ ] **MCPFIX-02**: An agent can invoke a tool to generate a source-level fix for a given finding, returning the proposed diff/snippet, an explanation, and the WCAG criterion.
- [ ] **MCPFIX-03**: A fix-tool response includes the applicable 58-jurisdiction legal context/framing for the finding.
- [ ] **MCPFIX-04**: The MCP fix tools can return WordPress-block-aware (Gutenberg) fixes through the same path.
- [ ] **MCPFIX-05**: The MCP fix tools enforce existing auth (OAuth2 JWT) + RBAC + org scoping (`mcp.use`) and never apply changes themselves — they return drafts a human/agent reviews and merges (human-supervised, anti-overlay).

### EXPO — Jurisdiction legal-exposure scoring (executive, flagship; B1)
- [ ] **EXPO-01**: A user viewing a site/scan sees a conservative legal-exposure indicator derived from scan findings + the site's selected jurisdiction framing, explicitly framed as exposure (never "compliant" or an assertion of fault).
- [ ] **EXPO-02**: The exposure indicator reflects jurisdiction-specific drivers — EU/EAA applicability, high-filing US states (NY/FL/IL), and ADA Title II 2027/2028 deadline countdowns where applicable.
- [ ] **EXPO-03**: A user can see a portfolio/fleet view that ranks sites by their exposure indicator.
- [ ] **EXPO-04**: A WordPress admin sees the per-site exposure indicator in the plugin dashboard.
- [ ] **EXPO-05**: The exposure model and its disclaimers are documented and conservative (transparency + good-faith framing, "not legal advice").

### DIGEST — Scheduled executive digest (executive; B5)
- [x] **DIGEST-01**: An admin can schedule a recurring (weekly/monthly) executive digest for an org or site.
- [x] **DIGEST-02**: The digest summarizes "what changed / what's at risk" since the last period — new vs fixed findings, exposure trend, and deadline countdowns — using the conservative framing.
- [x] **DIGEST-03**: The digest is delivered via the existing notify channels (email / Slack / Teams).
- [x] **DIGEST-04**: An admin can download or attach a board-ready PDF export of the digest.
- [x] **DIGEST-05**: A WordPress site can produce a per-site digest reusing WP company-info / per-site master data.

---

## Future Requirements (deferred — named follow-on milestones)

- Native mobile app accessibility testing (closes the Evinced / Level Access gap).
- Managed / guided expert-audit service (closes the Deque / Siteimprove / Allyant gap).
- A2 — deepen the PR-native fix workflow (batch criteria per PR, diff+explain review UX, idempotent re-runs).
- A5 — fleet "fix-once-apply-everywhere" (cross-site defect clustering → one source fix applied fleet-wide).
- B3 — remediation-velocity KPIs (time-to-fix, % criteria Not Evaluated→Supports, PR-merge cadence).
- A4 — framework-aware codemods; A6 — IDE extension; B2 — live portfolio dashboard; B4 — regression/trend alerting; B6 — board export polish.

---

## Out of Scope

- **Freemium / Pro / Agency feature gates, credit-metered fixes, white-label tiers, pricing/plan model** — reversed by the single-product decision ([[project_single_tier_decision]]); the platform ships as one product with no gates. (Was GATE/CREDIT/AGENCY/PRICE-* in the dead v3.5.0.)
- **External billing (Stripe / Freemius)** — not a product direction.
- **Design-stage / Figma tooling** — Stark owns that space; do not compete there now.
- **Any claim of "compliant" / "100%" / "lawsuit-proof"** — structurally excluded; conservative framing only.

---

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CIGATE-01 | Phase 79 | Pending |
| CIGATE-02 | Phase 79 | Pending |
| CIGATE-03 | Phase 79 | Pending |
| CIGATE-04 | Phase 79 | Pending |
| CIGATE-05 | Phase 79 | Pending |
| MCPFIX-01 | Phase 80 | Pending |
| MCPFIX-02 | Phase 80 | Pending |
| MCPFIX-03 | Phase 80 | Pending |
| MCPFIX-04 | Phase 80 | Pending |
| MCPFIX-05 | Phase 80 | Pending |
| EXPO-01 | Phase 81 | Pending |
| EXPO-02 | Phase 81 | Pending |
| EXPO-03 | Phase 81 | Pending |
| EXPO-04 | Phase 81 | Pending |
| EXPO-05 | Phase 81 | Pending |
| DIGEST-01 | Phase 82 | Complete |
| DIGEST-02 | Phase 82 | Complete |
| DIGEST-03 | Phase 82 | Complete |
| DIGEST-04 | Phase 82 | Complete |
| DIGEST-05 | Phase 82 | Complete |

**Coverage:** 20/20 requirements mapped to exactly one phase. No orphans, no duplicates.
