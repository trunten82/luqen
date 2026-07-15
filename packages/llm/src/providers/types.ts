/**
 * A single image attached to an LLM request (Phase 84 vision adapter).
 *
 * `data` is the raw base64-encoded image payload WITHOUT any `data:` URI
 * prefix — each adapter wraps it in the provider-native shape (Anthropic
 * base64 source, OpenAI `data:` URL, Ollama bare base64 array).
 */
export interface ImageInput {
  readonly mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  readonly data: string;
}

export interface CompletionOptions {
  readonly model: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly systemPrompt?: string;
  readonly timeout?: number; // seconds
  /**
   * Images to attach to the single user turn of a `complete()` call (Phase 84
   * vision adapter). Providers that cannot accept images on the selected model
   * will reject at the API layer; callers gate on model vision-capability.
   */
  readonly images?: readonly ImageInput[];
}

export interface CompletionResult {
  readonly text: string;
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
  };
}

export interface RemoteModel {
  readonly id: string;
  readonly name: string;
}

// ----------------------------------------------------------------------
// Typed provider errors + non-retryable classification (Quick 260715-pg9)
// ----------------------------------------------------------------------

/**
 * Shared marker interface for provider errors carrying an explicit retry
 * disposition. `isNonRetryable()` looks for this shape rather than a
 * specific class so future error types can opt in without changing the
 * classification helper.
 */
export interface RetryClassifiedError {
  readonly retryable: boolean;
}

/**
 * Thrown by adapter `complete()` implementations when the upstream HTTP
 * response is non-2xx. Carries the upstream status + a truncated copy of
 * the response body so capability retry loops and route logging can
 * surface the real cause (e.g. "410 ... retired") instead of a bare
 * TypeError from destructuring an error-shaped body.
 *
 * `retryable` classification: 429 and 5xx are transient (true); any other
 * 4xx (including 410) is deterministic and non-retryable (false).
 */
export class ProviderHttpError extends Error implements RetryClassifiedError {
  readonly retryable: boolean;
  readonly status: number;
  readonly upstreamText: string;

  constructor(status: number, upstreamText: string, retryable: boolean) {
    const truncated = upstreamText.slice(0, 500);
    super(`Provider returned HTTP ${status}: ${truncated}`);
    this.name = 'ProviderHttpError';
    this.status = status;
    this.upstreamText = truncated;
    this.retryable = retryable;
  }
}

/**
 * Thrown by adapter `complete()` implementations when a 2xx response body
 * does not match the expected success shape (e.g. missing `message.content`).
 * Always non-retryable — retrying an unexpectedly-shaped 2xx response will
 * not change the outcome.
 */
export class ProviderResponseShapeError extends Error implements RetryClassifiedError {
  readonly retryable = false;

  constructor(message: string) {
    super(message);
    this.name = 'ProviderResponseShapeError';
  }
}

/**
 * Classify an HTTP status code into a retry disposition:
 *  - 429 (rate limited) → retryable
 *  - 5xx (upstream/server error) → retryable
 *  - any other 4xx (incl. 410 Gone) → non-retryable (deterministic)
 */
export function classifyHttpRetryable(status: number): boolean {
  if (status === 429) return true;
  if (status >= 500) return true;
  return false;
}

/**
 * True when `err` is explicitly classified as non-retryable (e.g. a 410 or
 * other deterministic 4xx `ProviderHttpError`, or a `ProviderResponseShapeError`).
 * Errors with no retry classification (network errors, unknown throwables)
 * default to `false` (retryable) — this preserves existing retry behaviour
 * for anything not explicitly classified.
 */
export function isNonRetryable(err: unknown): boolean {
  if (err && typeof err === 'object' && 'retryable' in err) {
    return (err as RetryClassifiedError).retryable === false;
  }
  return false;
}

// ----------------------------------------------------------------------
// Streaming contract (Phase 32-01, D-11 / D-12)
// ----------------------------------------------------------------------

export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string;
  /** For role='tool' — the provider-assigned id of the tool_use being answered. */
  readonly toolCallId?: string;
  /** For role='tool' on Ollama which keys results by tool name. */
  readonly toolName?: string;
  /** For role='assistant' — the tool calls the assistant emitted this turn. */
  readonly toolCalls?: ReadonlyArray<ToolCall>;
  /**
   * For role='user' — images attached to this turn (Phase 84 vision adapter).
   * Adapters render these into provider-native multimodal content blocks.
   */
  readonly images?: readonly ImageInput[];
}

export interface ToolDef {
  readonly name: string;
  readonly description: string;
  /** JSON Schema shape (e.g. zod .toJSONSchema() output). */
  readonly inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly args: Record<string, unknown>;
}

/**
 * Unified streaming frame shape emitted by every provider adapter's
 * `completeStream()` generator. Consumers (capability engine, AgentService)
 * rely on this shape being identical across Ollama, OpenAI, and Anthropic
 * so provider fallback does not produce visible drift.
 */
export type StreamFrame =
  | { readonly type: 'token'; readonly text: string }
  | { readonly type: 'tool_calls'; readonly calls: ReadonlyArray<ToolCall> }
  | {
      readonly type: 'done';
      readonly finishReason: 'stop' | 'length' | 'tool_calls' | 'error';
      readonly usage?: { readonly inputTokens: number; readonly outputTokens: number };
    }
  | {
      readonly type: 'error';
      readonly code: 'provider_failed' | 'timeout' | 'invalid_response';
      readonly message: string;
      readonly retryable: boolean;
    };

export interface LLMProviderAdapter {
  readonly type: string;
  connect(config: { baseUrl: string; apiKey?: string }): Promise<void>;
  disconnect(): Promise<void>;
  healthCheck(): Promise<boolean>;
  listModels(): Promise<readonly RemoteModel[]>;
  complete(prompt: string, options: CompletionOptions): Promise<CompletionResult>;
  /**
   * Token-level streaming with provider-native tool calls. Optional on the
   * interface so existing non-streaming capabilities (extract-requirements,
   * generate-fix, analyse-report, discover-branding) remain unaffected.
   *
   * Contract invariants (D-11):
   *  - `token` frames only for user-visible text deltas (never for tool_call argument JSON).
   *  - Exactly ONE `tool_calls` frame per turn — emitted AFTER all `token` frames.
   *  - Exactly ONE terminal `done` or `error` frame.
   */
  completeStream?(
    messages: readonly ChatMessage[],
    options: CompletionOptions & { readonly tools?: readonly ToolDef[] },
    signal?: AbortSignal,
  ): AsyncIterable<StreamFrame>;
}
