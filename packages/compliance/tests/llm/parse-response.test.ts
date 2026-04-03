import { describe, it, expect } from 'vitest';
import { parseExtractedRequirements } from '../../src/llm/parse-response.js';

describe('parseExtractedRequirements', () => {
  it('parses valid JSON response', () => {
    const raw = '{"wcagVersion":"2.1","wcagLevel":"AA","criteria":[{"criterion":"1.1.1","obligation":"mandatory"}],"confidence":0.9}';
    const result = parseExtractedRequirements(raw);
    expect(result.wcagVersion).toBe('2.1');
    expect(result.criteria).toHaveLength(1);
    expect(result.confidence).toBe(0.9);
  });

  it('strips markdown code fences', () => {
    const raw = '```json\n{"wcagVersion":"2.1","wcagLevel":"AA","criteria":[],"confidence":0.5}\n```';
    const result = parseExtractedRequirements(raw);
    expect(result.wcagVersion).toBe('2.1');
  });

  it('handles missing fields with defaults', () => {
    const raw = '{}';
    const result = parseExtractedRequirements(raw);
    expect(result.wcagVersion).toBe('unknown');
    expect(result.wcagLevel).toBe('unknown');
    expect(result.criteria).toHaveLength(0);
    expect(result.confidence).toBe(0);
  });

  it('filters out criteria missing required fields', () => {
    const raw = '{"wcagVersion":"2.1","wcagLevel":"AA","criteria":[{"criterion":"1.1.1","obligation":"mandatory"},{"criterion":"1.2.1"}],"confidence":0.8}';
    const result = parseExtractedRequirements(raw);
    expect(result.criteria).toHaveLength(1);
  });
});
