---
phase: 14-api-key-ux
plan: "03"
subsystem: dashboard/api-keys
tags: [api-keys, htmx, oob-swap, template, split-view, revoke, delete, i18n]
dependency_graph:
  requires:
    - 14-02 (DELETE route, TTL POST, OrgApiKeyRow with expiresAt/expired)
  provides:
    - Split active/revoked view model in GET handler
    - Collapsible <details> revoked section in org-api-keys.hbs
    - Revoke OOB row-move (active → revoked tbody + count update)
    - First-revoke HX-Refresh edge case
    - Delete OOB count update
    - Form hx-target renamed to #org-api-keys-active-body
  affects:
    - packages/dashboard/src/views/admin/org-api-keys.hbs
    - packages/dashboard/src/views/admin/org-api-key-form.hbs
    - packages/dashboard/src/routes/admin/org-api-keys.ts
    - packages/dashboard/src/i18n/locales/en.json
    - packages/dashboard/tests/integration/org-api-key-routes.test.ts
tech_stack:
  added: []
  patterns:
    - OrgApiKeyView interface for GET template context (separate from OrgApiKeyRow used by POST helpers)
    - revokedRowInnerHtml helper for partial HTML in OOB revoke response
    - HTMX OOB row append wrapped in <template> (per feedback_htmx_oob_in_table.md)
    - HX-Refresh fallback when OOB target element does not yet exist in DOM
key_files:
  created: []
  modified:
    - packages/dashboard/src/views/admin/org-api-keys.hbs
    - packages/dashboard/src/views/admin/org-api-key-form.hbs
    - packages/dashboard/src/routes/admin/org-api-keys.ts
    - packages/dashboard/src/i18n/locales/en.json
    - packages/dashboard/tests/integration/org-api-key-routes.test.ts
decisions:
  - "OrgApiKeyView is a separate interface from OrgApiKeyRow — GET handler uses View (template context), POST/revoke helpers use Row (partial HTML rendering)"
  - "First-revoke edge case uses HX-Refresh because the <details> section does not exist in DOM when revoked count is 0; OOB swaps into non-existent targets silently fail"
  - "revokedRowInnerHtml uses hardcoded English matching pre-Phase-14 route helper convention; TODO added to migrate to i18n helper in a future phase"
  - "Delete handler re-queries remaining revoked count after delete so the OOB count span is accurate; <details> section lingers at (0) until next full GET — acceptable v1 trade-off"
metrics:
  duration: "35 minutes"
  completed: "2026-04-08"
  tasks: 2
  files: 5
requirements:
  - APIKEY-01
  - APIKEY-02
  - APIKEY-05
---

# Phase 14 Plan 03: Org API Key Split View + Revoke Row-Move Summary

**One-liner:** Active/revoked split view with collapsible `<details>` section, HTMX OOB row-move on revoke, HX-Refresh fallback for first revoke, and live count updates on revoke and delete.

## What Was Built

### GET Handler — Split View Model

The GET handler now filters and maps records into two separate arrays before rendering:

```typescript
const toView = (k): OrgApiKeyView => ({
  ...k,
  rateLimit: API_KEY_RATE_LIMITS[k.role],
  expired: k.expiresAt !== null && new Date(k.expiresAt).getTime() < now,
});

const activeKeys = records.filter(k => k.active).map(toView);
const revokedKeys = records.filter(k => !k.active).map(toView);

reply.view('admin/org-api-keys.hbs', {
  activeKeys, revokedKeys, revokedCount: revokedKeys.length, ...
});
```

The `expired` flag is computed as `expiresAt !== null && new Date(expiresAt).getTime() < Date.now()`.

### Template — Active Table + Revoked Details

`org-api-keys.hbs` rewritten with:

- **Active section**: `<h2>` heading + table with `<tbody id="org-api-keys-active-body">`. Empty state renders `noActiveKeys` i18n message below the table (tbody still present for HTMX create target).
- **Revoked section**: Wrapped in `{{#if revokedKeys.length}}` — hidden when empty. Uses native `<details class="revoked-section">` collapsed by default. `<summary>` contains `<span id="org-api-keys-revoked-count">{{revokedCount}}</span>` as the OOB count target.
- **Revoked tbody**: `id="org-api-keys-revoked-body"` — OOB append target for revoke handler.
- **Status cell**: `(Expired)` small muted suffix rendered only when `{{#if this.expired}}`.
- **Delete button**: Only on revoked rows, uses `hx-delete` + `hx-confirm`.

### Revoke Handler — OOB Row-Move

Pre-revoke revoked count is captured. Two paths:

**First revoke (beforeRevokedCount === 0):**
```
HX-Refresh: true  ← full page reload, revoked section doesn't exist in DOM
body: ""
```

**Subsequent revokes:**
```html
<template>
  <tr id="org-api-key-{id}" hx-swap-oob="beforeend:#org-api-keys-revoked-body">
    {revokedRowInnerHtml(row)}
  </tr>
</template>
<span id="org-api-keys-revoked-count" hx-swap-oob="true">{newCount}</span>
{toastHtml}
```

The main response body is empty — the revoke button's `hx-target="#org-api-key-{id}"` + `hx-swap="outerHTML"` removes the active row when HTMX processes the empty body.

The `<template>` wrapper is mandatory per `feedback_htmx_oob_in_table.md` — bare `<tr>` OOB swaps outside a `<table>` get stripped by the browser.

### Delete Handler — OOB Count Update

After `deleteKey`, re-queries remaining revoked count and appends:

```html
<span id="org-api-keys-revoked-count" hx-swap-oob="true">{remainingRevoked}</span>
{toastHtml}
```

The `<details>` section lingers at "(0)" if this empties the revoked list — acceptable v1 trade-off (correct on next full GET).

### Form Template — hx-target Renamed

`org-api-key-form.hbs` line 6:
```
hx-target="#org-api-keys-active-body"   ← was #org-api-keys-body
```

### New i18n Keys

Added to `admin.orgApiKeys`:
```json
"noActiveKeys": "No active API keys for this organization. Create one to get started.",
"activeSectionHeading": "Active keys",
"revokedSectionHeading": "Revoked keys"
```

### revokedRowInnerHtml Helper

New helper renders the inner cells of a revoked row for OOB injection:
- `escapeHtml(row.label)` — XSS mitigation (T-14-15)
- Expired suffix: `<small class="text-muted">(Expired)</small>` when `row.expired`
- Delete button with `hx-delete` + `hx-confirm`

## Test Results (M–S) — All Passing

| Test | Description | Result |
|------|-------------|--------|
| M | GET: 2 active + 1 revoked-not-expired + 1 revoked-and-expired → correct split + expired flag | PASS |
| N | GET: 0 revoked → revokedKeys empty, revokedCount 0 | PASS |
| O | GET: 0 active → activeKeys empty, orgId passed to view | PASS |
| P | Revoke when 1 already revoked → OOB targets revoked-body + count updates to 2 | PASS |
| Q | Delete one of 2 revoked → OOB count updates to 1 | PASS |
| R | First revoke (0 revoked before) → HX-Refresh: true header | PASS |
| S | Form GET renders org-api-key-form.hbs template | PASS |

Previous tests A–L unchanged: all pass. Full dashboard suite: **2337 passed, 0 failed**.

## Deviations from Plan

None — plan executed exactly as written.

The `statusBadge` helper (used by `keyRowHtml` for the create-response row) was not removed — `keyRowHtml` is still used for the POST create response and is correct for active rows. No deviation needed.

## Threat Register Confirmations (T-14-15..T-14-19)

| Threat | Disposition | Implemented |
|--------|-------------|-------------|
| T-14-15 | XSS: label in OOB HTML | `escapeHtml(row.label)` in `revokedRowInnerHtml` — verified by Test P |
| T-14-16 | XSS: id in OOB selectors | `encodeURIComponent(row.id)` at URL boundary; id is server-generated hex |
| T-14-17 | Tampering via HTMX manipulation | Accepted — server honours URL+method+params only; cross-org guards at DB level |
| T-14-18 | Repudiation: silent OOB failure | First-revoke triggers HX-Refresh (Test R); `<template>` wrapper prevents browser stripping |
| T-14-19 | InfoDisc: toast reveals cross-org label | `record` lookup uses `listKeys(orgId)` — org-filtered |

## Known Stubs

None. All UI interactions are wired to real storage and real HTMX responses.

## Manual Smoke-Check Recommendation

After merging to master and deploying:
1. Visit `/admin/org-api-keys` — confirm active table renders with heading "Active keys"
2. Create a key with TTL=30 — confirm it appears in the active tbody without page reload
3. Revoke the key — confirm it moves from the active table to a new "Revoked keys (1)" `<details>` section (HX-Refresh path for first revoke)
4. Create and revoke a second key — confirm it appends to the revoked tbody via OOB (no full reload)
5. Expand the revoked section — confirm the "(Expired)" suffix appears on any key whose `expires_at` is in the past
6. Delete a revoked key — confirm the row disappears and the count decrements

## Self-Check: PASSED

- [x] `packages/dashboard/src/views/admin/org-api-keys.hbs` contains `org-api-keys-active-body`
- [x] `packages/dashboard/src/views/admin/org-api-keys.hbs` contains `<details`
- [x] `packages/dashboard/src/views/admin/org-api-key-form.hbs` contains `org-api-keys-active-body`
- [x] `packages/dashboard/src/routes/admin/org-api-keys.ts` contains `activeKeys`
- [x] `packages/dashboard/src/routes/admin/org-api-keys.ts` contains `HX-Refresh`
- [x] `packages/dashboard/src/routes/admin/org-api-keys.ts` contains `<template`
- [x] `packages/dashboard/src/routes/admin/org-api-keys.ts` contains `org-api-keys-revoked-count`
- [x] `packages/dashboard/src/i18n/locales/en.json` contains `noActiveKeys`
- [x] Commits 83cb8e1 and a3e8587 exist in git log
- [x] `npm run build -w packages/dashboard` passes
- [x] All 22 tests in org-api-key-routes.test.ts pass (M–S + existing A–L)
- [x] Full dashboard suite: 2337 passed
- [x] Phase 13 files untouched (git diff shows no changes)
