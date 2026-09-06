/**
 * `runHarness` — the full-set orchestrator for both durable capabilities
 * (Phase 84, HARNESS-01/HARNESS-02).
 *
 * Expands the 84-01 tracer from one item to a whole reference set, for
 * either `generate-fix` or `analyse-visual`. Loads the set through the
 * Phase 83 loaders, seeds the ephemeral single-model database
 * (`createEphemeralRunDb`, 84-01), and for each item calls
 * `executeGenerateFix`/`executeAnalyseVisual` — the LITERAL functions the
 * HTTP route (capabilities-exec.ts) and the MCP tools call. This module
 * never re-implements model selection, the retry loop, prompt-override
 * resolution or the telemetry wrapper: a second invocation path would drift
 * from the invariants the first one enforces, and a score produced through
 * it would not be a score of what production runs.
 *
 * Adapter selection is entirely the CALLER's concern. `runHarness` takes an
 * `adapterFactoryFor(itemId)` function — replay callers close over a fixture
 * map keyed by item id (`createFixtureAdapter`, 84-01); live callers ignore
 * the item id and always return the real `createAdapter`
 * (`providers/registry.ts`). This module imports NEITHER: it records
 * `options.mode` faithfully into the run's `RunFunction` but never decides,
 * from that mode, which adapter to dial — mode-specific adapter selection
 * lives entirely with the caller (the CLI, Task 3).
 *
 * A per-item capability failure (an exhausted model, a missing fixture) is
 * recorded as its own labelled `FailedItemRecord` and does NOT abort the
 * run and does NOT silently count as a low score — see `report.ts`.
 */
import { readFileSync } from 'node:fs';
import { createEphemeralRunDb, EVAL_ORG_ID, type EphemeralRunDb } from './run-context.js';
import { resolveReferenceSetPath } from './set-paths.js';
import { loadWcagFixSet, loadImageAltSet } from './load-reference-set.js';
import { scoreGenerateFix } from './score-generate-fix.js';
import { scoreAnalyseVisual } from './score-analyse-visual.js';
import { aggregateGenerateFix, aggregateAnalyseVisual } from './aggregate.js';
import { diagnoseRawResponse } from './diagnose-raw-response.js';
import {
  buildRunFunction,
  computeAnalyseVisualPromptVersion,
  computeGenerateFixPromptVersion,
  type RunMode,
} from './run-manifest.js';
import {
  isScoredItem,
  REPORT_SCHEMA_VERSION,
  sortItemsById,
  type AnalyseVisualReport,
  type GenerateFixReport,
  type ItemRecord,
} from './report.js';
import { executeGenerateFix, GENERATE_FIX_TEMPERATURE } from '../capabilities/generate-fix.js';
import { ANALYSE_VISUAL_TEMPERATURE, executeAnalyseVisual } from '../capabilities/analyse-visual.js';
import { CapabilityExhaustedError, CapabilityNotConfiguredError } from '../capabilities/types.js';
import type { GenerateFixScoreRecord } from './score-generate-fix.js';
import type { AnalyseVisualScoreRecord } from './score-analyse-visual.js';
import type { LLMProviderAdapter } from '../providers/types.js';
import type { ProviderType } from '../types.js';

export type HarnessCapability = 'generate-fix' | 'analyse-visual';

export interface RunHarnessProvider {
  readonly type: ProviderType;
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly timeout?: number;
}

export interface RunHarnessOptions {
  readonly capability: HarnessCapability;
  /** Recorded verbatim into the run's RunFunction — never inferred from `adapterFactoryFor`. */
  readonly mode: RunMode;
  /** Package root the reference-set files resolve from (`resolveReferenceSetPath`). */
  readonly packageRoot: string;
  readonly setVersion: string;
  /**
   * Builds the `(type) => LLMProviderAdapter` factory `executeGenerateFix`/
   * `executeAnalyseVisual` receive for a SPECIFIC item. Replay callers close
   * over a fixture map keyed by item id (a fresh fixture adapter per item is
   * cheap and pure); live callers ignore the item id.
   */
  readonly adapterFactoryFor: (itemId: string) => (type: string) => LLMProviderAdapter;
  /**
   * Seeds the ephemeral run db's single provider row via `updateProvider`
   * after `createEphemeralRunDb` creates it. Omit for a replay run — the
   * ephemeral db's default (`http://eval-harness.invalid`) is harmless
   * because a fixture adapter never dials out. A live run MUST supply this
   * explicitly (Task 3): the harness never reads a provider's endpoint or
   * credential from the production database.
   */
  readonly provider?: RunHarnessProvider;
  /** Provider-native model id the ephemeral db's single model row carries. */
  readonly modelIdOnProvider?: string;
}

export type RunHarnessResult =
  | { readonly capability: 'generate-fix'; readonly report: GenerateFixReport }
  | { readonly capability: 'analyse-visual'; readonly report: AnalyseVisualReport };

/** True for the two capability-level failure shapes a harness run must label, never fold into a zero score. */
function isLabelledCapabilityFailure(err: unknown): err is Error {
  return err instanceof CapabilityExhaustedError || err instanceof CapabilityNotConfiguredError;
}

/** Extracts a failure reason that surfaces the underlying cause (e.g. a fixture adapter's named missing-fixture error), not just the generic "exhausted" wrapper text. */
function describeFailure(err: Error): string {
  if (err instanceof CapabilityExhaustedError && err.lastError) {
    return `${err.message} (last error: ${err.lastError.message})`;
  }
  return err.message;
}

// Overloads so a call site passing a literal `capability` gets a narrowed
// return type (report.items/aggregate typed for that one capability),
// without callers needing a runtime discriminant check first.
export async function runHarness(
  options: RunHarnessOptions & { readonly capability: 'generate-fix' },
): Promise<{ readonly capability: 'generate-fix'; readonly report: GenerateFixReport }>;
export async function runHarness(
  options: RunHarnessOptions & { readonly capability: 'analyse-visual' },
): Promise<{ readonly capability: 'analyse-visual'; readonly report: AnalyseVisualReport }>;
export async function runHarness(options: RunHarnessOptions): Promise<RunHarnessResult> {
  const runDb = await createEphemeralRunDb(options.capability, {
    providerType: options.provider?.type,
    modelIdOnProvider: options.modelIdOnProvider,
  });

  try {
    if (options.provider) {
      await runDb.db.updateProvider(runDb.providerId, {
        baseUrl: options.provider.baseUrl,
        apiKey: options.provider.apiKey,
        timeout: options.provider.timeout,
      });
    }

    if (options.capability === 'generate-fix') {
      return { capability: 'generate-fix', report: await runGenerateFixSet(options, runDb) };
    }
    return { capability: 'analyse-visual', report: await runAnalyseVisualSet(options, runDb) };
  } finally {
    await runDb.db.close();
  }
}

async function runGenerateFixSet(
  options: RunHarnessOptions,
  runDb: EphemeralRunDb,
): Promise<GenerateFixReport> {
  const setPath = resolveReferenceSetPath(options.packageRoot, 'wcag-fixes');
  const set = loadWcagFixSet(setPath, options.setVersion);

  const items: ItemRecord<GenerateFixScoreRecord>[] = [];
  for (const item of set.items) {
    try {
      const capResult = await executeGenerateFix(
        runDb.db,
        options.adapterFactoryFor(item.id),
        { ...item.input, orgId: EVAL_ORG_ID },
        { maxRetries: 0, retryDelayMs: 0 },
      );
      items.push({
        itemId: item.id,
        outcome: 'scored',
        rawText: capResult.rawText,
        diagnosis: diagnoseRawResponse(capResult.rawText),
        score: scoreGenerateFix(capResult.data, item),
      });
    } catch (err) {
      if (!isLabelledCapabilityFailure(err)) throw err;
      items.push({ itemId: item.id, outcome: 'failed', failureReason: describeFailure(err) });
    }
  }

  const sorted = sortItemsById(items);
  const scoredRecords = sorted.filter(isScoredItem).map((i) => i.score);

  const provider = await runDb.db.getProvider(runDb.providerId);
  const model = await runDb.db.getModel(runDb.modelId);
  if (!provider || !model) {
    throw new Error('Ephemeral run db lost its own seeded provider/model row');
  }
  const promptOverride = await runDb.db.getPromptOverride('generate-fix', EVAL_ORG_ID);
  // The committed set is homogeneous in `platform` (all items are 'html');
  // a future heterogeneous set would need a per-item promptVersion, out of
  // scope here (see 84-RESEARCH.md Open Question 2 on scope).
  const platform = set.items[0]?.input.platform;

  const runFunction = buildRunFunction({
    capability: 'generate-fix',
    mode: options.mode,
    provider,
    model,
    temperature: GENERATE_FIX_TEMPERATURE,
    promptVersion: computeGenerateFixPromptVersion(platform, promptOverride),
    setName: set.set,
    setVersion: set.setVersion,
    itemCount: set.items.length,
  });

  return {
    reportSchemaVersion: REPORT_SCHEMA_VERSION,
    runFunction,
    items: sorted,
    aggregate: aggregateGenerateFix(scoredRecords),
    failedCount: sorted.length - scoredRecords.length,
  };
}

async function runAnalyseVisualSet(
  options: RunHarnessOptions,
  runDb: EphemeralRunDb,
): Promise<AnalyseVisualReport> {
  const setPath = resolveReferenceSetPath(options.packageRoot, 'image-alt');
  const set = loadImageAltSet(setPath, options.setVersion);

  const items: ItemRecord<AnalyseVisualScoreRecord>[] = [];
  for (const item of set.items) {
    try {
      const imageData = readFileSync(item.assetPath).toString('base64');
      const capResult = await executeAnalyseVisual(
        runDb.db,
        options.adapterFactoryFor(item.id),
        {
          check: item.input.check,
          image: { mediaType: item.mediaType, data: imageData },
          context: item.input.context,
          orgId: EVAL_ORG_ID,
        },
        { maxRetries: 0, retryDelayMs: 0 },
      );
      items.push({
        itemId: item.id,
        outcome: 'scored',
        rawText: capResult.rawText,
        diagnosis: diagnoseRawResponse(capResult.rawText),
        score: scoreAnalyseVisual(capResult.data, item),
      });
    } catch (err) {
      if (!isLabelledCapabilityFailure(err)) throw err;
      items.push({ itemId: item.id, outcome: 'failed', failureReason: describeFailure(err) });
    }
  }

  const sorted = sortItemsById(items);
  const scoredRecords = sorted.filter(isScoredItem).map((i) => i.score);

  const provider = await runDb.db.getProvider(runDb.providerId);
  const model = await runDb.db.getModel(runDb.modelId);
  if (!provider || !model) {
    throw new Error('Ephemeral run db lost its own seeded provider/model row');
  }
  const promptOverride = await runDb.db.getPromptOverride('analyse-visual', EVAL_ORG_ID);
  // The committed set exclusively uses check: 'alt-text' (84-RESEARCH.md Open
  // Question 2 — scoped deliberately; a future heading-semantics set is out
  // of scope for this phase).
  const check = set.items[0]?.input.check ?? 'alt-text';

  const runFunction = buildRunFunction({
    capability: 'analyse-visual',
    mode: options.mode,
    provider,
    model,
    temperature: ANALYSE_VISUAL_TEMPERATURE,
    promptVersion: computeAnalyseVisualPromptVersion(check, promptOverride),
    setName: set.set,
    setVersion: set.setVersion,
    itemCount: set.items.length,
  });

  return {
    reportSchemaVersion: REPORT_SCHEMA_VERSION,
    runFunction,
    items: sorted,
    aggregate: aggregateAnalyseVisual(scoredRecords),
    failedCount: sorted.length - scoredRecords.length,
  };
}
