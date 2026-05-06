# Phase 54 — Per-org source management mode override (Summary)

**Inserted into v3.3.0 close-out as a hot-fix.**
**Commits:** 7563405 (54-01) → b64db4e (54-02) → a667886 (54-03) → 984e639 (54-04).

## The incongruence (diagnosis)

`monitored_sources.management_mode` is one column on a system-shared row, but the LLM client it activates is per-org. After Phase 51's RBAC audit:
- Org admin trying to flip an EAA system source → 403 from `requireScope('admin')` + system-only guard. No path forward except asking sysadmin.
- System admin's flip cascaded to every org. Orgs with no LLM configured saw "LLM" in the badge but the runtime silently fell back to manual at `sources.ts` line ~392 (`source.managementMode === 'llm' && llmClient != null`).

Neither end of the API was honest about per-org capability vs system-shared state.

## The fix (table-based override)

New table `source_org_management_modes` with PK `(source_id, org_id)`. Override row PRESENT → that org's effective mode is the override. Override row ABSENT → fall back to system column (existing behaviour, no change for orgs without preferences).

| Layer       | Change                                                                                          |
| ----------- | ----------------------------------------------------------------------------------------------- |
| Schema      | New table `source_org_management_modes` (DDL inline, conceptual migration #063), FK ON DELETE CASCADE |
| DbAdapter   | 7 new methods: `setSourceOrgManagementMode` (UPSERT), `clearSourceOrgManagementMode`, `getSourceOrgManagementMode`, `getEffectiveSourceManagementMode` (override → system → 'manual'), `listSourceOrgModesForOrg`, `listSourceOrgModesForSource`, `listAllSourceOrgManagementModes` |
| Reseed safety | `loader.ts` snapshots overrides keyed by source URL pre-wipe, restores by URL→new id post-create (Phase 51 STAB-01 pattern extended) |
| API PATCH   | System caller mutates system column; org caller writes override row. Cross-org write of org-owned source still 403. |
| API bulk-switch | Scope dropped from `admin` to `write`. System caller mutates system column for category=government; org caller UPSERTs overrides for caller's org. NO cross-org leak. |
| API reset (NEW) | `POST /api/v1/sources/:id/mode/reset` — clears caller-org override; system caller gets 400. |
| API org-modes (NEW) | `GET /api/v1/sources/org-modes` — returns caller-org override list for dashboard enrichment. |
| Orchestrator | `sources.ts` ~line 392 builds a per-source recipient set; ONE LLM extraction per content change reused for all `mode='llm'` recipients; `mode='manual'` recipients get certified generic proposals. |
| Dashboard route | `/admin/sources` enriches each source with `effectiveMode`, `hasOrgOverride`, `systemDefaultMode`. New `/admin/sources/:id/mode/reset` POST handler. |
| Dashboard view | Effective-mode badge + `(your override)` indicator + `Reset` button when override exists. Bulk-switch button label is role-aware. |

## Simplification choice in 54-03

**Option 2 (fallback) chosen, not option 1.**

- **Why option 2:** option 1 (enumerate active orgs + per-org LLM client routing) requires either (a) a cross-package call back to the dashboard's `resolveOrgLLMClient` or (b) introducing an `organizations` table inside compliance. Both are too disruptive for a hot-fix slot. Option 2 stays inside compliance and uses data that's already there (the override rows we just added in 54-01).
- **What option 2 does:** For each government source content change, the orchestrator builds recipients = `[{ orgId: 'system', mode: <system default> }, ...override-holders]` (collapses to `[{ orgId: 'system', ... }]` when no overrides exist). It runs LLM extraction at most once if any recipient wants `llm`, then creates one proposal per recipient — extracted+orgId for `llm` recipients, certified+orgId for `manual` recipients.
- **Cost:** zero additional LLM calls vs the old single-proposal-per-event path. When no orgs have overrides, behaviour is **byte-identical** to before.
- **Trade-off:** all `mode='llm'` recipients see the same extracted result. If true per-org LLM extraction (different LLM clients producing different summaries per org) is needed later, that's a v3.4.0 follow-up.

## RBAC parity preserved

- Cross-org write of an ORG-OWNED source by another org → still 403 (Phase 51 guard preserved at the route level for both PATCH and reset).
- System rows: org admin can now write override rows (no longer 403 — this is the intended fix). The system column is never written by an org admin via any path.
- Bulk-switch from sysadmin no longer flips per-org overrides; it only mutates the system default column. Orgs with explicit overrides keep them — overrides win.

## Migration & backwards compatibility

- Migration number bumped from 062 (Phase 47) to 063 (this phase). The DDL block uses `CREATE TABLE IF NOT EXISTS` so the new table appears on the first restart of the upgraded compliance service. No data conversion required — the new table is empty.
- Existing system rows where `management_mode='llm'` continue to apply to orgs with no override (byte-identical fallback).
- Bulk-switch from sysadmin no longer flips org overrides (deliberate, fixes the silent-degradation bug).

## Files changed

**Compliance (added 1, modified 3):**
- `packages/compliance/src/db/adapter.ts` (interface)
- `packages/compliance/src/db/sqlite-adapter.ts` (DDL + 7 methods)
- `packages/compliance/src/seed/loader.ts` (reseed-safety)
- `packages/compliance/src/api/routes/sources.ts` (PATCH + bulk-switch + reset + org-modes + orchestrator fanout + createGenericProposal orgId)
- `packages/compliance/tests/db/source-org-management-modes.test.ts` (NEW, 10 tests)
- `packages/compliance/tests/api/orchestrator-per-org-fanout.test.ts` (NEW, 5 tests)
- `packages/compliance/tests/api/cross-org-isolation.test.ts` (extended, 8 new cases)

**Dashboard (modified 4):**
- `packages/dashboard/src/compliance-client.ts` (resetSourceMode, listSourceOrgModes)
- `packages/dashboard/src/routes/admin/sources.ts` (enrichment + reset route + role flag)
- `packages/dashboard/src/views/admin/sources.hbs` (effective-mode badge, override indicator, Reset, role-aware bulk label)
- `packages/dashboard/src/static/style.css` (.badge--xs + .source-mode-override)
- `packages/dashboard/tests/routes/sources.test.ts` (extended, 4 new cases)

**Planning artifacts:**
- `54-UAT.md` (NEW)
- `54-VERIFICATION.md` (NEW)
- `54-SUMMARY.md` (this file)

## Test counts

| Suite       | Before | After | Delta  |
| ----------- | ------ | ----- | ------ |
| Compliance  | 599    | 612   | +13    |
| Dashboard   | 3587   | 3588  | +1 (+3 in sources.test, others unchanged) |

## Deferred

- Subscription model overhaul (precise per-org subscription via regulation linkage) — out of scope; current "all-orgs-with-overrides + system" recipient set is the pragmatic v1.
- Per-org LLM extraction (different summaries per org from different LLM clients) — defer to v3.4.0 if needed.
- Webhooks/events for management-mode change — defer.
