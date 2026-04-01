# Compliance Source Intelligence Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the compliance source scanner to parse W3C policy data and LLM-extracted requirements into structured proposals, replacing generic "content changed" alerts.

**Architecture:** Three parsers (W3C YAML, WCAG upstream JSON, LLM-based government pages) feed into a shared requirement differ that generates proposals for admin review. The existing proposals pipeline handles approval and DB updates.

**Tech Stack:** TypeScript, Fastify, js-yaml, better-sqlite3, Vitest

---

## Task 1: Schema + type changes for sourceCategory and LLM provider

**Files:**
- Modify: `packages/compliance/src/types.ts`
- Modify: `packages/compliance/src/db/adapter.ts`
- Modify: `packages/compliance/src/db/sqlite-adapter.ts`

- [ ] **Step 1: Add sourceCategory to MonitoredSource and CreateSourceInput in types.ts**

Add `sourceCategory` field to `MonitoredSource`:
```typescript
readonly sourceCategory: 'w3c-policy' | 'government' | 'wcag-upstream' | 'generic';
```

Add optional `sourceCategory` to `CreateSourceInput`:
```typescript
readonly sourceCategory?: 'w3c-policy' | 'government' | 'wcag-upstream' | 'generic';
```

Add `IComplianceLLMProvider` and `ExtractedRequirements` interfaces at end of file (see spec for full definitions).

- [ ] **Step 2: Add sourceCategory column migration in sqlite-adapter.ts**

Add column migration in `initialize()`, update `toSource` mapper and `createSource` INSERT.

- [ ] **Step 3: Build**

- [ ] **Step 4: Commit**

Message: `feat(compliance): add sourceCategory to monitored sources, IComplianceLLMProvider interface`

---

## Task 2: Requirement differ

**Files:**
- Create: `packages/compliance/src/parsers/requirement-differ.ts`
- Create: `packages/compliance/tests/parsers/requirement-differ.test.ts`

- [ ] **Step 1: Write tests for diffRequirements**

Tests: detects added, removed, obligation changes; returns empty diff when identical; generates ProposedChange entries.

- [ ] **Step 2: Run tests — expect FAIL**

- [ ] **Step 3: Implement diffRequirements**

Pure function: takes regulationId, current requirements, extracted requirements. Keys by `version:criterion`. Returns `RequirementDiff` with `added`, `removed`, `changed`, `hasChanges`, `toProposedChanges()`.

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Build and commit**

Message: `feat(compliance): add requirement differ for comparing extracted vs DB requirements`

---

## Task 3: W3C YAML policy parser

**Files:**
- Create: `packages/compliance/src/parsers/w3c-parser.ts`
- Create: `packages/compliance/tests/parsers/w3c-parser.test.ts`

- [ ] **Step 1: Install js-yaml**

Run: `npm install js-yaml -w packages/compliance && npm install -D @types/js-yaml -w packages/compliance`

- [ ] **Step 2: Write tests for parseW3cPolicyYaml**

Tests: extracts regulations from YAML frontmatter; parses WCAG version from wcagver field; handles "derivative" versions; normalizes scope values.

- [ ] **Step 3: Run tests — expect FAIL**

- [ ] **Step 4: Implement w3c-parser.ts**

`parseW3cPolicyYaml(content, jurisdictionId)` — extracts YAML frontmatter, parses policies array, returns `W3cParsedRegulation[]` with name, url, wcagVersion, wcagLevel, scope, enforcementYear, type, jurisdictionId.

`fetchW3cPolicyIndex()` — fetches GitHub API directory listing for W3C policy files.

`fetchW3cPolicyFile(filename)` — fetches raw file from `raw.githubusercontent.com`.

- [ ] **Step 5: Run tests — expect PASS**

- [ ] **Step 6: Build and commit**

Message: `feat(compliance): add W3C WAI policy YAML parser`

---

## Task 4: WCAG upstream criteria parser

**Files:**
- Create: `packages/compliance/src/parsers/wcag-upstream-parser.ts`
- Create: `packages/compliance/tests/parsers/wcag-upstream-parser.test.ts`

- [ ] **Step 1: Write tests for parseQuickRefJson and parseTenOnJson**

- [ ] **Step 2: Run tests — expect FAIL**

- [ ] **Step 3: Implement parsers**

`parseQuickRefJson(data)` — parses W3C Quick Ref JSON format, one entry per version per criterion.

`parseTenOnJson(data, version)` — parses tenon-io format, tags all entries with the given version.

`fetchQuickRefJson()` and `fetchTenOnJson()` — fetch from raw GitHub URLs.

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Build and commit**

Message: `feat(compliance): add WCAG upstream criteria parser for W3C Quick Ref and tenon-io`

---

## Task 5: Enhanced source scanner — route by sourceCategory

**Files:**
- Modify: `packages/compliance/src/api/routes/sources.ts`
- Modify: `packages/compliance/src/api/server.ts`

- [ ] **Step 1: Update registerSourceRoutes to accept optional LLM provider**

```typescript
export async function registerSourceRoutes(
  app: FastifyInstance,
  db: DbAdapter,
  llmProvider?: IComplianceLLMProvider,
): Promise<void> {
```

- [ ] **Step 2: Route scan by sourceCategory**

In the content-changed branch of the scan endpoint, check `source.sourceCategory`:
- `w3c-policy`: import and call W3C parser, diff against DB, create structured proposals
- `wcag-upstream`: import and call criteria parser, diff against DB, create proposals
- `government`: if LLM provider available, extract requirements and diff; otherwise generic proposal
- `generic`: existing paragraph diff behavior (unchanged)

- [ ] **Step 3: Update server.ts to pass LLM provider**

Add optional `llmProvider` to `ServerOptions`. Pass to `registerSourceRoutes`.

- [ ] **Step 4: Build and test**

- [ ] **Step 5: Commit**

Message: `feat(compliance): route source scanner by sourceCategory with parser dispatch`

---

## Task 6: Update seed data with W3C + upstream sources

**Files:**
- Modify: `packages/compliance/src/seed/baseline.json`
- Modify: `packages/compliance/src/seed/loader.ts`

- [ ] **Step 1: Add W3C policy sources to baseline.json**

Add ~47 W3C country policy file URLs as `sourceCategory: "w3c-policy"` sources. Set existing government URLs to `sourceCategory: "government"`.

- [ ] **Step 2: Add WCAG upstream sources**

Add 2 entries: W3C Quick Ref JSON + tenon-io WCAG 2.2 JSON as `sourceCategory: "wcag-upstream"`.

- [ ] **Step 3: Update seed loader to handle sourceCategory**

Pass `sourceCategory` when creating sources in `seedBaseline`.

- [ ] **Step 4: Build and commit**

Message: `feat(compliance): add W3C and WCAG upstream monitored sources to seed data`

---

## Task 7: External sources documentation

**Files:**
- Create: `docs/compliance/external-sources.md`

- [ ] **Step 1: Create documentation**

Document all three external sources (W3C WAI Policies, W3C WCAG Quick Ref, tenon-io/wcag-as-json) with URLs, licenses, data format, usage description, and attribution notice.

- [ ] **Step 2: Commit**

Message: `docs: add external sources attribution for compliance data`

---

## Task 8: Integration test and full test suite

**Files:**
- Create: `packages/compliance/tests/parsers/integration.test.ts`

- [ ] **Step 1: Write integration test**

Test full pipeline: W3C YAML parse -> diff requirements -> generate proposals. Verify the chain works end-to-end with sample data.

- [ ] **Step 2: Run all compliance + dashboard tests**

- [ ] **Step 3: Commit and push**

Message: `test(compliance): integration test for parser pipeline`
