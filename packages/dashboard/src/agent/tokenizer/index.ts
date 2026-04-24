/**
 * Phase 34-01 — Tokenizer public surface.
 *
 * Re-exports the stable API used by token-budget.ts and AgentService. Internal
 * backend modules (openai-tokenizer, anthropic-tokenizer, ollama-tokenizer) are
 * NOT re-exported here — callers must go through `countMessageTokens`.
 */

export {
  countMessageTokens,
  resolve,
  prewarmTokenizer,
  PER_MESSAGE_OVERHEAD_TOKENS,
  _resetWarnedForTest,
} from './registry.js';

export { configureOllamaTokenizer } from './ollama-tokenizer.js';

export type {
  TokenizerMessage,
  TokenizerLogger,
  TokenizerRegistry,
  TokenizerRegistryEntry,
} from './types.js';
