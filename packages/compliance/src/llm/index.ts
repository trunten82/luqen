export { AnthropicProvider } from './anthropic-provider.js';
export { OpenAIProvider } from './openai-provider.js';
export { GeminiProvider } from './gemini-provider.js';
export { OllamaProvider } from './ollama-provider.js';
export { buildExtractionPrompt } from './prompt.js';
export { parseExtractedRequirements } from './parse-response.js';

import type { IComplianceLLMProvider } from '../types.js';
import { AnthropicProvider } from './anthropic-provider.js';
import { OpenAIProvider } from './openai-provider.js';
import { GeminiProvider } from './gemini-provider.js';
import { OllamaProvider } from './ollama-provider.js';

export function createLLMProvider(config: {
  provider: 'anthropic' | 'openai' | 'gemini' | 'ollama';
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}): IComplianceLLMProvider {
  switch (config.provider) {
    case 'anthropic':
      if (!config.apiKey) throw new Error('Anthropic API key required');
      return new AnthropicProvider(config.apiKey, config.model);
    case 'openai':
      if (!config.apiKey) throw new Error('OpenAI API key required');
      return new OpenAIProvider(config.apiKey, config.model, config.baseUrl);
    case 'gemini':
      if (!config.apiKey) throw new Error('Gemini API key required');
      return new GeminiProvider(config.apiKey, config.model);
    case 'ollama':
      return new OllamaProvider(config.baseUrl, config.model);
    default:
      throw new Error(`Unknown LLM provider: ${config.provider}`);
  }
}
