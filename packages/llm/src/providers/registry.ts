import type { LLMProviderAdapter } from './types.js';
import type { ProviderType } from '../types.js';
import { OllamaAdapter } from './ollama.js';
import { OpenAIAdapter } from './openai.js';
import { AnthropicAdapter } from './anthropic.js';

const ADAPTER_FACTORIES: Record<string, () => LLMProviderAdapter> = {
  ollama: () => new OllamaAdapter(),
  openai: () => new OpenAIAdapter(),
  anthropic: () => new AnthropicAdapter(),
};

export function createAdapter(type: ProviderType): LLMProviderAdapter {
  const factory = ADAPTER_FACTORIES[type];
  if (!factory) {
    throw new Error(`Unsupported provider type: ${type}. Supported: ${Object.keys(ADAPTER_FACTORIES).join(', ')}`);
  }
  return factory();
}

export function getSupportedTypes(): readonly string[] {
  return Object.keys(ADAPTER_FACTORIES);
}
