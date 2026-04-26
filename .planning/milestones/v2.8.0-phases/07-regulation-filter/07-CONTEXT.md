# Phase 07: Regulation Filter - Context

**Gathered:** 2026-04-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver a backwards-compatible extension to the compliance flow so users can scope scans/reports/exports by **any combination** of jurisdictions and specific regulations, with results returning the inclusive deduplicated union. The scan form already has a two-tab picker (jurisdictions / regulations) but its regulation tab has a bug — it submits `name="jurisdictions"` with `value="{{jurisdictionId}}"`, meaning selecting a regulation today just selects its parent jurisdiction. This phase fixes that bug and wires the selection all the way through: scan form → orchestrator → compliance API → checker engine → scan record → report detail → CSV/PDF exports.

**In scope:**
- New optional `regulations?: readonly string[]` field on `ComplianceCheckRequest` (types + API validation + caching)
- New `regulationMatrix` keyed by regulationId in the `ComplianceCheckResponse`, alongside the existing jurisdiction `matrix` (backwards compatible — old clients ignore the new field)
- Checker engine extended to include explicit regulations in the requirements query (union with jurisdiction-derived regulations)
- Scan form picker regulation tab submits `name="regulations"` with `value="{{id}}"` (the regulation id, not its parent jurisdiction)
- Scan record schema: new `regulations TEXT` column (JSON array) mirroring the existing `jurisdictions TEXT` column
- Scan orchestrator passes both `jurisdictions[]` and `regulations[]` to the compliance client
- Report detail Compliance panel gains sub-tabs "By Jurisdiction" / "By Regulation", defaulting to By Jurisdiction
- CSV/PDF exports include the regulations selection in the summary header and filter rows by the combined union
- Documentation + tests

**Out of scope (explicitly deferred or guard-railed):**
- Regulation-first data model rework (regulations as the primary scope throughout) — REG-FUT-01, deferred
- Replacing the existing jurisdiction matrix with a unified scope matrix
- Picker UX unification (single-list with type badges) — kept as 2 tabs for minimum risk
- Per-regulation re-tagging of historical scan reports — handled separately, not this phase
- Changing the `scan_records.jurisdictions` column format — add a new sibling column, do not reshape the existing one
</domain>

<decisions>
## Implementation Decisions

### Data Model & Persistence
- **D-01:** Add an optional field to `ComplianceCheckRequest` in `packages/compliance/src/types.ts`: `readonly regulations?: readonly string[]`. Defaults to empty when absent. Backwards compatible with all existing callers.
- **D-02:** Add a new `regulations TEXT` column to the `scan_records` table via a sequential migration (next migration number) in `packages/dashboard/src/db/sqlite/migrations.ts`. Stores a JSON array of regulation ids. Default value `'[]'`. NOT NULL. Do NOT touch the existing `jurisdictions` column.
- **D-03:** The scan record's `jurisdictions` column remains unchanged in shape or semantics. The two columns are independent — each holds the user's explicit selection at scan time.
- **D-04:** When reading a scan back, the orchestrator materializes `scan.regulations` as `string[]` (parsing the JSON column). If the column is null/empty for historical rows (pre-migration), treat as `[]` — no backfill needed.

### API Contract
- **D-05:** `POST /api/v1/compliance/check` accepts an optional `regulations: string[]` body field alongside `jurisdictions: string[]`. Validation:
  - `jurisdictions` — still required, still must be a non-empty array (backwards compat with existing behaviour; we do NOT relax this even if `regulations` is provided — the client must always include at least one jurisdiction, which for "regulations-only" use cases can be the regulation's parent jurisdiction or any sensible default).

  **Correction:** after second thought, this violates REG-01 (user selects "one jurisdiction and two specific regulations from OTHER jurisdictions" — implying the two regulations could come from any jurisdiction). See D-05a below.
- **D-05a:** Relax the "jurisdictions non-empty" validation to "jurisdictions OR regulations non-empty". If `regulations` is provided and non-empty, `jurisdictions` may be empty (backwards compat: callers that omit regulations still must pass a non-empty `jurisdictions`). Validation error message: `"jurisdictions or regulations array is required"`.
- **D-06:** The cache key function in `packages/compliance/src/api/routes/compliance.ts` must include `regulations` (sorted, deduplicated) alongside `jurisdictions` in the stable-JSON payload. Missing this causes cross-scope cache hits and wrong results. Cache key includes orgId, jurisdictions (sorted), regulations (sorted), issues (sorted), includeOptional, sectors (sorted).
- **D-07:** Response shape (`ComplianceCheckResponse`) gains a new top-level field `regulationMatrix: Record<string, RegulationResult>` keyed by regulationId. The existing `matrix: Record<string, JurisdictionResult>` is unchanged. Both populated independently from the same checker engine. Empty `regulationMatrix` when no regulations were explicitly requested (backwards compat).

### Checker Engine Semantics
- **D-08:** Refactor `checkCompliance()` in `packages/compliance/src/engine/checker.ts` to accept both `jurisdictions` and `regulations` from the request. Algorithm:
  1. Resolve all requested jurisdictions → their ancestors (existing step)
  2. For each explicit regulation id: query the regulation, collect its home jurisdiction id
  3. Build the union set: `allJurisdictionIds = resolvedJurisdictionAncestors ∪ explicitRegulationHomeJurisdictions`
  4. Query requirements using `allJurisdictionIds` as the jurisdiction filter (existing query)
  5. Build the jurisdiction matrix for each originally-requested jurisdiction (existing Step 7, unchanged)
  6. NEW: Build the regulation matrix for each originally-requested regulation id, evaluating requirements that belong to that regulation
- **D-09:** Requirements are deduplicated naturally via the existing requirements query — if a regulation's requirements also fall under a selected jurisdiction, they appear once in the requirements set, and the matrices reference them by id. No double counting.
- **D-10:** `findRequirementsByCriteria` already takes `jurisdictionIds` + `criteria` + `orgId`. Use the expanded `allJurisdictionIds` set so explicit regulations are reachable. No new DB query method needed; the widened jurisdiction set provides the data. Filter to specific regulations at the matrix-building layer.
- **D-11:** `annotatedIssues` keeps its current shape — each issue lists the regulations it matches. No change needed; it already reports regulation metadata per issue, which the new `regulationMatrix` aggregates.
- **D-12:** New type `RegulationResult` analogous to `JurisdictionResult` with fields: `regulationId`, `regulationName`, `shortName`, `jurisdictionId` (the regulation's home), `status` ('pass' | 'fail' | 'partial'), `mandatoryViolations`, `optionalViolations`, `violatedRequirements[]`. Defined in `packages/compliance/src/types.ts` next to `JurisdictionResult`.

### Scan Orchestrator & Client
- **D-13:** `packages/dashboard/src/scanner/orchestrator.ts` scan config interface gains `regulations: string[]` alongside `jurisdictions: string[]`. Default `[]`. Orchestrator persists both on the scan record (via new column from D-02).
- **D-14:** `packages/dashboard/src/compliance-client.ts` `checkCompliance(baseUrl, jurisdictions, regulations, issues, orgId)` — extend the signature with `regulations: readonly string[]` as a new positional parameter between `jurisdictions` and `issues`. Update all call sites (orchestrator + any direct callers). The compliance API request body gains the `regulations` field.
- **D-15:** The scan POST handler that builds the scan config reads both `jurisdictions` (existing form field) and `regulations` (new form field) from the submitted body. Both are optional arrays of strings. At least one must be non-empty (matches D-05a validation).

### Scan Form UI Fix
- **D-16:** In `packages/dashboard/src/views/scan-new.hbs:98-104`, the regulation-tab checkboxes currently render as:
  ```handlebars
  <input type="checkbox" name="jurisdictions" value="{{jurisdictionId}}">
  ```
  Change to:
  ```handlebars
  <input type="checkbox" name="regulations" value="{{id}}">
  ```
  The `id` field is the regulation's own id (not its parent jurisdiction). This is the core bug fix for REG-01.
- **D-17:** The picker component's selected-badges UI needs to distinguish between jurisdiction and regulation selections visually. Add a small type badge (e.g. "J" / "R") or color differentiation on each selected chip. Must use existing CSS tokens — no new classes.
- **D-18:** The two-tab structure (jurisdictions tab | regulations tab) stays as-is. No tab reordering or UX rework.
- **D-19:** The picker search input must filter across BOTH tabs simultaneously (the existing `data-action-input="pickerSearch"` handler already does this — verify it still works after the submit field rename and adjust if needed).

### Report Detail — Sub-tabs Inside Compliance Panel
- **D-20:** Inside the `#panel-compliance` tab panel at `packages/dashboard/src/views/report-detail.hbs:112+`, add a nested two-sub-tab structure: **By Jurisdiction** (default, renders the existing matrix unchanged) and **By Regulation** (new, renders `regulationMatrix` entries).
- **D-21:** Sub-tabs use the existing tab CSS classes/styles (`rpt-tab`, `rpt-tab--active`) and a parallel JS switcher. Don't invent new classes. Reuse `data-action="rptSwitchTab"` pattern but scope to the sub-tabs via a distinct attribute (e.g. `data-action="rptSwitchSubTab"` + `data-subtab` + `data-parent`) to avoid collision with the top-level tab switcher.
- **D-22:** "By Regulation" sub-tab is hidden when `regulationMatrix` is empty (no explicit regulations were selected for the scan). When visible, it renders one card per regulation with: shortName, full name, home jurisdiction, status badge (pass/fail/partial), mandatory/optional violation counts, and a list of violated requirements with their WCAG criteria.
- **D-23:** The sub-tab structure reuses the existing per-regulation rendering inside the jurisdiction matrix where applicable — extract into a shared partial `rpt-regulation-card.hbs` used by both views.
- **D-24:** Default sub-tab is By Jurisdiction — matches existing user expectation and backwards compat for scans without explicit regulations.

### Exports (CSV + PDF)
- **D-25:** CSV export in `packages/dashboard/src/routes/api/export.ts`: the summary header row currently shows `scan.jurisdictions.join('; ')`. Add a sibling header `Regulations` showing `scan.regulations.join('; ')`. Per-issue rows already include regulation shortNames via the enriched `regulations` array — no row-level change needed.
- **D-26:** PDF export in `packages/dashboard/src/pdf/generator.ts`: the header block currently shows `scan.jurisdictions`. Add a sibling line `Regulations: ...` listing the selected regulations' short names. Per-issue rendering already lists regulations (line 325-326) — no change needed there.
- **D-27:** Export filtering — when the user selects a regulations subset, findings shown in CSV/PDF already filter naturally because the compliance check only returns findings from the selected scope. No additional filter logic needed — the scope filter is applied upstream at the compliance check stage.
- **D-28:** CSV summary row `Jurisdictions` column remains exactly as it is (same column name, same separator) for backwards compat with existing downstream scripts that parse exports.

### Permissions & Auth
- **D-29:** No permission changes. The compliance API already requires `read` scope; the scan form uses existing scan permission. The regulation filter is a scoping refinement, not a new capability — no new RBAC keys.

### i18n
- **D-30:** All new UI copy uses `{{t}}` i18n keys under the existing `scans.*` and `reportDetail.*` namespaces. New keys at minimum:
  - `scans.regulationsSelected` — label for the selected regulations section on the scan form
  - `reportDetail.subtabByJurisdiction`, `reportDetail.subtabByRegulation`
  - `reportDetail.regulationEmpty` — message when no regulations were selected
  - `reportDetail.regulationStatus.pass|fail|partial`
  - `reportDetail.regulationViolations` — card heading
  - `exportCsv.regulationsHeader`, `exportPdf.regulationsLine`
  Zero hardcoded English — enforced by grep in acceptance criteria.

### Backwards Compatibility Guarantees
- **D-31:** REG-04 acceptance: an existing integration calling `POST /api/v1/compliance/check` with ONLY `jurisdictions[]` (no `regulations`) must return a byte-for-byte identical response (minus the new `regulationMatrix` field if the client is tolerant to unknown fields). The engine's behavior for jurisdictions-only input must not change.
- **D-32:** The existing `jurisdictions` column on `scan_records`, the existing `scan.jurisdictions` serialization everywhere, and the existing `matrix` field in responses are frozen. No renames, no field removals, no semantic changes.
- **D-33:** When `regulationMatrix` is empty in the response, serializers MUST still include the field (as `{}`) so downstream clients can branch on its presence/emptiness uniformly. Do NOT omit the field when empty.

### Testing Strategy
- **D-34:** Unit tests for the extended checker engine covering: jurisdictions-only (backwards compat), regulations-only, mixed selection, deduplication, empty regulations, unknown regulation id handling (skip with warning, don't error).
- **D-35:** Integration tests via compliance API `POST /api/v1/compliance/check` exercising the same scenarios plus cache key separation (jurisdictions=[X] vs jurisdictions=[X]+regulations=[Y] must not share a cache entry).
- **D-36:** Dashboard tests for the scan POST handler reading `regulations[]` from the form, persisting to the scan record, and passing to the compliance client.
- **D-37:** Scan form picker test: clicking a regulation in the regulations tab adds an item to the selected chips list with the correct type (regulation, not jurisdiction), and submitting the form POSTs `regulations[]=...`.
- **D-38:** Report detail test: rendering a scan with both jurisdictions and regulations shows both sub-tabs; rendering a scan with jurisdictions only hides the By Regulation sub-tab.
- **D-39:** Export tests: CSV and PDF exports from a scan with regulations include the new header/line and the correct values.
- **D-40:** REG-04 regression test: snapshot test comparing a `jurisdictions[]`-only response before and after the phase — must be identical.

### Claude's Discretion
- Exact migration number for the `regulations` column — depends on the last number in `migrations.ts` at implementation time
- Exact sub-tab switcher JS implementation (event delegation pattern, attribute names) — follow the existing `rptSwitchTab` pattern
- Exact chip/badge styling for type differentiation in the picker — use existing Emerald tokens, tiny visual affordance
- Internal Zod schema shapes for the new request/response fields
- Whether `RegulationResult` lives in the same file as `JurisdictionResult` or a sibling — judge by file length
- Test file organization (new files vs extending existing ones) — follow the project convention of per-module test files

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Artifacts
- `.planning/PROJECT.md` — milestone v2.8.0 goals + architecture
- `.planning/REQUIREMENTS.md` — REG-01..07 definitions
- `.planning/ROADMAP.md` — Phase 07 goal and 5 success criteria

### Compliance Service — Core Refactor Targets
- `packages/compliance/src/types.ts` — `ComplianceCheckRequest` (line 136), `ComplianceCheckResponse`, `JurisdictionResult` (line 177+). Add `regulations?: readonly string[]` to request + new `regulationMatrix` + `RegulationResult` type.
- `packages/compliance/src/api/routes/compliance.ts` — `POST /api/v1/compliance/check` handler (line 35), body validation (line 42-49), cache key function (line 14-27). Relax validation to "jurisdictions OR regulations required", include `regulations` in cache key.
- `packages/compliance/src/engine/checker.ts` — `checkCompliance()` (line 58), resolve step (line 80-88), matrix-building step (line 127-149). Extend to handle explicit regulations and build `regulationMatrix`.
- `packages/compliance/src/db/adapter.ts` — `findRequirementsByCriteria` signature. No changes expected but verify it accepts the widened jurisdiction id set.

### Dashboard Service — Wiring Changes
- `packages/dashboard/src/compliance-client.ts` line 193-200 — `checkCompliance(baseUrl, jurisdictions, issues, orgId)` signature. Extend to include `regulations`.
- `packages/dashboard/src/scanner/orchestrator.ts` line 32, 504 — scan config type and `checkCompliance` call site. Add `regulations` throughout.
- `packages/dashboard/src/routes/reports.ts` line 259 — compliance matrix consumer on the report side. Update to also surface `regulationMatrix` to the template.
- `packages/dashboard/src/db/sqlite/migrations.ts` — add next sequential migration for `scan_records.regulations TEXT NOT NULL DEFAULT '[]'`.

### Scan Form UI
- `packages/dashboard/src/views/scan-new.hbs` lines 79-108 — picker with jurisdictions + regulations tabs. **LINE 100 HAS THE BUG**: `name="jurisdictions" value="{{jurisdictionId}}"` — change to `name="regulations" value="{{id}}"`. Verify picker search still filters across both tabs after rename.
- `packages/dashboard/src/static/app.js` (or similar) — picker tab switcher / search handler. Check that field rename doesn't break the selected-chips logic.
- Scan POST handler (search for the POST route that builds the scan config from the form body) — read `regulations[]` alongside `jurisdictions[]`.

### Report Detail UI
- `packages/dashboard/src/views/report-detail.hbs` lines 101-107 (top-level tabs), 112-218 (compliance panel), 614-655 (tab switcher JS). Add sub-tabs INSIDE the compliance panel. Reuse the `rpt-tab`/`rpt-tab-panel` CSS classes. Default sub-tab: By Jurisdiction.

### Exports
- `packages/dashboard/src/routes/api/export.ts` lines 53, 76, 128, 183, 224, 381 — CSV export building. Add `Regulations` header and populate from `scan.regulations`.
- `packages/dashboard/src/pdf/generator.ts` lines 26, 53, 129, 325-326 — PDF export building. Add `Regulations: ...` line to the header block.

### i18n
- `packages/dashboard/src/i18n/locales/en.json` — add new keys under `scans.*`, `reportDetail.*`, `exportCsv.*`, `exportPdf.*`. Zero hardcoded English in the HBS templates.

### Tests — Reference Patterns to Mirror
- `packages/compliance/src/engine/checker.test.ts` (or equivalent) — existing checker unit tests. Mirror the pattern for new test cases.
- `packages/compliance/tests/api/compliance.test.ts` — existing API tests. Add scenarios for `regulations[]` + cache key separation.
- `packages/dashboard/tests/scanner/orchestrator.test.ts` — existing orchestrator tests for scan lifecycle.
- `packages/dashboard/tests/routes/reports.test.ts` — existing report rendering tests.
- `packages/dashboard/tests/routes/api/export.test.ts` — existing export tests.

### Memory Rules (apply throughout)
- `feedback_i18n_templates.md` — zero hardcoded English, use `{{t}}` keys everywhere
- `feedback_design_system_consistency.md` — reuse existing CSS classes from style.css, no new classes
- `feedback_htmx_forms_in_tables.md` — if any HTMX work touches table rows in report detail, no `<form>` inside `<tr>`
- `feedback_service_routes_prefix.md` — all compliance API calls use `/api/v1/compliance/check` with JSON body

</canonical_refs>

<specifics>
## Specific Ideas

- The existing scan form picker has the two tabs ALREADY built. The core UI change is a one-line fix to the form field name + value on the regulation checkbox. Everything else in the picker (search, tab switching, selected chips) continues to work unchanged.
- The cache key fix (D-06) is a silent correctness bug waiting to happen — if we forget to include `regulations` in the stable JSON, scans with different regulation scopes will share a cache entry and return wrong results. Add a unit test explicitly asserting the cache key differs between `{jurisdictions:[X]}` and `{jurisdictions:[X], regulations:[Y]}`.
- `RegulationResult` should reuse the same `status` union ('pass' | 'fail' | 'partial') as `JurisdictionResult` for UI consistency and simpler rendering logic.
- The scan_records.regulations column default `'[]'` (not NULL) simplifies reads — no null-check branches in the deserializer.
- When a regulation id is submitted but doesn't exist in the DB (user hacked the form, stale bookmark, etc.), the checker should SKIP it with a warning log, not error out. The scan continues with whatever regulations are valid. Align with existing jurisdiction handling.
- The "By Regulation" sub-tab should show an empty-state message ("No regulations selected for this scan — choose regulations on the scan form to see a per-regulation breakdown") when `regulationMatrix` is empty, instead of hiding the sub-tab entirely — helps discoverability. ACTUALLY reconsider: D-22 says hide when empty. Stick with D-22 (hide when empty) for cleanliness; discoverability is handled by the scan form itself.

</specifics>

<deferred>
## Deferred Ideas

- **Regulation-first data model rework** — REG-FUT-01. Making regulations the primary scope throughout scan/report/export instead of jurisdictions. Backwards incompatible. Deferred.
- **Unified scope matrix** — replacing jurisdiction matrix + regulation matrix with a single `scopeMatrix` keyed by selection id. More elegant but breaks existing clients. Deferred.
- **Picker UX unification** — single searchable list with type badges instead of tabs. More modern but bigger change. Deferred.
- **Per-regulation re-tagging of historical scans** — background job that re-processes stored reports against a newly expanded regulation scope. Out of scope — different phase.
- **Cross-org regulation aggregation** — showing per-regulation compliance across all orgs. Requires new aggregation queries + dashboard views. Deferred to future.
- **Regulation-specific severity weighting** — treating violations of some regulations as more severe than others. Deferred.
- **Empty-state "choose regulations" tooltip** on the By Regulation sub-tab when hidden — see specifics; deferred for cleanliness.

</deferred>

---

*Phase: 07-regulation-filter*
*Context gathered: 2026-04-05 via /gsd:discuss-phase*
