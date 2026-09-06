/**
 * `createFixtureAdapter` — a `LLMProviderAdapter` that answers with a
 * pre-recorded response text, keyed by the reference-set item id currently
 * being run (Phase 84, HARNESS-01).
 *
 * When the current item id has no recorded response, this THROWS a named
 * error carrying the missing id. It never returns an empty string and never
 * falls back to a default: a fixture that silently answered for an
 * unrecorded item would make a missing fixture look like a model that
 * produced nothing at all — precisely the confusion HARNESS-06's rawText
 * field exists to remove.
 */
import type { LLMProviderAdapter, CompletionResult, RemoteModel } from '../providers/types.js';

export class MissingFixtureResponseError extends Error {
  constructor(public readonly itemId: string) {
    super(`No fixture response recorded for item "${itemId}"`);
    this.name = 'MissingFixtureResponseError';
  }
}

export interface FixtureAdapterOptions {
  /** Pre-recorded response text, keyed by reference-set item id. */
  readonly responsesByItemId: Readonly<Record<string, string>>;
  /** Returns the id of the item currently being scored. */
  readonly currentItemId: () => string;
}

export function createFixtureAdapter(options: FixtureAdapterOptions): LLMProviderAdapter {
  return {
    type: 'fixture',
    connect: async () => {},
    disconnect: async () => {},
    healthCheck: async () => true,
    listModels: async (): Promise<readonly RemoteModel[]> => [],
    complete: async (): Promise<CompletionResult> => {
      const itemId = options.currentItemId();
      const text = options.responsesByItemId[itemId];
      if (text === undefined) {
        throw new MissingFixtureResponseError(itemId);
      }
      return { text, usage: { inputTokens: 0, outputTokens: 0 } };
    },
  };
}
