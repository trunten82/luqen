/**
 * HARNESS-04: the run function and the refusal to compare (Phase 84 Task 1-3).
 *
 * Three things this file proves:
 *  1. The temperature the manifest would record is the SAME constant the
 *     capability actually hands to `adapter.complete()` — captured off the
 *     adapter call, not read back from the constant itself.
 *  2. Prompt version is COMPUTED from the applied template (default or
 *     override), tracks the template's shape and not per-item variables,
 *     and is pinned so a future template edit fails loudly.
 *  3. `RunFunction` has fourteen required fields, and `assertComparable`
 *     refuses to compare two records differing on any field but timestamp,
 *     naming every differing field.
 */
import { describe, it, expect } from 'vitest';
import { createEphemeralRunDb, EVAL_ORG_ID } from '../../src/eval/run-context.js';
import { executeGenerateFix, GENERATE_FIX_TEMPERATURE } from '../../src/capabilities/generate-fix.js';
import { executeAnalyseVisual, ANALYSE_VISUAL_TEMPERATURE } from '../../src/capabilities/analyse-visual.js';
import type { LLMProviderAdapter, CompletionOptions } from '../../src/providers/types.js';
import type { PromptOverride, Provider, Model } from '../../src/types.js';
import {
  computeGenerateFixPromptVersion,
  computeAnalyseVisualPromptVersion,
  buildRunFunction,
  assertComparable,
  RunFunctionMismatchError,
  computeEndpointFingerprint,
  type RunFunction,
  type PromptVersion,
} from '../../src/eval/run-manifest.js';

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

function makePromptOverride(template: string): PromptOverride {
  return {
    capability: 'generate-fix',
    orgId: EVAL_ORG_ID,
    template,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

// ---------------------------------------------------------------------------
// Task 1 — one source for temperature
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Task 3 — RunFunction and the refusal to compare
// ---------------------------------------------------------------------------

const SENTINEL_API_KEY = 'sk-ZZ_RUN_MANIFEST_SENTINEL_DO_NOT_LEAK';
const SENTINEL_PRIVATE_HOST = 'http://internal-host.private.example:11434';

function sentinelProvider(overrides?: Partial<Provider>): Provider {
  return {
    id: 'provider-1',
    name: 'Sentinel Provider',
    type: 'ollama',
    baseUrl: SENTINEL_PRIVATE_HOST,
    apiKey: SENTINEL_API_KEY,
    status: 'active',
    timeout: 30,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function sentinelModel(overrides?: Partial<Model>): Model {
  return {
    id: 'model-1',
    providerId: 'provider-1',
    modelId: 'llama3.2',
    displayName: 'Llama 3.2',
    status: 'active',
    capabilities: ['generate-fix'],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const BASE_PROMPT_VERSION: PromptVersion = { digest: 'aaaaaaaaaaaaaaaa', source: 'default' };

function baseRunFunction(overrides?: Partial<RunFunction>): RunFunction {
  const built = buildRunFunction({
    capability: 'generate-fix',
    mode: 'live',
    provider: sentinelProvider(),
    model: sentinelModel(),
    temperature: GENERATE_FIX_TEMPERATURE,
    promptVersion: BASE_PROMPT_VERSION,
    setName: 'wcag-fixes',
    setVersion: 'v1',
    itemCount: 17,
    timestamp: '2026-01-01T00:00:00.000Z',
  });
  return { ...built, ...overrides };
}

describe('run-manifest — RunFunction has fourteen required fields (Task 3)', () => {
  it('carries every named field', () => {
    const fn = baseRunFunction();
    const expectedKeys = [
      'harnessVersion',
      'capability',
      'mode',
      'modelId',
      'modelDisplayName',
      'providerType',
      'endpointFingerprint',
      'temperature',
      'promptVersion',
      'promptSource',
      'setName',
      'setVersion',
      'itemCount',
      'timestamp',
    ].sort();
    expect(Object.keys(fn).sort()).toEqual(expectedKeys);
    expect(Object.keys(fn)).toHaveLength(14);
  });

  it('reads modelId from the provider-native model id, not the display name', () => {
    const fn = baseRunFunction();
    expect(fn.modelId).toBe('llama3.2');
    expect(fn.modelDisplayName).toBe('Llama 3.2');
  });
});

describe('run-manifest — endpoint fingerprint (T-84-04)', () => {
  it('is stable for one endpoint and different for two', () => {
    const a = computeEndpointFingerprint('http://host-a.internal:11434');
    const aAgain = computeEndpointFingerprint('http://host-a.internal:11434');
    const b = computeEndpointFingerprint('http://host-b.internal:11434');
    expect(a).toBe(aAgain);
    expect(a).not.toBe(b);
  });

  it('never reveals the source host in the serialised RunFunction', () => {
    const fn = baseRunFunction();
    const serialised = JSON.stringify(fn);
    expect(serialised).not.toContain('internal-host.private.example');
    expect(serialised).not.toContain(SENTINEL_PRIVATE_HOST);
  });
});

describe('run-manifest — no credential ever reaches the serialised record (T-84-04)', () => {
  it('a record built from a provider carrying a sentinel API key never serialises it', () => {
    const fn = baseRunFunction();
    const serialised = JSON.stringify(fn);
    expect(serialised).not.toContain(SENTINEL_API_KEY);
    expect(serialised).not.toContain('apiKey');
  });
});

describe('run-manifest — assertComparable refuses across a differing RunFunction (Task 3)', () => {
  it('positive control: two identical records (ignoring timestamp) compare successfully', () => {
    const a = baseRunFunction({ timestamp: '2026-01-01T00:00:00.000Z' });
    const b = baseRunFunction({ timestamp: '2026-06-01T00:00:00.000Z' });
    expect(() => assertComparable(a, b)).not.toThrow();
  });

  it('timestamp alone differing does not block comparison — Phase 86 needs this', () => {
    const a = baseRunFunction({ timestamp: '2026-01-01T00:00:00.000Z' });
    const b = baseRunFunction({ timestamp: '2099-12-31T00:00:00.000Z' });
    expect(() => assertComparable(a, b)).not.toThrow();
  });

  it.each([
    ['modelId', { modelId: 'a-different-model' }],
    ['promptVersion', { promptVersion: 'zzzzzzzzzzzzzzzz' }],
    ['temperature', { temperature: 0.99 }],
    ['harnessVersion', { harnessVersion: '999+0.0.0' }],
    ['setVersion', { setVersion: 'v2' }],
    ['endpointFingerprint', { endpointFingerprint: 'deadbeefdeadbeef' }],
    ['mode', { mode: 'replay' as const }],
  ])('refuses when %s differs, naming that field', (fieldName, patch) => {
    const a = baseRunFunction();
    const b = baseRunFunction(patch);
    expect(() => assertComparable(a, b)).toThrow(RunFunctionMismatchError);
    try {
      assertComparable(a, b);
      throw new Error('unreachable — assertComparable should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RunFunctionMismatchError);
      expect((err as RunFunctionMismatchError).differingFields).toContain(fieldName);
    }
  });

  it('a live-mode record and a replay-mode record with otherwise identical fields are refused', () => {
    const live = baseRunFunction({ mode: 'live' });
    const replay = baseRunFunction({ mode: 'replay' });
    expect(() => assertComparable(live, replay)).toThrow(RunFunctionMismatchError);
  });

  it('changing several fields at once names ALL the differing fields, not just the first', () => {
    const a = baseRunFunction();
    const b = baseRunFunction({ modelId: 'different-model', temperature: 0.5, setVersion: 'v2' });
    try {
      assertComparable(a, b);
      throw new Error('unreachable — assertComparable should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RunFunctionMismatchError);
      const differing = (err as RunFunctionMismatchError).differingFields;
      expect(differing).toContain('modelId');
      expect(differing).toContain('temperature');
      expect(differing).toContain('setVersion');
      expect(differing).toHaveLength(3);
    }
  });
});
