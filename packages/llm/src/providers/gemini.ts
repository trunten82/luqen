import type {
  LLMProviderAdapter,
  CompletionOptions,
  CompletionResult,
  RemoteModel,
  ChatMessage,
  ImageInput,
  StreamFrame,
  ToolCall,
  ToolDef,
} from './types.js';
import { ProviderHttpError, classifyHttpRetryable } from './types.js';
import { anySignal, readSsePayloads } from './streaming-helpers.js';

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Google Gemini provider adapter (REST + SSE streaming).
 *
 * Mirrors the OpenAIAdapter structure: connect/disconnect/healthCheck/listModels,
 * a non-streaming `complete()`, and a streaming `completeStream()` honouring the
 * D-11 ordering invariant (token frames first; exactly one `tool_calls` frame
 * after them; exactly one terminal `done`/`error`).
 *
 * Notable Gemini-specific deviations from the OpenAI pattern:
 *  - The API key travels as a `?key=` query param, NEVER an Authorization header.
 *  - Gemini has no system role inside `contents`; system text is folded into a
 *    top-level `systemInstruction` block.
 *  - ChatMessage role 'assistant' maps to Gemini's 'model' role; role 'tool'
 *    degrades into a 'user' part describing the tool result.
 *  - Tool calls arrive as `functionCall` parts (no streamed argument JSON), so
 *    args are already-parsed objects and ids are synthesised as `call_${i}`.
 */
export class GeminiAdapter implements LLMProviderAdapter {
  readonly type = 'gemini';

  private baseUrl = DEFAULT_BASE_URL;
  private apiKey = '';

  async connect(config: { baseUrl: string; apiKey?: string }): Promise<void> {
    this.baseUrl = (config.baseUrl ? config.baseUrl : DEFAULT_BASE_URL).replace(/\/$/, '');
    this.apiKey = config.apiKey ?? '';
  }

  async disconnect(): Promise<void> {
    this.baseUrl = DEFAULT_BASE_URL;
    this.apiKey = '';
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/models?key=${encodeURIComponent(this.apiKey)}`);
      return res.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<readonly RemoteModel[]> {
    const res = await fetch(`${this.baseUrl}/models?key=${encodeURIComponent(this.apiKey)}`);
    const data = await res.json() as {
      models?: Array<{ name: string; displayName?: string; supportedGenerationMethods?: string[] }>;
    };
    return (data.models ?? [])
      .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
      .map((m) => {
        const id = m.name.replace(/^models\//, '');
        return { id, name: m.displayName ?? id };
      });
  }

  async complete(prompt: string, options: CompletionOptions): Promise<CompletionResult> {
    const body = buildRequestBody(
      [{ role: 'user', parts: toUserParts(prompt, options.images) }],
      options.systemPrompt,
      options.maxTokens,
      options.temperature,
    );

    const timeoutMs = options.timeout ? options.timeout * 1000 : undefined;
    const signal = timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined;

    const res = await fetch(this.endpoint('generateContent', options.model, false), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new ProviderHttpError(res.status, errBody, classifyHttpRetryable(res.status));
    }

    const data = await res.json() as GenerateContentResponse;

    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const text = parts.map((p) => p.text ?? '').join('');

    return {
      text,
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      },
    };
  }

  /**
   * Token-level streaming + provider-native tool calls.
   *
   * D-11 buffering contract:
   *  - `text` parts in each SSE chunk yield `token` frames in order.
   *  - `functionCall` parts are accumulated; ZERO token frames are emitted for
   *    them. Gemini delivers fully-formed `args` objects (not streamed JSON
   *    fragments), so no partial-JSON assembly is needed.
   *  - When any functionCall parts were seen, exactly ONE `tool_calls` frame is
   *    yielded after all token frames.
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

    const { systemInstruction, contents } = toGeminiContents(messages);
    const body = buildRequestBody(
      contents,
      systemInstruction,
      options.maxTokens ?? 2048,
      options.temperature ?? 0.3,
    );
    if (options.tools && options.tools.length > 0) {
      body.tools = [{ functionDeclarations: options.tools.map(toGeminiTool) }];
    }

    const timeoutMs = options.timeout ? options.timeout * 1000 : undefined;
    const controller = new AbortController();
    const signals: AbortSignal[] = [controller.signal];
    if (signal) signals.push(signal);
    if (timeoutMs) signals.push(AbortSignal.timeout(timeoutMs));
    const mergedSignal = anySignal(signals);

    let res: Response;
    try {
      res = await fetch(this.endpoint('streamGenerateContent', options.model, true), {
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
      yield {
        type: 'error',
        code: 'provider_failed',
        message: `Gemini returned ${res.status} ${res.statusText ?? ''}`.trim(),
        retryable: true,
      };
      return;
    }

    if (!res.body) {
      yield {
        type: 'error',
        code: 'invalid_response',
        message: 'Gemini response had no body',
        retryable: false,
      };
      return;
    }

    const toolCalls: ToolCall[] = [];
    let finishReason: 'stop' | 'length' | 'tool_calls' | 'error' = 'stop';
    let usage: { inputTokens: number; outputTokens: number } | undefined;

    try {
      for await (const data of readSsePayloads(res.body)) {
        if (signal?.aborted) {
          yield {
            type: 'error',
            code: 'provider_failed',
            message: 'aborted',
            retryable: false,
          };
          return;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(data);
        } catch {
          // Skip malformed JSON lines — stream may have an incomplete frame.
          continue;
        }

        const chunk = parsed as GenerateContentResponse;

        if (chunk.usageMetadata) {
          usage = {
            inputTokens: chunk.usageMetadata.promptTokenCount ?? 0,
            outputTokens: chunk.usageMetadata.candidatesTokenCount ?? 0,
          };
        }

        const candidate = chunk.candidates?.[0];
        if (!candidate) continue;

        for (const part of candidate.content?.parts ?? []) {
          if (typeof part.text === 'string' && part.text.length > 0) {
            yield { type: 'token', text: part.text };
          }
          if (part.functionCall) {
            toolCalls.push({
              id: `call_${toolCalls.length}`,
              name: part.functionCall.name,
              args: part.functionCall.args ?? {},
            });
          }
        }

        if (candidate.finishReason) {
          finishReason = mapFinishReason(candidate.finishReason);
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

    if (toolCalls.length > 0) {
      yield { type: 'tool_calls', calls: toolCalls };
      finishReason = 'tool_calls';
    }

    yield { type: 'done', finishReason, usage };
  }

  private endpoint(method: string, model: string, stream: boolean): string {
    const query = stream
      ? `?alt=sse&key=${encodeURIComponent(this.apiKey)}`
      : `?key=${encodeURIComponent(this.apiKey)}`;
    return `${this.baseUrl}/models/${model}:${method}${query}`;
  }
}

// ----------------------------------------------------------------------
// Response shape (shared by complete + completeStream chunks)
// ----------------------------------------------------------------------

interface GeminiPart {
  readonly text?: string;
  readonly functionCall?: { readonly name: string; readonly args?: Record<string, unknown> };
}

interface GenerateContentResponse {
  readonly candidates?: Array<{
    readonly content?: { readonly parts?: GeminiPart[] };
    readonly finishReason?: string;
  }>;
  readonly usageMetadata?: {
    readonly promptTokenCount?: number;
    readonly candidatesTokenCount?: number;
  };
}

// ----------------------------------------------------------------------
// Request building
// ----------------------------------------------------------------------

function buildRequestBody(
  contents: Array<Record<string, unknown>>,
  systemPrompt: string | undefined,
  maxTokens: number | undefined,
  temperature: number | undefined,
): Record<string, unknown> {
  const body: Record<string, unknown> = { contents };
  if (systemPrompt) {
    body.systemInstruction = { parts: [{ text: systemPrompt }] };
  }
  const generationConfig: Record<string, unknown> = {};
  if (typeof maxTokens === 'number') generationConfig.maxOutputTokens = maxTokens;
  if (typeof temperature === 'number') generationConfig.temperature = temperature;
  if (Object.keys(generationConfig).length > 0) body.generationConfig = generationConfig;
  return body;
}

/**
 * Map an incoming ChatMessage[] into Gemini `contents` plus a folded
 * `systemInstruction` string. Role mapping: 'system' → systemInstruction;
 * 'assistant' → 'model'; 'user' → 'user'; 'tool' → a 'user' part describing
 * the tool result (Gemini has no dedicated tool role in this simple shape).
 */
function toGeminiContents(messages: readonly ChatMessage[]): {
  readonly systemInstruction: string | undefined;
  readonly contents: Array<Record<string, unknown>>;
} {
  const systemParts: string[] = [];
  const contents: Array<Record<string, unknown>> = [];

  for (const m of messages) {
    if (m.role === 'system') {
      systemParts.push(m.content);
      continue;
    }
    if (m.role === 'tool') {
      contents.push({
        role: 'user',
        parts: [{ text: `Tool result${m.toolName ? ` (${m.toolName})` : ''}: ${m.content}` }],
      });
      continue;
    }
    if (m.role === 'assistant') {
      contents.push({ role: 'model', parts: [{ text: m.content }] });
      continue;
    }
    // role === 'user'
    contents.push({ role: 'user', parts: toUserParts(m.content, m.images) });
  }

  return {
    systemInstruction: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
    contents,
  };
}

/**
 * Build the parts array for a user turn: the text part first, then one
 * `inline_data` part per attached image (Gemini's bare-base64 multimodal shape).
 */
function toUserParts(text: string, images?: readonly ImageInput[]): Array<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = [{ text }];
  if (images && images.length > 0) {
    for (const img of images) {
      parts.push({ inline_data: { mime_type: img.mediaType, data: img.data } });
    }
  }
  return parts;
}

function toGeminiTool(tool: ToolDef): Record<string, unknown> {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  };
}

function mapFinishReason(reason: string): 'stop' | 'length' | 'tool_calls' | 'error' {
  switch (reason) {
    case 'STOP':
      return 'stop';
    case 'MAX_TOKENS':
      return 'length';
    case 'SAFETY':
    case 'RECITATION':
    case 'BLOCKLIST':
    case 'PROHIBITED_CONTENT':
      return 'error';
    default:
      return 'stop';
  }
}
