# Milestone v3.1.0 — Agent Companion v2 + Tech Debt & Docs

**Goal:** Harden v3.0.0's MCP + agent foundation with precise instrumentation, complete the agent companion experience (history, multi-step tool use, polish, org switching), and refresh all documentation.

## Active Requirements

### Agent History (AHIST)

- [x] **AHIST-01**: User can list past agent conversations from the side drawer (paginated, newest first, with title + timestamp + message count)
- [x] **AHIST-02**: User can search past conversations by free-text query against message content (case-insensitive, scoped to user + org)
- [x] **AHIST-03**: User can resume any past conversation — full message history loaded, new turns append to the same conversation_id
- [x] **AHIST-04**: User can delete a past conversation (soft delete, audit-logged) and start a new one from scratch
- [x] **AHIST-05**: Conversation list and search are keyboard-accessible and screen-reader friendly (WCAG 2.2 AA)

### Agent Multi-Step Tool Use (ATOOL)

- [x] **ATOOL-01**: Agent can issue parallel tool calls within a single turn when the model returns multiple tool_use blocks
- [x] **ATOOL-02**: Agent recovers from tool errors automatically — failed tool returns surface to the model with retry guidance, up to a per-turn budget
- [x] **ATOOL-03**: Agent supports multi-step planning — model can chain tool calls across iterations within a single user turn (capped by max_iterations)
- [x] **ATOOL-04**: Tool selection is logged with model rationale + outcome so admins can audit why a tool fired

### Agent Streaming/UX Polish (AUX)

- [x] **AUX-01**: User can interrupt an in-flight streaming response (stop button cancels SSE + persists partial response)
- [x] **AUX-02**: User can retry the last assistant turn (re-runs against the same conversation state)
- [x] **AUX-03**: User can edit-and-resend their own message — branches the conversation, prior assistant reply is marked superseded
- [x] **AUX-04**: User can copy any assistant message to clipboard with one click (full markdown source, not rendered HTML)
- [x] **AUX-05**: User can share an assistant message via a permalink to an audit-viewable conversation snapshot

### Agent Multi-Org Context (AORG)

- [x] **AORG-01**: Global admin (`admin.system`) can switch the agent's active org context inside the side drawer without re-login
- [x] **AORG-02**: Switching org rebinds tool dispatch + context-hints to the new org for all subsequent turns; prior turns remain attributed to their original org
- [x] **AORG-03**: Active org is visible in the drawer header and persisted per-user across sessions
- [x] **AORG-04**: Non-global users see no org switcher (UI hidden, server-side denies any switch attempt with 403)

### Tokenizer Precision (TOK)

- [x] **TOK-01**: Replace `char/4` heuristic with a precise tokenizer for Ollama, OpenAI, and Anthropic models (per-provider implementation)
- [x] **TOK-02**: Tokenizer adds no heavy native dependencies (lightweight pure-JS or wasm, total bundle impact under 5 MB)
- [x] **TOK-03**: 85% compaction threshold triggers using precise counts; existing compaction behavior remains observable (no UX regression)
- [x] **TOK-04**: Token estimator exposes a single `countTokens(messages, model)` interface with per-model BPE/tiktoken backing
- [x] **TOK-05**: Tokenizer choice falls back gracefully to `char/4` if a model is unknown, with a warning log

### Verification & Validation Backfill (VER)

- [x] **VER-01**: Formal VERIFICATION.md backfilled for Phase 30.1, 31.2, 32, 32.1, 33 (covers SC checklist + UAT outcomes + observed gaps)
- [x] **VER-02**: Nyquist validation run for v3.0.0 phases — produce coverage report identifying any untested success criteria
- [x] **VER-03**: Deferred-items.md from Phase 31.2 + Phase 32 triaged — each item closed (won't fix), promoted to v3.1.0 plan, or deferred to v3.2.0 with rationale

### Documentation Sweep (DOC)

- [ ] **DOC-01**: Top-level README updated to reflect v3.0.0 + v3.1.0 surface (MCP, agent companion, OAuth 2.1, agent history)
- [ ] **DOC-02**: Swagger/OpenAPI specs current for all services (compliance, branding, llm, dashboard, MCP endpoints)
- [ ] **DOC-03**: Installer docs updated (new env vars, new admin pages, new RBAC permissions)
- [ ] **DOC-04**: MCP integration guide published (Claude Desktop + IDE + custom client setup, OAuth 2.1 + PKCE + DCR walkthrough)
- [ ] **DOC-05**: Agent companion user guide published (chat usage, tools, history, org switching, speech input)
- [ ] **DOC-06**: Prompt-template authoring guide updated (locked sections, fence markers, validator, override workflow)
- [ ] **DOC-07**: RBAC matrix documented end-to-end (every permission × every page/route/MCP tool)

## Future Requirements (Deferred)

- Token-cost dashboard per org/user (LLM usage tracking + budgets) — v3.2.0
- Agent voice output (text-to-speech) — v3.2.0
- Conversation export (JSON/PDF) — v3.2.0
- Per-user agent preferences (model, temperature, default tools) — v3.2.0

## Out of Scope (v3.1.0)

- Multimodal image input to agent — defer
- Custom agent personas / system prompt overrides per user — defer
- Real-time multi-user collaborative agent sessions — not a use case
- Migration from existing tokenizer to new tokenizer for already-stored conversations — new conversations only; existing rows unchanged

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| TOK-01 | Phase 34 | Complete |
| TOK-02 | Phase 34 | Complete |
| TOK-03 | Phase 34 | Complete |
| TOK-04 | Phase 34 | Complete |
| TOK-05 | Phase 34 | Complete |
| AHIST-01 | Phase 35 | Complete |
| AHIST-02 | Phase 35 | Complete |
| AHIST-03 | Phase 35 | Complete |
| AHIST-04 | Phase 35 | Complete |
| AHIST-05 | Phase 35 | Complete |
| ATOOL-01 | Phase 36 | Complete |
| ATOOL-02 | Phase 36 | Complete |
| ATOOL-03 | Phase 36 | Complete |
| ATOOL-04 | Phase 36 | Complete |
| AUX-01 | Phase 37 | Complete |
| AUX-02 | Phase 37 | Complete |
| AUX-03 | Phase 37 | Complete |
| AUX-04 | Phase 37 | Complete |
| AUX-05 | Phase 37 | Complete |
| AORG-01 | Phase 38 | Complete |
| AORG-02 | Phase 38 | Complete |
| AORG-03 | Phase 38 | Complete |
| AORG-04 | Phase 38 | Complete |
| VER-01 | Phase 39 | Complete |
| VER-02 | Phase 39 | Complete |
| VER-03 | Phase 39 | Complete |
| DOC-01 | Phase 40 | Pending |
| DOC-02 | Phase 40 | Pending |
| DOC-03 | Phase 40 | Pending |
| DOC-04 | Phase 40 | Pending |
| DOC-05 | Phase 40 | Pending |
| DOC-06 | Phase 40 | Pending |
| DOC-07 | Phase 40 | Pending |

**Coverage: 33/33 requirements mapped to exactly one phase.**
