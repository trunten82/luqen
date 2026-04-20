import Anthropic from '@anthropic-ai/sdk';
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

/**
 * Anthropic provider adapter (D-12) wrapping `@anthropic-ai/sdk`.
 *
 * Implements the full `LLMProviderAdapter` contract including
 * `completeStream()` with token-level deltas and a single buffered
 * `tool_calls` frame emitted AFTER all `token` frames (D-11 ordering
 * invariant at the adapter level).
 *
 * Per AI-SPEC §3 Pitfall 2 we use `client.messages.stream({...}).finalMessage()`
 * to assemble `tool_use.input` objects from the SDK's `input_json_delta`
 * partial-JSON fragments — we never roll our own partial-JSON parser.
 */
export class AnthropicAdapter implements LLMProviderAdapter {
  readonly type = 'anthropic';

  private client: Anthropic | null = null;
  private apiKey = '';

  async connect(config: { baseUrl: string; apiKey?: string }): Promise<void> {
    this.apiKey = config.apiKey ?? '';
    this.client = new Anthropic({ apiKey: this.apiKey });
  }

  async disconnect(): Promise<void> {
    this.client = null;
    this.apiKey = '';
  }

  async healthCheck(): Promise<boolean> {
    return this.client !== null;
  }

  async listModels(): Promise<readonly RemoteModel[]> {
    // Curated list of Phase 32 target models. Anthropic does expose a Models
    // API but it requires an authenticated call; for bootstrap and offline
    // development we return the pinned set used by the agent-conversation
    // capability (AI-SPEC §4 Model Configuration).
    return [
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
      { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' },
    ];
  }

  async complete(prompt: string, options: CompletionOptions): Promise<CompletionResult> {
    if (!this.client) {
      throw new Error('AnthropicAdapter not connected — call connect() first');
    }

    const createParams: Record<string, unknown> = {
      model: options.model,
      max_tokens: options.maxTokens ?? 2048,
      temperature: options.temperature ?? 0.3,
      messages: [{ role: 'user', content: prompt }],
    };
    if (options.systemPrompt) {
      createParams.system = options.systemPrompt;
    }

    const createFn = this.client.messages.create as unknown as (
      p: Record<string, unknown>,
    ) => Promise<unknown>;
    const res = (await createFn(createParams)) as {
      content: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    const textBlock = res.content.find((b) => b.type === 'text');
    return {
      text: textBlock?.text ?? '',
      usage: {
        inputTokens: res.usage?.input_tokens ?? 0,
        outputTokens: res.usage?.output_tokens ?? 0,
      },
    };
  }

  /**
   * Token-level streaming via `client.messages.stream({...})`.
   *
   * Ordering invariant (D-11 at adapter level):
   *  - All `content_block_delta` → `text_delta` events yield `token` frames IN ORDER.
   *  - `input_json_delta` partial_json events are IGNORED — the assembled
   *    object comes from `stream.finalMessage()`.
   *  - After the event loop, we inspect `finalMessage.content` for any
   *    `tool_use` blocks and emit exactly ONE `tool_calls` frame IF present.
   *  - Terminal `done` frame with `finishReason: 'tool_calls' | 'stop'`.
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
        message: 'aborted before stream',
        retryable: false,
      };
      return;
    }
    if (!this.client) {
      yield {
        type: 'error',
        code: 'provider_failed',
        message: 'AnthropicAdapter not connected',
        retryable: false,
      };
      return;
    }

    const { system, anthropicMessages } = splitSystemMessages(messages);

    const streamParams: Record<string, unknown> = {
      model: options.model,
      max_tokens: options.maxTokens ?? 2048,
      temperature: options.temperature ?? 0.3,
      messages: anthropicMessages,
    };
    if (system) streamParams.system = system;
    if (options.tools && options.tools.length > 0) {
      streamParams.tools = options.tools.map(toAnthropicTool);
    }

    type AnthropicStream = AsyncIterable<unknown> & {
      finalMessage: () => Promise<{
        content: Array<
          | { type: 'text'; text: string }
          | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
        >;
        usage?: { input_tokens?: number; output_tokens?: number };
      }>;
      abort?: () => void;
    };

    let stream: AnthropicStream;
    try {
      const streamFn = this.client.messages.stream as (
        p: Record<string, unknown>,
        o?: { signal?: AbortSignal },
      ) => AnthropicStream;
      stream = streamFn(streamParams, { signal });
    } catch (err) {
      yield {
        type: 'error',
        code: 'provider_failed',
        message: err instanceof Error ? err.message : String(err),
        retryable: true,
      };
      return;
    }

    try {
      for await (const event of stream) {
        if (signal?.aborted) {
          stream.abort?.();
          yield {
            type: 'error',
            code: 'provider_failed',
            message: 'aborted',
            retryable: false,
          };
          return;
        }

        const ev = event as {
          type?: string;
          delta?: { type?: string; text?: string; partial_json?: string };
        };

        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
          const text = ev.delta.text ?? '';
          if (text.length > 0) {
            yield { type: 'token', text };
          }
        }
        // input_json_delta fragments are intentionally ignored — the
        // assembled `tool_use.input` object comes from finalMessage().
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

    let final: Awaited<ReturnType<AnthropicStream['finalMessage']>>;
    try {
      final = await stream.finalMessage();
    } catch (err) {
      yield {
        type: 'error',
        code: 'invalid_response',
        message: err instanceof Error ? err.message : String(err),
        retryable: true,
      };
      return;
    }

    const toolUses = final.content.filter(
      (b): b is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } =>
        b.type === 'tool_use',
    );

    if (toolUses.length > 0) {
      const calls: ToolCall[] = toolUses.map((b) => ({
        id: b.id,
        name: b.name,
        args: b.input,
      }));
      yield { type: 'tool_calls', calls };
    }

    const usage = final.usage
      ? {
          inputTokens: final.usage.input_tokens ?? 0,
          outputTokens: final.usage.output_tokens ?? 0,
        }
      : undefined;

    yield {
      type: 'done',
      finishReason: toolUses.length > 0 ? 'tool_calls' : 'stop',
      usage,
    };
  }
}

/**
 * Split an incoming ChatMessage[] into:
 *   - `system`: concatenated text from role='system' messages (Anthropic
 *     takes `system` as a top-level parameter, NOT a chat message).
 *   - `anthropicMessages`: user/assistant/tool messages mapped to the
 *     Anthropic shape, with role='tool' transformed into role='user' +
 *     `tool_result` content block per AI-SPEC §4 Tool Use.
 */
function splitSystemMessages(messages: readonly ChatMessage[]): {
  readonly system: string | undefined;
  readonly anthropicMessages: ReadonlyArray<Record<string, unknown>>;
} {
  const systemParts: string[] = [];
  const out: Array<Record<string, unknown>> = [];

  for (const m of messages) {
    if (m.role === 'system') {
      systemParts.push(m.content);
      continue;
    }
    if (m.role === 'tool') {
      out.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: m.toolCallId ?? '',
            content: m.content,
          },
        ],
      });
      continue;
    }
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      const blocks: Array<Record<string, unknown>> = [];
      if (m.content) {
        blocks.push({ type: 'text', text: m.content });
      }
      for (const tc of m.toolCalls) {
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.args });
      }
      out.push({ role: 'assistant', content: blocks });
      continue;
    }
    out.push({ role: m.role, content: m.content });
  }

  return {
    system: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
    anthropicMessages: out,
  };
}

function toAnthropicTool(tool: ToolDef): Record<string, unknown> {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  };
}
