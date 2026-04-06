# Roadmap: Luqen

## Milestones

- ✅ **v2.8.0 Admin UX & Compliance Precision** — Phases 06-08 (shipped 2026-04-06) — [archived](milestones/v2.8.0-ROADMAP.md)
- 🚧 **v2.9.0 Branding Completeness & Org Isolation** — Phases 09-12 (in progress)

## Phases

- [x] **Phase 09: Branding Pipeline Completion** - Retag scans on guideline changes, auto-link sites on discover, branding service integration tests (completed 2026-04-06)
- [x] **Phase 10: CSS Import & Org API Keys** - CSS file import for brand guidelines and org-scoped API key management (completed 2026-04-06)
- [x] **Phase 11: LLM Per-Org OAuth** - Per-org LLM OAuth client parity with compliance/branding services (completed 2026-04-06)
- [ ] **Phase 12: E2E Testing & Documentation** - Cross-feature E2E validation and upstream component documentation

## Phase Details

### Phase 09: Branding Pipeline Completion
**Goal**: Branding guidelines drive automatic scan enrichment end-to-end — from discovery through retag to verification
**Depends on**: Phase 08 (system brand guideline infrastructure from v2.8.0)
**Requirements**: BRT-01, BRT-02, ALD-01, ALD-02, BST-01, BST-02
**Success Criteria** (what must be TRUE):
  1. When a branding guideline is created or updated, existing completed scans for assigned sites show updated brand tags without re-scanning
  2. When discover-branding runs, the scanned site URL is automatically linked to the resulting guideline (with opt-out available)
  3. If a site already has a different guideline linked, the user is notified via toast after the reassignment (overwrite-don't-block per design decision)
  4. Integration tests prove the full branding pipeline (create guideline, assign site, scan, verify brand enrichment) against real Aperol data
**Plans:** 4/4 plans complete

Plans:
- [x] 09-01-PLAN.md — Retag completeness: add retag after discover-branding
- [x] 09-02-PLAN.md — Auto-link site on discover + UI checkbox
- [x] 09-03-PLAN.md — Aperol fixture integration tests for full pipeline

**UI hint**: yes

### Phase 10: CSS Import & Org API Keys
**Goal**: Organizations can import brand values from CSS files and manage their own scoped API keys
**Depends on**: Phase 09
**Requirements**: CSS-01, CSS-02, OAK-01, OAK-02, OAK-03, OAK-04
**Success Criteria** (what must be TRUE):
  1. User can upload a CSS file on the branding guideline page and see extracted colors and fonts populated into the guideline
  2. Org admin can create and revoke API keys scoped to their organization from org settings
  3. Org-scoped API keys access only that organization's data (scans, reports, trends) while global admin keys retain cross-org access
  4. Key management UI shows rate limits per key
**Plans:** 3/3 plans complete

Plans:
- [x] 10-01-PLAN.md — CSS parser + upload endpoint + guideline detail UI
- [x] 10-02-PLAN.md — Org API key scoping: auth pipeline, data isolation, global admin routes
- [x] 10-03-PLAN.md — Org API key management UI: org settings page, sidebar nav, rate limit display

**UI hint**: yes

### Phase 11: LLM Per-Org OAuth
**Goal**: Each organization uses its own OAuth credentials for LLM calls, matching the per-org pattern already used by compliance and branding
**Depends on**: Phase 09
**Requirements**: LLM-01, LLM-02, LLM-03, LLM-04
**Success Criteria** (what must be TRUE):
  1. Organizations table has llm_client_id and llm_client_secret columns after migration
  2. New org creation auto-creates a per-org LLM OAuth client (dashboard-{slug}) and stores the credentials
  3. LLM calls route through per-org credentials when available, falling back to system client when not
  4. CLI command can backfill existing orgs with per-org LLM clients
**Plans:** 3/3 plans complete

Plans:
- [x] 11-01-PLAN.md — DB migration + types + repository + org creation hook (LLM-01, LLM-02)
- [x] 11-02-PLAN.md — Per-org LLM call routing with fallback (LLM-03)
- [x] 11-03-PLAN.md — CLI backfill command + server startup backfill (LLM-04)

### Phase 12: E2E Testing & Documentation
**Goal**: All v2.9.0 features are validated end-to-end on live data and upstream dependencies are documented
**Depends on**: Phase 09, Phase 10, Phase 11
**Requirements**: E2E-01, E2E-02, E2E-03, DOC-01
**Success Criteria** (what must be TRUE):
  1. E2E test proves the retag pipeline: create guideline, assign site, scan, retag, verify updated brand counts on live data
  2. E2E test proves org API key lifecycle: create key, use key to scan, verify scoped access, revoke, verify revocation
  3. E2E test proves system brand guideline flow from org perspective: link, scan, verify resolution, clone, verify independence
  4. README includes a "Built on" section linking all upstream components grouped by role
**Plans**: TBD

## Progress

**Execution Order:** 09 → 10 → 11 → 12 (Phases 10 and 11 can run in parallel after 09)

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 9. Branding Pipeline Completion | v2.9.0 | 4/4 | Complete   | 2026-04-06 |
| 10. CSS Import & Org API Keys | v2.9.0 | 3/3 | Complete    | 2026-04-06 |
| 11. LLM Per-Org OAuth | v2.9.0 | 3/3 | Complete   | 2026-04-06 |
| 12. E2E Testing & Documentation | v2.9.0 | 0/? | Not started | - |
