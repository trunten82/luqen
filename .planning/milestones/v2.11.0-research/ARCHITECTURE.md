# Architecture Research — v2.11.0 Brand Intelligence

**Domain:** Accessibility compliance platform (existing monorepo)
**Researched:** 2026-04-10
**Confidence:** HIGH (first-party codebase inspection)

## Context & Scope

v2.11.0 adds two orthogonal capabilities to the existing branding pipeline:

1. **Brand accessibility score** — a 0-100 metric per scan per guideline, broken down into
   color-contrast / typography / component-compliance sub-scores, persisted historically
   so orgs can see trends on the report detail page and a dashboard widget.
2. **Dual-mode orchestrator** — per-org toggle that routes branding matching (and the new
   score calculation) through either the existing embedded dashboard DB path OR the
   remote `@luqen/branding` Fastify service via `POST /api/v1/match`.

The crucial architectural finding is that **the dashboard already has both paths built,
but only the embedded one is actually wired into scans and retag**. `BrandingService`
(dashboard class that calls the remote service) is defined but never instantiated. The
scanner orchestrator (`scanner/orchestrator.ts` line 547) reads directly from
`storage.branding.getGuidelineForSite()` and imports `BrandingMatcher` from
`@luqen/branding` in-process. The retag pipeline
(`services/branding-retag.ts`) does the same. The remote path exists as a Fastify
service (`packages/branding/src/api/server.ts`) with a complete REST surface including
`POST /api/v1/match`, but nothing in the dashboard actually calls it for scan-time
matching. v2.11.0 is the first milestone where the choice becomes user-visible.

## System Overview

### Current architecture (v2.10.0)

```
┌────────────────────────────────────────────────────────────────────────┐
│                           Dashboard (port 4000)                        │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│   Scanner orchestrator ──► storage.branding.getGuidelineForSite()      │
│           │                         │                                  │
│           │                         ▼                                  │
│           │                 SQLite (migration 034)                     │
│           │                 branding_guidelines / colors /             │
│           │                 fonts / selectors / site_branding          │
│           │                                                            │
│           └──► dynamic import('@luqen/branding') BrandingMatcher       │
│                         (in-process match, embedded mode)              │
│                                                                        │
│   ServiceClientRegistry ──► complianceTM / brandingTM / llmClient      │
│         (v2.8.0)             (one instance per service, not per org)   │
│                                                                        │
│   BrandingService class  ──► [DEFINED BUT UNUSED — remote path stub]   │
│                                                                        │
└──────────────┬─────────────────────────────────────┬───────────────────┘
               │                                     │
               ▼                                     ▼
    ┌────────────────────┐               ┌─────────────────────────┐
    │ Compliance (4100)  │               │   Branding (port ????)  │
    │  POST /check       │               │  POST /api/v1/match     │
    │                    │               │  GET /api/v1/guidelines │
    └────────────────────┘               │  (unused by scan path)  │
                                         └─────────────────────────┘

    ┌────────────────────┐
    │    LLM (4200)      │
    └────────────────────┘
```

### Target architecture (v2.11.0)

```
┌────────────────────────────────────────────────────────────────────────┐
│                              Dashboard                                 │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│   Scanner orch. ──► BrandingOrchestrator.matchForSite(org, site, ...)  │
│   Retag pipeline───►                │                                  │
│                                     ▼                                  │
│                          routing-resolver reads                        │
│                          org.branding_mode ('embedded'|'remote')       │
│                                     │                                  │
│                 ┌───────────────────┴────────────────────┐             │
│                 ▼                                        ▼             │
│       EmbeddedBrandingAdapter              RemoteBrandingAdapter       │
│       (existing path, unchanged)           (new: uses BrandingService  │
│       storage.branding + in-proc            + ServiceClientRegistry    │
│        BrandingMatcher)                     tokenManager)              │
│                 │                                        │             │
│                 └────────────────┬───────────────────────┘             │
│                                  │                                     │
│                                  ▼                                     │
│                    BrandScoreCalculator (pure, shared)                 │
│                    → { colorContrast, typography,                      │
│                        components, overall }                           │
│                                  │                                     │
│                                  ▼                                     │
│                   storage.brandScores.insertScore(...)                 │
│                   (migration 043 — new brand_scores table)             │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | New/Modified | Responsibility | File / Package |
|-----------|--------------|----------------|----------------|
| `BrandingOrchestrator` | **NEW** | Single entry for "match + score" at scan time and retag time. Chooses embedded vs remote per org. | `packages/dashboard/src/services/branding-orchestrator.ts` |
| `EmbeddedBrandingAdapter` | **NEW (wraps existing)** | Existing embedded path (storage.branding + in-proc BrandingMatcher), extracted behind an interface. | `packages/dashboard/src/services/branding-adapters/embedded.ts` |
| `RemoteBrandingAdapter` | **NEW** | Thin wrapper over `BrandingService` + `POST /api/v1/match`. Graceful degradation on service down. | `packages/dashboard/src/services/branding-adapters/remote.ts` |
| `BrandScoreCalculator` | **NEW** | Pure function taking branded issues + guideline → 0-100 sub-scores + overall. No IO. Shared between adapters. | `packages/dashboard/src/services/brand-score-calculator.ts` |
| `BrandScoreRepository` | **NEW** | CRUD over new `brand_scores` table. Insert on scan complete; list by site/org for trend charts. | `packages/dashboard/src/db/sqlite/repositories/brand-score-repository.ts` + interface |
| `ScannerOrchestrator` | **MODIFIED** | Replace inline `storage.branding.getGuidelineForSite` + dynamic import with `brandingOrchestrator.matchForSite(...)`. After matching, write score to `brand_scores`. | `packages/dashboard/src/scanner/orchestrator.ts` (~line 540-590) |
| `branding-retag.ts` | **MODIFIED** | Same replacement; on retag, upsert a new score row (trend shows retag pinpoints). | `packages/dashboard/src/services/branding-retag.ts` |
| `ServiceClientRegistry` | **UNCHANGED** | Still owns a single `brandingTokenManager`. Dual-mode is per-org routing, NOT per-org clients. One remote branding service, many orgs route to it. | `packages/dashboard/src/services/service-client-registry.ts` |
| `BrandingService` | **MODIFIED** | Add `matchIssuesForSite(...)` helper that wraps the existing low-level `matchIssues` call. Finally gets instantiated in server.ts. | `packages/dashboard/src/services/branding-service.ts` |
| `organizations` table | **MODIFIED** | Add `branding_mode TEXT NOT NULL DEFAULT 'embedded'` via migration 043. | migration 043 |
| `brand_scores` table | **NEW** | Persist per-scan score snapshots (migration 043). | migration 043 |
| Admin routes for routing config | **NEW** | `GET/PUT /admin/orgs/:id/branding-mode` or hook into existing org edit page. | `packages/dashboard/src/routes/admin/organizations.ts` |
| Score panel partial | **NEW** | Handlebars partial rendered on report-detail.hbs alongside existing a11y score. | `packages/dashboard/src/views/partials/brand-score-panel.hbs` + `routes/reports.ts` |
| Home widget | **NEW** | Summary tile with current score + trend arrow; rendered server-side on `home.hbs`. | `packages/dashboard/src/views/partials/brand-score-widget.hbs` + `routes/home.ts` |

## Answers to Specific Questions

### 1. Where does scoring run?

**Recommendation: Dashboard side, in a pure `BrandScoreCalculator` module.**

Tradeoffs considered:

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| Inside branding service | Co-located with match logic | Only reachable in remote mode; embedded path would need its own copy; cross-service round-trip for score on every scan | ✗ |
| Inside compliance service | Already has scan JSON | Owns no branding concepts; leaks domain boundary | ✗ |
| Dashboard (pure calculator) | Runs identically for embedded + remote adapters; no extra network hops; uses same `BrandedIssue` shape both paths return | Slight duplication if we later want scoring outside dashboard | **✓** |

The calculator is a pure function `(brandedIssues, guideline) → ScoreBreakdown`. Both
`EmbeddedBrandingAdapter` and `RemoteBrandingAdapter` return the same `BrandedIssue[]`
shape (it's already unified via `branding-client.ts` types), so the calculator is
agnostic to which path produced the data. This is the single most important boundary
decision: **match produces data, score interprets data, persistence stores data — three
separate concerns.**

### 2. Where is the score persisted?

**Recommendation: New `brand_scores` table in the dashboard SQLite DB.**

| Option | Verdict | Rationale |
|--------|---------|-----------|
| New table in branding service DB | ✗ | Branding service DB is remote and optional (dual-mode); score history must survive "remote service offline" and be queryable from the dashboard without a network call on every page render |
| Piggyback on `scan_records` (add columns) | ✗ | A scan has one score per guideline but guidelines can change mid-scan retag. Storing as rows (not columns) preserves history when guideline is updated and retagged |
| **New `brand_scores` table in dashboard DB** | **✓** | Survives service outages, supports trend queries, preserves retag history, co-located with the report renderer |

Schema (migration 043):

```sql
CREATE TABLE IF NOT EXISTS brand_scores (
  id TEXT PRIMARY KEY,
  scan_id TEXT NOT NULL REFERENCES scan_records(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL,
  site_url TEXT NOT NULL,
  guideline_id TEXT,                       -- nullable: no guideline matched
  guideline_version INTEGER,
  overall INTEGER NOT NULL,                -- 0..100
  color_contrast INTEGER NOT NULL,
  typography INTEGER NOT NULL,
  components INTEGER NOT NULL,
  brand_related_count INTEGER NOT NULL DEFAULT 0,
  total_issues INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL,                      -- 'embedded' | 'remote'
  computed_at TEXT NOT NULL
);
CREATE INDEX idx_brand_scores_scan ON brand_scores(scan_id);
CREATE INDEX idx_brand_scores_org_site ON brand_scores(org_id, site_url, computed_at);
```

The `(org_id, site_url, computed_at)` index supports the trend query on both the widget
(`latest` + `previous`) and a longer history view if one is added later. `mode` is
recorded so an admin can see whether a score came from embedded or remote — useful for
debugging divergent results during mode switches.

### 3. Dual-mode impact on ServiceClientRegistry

**Recommendation: Zero structural change. Add a per-org routing resolver that sits above the registry.**

Do **not** extend ServiceClientRegistry to hold a client per org. The registry's contract
today is "one live client per service, hot-swappable" (see file docstring lines 1-19 of
`service-client-registry.ts`). That contract is exactly right for dual-mode because:

- The **remote branding service URL** is still global. Orgs don't each have their own
  branding service; they share one. What varies is whether a given org routes through
  it or uses the embedded DB.
- The **OAuth2 client credential** for the branding service is also global (same
  as compliance and LLM today — the "per-org OAuth client" work in v2.9.0 was for the
  LLM service, via `llm_client_id`/`llm_client_secret` columns on organizations, but
  that doesn't apply here because branding match calls pass `X-Org-Id` header and the
  branding service resolves per-org guidelines internally).

The routing decision lives one layer up, in `BrandingOrchestrator`:

```typescript
// Pseudocode — not a complete implementation
class BrandingOrchestrator {
  constructor(
    private readonly storage: StorageAdapter,
    private readonly remote: BrandingService,         // new: singleton, uses registry
    private readonly embedded: EmbeddedBrandingAdapter,
  ) {}

  async matchForSite(orgId: string, siteUrl: string, issues: readonly Issue[]) {
    const mode = await this.storage.orgs.getBrandingMode(orgId)  // 'embedded' | 'remote'
    const adapter = mode === 'remote' ? this.remote : this.embedded

    try {
      return await adapter.matchForSite(orgId, siteUrl, issues)
    } catch (err) {
      if (mode === 'remote') {
        this.logger.warn({ err, orgId }, 'Remote branding failed, falling back to embedded')
        return this.embedded.matchForSite(orgId, siteUrl, issues)
      }
      throw err
    }
  }
}
```

The **graceful degradation** line is important: if an org is set to `remote` and the
branding service is unreachable, we fall back to the embedded path rather than leaving
the scan with no branding data. This mirrors the LLM fallback pattern established in
v2.7.0 (hardcoded fix patterns when LLM unavailable).

**One caveat on the registry:** if a future milestone wants *per-org* remote branding
services (different URLs per tenant), the ServiceClientRegistry would need the same
pattern as the per-org LLM client work (`resolveOrgLLMClient` with try/finally). For
v2.11.0 this is **explicitly out of scope** — one shared branding service, per-org
routing flag.

### 4. New tables / migrations

**All in a single migration 043** to keep the milestone atomic:

```sql
-- 043: brand-scores-and-branding-mode

-- Per-scan score snapshots (historical)
CREATE TABLE IF NOT EXISTS brand_scores (
  id TEXT PRIMARY KEY,
  scan_id TEXT NOT NULL REFERENCES scan_records(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL,
  site_url TEXT NOT NULL,
  guideline_id TEXT,
  guideline_version INTEGER,
  overall INTEGER NOT NULL,
  color_contrast INTEGER NOT NULL,
  typography INTEGER NOT NULL,
  components INTEGER NOT NULL,
  brand_related_count INTEGER NOT NULL DEFAULT 0,
  total_issues INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL,
  computed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_brand_scores_scan
  ON brand_scores(scan_id);
CREATE INDEX IF NOT EXISTS idx_brand_scores_org_site
  ON brand_scores(org_id, site_url, computed_at);

-- Per-org dual-mode routing flag
ALTER TABLE organizations
  ADD COLUMN branding_mode TEXT NOT NULL DEFAULT 'embedded';
```

`branding_mode` is constrained to `'embedded' | 'remote'` in TypeScript (not CHECK
constraint, for migration simplicity — this matches the existing pattern for status
columns like `scan_records.status`). `DEFAULT 'embedded'` means existing orgs are
unchanged post-migration — no behavior shift on upgrade.

**No new migration needed in the branding service** — its DB already stores guidelines
and site assignments. Score calculation and persistence are dashboard-side.

### 5. New routes / endpoints

#### Dashboard (Fastify + HTMX)

| Route | Method | Purpose | File |
|-------|--------|---------|------|
| `/admin/orgs/:id/branding-mode` | GET | Render routing config UI (embedded/remote toggle) | extend `routes/admin/organizations.ts` |
| `/admin/orgs/:id/branding-mode` | POST | Update mode; invalidates no client cache because registry is untouched | extend `routes/admin/organizations.ts` |
| `/api/v1/brand-scores/:scanId` | GET | JSON fetch for AJAX widget refresh (optional — can also be server-rendered) | new: `routes/api/brand-scores.ts` |
| `/api/v1/brand-scores/history?siteUrl=&limit=` | GET | Trend chart data (array of `{computed_at, overall}`) | new: `routes/api/brand-scores.ts` |
| Report detail view | — | Renders new `brand-score-panel` partial with server-side data from `storage.brandScores.getLatestForScan(scanId)` | modify `routes/reports.ts` |
| Home view | — | Renders new `brand-score-widget` with `storage.brandScores.getLatestAndPreviousForOrg(orgId)` | modify `routes/home.ts` |

**No new endpoint on the branding service.** The existing `POST /api/v1/match` returns
`BrandedIssue[]` which is exactly what the score calculator needs. Score computation is
dashboard-local regardless of mode.

#### Internal (not HTTP)

- `BrandingOrchestrator.matchForSite(orgId, siteUrl, issues)` — the one call the
  scanner and retag use instead of touching storage.branding + BrandingMatcher directly.
- `BrandingOrchestrator.computeAndPersistScore(scanId, ...)` — convenience that runs
  the calculator and writes to `brand_scores`. Called after matching during scan
  completion and during retag.

### 6. UI data flow — report panel and dashboard widget

**Recommendation: server-side dashboard-local reads, no HTMX round-trip to branding service.**

Rationale: the branding service is optional (embedded mode exists), so UI must not
depend on it. Both UI surfaces read from the dashboard's `brand_scores` table via the
new `BrandScoreRepository`.

**Report detail panel (`views/report-detail.hbs`):**

```
GET /reports/:id
  ↓
routes/reports.ts loads scan + existing reportData
  ↓
brandScore = await storage.brandScores.getLatestForScan(scanId)
  ↓
reply.view('report-detail.hbs', { ..., brandScore })
  ↓
Handlebars partial {{> brand-score-panel}} renders 4 progress bars + overall
```

No HTMX request needed for first paint. An HTMX refresh button on the panel could call
`GET /api/v1/brand-scores/:scanId` returning a rendered partial (matching the existing
HTMX OOB patterns per memory note `feedback_htmx_oob_in_table`) — nice-to-have, not
required.

**Home widget (`views/home.hbs`):**

```
GET /
  ↓
routes/home.ts already loads org summary
  ↓
[latest, previous] = await storage.brandScores.getLatestAndPreviousForOrg(orgId)
  ↓
trend = computeTrend(latest.overall, previous?.overall)   // 'up' | 'down' | 'flat'
  ↓
reply.view('home.hbs', { ..., brandScoreWidget: { latest, trend } })
```

Pure server render. If there's no score yet (new org, no completed scans), the widget
shows an empty state — don't crash, don't hide (per the home page consistency pattern
established in the existing dashboard tiles).

**Explicitly rejected pattern:** calling the branding service from the UI layer. The
remote service is a backend-only integration; exposing it to browser HTMX would require
re-proxying tokens and double the failure modes.

### 7. Build order — dependency rationale

Phases ordered so that each phase leaves master deployable:

1. **DB layer + migration 043** — add `brand_scores` table, `branding_mode` column,
   `BrandScoreRepository` interface + SQLite impl, extend `OrgRepository` with
   `getBrandingMode`/`setBrandingMode`. Zero behavior change; all new code unreached.
   - *Why first:* repositories are needed by every subsequent layer. Migration must
     land before any consumer. Per CLAUDE.md pattern: migration → repo → handler.

2. **`BrandScoreCalculator` (pure module) + unit tests** — deterministic scoring logic
   with fixture-driven tests. TDD-friendly, no dependencies on the rest of the stack.
   - *Why second:* the function signature becomes the contract for adapters. Writing
     it first prevents shape drift between embedded and remote return values.

3. **Adapter extraction + `BrandingOrchestrator`** — extract the existing embedded
   path into `EmbeddedBrandingAdapter` (mechanical refactor, same tests), introduce
   `RemoteBrandingAdapter` that finally instantiates the long-dormant `BrandingService`,
   build `BrandingOrchestrator` with the routing resolver + fallback. At the end of
   this phase, routing is wired but mode is hardcoded to `'embedded'` for everyone —
   integration test proves the refactor is transparent.
   - *Why third:* depends on calculator (2) to populate scores. Depends on DB (1) to
     read `branding_mode`. Must come before scan orchestrator changes so the new
     interface is ready.

4. **Scanner orchestrator + retag rewire** — replace the inline
   `storage.branding.getGuidelineForSite` + dynamic import at `scanner/orchestrator.ts`
   line 547 and in `services/branding-retag.ts` with
   `brandingOrchestrator.matchForSite(...)` + `computeAndPersistScore(...)`. Every
   completed scan now produces a `brand_scores` row. Verified by end-to-end tests
   (scan → complete → score row exists).
   - *Why fourth:* consumers of the orchestrator must change after the orchestrator
     exists. This is also the point where backfill concerns surface — existing scans
     without scores will have empty trends. Decision needed: backfill on first page
     view, or accept empty history going forward. Recommendation: **accept empty
     history**, avoids a long migration and matches how branding tags worked in v2.8.

5. **Admin routing UI** — extend the org admin page with a `branding_mode` toggle.
   HTMX POST hits `/admin/orgs/:id/branding-mode`, updates the org row. Per-request
   routing means no client cache to invalidate; the next scan for that org takes the
   new path. Permission: `organizations.manage` (existing permission, already bound
   to Owner/Admin roles).
   - *Why fifth:* mode toggle is useless until there are two real paths (phase 3) and
     both are proven by the scan integration (phase 4). Shipping the toggle earlier
     would let admins flip a switch that does nothing observable.

6. **Report detail score panel** — render `brand-score-panel.hbs` on
   `report-detail.hbs`. Reads from `storage.brandScores.getLatestForScan`. Shows 4
   bars + overall, color-coded by band (0-49 red, 50-79 amber, 80-100 green — match
   existing a11y score color bands in `style.css`, per memory note
   `feedback_design_system_consistency`).
   - *Why sixth:* depends on scores existing in the DB (phase 4). Visual-only change,
     can ship independently.

7. **Home dashboard widget + trend arrow** — reads latest + previous score per org,
   renders tile. Trend arrow is computed server-side (no JS).
   - *Why last:* depends on at least two scored scans existing; until phase 4 has been
     running for a while, every org shows "no trend yet." Can ship independently of
     phase 6.

**Critical ordering constraints:**
- Migration (1) **must** precede everything else in prod — deploy gate.
- Calculator (2) and Orchestrator (3) can be developed in parallel but Orchestrator
  must land after Calculator.
- Scanner rewire (4) is the "moment of truth" — a regression here breaks all scans.
  Feature-flag this with a config toggle if the risk is uncomfortable.
- UI phases (6, 7) can swap order or ship in parallel; neither blocks the other.

## Data Flow

### Scan completion flow (target)

```
scanner completes pa11y run
    ↓
allIssues: Issue[] collected across pages
    ↓
brandingOrchestrator.matchForSite(orgId, siteUrl, allIssues)
    ↓
    ┌────── EMBEDDED ──────┐       ┌────── REMOTE ──────┐
    │ storage.branding     │       │ brandingService.   │
    │ .getGuidelineForSite │       │  matchIssues(...)  │
    │ + in-proc matcher    │       │ → HTTP to :4300    │
    └──────────┬───────────┘       └──────────┬─────────┘
               │                              │
               └──────────────┬───────────────┘
                              ▼
                   BrandedIssue[] (unified shape)
                              │
                              ▼
                BrandScoreCalculator.score(branded, guideline)
                              │
                              ▼
           { overall, colorContrast, typography, components }
                              │
          ┌───────────────────┼───────────────────┐
          ▼                                       ▼
 storage.scans.updateScan                storage.brandScores.insertScore
 (existing: report JSON +                (new: historical row)
  brandRelatedCount)
```

### Report detail render flow

```
GET /reports/:id
    ↓
scan = storage.scans.getScan(id)
reportData = JSON.parse(scan.jsonReport)
brandScore = storage.brandScores.getLatestForScan(id)    ← NEW
    ↓
reply.view('report-detail.hbs', { scan, reportData, brandScore })
    ↓
  {{> brand-score-panel score=brandScore}}   ← NEW partial
  (existing a11y panel unchanged beside it)
```

### Admin mode switch flow

```
POST /admin/orgs/:id/branding-mode   (body: { mode: 'remote' })
    ↓
permissionCheck: organizations.manage
    ↓
storage.orgs.setBrandingMode(orgId, 'remote')
    ↓
HTMX OOB: swap status badge + toast
    ↓
(Next scan for this org takes the new path — no cache invalidation needed,
 because BrandingOrchestrator reads the mode per-request.)
```

## Integration Points

### Internal boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| ScannerOrchestrator ↔ BrandingOrchestrator | Direct TS call | New; replaces direct `storage.branding` usage at line 547 |
| BrandingOrchestrator ↔ EmbeddedAdapter | Direct TS call | Adapter wraps `storage.branding` + in-proc `BrandingMatcher` |
| BrandingOrchestrator ↔ RemoteAdapter | Direct TS call | Adapter delegates to `BrandingService` (finally instantiated) |
| BrandingService ↔ branding REST | OAuth2 + HTTP | Token via `ServiceClientRegistry.getBrandingTokenManager()` (unchanged) |
| BrandingOrchestrator ↔ BrandScoreCalculator | Direct TS call (pure) | No IO in calculator |
| BrandScoreRepository ↔ SQLite | better-sqlite3 (existing adapter) | New repo, standard pattern |
| Report routes ↔ BrandScoreRepository | Direct TS call | Server-render reads |
| Home route ↔ BrandScoreRepository | Direct TS call | Server-render reads |

### External services

| Service | Integration pattern | Notes |
|---------|---------------------|-------|
| Branding service (`POST /api/v1/match`) | OAuth2 client-credentials via `ServiceTokenManager`; body `{ issues, siteUrl, orgId }`; `X-Org-Id` header | Already implemented in `branding-client.ts`; first real consumer in scan path. Graceful degrade to embedded on failure. |

## Architectural Patterns

### Pattern 1: Adapter + Orchestrator for dual backends

**What:** Introduce an interface that both embedded (in-process) and remote (HTTP) paths
satisfy, with an orchestrator selecting between them per-request.

**When to use:** When a feature has two valid deployment topologies and you need to
switch per-tenant without restart.

**Trade-offs:** Slight indirection (one extra class layer) vs. much clearer testability
(mock the adapter) and explicit fallback semantics.

```typescript
// Pseudocode — shape only
interface BrandingAdapter {
  matchForSite(orgId: string, siteUrl: string, issues: readonly Issue[]): Promise<BrandedIssue[]>
}

class EmbeddedBrandingAdapter implements BrandingAdapter { /* wraps storage.branding + in-proc matcher */ }
class RemoteBrandingAdapter implements BrandingAdapter { /* wraps BrandingService */ }

class BrandingOrchestrator {
  async matchForSite(orgId, siteUrl, issues) {
    const mode = await this.storage.orgs.getBrandingMode(orgId)
    return mode === 'remote' ? this.tryRemoteWithFallback(...) : this.embedded.matchForSite(...)
  }
}
```

### Pattern 2: Pure calculator + persistence separation

**What:** Keep the scoring algorithm as a pure function with no IO. Persistence is a
separate step called by the orchestrator.

**When to use:** When you want the same scoring to run from multiple trigger points
(scan complete, retag, potentially a recompute-all admin action) without duplicating
logic or IO concerns.

**Trade-offs:** One extra call site vs. much easier unit testing (no DB mocks needed
for scoring tests) and obvious contract for what "a score" is.

### Pattern 3: Server-side render first, HTMX later

**What:** Render score panel and trend widget with server-side Handlebars data on the
initial page load. Don't use HTMX partials for first paint.

**When to use:** When the data source is reliably fast (local SQLite) and part of the
page's primary content, not a secondary action.

**Trade-offs:** Forgoes the progressive enhancement of HTMX, but avoids a second
round-trip and matches the existing reports-list / home patterns. An HTMX refresh action
can be added later without rework (partial already exists as a server-rendered include).

## Anti-Patterns to Avoid

### Anti-Pattern 1: Per-org branding TokenManager in the registry

**What people do:** Mirror the v2.9.0 per-org LLM client work and store a
`brandingTokenManager` per org in the registry.

**Why wrong:** The LLM per-org work exists because each org has its own OAuth client
credential for the LLM service (`llm_client_id` + `llm_client_secret` columns). The
branding service has no such per-org credential today, and v2.11.0 doesn't introduce
one. All orgs route through the same OAuth client; `X-Org-Id` header + server-side
guideline lookup already handles isolation. Creating per-org clients adds complexity
and timer-leak risk (see memory note on `resolveOrgLLMClient` try/finally) for zero gain.

**Do this instead:** Keep one shared branding token manager in the registry. Per-org
routing lives in `BrandingOrchestrator`, above the registry layer.

### Anti-Pattern 2: Score as columns on `scan_records`

**What people do:** Add `brand_score`, `brand_color_score`, etc. columns to `scan_records`.

**Why wrong:** Retag can change a score after the fact (new guideline assigned → rerun
match → different score). Columns force a lossy overwrite; rows preserve the history an
org actually wants to see ("we improved after we fixed our guidelines").

**Do this instead:** Separate `brand_scores` table keyed by `scan_id` but allowing
multiple rows. Latest row = current score, full list = trend.

### Anti-Pattern 3: Dual-mode decided at startup

**What people do:** Read `org.branding_mode` once at server boot and cache it.

**Why wrong:** Admin changes mode → scan for that org immediately should use new path.
Caching at startup forces a restart (violating the "no downtime" constraint in
PROJECT.md).

**Do this instead:** `BrandingOrchestrator.matchForSite` reads the mode per-request. The
cost is one SQLite lookup per scan — trivially cheap next to the scan itself.

### Anti-Pattern 4: HTMX fetch directly against the branding service

**What people do:** Wire the score panel's refresh button to hit `branding:4300/api/v1/...`
from the browser.

**Why wrong:** (1) CORS, (2) exposes internal service URL, (3) token handling in
browser, (4) breaks when org is in embedded mode. The browser should never see the
branding service.

**Do this instead:** Dashboard proxies. Score data served by `routes/api/brand-scores.ts`
from the `brand_scores` table. Refresh just re-reads the dashboard DB.

## Scaling Considerations

| Scale | Adjustments |
|-------|-------------|
| 0-100 orgs, 1k scans/day | Default embedded mode. `brand_scores` table grows ~1 row per scan. Index on `(org_id, site_url, computed_at)` handles trend queries in <10ms. No action needed. |
| 100-1k orgs, 10k scans/day | Consider a retention policy on `brand_scores` (keep last 30 days per site + monthly aggregates beyond). Move to remote mode for tenants with heavy branding-guideline change frequency (remote service can scale independently of dashboard process). |
| 1k+ orgs | Archive old `brand_scores` rows to a separate table or cold store. Batch score computation for retags rather than per-scan (currently inline). |

**First bottleneck:** trend query on the home widget if a single org has thousands of
scored scans. Mitigation: the widget only needs `latest` + `previous` — use
`ORDER BY computed_at DESC LIMIT 2`, which the index serves directly. A full trend
chart (if added later) should be bucketed by day with a separate query.

## Sources

- `/root/luqen/packages/dashboard/src/services/service-client-registry.ts` (the D-07 through D-14 contract)
- `/root/luqen/packages/dashboard/src/services/branding-retag.ts` (existing embedded path)
- `/root/luqen/packages/dashboard/src/scanner/orchestrator.ts` lines 540-590 (current scan-time match)
- `/root/luqen/packages/dashboard/src/services/branding-service.ts` (defined-but-unused remote wrapper)
- `/root/luqen/packages/dashboard/src/db/sqlite/migrations.ts` lines 1011-1155 (migration state; 042 is latest → next is 043)
- `/root/luqen/packages/dashboard/src/db/interfaces/branding-repository.ts` (embedded repo contract)
- `/root/luqen/packages/branding/src/api/server.ts` lines 505-547 (remote `POST /api/v1/match` contract)
- `/root/luqen/packages/branding/src/matcher/index.ts` (in-process matcher)
- `/root/luqen/packages/dashboard/src/branding-client.ts` (HTTP client + `BrandedIssueResponse` shape)
- `/root/luqen/packages/dashboard/src/views/report-detail.hbs` lines 94, 270 (existing brand badge)
- `/root/luqen/.planning/PROJECT.md` (milestone v2.11.0 scope + constraints)

---
*Architecture research for: Luqen v2.11.0 Brand Intelligence*
*Researched: 2026-04-10*
