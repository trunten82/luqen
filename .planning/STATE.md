---
gsd_state_version: 1.0
milestone: v3.5.0
milestone_name: Anti-overlay wedge — dev + exec first wave
status: milestone_complete
stopped_at: Milestone complete (Phase 82 was final phase)
last_updated: 2026-06-11T20:18:16.430Z
last_activity: 2026-06-11 -- Phase 82 execution started
progress:
  total_phases: 5
  completed_phases: 3
  total_plans: 16
  completed_plans: 79
  percent: 60
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-07 — v3.5.0 redefined: Anti-overlay wedge)

**Core value:** AI-powered accessibility compliance that adapts to each organization's jurisdiction, regulation, and brand context — with admins in control through the dashboard, not config files.
**Current focus:** Milestone complete

## Current Position

Phase: 82
Plan: Not started
Status: Milestone complete
Last activity: 2026-06-11

## Phase Map (v3.5.0 — Anti-overlay wedge)

| # | Phase | Track | Requirements | Depends on |
|---|-------|-------|--------------|------------|
| 78 | Anti-overlay positioning | Cross-repo (WP readme + platform) | POS-01..03 | — (DONE 2026-06-01) |
| 79 | CI regression gate | Cross-repo (`luqen` core CLI/Action + `luqen-wordpress` publish gate) | CIGATE-01..05 | 78 (cadence; functionally independent — dev track A) |
| 80 | MCP fix tools for coding agents | Cross-repo (`luqen` core MCP + llm + `luqen-wordpress` WP-block fixes) | MCPFIX-01..05 | 78 (cadence; independent — dev track B, parallel with 79) |
| 81 | Jurisdiction legal-exposure scoring (FLAGSHIP) | Cross-repo (`luqen` exposure model + dashboard + fleet view + `luqen-wordpress` per-site) | EXPO-01..05 | 78; precedes 82 (produces the exposure trend 82 reports) |
| 82 | Scheduled executive digest | Cross-repo (`luqen` scheduler + notify + board PDF + `luqen-wordpress` per-site digest) | DIGEST-01..05 | 81 (reports the exposure trend) |

**Parallelism:** Phases 79 (CI gate) and 80 (MCP fix tools) are independent developer tracks — run concurrently after 78. Phase 81 (flagship exposure scoring) MUST precede Phase 82 (digest reports the exposure trend). Every phase is cross-repo: `luqen` + `luqen-wordpress` (v0.32.0), WordPress-leaned SMB surface.

## Accumulated Context

### Roadmap Evolution

- 2026-05-29: original v3.5.0 roadmap (monetization: phases 78-82 GATE/CREDIT/AGENCY/PRICE) created, then shipped direct-to-master — but the monetization spine was REVERSED by the single-product decision ([[project_single_tier_decision]]). Only Phase 78 (anti-overlay positioning) survived.
- 2026-06-07: **v3.5.0 redefined** as "Anti-overlay wedge — dev + exec first wave". Roadmap recreated: Phase 78 (shipped) preserved; new phases 79-82 (CIGATE / MCPFIX / EXPO / DIGEST) replace the retired monetization phases — same numbers, entirely new concepts. 20/20 requirements mapped, no orphans, coarse granularity (4 feature tracks → 4 phases). Key sequencing: developer tracks 79+80 are independent and parallelizable; EXPO (81, flagship) sequences before DIGEST (82) because the digest reports the exposure trend EXPO produces.

### Decisions (v3.5.0 — Anti-overlay wedge)

- **Conservative-by-default is a hard product constraint** — NO surface (CLI, PR comment, MCP fix, exposure indicator, digest, PDF) may emit "compliant" / "100%" / "lawsuit-proof". Exposure-indication + good-faith remediation + transparency framing only ("not legal advice").
- **Single product, no gates** — the Free/Pro/Agency surfaces are dormant; do NOT build on or extend them. No credits, no plan model, no billing.
- **Reuse existing infrastructure** — CI gate on `@luqen/core` CLI + multi-engine scan; MCP tools on the existing `@luqen/core` MCP server + `generate-fix` capability + jurisdiction legal-framings service; digest on existing notify plugins (email/Slack/Teams) + report/fleet PDF pipelines + WP company-info.
- **MCP fix tools never auto-apply** — human-supervised; they return review-and-merge drafts (the anti-overlay posture).
- **WordPress-leaned throughout** — the WP SMB segment (mis-sold overlays, getting sued) is the beachhead; each phase surfaces in the `luqen-wordpress` plugin (v0.32.0).
- `luqen` and `luqen-wordpress` are SEPARATE repos with SEPARATE CI; WP tests run via wp-test lxc + Playwright.

### Constraints (v3.5.0)

- Tech stack: TypeScript, Fastify, existing patterns — no new frameworks
- Auth: OAuth2 client credentials (RS256 JWT) — same across all services; MCP enforces JWT + RBAC + `mcp.use` org scoping
- All capabilities degrade gracefully when LLM/scan unavailable — conservative output on degrade, never assert "compliant"
- Must integrate with compliance/branding/llm without breaking changes
- No external billing / payment processing / monetization

### Known Gotchas (carried forward)

- **HTMX OOB inside `<tr>`**: wrap in `<template>` tags
- **HTMX 2.0 `hx-select` inheritance**: use plain JS `EventSource` for streaming
- **`@fastify/rate-limit` 429 bypass**: add `onSend` hook
- **All Luqen services use `/api/v1/*` prefix** — bare `/oauth/token` or `/health` returns misleading 401
- **Fastify rejects empty JSON body** — always send `{}` on bodyless POSTs
- **New services/surfaces must appear in ALL shared admin sections** (health, clients, sidebar)
- **Cross-service auth**: OAuth2 client credentials only, never raw API keys
- **Excel-only exports (no CSV)** — use `buildXlsx()`
- **WP plugin must not assume a local service** — remote Luqen endpoints are the norm; gate on a configured connection, degrade silently
- **UI phases need human UAT** — automated checks miss cross-persona / mobile / URL edge cases
- **Live tracks master, not develop** — push to master before deploy; no CI on lxc-luqen, deploy via explicit ssh

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260601-fte | Manual-test evidence artifacts (screenshots/documents) in the VPAT/ACR report (web + PDF) | 2026-06-01 | 1304877 | [260601-fte-vpat-evidence-artifacts](./quick/260601-fte-vpat-evidence-artifacts/) |
| 260601-njq | Per-org legal/company identity on VPAT/ACR reports (web + PDF + share); migration 082, optional StorageAdapter field | 2026-06-01 | c3cc788 | [260601-njq-vpat-org-legal-identity](./quick/260601-njq-vpat-org-legal-identity/) |

## Session Continuity

Last session: 2026-06-11T17:24:42.183Z
Stopped at: Phase 82 UI-SPEC approved
Resume file: .planning/phases/82-scheduled-executive-digest/82-UI-SPEC.md
Next action: `/gsd:plan-phase 79` (CI regression gate) — or plan 79 and 80 in parallel (independent developer tracks)
