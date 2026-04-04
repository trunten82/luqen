# Requirements: Luqen LLM Module Phases 3-7

**Defined:** 2026-04-04
**Core Value:** AI-powered accessibility fix suggestions that help users remediate WCAG issues faster than manual research

## v1 Requirements

### Generate Fix

- [x] **FIX-01**: POST /api/v1/generate-fix endpoint accepts HTML context, CSS, WCAG criterion, and issue message
- [x] **FIX-02**: Returns fixed HTML snippet, explanation, and effort level
- [x] **FIX-03**: Uses capability engine with retry/fallback across model priority chain
- [x] **FIX-04**: Prompt template with per-org override support
- [x] **FIX-05**: Dashboard report detail page shows AI fix suggestions per issue
- [x] **FIX-06**: Falls back to existing hardcoded patterns (fix-suggestions.ts) when LLM unavailable

### Analyse Report

- [x] **RPT-01**: POST /api/v1/analyse-report endpoint accepts scan results summary, issues, compliance matrix
- [x] **RPT-02**: Returns executive summary, key findings, patterns, and priorities
- [x] **RPT-03**: Uses capability engine with retry/fallback
- [x] **RPT-04**: Prompt template with per-org override support
- [x] **RPT-05**: Dashboard AI summary tab on report detail page
- [x] **RPT-06**: Pattern detection across scan history for the same site

### Discover Branding

- [x] **BRD-01**: POST /api/v1/discover-branding endpoint accepts URL
- [x] **BRD-02**: Returns detected colors, fonts, logo URL, brand name
- [x] **BRD-03**: Uses capability engine with retry/fallback
- [x] **BRD-04**: Prompt template with per-org override support
- [x] **BRD-05**: Branding service integration — auto-populate BrandGuideline from discovery results

### Standalone Hardening

- [ ] **STD-01**: Interactive installer script (same pattern as compliance/branding installers)
- [ ] **STD-02**: Installer configures OAuth client, provider, default models
- [x] **STD-03**: Comprehensive unit tests for all API endpoints and capability engine
- [x] **STD-04**: Integration tests for provider communication and fallback chains
- [x] **STD-05**: 80%+ test coverage across the LLM package

### Documentation

- [ ] **DOC-01**: OpenAPI/Swagger specs updated for all endpoints (generate-fix, analyse-report, discover-branding)
- [ ] **DOC-02**: LLM module README with setup, configuration, and usage instructions
- [ ] **DOC-03**: Installer documentation
- [ ] **DOC-04**: Main project README updated with LLM module section
- [ ] **DOC-05**: API reference documentation for all capability endpoints
- [ ] **DOC-06**: Review and update README architecture diagram to reflect actual implementation and improve readability

### UI Review & Polish

- [ ] **UIR-01**: Full UI audit of all dashboard pages for visual consistency, spacing, and design system adherence
- [ ] **UIR-02**: Fix identified inconsistencies across admin, report, and branding pages
- [ ] **UIR-03**: Improve mobile responsiveness on LLM admin page and new capability UI sections
- [ ] **UIR-04**: Review and improve UX flows for AI-powered features (fix suggestions, report summary, brand discovery)
- [ ] **UIR-05**: Use Stitch MCP to generate/validate design system alignment across all modified pages

## v2 Requirements

### Advanced Capabilities

- **ADV-01**: Multimodal image analysis for logo detection in discover-branding
- **ADV-02**: Real-time streaming responses for long-running analyses
- **ADV-03**: Cross-org pattern aggregation for anonymized accessibility insights
- **ADV-04**: Auto-create LLM OAuth client on org setup

## Out of Scope

| Feature | Reason |
|---------|--------|
| Custom model fine-tuning | Prompt engineering and template overrides sufficient for v1 |
| Dashboard LLM admin mobile refinement | Cosmetic, not blocking functionality |
| Real-time streaming | Batch responses adequate for all current capabilities |
| Vision/multimodal models | Requires specific provider support, defer to v2 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FIX-01 | Phase 1 | Complete |
| FIX-02 | Phase 1 | Complete |
| FIX-03 | Phase 1 | Complete |
| FIX-04 | Phase 1 | Complete |
| FIX-05 | Phase 1 | Complete |
| FIX-06 | Phase 1 | Complete |
| RPT-01 | Phase 2 | Complete |
| RPT-02 | Phase 2 | Complete |
| RPT-03 | Phase 2 | Complete |
| RPT-04 | Phase 2 | Complete |
| RPT-05 | Phase 2 | Complete |
| RPT-06 | Phase 2 | Complete |
| BRD-01 | Phase 3 | Complete |
| BRD-02 | Phase 3 | Complete |
| BRD-03 | Phase 3 | Complete |
| BRD-04 | Phase 3 | Complete |
| BRD-05 | Phase 3 | Complete |
| STD-01 | Phase 4 | Pending |
| STD-02 | Phase 4 | Pending |
| STD-03 | Phase 4 | Complete |
| STD-04 | Phase 4 | Complete |
| STD-05 | Phase 4 | Complete |
| DOC-01 | Phase 4 | Pending |
| DOC-02 | Phase 4 | Pending |
| DOC-03 | Phase 4 | Pending |
| DOC-04 | Phase 4 | Pending |
| DOC-05 | Phase 4 | Pending |
| DOC-06 | Phase 4 | Pending |
| UIR-01 | Phase 5 | Pending |
| UIR-02 | Phase 5 | Pending |
| UIR-03 | Phase 5 | Pending |
| UIR-04 | Phase 5 | Pending |
| UIR-05 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 33 total
- Mapped to phases: 33
- Unmapped: 0

---
*Requirements defined: 2026-04-04*
*Last updated: 2026-04-04 — traceability updated, hardening + docs merged into Phase 4*
