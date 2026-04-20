import { describe, it, expect, vi } from 'vitest';

// Anthropic adapter imports @anthropic-ai/sdk at module load — mock it.
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: vi.fn(), stream: vi.fn() },
  })),
}));

import { createAdapter, getSupportedTypes } from '../../src/providers/registry.js';
import { OllamaAdapter } from '../../src/providers/ollama.js';
import { OpenAIAdapter } from '../../src/providers/openai.js';
import { AnthropicAdapter } from '../../src/providers/anthropic.js';

describe('Provider Registry', () => {
  describe('createAdapter', () => {
    it('Test 19a: returns an OllamaAdapter instance for type "ollama"', () => {
      const adapter = createAdapter('ollama');
      expect(adapter).toBeInstanceOf(OllamaAdapter);
    });

    it('Test 19b: returns an OpenAIAdapter instance for type "openai"', () => {
      const adapter = createAdapter('openai');
      expect(adapter).toBeInstanceOf(OpenAIAdapter);
    });

    it('Test 18: createAdapter("anthropic") returns AnthropicAdapter with type="anthropic"', () => {
      const adapter = createAdapter('anthropic');
      expect(adapter).toBeInstanceOf(AnthropicAdapter);
      expect(adapter.type).toBe('anthropic');
    });

    it('throws Error with descriptive message for unsupported type', () => {
      expect(() => createAdapter('unknown' as never)).toThrow(
        'Unsupported provider type: unknown',
      );
    });
  });

  describe('getSupportedTypes', () => {
    it('Test 17: returns ollama + openai + anthropic (order-insensitive)', () => {
      const types = getSupportedTypes();
      const sorted = [...types].sort();
      expect(sorted).toEqual(['anthropic', 'ollama', 'openai']);
    });

    it('returns an array containing "ollama"', () => {
      const types = getSupportedTypes();
      expect(types).toContain('ollama');
    });

    it('returns an array containing "openai"', () => {
      const types = getSupportedTypes();
      expect(types).toContain('openai');
    });

    it('returns an array containing "anthropic"', () => {
      const types = getSupportedTypes();
      expect(types).toContain('anthropic');
    });

    it('returns a non-empty readonly array', () => {
      const types = getSupportedTypes();
      expect(Array.isArray(types)).toBe(true);
      expect(types.length).toBeGreaterThan(0);
    });
  });
});
