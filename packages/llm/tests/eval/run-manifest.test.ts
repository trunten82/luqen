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
import type { PromptOverride } from '../../src/types.js';
import {
  computeGenerateFixPromptVersion,
  computeAnalyseVisualPromptVersion,
} from '../../src/eval/run-manifest.js';

function makePromptOverride(template: string): PromptOverride {
  return {
    capability: 'generate-fix',
    orgId: EVAL_ORG_ID,
    template,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

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

// ---------------------------------------------------------------------------
// Task 2 — computed prompt version
// ---------------------------------------------------------------------------

// Pinned current default digests. A failure here means a shipped prompt
// template changed — update the pin in the SAME commit as the template
// edit; this pin is the tripwire, not a maintenance annoyance.
const PINNED_GENERATE_FIX_DEFAULT_DIGEST = 'a7058bfb8787ba3c';
const PINNED_GENERATE_FIX_GUTENBERG_DIGEST = '5444d2ab55439bb6';
const PINNED_ANALYSE_VISUAL_ALT_TEXT_DIGEST = '556155db19a23ee1';
const PINNED_ANALYSE_VISUAL_HEADING_DIGEST = '401fb7fac1624076';

describe('run-manifest — computed prompt version (Task 2)', () => {
  it('the generate-fix default and Gutenberg variant produce different versions', () => {
    const html = computeGenerateFixPromptVersion('html', undefined);
    const gutenberg = computeGenerateFixPromptVersion('wordpress-gutenberg', undefined);
    expect(html.source).toBe('default');
    expect(gutenberg.source).toBe('default');
    expect(html.digest).not.toBe(gutenberg.digest);
  });

  it('the analyse-visual alt-text and heading-semantics prompts produce different versions', () => {
    const altText = computeAnalyseVisualPromptVersion('alt-text', undefined);
    const heading = computeAnalyseVisualPromptVersion('heading-semantics', undefined);
    expect(altText.source).toBe('default');
    expect(heading.source).toBe('default');
    expect(altText.digest).not.toBe(heading.digest);
  });

  it('a generate-fix override produces a version different from the default, sourced as override', () => {
    const override = makePromptOverride('OVERRIDE {{wcagCriterion}} {{issueMessage}} {{htmlContext}} {{cssContext}}');
    const defaultVersion = computeGenerateFixPromptVersion('html', undefined);
    const overrideVersion = computeGenerateFixPromptVersion('html', override);
    expect(overrideVersion.source).toBe('override');
    expect(overrideVersion.digest).not.toBe(defaultVersion.digest);
  });

  it('an analyse-visual override produces a version different from the default, sourced as override', () => {
    const override = makePromptOverride('OVERRIDE {{context}}');
    const defaultVersion = computeAnalyseVisualPromptVersion('alt-text', undefined);
    const overrideVersion = computeAnalyseVisualPromptVersion('alt-text', override);
    expect(overrideVersion.source).toBe('override');
    expect(overrideVersion.digest).not.toBe(defaultVersion.digest);
  });

  it('the computed version is stable across repeated calls and independent of per-item variables', () => {
    // computeGenerateFixPromptVersion takes no item-level data at all — it
    // always renders the FROZEN canonical input, so two calls with the same
    // (platform, override) arguments — standing in for two different
    // reference items scored under the same template — always agree.
    const first = computeGenerateFixPromptVersion('html', undefined);
    const second = computeGenerateFixPromptVersion('html', undefined);
    expect(first.digest).toBe(second.digest);

    const overrideA = makePromptOverride('STABLE {{wcagCriterion}} {{issueMessage}} {{htmlContext}} {{cssContext}}');
    const overrideB = makePromptOverride('STABLE {{wcagCriterion}} {{issueMessage}} {{htmlContext}} {{cssContext}}');
    expect(computeGenerateFixPromptVersion('html', overrideA).digest).toBe(
      computeGenerateFixPromptVersion('html', overrideB).digest,
    );
  });

  it('two templates differing by a single character produce different versions', () => {
    const a = computeGenerateFixPromptVersion('html', makePromptOverride('X{{wcagCriterion}}'));
    const b = computeGenerateFixPromptVersion('html', makePromptOverride('Y{{wcagCriterion}}'));
    expect(a.digest).not.toBe(b.digest);
  });

  it('pins the four current default digests — a failure here means a shipped prompt template changed', () => {
    expect(computeGenerateFixPromptVersion('html', undefined).digest).toBe(PINNED_GENERATE_FIX_DEFAULT_DIGEST);
    expect(computeGenerateFixPromptVersion('wordpress-gutenberg', undefined).digest).toBe(
      PINNED_GENERATE_FIX_GUTENBERG_DIGEST,
    );
    expect(computeAnalyseVisualPromptVersion('alt-text', undefined).digest).toBe(
      PINNED_ANALYSE_VISUAL_ALT_TEXT_DIGEST,
    );
    expect(computeAnalyseVisualPromptVersion('heading-semantics', undefined).digest).toBe(
      PINNED_ANALYSE_VISUAL_HEADING_DIGEST,
    );
  });
});
