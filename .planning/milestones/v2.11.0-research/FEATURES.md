# Feature Research — v2.11.0 Brand Intelligence

**Domain:** Brand accessibility scoring + per-org service orchestration
**Researched:** 2026-04-10
**Confidence:** MEDIUM-HIGH (scoring methodology HIGH from WCAG/APCA sources; dual-mode UX MEDIUM — largely derived from existing v2.8.0 service-connections pattern; dashboard widget layout HIGH from established UX patterns)

---

## Context Recap

Existing infrastructure this milestone builds on:

- **BrandGuideline model** (v2.8.0+) — org + system scope, `colors[]`, `fonts[]`, `selectors[]`, active flag, link/clone semantics
- **BrandingMatcher** (`packages/branding/src/matcher/index.ts`) — produces `BrandedIssue[]` with `matched: boolean` + strategy. **No scoring layer exists today.**
- **ColorMatcher** — only checks whether a contrast-issue colour pair includes a brand colour. Does NOT currently compute contrast ratios against WCAG thresholds.
- **FontMatcher / SelectorMatcher** — similar binary match behaviour
- **Scan pipeline** — already retags scans when guidelines change (v2.9.0)
- **Report detail page** — already renders a per-scan a11y score (compliance-derived); brand score sits alongside
- **Service connections admin** (v2.8.0) — CRUD + encrypted storage + runtime reload + test button. Precedent for the dual-mode admin UX.
- **`getGuidelineForSite`** resolver — already handles org → system fallback

The v2.11.0 scoring layer is **new computation on top of existing BrandedIssue data**, not a rewrite of the matcher.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features required for the brand score to feel credible and comparable to competitors (Siteimprove, Monsido, Stark, Pinterest Gestalt scorecard).

| # | Feature | Why Expected | Complexity | Dependencies | Notes |
|---|---------|--------------|------------|--------------|-------|
| TS-1 | **Color contrast pair evaluation** — every text/bg, link/bg, and non-text/UI-component/bg pair on scanned pages is checked against WCAG 2.2 AA ratios (4.5:1 normal text, 3:1 large text, 3:1 non-text) | Contrast is the #1 published accessibility metric; Siteimprove, WebAIM, Level Access, Stark all expose this | MEDIUM — compliance scanner already surfaces `Guideline1_4.1_4_3` / `1_4_6` / `1_4_11` issues; new code aggregates these into a normalized sub-score, does NOT re-run pa11y/axe | Existing compliance scan output; existing `BrandedIssue.brandMatch` pairing | **Which pairs evaluated?** Text/bg (1.4.3), non-text UI (1.4.11), large text (1.4.6 AAA opt-in). Link-underline-vs-bg is covered by 1.4.11. **Do NOT implement custom contrast math** — reuse the issue codes already produced upstream. |
| TS-2 | **Normalization to 0-100** | Every competitor expresses scores as a percentage or a 0-100 number (Siteimprove, Lighthouse, WebAIM WAVE severity weighting). Ratios like "3.2:1" don't communicate to non-experts. | LOW — pure arithmetic | TS-1 | Recommended formula: `score = 100 * (1 - (weighted_violations / weighted_total_checks))`. Weight critical failures (normal text < 4.5:1) 3×, moderate (large text < 3:1) 2×, minor (non-text < 3:1) 1×. **Pin the formula in a constants file** so scores stay comparable across versions. |
| TS-3 | **Typography sub-score** covering: (a) brand fonts load/available on page, (b) minimum body size 16px, (c) line-height ≥ 1.5× of font-size, (d) text-spacing respects WCAG 1.4.12 (overridable to 200% paragraph, 150% line, 16% word, 12% letter) | WCAG 1.4.4 (resize text), 1.4.12 (text spacing), and WCAG 2.2 typography guidance make this the second published dimension. WebAIM recommends x-height ≥ 1.2mm (≈16px Arial). | MEDIUM — pa11y/axe already flag several of these; we aggregate. x-height requires a font-metrics lookup table (skip for v2.11.0, see defer list). | Existing scan output; BrandGuideline.fonts[] | **Scope for v2.11.0:** font availability + min body size + line-height. **Defer:** x-height calculation (needs opentype.js or similar), letter-spacing metrics. |
| TS-4 | **Component compliance sub-score** — percentage of scanned issues whose failing CSS selector maps to a brand-defined token/component vs. arbitrary off-brand markup | Orgs investing in design systems (Stark, Gestalt, Material) expect "is the brand actually being used?" as a metric separate from raw a11y | MEDIUM — SelectorMatcher already exists, just needs aggregation | SelectorMatcher, BrandGuideline.selectors[] | Formula: `component_score = 100 * (branded_issues / total_issues)` where branded = matcher returned `matched: true` with strategy=selector or font. Lower score means the site has many off-brand UI elements generating issues. **Interpretation matters:** high brand-coverage with many issues is worse than low brand-coverage with few issues — document clearly. |
| TS-5 | **Single composite 0-100 brand score** per scan, computed as weighted blend of color/typography/component sub-scores | Users expect one headline number. Siteimprove's accessibility score, Lighthouse, etc. all surface a single figure. | LOW | TS-1..4 | Recommended weights: **color 50%, typography 30%, component 20%**. Color dominates because contrast is the highest-impact user-facing issue. Weights stored as constants — not per-org overridable in v2.11.0 (too easy to make scores non-comparable). |
| TS-6 | **Per-scan score persistence** — every scan writes a row to a new `brand_score_history` table (or JSON column on existing scan_results) | Users cannot perceive "improvement" without historical anchor. Siteimprove, Monsido, Deque all store per-scan snapshots. | LOW — new table or JSON column on existing scan-result row | Existing scan pipeline | **Schema:** `(scan_id, org_id, guideline_id, composite_score, color_score, typography_score, component_score, issue_counts, scan_timestamp)`. Immutable rows — never update, always append. |
| TS-7 | **Brand score panel on report detail page** — shows composite + 3 sub-scores + delta vs previous scan | Every competitor shows score drill-down on their report pages. Missing = users ask "why did the score change?" | LOW — new partial added to existing report detail template | TS-6; existing report detail template | Render alongside existing a11y score card. Use existing `style.css` score tile classes — do not invent new ones. Delta arrow: ↑ green, ↓ red, — neutral. |
| TS-8 | **Backwards compatibility when no BrandGuideline resolved** | Orgs without brand guidelines must not see broken tiles or NaN | LOW | `getGuidelineForSite` already returns `null` cleanly | Render "No brand guideline — link one to see your brand score" call-to-action. **Do not** default to system guideline silently if the org has none linked. |
| TS-9 | **Per-org dual-mode routing for branding service** — per-org setting to route branding calls through embedded in-process DB OR through remote branding service REST | The whole milestone goal. Without this, the existing v2.8.0 service-connections pattern only works at system level; orgs can't self-host. | MEDIUM — extends existing service-connections table with `scope` (system/org) and per-org override resolution | v2.8.0 service-connections, OAuth2 per-org clients (v2.9.0) | **Do NOT** build a second config mechanism. Extend existing `service_connections` table with `org_id` column (nullable = system default) and add resolver fallback: `orgId → systemDefault → configFile`. |
| TS-10 | **Test connection button** on per-org branding service config — performs an OAuth2 auth + GET /health round-trip and returns success/failure with latency | v2.8.0 set the precedent; users will expect parity. Without it, misconfigured endpoints silently fail at scan-time. | LOW — reuse existing test-button handler from v2.8.0, scope it to org connection row | v2.8.0 `/admin/service-connections` test button | **Semantics:** button only tests auth + `/health` — does NOT write data or probe capabilities. Result shown inline next to button; auto-clears on next edit. |
| TS-11 | **Org dashboard summary widget** — tile showing current brand score (big number) + trend arrow + delta vs previous scan + sparkline of last N scans | Stripe, Linear, Vercel dashboard patterns all use metric card = big-number + trend indicator + sparkline. Missing a sparkline makes the score feel disconnected from history. | MEDIUM — new dashboard partial; sparkline rendering (inline SVG, no JS lib) | TS-6 (history), existing dashboard partial system | **Layout:** `[label] / [big number] / [arrow + delta] / [inline sparkline last 10 scans]`. Inline SVG sparkline keeps it zero-JS and accessible. Sparkline must have an accessible text alternative (sr-only description). |

### Differentiators (Competitive Advantage)

Features that go beyond table stakes and align with Luqen's "admin owns the stack" core value.

| # | Feature | Value Proposition | Complexity | Dependencies | Notes |
|---|---------|-------------------|------------|--------------|-------|
| D-1 | **Brand vs non-brand issue split** — alongside the score, show "X of Y issues are on brand-defined elements" | Existing competitors score the whole site as one number. Luqen already has BrandingMatcher separating branded vs unbranded issues — surfacing this split is a free competitive win. | LOW — data already exists in BrandedIssue[] | Existing matcher | Renders as two small counters under the main score tile. |
| D-2 | **Trend arrow semantics beyond `up/down`** — show `improved / held / regressed / new-scan` states | "↑ 3 points" is less useful than "Color contrast regressed 2 points, typography improved 5" | LOW — sub-score deltas already computed for TS-7 | TS-7 | Expose which dimension changed most. Drives user action. |
| D-3 | **Score target / goal line on sparkline** — org admin can set a target (e.g. 85) and the sparkline shows a horizontal reference line | Siteimprove calls this "Accessibility Site Target Score". Sets user expectations and celebrates when crossed. | LOW — another integer column on org settings | TS-11 | **Defer to v2.12.0** if time-constrained — nice-to-have but not gating. |
| D-4 | **System-default vs org-specific connection inheritance display** — when viewing a per-org connection, clearly show whether it's inheriting system default or has been overridden, with a "Reset to system default" button | Multi-level config inheritance is always confusing. Matches the `link / clone / unlink` pattern from system brand guidelines (v2.8.0). | LOW | TS-9 | Consistent with the mental model users already learned for brand guideline link/clone. |
| D-5 | **Per-scan brand score breakdown modal** — click the score tile and see exactly which issues contributed to each sub-score, with filters by dimension | Competitors show overall scores but rarely drill down to "which issue dragged the color score down?" | MEDIUM — reuses existing report detail issue table with filters | TS-7 | **Could defer** — TS-7 panel is sufficient for MVP; modal drill-down is polish. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that sound valuable but would create scope creep, comparability issues, or usability problems.

| # | Anti-Feature | Why Requested | Why Problematic | Alternative |
|---|--------------|---------------|-----------------|-------------|
| A-1 | **Per-org weight customization** for the composite score (let each org decide how color/typography/component blend) | "We care more about typography than contrast" | Breaks cross-org benchmarking. Makes trend lines meaningless when weights change mid-milestone. Creates endless "why is my score different from theirs?" support load. | **Hard-code the 50/30/20 weights** and document the rationale. Orgs that want different priorities should view sub-scores individually. |
| A-2 | **APCA (WCAG 3.0 draft) scoring** instead of WCAG 2.2 ratios | APCA is more perceptually accurate, mentioned in WCAG 3.0 draft | WCAG 3.0 is still a draft (as of 2026-04). Switching scoring methodology now would create two incompatible score histories. Most regulators still require WCAG 2.1/2.2. | **Stick with WCAG 2.2 AA for v2.11.0.** Add APCA as optional secondary metric in v3.0.0+ when WCAG 3.0 is finalized. Document this decision in PROJECT.md Key Decisions. |
| A-3 | **Real-time score updates as users edit brand guidelines** (WebSocket live recompute) | "I want to see the score move as I tweak colours" | Requires re-scanning, which is expensive and rate-limited. False sense of interactivity. | Existing retag-on-guideline-change (v2.9.0) already handles this — next scan reflects the change. Document in UI: "Save to update next scan". |
| A-4 | **Letter-grade A/B/C/D/F** instead of 0-100 | Teachers-style grading feels intuitive | Grade boundaries become political (why is 79 a C+?). Loses granularity needed for trend tracking. Siteimprove tried and now shows numeric. | Show 0-100 number with colour band (green ≥85, amber 70-84, red <70). Grade bands in CSS only, not in stored data. |
| A-5 | **Automatic score alerts via email** when score drops | "Alert me when I regress" | Noise — scans run daily, small fluctuations trigger alert fatigue. Needs thresholds, snooze, per-user config. Scope creep. | **Defer to v2.12.0+.** v2.11.0 shows trend in UI; email alerts build on top if users ask. |
| A-6 | **Cross-org leaderboard** ("your org ranks #12 of 50 customers") | Gamification, motivating | Privacy/GDPR concerns. Small orgs always lose. Distracts from the org's own trend. | Don't build. If ever needed, opt-in per-org anonymous benchmarks. |
| A-7 | **Dual-mode with hot-swap mid-scan** (switch embedded → remote while a scan is running) | "Seamless failover" | Race conditions, partially-written scan data, matcher identity changes. Enormous edge-case surface. | **Mode switch takes effect on next scan only.** Active scans complete under old mode. Document clearly. |
| A-8 | **Custom sub-score dimensions** ("let admins add a 'motion/animation' sub-score") | Brand compliance creativity | Schema churn, matcher plugin architecture, unbounded complexity. | v2.11.0 ships 3 fixed dimensions. Future plugin architecture (v3.0.0+) could open this. |

---

## Feature Dependencies

```
[v2.8.0 service_connections table] ──extended──> [TS-9 per-org dual-mode]
                                                       │
                                                       └──enables──> [TS-10 test connection button]
                                                                          │
                                                                          └──uses pattern from──> [D-4 inheritance display]

[v2.8.0 BrandGuideline + matcher] ──reused──> [TS-1 color contrast eval]
                                                [TS-3 typography eval]
                                                [TS-4 component eval]
                                                       │
                                                       └──aggregated by──> [TS-2 normalization]
                                                                                │
                                                                                └──produces──> [TS-5 composite score]
                                                                                                      │
                                                                                                      └──persisted by──> [TS-6 history table]
                                                                                                                              │
                                                                                                                              ├──renders──> [TS-7 report panel]
                                                                                                                              │                   │
                                                                                                                              │                   └──enhanced by──> [D-1 brand/non-brand split]
                                                                                                                              │                   └──enhanced by──> [D-2 trend semantics]
                                                                                                                              │                   └──enhanced by──> [D-5 drilldown modal]
                                                                                                                              │
                                                                                                                              └──renders──> [TS-11 dashboard widget]
                                                                                                                                                  │
                                                                                                                                                  └──enhanced by──> [D-3 target line]

[scan pipeline retag v2.9.0] ──invokes──> [TS-5 composite score] ──writes──> [TS-6 history]
```

### Dependency Notes

- **TS-9 (dual-mode) is independent** of the scoring stack (TS-1..7). These are two parallel workstreams within the milestone — scoring doesn't wait for dual-mode and vice versa.
- **TS-6 (persistence) gates both TS-7 and TS-11** — until scores are stored, neither the report panel nor the dashboard widget has data. Put TS-6 first in phase ordering.
- **TS-11 dashboard widget depends on TS-6 history** — at least 2 scans needed before a sparkline has meaning. Widget must render a graceful empty state at 0 or 1 scans.
- **TS-4 (component score) depends on existing SelectorMatcher** — if selectors are empty in the guideline, component sub-score must report "N/A" rather than 0 (avoids penalising orgs that haven't configured selectors).
- **D-3 (target line) enhances TS-11** and is the only differentiator that's completely optional — ship TS-11 first, add D-3 in the same or next phase.
- **D-4 (inheritance display) depends on TS-9** — without dual-mode there's no inheritance to display.
- **A-7 conflict:** hot-swap mid-scan conflicts with the scan pipeline's batched execution. Explicit anti-feature.

---

## MVP Definition

### Launch With (v2.11.0)

Must-have for the milestone to be coherent. Drop any of these and the release feels half-done.

- [ ] **TS-1** Color contrast sub-score (aggregate existing contrast issues, no new scanner logic)
- [ ] **TS-2** 0-100 normalization with pinned weights (50/30/20)
- [ ] **TS-3** Typography sub-score — **scope:** font availability + min 16px body + line-height ≥ 1.5 only. (Defer x-height, letter-spacing.)
- [ ] **TS-4** Component sub-score from SelectorMatcher aggregation (N/A when selectors empty)
- [ ] **TS-5** Composite score with fixed weights
- [ ] **TS-6** `brand_score_history` persistence (new table, append-only)
- [ ] **TS-7** Report detail page brand score panel (composite + 3 sub-scores + delta)
- [ ] **TS-8** Graceful "no guideline linked" state
- [ ] **TS-9** Per-org dual-mode routing via extended `service_connections` table
- [ ] **TS-10** Test connection button for per-org branding connection
- [ ] **TS-11** Org dashboard widget (big number + arrow + delta + inline SVG sparkline)
- [ ] **D-1** Brand vs non-brand issue split counters (cheap win, already-available data)
- [ ] **D-4** System-default inheritance display + "Reset to system" button on per-org connection

### Add After Validation (v2.12.0)

- [ ] **D-2** Trend arrow with per-dimension semantics ("color regressed 2, typography improved 5")
- [ ] **D-3** Score target / goal line on sparkline
- [ ] **D-5** Per-scan breakdown modal (filter issues by which dimension they impact)
- [ ] **Typography x-height** calculation (requires font-metrics lookup)
- [ ] **Letter-spacing / word-spacing** metrics

### Future Consideration (v3.0.0+)

- [ ] APCA secondary scoring once WCAG 3.0 is finalized (anti-feature A-2 only until then)
- [ ] Email alerts on score regression (anti-feature A-5 for now)
- [ ] Custom sub-score dimensions / plugin architecture (anti-feature A-8 for now)
- [ ] Opt-in anonymous cross-org benchmarks (anti-feature A-6 for now)

---

## Feature Prioritization Matrix

| # | Feature | User Value | Impl. Cost | Priority |
|---|---------|------------|------------|----------|
| TS-1 | Color contrast sub-score | HIGH | MEDIUM | P1 |
| TS-2 | 0-100 normalization | HIGH | LOW | P1 |
| TS-3 | Typography sub-score (reduced scope) | HIGH | MEDIUM | P1 |
| TS-4 | Component sub-score | MEDIUM | MEDIUM | P1 |
| TS-5 | Composite score | HIGH | LOW | P1 |
| TS-6 | History persistence | HIGH | LOW | P1 |
| TS-7 | Report detail panel | HIGH | LOW | P1 |
| TS-8 | No-guideline empty state | MEDIUM | LOW | P1 |
| TS-9 | Dual-mode routing | HIGH | MEDIUM | P1 |
| TS-10 | Test connection button | MEDIUM | LOW | P1 |
| TS-11 | Dashboard widget | HIGH | MEDIUM | P1 |
| D-1 | Brand vs non-brand split | MEDIUM | LOW | P1 (free) |
| D-2 | Per-dimension trend semantics | MEDIUM | LOW | P2 |
| D-3 | Target line on sparkline | MEDIUM | LOW | P2 |
| D-4 | Inheritance display + reset | MEDIUM | LOW | P1 |
| D-5 | Drilldown modal | LOW | MEDIUM | P2 |

---

## Competitor Feature Analysis

| Feature | Siteimprove | Monsido | Stark / Gestalt | Luqen v2.11.0 |
|---------|-------------|---------|-----------------|---------------|
| Composite a11y score | Yes (proprietary blend) | Yes (WCAG violation count) | No (design-time, not runtime) | Yes (color+type+component blend) |
| Sub-score breakdown | Partial (Level A/AA/AAA filters) | Partial | N/A | Yes (3 dimensions) |
| Trend over time | Yes (Compliance Progress chart) | Yes (history of improvements) | N/A | Yes (per-scan history + sparkline) |
| Brand vs generic a11y split | No | No | Partial (component scorecard) | **Yes** (differentiator D-1) |
| Score target line | Yes ("Site Target Score") | No | No | Defer to v2.12.0 (D-3) |
| Per-org dual-mode routing | N/A (SaaS only) | N/A (SaaS only) | N/A | **Yes** (TS-9) |
| WCAG version | 2.1 AA / 2.2 in progress | 2.1 AA | Figma-side 2.1 | **2.2 AA** (current spec) |

**Takeaway:** Luqen's competitive edge is (a) the brand-vs-generic split (D-1), (b) self-hostable dual-mode (TS-9 — unique vs SaaS-only competitors), and (c) running against current WCAG 2.2 rather than older 2.1.

---

## Implementation Notes for Roadmap Consumers

### Scoring dimensions MUST-HAVE in v2.11.0

1. **Color contrast** — uses existing compliance issue codes, no new scanner
2. **Typography (reduced)** — font availability + min size + line-height only
3. **Component compliance** — SelectorMatcher aggregation, N/A when empty

### Scoring dimensions OK TO DEFER

- x-height metric (needs opentype.js — measurable scope addition)
- Letter-spacing / word-spacing metrics
- APCA / WCAG 3.0 algorithms (spec not final)

### Dual-mode routing MUST-HAVE in v2.11.0

1. Extend `service_connections` table with `org_id` (nullable) column
2. Resolver fallback: org override → system default → config file
3. Test connection button per org row
4. "Reset to system default" to clear org override
5. **Not** hot-swap (anti-feature A-7)

### UI widgets MUST-HAVE in v2.11.0

1. Report detail brand score panel (composite + 3 sub + delta)
2. Dashboard org widget (big number + arrow + delta + sparkline)
3. Empty state when no guideline linked

### Data model impact

- **New table:** `brand_score_history` (append-only, one row per scan per guideline)
- **Altered table:** `service_connections` (add `org_id` nullable column; existing rows become system defaults)
- **No change** to BrandGuideline, scan_results, matcher output shape — scoring is a new aggregation layer on top.

### Backwards compatibility anchors

- Existing scans without `brand_score_history` rows → widget shows empty state
- Existing system-only service connections → no-op; they become system defaults
- Orgs without linked guidelines → panel and widget render the "link a guideline" CTA, not a zero score
- Matcher output shape unchanged → v2.10.0 report detail keeps working through the transition

---

## Sources

**WCAG / Contrast methodology (HIGH confidence):**
- [WebAIM: Contrast and Color Accessibility](https://webaim.org/articles/contrast/)
- [Understanding SC 1.4.3: Contrast (Minimum)](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html)
- [Understanding SC 1.4.12: Text Spacing](https://www.w3.org/WAI/WCAG21/Understanding/text-spacing.html)
- [WebAIM: Typefaces and Fonts](https://webaim.org/techniques/fonts/)
- [Section508.gov — Fonts and Typography](https://www.section508.gov/develop/fonts-typography/)
- [A11Y Collective — WCAG minimum font size](https://www.a11y-collective.com/blog/wcag-minimum-font-size/)

**WCAG 3.0 / APCA context (MEDIUM confidence — draft spec):**
- [WCAG 3.0 Status 2026: Draft Changes, APCA & How to Prepare](https://web-accessibility-checker.com/en/blog/wcag-3-0-guide-2026-changes-prepare)
- [WCAG 3.0 Updates Explained: 2026-2030](https://rubyroidlabs.com/blog/2025/10/how-to-prepare-for-wcag-3-0/)

**Competitor scoring behaviour (MEDIUM confidence — vendor docs):**
- [Siteimprove — Accessibility Site Target Score](https://help.siteimprove.com/support/solutions/articles/80001152008-accessibility-site-target-score)
- [Siteimprove — Tracking Accessibility Regulations with Compliance Pages](https://help.siteimprove.com/support/solutions/articles/80001176681-tracking-accessibility-regulations-with-the-compliance-pages)
- [Siteimprove — Why has my score changed?](https://help.siteimprove.com/support/solutions/articles/80000448512-why-has-my-score-changed-even-though-i-have-not-made-changes-to-my-site-)
- [Monsido Review: Accessibility Features](https://www.accessibilitychecker.org/guides/monsido-review/)
- [Siteimprove Brand Compliance Platform](https://www.siteimprove.com/platform/content-strategy/brand-compliance-software/)

**Design tokens & component compliance scoring (MEDIUM confidence):**
- [Artwork Flow — 21 Best Brand Compliance Tools](https://www.artworkflowhq.com/resources/21-best-brand-compliance-tools)
- [Design Tokens with Confidence (UX Collective)](https://uxdesign.cc/design-tokens-with-confidence-862119eb819b)
- [W3C Design Tokens Community Group](https://www.w3.org/community/design-tokens/)

**Dashboard widget / sparkline UX patterns (HIGH confidence — widely established):**
- [Smart SaaS Dashboard Design Guide 2026 (F1Studioz)](https://f1studioz.com/blog/smart-saas-dashboard-design/)
- [Dashboard Design Patterns for Modern Web Apps 2026](https://artofstyleframe.com/blog/dashboard-design-patterns-web-apps/)
- [Top Dashboard Widget Design Inspirations 2026 (Fanruan)](https://www.fanruan.com/en/blog/top-dashboard-widgets-design-inspirations)
- [9 Dashboard Design Principles 2026 (DesignRush)](https://www.designrush.com/agency/ui-ux-design/dashboard/trends/dashboard-design-principles)

**Dual-mode routing (LOW-MEDIUM confidence — pattern derived from existing v2.8.0 code + general multi-tenant literature):**
- [Flagsmith — Feature Flags vs Remote Configuration](https://www.flagsmith.com/blog/feature-flags-vs-remote-configuration)
- [Multi-Tenant Mobile Architecture (Medium)](https://medium.com/@ranvirpawar08/multi-tenant-mobile-architecture-c950e793efb7)
- Luqen v2.8.0 `/admin/service-connections` pattern (internal prior art — strongest reference for the UX)

---

*Feature research for: v2.11.0 Brand Intelligence*
*Researched: 2026-04-10*
