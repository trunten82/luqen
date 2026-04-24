/**
 * Phase 34-01 — Tokenizer module public types (TOK-01..05).
 *
 * Kept framework-free so token-budget.ts remains testable without wiring
 * Fastify's logger into a sync utility.
 */

export interface TokenizerMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content?: string | null;
  readonly toolCalls?: ReadonlyArray<{ id?: string; name: string; args: unknown }>;
}

export interface TokenizerLogger {
  warn(msg: string): void;
}

export interface TokenizerRegistryEntry {
  readonly provider: 'openai' | 'anthropic' | 'ollama';
  /** OpenAI-only; e.g. 'cl100k_base' | 'o200k_base'. */
  readonly encoding?: string;
}

export interface TokenizerRegistry {
  resolve(model: string): TokenizerRegistryEntry | undefined;
  countMessageTokens(
    messages: ReadonlyArray<TokenizerMessage>,
    model: string | undefined,
    logger?: TokenizerLogger,
  ): number;
  prewarm(model: string): Promise<void>;
}
