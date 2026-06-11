---
phase: 82-scheduled-executive-digest
plan: "03"
subsystem: dashboard/pdf,dashboard/email
tags: [digest, pdf, email, scheduler, multi-channel, conservative-framing, tdd]
dependency_graph:
  requires:
    - digest-service.ts: buildDigest + DigestData/SiteDelta/CriterionDelta (82-02)
    - legal-exposure.ts: DISCLAIMER_TEXT, BAND_ORDINAL, ExposureBand (82-02)
    - notification-service.ts: sendNotification, parseRecipients, EmailAttachment
    - pdf/generator.ts: PDFKit conventions, colour constants, registerFonts pattern
    - email/scheduler.ts: computeNextSendAt, processEmailReport, startEmailScheduler patterns
    - plugins/manager.ts: getActiveInstanceByPackageName for Slack/Teams dispatch
    - digest_schedules table + DigestRepository (82-01)
  provides:
    - pdf/digest-generator.ts: generateDigestPdf + buildDigestPdfAttachment
    - email/digest-email-builder.ts: buildDigestEmailBody
    - email/digest-scheduler.ts: processDigest + startDigestScheduler + computeNextDigestSendAt
  affects:
    - packages/dashboard/src/pdf/digest-generator.ts (new)
    - packages/dashboard/src/email/digest-email-builder.ts (new)
    - packages/dashboard/src/email/digest-scheduler.ts (new)
    - packages/dashboard/tests/pdf/digest-generator.test.ts (new)
    - packages/dashboard/tests/email/digest-scheduler.test.ts (new)
tech_stack:
  added: []
  patterns:
    - PDFKit document creation (A4, registerFonts, Promise-based Buffer collection)
    - Band badge render as filled rect + icon char + label (colour never sole differentiator)
    - Inline-styled HTML email (no external stylesheets, table-based Outlook-safe layout)
    - Interval timer scheduler with .unref() (mirrors email/scheduler.ts exactly)
    - Per-channel try/catch isolation (D-09: channel failure cannot wedge schedule)
    - Minimal adapter object pattern for sendNotification (only orgId read from report arg)
    - Conservative framing: DISCLAIMER_TEXT imported from legal-exposure.ts (single source)
    - Band as icon+label in all surfaces (PDF rect+text, email badge span, Slack/Teams text)
key_files:
  created:
    - packages/dashboard/src/pdf/digest-generator.ts
    - packages/dashboard/src/email/digest-email-builder.ts
    - packages/dashboard/src/email/digest-scheduler.ts
    - packages/dashboard/tests/pdf/digest-generator.test.ts
    - packages/dashboard/tests/email/digest-scheduler.test.ts
  modified: []
decisions:
  - "DISCLAIMER_TEXT imported from legal-exposure.ts verbatim for both PDF and email — single source of truth prevents drift between surfaces (D-06)"
  - "sendNotification report adapter is minimal: { orgId, id } as unknown as EmailReport — sendNotification only reads report.orgId for unsubscribe suppression; recipients passed as explicit 3rd arg; attachments passed as explicit 6th arg"
  - "D-09 implemented via unconditional updateDigestSchedule after channel loop — even when channels throw, the advance always happens; per-channel try/catch with console.error + continue"
  - "storage.digest is typed as optional (storage.digest?) in the StorageAdapter interface — guards added: storage.digest?.getDueDigestSchedules() ?? [] and if (storage.digest !== undefined)"
  - "Slack/Teams send() called with a LuqenEvent-shaped object including type='digest.summary' and renderedBody — the plugin's v1.1.0 path picks up renderedBody as text fallback"
metrics:
  duration: "~20 minutes"
  completed: "2026-06-11"
  tasks_completed: 2
  files_changed: 5
---

# Phase 82 Plan 03: Digest Delivery Layer Summary

**One-liner:** `generateDigestPdf` + `buildDigestEmailBody` + `processDigest` + `startDigestScheduler` deliver the board-ready PDF (PDFKit, no Chromium) and schedule sweep (email/Slack/Teams fan-out with D-09 per-channel isolation) using conservative exposure framing on all surfaces.

## What Was Built

### Task 1: Board-ready PDF generator + inline-styled email body

**`pdf/digest-generator.ts`** exports:
- `generateDigestPdf(data: DigestData, org: { name?; address?; website? }) → Promise<Buffer>`: A4 PDFKit document with four sections:
  - Cover/Identity: org name+address (omitted if not set), "ACCESSIBILITY EXPOSURE DIGEST" eyebrow, period string, scope label
  - What Changed: aggregate totals (errors/warnings/notices + delta), per-criterion top-10 table with DELTA_NEW (#9a3412) / DELTA_FIXED (#15803d) colours
  - What's at Risk: per-site band badge (filled rect + icon char + label) + direction label
  - Disclaimer section: DISCLAIMER_TEXT in light-blue (#eff6ff) block + methodology link + generated timestamp
- `buildDigestPdfAttachment(data, schedule) → Promise<EmailAttachment | null>`: wraps PDF into `{ filename: accessibility-digest-{orgSlug}-{period}.pdf, content: Buffer, contentType: 'application/pdf' }`; returns null on generation error (logged)
- `renderBandBadge(doc, band, x, y)`: internal helper — filled rect with band bg colour, then icon char + label text in band text colour; icon and label ALWAYS present (D-06)

**`email/digest-email-builder.ts`** exports:
- `buildDigestEmailBody(data: DigestData) → string`: inline-styled HTML email body (Surface 3 tokens) including:
  - WHAT CHANGED section: totals delta + top-10 criteria table (delta colours inline)
  - WHAT'S AT RISK section: per-site band badge (colored span) + direction indicator (up to 5 sites)
  - CTA link: "View full digest on dashboard" (CTA button #5a1a18)
  - Disclaimer block: DISCLAIMER_TEXT + methodology link (`/methodology/legal-exposure`)
  - Footer: generated date
  - No `<link>` or `<style>` tags — inline styles only (Outlook-safe)

**Tests: `tests/pdf/digest-generator.test.ts`** (14 tests):
- PDF buffer starts with `%PDF` header; non-empty; works with no org identity
- `buildDigestPdfAttachment`: correct filename pattern + contentType + Buffer content + orgId in filename
- `buildDigestEmailBody`: HTML string; band labels for all sites; DISCLAIMER_TEXT present; forbidden words absent; no bare numeric exposure score; no `<link>` tags; CTA link present; methodology link present

### Task 2: Digest sweep scheduler + multi-channel fan-out

**`email/digest-scheduler.ts`** exports:
- `computeNextDigestSendAt(frequency, fromDate?) → ISO`: +7d weekly, +30d monthly, weekly fallback for unknown — mirrors `scheduler.ts:computeNextSendAt` exactly
- `buildDigestSubject(schedule, period) → string`: conservative subject ("Board Digest — Accessibility Digest: 25 May – 1 Jun 2026") — no "report"/"compliance"
- `processDigest(storage, schedule, pluginManager?) → Promise<void>`:
  1. `buildDigest()` for the period `[lastSentAt ?? createdAt, now]`
  2. Email channel: `parseRecipients(schedule.recipients)` → `buildDigestPdfAttachment` → `buildDigestEmailBody` → `sendNotification(storage, { orgId, id } as unknown as EmailReport, recipients, subject, body, attachments, pluginManager)` — wrapped in try/catch
  3. Slack channel: `getActiveInstanceByPackageName('@luqen/plugin-notify-slack')` → `send({ type: 'digest.summary', data: { text, renderedBody } })` — wrapped in try/catch
  4. Teams channel: same pattern via `'@luqen/plugin-notify-teams'`
  5. **Unconditional** `updateDigestSchedule(id, { lastSentAt: now, nextSendAt })` after channel loop — even on partial failure (D-09)
- `startDigestScheduler(storage, pluginManager?, intervalMs=60000) → NodeJS.Timeout`: `setInterval` with per-schedule try/catch + `timer.unref()` (don't block process exit)

**Tests: `tests/email/digest-scheduler.test.ts`** (11 tests):
- `computeNextDigestSendAt`: weekly/monthly arithmetic, unknown fallback, no-arg date
- D-09 no-wedge: `updateDigestSchedule` IS called even when Slack `send()` throws; call includes advanced `nextSendAt` and set `lastSentAt`
- Email channel: `sendNotification` called with `recipients` as 3rd arg (derived from `parseRecipients`)
- Email attachments: 6th arg is an array
- Slack-only schedule: plugin `send()` called once
- Channel not in `schedule.channels`: not dispatched (Slack not called when only `['email']`)
- Teams channel: dispatched when in `schedule.channels`
- `startDigestScheduler`: returns a `NodeJS.Timeout`

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1    | 2b48d40e | feat(82-03): board-ready PDF generator + inline-styled email body (DIGEST-04) |
| 2    | 5f186ed6 | feat(82-03): digest sweep scheduler + multi-channel fan-out (DIGEST-03) |

## Verification

- `npx tsc --noEmit`: CLEAN (0 errors)
- `npx vitest run tests/pdf/digest-generator.test.ts`: 14/14 passed
- `npx vitest run tests/email/digest-scheduler.test.ts`: 11/11 passed
- `grep "export async function generateDigestPdf"` digest-generator.ts: line 156 — FOUND
- `grep "buildDigestPdfAttachment"` digest-generator.ts: line 437 — FOUND
- `grep "import PDFDocument from 'pdfkit'"` digest-generator.ts: line 14 — FOUND
- `grep "DISCLAIMER_TEXT"` digest-generator.ts: import + usage — FOUND
- `grep "buildDigestEmailBody"` digest-email-builder.ts: line 124 — FOUND
- `grep -c '<link'` digest-email-builder.ts: 0 — CONFIRMED
- `grep "export function startDigestScheduler"` digest-scheduler.ts: line 293 — FOUND
- `grep "export async function processDigest"` digest-scheduler.ts: line 179 — FOUND
- `grep ".unref()"` digest-scheduler.ts: line 321 — FOUND
- `grep "as unknown as EmailReport"` digest-scheduler.ts: line 215 — FOUND
- `grep "parseRecipients(schedule.recipients)"` digest-scheduler.ts: line 201 — FOUND
- Forbidden words grep on all 3 new source files: CLEAN (0 matches)

## Deviations from Plan

### Auto-fix: storage.digest optional guard (Rule 3 — Blocking Issue)

TypeScript reported `storage.digest` is possibly `undefined` at the `updateDigestSchedule` call and the `getDueDigestSchedules` call in `startDigestScheduler`. The `StorageAdapter` interface declares `digest?` as optional. Fixed by adding:
- `storage.digest?.getDueDigestSchedules() ?? []` in the scheduler interval
- `if (storage.digest !== undefined)` guard before `updateDigestSchedule`

These are correctness fixes, not API changes.

Otherwise — plan executed exactly as written.

## Threat Model Coverage

| Threat ID | Mitigation Applied |
|-----------|--------------------|
| T-82-09 | Per-channel try/catch + unconditional nextSendAt/lastSentAt advance after loop; timer.unref(); per-schedule try/catch in sweep |
| T-82-10 | `buildDigest` scoped to schedule.orgId/siteUrl from the schedule row; no cross-org leakage |
| T-82-11 | DISCLAIMER_TEXT imported from single source; band label+icon never a number; forbidden-words source greps clean; email-body test assertions confirm |
| T-82-12 | PDFKit renders plain strings via `.text()` — no HTML/markup execution; no Chromium |
| T-82-13 | Slack/Teams messages use `{icon}{band}` + direction label only; disclaimer line in every message (D-08/D-12) |
| T-82-SC | No new npm dependencies — reuses pdfkit (existing), notify plugins (existing), notification-service (existing) |

## Known Stubs

None — all three new files are fully wired implementations. No hardcoded empty collections flow to rendering surfaces. `buildDigest` from Plan 02 is a real computation.

## Threat Flags

None. No new network endpoints, auth paths, file access patterns, or schema changes introduced. The PDF and email delivery paths reuse existing infrastructure (PDFKit fonts already in repo, sendNotification already exists, notify plugins already registered).

## Self-Check: PASSED

- `packages/dashboard/src/pdf/digest-generator.ts` — FOUND
- `packages/dashboard/src/email/digest-email-builder.ts` — FOUND
- `packages/dashboard/src/email/digest-scheduler.ts` — FOUND
- `packages/dashboard/tests/pdf/digest-generator.test.ts` — FOUND
- `packages/dashboard/tests/email/digest-scheduler.test.ts` — FOUND
- Commit 2b48d40e — FOUND (git log)
- Commit 5f186ed6 — FOUND (git log)
