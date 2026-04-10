---
phase: 14-api-key-ux
plan: "02"
subsystem: dashboard/api-keys
tags: [api-keys, ttl, expiry, sweep, delete, audit, i18n]
dependency_graph:
  requires:
    - 14-01 (storeKey expiresAt param, deleteKey, revokeExpiredKeys)
  provides:
    - TTL select on creation form
    - POST handler TTL validation + expiresAt persistence
    - DELETE /admin/org-api-keys/:id route
    - runApiKeySweep helper module
    - Startup + daily sweep wired in server.ts
  affects:
    - packages/dashboard/src/views/admin/org-api-key-form.hbs
    - packages/dashboard/src/routes/admin/org-api-keys.ts
    - packages/dashboard/src/server.ts
    - packages/dashboard/src/i18n/locales/en.json
tech_stack:
  added:
    - packages/dashboard/src/api-key-sweep.ts (new module)
  patterns:
    - Exported helper functions (parseTtl, computeExpiresAt, ALLOWED_TTL_DAYS) for testability
    - runApiKeySweep extracted as standalone async function (FastifyBaseLogger interface)
key_files:
  created:
    - packages/dashboard/src/api-key-sweep.ts
    - packages/dashboard/tests/integration/org-api-key-routes.test.ts
  modified:
    - packages/dashboard/src/views/admin/org-api-key-form.hbs
    - packages/dashboard/src/routes/admin/org-api-keys.ts
    - packages/dashboard/src/server.ts
    - packages/dashboard/src/i18n/locales/en.json
decisions:
  - "Exported parseTtl/computeExpiresAt/ALLOWED_TTL_DAYS from org-api-keys.ts for direct unit testing without Fastify bootstrap"
  - "runApiKeySweep extracted to api-key-sweep.ts (separate module) — matches coding-style many-small-files rule"
  - "text-warning class absent from style.css — used text-muted + inline style=color:var(--status-warning) for never-warning hint"
  - "Revoke handler audit action corrected: api_key.delete -> api_key.revoke (pre-existing bug fixed)"
  - "Sweep wired in server.ts body (not onReady hook) so it runs before route registration completes"
metrics:
  duration: "47 minutes"
  completed: "2026-04-10"
  tasks: 2
  files: 6
requirements:
  - APIKEY-01
  - APIKEY-03
  - APIKEY-04
  - APIKEY-06
---

# Phase 14 Plan 02: API Key UX — TTL Form + DELETE Route + Sweep Summary

**One-liner:** TTL selector (30/90/180/365/never) on creation form with server-side whitelist validation, hard-delete route for revoked keys, and startup+daily sweep that auto-revokes expired keys — all wired with audit trail.

## What Was Built

### Form Template — TTL Select + Never Warning

Added a `<select name="ttl">` between the role select and form-actions in `org-api-key-form.hbs`:

- Five options: 30 days, **90 days (default, `selected`)**, 180 days, 1 year, Never expires
- All option labels use `{{t}}` i18n keys
- Inline `<p id="oak-ttl-warning">` rendered with `hidden` attribute by default
- Inline `<script>` listener: shows warning when `value="0"`, hides otherwise
- CSS: `class="text-muted"` + `style="color:var(--status-warning)"` (`.text-warning` absent from style.css)

### POST Handler — TTL Validation and expiresAt Persistence

Three exported helpers added to `org-api-keys.ts`:

```typescript
export const ALLOWED_TTL_DAYS = [0, 30, 90, 180, 365] as const;

export function parseTtl(raw: string | undefined):
  { valid: true; ttlDays: AllowedTtl } | { valid: false }
// Returns valid:false for non-numeric, NaN, or out-of-whitelist values.
// Defaults to 90 when raw is undefined or empty string.

export function computeExpiresAt(ttlDays: number): string | null
// ttlDays > 0 → ISO string (Date.now() + ttlDays * 86400000)
// ttlDays === 0 → null
```

POST handler extended:
1. Reads `body.ttl`, calls `parseTtl` — returns 400 + error toast on invalid input
2. Calls `computeExpiresAt(ttlResult.ttlDays)` for `expiresAt`
3. Passes `expiresAt` as 5th arg to `storage.apiKeys.storeKey`
4. `OrgApiKeyRow` extended with `expiresAt: string | null` and `expired: boolean`
5. Audit `details` now includes `expiresAt`

### DELETE Route

New `DELETE /admin/org-api-keys/:id` handler:

- Guard: `requirePermission('admin.org')`
- Reads `orgId` from `request.user.currentOrgId`; returns 400 if missing
- Looks up record label before delete (for audit)
- Calls `storage.apiKeys.deleteKey(id, orgId)` — SQL `WHERE id=? AND org_id=? AND active=0`
- Returns 404 toast when `deleteKey` returns false (active key, cross-org, or not found)
- Writes `api_key.delete` audit entry on success (distinct from `api_key.revoke`)
- Returns 200 + success toast on delete

### Audit Action Fix (Pre-existing Bug)

The revoke handler was writing `action: 'api_key.delete'` — corrected to `action: 'api_key.revoke'`.

Audit action mapping post-plan:
| Action | Trigger |
|--------|---------|
| `api_key.create` | POST /admin/org-api-keys |
| `api_key.revoke` | POST /admin/org-api-keys/:id/revoke |
| `api_key.delete` | DELETE /admin/org-api-keys/:id |
| `api_key.auto_revoke` | runApiKeySweep (startup or interval) |

### runApiKeySweep Helper

New module `packages/dashboard/src/api-key-sweep.ts`:

```typescript
export async function runApiKeySweep(
  storage: StorageAdapter,
  log: FastifyBaseLogger,
  trigger: 'startup' | 'interval',
): Promise<number>
```

- Calls `storage.apiKeys.revokeExpiredKeys()`
- When `count > 0`: logs structured `{ event, count, at, trigger }` and writes `api_key.auto_revoke` audit entry
- When `count === 0`: no log, no audit (silent no-op)
- Catches all errors, logs warning, returns 0 (never throws)

### Server.ts Wiring

Added after `storage` initialization (line ~144), before solo-mode key creation:

```typescript
await runApiKeySweep(storage, server.log, 'startup');
const apiKeySweepHandle = setInterval(
  () => { void runApiKeySweep(storage, server.log, 'interval'); },
  24 * 60 * 60 * 1000,
);
server.addHook('onClose', () => clearInterval(apiKeySweepHandle));
```

### New i18n Keys (en.json — admin.orgApiKeys block)

```json
"ttlLabel": "Expires after",
"ttl30days": "30 days",
"ttl90days": "90 days",
"ttl180days": "180 days",
"ttl365days": "1 year",
"ttlNever": "Never expires",
"neverWarning": "Keys without expiry are a security risk. Rotate manually.",
"invalidTtl": "Invalid expiry option.",
"expiredSuffix": "Expired",
"revokedKeysCount": "Revoked keys ({{count}})",
"deleteFailed": "Failed to delete API key.",
"deleteSuccess": "API key deleted."
```

## Tests (A–L) — All Passing

| Test | Description | Result |
|------|-------------|--------|
| A | `parseTtl('90')` → valid, ttlDays=90, expiresAt ~90d | PASS |
| B | `parseTtl('0')` → valid, ttlDays=0, expiresAt=null | PASS |
| C | `parseTtl('45')` → invalid (not in whitelist) | PASS |
| D | `parseTtl('abc')` → invalid (non-numeric) | PASS |
| E | `parseTtl(undefined)` → defaults to 90, expiresAt non-null | PASS |
| F | `parseTtl('365')` → valid, expiresAt ~365d | PASS |
| A-int | storeKey with ttl=90 → expiresAt ~90d in DB | PASS |
| B-int | storeKey with ttl=0 → expiresAt null in DB | PASS |
| G | deleteKey on revoked key in same org → true, row gone | PASS |
| H | deleteKey on active key → false, row stays | PASS |
| I | deleteKey with wrong orgId → false, row stays | PASS |
| J | deleteKey with non-existent id → false | PASS |
| K | runApiKeySweep: revokes expired+active key, writes audit entry | PASS |
| L | runApiKeySweep on empty DB: returns 0, no audit entry | PASS |

Total: 15 tests in new file + 155 total (including existing api-keys-repo and e2e-lifecycle tests) — all pass.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed pre-existing revoke handler audit action**
- **Found during:** Task 2 implementation
- **Issue:** Revoke handler at line 221 wrote `action: 'api_key.delete'` instead of `action: 'api_key.revoke'`
- **Fix:** Changed to `api_key.revoke` so hard-delete audit (`api_key.delete`) only refers to permanent deletions
- **Files modified:** `packages/dashboard/src/routes/admin/org-api-keys.ts`
- **Commit:** 8328d07

**2. [Rule 1 - CSS] text-warning class absent from style.css**
- **Found during:** Task 1 template update
- **Issue:** Plan specified `class="text-warning"` but `.text-warning` does not exist in `src/static/style.css` (only `--text-muted` CSS variable and `.text-muted` class exist)
- **Fix:** Used `class="text-muted" style="color:var(--status-warning)"` which reuses the existing warning color token (`.alert--warning` uses `--status-warning`)
- **Files modified:** `packages/dashboard/src/views/admin/org-api-key-form.hbs`
- **Commit:** 5961529

**3. [Rule 1 - TypeScript] OrgApiKeyRow missing expiresAt/expired in GET and revoke handlers**
- **Found during:** Build check after initial implementation
- **Issue:** TypeScript error TS2322 — GET and revoke handlers were mapping records to `OrgApiKeyRow[]` without the new `expiresAt`/`expired` fields
- **Fix:** Added `expiresAt: k.expiresAt` and `expired: k.expiresAt !== null && new Date(k.expiresAt) < now` to the GET handler map; added `expired:` field to revoke handler row construction
- **Files modified:** `packages/dashboard/src/routes/admin/org-api-keys.ts`
- **Commit:** 8328d07

## Threat Register Confirmations (T-14-07..T-14-14)

| Threat | Disposition | Implemented |
|--------|-------------|-------------|
| T-14-07 | Tampering: ttl=99999999 | Whitelist `[0,30,90,180,365]` rejects with 400 — Test C |
| T-14-08 | Tampering: ttl=DROP TABLE | `Number()` → NaN → `!isFinite` rejects → 400 — Test D |
| T-14-09 | EoP: DELETE without admin.org | `requirePermission('admin.org')` preHandler |
| T-14-10 | Tampering: cross-org DELETE | `deleteKey(id, currentOrgId)` SQL `AND org_id = ?` — Test I |
| T-14-11 | Repudiation: no delete audit | `audit.log(api_key.delete, ...)` before 200 response — Test G |
| T-14-12 | Repudiation: silent auto-revoke | `runApiKeySweep` writes `api_key.auto_revoke` when count>0 — Test K |
| T-14-13 | DoS: sweep timer leak | `server.addHook('onClose', () => clearInterval(apiKeySweepHandle))` |
| T-14-14 | InfoDisc: error leaks DB | catch returns `err.message` only when `err instanceof Error` |

## Known Stubs

None. All wiring is connected to real storage. The form, route, and sweep are fully functional.

## Self-Check: PASSED

- [x] `packages/dashboard/src/api-key-sweep.ts` exists
- [x] `packages/dashboard/tests/integration/org-api-key-routes.test.ts` exists
- [x] `packages/dashboard/src/views/admin/org-api-key-form.hbs` contains `name="ttl"`
- [x] `packages/dashboard/src/i18n/locales/en.json` contains `neverWarning`
- [x] `packages/dashboard/src/server.ts` contains `runApiKeySweep`
- [x] `packages/dashboard/src/server.ts` contains `clearInterval(apiKeySweepHandle)`
- [x] `packages/dashboard/src/routes/admin/org-api-keys.ts` contains `server.delete`
- [x] Commits 5961529 and 8328d07 exist in git log
- [x] `npm run build -w packages/dashboard` passes
- [x] All 15 new tests pass; 155 total tests pass
- [x] Phase 13 files untouched (git diff HEAD~2 shows no changes)
