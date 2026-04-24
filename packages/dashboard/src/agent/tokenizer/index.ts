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
  PER_MESSAGE_OVERHEAD_TOKENS,
  _resetWarnedForTest,
} from './registry.js';

export type {
  TokenizerMessage,
  TokenizerLogger,
  TokenizerRegistry,
  TokenizerRegistryEntry,
} from './types.js';

/**
 * Pre-warm an encoder for a given model. Task 1 stub — real warming lands in
 * Task 3 once the three backends exist.
 */
export async function prewarmTokenizer(_model: string): Promise<void> {
  return Promise.resolve();
}
