# Phase 34: Tokenizer Precision - Pattern Map

**Mapped:** 2026-04-24
**Files analyzed:** 5 (2 modified, 2 new, 1 test updated)
**Analogs found:** 5 / 5

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/dashboard/src/agent/token-budget.ts` (MODIFY) | utility | transform (sync) | `packages/dashboard/src/agent/token-budget.ts` (current) | self / exact — surface preserved |
| `packages/dashboard/src/agent/tokenizer/registry.ts` (NEW) | registry | transform + cache | `packages/llm/src/providers/registry.ts` | exact (role + shape) |
| `packages/dashboard/src/agent/tokenizer/ollama-tokenizer.ts` (NEW) | service / adapter | request-response (HTTP fetch + cache) | `packages/llm/src/providers/ollama.ts` (`listModels`, `healthCheck`) | role-match (HTTP GET against Ollama) |
| `packages/dashboard/src/agent/agent-service.ts` (MODIFY) | service | request-response | self (existing estimateTokens call site at L260) | self / exact |
| `packages/dashboard/tests/agent/agent-service.test.ts` (MODIFY) | test | — | self + `packages/dashboard/tests/cache/redis.test.ts` (vi.mock pattern) | self + role-match |
| `packages/dashboard/tests/agent/token-budget.test.ts` (NEW or EXTEND) | test | — | `packages/dashboard/tests/agent/tool-dispatch.test.ts` | role-match (pure unit tests of a sibling module) |

## Pattern Assignments

### `packages/dashboard/src/agent/token-budget.ts` (utility, sync transform)

**Analog:** self — existing file. The export surface (`estimateTokens`, `shouldCompact`, `DEFAULT_MODEL_MAX_TOKENS`, `COMPACTION_THRESHOLD`, `MIN_KEEP_TURNS`) stays. Only the internals of `estimateTokens` change.

**Imports pattern** (current L10):
```typescript
import type { AgentChatMessage } from './agent-service.js';
```
Add:
```typescript
import { countMessageTokens, type TokenizerRegistry } from './tokenizer/registry.js';
```

**Current core pattern** (L26-35) — the one being replaced:
```typescript
export function estimateTokens(messages: readonly AgentChatMessage[]): number {
  let chars = 0;
  for (const m of messages) {
    chars += (m.content?.length ?? 0);
    if (m.toolCalls && m.toolCalls.length > 0) {
      chars += JSON.stringify(m.toolCalls).length;
    }
  }
  return Math.ceil(chars / 4);
}
```

**Preserve:**
- Sync signature (D-04).
- Monotonicity — tests depend on "adding any char increases count" (L23 docstring).
- Tool-call inclusion — `JSON.stringify(toolCalls)` parity (D-09).
- Sync `shouldCompact(tokens, max)` stays bit-identical (L37-42).

**New shape (to implement):**
```typescript
export function estimateTokens(
  messages: readonly AgentChatMessage[],
  model?: string,
  registry?: TokenizerRegistry,
): number {
  // Default registry = module-level singleton; tests inject a fake.
  // If model is undefined OR registry miss → char/4 fallback (D-07).
  // Per-message envelope tax: fixed +3 or +4 per msg (D-11).
}
```

---

### `packages/dashboard/src/agent/tokenizer/registry.ts` (NEW — registry)

**Analog:** `packages/llm/src/providers/registry.ts` (entire 23-line file).

**Copy pattern — factory map keyed by string, with explicit error on unknown key** (lines 7-19):
```typescript
const ADAPTER_FACTORIES: Record<string, () => LLMProviderAdapter> = {
  ollama: () => new OllamaAdapter(),
  openai: () => new OpenAIAdapter(),
  anthropic: () => new AnthropicAdapter(),
};

export function createAdapter(type: ProviderType): LLMProviderAdapter {
  const factory = ADAPTER_FACTORIES[type];
  if (!factory) {
    throw new Error(`Unsupported provider type: ${type}. Supported: ...`);
  }
  return factory();
}
```

**Apply to tokenizer registry:**
- Map **model strings** (e.g. `gpt-4o`, `claude-3-5-sonnet`, `llama3.1`) → `{ provider, encoding }` entries (D-06).
- Unknown-model lookup returns `undefined` (not throw) so caller can char/4 fallback (D-07).
- Warn-once dedup via module-level `Set<string>` (D-08):
  ```typescript
  const warnedModels = new Set<string>();
  function warnUnknownModelOnce(model: string, logger: { warn: (msg: string) => void }): void {
    if (warnedModels.has(model)) return;
    warnedModels.add(model);
    logger.warn(`[token-budget] Unknown model "${model}" — falling back to char/4 heuristic.`);
  }
  ```

**Core pattern — countMessageTokens(messages, model):**
- Resolve model → entry.
- If `openai` → use `js-tiktoken` encoder for the resolved encoding (pre-warmed).
- If `anthropic` → use `@anthropic-ai/tokenizer`.
- If `ollama` → use `OllamaTokenizer` instance (see next section).
- On miss → warn-once + char/4.
- Apply per-message envelope tax (+3/+4/msg, D-11) after the precise count.

**Pre-warm API** (D-05):
```typescript
export function prewarmTokenizer(model: string): void { ... }
```
Called by AgentService at construction for `this.config.modelMaxTokens`'s companion model string.

---

### `packages/dashboard/src/agent/tokenizer/ollama-tokenizer.ts` (NEW — service/adapter)

**Analog:** `packages/llm/src/providers/ollama.ts` — reuse its HTTP/baseUrl conventions.

**Imports pattern** (from `ollama.ts` L1-12):
```typescript
import { randomUUID } from 'node:crypto';
import type { LLMProviderAdapter, ... } from './types.js';
```
Apply: import `type` only; import `fetch` globally (no axios).

**BaseUrl trim pattern** (`ollama.ts` L19-21):
```typescript
async connect(config: { baseUrl: string; apiKey?: string }): Promise<void> {
  this.baseUrl = config.baseUrl.replace(/\/$/, '');
}
```

**Simple GET pattern — mirrors `listModels` (`ollama.ts` L36-40):**
```typescript
async listModels(): Promise<readonly RemoteModel[]> {
  const res = await fetch(`${this.baseUrl}/api/tags`);
  const data = await res.json() as { models: Array<{ name: string }> };
  return data.models.map((m) => ({ id: m.name, name: m.name }));
}
```

**Apply to `/api/show`:**
```typescript
async fetchTokenizerMetadata(model: string): Promise<OllamaTokenizerMeta | null> {
  try {
    const res = await fetch(`${this.baseUrl}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { /* shape TBD from Ollama docs */ };
    // Extract vocab / tokenizer hints
    return { ... };
  } catch {
    return null;  // caller falls back to char/4
  }
}
```

**Health-check/try-fail pattern** (`ollama.ts` L27-34):
```typescript
async healthCheck(): Promise<boolean> {
  try {
    const res = await fetch(`${this.baseUrl}/api/tags`);
    return res.ok;
  } catch {
    return false;
  }
}
```
Apply: wrap `/api/show` in try/catch returning `null`, never throwing into the sync `countTokens` path.

**Cache pattern:** Module-level `Map<string, OllamaTokenizerMeta>` keyed by model name, process-lifetime TTL (D-NULL — no expiry). Populated lazily on first tokenize for that model.

**Note:** The HTTP call to `/api/show` is async, but `countTokens` is sync (D-04). Strategy: pre-warm populates the cache asynchronously at AgentService startup; sync `countTokens` reads from cache synchronously; cache miss → char/4 + warn-once + fire-and-forget async fetch to warm for next call.

---

### `packages/dashboard/src/agent/agent-service.ts` (MODIFY — service)

**Analog:** self, at L260-274 (existing call site).

**Current pattern** (L40-45 import, L260-263 call):
```typescript
import {
  estimateTokens,
  shouldCompact,
  MIN_KEEP_TURNS,
  DEFAULT_MODEL_MAX_TOKENS,
} from './token-budget.js';

// ... inside runTurn loop:
const estimate = estimateTokens([
  { role: 'system', content: contextHintsBlock },
  ...messages,
]);
if (this.config.agent_compaction !== false && shouldCompact(estimate, this.config.modelMaxTokens)) {
```

**Minimal-diff modification:** Add `model` parameter — pull from `this.config` (already holds `modelMaxTokens`; add companion `modelId` or pass through from existing model selection already owned by AgentService per CONTEXT "Reusable Assets").

```typescript
const estimate = estimateTokens(
  [{ role: 'system', content: contextHintsBlock }, ...messages],
  this.config.modelId,  // NEW
);
```

**Pre-warm pattern** (D-05) — add to constructor (around L187-209). Claude's discretion on exact placement, but follow the existing constructor style of sync field assignment + one async side-effect fired and not awaited:
```typescript
constructor(options: AgentServiceOptions) {
  // ... existing assignments ...
  if (this.config.modelId) {
    prewarmTokenizer(this.config.modelId);  // fire-and-forget for Ollama /api/show
  }
}
```

**Config extension pattern** (L151-157, L180-184):
```typescript
readonly config: {
  readonly agentDisplayNameDefault: string;
  readonly agent_compaction?: boolean;
  readonly modelMaxTokens?: number;
  readonly modelId?: string;  // NEW — drives tokenizer selection
};
```

---

### `packages/dashboard/tests/agent/agent-service.test.ts` (MODIFY — test)

**Analog:** self — existing test harness already injects stubbed `llm`, `dispatcher`, `resolvePermissions`. Just extend `config` with `modelId` in the builder, and leave existing assertions on compaction timing intact.

**Pattern to preserve** (L21-37 imports):
```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// ... SqliteStorageAdapter, AgentService ...
```

**Reference mock pattern for Ollama fetch** (from `packages/dashboard/tests/cache/redis.test.ts` L6):
```typescript
vi.mock('ioredis', () => { ... });
```
Apply: `vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ... }) }))` for the Ollama `/api/show` path tests.

---

### `packages/dashboard/tests/agent/token-budget.test.ts` (NEW — unit tests)

**Analog:** `packages/dashboard/tests/agent/tool-dispatch.test.ts` — pure unit tests on a sibling agent module (no SqliteStorageAdapter needed).

Required test cases per CONTEXT L84:
- Monotonicity: adding a char never decreases count (existing invariant).
- Precise-count path for each of: `gpt-4o`, `claude-3-5-sonnet-…`, `llama3.1`.
- Unknown model → char/4 fallback + warn called exactly once across two invocations (D-08 dedup).
- Tool-call content included — parity with char-based path at least in "count grows when tool_calls present" direction.
- Per-message envelope tax applied (N messages contributes ≥ N × 3 tokens of overhead, D-11).
- `shouldCompact` unchanged.

---

## Shared Patterns

### HTTP-against-Ollama
**Source:** `packages/llm/src/providers/ollama.ts` L19-40
**Apply to:** `ollama-tokenizer.ts`
- `baseUrl.replace(/\/$/, '')` normalisation.
- `await fetch(...)`, `await res.json() as { ... }` with an inline cast type.
- Wrap network calls in `try { ... } catch { return null/false; }` so sync callers never see a throw.

### Registry / factory map
**Source:** `packages/llm/src/providers/registry.ts` L7-19
**Apply to:** `tokenizer/registry.ts`
- Module-level `const X: Record<string, ...> = { ... };`
- Lookup returns `undefined` for misses; caller decides on throw vs fallback.

### Warn-once dedup
**Source:** inferred from CONTEXT D-08 (no existing analog in codebase).
**Apply to:** `tokenizer/registry.ts`
- `const warnedModels = new Set<string>()` at module scope.
- Guard: `if (warnedModels.has(model)) return; warnedModels.add(model); logger.warn(...)`.

### Logger handle
**Source:** CONTEXT Claude's-Discretion — "match the existing logger already wired into `token-budget.ts` / `agent-service.ts`."
**Finding:** Neither `token-budget.ts` nor `agent-service.ts` currently imports a logger (grep: no matches for `logger.`, `fastify.log`, `log.warn` in `packages/dashboard/src/agent/`). Planner decision: inject a minimal `{ warn: (msg: string) => void }` interface into the registry (or accept `console.warn` as default) rather than wiring Fastify's logger into a sync utility. This keeps `token-budget.ts` framework-free and testable.

### Sync-safe async warming
**Source:** Novel — no direct analog.
**Apply to:** Ollama path only.
- Async `/api/show` call happens at pre-warm time from AgentService constructor.
- Sync `countTokens` reads from the cache only; miss → char/4 + trigger background warm for next call.
- Guarantees D-04 (sync contract).

---

## No Analog Found

All required files have at least a role-level analog. None require pure greenfield construction.

---

## Metadata

**Analog search scope:** `packages/dashboard/src/agent/`, `packages/dashboard/tests/agent/`, `packages/llm/src/providers/`.
**Files scanned:** ~20.
**Pattern extraction date:** 2026-04-24.
