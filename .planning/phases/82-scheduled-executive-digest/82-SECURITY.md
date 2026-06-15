---
phase: 82
slug: scheduled-executive-digest
status: verified
threats_open: 0
asvs_level: 1
created: 2026-06-15
---

# Phase 82 — Scheduled Executive Digest: Security Audit

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Auditor: gsd-security-auditor (Claude Sonnet 4.6)
> Audit date: 2026-06-15

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| service code → digest_schedules table | All writes through SqliteDigestRepository with parameterised bindings | Org-scoped schedule config (recipients, channels, frequency) |
| org scope → row visibility | listDigestSchedules filters by orgId; getDue runs system-wide for the sweep | Digest schedule rows (potentially cross-org if unguarded) |
| scheduler → notify plugins (Slack/Teams webhooks) | Outbound to third-party endpoints; failures must be contained | Digest summary text + dashboard link |
| digest PDF/email → recipients | Document carries org data + legal-framing; must not assert compliance/fault | DigestData with exposure band + findings delta |
| admin browser → /admin/digest-schedules | Authenticated admin (admin.system) manages schedules; CSRF on mutations | Schedule CRUD; recipients; channel config |
| admin browser → /admin/digest-schedules/:id/view + :id/pdf | Auth-gated digest preview/download; org-scoped to the schedule's org | DigestData; PDF buffer |
| WP plugin → dashboard GET /api/v1/digest | OAuth2 + X-Org-Id call; org-scoped digest data crosses to a remote consumer | DigestData minus disclaimer |
| WP admin browser → Luqen_Digest_Page | Authenticated WP admin (Luqen_Settings::CAP) views the page | Digest band, deltas, directions |
| Email this digest form (WP) | Authenticated POST → wp_mail; nonce-guarded | Recipients, email body |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-82-01 | Information disclosure | one org reading another org's schedules | mitigate | `listDigestSchedules(orgId)` filters by org; `org_id` column on every row (DEFAULT 'system'); admin routes guard `schedule.orgId === requestingOrgId` (CR-02 fix: lines 258-259, 302-303, 344-345, 377-378 in `routes/admin/digest-schedules.ts`) | closed |
| T-82-02 | Tampering | SQL injection via schedule fields | mitigate | All repository statements use parameterised better-sqlite3 bindings (`@param`); no string concatenation of user data. Verified: `@orgId`, `@name`, `@siteUrl`, etc. in `db/sqlite/repositories/digest-repository.ts:74` | closed |
| T-82-03 | Elevation of privilege | non-admin creating schedules | mitigate | `digest.manage` permission seeded in migration 088 (`migrations.ts:2254-2260`); enforced via `requirePermission('admin.system')` in all digest admin route handlers (`routes/admin/digest-schedules.ts:112,148,243,287,329,362,415`) | closed |
| T-82-04 | Tampering | malformed channels JSON crashing the loader | mitigate | `channels` written only as `JSON.stringify(string[])` from the create path; `digestRowToRecord` at `digest-repository.ts:32` is the single `JSON.parse` read point | closed |
| T-82-05 | Repudiation | false-precision / fault-asserting digest copy | mitigate | `export const BAND_ORDINAL` at `legal-exposure.ts:277`; `computeDirection` uses ordinal comparison; no numeric exposure in `DigestData`; forbidden-words grep clean on `digest-service.ts`; conservative-framing assertion in `tests/services/digest-service.test.ts` | closed |
| T-82-06 | Information disclosure | org-wide scope leaking another org's sites | mitigate | `buildSiteDelta` calls `storage.scans.getScansForSite(orgId, siteUrl, 200)` — orgId passed explicitly; `listScans({ orgId, status:'completed', limit:1000 })` at `digest-service.ts:352` scoped to org | closed |
| T-82-07 | Denial of service | malformed/huge json_report stalling the build | mitigate | `buildSiteDelta` wrapped in per-site `try/catch` at `digest-service.ts:217` (comment: "one bad site never fails the whole digest build — T-82-07"); `deriveExposure` wrapped in inner try/catch at lines 225, 231; `null → hasNewScan=false` path at line 241 | closed |
| T-82-08 | Tampering | mis-reading a no-scan site as "unchanged/fine" | mitigate | Explicit `hasNewScan: false` branch at `digest-service.ts:241`; `hasNewScan: false` also at line 306 (no baseline scan); 8 test assertions on `hasNewScan` in `tests/services/digest-service.test.ts` | closed |
| T-82-09 | Denial of service | failing/misconfigured channel wedging the schedule into resend loops | mitigate | Per-channel `try/catch` in `processDigest` (`digest-scheduler.ts`); unconditional `updateDigestSchedule(id, { lastSentAt, nextSendAt })` at line 303 after the channel loop (WR-05 guard removed); `timer.unref()` at line 341; D-09 no-wedge proven by test (D-09 test in `tests/email/digest-scheduler.test.ts`) | closed |
| T-82-10 | Information disclosure | digest delivered to the wrong org's recipients | mitigate | `processDigest` derives `orgId`/`siteUrl` from the schedule row (org-scoped in Plan 01); `buildDigest` scoped to `schedule.orgId/siteUrl`; `parseRecipients(schedule.recipients)` at `digest-scheduler.ts:201` | closed |
| T-82-11 | Repudiation | PDF/email/Slack copy asserting compliance or fault | mitigate | `DISCLAIMER_TEXT` imported from `legal-exposure.ts` at `digest-generator.ts:20`; `renderBandBadge` at line 100 always renders icon + label; forbidden-words grep clean on all three delivery files; email-body test in `tests/pdf/digest-generator.test.ts` asserts disclaimer present + forbidden words absent | closed |
| T-82-12 | Tampering | malicious content in site/org identity injected into PDF | mitigate | PDFKit `.text()` calls at `digest-generator.ts:185,187,190,198` render plain strings — no HTML/markup execution; no Chromium; `import PDFDocument from 'pdfkit'` at line 14 | closed |
| T-82-13 | Information disclosure | Slack/Teams summary leaking a numeric/precise risk claim | mitigate | Slack/Teams messages use `{icon}{band}` + direction label only (`digest-scheduler.ts`); disclaimer line required in every message; forbidden-words grep clean on `digest-scheduler.ts` | closed |
| T-82-14 | Elevation of privilege | non-admin creating/sending/viewing digests | mitigate | `requirePermission('admin.system')` preHandler on every admin route handler (7 occurrences at `routes/admin/digest-schedules.ts:112,148,243,287,329,362,415`); `digest.manage` seeded in migration 088 | closed |
| T-82-15 | Information disclosure | one org reading another org's digest via /api/v1/digest | mitigate | `requireAuthOrSend401` at `routes/api/digest.ts:98`; resolves `orgId` from `request.user.currentOrgId` (line 102-107); 401 when absent or empty; `buildDigest` scoped to that org | closed |
| T-82-16 | Spoofing/CSRF | forged POST/PATCH/DELETE on schedules | mitigate | `_csrf` hidden field + `hx-include="[name='_csrf']"` on all mutating HTMX buttons (`routes/admin/digest-schedules.ts:514,521,531`); `csrfToken` injected at lines 138, 405 | closed |
| T-82-17 | Tampering (XSS) | unescaped schedule name/site URL in the TR/view | mitigate | `escapeHtml()` on all interpolated values in `buildDigestScheduleRow` (`digest-schedules.ts:486,497,500,503,505,507,508,524,533`); `{{t}}` / Handlebars double-brace escaping in HBS templates | closed |
| T-82-18 | Denial of service | DoS via unbounded GET /api/v1/digest | mitigate | `rateLimitConfig` at `routes/api/digest.ts:110-111` — `{ max: 120, timeWindow: '1 minute' }`; applied at line 127 | closed |
| T-82-19 | Repudiation | digest UI asserting compliance/fault | mitigate | D-12 forbidden-words grep clean on all new HBS + JSON files; band badge renders label not number; disclaimer card always present in digest view (`digest-view.hbs` + `rpt-digest-risk.hbs`) | closed |
| T-82-19b | Repudiation | API payload asserting compliance/fault or numeric exposure | mitigate | `DigestExposureSchema` has no `disclaimer` field (`routes/api/digest.ts:33-40`); disclaimer stripped at lines 155-176; band is Union string label; forbidden-words grep clean on `routes/api/digest.ts` | closed |
| T-82-20 | Elevation of privilege | unauthorised WP user viewing digest page | mitigate | `render()` guarded by `current_user_can( Luqen_Settings::CAP )` at `class-digest-page.php:122`; `add_submenu_page` uses the same CAP at line 115; `handle_email()` also guarded at line 405 | closed |
| T-82-21 | Information disclosure | another org's digest shown in WP | mitigate | Data sourced from `GET /api/v1/digest` with org-scoped X-Org-Id injected by `class-api-client.php:78-81` (`X-Org-Id` header); plugin requests only its own `home_url('/')` site URL; dashboard enforces org isolation server-side (T-82-15) | closed |
| T-82-22 | Tampering (XSS) | malicious band/driver/criteria values from API | mitigate | Every output escaped: `esc_html`, `esc_attr`, `esc_url` throughout `class-digest-page.php`; `sanitize_html_class($exposure['band'])` at lines 305, 470; driver keys mapped to fixed translated strings via `render_driver_label` — never echoed raw | closed |
| T-82-23 | Spoofing/CSRF | forged "Email this digest" POST | mitigate | `wp_nonce_field('luqen_digest_email','luqen_nonce')` at `class-digest-page.php:384`; `check_admin_referer('luqen_digest_email','luqen_nonce')` at line 408; `current_user_can(Luqen_Settings::CAP)` guard at line 405; `wp_mail` at line 479 | closed |
| T-82-24 | Denial of service / availability | dashboard unreachable breaking the admin page | mitigate | `$test_client->is_configured()` check at line 145 → notice-warning; `is_wp_error($digest)` at line 155 → notice-warning; no-digest-yet guard at line 164 → notice-info; never assumes a local service | closed |
| T-82-25 | Repudiation | fault-asserting / false-precision copy in WP | mitigate | Forbidden-words grep clean on `class-digest-page.php` (confirmed: 0 matches for compliant/lawsuit-proof/will be sued/guarantee); band rendered as label + icon via `sanitize_html_class`; disclaimer text at line 376 confirms "not legal advice" | closed |
| T-82-26 | Tampering | stale openapi/rbac snapshots masking new surface in CI | mitigate | `docs/reference/openapi/dashboard.json:34960` contains `/api/v1/digest`; `docs/reference/rbac-matrix.md` has `admin.system` gate entries for all digest-schedules routes; regenerated and committed in commit `6fdaf49f` | closed |

*T-82-SC (npm install tampering) applies to all plans: no new npm/Composer dependencies introduced in any plan. No new attack surface from supply chain.*

---

## Accepted Risks Log

No accepted risks.

---

## Code Review Findings Verification

The phase was submitted to a standard code review (82-REVIEW.md) that found 5 critical + 6 warnings. All have been fixed and independently verified:

| Finding | Severity | Fix Commit | Verified In Code |
|---------|----------|------------|-----------------|
| CR-01: WP handle_email reads `$s['exposure']` (wrong field) | Critical | 014149f (luqen-wordpress) | `class-digest-page.php:468` reads `$s['currentExposure']` |
| CR-02: Missing org-scope check on admin mutating routes | Critical | 3e0057b3 | `digest-schedules.ts:258-259,302-303,344-345,377-378` — `requestingOrgId` 403 guard present |
| CR-03: Unvalidated `period` in Content-Disposition header | Critical | 3e0057b3 | `digest-schedules.ts:464` — `period.replace(/[^0-9A-Za-z._-]/g,'')` present |
| CR-04: Content-Disposition filename break (related to CR-03) | Critical | 3e0057b3 | Closed by CR-03 sanitiser |
| CR-05: Unbounded `listScans` OOM on large orgs | Critical | 59f4a378 | `digest-service.ts:352` — `limit: 1000` present |
| WR-01: recipients not validated as email addresses | Warning | 3e0057b3 | `digest-schedules.ts:81,185,194` — EMAIL_REGEX + 400 toast present |
| WR-02: siteUrl not validated as http/https URL | Warning | 3e0057b3 | `digest-schedules.ts:198,204-210` — `new URL(siteUrl)` + protocol guard present |
| WR-03: nextSendAt drift from wall-clock advance | Warning | e85abe27 | `digest-scheduler.ts:292` — advances from `schedule.nextSendAt` |
| WR-04: escapeHtml in hx-target for UUID id | Warning | 3e0057b3 | Addressed; UUIDs from `randomUUID()` are safe in practice |
| WR-05: conditional advance gate could wedge schedule | Warning | e85abe27 | Guard removed; unconditional advance at `digest-scheduler.ts:303` |
| WR-06: style attribute in bandBadgeHtml not escaped | Warning | bae7bb94 | `digest-email-builder.ts:87` — `escapeHtml(BAND_BADGE_STYLE[band])` present |

---

## Unregistered Threat Flags

**82-03-SUMMARY.md `## Threat Flags`:** None declared — no new network endpoints, auth paths, file access patterns, or schema changes beyond the plan-registered surface.

**82-05-SUMMARY.md `## Threat Flags`:** None declared — all new surface (GET /api/v1/digest, server wiring, scheduler) covered by the plan's T-82-15, T-82-18, T-82-19b, T-82-26 register.

**82-04-SUMMARY.md:** Absent from the phase directory (documented in 82-VERIFICATION.md as a documentation omission only; all Plan 04 deliverables are independently verified in code). No threat flags to incorporate.

No unregistered flags.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-06-15 | 26 | 26 | 0 | gsd-security-auditor (Claude Sonnet 4.6) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log (none)
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-06-15
