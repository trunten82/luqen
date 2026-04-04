# Phase 2A: LLM Capability Execution Engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add capability execution to @luqen/llm: DB migration (prompt_overrides + provider timeout), prompt template, response parser, retry/fallback, POST /api/v1/extract-requirements, prompt override CRUD.

**Architecture:** Capability handler resolves model (priority chain, org-scoped), loads prompt (override or default), calls adapter with timeout, retries with backoff, falls through to next model. Returns structured ExtractedRequirements.

**Tech Stack:** Fastify 5, better-sqlite3, vitest

**Spec:** docs/superpowers/specs/2026-04-04-llm-phase2-extract-requirements.md

---

## 7 Tasks

### Task 1: Types + DB Migration (timeout + prompt_overrides)
- Modify: packages/llm/src/types.ts -- add ExtractedRequirements, PromptOverride, timeout to Provider/CreateProviderInput/UpdateProviderInput
- Modify: packages/llm/src/db/adapter.ts -- add getPromptOverride, setPromptOverride, deletePromptOverride, listPromptOverrides, getModelsForCapability
- Modify: packages/llm/src/db/sqlite-adapter.ts -- ALTER TABLE providers ADD timeout, CREATE TABLE prompt_overrides, implement new methods
- Test: packages/llm/tests/db/sqlite-adapter.test.ts -- 7 new tests

### Task 2: Provider Adapter Timeout
- Modify: packages/llm/src/providers/types.ts -- add timeout to CompletionOptions
- Modify: packages/llm/src/providers/ollama.ts -- AbortSignal.timeout
- Modify: packages/llm/src/providers/openai.ts -- AbortSignal.timeout
- Test: timeout tests in both adapter test files

### Task 3: Prompt Template + Response Parser
- Create: packages/llm/src/prompts/extract-requirements.ts -- default prompt (moved from compliance)
- Create: packages/llm/src/capabilities/types.ts -- CapabilityExhaustedError, CapabilityNotConfiguredError, CapabilityResult
- Create: packages/llm/src/capabilities/parse-extract-response.ts -- JSON parser (moved from compliance)
- Test: packages/llm/tests/capabilities/parse-extract-response.test.ts -- 5 tests

### Task 4: Capability Execution Handler (retry/fallback)
- Create: packages/llm/src/capabilities/extract-requirements.ts -- executeExtractRequirements with retry chain
- Test: packages/llm/tests/capabilities/extract-requirements.test.ts -- 6 tests (success, no model, retry, fallback, exhausted, prompt override)

### Task 5: API Endpoint + Prompt Override Routes
- Create: packages/llm/src/api/routes/capabilities-exec.ts -- POST /api/v1/extract-requirements
- Create: packages/llm/src/api/routes/prompts.ts -- GET/PUT/DELETE /api/v1/prompts
- Modify: packages/llm/src/api/server.ts -- register new routes, increase bodyLimit to 10MB
- Test: packages/llm/tests/api/prompts.test.ts -- 5 tests

### Task 6: Clean Up Compliance LLM Files
- Delete: packages/compliance/src/llm/prompt.ts, parse-response.ts, index.ts
- Verify build + tests still pass

### Task 7: Full Verification
- Build + test all packages, lint check
