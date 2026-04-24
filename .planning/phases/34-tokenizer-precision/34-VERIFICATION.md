---
phase: 34-tokenizer-precision
verified: 2026-04-24T14:40:00Z
status: passed
score: 12/12 must-haves verified
overrides_applied: 0
requirements:
  - id: TOK-01
    status: satisfied
    evidence: "integration.test.ts A/B/C (OpenAI o200k + cl100k parity, Anthropic sanity band); registry.ts frozen model map"
  - id: TOK-02
    status: satisfied
    evidence: "bundle-size.test.ts 4/4 passing; direct-add 3.93 MB < 5 MB; no *.node files"
  - id: TOK-03
    status: satisfied
    evidence: "token-budget.ts delegates to countMessageTokens; agent-service.ts L282 passes this.config.modelId; shouldCompact byte-identical"
  - id: TOK-04
    status: satisfied
    evidence: "countMessageTokens sync signature; estimateTokens sync; no await in hot path; prewarmTokenizer fire-and-forget"
  - id: TOK-05
    status: satisfied
    evidence: "integration.test.ts F: 3 unknown-model calls → exactly 1 warn; warnedModels Set dedup in registry.ts"
---

# Phase 34: Tokenizer Precision — Verification Report

**Phase Goal:** Replace the char/4 token-estimate heuristic with precise per-provider token counts (OpenAI via js-tiktoken, Anthropic via @anthropic-ai/tokenizer, Ollama via /api/show vocab cache) behind a sync public surface, with char/4 fallback for unknown models and warn-once dedup.

**Verified:** 2026-04-24T14:40:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | countMessageTokens returns precise per-provider counts for OpenAI/Anthropic/Ollama | VERIFIED | registry.ts:110+ provider switch; integration.test.ts A/B/C pass |
| 2 | Unknown models fall through to char/4 fallback (D-07) | VERIFIED | registry.ts warnUnknownModelOnce + char/4 path; integration D pass |
| 3 | Warning logged once per process per unknown model (D-08) | VERIFIED | warnedModels Set in registry.ts:53; integration F pass (3 calls → 1 warn) |
| 4 | All backends sync at hot path; Ollama async warm via prewarmTokenizer only (D-03, D-04) | VERIFIED | token-budget.ts estimateTokens sync; ollama.warm fire-and-forget at registry.ts:125 |
| 5 | Bundle impact <5 MB, pure JS/wasm only (TOK-02) | VERIFIED | bundle-size.test.ts: 3.93 MB direct-add; no *.node files |
| 6 | estimateTokens delegates to countMessageTokens preserving sync signature | VERIFIED | token-budget.ts:38 `return countMessageTokens(...)` |
| 7 | shouldCompact bit-identical to pre-phase behaviour | VERIFIED | token-budget.ts:42 `tokens > Math.floor(max * COMPACTION_THRESHOLD)` |
| 8 | AgentService call site (L282) passes this.config.modelId | VERIFIED | agent-service.ts:282 `this.config.modelId` in estimateTokens args |
| 9 | AgentService constructor fires prewarmTokenizer without blocking (D-05) | VERIFIED | agent-service.ts:208-209 `void prewarmTokenizer(this.config.modelId)` |
| 10 | System prompt excluded (D-10) | VERIFIED | registry.ts:155 `if (m.role === 'system') continue` |
| 11 | Tool-call envelopes included (D-09) | VERIFIED | registry.ts sums JSON.stringify(toolCalls); integration G pass |
| 12 | Monotonicity preserved across all backends | VERIFIED | monotonicity.test.ts 5/5 pass (char/4, gpt-4o, claude, llama cold+warm) |

**Score:** 12/12 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/agent/tokenizer/registry.ts` | MODEL_REGISTRY + countMessageTokens + warn-once | VERIFIED | 188 lines; Object.freeze, hasOwnProperty.call, warnedModels Set, all 16 entries |
| `src/agent/tokenizer/openai-tokenizer.ts` | getOpenAiEncoder + js-tiktoken | VERIFIED | 60 lines; js-tiktoken imported, cache.get/set present |
| `src/agent/tokenizer/anthropic-tokenizer.ts` | getAnthropicEncoder + @anthropic-ai/tokenizer | VERIFIED | 44 lines; singleton pattern |
| `src/agent/tokenizer/ollama-tokenizer.ts` | /api/show, inflight dedup, LARGE_VOCAB_THRESHOLD, LRU cap | VERIFIED | 129 lines; all four patterns present |
| `src/agent/tokenizer/types.ts` | TokenizerMessage, TokenizerRegistry, TokenizerLogger | VERIFIED | 32 lines |
| `src/agent/tokenizer/index.ts` | Re-exports | VERIFIED | 24 lines |
| `src/agent/token-budget.ts` | Delegates to countMessageTokens | VERIFIED | 46 lines; no `chars / 4` arithmetic remains |
| `src/agent/agent-service.ts` | modelId config + prewarm + threaded at call site | VERIFIED | modelId twice (lines 161, 192); prewarm line 209; call site line 282 |
| `package.json` | js-tiktoken + @anthropic-ai/tokenizer deps | VERIFIED | js-tiktoken ^1.0.21, @anthropic-ai/tokenizer ^0.0.4 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| registry.ts countMessageTokens | openai/anthropic/ollama tokenizer | provider switch | WIRED | Direct imports; provider branching at registry.ts:110+ |
| ollama-tokenizer.ts warm | OLLAMA_BASE_URL/api/show | fetch POST | WIRED | Line 78 `fetch(\`${config.baseUrl}/api/show\`, ...)` |
| token-budget.ts estimateTokens | tokenizer/index.ts countMessageTokens | direct import | WIRED | token-budget.ts:15 import |
| agent-service.ts constructor | tokenizer/index.ts prewarmTokenizer | fire-and-forget | WIRED | Line 209 `void prewarmTokenizer(this.config.modelId)` |
| agent-service.ts runTurn | token-budget.ts estimateTokens | function call with modelId | WIRED | Line 282 passes modelId |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full tokenizer test suite | `npx vitest run tests/agent/tokenizer/` | 7 files, 48 tests passed | PASS |
| No native binaries | `find node_modules/{js-tiktoken,@anthropic-ai} -name "*.node"` | empty | PASS |
| token-budget.ts has no char/4 arithmetic | grep `chars / 4` in token-budget.ts | no matches | PASS |
| Commits from SUMMARY exist | git log for bccf642 d77fa9a 9607e50 cfcbedc b9447a5 0893dac 4a2a182 5f511b6 e6064c5 d7015d3 | all resolve | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| TOK-01 | 34-01 | Replace char/4 with per-provider tokenizer (Ollama/OpenAI/Anthropic) | SATISFIED | integration.test.ts A/B/C; three backend files + registry dispatch |
| TOK-02 | 34-01, 34-03 | Bundle <5 MB, no native deps | SATISFIED | bundle-size.test.ts: 3.93 MB direct-add; 0 .node files |
| TOK-03 | 34-02, 34-03 | 85% compaction fires on precise counts | SATISFIED | agent-service.ts:282 threads modelId; token-budget delegates |
| TOK-04 | 34-01, 34-02 | Single sync countTokens(messages, model) interface | SATISFIED | countMessageTokens sync; estimateTokens sync wrapper |
| TOK-05 | 34-01, 34-03 | Unknown model → char/4 + warning log | SATISFIED | integration.test.ts F: 3 calls → 1 warn containing model name |

### Anti-Patterns Found

None. No TODO/FIXME/placeholder content in the tokenizer module or modified files.

### Gaps Summary

No gaps. Phase 34 meets all four ROADMAP success criteria and all five TOK requirements.

**Minor note (not a gap):** SUMMARY 34-01 claimed a follow-up commit `cfcbedc` rewrote the eviction guard to the literal `cache.size >= 32` to match the plan's grep acceptance criterion. Current `ollama-tokenizer.ts:58` reads `cache.size >= MAX_CACHE_ENTRIES` (with `const MAX_CACHE_ENTRIES = 32` on line 37). This is semantically equivalent, the test `ollama-tokenizer.test.ts` verifies eviction behaviour passes, and the T-34-04 threat is mitigated. The literal-grep acceptance criterion from Plan 34-01 §Task 3 is technically not matched by the current code, but the behaviour is correct. Treat as an acceptance-criterion wording deviation, not a functional gap.

---

_Verified: 2026-04-24T14:40:00Z_
_Verifier: Claude (gsd-verifier)_
