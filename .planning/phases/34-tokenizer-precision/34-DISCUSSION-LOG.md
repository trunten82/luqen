# Phase 34: Tokenizer Precision - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-24
**Phase:** 34-tokenizer-precision
**Areas discussed:** Library choice per provider, Sync vs async API, Model identification & fallback, Scope of token accounting

---

## Library choice per provider

### OpenAI tokenizer

| Option | Description | Selected |
|--------|-------------|----------|
| js-tiktoken (Recommended) | Pure JS port, ~1 MB, sync, no wasm | ✓ |
| tiktoken (wasm) | Faster, ~1.5–2 MB wasm, async init | |
| gpt-tokenizer | Pure JS alt, tree-shakeable by model | |

**User's choice:** js-tiktoken

### Anthropic tokenizer

| Option | Description | Selected |
|--------|-------------|----------|
| @anthropic-ai/tokenizer (Recommended) | Official JS tokenizer, offline, sync | ✓ |
| Reuse cl100k (tiktoken) | OpenAI encoding as proxy | |
| API count_tokens endpoint | Exact but adds network latency | |
| Keep char/4 for Anthropic | Fallback + warn | |

**User's choice:** @anthropic-ai/tokenizer

### Ollama tokenizer

| Option | Description | Selected |
|--------|-------------|----------|
| llama-tokenizer-js for llama-family (Recommended) | Pure JS, covers llama/mistral/qwen | |
| Ollama /api/show + cached vocab | Fetch tokenizer metadata from server, cache | ✓ |
| Just char/4 fallback | Always fallback + warn | |

**User's choice:** Ollama /api/show + cached vocab
**Notes:** Fall back to char/4 + warning if /api/show fails or metadata is missing.

---

## Sync vs async API

| Option | Description | Selected |
|--------|-------------|----------|
| Keep sync, pre-warm at startup (Recommended) | sync signature, encoders pre-warmed in AgentService | ✓ |
| Make countTokens async | Promise<number>, cleaner for wasm, refactors caller | |
| Sync with first-call fallback | Returns char/4 on first call, loads in background | |

**User's choice:** Keep sync, pre-warm at startup

---

## Model identification & fallback

### Registry

| Option | Description | Selected |
|--------|-------------|----------|
| Explicit registry map (Recommended) | Static table of known models → provider + encoding | ✓ |
| Prefix/provider heuristic | Match by prefix; flexible, less precise | |
| Provider passed explicitly | Caller passes provider + model | |

**User's choice:** Explicit registry map

### Warning cadence

| Option | Description | Selected |
|--------|-------------|----------|
| Once per process per model (Recommended) | Dedupe via in-memory Set | ✓ |
| Every call | Full trail, noisy | |
| Once globally + metric counter | One warning + counter | |

**User's choice:** Once per process per model

---

## Scope of token accounting

### What to include

| Option | Description | Selected |
|--------|-------------|----------|
| Message content (Recommended) | Text content of every message | ✓ |
| Tool-call JSON envelopes (Recommended) | toolCalls args + results, maintains parity with current estimate | ✓ |
| System prompt | System prompt tokens | |
| Tool schema definitions | Registered tool JSON schemas | |

**User's choice:** Message content + Tool-call JSON envelopes (system prompt and tool schemas excluded for this phase)

### Per-message envelope tax

| Option | Description | Selected |
|--------|-------------|----------|
| Add fixed per-message tax (Recommended) | +3–4 tokens/msg for role/separator overhead | ✓ |
| Content-only, no tax | Simpler, slightly underestimates | |
| Per-provider specific overhead | Most accurate, more code | |

**User's choice:** Add fixed per-message tax

---

## Claude's Discretion

- Exact registry entries and encoding names per model
- Pre-warm trigger point inside AgentService
- Logger to use for the unknown-model warning
- Ollama tokenizer cache shape and TTL

## Deferred Ideas

- System-prompt + tool-schema token accounting (out of scope this phase)
- Per-provider envelope-overhead tuning
- Anthropic `/v1/messages/count_tokens` API path
- Metric counter for unknown-model warnings (observability nice-to-have)
