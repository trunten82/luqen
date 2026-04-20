import type {
  LLMProviderAdapter,
  CompletionOptions,
  CompletionResult,
  RemoteModel,
  ChatMessage,
  StreamFrame,
  ToolCall,
  ToolDef,
} from './types.js';

export class OpenAIAdapter implements LLMProviderAdapter {
  readonly type = 'openai';

  private baseUrl = '';
  private apiKey = '';

  async connect(config: { baseUrl: string; apiKey?: string }): Promise<void> {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey ?? '';
  }

  async disconnect(): Promise<void> {
    this.baseUrl = '';
    this.apiKey = '';
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/v1/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<readonly RemoteModel[]> {
    const res = await fetch(`${this.baseUrl}/v1/models`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    const data = await res.json() as { data: Array<{ id: string }> };
    return data.data.map((m) => ({ id: m.id, name: m.id }));
  }

  async complete(prompt: string, options: CompletionOptions): Promise<CompletionResult> {
    const messages: Array<{ role: string; content: string }> = [];

    if (options.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }

    messages.push({ role: 'user', content: prompt });

    const body = {
      model: options.model,
      messages,
      max_tokens: options.maxTokens,
      temperature: options.temperature,
    };

    const timeoutMs = options.timeout ? options.timeout * 1000 : undefined;
    const signal = timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined;

    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    const data = await res.json() as {
      choices: Array<{ message: { content: string } }>;
      usage: { prompt_tokens: number; completion_tokens: number };
    };

    return {
      text: data.choices[0].message.content,
      usage: {
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens,
      },
    };
  }

  /**
   * Token-level streaming + provider-native tool calls.
   *
   * D-11 buffering contract:
   *  - Plain `delta.content` chunks yield `token` frames in order.
   *  - `delta.tool_calls[].function.arguments` fragments are accumulated per
   *    tool-call `index`. ZERO token frames are emitted for tool-call JSON.
   *  - On `finish_reason === 'tool_calls'`, accumulated args are JSON.parsed
   *    once and exactly ONE `tool_calls` frame is yielded.
   *  - Final terminal frame is always `done` (with finishReason) or `error`.
   */
  async *completeStream(
    messages: readonly ChatMessage[],
    options: CompletionOptions & { readonly tools?: readonly ToolDef[] },
    signal?: AbortSignal,
  ): AsyncIterable<StreamFrame> {
    if (signal?.aborted) {
      yield {
        type: 'error',
        code: 'provider_failed',
        message: 'aborted before request',
        retryable: false,
      };
      return;
    }

    const openAiMessages = toOpenAIMessages(messages);
    const body = {
      model: options.model,
      messages: openAiMessages,
      tools: options.tools?.map(toOpenAITool),
      stream: true,
      stream_options: { include_usage: true },
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? 2048,
    };

    const timeoutMs = options.timeout ? options.timeout * 1000 : undefined;
    const controller = new AbortController();
    const signals: AbortSignal[] = [controller.signal];
    if (signal) signals.push(signal);
    if (timeoutMs) signals.push(AbortSignal.timeout(timeoutMs));
    const mergedSignal = anySignal(signals);

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: mergedSignal,
      });
    } catch (err) {
      yield {
        type: 'error',
        code: 'provider_failed',
        message: err instanceof Error ? err.message : String(err),
        retryable: true,
      };
      return;
    }

    if (!res.ok) {
      yield {
        type: 'error',
        code: 'provider_failed',
        message: `OpenAI returned ${res.status} ${res.statusText ?? ''}`.trim(),
        retryable: true,
      };
      return;
    }

    if (!res.body) {
      yield {
        type: 'error',
        code: 'invalid_response',
        message: 'OpenAI response had no body',
        retryable: false,
      };
      return;
    }

    // Buffer for accumulating tool-call argument fragments, keyed by the
    // delta's `index` (what OpenAI uses to disambiguate parallel tool calls).
    const toolBuffer = new Map<number, { id: string; name: string; argsText: string }>();
    let finishReason: 'stop' | 'length' | 'tool_calls' | 'error' = 'stop';
    let usage: { inputTokens: number; outputTokens: number } | undefined;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    try {
      while (true) {
        if (signal?.aborted) {
          yield {
            type: 'error',
            code: 'provider_failed',
            message: 'aborted',
            retryable: false,
          };
          return;
        }
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        // SSE frames are separated by blank lines (\n\n).
        let sepIdx: number;
        while ((sepIdx = buf.indexOf('\n\n')) !== -1) {
          const rawFrame = buf.slice(0, sepIdx);
          buf = buf.slice(sepIdx + 2);

          for (const line of rawFrame.split('\n')) {
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (data === '' || data === '[DONE]') continue;

            let parsed: unknown;
            try {
              parsed = JSON.parse(data);
            } catch {
              // Skip malformed JSON lines — stream may have an incomplete frame.
              continue;
            }

            const chunk = parsed as {
              choices?: Array<{
                delta?: {
                  content?: string;
                  tool_calls?: Array<{
                    index?: number;
                    id?: string;
                    function?: { name?: string; arguments?: string };
                  }>;
                };
                finish_reason?: 'stop' | 'length' | 'tool_calls' | null;
              }>;
              usage?: { prompt_tokens?: number; completion_tokens?: number };
            };

            if (chunk.usage) {
              usage = {
                inputTokens: chunk.usage.prompt_tokens ?? 0,
                outputTokens: chunk.usage.completion_tokens ?? 0,
              };
            }

            const choice = chunk.choices?.[0];
            if (!choice) continue;

            const delta = choice.delta ?? {};

            if (typeof delta.content === 'string' && delta.content.length > 0) {
              yield { type: 'token', text: delta.content };
            }

            if (Array.isArray(delta.tool_calls)) {
              for (const tc of delta.tool_calls) {
                const idx = typeof tc.index === 'number' ? tc.index : 0;
                const existing = toolBuffer.get(idx) ?? { id: '', name: '', argsText: '' };
                const next = {
                  id: tc.id ?? existing.id,
                  name: tc.function?.name ?? existing.name,
                  argsText: existing.argsText + (tc.function?.arguments ?? ''),
                };
                toolBuffer.set(idx, next);
              }
            }

            if (choice.finish_reason) {
              finishReason = choice.finish_reason;
            }
          }
        }
      }
    } catch (err) {
      yield {
        type: 'error',
        code: 'provider_failed',
        message: err instanceof Error ? err.message : String(err),
        retryable: true,
      };
      return;
    }

    if (finishReason === 'tool_calls' && toolBuffer.size > 0) {
      const calls: ToolCall[] = [];
      for (const [, buffered] of [...toolBuffer.entries()].sort((a, b) => a[0] - b[0])) {
        let args: Record<string, unknown>;
        try {
          args = buffered.argsText.length > 0 ? JSON.parse(buffered.argsText) : {};
        } catch {
          yield {
            type: 'error',
            code: 'invalid_response',
            message: `malformed tool_call args for ${buffered.name}`,
            retryable: true,
          };
          return;
        }
        calls.push({ id: buffered.id || buffered.name, name: buffered.name, args });
      }
      yield { type: 'tool_calls', calls };
    }

    yield { type: 'done', finishReason, usage };
  }
}

function toOpenAIMessages(messages: readonly ChatMessage[]): Array<Record<string, unknown>> {
  return messages.map((m) => {
    if (m.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: m.toolCallId,
        content: m.content,
      };
    }
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      return {
        role: 'assistant',
        content: m.content,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.args) },
        })),
      };
    }
    return { role: m.role, content: m.content };
  });
}

function toOpenAITool(tool: ToolDef): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  };
}

/**
 * Minimal polyfill for AbortSignal.any — Node 22+ supports it natively but we
 * fall back to a manual implementation to keep Node 20 support in reach.
 */
function anySignal(signals: readonly AbortSignal[]): AbortSignal {
  const anyFn = (AbortSignal as unknown as { any?: (s: readonly AbortSignal[]) => AbortSignal }).any;
  if (typeof anyFn === 'function') return anyFn(signals);
  const ctrl = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      ctrl.abort(s.reason);
      break;
    }
    s.addEventListener('abort', () => ctrl.abort(s.reason), { once: true });
  }
  return ctrl.signal;
}
