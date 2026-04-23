import { randomUUID } from 'node:crypto';
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
import { anySignal, readNdjsonLines } from './streaming-helpers.js';

export class OllamaAdapter implements LLMProviderAdapter {
  readonly type = 'ollama';

  private baseUrl = '';

  async connect(config: { baseUrl: string; apiKey?: string }): Promise<void> {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
  }

  async disconnect(): Promise<void> {
    this.baseUrl = '';
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`);
      return res.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<readonly RemoteModel[]> {
    const res = await fetch(`${this.baseUrl}/api/tags`);
    const data = await res.json() as { models: Array<{ name: string }> };
    return data.models.map((m) => ({ id: m.name, name: m.name }));
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
      stream: false,
      options: {
        temperature: options.temperature,
        num_predict: options.maxTokens,
      },
    };

    const timeoutMs = options.timeout ? options.timeout * 1000 : undefined;
    const signal = timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined;

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });

    const data = await res.json() as {
      message: { content: string };
      prompt_eval_count: number;
      eval_count: number;
    };

    return {
      text: data.message.content,
      usage: {
        inputTokens: data.prompt_eval_count,
        outputTokens: data.eval_count,
      },
    };
  }

  /**
   * Token-level streaming for Ollama's /api/chat with stream=true.
   *
   * D-11 contract (Ollama-specific):
   *  - Ollama emits NDJSON — one JSON object per `\n`.
   *  - Plain text `message.content` chunks yield `token` frames (empty strings
   *    are NOT emitted as token frames).
   *  - Tool calls arrive as a single block when `done=true`. The final chunk
   *    may carry `message.tool_calls` — if present, yield exactly ONE
   *    `tool_calls` frame + a terminal `done` frame with `finishReason:
   *    'tool_calls'`. Otherwise, yield a terminal `done` frame with
   *    `finishReason: 'stop'`.
   *  - Ollama does not provide tool-call ids; we mint one via randomUUID().
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

    const body = {
      model: options.model,
      messages: toOllamaMessages(messages),
      tools: options.tools?.map(toOllamaTool),
      stream: true,
      options: {
        temperature: options.temperature ?? 0.3,
        num_predict: options.maxTokens ?? 2048,
      },
    };

    const timeoutMs = options.timeout ? options.timeout * 1000 : undefined;
    const signals: AbortSignal[] = [];
    if (signal) signals.push(signal);
    if (timeoutMs) signals.push(AbortSignal.timeout(timeoutMs));
    const mergedSignal = signals.length > 0 ? anySignal(signals) : undefined;

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      const errBody = await res.text().catch(() => '');
      yield {
        type: 'error',
        code: 'provider_failed',
        message: `Ollama returned ${res.status} ${res.statusText ?? ''}: ${errBody.slice(0, 500)}`.trim(),
        retryable: true,
      };
      return;
    }

    if (!res.body) {
      yield {
        type: 'error',
        code: 'invalid_response',
        message: 'Ollama response had no body',
        retryable: false,
      };
      return;
    }

    let finalToolCalls: ToolCall[] | undefined;
    let usage: { inputTokens: number; outputTokens: number } | undefined;

    try {
      for await (const line of readNdjsonLines(res.body)) {
        if (signal?.aborted) {
          yield {
            type: 'error',
            code: 'provider_failed',
            message: 'aborted',
            retryable: false,
          };
          return;
        }

        let chunk: {
          message?: {
            content?: string;
            tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> | string } }>;
          };
          done?: boolean;
          prompt_eval_count?: number;
          eval_count?: number;
        };
        try {
          chunk = JSON.parse(line);
        } catch {
          continue;
        }

        const content = chunk.message?.content;
        if (typeof content === 'string' && content.length > 0) {
          yield { type: 'token', text: content };
        }

        if (chunk.done === true) {
          if (Array.isArray(chunk.message?.tool_calls) && chunk.message!.tool_calls!.length > 0) {
            finalToolCalls = chunk.message!.tool_calls!.map((tc) => {
              const rawArgs = tc.function.arguments;
              let args: Record<string, unknown>;
              if (typeof rawArgs === 'string') {
                try {
                  args = JSON.parse(rawArgs) as Record<string, unknown>;
                } catch {
                  args = {};
                }
              } else {
                args = rawArgs ?? {};
              }
              return {
                id: `toolu_ollama_${randomUUID()}`,
                name: tc.function.name,
                args,
              };
            });
          }
          if (typeof chunk.prompt_eval_count === 'number' || typeof chunk.eval_count === 'number') {
            usage = {
              inputTokens: chunk.prompt_eval_count ?? 0,
              outputTokens: chunk.eval_count ?? 0,
            };
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

    if (finalToolCalls && finalToolCalls.length > 0) {
      yield { type: 'tool_calls', calls: finalToolCalls };
      yield { type: 'done', finishReason: 'tool_calls', usage };
      return;
    }

    yield { type: 'done', finishReason: 'stop', usage };
  }
}

function toOllamaMessages(messages: readonly ChatMessage[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      out.push({
        role: 'tool',
        content: m.content,
        ...(m.toolName ? { tool_name: m.toolName } : {}),
      });
      continue;
    }
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      out.push({
        role: 'assistant',
        content: m.content ?? '',
        tool_calls: m.toolCalls.map((tc) => ({
          function: { name: tc.name, arguments: tc.args },
        })),
      });
      continue;
    }
    // Ollama 400s on assistant messages with neither content nor tool_calls.
    // Skip them — they can appear in conversation history after a failed turn.
    if (m.role === 'assistant' && (m.content == null || m.content.length === 0)) {
      continue;
    }
    out.push({ role: m.role, content: m.content });
  }
  return out;
}

function toOllamaTool(tool: ToolDef): Record<string, unknown> {
  // Ollama's cloud tool-calling validator requires parameters to be a JSON
  // Schema *object* with at minimum `type: 'object'` AND `properties: {}`.
  // Callers often pass `{type:'object'}` with no properties — Ollama then
  // fails "Invalid tool schema: None is not of type 'object'".
  const raw =
    tool.inputSchema != null && typeof tool.inputSchema === 'object'
      ? (tool.inputSchema as Record<string, unknown>)
      : {};
  const parameters: Record<string, unknown> = {
    type: 'object',
    properties: {},
    ...raw,
  };
  if (parameters['properties'] == null || typeof parameters['properties'] !== 'object') {
    parameters['properties'] = {};
  }
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description.length > 0 ? tool.description : tool.name,
      parameters,
    },
  };
}

