# Roadmap: Luqen LLM Module — Phases 3-7

## Overview

This milestone completes the LLM module by delivering the three remaining AI capabilities (generate-fix, analyse-report, discover-branding) on top of the capability engine built in Phase 2, then hardens the module with a comprehensive test suite and installer, and finalises all documentation. Each capability phase follows the same pattern: register endpoint, add prompt template, wire dashboard UI. The final phase ships everything production-ready.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Generate Fix** - AI-powered WCAG fix suggestions on report detail pages, with hardcoded pattern fallback
- [ ] **Phase 2: Analyse Report** - AI executive summaries and pattern detection on report detail pages
- [ ] **Phase 3: Discover Branding** - Auto-detect brand colors, fonts, and logo from URLs, feeding into branding service
- [ ] **Phase 4: Ship Ready** - Installer, test suite to 80%+ coverage, and full documentation
- [ ] **Phase 5: UI Review & Polish** - Full UI audit and visual consistency pass using Stitch MCP

## Phase Details

### Phase 1: Generate Fix
**Goal**: Users can get AI-generated fix suggestions for individual WCAG issues directly on report detail pages
**Depends on**: Nothing (first phase — capability engine from prior milestone is the foundation)
**Requirements**: FIX-01, FIX-02, FIX-03, FIX-04, FIX-05, FIX-06
**Success Criteria** (what must be TRUE):
  1. User opens a report detail page and sees an "AI Fix Suggestion" panel for each flagged issue
  2. The panel shows a fixed HTML snippet, plain-English explanation, and effort level (low/medium/high)
  3. When the LLM service is unavailable, the panel falls back to the hardcoded fix-suggestions.ts patterns rather than showing an error
  4. An admin can customise the generate-fix prompt template per org from the /admin/llm Prompts tab
**Plans**: 2 plans
Plans:
- [x] 01-01-PLAN.md — LLM service: generate-fix capability executor, prompt template, POST /api/v1/generate-fix endpoint
- [x] 01-02-PLAN.md — Dashboard: generateFix LLM client method, fix-suggestion route, upgraded helper, CSS, i18n, admin hint
**UI hint**: yes

### Phase 2: Analyse Report
**Goal**: Users can read an AI-generated executive summary and recurring-pattern analysis for any scan report
**Depends on**: Phase 1
**Requirements**: RPT-01, RPT-02, RPT-03, RPT-04, RPT-05, RPT-06
**Success Criteria** (what must be TRUE):
  1. User opens a report and sees an "AI Summary" tab alongside the existing issues tab
  2. The tab displays an executive summary, key findings list, and prioritised remediation recommendations
  3. Where multiple scans exist for the same site, recurring patterns are surfaced in the summary
  4. Summary generation degrades gracefully (tab hidden or shows notice) when the LLM service is unavailable
**Plans**: 2 plans
Plans:
- [ ] 02-01-PLAN.md — LLM service: analyse-report capability executor, prompt template with truncation, POST /api/v1/analyse-report endpoint
- [ ] 02-02-PLAN.md — Dashboard: analyseReport LLM client method, ai-summary route with pattern detection, AI Summary tab, CSS, i18n, admin hint
**UI hint**: yes

### Phase 3: Discover Branding
**Goal**: Users can auto-populate a BrandGuideline from a URL rather than entering colors, fonts, and logo manually
**Depends on**: Phase 2
**Requirements**: BRD-01, BRD-02, BRD-03, BRD-04, BRD-05
**Success Criteria** (what must be TRUE):
  1. User triggers brand discovery for a URL and receives detected primary colors, font families, logo URL, and brand name
  2. The discovered values are written directly into the BrandGuideline record in the branding service
  3. Discovery falls back gracefully (returns empty result with explanation) when the LLM service is unavailable
  4. An admin can customise the discover-branding prompt template per org
**Plans**: TBD

### Phase 4: Ship Ready
**Goal**: The LLM module can be installed, tested, and handed off — installer script, 80%+ test coverage, complete documentation, and updated architecture diagram
**Depends on**: Phase 3
**Requirements**: STD-01, STD-02, STD-03, STD-04, STD-05, DOC-01, DOC-02, DOC-03, DOC-04, DOC-05, DOC-06
**Success Criteria** (what must be TRUE):
  1. Running the installer script on a fresh machine configures the OAuth client, provider, and default models without manual steps
  2. `npm test` in the LLM package reports 80%+ coverage across unit and integration tests, including all three new capability endpoints and the fallback chains
  3. The Swagger UI at /documentation lists all capability endpoints (generate-fix, analyse-report, discover-branding) with accurate schemas
  4. A developer can follow the LLM module README from zero to running service without consulting source code
  5. The README architecture diagram accurately reflects the current implementation (all services, their connections, and the LLM module's role) and is readable/consistent
**Plans**: TBD

### Phase 5: UI Review & Polish
**Goal**: Comprehensive UI audit and polish pass across all dashboard pages, ensuring visual consistency, design system adherence, and improved UX for AI-powered features
**Depends on**: Phase 4
**Requirements**: UIR-01, UIR-02, UIR-03, UIR-04, UIR-05
**Success Criteria** (what must be TRUE):
  1. All dashboard pages pass a visual consistency audit — spacing, typography, and color usage follow the Emerald design system tokens
  2. LLM admin page and new capability UI sections work correctly on mobile viewports
  3. AI-powered feature UX flows (fix suggestions, report summary, brand discovery) are intuitive and consistent
  4. Stitch MCP validates design system alignment across all modified pages
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Generate Fix | 2/2 | Complete |  |
| 2. Analyse Report | 0/2 | Not started | - |
| 3. Discover Branding | 0/? | Not started | - |
| 4. Ship Ready | 0/? | Not started | - |
| 5. UI Review & Polish | 0/? | Not started | - |
