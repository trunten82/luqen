# Phase 54 — UAT (Per-org source management mode override)

Manual verification checklist for `/admin/sources`. Run after deploy of Phase 54.

## Setup

Two accounts available:
- `alessandro` — system admin (orgId='system')
- `ale` — org admin (orgId=a non-system org)

## Cases

### 1. Org admin sets LLM override on a system source
1. Log in as `ale` → `/admin/sources`.
2. Find a government source whose system default is "Manual" (e.g. EAA).
3. Click `→ LLM`.
4. Expect: success toast, page reloads with badge `LLM` + small italic `(your override)` indicator + a `Reset` button.
5. Open compliance DB or `/api/v1/sources/:id` — system column `management_mode` is **unchanged**.

### 2. Override survives reload
1. After case 1, hard-refresh the page.
2. Expect: badge still shows `LLM` + `(your override)` + `Reset`.

### 3. Reset clears the override
1. Click `Reset`. Confirm.
2. Expect: success toast `Override cleared. Effective mode is now manual.`
3. Reload — badge returns to system default (`Manual`), `(your override)` gone, `Reset` button gone.

### 4. Bulk-switch as org admin (role-aware label)
1. As `ale`, find the bulk-switch button at the top of the page.
2. Expect button label: `Switch All Gov → LLM (for my org)`.
3. Click. Expect: all government sources now show `LLM` + `(your override)` for the caller's org.
4. System column for those sources is unchanged.

### 5. Bulk-switch as system admin
1. Log out, log in as `alessandro`.
2. Bulk-switch button label is `Switch All Gov → LLM` (no `(for my org)` suffix).
3. Click. Expect: all government source system defaults flip to LLM. Orgs with explicit overrides still see THEIR override mode (overrides win).

### 6. Cross-org isolation
1. As `ale`, set an LLM override on EAA.
2. As `alessandro` (system admin), open `/admin/sources` — should see system default badge for EAA, NOT `(your override)` (system caller has no overrides).
3. As a different org admin (if available), confirm they see system default — not org A's override.

### 7. Override wins over system default change
1. As `ale`, set LLM override on EAA.
2. As `alessandro`, flip EAA system default to `Manual` per-row.
3. As `ale`, refresh — EAA still shows `LLM` + `(your override)` (override wins).

### 8. Backwards compat
1. As `ale`, on a source you've never overridden, badge reflects current system default. No `(your override)` indicator. No `Reset` button.

### 9. Cross-org write of org-owned source still 403
1. If org A has its own source row (`org_id=orgA`), org B should receive 403 attempting to PATCH it. Verify via API or by another org admin in dashboard (button click → 500 toast with 403 message).

## Pass criteria
- All 9 cases observed as described
- No 403s in the org admin per-row LLM/Manual flow on system sources (was the Phase 51 incongruence)
- System default never silently changes via an org admin's click
