import type { LLMProviderAdapter, CompletionOptions, CompletionResult, RemoteModel } from './types.js';

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

    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
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
}
