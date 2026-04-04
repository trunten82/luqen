# @luqen/llm Phase 2: Extract-Requirements Capability

**Date:** 2026-04-04
**Status:** Draft
**Depends on:** Phase 1 (complete)

## Overview

Add the first capability endpoint to the LLM module: `POST /api/v1/extract-requirements`. Wire compliance source scanning and document upload to call it directly. Build dashboard admin UI for provider/model/capability management. Add retry with fallback chain and degraded source tracking.

## Architecture

```
Compliance source scan/upload
    -> POST http://llm:4200/api/v1/extract-requirements
        (API key auth, content + regulation context)
    -> LLM module resolves capability -> model (priority chain)
    -> Loads prompt template (org override or system default)
    -> Calls provider adapter complete() with timeout
    -> On failure: retry same model, then fall to next priority
    -> Parses JSON response -> ExtractedRequirements
    -> Returns structured result
    <- Compliance creates UpdateProposal from result
```

## Decisions Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Dashboard admin pages | Full management (A) | Admins need UI for per-scenario model selection |
| Compliance discovery | Config-based (A) | Simple, explicit, matches existing service pattern |
| Prompt ownership | LLM module owns all prompts (A) | Centralizes AI logic, single place to tune |
| Prompt customization | Per-org overrides in DB (A) | Full flexibility with safe defaults |
| Timeout | Per-provider (B) | Local vs cloud have different characteristics |
| Admin layout | Single page with tabs (A) | Clean sidebar, full config picture in one place |
| Error handling | Retry chain + degraded source status | Sources visible in monitor, user can reprocess |

## 1. LLM Module: Capability Execution Engine

### 1.1 New DB Schema

```sql
-- Prompt template overrides (org-scoped)
CREATE TABLE prompt_overrides (
  capability TEXT NOT NULL,
  org_id TEXT NOT NULL DEFAULT 'system',
  template TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (capability, org_id)
);

-- Add timeout to providers (seconds, default 120)
ALTER TABLE providers ADD COLUMN timeout INTEGER NOT NULL DEFAULT 120;
```

### 1.2 Prompt Template

Move from `packages/compliance/src/llm/prompt.ts` to `packages/llm/src/prompts/extract-requirements.ts`.

The default prompt template:

```
You are an accessibility regulation analyst. Extract WCAG requirements from
the following regulatory page content.

## Regulation Context
- Regulation ID: {regulationId}
- Regulation Name: {regulationName}
{currentWcagVersion line if provided}

## Instructions
Analyze the page content and extract:
1. The WCAG version referenced (e.g., "2.0", "2.1", "2.2")
2. The conformance level required (e.g., "A", "AA", "AAA")
3. Specific WCAG success criteria with obligation level

Obligation levels:
- "mandatory" -- legally required
- "recommended" -- suggested but not enforced
- "optional" -- mentioned as good practice
- "excluded" -- explicitly exempted

## Response Format
Respond ONLY with valid JSON, no markdown fences:
{
  "wcagVersion": "2.1",
  "wcagLevel": "AA",
  "criteria": [
    { "criterion": "1.1.1", "obligation": "mandatory", "notes": "Alt text required" }
  ],
  "confidence": 0.85
}

If the page doesn't contain accessibility regulation data, return:
{ "wcagVersion": "unknown", "wcagLevel": "unknown", "criteria": [], "confidence": 0.0 }

## Page Content
{content, truncated at 30000 chars}
```

### 1.3 Response Parser

Move from `packages/compliance/src/llm/parse-response.ts` to `packages/llm/src/capabilities/parse-extract-response.ts`.

Strips markdown fences, parses JSON, validates structure, returns typed `ExtractedRequirements`.

### 1.4 Capability Handler

`packages/llm/src/capabilities/extract-requirements.ts`

```
async function executeExtractRequirements(
  db: DbAdapter,
  adapterFactory: (type) => LLMProviderAdapter,
  input: { content, regulationId, regulationName, jurisdictionId?, orgId? }
): Promise<ExtractedRequirements>

Flow:
1. Get assigned models for 'extract-requirements' capability (ordered by priority)
   - Check org-scoped assignments first, then system
2. Load prompt template: check prompt_overrides for (capability, orgId), fall back to default
3. Build prompt with input context
4. For each model in priority order:
   a. Get provider for model
   b. Create adapter, connect with provider config
   c. Call adapter.complete(prompt, { model: model.modelId, timeout from provider })
   d. On success: parse response, return result
   e. On failure: retry same model (max 2 retries, backoff 5s/15s)
   f. If all retries fail: try next model in chain
5. If all models exhausted: throw CapabilityExhaustedError
```

### 1.5 Capability Endpoint

`POST /api/v1/extract-requirements`

- Auth: OAuth2 (read scope) or API key
- Request body:
  ```json
  {
    "content": "string (regulation text/HTML)",
    "regulationId": "string",
    "regulationName": "string",
    "jurisdictionId": "string (optional)",
    "orgId": "string (optional, defaults to request orgId)"
  }
  ```
- Success response (200):
  ```json
  {
    "wcagVersion": "2.1",
    "wcagLevel": "AA",
    "criteria": [
      { "criterion": "1.1.1", "obligation": "mandatory", "notes": "Alt text required" }
    ],
    "confidence": 0.85,
    "model": "ministral-3:3b-cloud",
    "provider": "Office Ollama"
  }
  ```
- Error responses:
  - 400: Missing required fields
  - 503: No model configured for this capability
  - 504: All models timed out (CapabilityExhaustedError after full retry chain)
  - 502: LLM returned unparseable response (after retries)

### 1.6 Retry and Fallback Logic

```
For capability 'extract-requirements' with models [M1 (pri 0), M2 (pri 1)]:

Attempt 1: M1, try 1 -> timeout
  wait 5s
Attempt 2: M1, try 2 -> timeout
  wait 15s
Attempt 3: M1, try 3 -> timeout
  (M1 exhausted, move to M2)
Attempt 4: M2, try 1 -> success -> return result

If M2 also fails after 3 tries -> throw CapabilityExhaustedError
```

Max retries per model: configurable (default 2, so 3 total attempts per model).
Backoff: exponential (5s, 15s between retries on same model).
No delay between switching models.

### 1.7 Prompt Override API

New endpoints:

- `GET /api/v1/prompts` — list all prompt overrides (grouped by capability)
- `GET /api/v1/prompts/:capability` — get prompt for capability (returns org override if exists, else default)
- `PUT /api/v1/prompts/:capability` — create/update prompt override (body: `{ template, orgId? }`)
- `DELETE /api/v1/prompts/:capability` — remove override, revert to default (query: `?orgId=`)

Auth: requires `admin` scope.

### 1.8 Provider Timeout

- Add `timeout` field to providers table (integer seconds, default 120)
- Provider CRUD endpoints accept `timeout` in create/update body
- Adapter `complete()` uses `AbortSignal.timeout(provider.timeout * 1000)`
- Admin UI shows timeout field on provider form

## 2. Compliance Integration

### 2.1 Configuration

Add to `ComplianceConfig`:
```typescript
readonly llmUrl?: string;    // e.g., "http://localhost:4200"
readonly llmApiKey?: string;  // API key for LLM service
```

Env vars: `COMPLIANCE_LLM_URL`, `COMPLIANCE_LLM_API_KEY`

### 2.2 LLM Client

New file: `packages/compliance/src/llm/llm-client.ts`

Simple HTTP client:
```typescript
export class LLMClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  async extractRequirements(input: {
    content: string;
    regulationId: string;
    regulationName: string;
    jurisdictionId?: string;
  }): Promise<ExtractedRequirements> {
    // POST baseUrl/api/v1/extract-requirements
    // Bearer apiKey auth
    // Returns parsed ExtractedRequirements
    // Throws on non-2xx
  }

  async healthCheck(): Promise<boolean> {
    // GET baseUrl/api/v1/health
  }
}
```

### 2.3 Source Scan Re-wiring

In `packages/compliance/src/api/routes/sources.ts`:

Restore the government source extraction logic (removed in Phase 1):
- If LLM client is available (llmUrl configured):
  - On first scan: extract requirements, create proposal with `trustLevel: 'extracted'`
  - On content change: extract, diff against current requirements, create proposal
- If LLM client unavailable or all retries fail:
  - Create generic proposal with `trustLevel: 'degraded'`
  - Set source status to `'degraded'`
  - Proposal summary: "LLM extraction failed -- manual review required"

### 2.4 Upload Endpoint

Replace the 503 stub in compliance sources route:
- Accept content + context
- Call LLM client extractRequirements()
- Create source record + proposal with extracted requirements
- On LLM failure: return 502 with error message (don't create degraded proposal for explicit uploads — user should retry)

### 2.5 Source Status: Degraded

Add `'degraded'` to monitored source status values.

In source scan logic:
- When LLM extraction fails after full retry: set source `status = 'degraded'`
- When LLM extraction succeeds on a previously degraded source: set `status = 'active'`

### 2.6 Reprocess Action

New endpoint: `POST /api/v1/sources/:id/reprocess`
- Fetches source content, re-runs LLM extraction
- If success: updates source status to 'active', creates new proposal
- If fail: keeps degraded status, returns error

### 2.7 Cleanup Old Files

Delete from `packages/compliance/src/llm/`:
- `prompt.ts` (moved to LLM module)
- `parse-response.ts` (moved to LLM module)
- `index.ts` (barrel export, no longer needed)

Keep `llm/` directory for `llm-client.ts`.

## 3. Dashboard Admin UI

### 3.1 Route: `/admin/llm`

Single page with 4 tabs, served by `packages/dashboard/src/routes/admin/llm.ts`.

Dashboard proxies to LLM module API (same pattern as compliance/branding proxy).

Config adds:
```typescript
readonly llmUrl?: string; // e.g., "http://localhost:4200"
```
Env var: `DASHBOARD_LLM_URL`

### 3.2 Providers Tab

- Table: name, type, baseUrl, status badge, timeout, actions
- "Add Provider" form: name, type (dropdown: ollama/openai/anthropic/gemini), baseUrl, apiKey (masked), timeout (seconds)
- "Test" button: calls POST /providers/:id/test, shows result inline
- "Edit" action: inline form or modal
- "Delete" action: confirmation dialog, warns about cascade to models

### 3.3 Models Tab

- Grouped by provider
- "Register Model" flow: select provider -> fetches remote models from provider API -> select from list -> set display name + capabilities checkboxes
- Table: displayName, modelId, provider, capabilities tags, status, actions
- "Delete" action with cascade warning (removes capability assignments)

### 3.4 Capabilities Tab

- 4 capability cards (extract-requirements, generate-fix, analyse-report, discover-branding)
- Each card shows:
  - Assigned models with priority (drag to reorder or priority number input)
  - "Assign Model" button: select from registered models, set priority
  - "Unassign" button per model
  - Org selector for org-scoped overrides
- Status indicator: configured (green) / not configured (grey)

### 3.5 Prompts Tab

- 4 capability cards
- Each shows:
  - Current active template (default or org override) in a read-only code block
  - "Customize" button: copies default into editable textarea
  - "Save Override" button: saves to prompt_overrides
  - "Reset to Default" button: deletes override
  - Org selector for org-scoped overrides
- Syntax hint: template variables shown ({content}, {regulationId}, etc.)

### 3.6 Dashboard Sources Integration

Update `packages/dashboard/src/views/admin/sources.hbs`:
- Replace LLM plugin selector with LLM module status check
- Upload form shows "LLM Service: Connected" / "Not configured" badge
- Remove all references to LLM plugins

Update `packages/dashboard/src/routes/admin/sources.ts`:
- `hasLlm` now checks if dashboard llmUrl is configured and LLM health endpoint responds
- Upload proxies through compliance client (which calls LLM module)

### 3.7 Monitor Integration

Update monitor/sources views:
- Show "Degraded" status badge (amber/warning colour)
- Filter by status includes 'degraded' option
- "Reprocess" button on degraded sources calls POST /sources/:id/reprocess
- Success: badge updates to active, toast notification

## 4. Security Roles

### 4.1 LLM-Specific Permissions

New permissions added to dashboard RBAC:

| Permission | Description |
|------------|-------------|
| `llm.view` | View providers, models, capabilities, prompts (read-only) |
| `llm.manage` | Add/edit/delete providers and models, test connectivity |
| `llm.configure` | Assign capabilities, edit prompt overrides |
| `llm.admin` | Full access including org-scoped operations for other orgs |

### 4.2 Default Role Mappings

| Dashboard Role | LLM Permissions |
|---------------|-----------------|
| `viewer` | `llm.view` |
| `editor` | `llm.view` |
| `admin` | `llm.view`, `llm.manage`, `llm.configure`, `llm.admin` |

### 4.3 Route Protection

All `/admin/llm` routes check permissions:
- Tab visibility controlled by permission level
- Form actions hidden when insufficient permission
- API proxy calls enforce scope on the LLM module side

## 5. Provider Adapter Timeout

### 5.1 Schema Change

```sql
ALTER TABLE providers ADD COLUMN timeout INTEGER NOT NULL DEFAULT 120;
```

### 5.2 Adapter Changes

Both OllamaAdapter and OpenAIAdapter `complete()` method:
- Accept optional `timeout` in CompletionOptions
- Wrap fetch with `AbortSignal.timeout(timeout * 1000)`
- Throw on timeout (caught by capability execution retry logic)

Update `CompletionOptions`:
```typescript
export interface CompletionOptions {
  readonly model: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly systemPrompt?: string;
  readonly timeout?: number; // seconds
}
```

### 5.3 Provider CRUD

- Create/Update provider accepts `timeout` field
- GET provider returns `timeout` field
- Default: 120 seconds

## 6. Error Handling Summary

| Scenario | Behaviour |
|----------|-----------|
| LLM module unreachable | Compliance falls back to generic proposal, source stays active |
| All models timeout (retry chain exhausted) | 504 to compliance, source set to 'degraded', generic proposal with `trustLevel: 'degraded'` |
| LLM returns bad JSON (after retries) | 502 to compliance, source set to 'degraded', generic proposal with `trustLevel: 'degraded'` (same as timeout — transient LLM failure) |
| No model assigned to capability (never was) | 503 to compliance, capability not available, generic proposal, source stays active (config issue) |
| No model assigned to capability (was configured, now removed) | 503 to compliance, source set to 'degraded' (was working, now broken), generic proposal with `trustLevel: 'degraded'` |
| Upload fails | 502 returned to user directly (no degraded proposal -- user retries manually) |
| Reprocess succeeds | Source status -> 'active', new proposal replaces degraded one |

**Degraded rule:** any source that *requires LLM extraction* (government category) but cannot get it — whether because LLM was disabled, models removed, provider down, or bad response — gets `status: 'degraded'`. The proposal is created as generic with `trustLevel: 'degraded'` so the user sees it in the monitor and can:
- Act on it manually (review the content change, update requirements by hand)
- Reprocess it later when LLM is available again
- Acknowledge it as-is if manual review is sufficient

When the user manually acts on a degraded proposal (edits requirements by hand):
- The resulting requirements are tagged with `source: 'manual'` instead of `source: 'llm-extracted'` (provenance tracking)
- The source status returns to `'active'` (no longer degraded — the user has handled it)
- If later reprocessed with LLM, the source tag reverts to `'llm-extracted'`

### Source Management Mode

Each government source has a `managementMode` field: `'llm'` | `'manual'`.

- **Default:** `'llm'` when LLM capability is configured, `'manual'` otherwise
- **User can switch at any time** via the sources admin UI:
  - **LLM -> Manual:** user takes ownership of the source. Scans still detect content changes but create generic proposals instead of LLM extraction. Source never goes degraded. Good for sources where the user knows better than the LLM.
  - **Manual -> LLM:** next scan runs LLM extraction. If LLM is unavailable, source goes degraded as normal.
- **Degraded -> Manual:** user explicitly says "I'll handle this myself". Source returns to active, tagged as manual.
- The switch is a conscious choice, not automatic. If LLM fails, the source degrades — it doesn't silently flip to manual.

Sources that don't require LLM (w3c-policy, wcag-upstream with deterministic parsers) are unaffected — they always use their deterministic parsers regardless of this setting.
