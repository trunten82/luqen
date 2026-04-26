# Pitfalls Research

**Domain:** Brand accessibility scoring + per-org dual-mode orchestrator routing (v2.11.0)
**Researched:** 2026-04-10
**Confidence:** HIGH (grounded in v2.8.0-v2.10.0 incidents in this codebase)

## Critical Pitfalls

### Pitfall 1: Score normalization drift across guidelines with unequal coverage

**What goes wrong:**
A brand score of `78` on Org A and `78` on Org B turn out to mean completely different things because Org A has a guideline with colors + typography + components (3 categories) while Org B only has colors (1 category). An unweighted arithmetic mean of per-category scores normalizes wildly differently depending on category count, so the "same number" silently represents different things. Trend lines break the moment an admin adds a second category — the aggregate jumps even though nothing about the site changed.

**Why it happens:**
The natural reflex is `score = sum(categoryScores) / categoryCount`. That works for a fixed schema but this system has optional categories. Coverage changes over time as guidelines grow (CSS import extracts new fonts, admin adds components). The score function conflates "this site scores poorly" with "this org measures more things."

**How to avoid:**
- Define `score` as `weighted(categoryScores, coverageWeight)` where weight is fixed by category identity, not by "how many are present." Categories not applicable to a guideline are `null` (excluded from denominator, tracked separately), never `0` (which kills the score).
- Persist both the numeric score and the `coverageProfile` (which categories contributed) on every scan. Comparing scores across time must gate on identical profiles or explicitly mark "coverage changed" on the trend line.
- Unit-test: score with colors only == score with colors + null typography + null components (proving null != 0).
- Integration test: add a new guideline category to an org and assert historical scores are re-marked as `coverage: partial`, not silently re-computed.

**Warning signs:**
- PR diff changes `/ categoryCount` to `/ (categoryCount + 1)` — red flag for coverage regression.
- Trend line in UI shows a step-change on the day a guideline was edited.
- Score formula lives in more than one file (dashboard and branding service compute differently).
- Missing `null` branches in the reducer — look for `categoryScores.reduce((a, b) => a + b, 0)` without filter.

**Phase to address:** Scoring Model / Contract phase — must land BEFORE persistence and UI phases.

---

### Pitfall 2: WCAG AA vs AAA threshold confusion in contrast scoring

**What goes wrong:**
Contrast scoring uses AA thresholds (4.5:1 normal, 3:1 large) on the dashboard UI, but the branding service's guideline-matching code uses AAA thresholds (7:1 normal, 4.5:1 large) because it was copied from a reference pair. An org with 5.1:1 contrast scores "pass" in the report panel but shows up as "fail" in the brand score widget. Users file bug tickets because the two numbers disagree.

**Why it happens:**
- WCAG thresholds aren't stored as constants, they're inlined at the comparison site.
- The branding service and the dashboard have independent copies of "what a passing color is."
- Large-text vs normal-text threshold selection depends on font-size/weight metadata which isn't always available in extracted CSS, so the wrong default is silently applied.
- Sub-pixel rounding: `4.49999...` vs `4.5` — one passes, one fails — depending on which color library rounds where.

**How to avoid:**
- Define `ContrastLevel = 'AA' | 'AAA'` as a first-class field on the guideline schema. Default AA, admin-overridable. Log + surface the level used in score metadata so downstream consumers can't guess.
- Single source of truth: export `wcagContrastPasses(ratio, level, isLargeText)` from `@luqen/core` (or equivalent shared package) and use it in BOTH the scoring path and the report UI. No literal `4.5` in code outside that function.
- `isLargeText` must default to `false` when font metadata is absent (conservative), and the score must flag "assumed normal text" in metadata.
- Test fixtures for every boundary: 4.49, 4.50, 4.51, 6.99, 7.00, 7.01.

**Warning signs:**
- Literal `4.5`, `3`, `7` in code outside the contrast utility.
- Two different functions named `checkContrast` in different packages.
- Report panel number != brand widget number for the same scan.

**Phase to address:** Scoring Model phase — ratification of the contrast utility; block any score code that imports thresholds as literals.

---

### Pitfall 3: Trend schema drift invalidates historical data

**What goes wrong:**
Phase X ships `brand_scan_scores` with columns `(scan_id, overall, colors, typography, components)`. Phase X+1 adds a "logo" category — column added as nullable. Trend graph blows up because `AVG(logo)` across history returns `NULL` then silently becomes `0` when coerced in the template, producing a fake dip. Three months later someone "cleans up" the nullable column by backfilling `0` — now the historical dip is permanent.

**Why it happens:**
- Nullable columns feel harmless until aggregation.
- Handlebars/UI coerces `null` → `0` or `"0"` → `0` with no warning.
- Backfill seems correct ("empty = zero, right?") but destroys the signal "we didn't measure this yet."
- No database-level invariant separating "measured and zero" from "not measured."

**How to avoid:**
- Every score column is a `(value INTEGER NULL, measured_at INTEGER NULL)` pair, or use a sentinel row in a normalized `brand_score_categories` table (`scan_id`, `category`, `score`, `computed_at`) so missing = absent row, not a NULL column.
- Prefer normalized table over wide denormalized row — adding a category means inserting rows, not `ALTER TABLE`.
- Aggregation queries MUST filter `WHERE category = ? AND score IS NOT NULL`. Never `AVG(column)` on the wide table.
- NEVER backfill historical data with `0` — backfill with `NULL` or leave absent. Add a Decision to PROJECT.md: "Historical brand score category backfills forbidden."
- Migration test: run migration, add new category, assert old scans report `coverage: partial` not `score: 0`.

**Warning signs:**
- A migration PR adds a score column as `DEFAULT 0 NOT NULL`.
- Template renders `{{score.logo}}` without a null guard.
- Trend endpoint SELECTs all columns and averages in JS — zero-coercion lurking.
- Someone proposes "let's just backfill zero for consistency."

**Phase to address:** Schema + Persistence phase. Normalized table decision must be in the Schema phase before any writes happen.

---

### Pitfall 4: Edge case explosions — zero colors, missing fonts, empty guideline

**What goes wrong:**
A guideline with zero colors defined produces `colorScore = NaN` (0/0), which serializes to `null`, which renders as `N/A` in one place and `—` in another and `0` in the trend graph. A site with only system-ui fonts has no measurable brand compliance so `typographyScore` is also `null`. The overall score computes `(null + null + 88) / 3 = NaN`. Report page shows `NaN%`. Dashboard widget shows `—`. Aggregation query SUMs across orgs and returns `NaN` for the whole tenant.

**Why it happens:**
- JavaScript's `NaN` propagates silently through arithmetic (`NaN + 1 === NaN`).
- Division by zero in category scoring returns `NaN`, not an error.
- Templates don't guard NaN (Handlebars treats `NaN` as truthy and prints it verbatim).
- Empty guideline is a valid state (admin creates guideline, hasn't populated yet) but not a valid scoring input.

**How to avoid:**
- Score function must return a discriminated union: `{ kind: 'scored', value: number, coverage: CoverageProfile } | { kind: 'unscorable', reason: 'empty-guideline' | 'no-applicable-categories' }`. NEVER `number | null`.
- Explicit `if (denom === 0) return { kind: 'unscorable', reason: 'empty-guideline' }`.
- UI distinguishes: "No guideline" (onboarding CTA), "Empty guideline" (populate CTA), "Scored" (show number + trend).
- Property test: random guideline fuzz → scorer returns valid discriminated union, never NaN, never throws.
- Storage: `unscorable` scans are recorded with `value = NULL` and a `reason` column. Trend queries exclude unscorable scans from averages but count them for coverage metrics.

**Warning signs:**
- `Number.isNaN` checks anywhere in scoring code — means NaN is already possible.
- Template output `NaN` or `NaN%` during local testing.
- Score type is `number | null` instead of a tagged union.
- `?? 0` fallbacks in the score pipeline — masking bad inputs.

**Phase to address:** Scoring Model phase — the score type must be defined before scoring logic.

---

### Pitfall 5: Per-org orchestrator mode cached stale after DB change

**What goes wrong:**
Admin flips `org.branding_mode` from `embedded` to `service` in the dashboard DB. The orchestrator, which cached the mode decision at server startup or at first-use, keeps routing via the embedded path. The test button on the admin page calls the new path (freshly resolved), reports success, but production scans keep hitting the embedded DB. Admin thinks it's working; users see no change. Worst case: writes go to embedded path, reads go to service path, and the org's branding data splits across two stores.

**Why it happens:**
- `ServiceClientRegistry` already has this problem for URL/secret changes and solves it with `reload(serviceId)`. Per-org mode is a NEW axis that the registry doesn't cover.
- Caching the mode "for performance" at request scope vs. org scope vs. process scope is unclear, so developers pick inconsistent scopes.
- The org-mode setting lives in the dashboard DB, but the orchestrator may run inside the branding service — it has to be told when to invalidate.
- Test button can easily short-circuit by calling the new mode directly, bypassing cache.

**How to avoid:**
- No in-memory caching of `orgBrandingMode` beyond a single request. The mode must be looked up per-call or via a registry `getOrgMode(orgId)` that supports `invalidate(orgId)`.
- Follow the existing `ServiceClientRegistry.reload()` pattern: admin save handler calls `registry.reloadOrg(orgId)` AFTER the DB upsert; builder throws → caller sees error, old state untouched.
- Test button MUST go through the same code path as production scans — no "preview mode" shortcut. Test button stamps result with a `routedVia: 'embedded' | 'service'` field so admin can verify the mode that actually ran.
- Integration test: flip mode, verify next scan routes correctly without server restart.
- For writes that must not split: mode change is only allowed when the org has no in-flight scans; after flip, run a one-shot migration (if switching to service, push embedded data to service first; if switching to embedded, pull service data back).

**Warning signs:**
- Mode lookup code in more than one place.
- `const mode = await getMode(orgId)` outside a request handler (module-level or constructor).
- Test button result doesn't echo which mode ran.
- No `reloadOrg` / invalidation path from the admin save handler.
- A code review comment like "let's cache this, it's called a lot."

**Phase to address:** Dual-Mode Registry phase — the invalidation contract must be designed before routing logic lands.

---

### Pitfall 6: Dual-mode fallback ambiguity hides outages

**What goes wrong:**
Org is set to `service` mode. Branding service goes down. Orchestrator "helpfully" falls back to embedded mode. Scans keep succeeding but with wildly different brand match results (embedded DB is empty for this org). Scores plummet, trend line crashes. Ops doesn't know the service is down because health endpoint shows green (dashboard → embedded fallback works). Days later, someone notices the service is down; by then the trend graph has a week of garbage data.

**Why it happens:**
- "Graceful degradation" is a reflex — matches the v2.7.0 fallback pattern for LLM. But brand scoring fallback is NOT graceful: it silently changes the data source.
- Embedded mode returns "no match" for an empty org, which looks like a real low score, not an outage.
- `try { serviceCall() } catch { embeddedCall() }` is a one-liner; it feels safer than letting the call fail.

**How to avoid:**
- Explicit policy per mode:
  - `service` mode failing → scan FAILS or is MARKED DEGRADED, not rerouted. Degraded scans store `{ brandScore: null, degradedReason: 'branding-service-unreachable' }`.
  - Never cross-route between modes in the data path.
- Fallback only applies to bootstrap: if mode is unresolvable (DB unreachable), use the per-service config fallback like `ServiceClientRegistry` already does — but for READ of the mode setting, not for data calls.
- Trend line explicitly renders a "degraded" segment (dashed line, warning tooltip) so users see outages instead of mistaking them for regressions.
- Alerting: scan count of `degradedReason != null` must trigger ops alert.

**Warning signs:**
- `try/catch` around branding service calls that swallows and proceeds.
- "Fallback" mentioned in comments without specifying WHAT data source the fallback uses.
- Trend endpoint returns a continuous line when it shouldn't be able to (no gap marker).
- Health check passes while the underlying service is down.

**Phase to address:** Dual-Mode Registry phase — fallback contract is a Decision that must be logged in PROJECT.md before code lands.

---

### Pitfall 7: Per-org client secret leakage via error messages / logs

**What goes wrong:**
Dual-mode routing adds per-org service credentials (so Org A can point at branding-service-A, Org B at branding-service-B). An error builder logs `Failed to auth with ${clientId}:${clientSecret}` for debugging. Dashboard error page renders the full error to admins. Screenshots of error pages end up in Slack, support tickets, and bug reports. Secret is now on GitHub in a pasted test output.

**Why it happens:**
- Debug ergonomics: developer wants to see "what auth was attempted."
- ServiceClientRegistry's existing pattern uses global secrets from config/DB — admins never see them. Per-org secrets break that invisibility because they can be set per-org in a new admin form.
- JSON error serialization includes `clientSecret` when it's a field on the credential object.

**How to avoid:**
- Credential objects MUST implement `toJSON()` that redacts the secret. Also a `toString()` / `[Symbol.for('nodejs.util.inspect.custom')]` override to cover `console.log`/pino inspection.
- Error messages may include `clientId` (not secret) for debugging. `clientSecret` NEVER leaves the credential object.
- Log redaction at pino level: add `serializers.credentials` that strips `clientSecret`, `access_token`, `refresh_token`, `authorization`.
- Admin UI form: secret field is write-only — load renders `••••••••` or empty, save only writes when non-empty.
- E2E test: trigger an auth failure, assert the rendered error page contains neither the secret nor any substring matching `^[a-z0-9_-]{24,}$` that could be a token.
- Git-secrets / pre-commit hook to catch common secret patterns in test fixtures.

**Warning signs:**
- Any `console.log(credentials)` or `logger.info({ credentials })` — even "temporarily for debugging."
- Error handler with `JSON.stringify(err)` on the credential-holding object.
- Admin form that shows the current secret value in the input.
- No `.toJSON()` / inspector override on the credential type.

**Phase to address:** Per-Org Credentials phase + Security review phase. Security-reviewer agent MUST run after the routing phase.

---

### Pitfall 8: Backwards incompat — existing reports rendering `undefined` in brand panel

**What goes wrong:**
All existing scans (pre-v2.11.0) have no brand score. The new report panel template uses `{{brandScore.value}}` which renders as empty. Worse, the trend widget queries `brand_scan_scores` joined on `scans.id` — INNER JOIN drops every old scan, so the dashboard widget displays "no data" for orgs with hundreds of existing scans. Users think v2.11.0 deleted their data.

**Why it happens:**
- Brand scoring is added to the scan pipeline AFTER writes already happen — old scans never had it computed.
- Developers test with freshly-scanned data; pre-existing scans are an afterthought.
- INNER JOIN feels like the "clean" query but excludes historical data; LEFT JOIN is what's actually needed.
- No explicit "missing brand score" state in the UI — just an empty string.

**How to avoid:**
- Scan schema must keep brand score optional forever. Report detail template MUST have a branch for "no brand score available (scan predates v2.11.0)".
- Use LEFT JOIN for trend queries; exclude `brand_score IS NULL` explicitly in the WHERE clause, not via JOIN type.
- Backfill strategy: OPTIONAL re-score of existing scans via a CLI command or admin action. Must be idempotent and skip scans where guideline no longer exists. Progress reporting + resumable.
- Feature flag per org: "Brand scoring enabled (date X)" so trends only draw from X forward, and pre-X period is rendered as "not measured," not as zero.
- UAT: open a report from a pre-v2.11.0 scan, verify brand panel shows onboarding/empty state, not undefined/NaN/broken layout.

**Warning signs:**
- Missing `{{#if brandScore}}` guard around the brand panel block.
- JOIN in trend query is `JOIN` not `LEFT JOIN`.
- Backfill script that overwrites non-null scores (should only fill nulls).
- Test suite only runs against freshly-seeded data.

**Phase to address:** Report UI Integration phase — must include explicit pre-v2.11.0 report rendering test. Schema phase decides backfill strategy.

---

### Pitfall 9: HTMX OOB swap of trend widget breaks when table row swap is in flight

**What goes wrong:**
Org dashboard has a scan table with per-row actions AND a brand score widget. A scan action (e.g., re-scan) uses HTMX to swap the row; the response also includes an OOB swap for the widget (to reflect the new latest score). Following the v2.9.0 lesson (`feedback_htmx_oob_in_table.md`), OOB content inside a `<tr>` must be wrapped in `<template>` tags. Forgetting this makes the browser silently drop the OOB fragment during HTML parsing (because table children must be table elements). Widget never updates; user thinks scoring is broken.

**Why it happens:**
- HTML parser moves non-table content out of tables during parsing, destroying the OOB attribute before HTMX sees it.
- Worked fine in isolated testing because the widget was updated independently.
- The v2.9.0 incident is known but easy to forget for every new table + OOB combo.

**How to avoid:**
- Grep the view layer for `hx-swap-oob` inside any `<tr>`/`<td>` — every match must be wrapped in `<template>`.
- Playwright test: trigger scan action, assert widget DOM actually updated (not just "response 200").
- Add a lint rule or fixture test that fails when `hx-swap-oob` appears as a direct child of a table element without `<template>` ancestry.
- Alternative: return widget updates via a separate trigger event (`hx-trigger="scanUpdated from:body"`) instead of OOB inside a row swap.

**Warning signs:**
- Grep finds `hx-swap-oob` inside table markup without `<template>`.
- Widget update works when triggered from a non-table element but not from a table row action.
- Manual testing passes, E2E test fails intermittently.

**Phase to address:** Org Dashboard Widget phase — code review checklist item.

---

### Pitfall 10: Per-scan brand scoring blows up scan latency

**What goes wrong:**
Every scan now computes a brand score. The scoring function pulls the full guideline, re-matches all findings against colors and fonts, runs contrast checks, and calls the branding service over HTTP. What was a 2s scan becomes an 8s scan. Scan queue backs up. Dashboard "Scan in progress" spinner becomes the norm.

**Why it happens:**
- Reuse-first instinct: "just call `matchIssues` again for scoring."
- Scoring is conceptually a read-only aggregation but implemented as additional service calls.
- Dual-mode routing adds an extra hop for `service` orgs.
- No measurement during development — perf problems surface in production.

**How to avoid:**
- Scoring runs on data ALREADY matched during the scan, not as a separate fetch. Scanner already calls `matchIssues` — scoring takes the result. ONE service call per scan, not two.
- Baseline benchmark before the feature: record current scan latency for 10 representative sites. After the feature: assert scan latency increased by <15%.
- For `service` mode, pass score computation INTO the branding service as part of the existing `matchIssues` call (expand the response) rather than as a follow-up endpoint.
- Cache guideline lookups per scan (already a request-scoped concern).
- Inline try/catch non-blocking pattern from v2.9.0 retag: scoring failure never blocks scan completion.

**Warning signs:**
- Scan orchestrator gains a new `await brandingService.score(...)` call separate from existing matching.
- PR doesn't include a latency benchmark.
- Scan flow has >1 HTTP call to branding per scan.

**Phase to address:** Scoring Integration phase — must include before/after latency measurement in Done definition.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Single `score` column, wide denormalized row | Simple SELECTs, easy to render | ALTER TABLE on every new category; nullable column trap (Pitfall 3) | Never — normalized category table from day 1 |
| Inline literal WCAG thresholds (`4.5`, `7`) in scoring code | No import overhead | Pitfall 2 (AA/AAA confusion), divergent logic across packages | Never |
| `score: number \| null` type | Minimal type ceremony | Pitfall 4 (NaN propagation), no way to distinguish "empty guideline" from "failed to score" | Never — use tagged union |
| Cache `orgMode` at request scope via module-level map | Avoids repeated DB reads | Pitfall 5 (stale cache on mode flip) | Only if paired with `invalidate(orgId)` hook from admin save path |
| `try { service } catch { embedded }` dual-mode fallback | Apparent resilience | Pitfall 6 (silent data-source swap, trend corruption) | Never for data calls; OK for mode-lookup bootstrap only |
| INNER JOIN `brand_scan_scores` in trend query | Cleaner SQL | Pitfall 8 (drops pre-v2.11.0 scans) | Only when trend window is explicitly post-v2.11.0 |
| Compute brand score synchronously in scan path | Immediate results | Pitfall 10 (latency regression) | OK only when reusing existing `matchIssues` result, not adding new calls |
| Backfill historical scans with `score=0` | "Fills the chart" | Destroys signal, can't distinguish "not measured" from "scored zero" | Never — PROJECT.md Decision |
| Admin form shows current client secret value | Easier to "verify" settings | Pitfall 7 (secret leaked in screenshots, logs) | Never — write-only fields |
| Debug-log credential objects "while developing" | Faster debugging | Secret ends up in pino logs, shipped to log aggregator | Never — use redacting serializer |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Branding service (existing) | Calling `matchIssues` once for match and again for score | Expand `matchIssues` response to include pre-computed score inputs; one call per scan |
| Compliance empty JSON body | Omitting body on bodyless POSTs (existing known issue) | Always send `{}` — `feedback_compliance_empty_body.md` |
| ServiceClientRegistry | Capturing `getLLMClient()` result at route registration time, missing hot-swaps | Per-request getter call; for per-org mode, add `registry.reloadOrg(orgId)` and mirror the pattern |
| HTMX OOB in tables | Naked `<div hx-swap-oob>` inside `<tr>` | Wrap in `<template>` — `feedback_htmx_oob_in_table.md` |
| Per-org OAuth clients | Assuming the global LLM client pattern works as-is | Follow v2.9.0 `resolveOrgLLMClient` try/finally destroy pattern for short-lived per-request instances |
| Handlebars score rendering | `{{score}}%` without null guard → `NaN%` or empty | `{{#if score.value}}{{score.value}}%{{else}}<Empty state>{{/if}}` with tagged-union discriminator |
| URL normalization | Forgetting trailing-slash strip on new site-lookup endpoints | Reuse existing normalizer at system boundary — v2.8.0 hotfix Decision |
| Per-org DB setting reload | Updating DB without notifying orchestrator | Admin save handler calls `registry.reloadOrg(orgId)` after upsert, same exception-safety contract as `reload()` |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Per-scan extra HTTP call to branding service | Scan latency +3-5s; scan queue backs up | Reuse `matchIssues` response; expand the schema, don't add an endpoint | Any org running automated hourly scans |
| N+1 trend query on org dashboard (one query per scan to fetch category rows) | Dashboard load 500ms → 3s | `SELECT ... WHERE scan_id IN (...)` or a single aggregated query per dashboard render | Org with >50 scans in history |
| Uncached guideline fetch inside scoring loop | Scoring time grows linearly with finding count × guideline size | Fetch guideline once per scan, pass to scoring function | Sites with >200 findings |
| Per-request `orgMode` DB query without caching strategy | Dashboard widget render time increases proportional to org count | Request-scoped cache (1 lookup per request); invalidate on mode flip | Admin dashboard listing all orgs |
| `JSON.parse(row.score_breakdown)` in trend loops | CPU spike on orgs with long scan history | Store category rows normalized; JOIN + GROUP BY | Orgs with >500 scans |
| Synchronous contrast computation for hundreds of color pairs | Scan thread blocked 200-800ms | Pre-compute once per guideline (not per scan), cache result keyed by guideline version | Guidelines with >20 colors |
| Destroy-and-recreate token manager on every org mode read | Token cache wiped; extra OAuth round-trips | Reuse token managers from `ServiceClientRegistry`; only recreate on `reload()` | Any time reload is called faster than token TTL |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Credential object serialized via default `JSON.stringify` | Client secret in logs, error pages, support tickets | `toJSON()` override redacting secret; pino serializer; E2E test asserting no secret in error responses |
| Per-org client secret field shows current value in admin form | Shoulder-surf, screenshot leak | Write-only field (empty on load, only saves when non-empty); confirm change requires re-entry |
| Admin audit log entries embed `clientSecret` value | Persistent leak in audit trail | Audit logs record only the FACT of change (`secret_updated: true`) not the value |
| Per-org mode set without CSRF | Attacker can flip an org's brand routing to point at their server | Existing CSRF meta-tag interceptor applies; verify on the new admin endpoint via test |
| Test button reuses admin token for an arbitrary `orgId` param | IDOR: admin from Org A tests Org B's config | Authorize `orgId` against the admin's org membership before running the test |
| Dual-mode `service` credentials queried cross-org | Information disclosure: Org A sees Org B's URL/clientId | Repository `get(orgId)` MUST scope by `org_id = ?`, same DB-level guard as v2.9.0 `revokeKey` |
| Brand score trend endpoint accepts any `orgId` | IDOR: trend data exposure | `orgId` derived from session or strictly authorized; never from query param alone |
| `discover-branding` results trusted as-is for scoring | Adversarial CSS with malformed colors crashes scorer or poisons guideline | Validate discovered colors/fonts against Zod schemas; reject invalid before persisting |
| Degraded-reason messages include service URL | Leaks internal infrastructure details to org admins | Render generic "branding service unavailable"; detailed reason only in server logs |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Score drops visually with no explanation after guideline edit | Users think site regressed when really guideline changed | Annotate trend line with guideline-change events; tooltip explains "coverage expanded" |
| "Brand score: 42%" with no context on what that means | Users don't know if 42 is good or bad | Show quintile labels (Poor / Needs Work / OK / Good / Excellent) + delta arrow vs last scan |
| Empty guideline renders as "0%" brand score | Users panic about "0% brand compliance" when they just haven't configured anything | Distinct empty state with CTA "Add colors to your guideline to start scoring" |
| Trend widget updates after scan but score panel on report doesn't (or vice versa) | Inconsistency breaks trust in the numbers | Both views read from the same source of truth; same scan_id → same number; test enforces this |
| AA/AAA mismatch between panels (Pitfall 2) | Numbers disagree across views | Single contrast utility; level is first-class metadata |
| Dual-mode "embedded" vs "service" language is jargon to non-technical admins | Admin flips the wrong mode | Label: "Branding data source: This dashboard's database (default) / External branding service" + help link |
| Mode flip button without confirmation | Accidental click reroutes production | Two-step confirmation with "I understand this will change where brand data is read and written" |
| No visual indicator of current mode on org settings page | Admins unsure what mode is active | Badge with mode + last-verified timestamp, prominent on org settings |
| Test button result doesn't say which mode was tested | Admin tests, sees green, but can't tell if it ran in the mode they set | Test result payload echoes `routedVia: 'embedded' \| 'service'` |
| Trend gap handling renders continuous line over missing data | Users miss outages or paused scans | Dashed segment for gaps; tooltip: "no scan in this period" |

## "Looks Done But Isn't" Checklist

- [ ] **Scoring utility:** Often missing tagged-union return type — verify `score` return is discriminated union with `kind: 'scored' | 'unscorable'`, NOT `number | null`.
- [ ] **Contrast thresholds:** Often inlined — grep for literal `4.5`, `3`, `7` outside the contrast utility file; must return zero hits.
- [ ] **Trend schema:** Often wide table with nullable columns — verify normalized `brand_score_categories` table exists and trend queries use it.
- [ ] **Trend query:** Often INNER JOIN — verify `LEFT JOIN` and explicit NULL filtering; pre-v2.11.0 scans render empty state, not error.
- [ ] **Report panel:** Often missing pre-v2.11.0 guard — verify `{{#if brandScore}}` branch; open an old scan and screenshot it.
- [ ] **Dual-mode invalidation:** Often missing `reloadOrg(orgId)` — verify admin save handler calls it after DB upsert, and that a test flips mode without server restart.
- [ ] **Dual-mode fallback:** Often implemented as try/catch — verify NO cross-mode fallback in data path; degraded scans stored with reason, not silently rerouted.
- [ ] **Test button:** Often short-circuits — verify it routes through the same production code path and echoes `routedVia` in the response.
- [ ] **Credential serialization:** Often default JSON — verify `toJSON()` override + pino serializer + E2E test asserts no secret in error HTML.
- [ ] **Admin secret field:** Often pre-populated — verify load renders empty/masked, save writes only on non-empty.
- [ ] **Scan latency:** Often unmeasured — verify baseline and post-feature benchmark in PR description; <15% regression.
- [ ] **HTMX OOB in tables:** Often naked — grep the views; every `hx-swap-oob` inside a `<tr>` must be wrapped in `<template>`.
- [ ] **Score fuzz test:** Often missing — verify property test that fuzzes guidelines (including empty, single-color, all-null) never produces NaN.
- [ ] **Backfill script:** Often overwrites — verify script only fills NULL scores, never touches existing values.
- [ ] **Trend gap rendering:** Often continuous — verify dashed/gap treatment for missing scans in the sparkline component.
- [ ] **i18n:** Often hardcoded English for new UI — verify all new strings use `{{t}}` keys across en/fr/it/pt/de/es.
- [ ] **Permissions:** Often missing new permission key — verify `brand.view`/`brand.manage` (or equivalent) in RBAC matrix, tested against unauthorized role.
- [ ] **System Health page:** Often missing — verify new brand scoring subsystem appears if there's a new subsystem; check cross-service-consistency feedback.
- [ ] **Mobile widget:** Often broken — verify dashboard brand widget on mobile breakpoint.
- [ ] **Mode flip migration:** Often missing — verify design doc states what happens to in-flight data when mode flips (block? drain? migrate?).

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Scoring normalization drift | MEDIUM | Ship scoring v2 with coverage profile; mark old scores as `schemaVersion: 1`; render v1 scores with "Legacy" badge; offer re-score action |
| WCAG AA/AAA confusion | LOW | Introduce single contrast utility; re-score all scans that used the wrong threshold; communicate to affected orgs |
| Trend schema drift (nullable column backfilled with 0) | HIGH | Cannot distinguish "real zero" from "backfilled zero" — lose signal permanently unless you kept raw scan data. Restore from backup if within window; otherwise mark all pre-fix scans as "legacy" and exclude from trend averages |
| NaN propagation in stored scores | MEDIUM | Identify affected rows (`WHERE score = 'NaN'` or `score IS NULL AND reason IS NULL`); null them out; re-score where possible |
| Stale per-org mode cache | LOW | Add `reloadOrg` hook; restart server as one-time fix; add regression test |
| Dual-mode silent fallback data corruption | HIGH | Identify the outage window; mark all scans in that window `degraded: true`; trend graph excludes them; communicate; re-scan affected sites |
| Client secret leaked in logs/screenshots | HIGH | Rotate the affected secret IMMEDIATELY; audit pino logs for occurrences; purge log aggregator entries; security-reviewer agent; communicate to affected orgs |
| Pre-v2.11.0 scans rendering `undefined` / broken | LOW | Hotfix template with `{{#if brandScore}}` guard; ship same-day; write regression test |
| HTMX OOB swap dropped in table | LOW | Wrap in `<template>`; add Playwright regression test |
| Scan latency regression | LOW-MEDIUM | Revert scoring call; refactor to reuse existing `matchIssues` result; re-ship with benchmark |
| Per-org secret IDOR (cross-org read) | HIGH | Fix DB query scoping; audit access logs; notify affected orgs; rotate secrets that may have been exposed |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| #1 Score normalization drift | Scoring Model (early) | Unit + property tests on scoring function; coverage profile stored on every scan |
| #2 WCAG AA/AAA confusion | Scoring Model (early) | Grep for literal thresholds returns zero hits outside contrast utility; shared util imported in both dashboard and branding service |
| #3 Trend schema drift | Schema + Persistence (early) | Migration test: adding category doesn't corrupt history; normalized table in use; forbid nullable score columns |
| #4 Edge case NaN explosions | Scoring Model (early) | Property/fuzz test: scorer never returns NaN across random guideline inputs; tagged-union return type |
| #5 Per-org mode stale cache | Dual-Mode Registry | Integration test: flip mode → next scan routes correctly without restart; admin save handler calls `reloadOrg` |
| #6 Dual-mode silent fallback | Dual-Mode Registry | Integration test: simulate branding service down, assert scan stored as `degraded` with reason, NOT rerouted |
| #7 Per-org secret leakage | Per-Org Credentials + Security Review | E2E test asserts no secret in error HTML; `toJSON` redaction unit test; security-reviewer agent on the routing phase |
| #8 Pre-v2.11.0 rendering | Report UI Integration | Test fixture with a pre-v2.11.0 scan; report panel renders empty state; trend widget renders "not measured" period |
| #9 HTMX OOB in table | Org Dashboard Widget | Playwright test: scan action updates widget; grep for `hx-swap-oob` inside `<tr>` without `<template>` |
| #10 Scan latency regression | Scoring Integration | Before/after latency benchmark in PR description; <15% regression gate |

## Sources

- `/root/luqen/.planning/PROJECT.md` — milestone context and Key Decisions for v2.8.0-v2.10.0 (v2.8.0 URL normalization hotfix, v2.9.0 `revokeKey` org-scoped SQL guards, v2.9.0 retag inline pattern, v2.9.0 `resolveOrgLLMClient` try/finally destroy, v2.10.0 worktree stale-base incident)
- `/root/luqen/packages/dashboard/src/services/service-client-registry.ts` — existing hot-swap + exception-safety contract (D-07 through D-14) that the per-org dual-mode registry must mirror
- `/root/luqen/packages/dashboard/src/services/branding-service.ts` — existing getter-based hot-swap pattern that prevents stale token manager references
- Memory: `feedback_htmx_oob_in_table.md` — HTMX OOB + tr main target wrapping rule
- Memory: `feedback_cross_service_consistency.md` — new subsystems must appear in all shared admin sections
- Memory: `feedback_compliance_empty_body.md` — always send `{}` on bodyless POSTs
- Memory: `feedback_i18n_templates.md` — all new UI strings must go through `{{t}}`
- Memory: `feedback_ui_phase_uat.md` — UI phases require human UAT beyond automated checks
- Memory: `feedback_fix_root_cause.md` — trace full user journey before patching symptoms
- Memory: `project_next_session_priorities.md` — v2.11.0 brand intelligence scope
- WCAG 2.1 Success Criterion 1.4.3 (AA contrast 4.5:1 / 3:1) and 1.4.6 (AAA contrast 7:1 / 4.5:1)

---
*Pitfalls research for: v2.11.0 Brand Intelligence — scoring + per-org dual-mode routing*
*Researched: 2026-04-10*
