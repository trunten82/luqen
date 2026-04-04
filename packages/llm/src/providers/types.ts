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

export interface LLMProviderAdapter {
  readonly type: string;
  connect(config: { baseUrl: string; apiKey?: string }): Promise<void>;
  disconnect(): Promise<void>;
  healthCheck(): Promise<boolean>;
  listModels(): Promise<readonly RemoteModel[]>;
  complete(prompt: string, options: CompletionOptions): Promise<CompletionResult>;
}
