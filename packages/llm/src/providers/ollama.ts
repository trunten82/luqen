import type { LLMProviderAdapter, CompletionOptions, CompletionResult, RemoteModel } from './types.js';

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

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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
}
