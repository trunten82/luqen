/**
 * Phase 34-01 Task 3 — Ollama tokenizer backend (D-03).
 *
 * Ollama exposes no offline tokenizer, so we query `/api/show` once per model
 * to pull tokenizer metadata (details.tokenizer + model_info.*.vocab_size),
 * derive an `avgCharsPerToken` heuristic, and cache per model for the process
 * lifetime.
 *
 * Sync contract (D-04): `countText` is sync and reads the cache only. Cold
 * cache returns `undefined`; caller falls back to char/4 (no warn — the model
 * IS known, just not warm yet). `warm()` is async and dedupes concurrent
 * callers via an in-flight Map.
 *
 * SECURITY:
 *   - T-34-03 (SSRF): `baseUrl` is set ONLY via `configureOllamaTokenizer` at
 *     server bootstrap (not per-request). The `model` string is a JSON body
 *     field, NEVER URL-interpolated.
 *   - T-34-04 (DoS via unbounded cache): hard cap at 32 entries with
 *     oldest-first eviction on overflow.
 *   - T-34-05 (log content): no message content ever logged; only model id.
 */

export interface OllamaTokenizerConfig {
  readonly baseUrl: string;
}

interface CacheEntry {
  readonly tokenizerModel: string | null;
  readonly vocabSize: number | null;
  readonly avgCharsPerToken: number;
}

/** Threshold above which we switch to a tighter chars/token ratio. */
export const LARGE_VOCAB_THRESHOLD = 100_000;

/** Hard cap on cached models to mitigate T-34-04 (DoS via unbounded growth). */
const MAX_CACHE_ENTRIES = 32;

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<void>>();

let config: OllamaTokenizerConfig = {
  baseUrl: (process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434').replace(/\/$/, ''),
};

/**
 * Configure the Ollama base URL. Server bootstrap only — NEVER call this with
 * a request-scoped value (T-34-03 contract). Trailing slash stripped to avoid
 * `//api/show` double-slash.
 */
export function configureOllamaTokenizer(next: OllamaTokenizerConfig): void {
  const trimmed = next.baseUrl.replace(/\/$/, '');
  config = { baseUrl: trimmed };
}

function evictOldestIfFull(): void {
  if (cache.size < MAX_CACHE_ENTRIES) return;
  const firstKey = cache.keys().next().value;
  if (typeof firstKey === 'string') {
    cache.delete(firstKey);
  }
}

/**
 * Populate the cache for `model` by calling `/api/show`. Silent on failure —
 * caller must tolerate a cache miss and fall back to char/4 (D-03).
 * Concurrent callers for the same model share a single in-flight request.
 */
export function warm(model: string): Promise<void> {
  if (cache.has(model)) return Promise.resolve();
  const existing = inflight.get(model);
  if (existing) return existing;

  const p = (async () => {
    try {
      const res = await fetch(`${config.baseUrl}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: model }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        details?: { tokenizer?: string };
        model_info?: Record<string, unknown>;
      };
      const vocabSize = extractVocabSize(data.model_info);
      evictOldestIfFull();
      cache.set(model, {
        tokenizerModel: data.details?.tokenizer ?? null,
        vocabSize,
        avgCharsPerToken:
          vocabSize !== null && vocabSize > LARGE_VOCAB_THRESHOLD ? 3.2 : 3.5,
      });
    } catch {
      // Silent fail — caller falls back to char/4 per D-03.
    } finally {
      inflight.delete(model);
    }
  })();
  inflight.set(model, p);
  return p;
}

/**
 * Sync count for `model` using the cache. Returns `undefined` on miss — caller
 * decides the fallback path. Never throws. Never triggers a fetch.
 */
export function countText(model: string, text: string): number | undefined {
  const entry = cache.get(model);
  if (!entry) return undefined;
  if (text.length === 0) return 0;
  return Math.ceil(text.length / entry.avgCharsPerToken);
}

function extractVocabSize(info: Record<string, unknown> | undefined): number | null {
  if (!info) return null;
  for (const [k, v] of Object.entries(info)) {
    if (k.endsWith('.vocab_size') && typeof v === 'number') return v;
  }
  return null;
}

/** Test-only — clear cache + in-flight state. */
export function _resetOllamaCacheForTest(): void {
  cache.clear();
  inflight.clear();
}
