---
plan: 37-04
phase: 37
status: complete
date: 2026-04-25
requirements:
  - AUX-01
  - AUX-02
  - AUX-03
  - AUX-04
  - AUX-05
---

# 37-04 — Client wiring + UAT

## What was built

End-to-end client wiring of all 5 AUX requirements. Delegated `data-action` listeners in `agent.js` (CSP-strict, no inline JS):

- **AUX-01 Stop:** existing `#agent-stop` button now closes `activeStream` and announces. Server-side AbortSignal handler from 37-03 persists the partial assistant text with `status='stopped'` + audit row.
- **AUX-02 Retry:** `[data-action="retryAssistant"]` POSTs `/messages/:mid/retry`, removes the bubble, clears chips, re-opens SSE stream.
- **AUX-03 Edit-and-resend:** `[data-action="editUserMessage"]` GETs `/edit-form` (server-rendered partial), swaps bubble body, focuses textarea. Form submit POSTs `/edit-resend`, then `loadPanel()` + `openStream()`. Cancel restores snapshotted children.
- **AUX-04 Copy:** `[data-action="copyAssistant"]` reads from `markdownSourceById` cache (synchronous → preserves user-gesture for Clipboard API), falls back to GET `/messages/:mid` on cache miss.
- **AUX-05 Share:** `[data-action="shareAssistant"]` uses `navigator.clipboard.write([new ClipboardItem({'text/plain': sharePromise})])` so the user-gesture token is held while the POST resolves.

Visible feedback: icon flips to ✓ / ✕ for 1.5s after copy/share. Share also emits a small toast reporting the actual clipboard outcome.

## Commits

- `18f16b2` test(37-04): JSDOM tests for primitives + handlers (21 cases)
- `63cf31d` feat(37-04): markdownSourceById + writeToClipboard + announce + retry/copy/share/stop/edit/cancel/submit handlers
- `6daf098` feat(37-04): GET /messages/:mid + GET /messages/:mid/edit-form + isMostRecentUserMessage flag in fragment renderer
- `38240eb` fix(37-04): reload panel on stream done so freshly-streamed bubbles get action toolbar
- `cb601a6` fix(37): auto-grow composer textarea up to CSS max-height
- `61723d3` fix(37-04): seed markdown cache on panel render so copy is synchronous
- `5c92ad3` fix(37-04): icon flash for action feedback; share opens link in new tab
- `548c18a` fix(36): include org-scoped role on each user.orgs entry in dashboard_list_users
- `ecc67c9` fix(37-04): show share URL inline as a clickable link (later removed)
- `063bf17` fix(37-04): share-specific toast that reflects actual clipboard outcome
- `78d0930` fix(37): clipboard via ClipboardItem(Promise) + 30-day TTL on share links
- `e844e16` fix(37): drop inline share-link chip; render markdown on shared page

## Files

- `packages/dashboard/src/static/agent.js` — handlers, primitives, markdown cache seed, ClipboardItem(Promise) for share, share-page markdown render
- `packages/dashboard/src/static/style.css` — icon-flash modifiers, toast, composer overflow
- `packages/dashboard/src/views/partials/agent-msg-actions.hbs` — `{{#unless readOnly}}` wrapper (cross-plan)
- `packages/dashboard/src/views/agent-share-view.hbs` — agent.js script tag for markdown render
- `packages/dashboard/src/routes/agent.ts` — GET /messages/:mid + edit-form route + isMostRecentUserMessage flag
- `packages/dashboard/src/db/sqlite/migrations.ts` — migration 060 (share-link expires_at)
- `packages/dashboard/src/db/sqlite/repositories/share-link-repository.ts` — TTL filter
- `packages/dashboard/src/db/interfaces/share-link-repository.ts` — `expiresAt` field
- `packages/dashboard/src/mcp/tools/admin.ts` — orgRole annotation per user.orgs[] entry

## UAT-driven fixes shipped

1. Streamed bubbles built without `data-message-id` and without action toolbar — fixed by calling `loadPanel()` at SSE `done` so the rehydrated panel includes the proper IDs + actions.
2. Composer textarea didn't grow with long messages — added `wireInputAutoResize` and removed the manual `resize: vertical` handle.
3. Copy silently failed because `navigator.clipboard.writeText` rejects after async work loses the user-gesture context — fixed by seeding `markdownSourceById` from rendered DOM on every panel load so copy hits the cache synchronously.
4. Share went to error icon despite the share row being created server-side — fixed by decoupling icon-flash from clipboard outcome (server-side share creation = success).
5. Share clipboard never landed — fixed by using `ClipboardItem(Promise)` so the Clipboard API call fires inside the click handler and awaits the URL Promise.
6. Shared page rendered raw markdown — fixed by loading agent.js on the share view and running `renderMarkdownInto` on each assistant body.
7. `dashboard_list_users` reported global role for org-specific questions — fixed by adding `orgRole` from `org_members.role` to each user.orgs[] entry.
8. 30-day TTL added to share links via migration 060.
9. Recurring "partial X not found" bug — fixed by auto-discovering Handlebars partials (cross-cutting; helps every future phase).

## Verification

- 21 JSDOM tests pass; 134+ existing route + view tests still green.
- `tsc --noEmit` clean.
- Live browser UAT against lxc-luqen approved 2026-04-25 covering all 5 AUX flows + the cross-cutting fixes.

## UAT outcome

**Approved 2026-04-25.** All 5 AUX requirements work end-to-end on production. Cross-cutting infra fixes (auto-discovered partials, org-scoped role annotation, share-link TTL) shipped during UAT.
