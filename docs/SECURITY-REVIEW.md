# Security Review — pally-agent monorepo

**Date:** 2026-03-20
**Scope:** packages/core, packages/compliance, packages/dashboard, packages/monitor
**Reviewer:** automated (claude-sonnet-4-6)

---

## Summary

One HIGH severity issue was found and **fixed in this commit** (private key committed to git).
One LOW severity issue was fixed (GET logout endpoint). No critical issues found.
Three HIGH npm audit findings in `bcrypt` are documented below with recommended action.

---

## Checks Performed

| Check | Result |
|-------|--------|
| Hardcoded secrets in source | PASS — none found |
| Private key committed to git | **FIXED** — removed from tracking, added to .gitignore |
| Input validation on REST endpoints | PASS — manual validation in all route handlers |
| SQL injection (SQLite/PG) | PASS — all queries use prepared statements / parameterized placeholders |
| XSS — Handlebars triple-stache | PASS — only `{{{body}}}` in layout (framework-controlled, not user input) |
| CSRF — state changes via GET | **FIXED** — GET /logout removed; sidebar now uses POST form |
| Auth middleware coverage | PASS — global `preHandler` hook on both services |
| JWT algorithm | PASS — RS256 (asymmetric) used in compliance service |
| Session cookies | PASS — httpOnly, sameSite:strict, AES-256-GCM encrypted |
| Rate limiting | PASS — `@fastify/rate-limit` configured on compliance service |
| npm audit | SEE BELOW |

---

## Findings

### FIXED — HIGH: Private RSA key committed to git

**Package:** `packages/compliance`
**Files:** `packages/compliance/keys/private.pem`, `packages/compliance/keys/public.pem`

The RS256 private key used to sign JWT access tokens was committed to the git repository. Any actor with repository read access could forge arbitrary tokens and gain full API access to the compliance service.

**Fix applied in this commit:**
- Removed both files from git tracking with `git rm --cached`
- Added `packages/compliance/keys/` to `.gitignore`
- Added `packages/compliance/*.db*` to `.gitignore`

**Required follow-up action:**
Because the key was committed, it must be considered compromised. Rotate the key pair:
```bash
cd packages/compliance
node dist/cli.js keys generate
```
Then update any deployed clients that hold the public key.

---

### FIXED — LOW: GET /logout (CSRF best-practice violation)

**Package:** `packages/dashboard`
**File:** `packages/dashboard/src/routes/auth.ts`

The `GET /logout` route deleted the session on a plain HTTP GET, which is a CSRF anti-pattern per OWASP session management guidelines (A07:2021). Although the `sameSite: strict` cookie setting already prevents cross-site CSRF, GET-based logout is a well-known insecure pattern.

**Fix applied:** Removed `server.get('/logout', ...)` and updated the sidebar to use a `<form method="POST" action="/logout">` button.

---

### INFORMATIONAL — MEDIUM: JWT decoded without signature verification in dashboard auth middleware

**Package:** `packages/dashboard`
**File:** `packages/dashboard/src/auth/middleware.ts`

`decodeJwt` (from `jose`) decodes the JWT payload without verifying the RS256 signature. This is acceptable in context because:

1. The token is stored inside an AES-256-GCM encrypted `@fastify/secure-session` session cookie, which cannot be read or tampered with by the client.
2. The token was verified by the compliance service at login time (via `POST /api/v1/oauth/token`).
3. Expiry is checked locally before any privileged operation.

**Recommendation:** For defence-in-depth, consider verifying the JWT signature in the dashboard middleware using the compliance service's public key (`DASHBOARD_COMPLIANCE_JWT_PUBLIC_KEY` env var). This would prevent privilege escalation if the session encryption key were somehow compromised.

---

### RESOLVED — HIGH (npm audit): bcrypt depends on vulnerable node-tar

**Packages:** `packages/compliance`
**Severity:** 3× HIGH
**Advisory:** GHSA-34x7-hfp2-rc4v, GHSA-8qq5-rm4j-mr97, GHSA-83g3-92jg-28cx, GHSA-qffp-2rhf-9h96, GHSA-9ppj-qmqm-q256, GHSA-r6q2-hw4h-h46w

`bcrypt@5.1.1` depends on `@mapbox/node-pre-gyp` which depends on `tar <= 7.5.10` — a native addon build-time dependency with multiple path traversal vulnerabilities in the `tar` archive extraction library.

**Impact assessment:** The vulnerable `tar` code is only exercised when installing or building the `bcrypt` native addon (i.e., `npm install` time). It is **not present in the production `dist/` bundle** that gets deployed. The risk is limited to the build environment.

**Recommended action:**
```bash
cd packages/compliance
npm audit fix --force   # upgrades bcrypt to v6.0.0
```
bcrypt v6 changes the default export to a named export. Update imports:
```typescript
// Before (bcrypt v5)
import bcrypt from 'bcrypt';

// After (bcrypt v6)
import { hash, compare } from 'bcrypt';
```
**RESOLVED:** bcrypt has been upgraded to v6.x. The vulnerable `tar` transitive dependency is no longer present.

---

## Recommendations (not fixed in this commit)

1. **Rotate the RS256 key pair** immediately (see FIXED finding above).
2. **Upgrade bcrypt to v6** and update import style in `src/db/sqlite-adapter.ts`, `postgres-adapter.ts`, `mongodb-adapter.ts`, and `src/auth/oauth.ts`.
3. **Add JWT signature verification** to the dashboard middleware as a defence-in-depth measure.
4. **Add `secure: true`** to the session cookie when running behind HTTPS in production (currently not set, which means it also works over HTTP in development — acceptable, but production deployments should add `HTTPS`-aware config).
5. **Pin or restrict** `COMPLIANCE_CORS_ORIGIN` to specific origins in production; the default `['http://localhost:3000']` is safe for development but should be overridden via env var in deployments.

---

## v0.11.0 Security Review

**Date:** 2026-03-21
**Scope:** packages/dashboard (report redesign, scan form changes)
**Reviewer:** automated (claude-opus-4-6)

### Summary

Seven security issues were identified and fixed as part of the v0.11.0 report redesign release. All were addressed before merge. No critical issues remain.

### Findings and Fixes

#### FIXED — HIGH: Protocol validation on siteUrl

**Package:** `packages/dashboard`

The scan form accepted arbitrary URL schemes in the `siteUrl` field, which could allow `file://`, `javascript:`, or other dangerous protocols to be passed to the scanner.

**Fix:** Added protocol validation to reject any URL that does not use `http` or `https`. Invalid protocols return a 400 error with a descriptive message.

#### FIXED — HIGH: Open redirect in SSE reportUrl

**Package:** `packages/dashboard`

The SSE `complete` event included a `reportUrl` that was constructed from user-controlled input without validation. An attacker could craft a scan that redirected the browser to an external URL on completion.

**Fix:** The reportUrl is now constructed using only the internal report ID and a fixed path prefix (`/reports/:id/view`), preventing any external redirect.

#### FIXED — MEDIUM: Rate limiting on POST /scan/new

**Package:** `packages/dashboard`

The scan endpoint had no rate limiting, allowing an authenticated user to launch unlimited concurrent scans and exhaust server resources.

**Fix:** Added `@fastify/rate-limit` to the `POST /scan/new` endpoint, limiting scan creation requests per user within a time window.

#### FIXED — MEDIUM: Jurisdictions array length limit

**Package:** `packages/dashboard`

The scan form accepted an unbounded array of jurisdiction IDs, which could lead to excessive compliance API calls and memory consumption during report enrichment.

**Fix:** Added a maximum length limit of 50 jurisdictions per scan request. Requests exceeding this limit are rejected with a 400 error.

#### FIXED — LOW: Query limit parameter clamping

**Package:** `packages/dashboard`

The reports list endpoint accepted arbitrary values for the `limit` query parameter, allowing a client to request all records in a single response or use negative values.

**Fix:** The `limit` parameter is now clamped to the range 1–100. Values outside this range are silently adjusted to the nearest bound.

#### FIXED — LOW: Compliance body limit increase to 10MB

**Package:** `packages/dashboard`

The compliance enrichment endpoint needed a larger body limit to handle reports with many issues and jurisdiction combinations. The default Fastify body limit (1MB) caused enrichment failures on large sites.

**Fix:** Increased the body limit to 10MB for the compliance enrichment route only. **Trade-off:** This increases the maximum memory per request. The risk is mitigated by the existing `maxConcurrentScans` limit and authentication requirement — only authenticated users can trigger enrichment, and the number of concurrent scans is bounded.

#### FIXED — LOW: annotatedIssues regulation merge fix (data integrity)

**Package:** `packages/dashboard`

When multiple jurisdictions mapped to the same WCAG criterion, the regulation merge logic could overwrite regulation tags from a previously processed jurisdiction instead of merging them. This was a data integrity issue rather than a direct security vulnerability, but it could cause compliance reports to understate regulatory coverage.

**Fix:** The regulation merge now correctly accumulates regulation tags across all matching jurisdictions using a Set-based deduplication approach, ensuring no regulation data is lost during enrichment.
