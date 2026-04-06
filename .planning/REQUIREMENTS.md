# Requirements: Luqen v2.9.0 — Branding Completeness & Org Isolation

**Defined:** 2026-04-06
**Core Value:** AI-powered accessibility compliance that adapts to each organization's jurisdiction, regulation, and brand context — with admins in control through the dashboard, not config files.

## v2.9.0 Requirements

### Branding Retag

- [x] **BRT-01**: When a branding guideline is created or updated, existing completed scans for assigned sites are automatically retagged with the new/updated guideline
- [x] **BRT-02**: Retag processes stored JSON reports without re-scanning — updates brand-related tags and counts in place

### Branding Service Tests

- [x] **BST-01**: Integration tests cover the full branding pipeline using real Aperol brand data against aperol.com scan results
- [x] **BST-02**: E2E test: create guideline → assign to site → scan → verify brand enrichment produces correct tags

### Auto-Link Site on Discover

- [x] **ALD-01**: When discover-branding creates/updates a guideline, the scanned site URL is automatically linked to the guideline (default ON, opt-out checkbox)
- [x] **ALD-02**: If the site already has a different guideline linked, user is prompted before overwriting

### CSS Import

- [x] **CSS-01**: User can upload a CSS file on the branding guideline page to extract brand colors (custom properties, hex values) and fonts (font-family declarations)
- [x] **CSS-02**: Extracted values populate the guideline's colors and fonts alongside existing manual/JSON/CSV import methods

### Org API Keys

- [x] **OAK-01**: Org admins can create and revoke API keys scoped to their organization
- [x] **OAK-02**: Org-scoped API keys access only that org's data (scans, reports, trends)
- [x] **OAK-03**: Global admin keys retain cross-org access via X-Org-Id header
- [x] **OAK-04**: Key management UI in org settings with rate limits per key

### LLM Per-Org OAuth

- [x] **LLM-01**: Migration adds `llm_client_id` and `llm_client_secret` columns to the organizations table
- [x] **LLM-02**: On new org creation, a per-org LLM OAuth client (`dashboard-{slug}`) is auto-created and stored
- [ ] **LLM-03**: LLM call routing uses per-org credentials when available, falls back to system client
- [ ] **LLM-04**: CLI command to backfill existing orgs with per-org LLM clients

### E2E Testing

- [ ] **E2E-01**: E2E tests cover the branding retag pipeline: create guideline → assign site → scan → retag → verify updated brand counts on live data
- [ ] **E2E-02**: E2E tests cover org API key lifecycle: create key → use key to scan → verify scoped access → revoke → verify revocation
- [ ] **E2E-03**: E2E tests cover the system brand guideline flow from org perspective: link system guideline → scan from org → verify guideline resolves → clone → verify independence

### Documentation

- [ ] **DOC-01**: README includes a "Built on" section linking all upstream components (pa11y, Fastify, HTMX, better-sqlite3, Ollama, etc.) grouped by role

## Future Requirements

### v3.0.0 — Agent Companion & MCP

- All services exposed as MCP servers (compliance, branding, LLM, scanner, dashboard)
- In-dashboard AI agent companion (text + speech, org-aware, RBAC-gated)
- Orchestrator dual-mode (embedded/service) for decoupled deployment
- Brand accessibility score (0-100 per guideline, trend tracking)
- Automated branding client (crawl + propose draft guideline)

## Out of Scope

- Multimodal image analysis for logo detection — defer to future
- Real-time streaming LLM responses — batch responses sufficient
- Custom model fine-tuning — use prompt engineering instead
- Regulation-first rework — additive filter is sufficient
- Multi-tenant brand hierarchy beyond system/org — link/clone is sufficient

## Traceability

| REQ-ID | Phase | Plan | Status |
|--------|-------|------|--------|
| BRT-01 | Phase 09 | — | Pending |
| BRT-02 | Phase 09 | — | Pending |
| BST-01 | Phase 09 | — | Pending |
| BST-02 | Phase 09 | — | Pending |
| ALD-01 | Phase 09 | — | Pending |
| ALD-02 | Phase 09 | — | Pending |
| CSS-01 | Phase 10 | — | Pending |
| CSS-02 | Phase 10 | — | Pending |
| OAK-01 | Phase 10 | — | Pending |
| OAK-02 | Phase 10 | — | Pending |
| OAK-03 | Phase 10 | — | Pending |
| OAK-04 | Phase 10 | — | Pending |
| LLM-01 | Phase 11 | — | Pending |
| LLM-02 | Phase 11 | — | Pending |
| LLM-03 | Phase 11 | — | Pending |
| LLM-04 | Phase 11 | — | Pending |
| E2E-01 | Phase 12 | — | Pending |
| E2E-02 | Phase 12 | — | Pending |
| E2E-03 | Phase 12 | — | Pending |
| DOC-01 | Phase 12 | — | Pending |
