export interface CompletionOptions {
  readonly model: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly systemPrompt?: string;
  readonly timeout?: number; // seconds
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
