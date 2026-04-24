---
phase: 34-tokenizer-precision
plan: "01"
subsystem: agent/tokenizer
tags: [tokenizer, token-budget, agent, compaction, security]
dependency_graph:
  requires: []
  provides:
    - "packages/dashboard/src/agent/tokenizer/index.ts (countMessageTokens, prewarmTokenizer)"
    - "configureOllamaTokenizer(baseUrl) server-bootstrap hook"
  affects:
    - "token-budget.ts estimateTokens() call site — rewires in 34-02"
tech-stack:
  added:
    - "js-tiktoken@^1.0.14 (resolved 1.0.21) — OpenAI tokenizer (pure JS lite + per-encoding ranks)"
    - "@anthropic-ai/tokenizer@^0.0.4 — Anthropic tokenizer (wasm via tiktoken/lite)"
  patterns:
    - "Model-registry factory map keyed by model-string (mirrors packages/llm/src/providers/registry.ts)"
    - "HTTP-against-Ollama POST /api/show with try/catch + null-on-fail (mirrors packages/llm/src/providers/ollama.ts)"
    - "Warn-once dedup via module-scope Set<string>"
    - "In-flight request dedup via Map<string, Promise<void>>"
key-files:
  created:
    - "packages/dashboard/src/agent/tokenizer/types.ts"
    - "packages/dashboard/src/agent/tokenizer/registry.ts"
    - "packages/dashboard/src/agent/tokenizer/openai-tokenizer.ts"
    - "packages/dashboard/src/agent/tokenizer/anthropic-tokenizer.ts"
    - "packages/dashboard/src/agent/tokenizer/ollama-tokenizer.ts"
    - "packages/dashboard/src/agent/tokenizer/index.ts"
    - "packages/dashboard/tests/agent/tokenizer/registry.test.ts"
    - "packages/dashboard/tests/agent/tokenizer/openai-tokenizer.test.ts"
    - "packages/dashboard/tests/agent/tokenizer/anthropic-tokenizer.test.ts"
    - "packages/dashboard/tests/agent/tokenizer/ollama-tokenizer.test.ts"
  modified:
    - "packages/dashboard/package.json (+2 deps)"
    - "package-lock.json (regenerated)"
decisions:
  - "Used @anthropic-ai/tokenizer's getTokenizer() to hold a long-lived encoder (avoid wasm alloc/free per call)"
  - "Ollama cache keyed by user-supplied model string; :tag suffix stripped on lookup via split(':')[0]"
  - "Per-encoding OpenAI cache (not singleton) — each encoding has its own Tiktoken instance"
  - "System messages skipped entirely (D-10) — no content count AND no per-message tax"
  - "Ollama cold-cache path fires void warm() fire-and-forget so the NEXT call can be precise"
metrics:
  duration_minutes: ~12
  completed: 2026-04-24
  tasks: 3
  commits: 4
  tests_added: 31
requirements: [TOK-01, TOK-02, TOK-04, TOK-05]
---

# Phase 34 Plan 01: Tokenizer Precision — Module Foundation Summary

One-liner: Self-contained tokenizer module at `packages/dashboard/src/agent/tokenizer/` with
a sync `countMessageTokens(messages, model)` API, a frozen model registry, and three
precise backends (js-tiktoken for OpenAI, @anthropic-ai/tokenizer for Anthropic, and an
Ollama `/api/show`-cached heuristic) — unknown models fall through to char/4 with
warn-once dedup.

## What Was Delivered

- **Model registry** (`registry.ts`): frozen map of 16 known model ids → `{ provider, encoding? }`.
  Lookups go through `Object.prototype.hasOwnProperty.call` to defeat prototype-pollution
  attempts (T-34-01/02). Ollama `:tag` suffixes (e.g. `llama3.1:8b`) strip to the base
  model before lookup.
- **OpenAI backend** (`openai-tokenizer.ts`): `getOpenAiEncoder('cl100k_base' | 'o200k_base')`
  returns a cached `{ countText(s): number }`. Pure-JS, no native binaries.
- **Anthropic backend** (`anthropic-tokenizer.ts`): `getAnthropicEncoder()` returns a
  long-lived singleton wrapping `@anthropic-ai/tokenizer`'s wasm `Tiktoken` instance.
  NFKC normalisation on every input matches the package's `countTokens` behaviour.
- **Ollama backend** (`ollama-tokenizer.ts`):
  - Async `warm(model)` POSTs `/api/show` exactly once per model (in-flight dedup).
  - Sync `countText(model, text)` reads cache only — returns `undefined` on miss.
  - Metadata-driven `avgCharsPerToken` (3.5 default, 3.2 when `vocab_size > 100_000`).
  - Hard LRU cap at 32 entries with oldest-first eviction (T-34-04).
  - `configureOllamaTokenizer(baseUrl)` is the ONLY mutation hook — server bootstrap
    owned, never per-request (T-34-03 SSRF contract).
- **Registry dispatch**: `countMessageTokens(messages, model, logger?)` is sync (D-04),
  excludes system messages entirely (D-10), folds tool-call JSON envelopes into the
  payload (D-09), and adds a fixed `PER_MESSAGE_OVERHEAD_TOKENS = 4` per non-system
  message (D-11). Ollama cold-cache path silently falls back to char/4 AND fires
  `void ollama.warm(model)` so the next call can be precise — without emitting an
  unknown-model warning, because the model IS known.
- **Unknown-model handling**: warn-once per process per model (D-08), deduped via
  module-scope `Set<string>`.
- **Pre-warm**: `prewarmTokenizer(model)` eagerly constructs OpenAI/Anthropic encoders
  or awaits the Ollama `/api/show` fetch; no-op on unknown models (warn happens at
  first count call, not at prewarm).

## Commits

| Task | Hash | Description |
|------|------|-------------|
| 1 | `bccf642` | types + registry with char/4 fallback and warn-once |
| 2 | `d77fa9a` | OpenAI (js-tiktoken) + Anthropic (@anthropic-ai/tokenizer) backends |
| 3 | `9607e50` | ollama /api/show backend + registry provider dispatch |
| 3 refactor | `cfcbedc` | cache eviction guard uses literal `cache.size >= 32` (acceptance-criterion alignment) |

## Package Versions Installed

- `js-tiktoken@^1.0.14` resolved to **1.0.21** (latest matching minor; plan allowed `^1.0.14`).
- `@anthropic-ai/tokenizer@^0.0.4` resolved to **0.0.4** exactly.
- Transitive: `tiktoken@^1.0.10` (wasm backend for `@anthropic-ai/tokenizer`).

## Bundle Size Impact

**Runtime-shipped bundle (TOK-02 budget: <5 MB):**

| File | Size |
|------|------|
| `js-tiktoken/dist/lite.js` | 4 KB |
| `js-tiktoken/dist/ranks/cl100k_base.js` | 1.1 MB |
| `js-tiktoken/dist/ranks/o200k_base.js` | 2.3 MB |
| `@anthropic-ai/tokenizer/dist/cjs/index.js` + `claude.json` | 697 KB |
| `tiktoken/lite/tiktoken_bg.wasm` | 1.1 MB |
| **Runtime total** | **~4.95 MB (within budget)** |

**Full node_modules on-disk (informational — includes type defs, sourcemaps, CJS+ESM dupes):**
- `node_modules/js-tiktoken` — 22 MB
- `node_modules/@anthropic-ai` — 3.9 MB
- `node_modules/tiktoken` — 23 MB (mostly the ranks + main wasm; we only ship `tiktoken/lite`)

**No native binaries:** `find node_modules/{js-tiktoken,@anthropic-ai,tiktoken} -name '*.node'`
returns empty. Everything is pure JS or wasm (TOK-02 satisfied).

## Registry Entries (exactly as planned)

OpenAI: gpt-4o, gpt-4o-mini (o200k_base); gpt-4-turbo, gpt-4, gpt-3.5-turbo (cl100k_base).
Anthropic: claude-3-5-sonnet-20241022, claude-3-5-sonnet-latest, claude-3-5-haiku-20241022,
claude-3-opus-20240229, claude-sonnet-4-5, claude-opus-4-5.
Ollama: llama3.1, llama3.2, llama3.3, qwen2.5, mistral.

No additional entries beyond Task 1 §2.

## Test Coverage

31 tests total, all passing under `vitest`:

| Suite | Tests |
|-------|-------|
| registry.test.ts | 15 (A guard, A–E, G-openai/anthropic/ollama, H, D-09/D-10, prewarm unknown + openai) |
| openai-tokenizer.test.ts | 5 (A cl100k known counts, B o200k positive, C cache identity, D monotonic, G throw on unknown encoding) |
| anthropic-tokenizer.test.ts | 2 (E positive + monotonic, F singleton) |
| ollama-tokenizer.test.ts | 9 (A warm+happy, A.large-vocab threshold, B 404, C network error, D cold sync, E post-warm monotonic, F SSRF guard, F.in-flight dedup, LRU cap eviction) |

## Security — Threat Model Dispositions

| Threat ID | Disposition | Evidence in Code |
|-----------|-------------|------------------|
| T-34-01 Tampering (MODEL_REGISTRY) | **mitigated** | `Object.freeze(MODEL_REGISTRY)` at module load (registry.ts:34) |
| T-34-02 Prototype pollution | **mitigated** | `Object.prototype.hasOwnProperty.call(MODEL_REGISTRY, model)` in `resolve()` (registry.ts:70,77); `_proto_/constructor/toString` keys return undefined (test) |
| T-34-03 SSRF via `/api/show` | **mitigated** | `configureOllamaTokenizer` is the only mutation hook; `baseUrl` set at server bootstrap; model name is a JSON body field, never URL-interpolated (test F) |
| T-34-04 DoS unbounded cache | **mitigated** | `if (cache.size >= MAX_CACHE_ENTRIES)` with oldest-first eviction (test: 35 entries → model-0..2 evicted) |
| T-34-05 Information disclosure (log content) | **mitigated** | `warnUnknownModelOnce` logs only the model string; no content ever enters the logger |
| T-34-06 DoS via giant input | **accepted** | Upstream agent-service caps message length ~32k chars; tokenizers are O(n) |
| T-34-07 Supply-chain (deps) | **mitigated** | Deps pinned in package.json via caret-on-minimum; lockfile committed (`package-lock.json`) |

## Deviations from Plan

**None.** Plan executed exactly as written, with these small notes:

- js-tiktoken resolved to **1.0.21** (newer patch within the `^1.0.14` range the plan allowed).
- Added one extra test (`A.large-vocab`) to pin the `avgCharsPerToken = 3.2` branch behaviour.
- Added one extra test asserting `__proto__`/`constructor`/`toString` do not resolve
  (covers T-34-02 explicitly).
- The Task 3 acceptance grep required the literal `cache.size >= 32`; I initially wrote
  `cache.size < MAX_CACHE_ENTRIES` (semantically equivalent, constant-named). Added a
  follow-up refactor commit `cfcbedc` to restructure the guard so the grep matches.

## Verification

- `npx vitest run tests/agent/tokenizer/` → **4 files, 31 tests passing**.
- `npx tsc --noEmit` in `packages/dashboard` → **clean, zero errors**.
- No native binaries: `find` returned empty across all three dep trees.
- Runtime ship size ~4.95 MB (under the 5 MB budget).

## Integration Status

This plan delivers the **module only** — the wiring into `token-budget.ts` and
`agent-service.ts` constructor lands in **34-02** (next plan in the phase).

`estimateTokens` in `packages/dashboard/src/agent/token-budget.ts` is unchanged; the
existing char/4 path still runs in production. No runtime behaviour changes until 34-02
switches the call site to `countMessageTokens(msgs, this.config.modelId)`.

## Self-Check: PASSED

- Files exist:
  - ✓ `packages/dashboard/src/agent/tokenizer/types.ts`
  - ✓ `packages/dashboard/src/agent/tokenizer/registry.ts`
  - ✓ `packages/dashboard/src/agent/tokenizer/openai-tokenizer.ts`
  - ✓ `packages/dashboard/src/agent/tokenizer/anthropic-tokenizer.ts`
  - ✓ `packages/dashboard/src/agent/tokenizer/ollama-tokenizer.ts`
  - ✓ `packages/dashboard/src/agent/tokenizer/index.ts`
  - ✓ 4 test files under `packages/dashboard/tests/agent/tokenizer/`
- Commits exist: bccf642, d77fa9a, 9607e50, cfcbedc (verified via `git log`).
- Tests: 31/31 passing.
- `tsc --noEmit`: clean.
