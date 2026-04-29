/**
 * Phase 43 Plan 01 (AGENT-01) — agent-system prompt template tests.
 *
 * Verifies the LOCKED:planning-mode fence is present, well-formed, and
 * instructs the LLM with the contract the server-side parser expects.
 */

import { describe, it, expect } from 'vitest';
import { buildAgentSystemPrompt } from '../../src/prompts/agent-system.js';

describe('agent-system prompt — LOCKED:planning-mode fence', () => {
  it('contains the LOCKED:planning-mode fence markers', () => {
    const prompt = buildAgentSystemPrompt();
    expect(prompt).toContain('<!-- LOCKED:planning-mode -->');
    expect(prompt).toContain('<!-- /LOCKED:planning-mode -->');
  });

  it('open and close fence counts match (well-formed fence)', () => {
    const prompt = buildAgentSystemPrompt();
    const open = prompt.match(/<!-- LOCKED:planning-mode -->/g) ?? [];
    const close = prompt.match(/<!-- \/LOCKED:planning-mode -->/g) ?? [];
    expect(open.length).toBe(1);
    expect(close.length).toBe(1);
  });

  it('instructs the LLM to emit a <plan>...</plan> block for multi-step responses', () => {
    const prompt = buildAgentSystemPrompt();
    const start = prompt.indexOf('<!-- LOCKED:planning-mode -->');
    const end = prompt.indexOf('<!-- /LOCKED:planning-mode -->');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = prompt.slice(start, end);
    expect(block).toContain('<plan>');
    expect(block).toContain('</plan>');
    expect(block.toLowerCase()).toContain('multi-step');
  });

  it('keeps all four LOCKED fences (rbac, confirmation, honesty, planning-mode) in the default template', () => {
    const prompt = buildAgentSystemPrompt();
    expect(prompt).toContain('<!-- LOCKED:rbac -->');
    expect(prompt).toContain('<!-- LOCKED:confirmation -->');
    expect(prompt).toContain('<!-- LOCKED:honesty -->');
    expect(prompt).toContain('<!-- LOCKED:planning-mode -->');
  });
});
