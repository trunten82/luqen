---
phase: 40
plan: 40-04
subsystem: documentation
tags: [docs, v3.1.0, agent-companion, agent-history, multi-step-tools, streaming, share-links, multi-org]
requires:
  - .planning/phases/35-agent-conversation-history/
  - .planning/phases/36-multi-step-tool-use/36-CONTEXT.md
  - .planning/phases/37-streaming-ux-polish/37-CONTEXT.md
  - .planning/phases/38-multi-org-context-switching/38-CONTEXT.md
provides:
  - docs/guides/agent-history.md
  - docs/guides/multi-step-tools.md
  - docs/guides/streaming-share-links.md
  - docs/guides/multi-org-switching.md
affects:
  - DOC-01 (success criterion #9 — every v3.1.0 surface has a doc page)
tech-stack:
  added: []
  patterns:
    - One file per surface with `## For end users` and `## For admins` audience subsections (D-11)
    - Narrative docs under `docs/guides/` (D-10), reference under `docs/reference/`
    - Cross-link `../reference/rbac-matrix.md` for RBAC traceability (sets up Plan 40-06 README sweep)
key-files:
  created:
    - docs/guides/agent-history.md
    - docs/guides/multi-step-tools.md
    - docs/guides/streaming-share-links.md
    - docs/guides/multi-org-switching.md
  modified: []
decisions:
  - "Each guide is a single file with audience subsections — not split into end-user/admin files (CONTEXT D-11)."
  - "Each guide ends with a `## See also` block linking the other three v3.1.0 guides + rbac-matrix.md, so cross-navigation is symmetric for the README sweep in Plan 40-06."
  - "Forward-reference rbac-matrix.md and agent-companion.md / mcp-integration.md even though they may not exist yet — Plan 40-05/06 will create or update them, and consistent link targets now avoid a follow-up edit pass."
  - "Content sourced strictly from CONTEXT files, SUMMARY artifacts, and VERIFICATION reports for each predecessor phase — no speculative behaviour added."
metrics:
  duration_minutes: ~15
  tasks_completed: 4
  files_created: 4
  files_modified: 0
  commits: 4
completed: 2026-04-25
---

# Phase 40 Plan 40-04: New v3.1.0 feature guides — agent history, multi-step tools, streaming/share, multi-org Summary

## One-liner

Four new dedicated user-facing guides under `docs/guides/` document every v3.1.0
agent surface (Phases 35–38) with a single-file-per-surface, audience-subsection
shape that satisfies DOC-01 success criterion #9 and feeds Plan 40-06's README
sweep with consistent cross-link anchors.

## What shipped

| Guide | Phase | Coverage |
| --- | --- | --- |
| `docs/guides/agent-history.md` | 35 | Stacked history panel, AI-titled rows, debounced search with `<mark>` snippets, infinite-scroll pagination (20/page), resume, three-dot Rename/Delete, soft-delete + audit emission, retention model, RBAC scope, bulk-purge guidance. |
| `docs/guides/multi-step-tools.md` | 36 | Parallel dispatch (`Promise.all`, original-order results), destructive-tool batch gate, chip-strip transparency UI (running / done / error / retried), shared 3-retry budget, `MAX_TOOL_ITERATIONS=5` cap chip, rationale capture across Anthropic/OpenAI/Ollama, `tool_started`/`tool_completed` SSE frames, `/admin/audit` truncated+expandable rationale, RBAC enforcement on every step. |
| `docs/guides/streaming-share-links.md` | 37 | Stop persists partial + `stopped` chip, retry the most-recent assistant turn (supersede via soft-delete pattern), edit-and-resend most-recent user message (new row, not UPDATE), copy markdown source via `navigator.clipboard.writeText` with `<textarea>` fallback, `/agent/share/:shareId` org-scoped permalinks, `agent_share_links` (migration 059) + `expires_at` (migration 060, default 30d), bulk revocation via SQL, Streamable HTTP transport per `CLAUDE.md`. |
| `docs/guides/multi-org-switching.md` | 38 | Native `<select>` switcher in drawer header (admin.system only), force-new-conversation on switch, auto-switch on history open from a different org, "Switched to {org}" 2-second chip, `dashboard_users.active_org_id` (migration 061), default-first-alphabetical, JWT preHandler populates `ToolContext.orgId` (MCP schemas never include `orgId` — `CLAUDE.md` gotcha), audit rows on switch and on denied switches, per-org plugin configs. |

All four guides:

- Begin with a `>` blockquote one-liner.
- Have `## For end users` (task-oriented voice) and `## For admins` (reference voice).
- End with `## See also`, cross-linking the other three v3.1.0 guides and
  `../reference/rbac-matrix.md`.
- Sit under `docs/guides/` (D-10 narrative docs).

## Tasks executed

| Task | Name | Commit | Files |
| --- | --- | --- | --- |
| 1 | docs/guides/agent-history.md (Phase 35) | 304c8e7 | docs/guides/agent-history.md |
| 2 | docs/guides/multi-step-tools.md (Phase 36) | e2672d9 | docs/guides/multi-step-tools.md |
| 3 | docs/guides/streaming-share-links.md (Phase 37) | 4b2a8a7 | docs/guides/streaming-share-links.md |
| 4 | docs/guides/multi-org-switching.md (Phase 38) | 3bee7b9 | docs/guides/multi-org-switching.md |

## Acceptance criteria — all green

For every guide:

- `test -f <path>` → 0
- `grep -q "^## For end users" <path>` → 0
- `grep -q "^## For admins" <path>` → 0
- `grep -q "^## See also" <path>` → 0 (Task 1 explicit; Tasks 2–4 implicit + verified locally)
- `grep -q "rbac-matrix.md" <path>` → 0

Per-task acceptance criteria:

| Plan check | agent-history | multi-step-tools | streaming-share-links | multi-org-switching |
| --- | --- | --- | --- | --- |
| `soft-delete\|soft delete` | passes | — | — | — |
| `parallel dispatch\|parallel-dispatch` | — | passes | — | — |
| `retry budget` | — | passes | — | — |
| `chip strip\|chip-strip` | — | passes | — | — |
| `permalink\|share link` | — | — | passes | — |
| `expires_at\|expiry` | — | — | passes | — |
| `agent_share_links` | — | — | passes | — |
| `org switcher\|org-switcher\|organization switcher` | — | — | — | passes |
| `JWT` | — | — | — | passes |
| `orgId\|org_id` | — | — | — | passes |

Verified by direct `grep -q` execution against each file in the worktree
immediately before SUMMARY creation (see Self-Check section).

## Decisions made

1. **Audience subsections, not split files.** D-11 was explicit; followed without
   discretion: every guide is one `.md` file under `docs/guides/`.
2. **Forward references kept consistent.** `agent-companion.md`,
   `mcp-integration.md`, and `../reference/rbac-matrix.md` are referenced from all
   four guides even though some of those targets land in later 40-XX plans
   (40-05/06). This avoids a sweep-back edit when those plans run and gives
   Plan 40-06's README sweep a stable anchor set.
3. **No speculative content.** Behaviour described in each guide is sourced from
   the predecessor phase's CONTEXT, SUMMARY, and VERIFICATION artifacts. Where a
   feature is explicitly deferred (e.g. dedicated share-link revocation UI,
   bulk-purge UI, admin-configurable iteration cap), the guide says so plainly
   rather than inventing UX.
4. **Cross-linking to multi-org-switching.md from agent-history's See-also.**
   Phase 35's history panel surfaces an org-name chip on each row when global
   admins are scoped multi-org (Phase 38 spec) — flagging the cross-reference
   helps end users find the right doc.
5. **`CLAUDE.md` `orgId` gotcha quoted in multi-org guide.** Custom MCP-client
   integrators are the audience most at risk of trying to override `orgId` in
   tool args; calling out the JWT-preHandler invariant directly in the docs
   prevents support escalations.

## Deviations from plan

**None.** All four tasks executed exactly as written. No Rule 1/2/3 auto-fixes
were required; no Rule 4 architectural deviations were encountered.

## Threat surface scan

No new network endpoints, auth paths, file-access patterns, or schema changes
were introduced — this plan ships only documentation. No threat flags raised.

## Known stubs

None. Every file is a complete, substantive guide with no TODOs, placeholders, or
"coming soon" sections. Forward-references to `agent-companion.md` and
`mcp-integration.md` are explicit cross-links, not stubs of those targets.

## Verification evidence

```
$ for f in docs/guides/agent-history.md docs/guides/multi-step-tools.md \
           docs/guides/streaming-share-links.md docs/guides/multi-org-switching.md; do
    test -f "$f" && echo "OK: $f"
  done
OK: docs/guides/agent-history.md
OK: docs/guides/multi-step-tools.md
OK: docs/guides/streaming-share-links.md
OK: docs/guides/multi-org-switching.md
```

All H2 anchor checks (`## For end users`, `## For admins`, `## See also`) and all
plan-defined per-task `grep` checks ran and returned 0 (success).

## Self-Check: PASSED

- File presence: all 4 files exist at the documented paths in the worktree.
- Commits: 304c8e7, e2672d9, 4b2a8a7, 3bee7b9 — all visible in
  `git log --oneline -5` on `worktree-agent-a2716b67` branch.
- Acceptance grep matrix: every plan-defined check returns 0.
- Cross-links: each `## See also` block references `../reference/rbac-matrix.md`
  plus the other three v3.1.0 guides + `agent-companion.md`.
