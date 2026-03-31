import { describe, it, expect } from 'vitest';
import { parseJSON } from '../../src/parser/json-parser.js';

const VALID_JSON = JSON.stringify({
  name: 'Brand Guide Name',
  description: 'Optional description',
  colors: [
    { name: 'Primary Blue', hex: '#1E40AF', usage: 'primary', context: 'Headers, CTAs' },
    { name: 'White', hex: '#FFFFFF', usage: 'background', context: 'Page backgrounds' },
  ],
  fonts: [
    { family: 'Inter', weights: ['400', '600', '700'], usage: 'body', context: 'Body text' },
  ],
  selectors: [{ pattern: '.brand-header', description: 'Top navigation bar' }],
});

describe('parseJSON', () => {
  it('parses a valid JSON guideline template', () => {
    const result = parseJSON(VALID_JSON);
    expect(result.name).toBe('Brand Guide Name');
    expect(result.description).toBe('Optional description');
    expect(result.colors).toHaveLength(2);
    expect(result.colors[0]).toMatchObject({ name: 'Primary Blue', hex: '#1E40AF' });
    expect(result.fonts).toHaveLength(1);
    expect(result.fonts[0]).toMatchObject({ family: 'Inter', weights: ['400', '600', '700'] });
    expect(result.selectors).toHaveLength(1);
    expect(result.selectors[0]).toMatchObject({ pattern: '.brand-header' });
  });

  it('parses fonts with weights array', () => {
    const result = parseJSON(VALID_JSON);
    expect(result.fonts[0].weights).toEqual(['400', '600', '700']);
  });

  it('defaults arrays to empty when omitted', () => {
    const minimal = JSON.stringify({ name: 'Minimal' });
    const result = parseJSON(minimal);
    expect(result.name).toBe('Minimal');
    expect(result.colors).toEqual([]);
    expect(result.fonts).toEqual([]);
    expect(result.selectors).toEqual([]);
  });

  it('throws on invalid JSON string', () => {
    expect(() => parseJSON('not-json')).toThrow(/Invalid JSON/);
  });

  it('throws when name field is missing', () => {
    const noName = JSON.stringify({ colors: [] });
    expect(() => parseJSON(noName)).toThrow(/Invalid guideline JSON/);
  });

  it('throws on non-object JSON', () => {
    expect(() => parseJSON('"just a string"')).toThrow(/Invalid guideline JSON/);
  });
});
