---
phase: 82-scheduled-executive-digest
reviewed: 2026-06-11T00:00:00Z
depth: standard
files_reviewed: 15
files_reviewed_list:
  - packages/dashboard/src/db/sqlite/migrations.ts
  - packages/dashboard/src/db/interfaces/digest-repository.ts
  - packages/dashboard/src/db/sqlite/repositories/digest-repository.ts
  - packages/dashboard/src/db/types.ts
  - packages/dashboard/src/services/digest-service.ts
  - packages/dashboard/src/email/digest-email-builder.ts
  - packages/dashboard/src/email/digest-scheduler.ts
  - packages/dashboard/src/pdf/digest-generator.ts
  - packages/dashboard/src/routes/admin/digest-schedules.ts
  - packages/dashboard/src/routes/api/digest.ts
  - packages/dashboard/src/server.ts
  - packages/dashboard/src/services/legal-exposure.ts
  - /root/luqen-wordpress/includes/class-digest-page.php
  - /root/luqen-wordpress/includes/class-fleet-client.php
  - /root/luqen-wordpress/tests/e2e/digest-page.js
findings:
  critical: 5
  warning: 6
  info: 3
  total: 14
status: clean
fixed_at: 2026-06-11T19:52:00Z
fixes:
  CR-01: "014149f (luqen-wordpress master)"
  CR-02: "3e0057b3"
  CR-03: "3e0057b3"
  CR-04: "3e0057b3 (addressed-by-CR-03)"
  CR-05: "59f4a378"
  WR-01: "3e0057b3"
  WR-02: "3e0057b3"
  WR-03: "e85abe27"
  WR-04: "3e0057b3"
  WR-05: "e85abe27"
  WR-06: "bae7bb94"
  IN-01: skipped (info-only)
  IN-02: skipped (info-only)
  IN-03: skipped (info-only)
---

# Phase 82: Code Review Report

**Reviewed:** 2026-06-11T00:00:00Z
**Depth:** standard
**Files Reviewed:** 15
**Status:** issues_found

## Summary

Phase 82 delivers the scheduled executive digest feature: a `digest_schedules` DB entity, a `buildDigest` service that computes site deltas and exposure banding, PDF/email delivery via a scheduler, admin CRUD routes, an org-scoped REST API consumed by the WordPress plugin, and a WP admin page that renders the digest with an email-this-digest form.

The implementation is structurally sound and the conservative-framing discipline (D-06/D-12 — no "compliant", no percentages, band as ordinal label) is enforced consistently throughout every surface. The scheduler isolation is correct (D-09: `nextSendAt` always advances even on partial channel failure). SQL injection risk is eliminated by parameterised statements throughout the repository.

Five blockers are identified. The most severe is a wrong field name in `class-digest-page.php` that causes the "email this digest" form to silently use `null` exposure data for every site (CR-01). A second blocker is a missing org-scope guard on the toggle/delete/send-now admin routes that allows any `admin.system` user to operate on another org's schedules (CR-02). The remaining blockers are a `Content-Disposition` header that injects the user-supplied `period` path parameter unvalidated (CR-03), a `content-disposition` filename escape that is insufficient for the `period` value (CR-04, related), and the `listScans` call in `buildDigest` that fetches all org-wide completed scans without a limit, which will cause high memory pressure on large orgs (CR-05).

---

## Critical Issues

### CR-01: Wrong field name in WP email-this-digest body — exposure silently missing for all sites [FIXED: 014149f in luqen-wordpress]

**File:** `/root/luqen-wordpress/includes/class-digest-page.php:468`
**Issue:** The `handle_email()` method reads `$s['exposure']` (line 468) to build the exposure-band line in the plain-text email body. However the API response (and the `render()` page-display code that works correctly) uses the field name `currentExposure`, not `exposure`. Because PHP returns `null` when the key is absent, `$exposure` is always `null`, so the band line is never appended for any site. The silent failure means the emailed digest is always missing the risk-band context that is its primary value.

```php
// WRONG (line 468):
$exposure = isset( $s['exposure'] ) && is_array( $s['exposure'] ) ? $s['exposure'] : null;

// CORRECT — matches the API contract and the render() code at line 298:
$exposure = isset( $s['currentExposure'] ) && is_array( $s['currentExposure'] ) ? $s['currentExposure'] : null;
```

---

### CR-02: Missing org-scope check on admin digest routes — cross-org schedule manipulation [FIXED: 3e0057b3]

**File:** `packages/dashboard/src/routes/admin/digest-schedules.ts:200-289` (toggle, send-now, delete, view, PDF routes)
**Issue:** The PATCH toggle (line 200), POST send-now (line 232), DELETE (line 267), GET view (line 295), and GET PDF (line 342) routes all call `storage.digest!.getDigestSchedule(id)` without verifying that the retrieved schedule's `orgId` matches `request.user?.currentOrgId`. Any user holding `admin.system` permission on org A can manipulate (toggle, delete, or trigger delivery for) a schedule belonging to org B by knowing or guessing its UUID. The GET list route (line 88) is correctly scoped via `listDigestSchedules(orgId)`.

```typescript
// Add this check in each mutating/reading route, after the null guard:
const schedule = await storage.digest!.getDigestSchedule(id);
if (schedule === null) { /* 404 */ }

// ADD:
const requestingOrgId = request.user?.currentOrgId ?? 'system';
if (schedule.orgId !== requestingOrgId) {
  return reply.code(403).header('content-type', 'text/html')
    .send(toastHtml('Access denied.', 'error'));
}
```

---

### CR-03: Unvalidated `period` path parameter written into `Content-Disposition` header — header injection [FIXED: 3e0057b3]

**File:** `packages/dashboard/src/routes/admin/digest-schedules.ts:385`
**Issue:** The PDF download route accepts a `period` path parameter (e.g., `2026-06`) and writes it directly into the `Content-Disposition` header filename after only an `escapeHtml()` call (which escapes `<>&"` but NOT `\r`, `\n`, or `;`). HTTP header injection via embedded `\r\n` sequences can be used to inject arbitrary response headers. The `period` parameter is user-controlled, accepted via URL path, and schema-declared as `Type.String()` with no format constraint (line 57).

```typescript
// WRONG (line 385):
const filename = `accessibility-digest-${safeId}-${escapeHtml(period)}.pdf`;

// CORRECT — whitelist safe characters only:
const safePeriod = period.replace(/[^a-zA-Z0-9-]/g, '');
const filename = `accessibility-digest-${safeId}-${safePeriod}.pdf`;

// Also add a TypeBox format constraint in DigestPdfParams:
const DigestPdfParams = Type.Object(
  { id: Type.String(), period: Type.String({ pattern: '^[a-zA-Z0-9-]{1,20}$' }) },
  { additionalProperties: true },
);
```

---

### CR-04: `Content-Disposition` filename not RFC 6266 quoted — special chars break disposition [FIXED: 3e0057b3, addressed by CR-03 sanitiser]

**File:** `packages/dashboard/src/routes/admin/digest-schedules.ts:388`
**Issue:** Related to CR-03 but independently broken: the `Content-Disposition` header value places the filename in double-quotes (`attachment; filename="${filename}"`), but the `safeId` is derived with `schedule.orgId.replace(/[^a-z0-9]/gi, '-')` (line 384) while `period` uses only `escapeHtml()`. A `period` value of `2026"06` (which `escapeHtml` converts to `2026&quot;06`) would produce a `&quot;` substring inside the filename double-quote delimiter, breaking the header parse in some clients. After CR-03's fix the safe-period sanitiser prevents this, but the existing code is independently broken even before injection risk is considered.

**Fix:** Apply the sanitisation from CR-03. After that fix, no additional change is needed here.

---

### CR-05: Unbounded `listScans` for org-wide scope in `buildDigest` — memory exhaustion on large orgs [FIXED: 59f4a378]

**File:** `packages/dashboard/src/services/digest-service.ts:349`
**Issue:** When `siteUrl` is `null` (org-wide digest), `buildDigest` calls `storage.scans.listScans({ orgId, status: 'completed' })` with no `limit`. For an org with thousands of completed scans this loads every row into memory to extract `distinctSites`. The distinct-site enumeration only needs the `siteUrl` column and a `GROUP BY`, not all scan rows. While this is primarily a performance concern, it can also cause an OOM-kill of the dashboard process and is therefore a correctness/availability issue.

```typescript
// WRONG (line 349):
const allCompleted = await storage.scans.listScans({ orgId, status: 'completed' });
const distinctSites = new Set(allCompleted.map((s) => s.siteUrl));

// CORRECT — use a dedicated distinct-sites query, OR cap to a reasonable limit
// while the repository gains a distinct-sites method:
const allCompleted = await storage.scans.listScans({ orgId, status: 'completed', limit: 5000 });
// (and add a comment noting the cap + a TODO for a dedicated repo method)
```

---

## Warnings

### WR-01: `recipients` field not validated as email addresses on create — garbage stored silently [FIXED: 3e0057b3]

**File:** `packages/dashboard/src/routes/admin/digest-schedules.ts:172-180`
**Issue:** The POST create route stores `body.recipients?.trim() ?? ''` directly without validating individual entries as syntactically valid email addresses. `parseRecipients()` in the scheduler just splits on commas. A user who types `exec@example.com, @badaddr, foo` will silently store two bad addresses and the scheduler will attempt to send to them, producing SMTP errors each sweep that are only caught at delivery time (logged but not surfaced to the admin). The fix should mirror the email-report create validation already present elsewhere in the codebase.

**Fix:** Split on comma, validate each entry with a basic email regex (or the same pattern used in other report create routes), reject the whole request if any entry is invalid, and return a 400 toast.

---

### WR-02: `siteUrl` on single-site schedule is not validated as a URL — stored as free text [FIXED: 3e0057b3]

**File:** `packages/dashboard/src/routes/admin/digest-schedules.ts:165-166`
**Issue:** When `scope === 'site'`, `siteUrl` is stored as `body.siteUrl?.trim() ?? null` with no format check. An empty-string value after trim (i.e., the user submits `scope=site` with an empty `siteUrl` field) produces a `siteUrl` of `null` in the DB even for single-site schedules (because `''.trim()` is `''` and the nullish-coalesce branch never fires — it only fires when `body.siteUrl` is `undefined`). Result: a nominally single-site schedule behaves as an org-wide schedule. Also, no URL scheme validation means arbitrary strings like `javascript:foo` or path-only strings can be stored and echoed to downstream consumers.

**Fix:**
```typescript
const siteUrl = scope === 'site'
  ? (body.siteUrl?.trim() || null)  // use || not ?? to catch empty string
  : null;

// Then validate:
if (scope === 'site' && siteUrl !== null) {
  try { const u = new URL(siteUrl); if (!['http:', 'https:'].includes(u.protocol)) throw new Error(); }
  catch { return reply.code(400).header('content-type','text/html').send(toastHtml('Site URL must be a valid http/https URL.', 'error')); }
}
```

---

### WR-03: `computeNextDigestSendAt` advances from "now" not from scheduled time — drift accumulates [FIXED: e85abe27]

**File:** `packages/dashboard/src/email/digest-scheduler.ts:41-55`
**Issue:** The scheduler always computes the next send time relative to `new Date()` (the moment `processDigest` finishes), not relative to the scheduled `nextSendAt`. If the digest service takes 90 seconds to generate (large org, slow PDF), the schedule drifts 90 seconds later each cycle. Over months with large orgs this causes schedule drift that compounds. The same bug exists in the email scheduler pattern it mirrors; but the email scheduler mirrors a fixed pattern — this implementation should not replicate the bug.

**Fix:**
```typescript
// In processDigest (digest-scheduler.ts:282):
const nextSendAt = computeNextDigestSendAt(schedule.frequency, new Date(schedule.nextSendAt));
//                                                             ^^^^^^^^^^^^^^^^^^^^^^^^^^^
// Advance from the scheduled time, not from the wall-clock "now"
```

---

### WR-04: `buildDigestScheduleRow` in `hx-target` uses unescaped `id` as a DOM selector [FIXED: 3e0057b3]

**File:** `packages/dashboard/src/routes/admin/digest-schedules.ts:429`
**Issue:** The toggle button uses `hx-target="#digest-row-${eid}"` where `eid = escapeHtml(schedule.id)`. `escapeHtml` converts `<>&"` to HTML entities but does not sanitise CSS selector metacharacters. The `id` is a UUID generated by `randomUUID()` so in practice it is always safe, but the row-id and target are constructed from DB-read values; if the `id` column were ever populated by an import or migration that allowed non-UUID values (e.g., containing `.`, `#`, `[`), the selector would break or be exploitable. Additionally, the generated `<tr id="digest-row-${eid}">` attribute uses the HTML-entity-escaped form while the CSS selector also uses the entity-escaped form — these are equivalent in HTML context but the CSS-selector interpretation of `&amp;` differs from `&`. No immediate attack surface given UUID generation, but it is a latent inconsistency.

**Fix:** Assert that `id` is a UUID-format string before building the row, or use a `data-` attribute + `closest` instead of id-targeted selectors for HTMX targets.

---

### WR-05: `processDigest` advances `nextSendAt` even when `storage.digest` is undefined — silent no-op [FIXED: e85abe27]

**File:** `packages/dashboard/src/email/digest-scheduler.ts:283-288`
**Issue:** The update block at line 283 guards with `if (storage.digest !== undefined)` before advancing `nextSendAt`. If `storage.digest` is `undefined` (e.g., non-SQLite adapter), the schedule is never advanced and `getDueDigestSchedules()` will return the same schedule on every subsequent sweep tick — triggering delivery in a tight loop for every 60-second interval until the process restarts. The guard was intended as a defensive check but is actually a correctness hazard: the advancement MUST be unconditional with respect to channel delivery success (D-09), but should not be conditional on `storage.digest` existence since `getDueDigestSchedules()` itself already depends on the same repository.

**Fix:** Remove the `if (storage.digest !== undefined)` guard. If `storage.digest` is undefined the scheduler cannot have retrieved `due` schedules in the first place (the `getDueDigestSchedules` call would have returned `[]`), so the guard is never needed and its presence creates a dangerous failure mode.

---

### WR-06: `escapeHtml` in `bandBadgeHtml` escapes BAND_ICON characters unnecessarily — entity encoding in CSS style attribute [FIXED: bae7bb94]

**File:** `packages/dashboard/src/email/digest-email-builder.ts:81-83`
**Issue:** `bandBadgeHtml` calls `escapeHtml(BAND_ICON[band])` before inserting the icon into the `<span>` content. The icon characters (`●`, `▲`, `⬛`) are Unicode and contain no HTML-special characters, so `escapeHtml` is a no-op for them in practice. However the `BAND_BADGE_STYLE` string is inserted directly into the `style` attribute without escaping at all: `<span style="${BAND_BADGE_STYLE[band]}">`. If a future maintainer adds a CSS value that contains `"`, the attribute delimiter would be broken. The fix is a low-priority style hygiene issue but the style attribute should use single quotes or the value should be attribute-escaped.

**Fix:** Wrap the style value in attribute-safe escaping:
```typescript
return `<span style="${escapeHtml(BAND_BADGE_STYLE[band])}">${icon}${label}</span>`;
```

---

## Info

### IN-01: `period` path parameter in PDF route is ignored — it always uses the last-sent window

**File:** `packages/dashboard/src/routes/admin/digest-schedules.ts:354-392`
**Issue:** The PDF download route accepts a `period` path parameter (documented as a "YYYY-MM or ISO range hint") but the parameter is never used to select the time window. The route always resolves to `lastSentAt → now` regardless of `period`. The parameter appears only in the filename. This means a caller requesting a specific historical period (e.g., `/pdf/2026-04`) always receives data for the current window. The comment on line 366 says "For the PDF download we use the schedule's last-sent window" which acknowledges this, but the route signature implies historical access that does not exist.

**Fix:** Either remove the `period` path parameter and rename the route to `/pdf` (simpler), or implement the period lookup properly. At minimum, document in the route comment that `period` is only used for the filename.

---

### IN-02: E2E test uses a hardcoded local IP for the Playwright require path

**File:** `/root/luqen-wordpress/tests/e2e/digest-page.js:18`
**Issue:** The file requires Playwright via an absolute path: `require('/root/luqen-wordpress/node_modules/playwright/index.js')`. This is a machine-specific path that will break on any CI runner or developer machine where the repo is not at `/root/luqen-wordpress`. All other E2E tests in the suite use a relative require.

**Fix:**
```javascript
// WRONG:
const pw = require('/root/luqen-wordpress/node_modules/playwright/index.js');

// CORRECT:
const { chromium } = require('playwright');
// (or use a path.resolve(__dirname, ...) relative reference)
```

---

### IN-03: `render_driver_label` interpolates untrusted `params` values directly into translated strings without sanitisation

**File:** `/root/luqen-wordpress/includes/class-digest-page.php:536-599`
**Issue:** The `render_driver_label` method interpolates `$params['date']`, `$params['name']`, and `$params['days']` directly into `sprintf()` format strings. The values come from the dashboard API response (a trusted internal service), and the output is passed to `esc_html()` at the call site (line 345). So there is no immediate XSS vector. However, the `$date` and `$name` params are cast to string and not otherwise constrained. If the dashboard ever sends an excessively long value (e.g., a malformed API response), the rendered label could be very long. This is a low-priority hardening note, not an exploitable issue given the WP context.

**Fix (low priority):** Add `substr()` guards on param values before interpolation, e.g.:
```php
$date = substr( isset( $params['date'] ) ? (string) $params['date'] : '28 Jun 2025', 0, 30 );
```

---

_Reviewed: 2026-06-11T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
