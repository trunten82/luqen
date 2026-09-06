/**
 * TRACER — this test proves the PLUMBING: that a reference-set item can be
 * loaded, passed to the real `executeGenerateFix`, answered by a fixture,
 * and scored. The response is a hand-written fixture, not model output. A
 * green tracer means the harness runs. It does NOT mean any model was
 * measured, and it is not a result — no trusted measurement exists in this
 * phase until 84-03's poison break-test is committed and 84-04 runs a set.
 */
import { describe, it, expect } from 'vitest';
import { loadWcagFixSet } from '../../src/eval/load-reference-set.js';
import { resolveReferenceSetPath } from '../../src/eval/set-paths.js';
import { createEphemeralRunDb, EVAL_ORG_ID } from '../../src/eval/run-context.js';
import { createFixtureAdapter, MissingFixtureResponseError } from '../../src/eval/fixture-adapter.js';
import { scoreGenerateFix, goldResultFor } from '../../src/eval/score-generate-fix.js';
import { executeGenerateFix } from '../../src/capabilities/generate-fix.js';
import { CapabilityExhaustedError } from '../../src/capabilities/types.js';
import { ProviderHttpError } from '../../src/providers/types.js';
import type { LLMProviderAdapter } from '../../src/providers/types.js';
import type { WcagFixItem } from '../../src/eval/types.js';

const PACKAGE_ROOT = process.cwd();

describe('tracer: score one WCAG item end-to-end (plumbing proof, not a model measurement)', () => {
  it('loads the real committed set, runs the real executeGenerateFix against an ephemeral single-model db, and scores the result', async () => {
    const setPath = resolveReferenceSetPath(PACKAGE_ROOT, 'wcag-fixes');
    const set = loadWcagFixSet(setPath, 'v1');
    expect(set.items.length).toBe(17);

    const item = set.items.find((i) => i.poison === undefined) as WcagFixItem | undefined;
    expect(item).toBeDefined();
    const nonPoisonItem = item as WcagFixItem;

    const runDb = await createEphemeralRunDb('generate-fix');
    try {
      const fixtureText = JSON.stringify({
        fixedHtml: nonPoisonItem.expected.fixedHtml,
        explanation: nonPoisonItem.expected.explanationMustMention.join('. '),
        effort: nonPoisonItem.expected.effort,
      });

      let currentId = nonPoisonItem.id;
      const adapter: LLMProviderAdapter = createFixtureAdapter({
        responsesByItemId: { [nonPoisonItem.id]: fixtureText },
        currentItemId: () => currentId,
      });

      // The whole point of the mirror: item.input's field names match
      // GenerateFixInput's field-for-field (eval/types.ts), so it spreads
      // straight in with no translation layer.
      const capResult = await executeGenerateFix(
        runDb.db,
        () => adapter,
        { ...nonPoisonItem.input, orgId: EVAL_ORG_ID },
        { maxRetries: 0, retryDelayMs: 0 },
      );

      // Model-identity assertion.
      expect(capResult.model).toBe(runDb.modelDisplayName);
      // The raw response (HARNESS-06) travels all the way through.
      expect(capResult.rawText).toBe(fixtureText);

      const goldRecord = scoreGenerateFix(goldResultFor(nonPoisonItem), nonPoisonItem);
      const candidateRecord = scoreGenerateFix(capResult.data, nonPoisonItem);
      // The per-item record: item id + model + raw response + score.
      const perItemRecord = {
        itemId: nonPoisonItem.id,
        model: capResult.model,
        rawText: capResult.rawText,
        score: candidateRecord,
      };
      expect(perItemRecord.itemId).toBe(nonPoisonItem.id);
      expect(perItemRecord.rawText).toBe(fixtureText);
      // The fixture IS the gold answer for this item, so the two records match.
      expect(candidateRecord).toEqual(goldRecord);

      // --- Isolation assertions (T-84-03) ---

      // Exactly one model is registered for generate-fix at the eval org —
      // asserted directly, not assumed from the model-identity check above.
      const modelsForCapability = await runDb.db.getModelsForCapability('generate-fix', EVAL_ORG_ID);
      expect(modelsForCapability).toHaveLength(1);
      expect(modelsForCapability[0]?.id).toBe(runDb.modelId);

      // A retryable provider failure raises CapabilityExhaustedError rather
      // than silently substituting a different model's answer — because
      // there IS no different model in this database to fall back to.
      const failingAdapter: LLMProviderAdapter = {
        type: 'fixture-failing',
        connect: async () => {},
        disconnect: async () => {},
        healthCheck: async () => true,
        listModels: async () => [],
        complete: async () => {
          throw new ProviderHttpError(503, 'simulated upstream outage', true);
        },
      };
      await expect(
        executeGenerateFix(
          runDb.db,
          () => failingAdapter,
          { ...nonPoisonItem.input, orgId: EVAL_ORG_ID },
          { maxRetries: 0, retryDelayMs: 0 },
        ),
      ).rejects.toThrow(CapabilityExhaustedError);

      // --- Fixture adapter's own refusal (never silently answer for an unrecorded item) ---
      currentId = 'no-such-item-id';
      await expect(
        executeGenerateFix(
          runDb.db,
          () => adapter,
          { ...nonPoisonItem.input, orgId: EVAL_ORG_ID },
          { maxRetries: 0, retryDelayMs: 0 },
        ),
      ).rejects.toThrow(CapabilityExhaustedError);
      // Confirm the exhaustion was actually caused by MissingFixtureResponseError,
      // not by some unrelated failure — check the adapter throws that error directly.
      await expect(adapter.complete('irrelevant prompt', { model: 'irrelevant' })).rejects.toThrow(
        MissingFixtureResponseError,
      );
    } finally {
      await runDb.db.close();
    }
  });
});
