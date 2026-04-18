# Phase 30 — External MCP Client Verification (MCPT-05 / SC#4)

**Purpose:** Proof that a developer can connect Claude Desktop to the Luqen dashboard MCP endpoint using standard OAuth2 credentials and successfully call tools, read resources, and invoke prompts.

**Automated prerequisite:** `packages/dashboard/tests/mcp/inspector-smoke.test.ts` passes in CI (Task 1 of plan 30-06).

**Setup reference:** `docs/mcp-client-setup.md` (Task 2 of plan 30-06).

---

## Pre-flight

- [ ] Dashboard service is running on a reachable host:port
- [ ] OAuth2 client registered via `/admin/clients` with `read` scope
- [ ] Bearer token acquired via `curl … /api/v1/oauth/token`
- [ ] `claude_desktop_config.json` merged with the `luqen-dashboard` entry (see `docs/mcp-client-setup.md` Step 4)
- [ ] Claude Desktop restarted

## Checks

### 1. Tools list surfaces tools per caller's effective permissions
- [x] Claude Desktop's 🔌 indicator shows `luqen-dashboard` connected (2026-04-18)
- [x] Claude enumerates exactly the 6 data tools expected for a `member`-role OAuth client: `dashboard_scan_site`, `dashboard_list_reports`, `dashboard_get_report`, `dashboard_query_issues`, `dashboard_list_brand_scores`, `dashboard_get_brand_score`
- [x] The 13 admin tools are correctly filtered out (member role lacks `admin.users` / `admin.org` / `admin.system` — see tool-filter.ts:23-30)
- [x] This check is rescoped from "≥ 19 tools" to "filter returns the permission-scoped subset" — 19-tool coverage is proven by Checks 5a/5b below (read vs. write scope)

### 2. Resources list exposes scan:// and brand:// URI families
- [x] `scan://report/...` URIs visible (5 concrete scan instances surfaced via `list()` callback)
- [x] `brand://score/...` template registered (resources.ts:118) — zero concrete instances visible because no brand scores exist in the test org yet; the `list()` callback at resources.ts:120 only emits entries for sites with computed brand scores. Template presence verified in source; runtime instance-emission will be exercised once a brand scan has been run.

### 3. Prompts list shows exactly /scan, /report, /fix
- [x] Slash-command picker shows exactly 3 Luqen prompts: "Scan a site" (/scan), "Summarize a scan report" (/report), "Generate a fix for an issue" (/fix)
- [x] No extra prompts present

### 4. Invoke a tool from Claude Desktop chat (+ numeric-coercion regression)
- [x] Prompt "List the 10 most recent scan reports for my org" → Claude called `dashboard_list_reports` with `limit: 10`, returned 10 completed scans (sky.it, aperol.com, gov.uk, w3.org across 2026-04-03 to 2026-04-10). No type error observed.
- [x] String-`limit` coercion path (`z.coerce.number()` fix in commit `6e522af`) cannot be exercised end-to-end via Claude Desktop — the client-side tool-call transport normalises numeric arg types before dispatch, so the wire payload is always `{"limit": 5}` regardless of user phrasing. Confirmed via 4b attempt 2026-04-18.
- [x] Server-side coercion covered by vitest suite `packages/dashboard/tests/mcp/data-tools.test.ts` describe block "Phase 30 data tools — string-coercion for LLM-produced numeric args" (5 tests, all passing as of 2026-04-18) — exercises raw-string input to the Zod schema, including the negative case that `"abc"` still fails after coercion. This is the authoritative guard for the regression; re-running it in CI is the sign-off artefact.
- [x] End-to-end numeric guardrail exercised via Claude Desktop on 2026-04-18: `dashboard_list_reports` with `limit: 9999` rejected at the Zod validation layer with MCP error code `-32602` (Invalid params), `too_big` origin, `inclusive: true`, message referencing the `.max(200)` bound. Error is LLM-self-correctable on next call. No silent clamp, no downstream crash.

### 5a. Read-scope happy path — DEFERRED (design gap discovered 2026-04-18)
### 5b. Write-scope happy path — DEFERRED (design gap discovered 2026-04-18)

**Status:** Cannot be exercised end-to-end in current code. See "Design gap — scope filter unreachable for OAuth clients" below for the full trace and remediation plan. Sign-off for SC#4 is now gated on the follow-up phase landing; these two checks re-run as part of that phase's verification.

### 6. Negative — tampered Bearer
- [x] Tampered bearer produced 401 / connection-failed state in Claude Desktop; RS256 signature verification rejected the token as expected. Confirmed 2026-04-18. Original token restored, connection resumed.

## Design gap — scope filter unreachable for OAuth clients (BLOCKS SC#4)

**Severity:** HIGH — a scope-limited OAuth client (`scope=read`) can currently invoke destructive tools (`dashboard_scan_site`) because the permission path overrides the scope path. This is the opposite of the defense-in-depth behaviour Phase 30-01 intended.

### Trace

1. `packages/compliance/src/api/routes/oauth.ts:156-161` — client-credentials token is signed with `{ sub: clientId, scopes: [...] }`. **No `role` claim ever set for client-credentials grants.**
2. `packages/dashboard/src/mcp/middleware.ts:71` — MCP auth preHandler reads `payload.role ?? 'member'`. For OAuth client-credentials tokens this always resolves to `'member'`.
3. `packages/dashboard/src/permissions.ts:88-93` — `resolveEffectivePermissions(storage, sub, 'member', orgId)`. Since role is not `'admin'`, the admin shortcut is skipped and the call delegates to `roleRepository.getEffectivePermissions(sub, orgId)`.
4. `packages/dashboard/src/db/sqlite/repositories/role-repository.ts:171-179` — `getUserPermissions` looks up `sub` (the clientId) in `dashboard_users`. **Miss** — client_ids are not users. The branch at line 176-178 falls back to the legacy global **`user`** role's permissions (~10 perms including `scans.create`, `reports.view`, `branding.view`, migration 035 adds `branding.view`).
5. `packages/core/src/mcp/http-plugin.ts:137-141` — `ctx.permissions.size > 0` is TRUE (~10 perms), so `filterToolsByPermissions` is used. **`filterToolsByScope` is never invoked for OAuth clients.**

### Consequence

- `scope=read`, `scope=write`, `scope=admin` OAuth clients all surface the **same** tool list — whatever the `user`-role fallback grants.
- Check 5a's acceptance ("`dashboard_scan_site` is filtered out for read-scope callers") cannot pass without a code change.
- The scope filter's unit tests (`packages/core/src/mcp/__tests__/tool-filter.test.ts`) pass — the filter function itself is correct. The gap is in the integration: the not-a-real-user fallback hands back the `user` role's perms instead of returning empty, so the scope branch is never taken.

### Evidence

- Walkthrough session 2026-04-18 — both the original "admin" OAuth client (Checks 1–4) and the member-role client both surfaced identical 6-tool sets (3 × `reports.view`, 2 × `branding.view`, 1 × `scans.create`). Verified against `filterToolsByPermissions(['scans.create','reports.view','branding.view', …])`.
- `permissions.ts:123-129` ORG_MEMBER_PERMISSIONS list, `migrations.ts:355-364` (legacy `user` role seed), `migrations.ts:1072-1088` (migration 035 adding `branding.view`) together explain the six visible tools.

### Remediation — proposed follow-up phase (must land before Phase 30 closes)

**Shape:** one-plan phase, insert before v3.0.0 milestone wraps. Two candidate approaches — pick ONE during discuss-phase:

- **(a) AND-combine the two filters** — in `http-plugin.ts:139-141`, require both `filterToolsByPermissions` AND `filterToolsByScope` to grant each tool. Lowest-impact on existing user flows (cookie-session users already have both perms and a broad scope grant via their user login). Preserves scope as a defense-in-depth layer.
- **(b) Empty-set on unknown sub** — in `role-repository.ts:176-178`, when `userRow === undefined` return `new Set()` instead of the `user`-role fallback. Then OAuth clients land on `ctx.permissions.size === 0` and the scope filter engages. Cleaner separation of user-auth vs service-auth but risks breaking any cookie-session flow that currently relies on the `user`-role fallback (must be verified empty outside tests).

**Acceptance for follow-up phase:**

- A `scope=read` OAuth client surfaces 5 tools (no `dashboard_scan_site`).
- A `scope=write` OAuth client surfaces 6 tools and the destructive-confirm UI fires.
- Direct call to `dashboard_scan_site` with a read-scope Bearer returns HTTP 403 (filter-denied), not 200.
- Existing cookie-session tests (`middleware.test.ts` Tests 4, 5, 6) still green.
- Checks 5a and 5b of this verification file re-run and tick.

## UX findings (non-blocking)

- **Scan report picker names not distinct in Claude Desktop** — the `list()` callback at resources.ts:76-81 returns each scan with `name: "Scan report for ${s.siteUrl}"`, but Claude Desktop's "Add from luqen-dashboard" picker collapses every instance to the group title "Scan reports", so users cannot tell the 5 entries apart without clicking through. Data flows correctly (click-through opens the correct JSON payload). **Likely Claude Desktop prefers the MCP `title` field over `name` for display — adding `title: s.siteUrl` (or a short date + siteUrl) per entry in the list response would make the picker usable.** Candidate polish task for a follow-up phase.

- **Tool description omits `limit` bounds hint** — `dashboard_list_reports` (and peers: `dashboard_query_issues`, `dashboard_list_brand_scores`) advertise a `limit` param but the tool description text doesn't mention the `1..200` range. An LLM picks a bound via failed call + retry (wastes a round-trip and tokens). Cheap fix: append "`limit`: 1–200, default 20." to each data-tool description in `packages/dashboard/src/mcp/tools/data.ts`. Also applies to `offset`. Candidate polish task.

- **Pa11y deterministic output on unchanged pages** — two `aperol.com` scans 24h apart returned identical issue totals (565 / 196 / 31 / 338). Expected when the page hasn't changed; worth noting if a future trend-view surfaces zero drift and looks broken when it actually isn't.

- **Default scan list crowded by smoke-test data** — six of the ten most recent reports are `testadmin` probes against w3.org / gov.uk. A `createdBy` filter on `dashboard_list_reports` (and the equivalent dashboard UI column) would let real scans surface in the default view.

## Sign-off

- **Developer:** _______________ (name + date)
- **All checks ✓:** yes / no
- **Notes / issues:** _______________

**Phase 30 SC#4 acceptance requires all checks ✓.**
