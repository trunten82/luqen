/**
 * HARNESS-04: the run function and the refusal to compare (Phase 84 Task 1).
 *
 * Task 1 proves: the temperature the manifest will one day record is the
 * SAME constant the capability actually hands to `adapter.complete()` —
 * captured off the adapter call, not read back from the constant itself. A
 * test that reads the constant and compares it against the same constant
 * proves nothing; this captures the value at the seam.
 */
import { describe, it } from 'vitest';
import { expect } from 'vitest';
import { createEphemeralRunDb, EVAL_ORG_ID } from '../../src/eval/run-context.js';
import { executeGenerateFix, GENERATE_FIX_TEMPERATURE } from '../../src/capabilities/generate-fix.js';
import { executeAnalyseVisual, ANALYSE_VISUAL_TEMPERATURE } from '../../src/capabilities/analyse-visual.js';
import type { LLMProviderAdapter, CompletionOptions } from '../../src/providers/types.js';

function capturingAdapter(
  responseText: string,
): { adapter: LLMProviderAdapter; captured: () => CompletionOptions | undefined } {
  let capturedOptions: CompletionOptions | undefined;
  const adapter: LLMProviderAdapter = {
    type: 'capture',
    connect: async () => {},
    disconnect: async () => {},
    healthCheck: async () => true,
    listModels: async () => [],
    complete: async (_prompt: string, options: CompletionOptions) => {
      capturedOptions = options;
      return { text: responseText, usage: { inputTokens: 0, outputTokens: 0 } };
    },
  };
  return { adapter, captured: () => capturedOptions };
}

describe('run-manifest — temperature is a single source (Task 1)', () => {
  it('generate-fix hands adapter.complete() the exported GENERATE_FIX_TEMPERATURE constant', async () => {
    const runDb = await createEphemeralRunDb('generate-fix');
    try {
      const { adapter, captured } = capturingAdapter(
        JSON.stringify({ fixedHtml: '<p>ok</p>', explanation: 'ok', effort: 'low' }),
      );

      await executeGenerateFix(
        runDb.db,
        () => adapter,
        { wcagCriterion: '1.1.1', issueMessage: 'x', htmlContext: '<img>', orgId: EVAL_ORG_ID },
        { maxRetries: 0, retryDelayMs: 0 },
      );

      expect(captured()?.temperature).toBe(GENERATE_FIX_TEMPERATURE);
      expect(GENERATE_FIX_TEMPERATURE).toBe(0.2);
    } finally {
      await runDb.db.close();
    }
  });

  it('analyse-visual hands adapter.complete() the exported ANALYSE_VISUAL_TEMPERATURE constant', async () => {
    const runDb = await createEphemeralRunDb('analyse-visual');
    try {
      const { adapter, captured } = capturingAdapter(JSON.stringify({ verdict: 'pass', findings: [] }));

      await executeAnalyseVisual(
        runDb.db,
        () => adapter,
        { check: 'alt-text', image: { mediaType: 'image/png', data: 'AAAA' }, context: 'x', orgId: EVAL_ORG_ID },
        { maxRetries: 0, retryDelayMs: 0 },
      );

      expect(captured()?.temperature).toBe(ANALYSE_VISUAL_TEMPERATURE);
      expect(ANALYSE_VISUAL_TEMPERATURE).toBe(0.1);
    } finally {
      await runDb.db.close();
    }
  });
});
