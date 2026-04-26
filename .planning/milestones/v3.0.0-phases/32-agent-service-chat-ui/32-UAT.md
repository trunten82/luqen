---
status: complete
phase: 32-agent-service-chat-ui
source:
  - 32-01-SUMMARY.md
  - 32-02-SUMMARY.md
  - 32-03-SUMMARY.md
  - 32-04-SUMMARY.md
  - 32-05-SUMMARY.md
  - 32-06-SUMMARY.md
  - 32-07-SUMMARY.md
  - 32-08-SUMMARY.md
started: 2026-04-23T20:24:08Z
updated: 2026-04-23T21:45:00Z
verification_mode: hybrid
verification_note: |
  Autonomous pass + human browser UAT. Tests 1-2, 11-18 verified via unit/integration
  suites (120 green) and visual spot-check. Tests 3-10, 16 human-UATed live on
  lxc-luqen. Found 9 concrete follow-up items — see Gaps section.
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
result: pass (indirect — migration + bootstrap tested)

### 2. Floating Chat Launcher Visible
result: pass

### 3. Drawer Opens and Closes
result: pass (user confirmed: "button visible, click opens chat, X closes it")

### 4. Drawer State Persists Across Navigation
result: pass (after localStorage fix — drawer state + conversationId now survive reload)

### 5. Send Message Streams Response
result: pass (after 5 fixes — see commits between a72c2a6 and 579647c)
notes: End-to-end streaming works. LLM SSE route was never registered (added in abba164), Ollama tool schema required properties:{} and non-empty description (d6c1ce1), tool_calls captured from any chunk (579647c), conversation auto-create on first message (a72c2a6).

### 6. Tool-Call Result Renders
result: issue
reported: "Model calls dashboard_list_reports but replies 'I can only list reports via the dashboard'"
root_cause: ToolDispatcher constructed with tools:[] (server.ts:1001) — every dispatch returns {error:'unknown_tool'}. Model correctly interprets that as "I can't do this". See Gap #2.
severity: blocker

### 7. Destructive Tool Confirmation Dialog
result: blocked
blocked_by: dispatcher-wiring
reason: "Depends on working tool dispatch (Gap #2) to reach the destructive-tool code path."

### 8. Cancel / Esc Denies Safely
result: blocked
blocked_by: dispatcher-wiring

### 9. Reload Mid-Confirmation Recovers Dialog
result: blocked
blocked_by: dispatcher-wiring

### 10. Speech Button Feature-Detect
result: pass (user confirmed: "speech works")

### 11. Admin LLM — Capabilities Tab
result: pass-with-issue
evidence: All expected badges render ("Requires tool-use model", "9 MCP tools exposed", "1 destructive tool requires confirmation"). User reported layout bug — badges overflow their container on the agent-conversation row. See Gap #6.

### 12. Admin LLM — Prompts Tab Locked Fences
result: pass-with-issue
evidence: Three locked fences render with "Global only — per-org override disabled (prompt-injection defence)" pill as specified. Default-text box also overflows its container. See Gap #6.

### 13. Admin LLM — Anthropic Models
result: pass (user confirmed: "Anthropic shown in providers list")

### 14. Org Settings Form — Pre-fill and Save
result: pass-with-issue
evidence: Form works end-to-end. User flagged missing nav entry. See Gap #8.

### 15. Org Settings Form — Validation
result: pass (covered by integration tests + confirmed working)

### 16. Per-Org Display Name Appears in Drawer
result: issue
reported: "Changing name is not directly reflected in chat, name updates after hard refresh"
root_cause: Drawer header is server-rendered once per page load from request.user.orgAgentDisplayName. Save POST does not re-render the layout. See Gap #5.
severity: major

### 17. Rate Limit Returns 429 JSON
result: pass (covered by tests/routes/agent.test.ts Test 4)

### 18. Cross-Org Settings 403
result: pass (covered by tests/routes/admin/organization-settings.test.ts)

## Summary

total: 18
passed: 11
issues: 3  (tests 4-fixed, 6, 16)
blocked: 3 (tests 7, 8, 9 — all blocked on Gap #2)
skipped: 0

## Gaps

### Gap #1 — Global admin cannot chat (blocker)
**Symptom:** `{"error":"no_org_context"}` on POST /agent/message
**Root cause:** Global dashboard admins (admin.system permission, no org membership) have `currentOrgId === undefined`. All 5 /agent/* routes 400 (agent.ts:158/204/278/323/366). Conversation model requires org scoping for isolation.
**Fix direction:** Either introduce a synthetic per-admin namespace (e.g., orgId = `__admin__:${userId}`) or an org-picker UX in the drawer. First option is simpler.
**Severity:** blocker

### Gap #2 — Tool dispatcher has no tools (blocker)
**Symptom:** Model invokes a tool, result stored as `{error:'unknown_tool'}`, model correctly refuses follow-up.
**Root cause:** `agentDispatcher = new ToolDispatcher({ tools: [] })` at server.ts:1001. Code comment says *"handler-bound tools wired in Phase 33 (cross-service path)"* — Phase 32 deliberately left this un-wired.
**Fix direction:** Bridge the dashboard MCP server's `_registeredTools` map into ToolDispatcher's AgentTool shape (handler wrapper that calls the registered callback). Not cross-service — in-process MCP dispatch.
**Severity:** blocker

### Gap #3 — Tool descriptions empty, schemas stubbed (major)
**Symptom:** Tools sent to LLM as `{description:'', parameters:{type:'object'}}`. Model has no context to choose the right tool.
**Root cause:** `buildManifest` in agent-service.ts:413 hard-codes empty description/schema. Rich descriptions (e.g., *"List recent scan reports..."*) live in MCP `registerTool(name, {description, inputSchema})` but never flow through.
**Preparation landed:** commit 7712e8c added an optional `toolCatalog` param to AgentService.
**Fix direction:** Wire the MCP server's `_registeredTools` map into AgentService via the new toolCatalog option.
**Severity:** major — once Gap #2 is fixed this becomes critical for correctness.

### Gap #4 — No "new conversation" / reset control (major)
**Symptom:** Drawer always resumes prior conversation from localStorage. No way to start fresh.
**Fix direction:** Add a "New chat" button in drawer header that clears `luqen.agent.conversationId` in localStorage, empties #agent-messages, and shows empty-state greeting. Optional: keep list of past conversations for switching.
**Severity:** major — UX blocker for real use.

### Gap #5 — Display-name change requires hard refresh to appear in drawer (major)
**Symptom:** Save "Luna" in org settings, drawer header still shows "Luqen Assistant" until full page reload.
**Root cause:** Drawer header is rendered once from `request.user.orgAgentDisplayName` in main.hbs. The form POST only re-renders the form partial, not the layout.
**Fix direction:** Either (a) re-fetch drawer state via client-side on form-save success, or (b) use an HTMX OOB swap to update the drawer header element. Simpler: add a small `<span id="agent-display-name">` to the drawer, have form-save POST return an OOB swap update.
**Severity:** major

### Gap #6 — Capabilities-tab badges overflow container (minor)
**Symptom:** On /admin/llm?tab=capabilities, the agent-conversation row's three badges + iteration-cap copy overflow their box. Same issue on the agent-system prompt default-text panel.
**Fix direction:** CSS — either `flex-wrap: wrap` on the badge row, or a scoped max-width / line-wrap rule on the card content.
**Severity:** cosmetic but visible

### Gap #7 — Markdown in assistant responses rendered as literal text (minor/cosmetic)
**Symptom:** `**bold**`, `- bullet`, `*italic*` show as raw characters in assistant bubbles.
**Root cause:** Token frames are appended via `createTextNode` (XSS-safe, deliberately no HTML).
**Fix direction:** Add a safe minimal markdown-to-HTML renderer on stream completion (not on each token — avoid partial-parse glitches). Strong/em/lists/paragraph breaks only. Use DOM APIs, never innerHTML with untrusted content.
**Severity:** cosmetic

### Gap #8 — Org settings page missing from nav (minor)
**Symptom:** /admin/organizations/:id/settings only reachable via direct URL.
**Fix direction:** Add a nav link or merge into existing org-management page as a tab/section. Simpler: add "Settings" link on the org detail page.
**Severity:** minor

### Gap #9 — Assistant message with tool_calls not persisted as its own row
**Status:** Partially worked around (commit 92cd6cd synthesises the shim from the 'tool' row's toolCallJson when rebuilding the window). A cleaner fix would persist a proper role='assistant' row with `toolCallJson` BEFORE dispatching the tool batch.
**Severity:** minor — current workaround functions, but breaks if multi-turn tool chains interleave unexpectedly.

## Acknowledged Gaps

All 9 gaps recorded above are scoped into Phase 32.1 fix plan.
