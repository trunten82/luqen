import { describe, it, expect } from 'vitest';
import { createAdapter, getSupportedTypes } from '../../src/providers/registry.js';
import { OllamaAdapter } from '../../src/providers/ollama.js';
import { OpenAIAdapter } from '../../src/providers/openai.js';

describe('Provider Registry', () => {
  describe('createAdapter', () => {
    it('returns an OllamaAdapter instance for type "ollama"', () => {
      const adapter = createAdapter('ollama');
      expect(adapter).toBeInstanceOf(OllamaAdapter);
    });

    it('returns an OpenAIAdapter instance for type "openai"', () => {
      const adapter = createAdapter('openai');
      expect(adapter).toBeInstanceOf(OpenAIAdapter);
    });

    it('throws Error with descriptive message for unsupported type', () => {
      expect(() => createAdapter('unknown' as never)).toThrow(
        'Unsupported provider type: unknown',
      );
    });

    it('error message includes the unsupported type name', () => {
      let errorMessage = '';
      try {
        createAdapter('anthropic' as never);
      } catch (err) {
        errorMessage = (err as Error).message;
      }
      expect(errorMessage).toContain('anthropic');
    });
  });

  describe('getSupportedTypes', () => {
    it('returns an array containing "ollama"', () => {
      const types = getSupportedTypes();
      expect(types).toContain('ollama');
    });

    it('returns an array containing "openai"', () => {
      const types = getSupportedTypes();
      expect(types).toContain('openai');
    });

    it('returns a non-empty readonly array', () => {
      const types = getSupportedTypes();
      expect(Array.isArray(types)).toBe(true);
      expect(types.length).toBeGreaterThan(0);
    });
  });
});
