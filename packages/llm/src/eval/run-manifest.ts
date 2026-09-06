/**
 * `run-manifest.ts` — HARNESS-04: the run function, and the refusal to
 * compare across it.
 *
 * A harness result is meaningless without recording what it is a function
 * of. This module defines `RunFunction` (every field required — an optional
 * field here is a field that will be missing exactly when it matters),
 * computes the one field that has no existing concept anywhere in this
 * codebase (prompt version), and refuses to compare two runs whose function
 * differs on anything but timestamp.
 *
 * This module does NOT judge a run. No bar, margin, or verdict is
 * implemented here — see the "Phase 85 seam" comment below.
 */
import { createHash } from 'node:crypto';
import type { CapabilityName, Provider, Model, ProviderType, PromptOverride } from '../types.js';
import { VERSION } from '../version.js';
import { buildGenerateFixPrompt, buildGutenbergFixPrompt } from '../prompts/generate-fix.js';
import { buildAnalyseVisualPrompt } from '../prompts/analyse-visual.js';
import type { VisualCheck } from '../prompts/analyse-visual.js';

// ---------------------------------------------------------------------------
// Prompt version (Task 2)
// ---------------------------------------------------------------------------

export type PromptSource = 'default' | 'override';

export interface PromptVersion {
  /** Short hex digest of the applied template, rendered through a frozen canonical input. */
  readonly digest: string;
  readonly source: PromptSource;
}

/**
 * Frozen, exported canonical input for rendering the generate-fix templates
 * when computing a prompt version. Sentinel values only — never real item
 * data. `cssContext` is always populated so `buildGenerateFixPrompt`'s
 * conditional CSS section is never sometimes-present/sometimes-absent
 * depending on which item happened to be scored; the hash must track only
 * the TEMPLATE's shape and wording, not per-item variance.
 */
export const CANONICAL_GENERATE_FIX_PROMPT_INPUT = Object.freeze({
  wcagCriterion: 'RUN-MANIFEST-CANONICAL-1.1.1',
  issueMessage: 'RUN-MANIFEST-CANONICAL-ISSUE-MESSAGE',
  htmlContext: '<div>RUN-MANIFEST-CANONICAL-HTML-CONTEXT</div>',
  cssContext: '.run-manifest-canonical { color: red; }',
});

/** Frozen, exported canonical context for rendering the analyse-visual templates. */
export const CANONICAL_ANALYSE_VISUAL_CONTEXT = 'RUN-MANIFEST-CANONICAL-CONTEXT';

function digestTemplateText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
}

/**
 * Mirrors `generate-fix.ts`'s private `applyPromptTemplate` byte-for-byte
 * (same four `{{token}}` substitutions, same order). This is a deliberate,
 * narrow duplication, not a re-implementation of prompt construction:
 * `generate-fix.ts`'s diff for this plan is confined to the temperature
 * constant (matching the same confinement enforced on `analyse-visual.ts`
 * by the plan's non-negotiables), so the private helper cannot be imported
 * without widening that diff. This copy is used ONLY to compute a
 * versioning hash against a frozen canonical input — never to build a
 * prompt that reaches a model. If `generate-fix.ts` ever changes its
 * `{{token}}` substitution set, update this function in the same commit.
 */
function renderGenerateFixOverrideForVersion(template: string): string {
  const input = CANONICAL_GENERATE_FIX_PROMPT_INPUT;
  return template
    .replace(/\{\{wcagCriterion\}\}/g, input.wcagCriterion)
    .replace(/\{\{issueMessage\}\}/g, input.issueMessage)
    .replace(/\{\{htmlContext\}\}/g, input.htmlContext)
    .replace(/\{\{cssContext\}\}/g, input.cssContext);
}

/**
 * Mirrors `analyse-visual.ts`'s inline override substitution
 * (`promptOverride.template.replace(/\{\{context\}\}/g, input.context)`)
 * byte-for-byte, for the same reason and under the same constraint
 * documented on `renderGenerateFixOverrideForVersion` above.
 */
function renderAnalyseVisualOverrideForVersion(template: string): string {
  return template.replace(/\{\{context\}\}/g, CANONICAL_ANALYSE_VISUAL_CONTEXT);
}

/**
 * Computes the prompt version generate-fix actually applied for a run,
 * honouring the SAME precedence `executeGenerateFix` uses
 * (generate-fix.ts:108-112): an override, when present, replaces the
 * default template entirely — the returned version must never imply the
 * shipped default was used when it was not.
 */
export function computeGenerateFixPromptVersion(
  platform: 'html' | 'wordpress-gutenberg' | undefined,
  override: PromptOverride | undefined,
): PromptVersion {
  if (override != null) {
    return {
      digest: digestTemplateText(renderGenerateFixOverrideForVersion(override.template)),
      source: 'override',
    };
  }
  const rendered = platform === 'wordpress-gutenberg'
    ? buildGutenbergFixPrompt(CANONICAL_GENERATE_FIX_PROMPT_INPUT)
    : buildGenerateFixPrompt(CANONICAL_GENERATE_FIX_PROMPT_INPUT);
  return { digest: digestTemplateText(rendered), source: 'default' };
}

/**
 * Computes the prompt version analyse-visual actually applied for a run,
 * honouring the same override precedence as `executeAnalyseVisual`
 * (analyse-visual.ts:118-120).
 */
export function computeAnalyseVisualPromptVersion(
  check: VisualCheck,
  override: PromptOverride | undefined,
): PromptVersion {
  if (override != null) {
    return {
      digest: digestTemplateText(renderAnalyseVisualOverrideForVersion(override.template)),
      source: 'override',
    };
  }
  const rendered = buildAnalyseVisualPrompt({ check, context: CANONICAL_ANALYSE_VISUAL_CONTEXT });
  return { digest: digestTemplateText(rendered), source: 'default' };
}

// ---------------------------------------------------------------------------
// RunFunction (Task 3)
// ---------------------------------------------------------------------------

export type RunMode = 'live' | 'replay';

/**
 * This module's own scoring-semantics version. Combined with the package
 * `VERSION` (`src/version.ts`) to form `RunFunction.harnessVersion`, so a
 * change to how THIS module scores/compares runs can bump the harness
 * version without waiting for a package release.
 */
export const HARNESS_SCHEMA_VERSION = '1';

/**
 * Everything a harness result is a function of. Every field is REQUIRED —
 * an optional field here is a field that will be missing exactly when it
 * matters. `assertComparable` refuses to compare two records that differ on
 * any field below except `timestamp`.
 */
export interface RunFunction {
  readonly harnessVersion: string;
  readonly capability: CapabilityName;
  readonly mode: RunMode;
  /** Provider-native model id (e.g. "llama3.2"), never the display name. */
  readonly modelId: string;
  readonly modelDisplayName: string;
  readonly providerType: ProviderType;
  /**
   * A non-reversible fingerprint of the provider's base URL — never the URL
   * itself. This repository is public and its real endpoints are internal
   * hosts; a run report is exactly the artifact a maintainer commits. The
   * fingerprint still keeps the run function honest: the same model served
   * from two different endpoints is a different run function and must be
   * refused as incomparable.
   */
  readonly endpointFingerprint: string;
  readonly temperature: number;
  readonly promptVersion: string;
  readonly promptSource: PromptSource;
  readonly setName: string;
  readonly setVersion: string;
  readonly itemCount: number;
  readonly timestamp: string;
}

/** A short, non-reversible fingerprint of a provider base URL. Never store the URL itself. */
export function computeEndpointFingerprint(baseUrl: string): string {
  return createHash('sha256').update(baseUrl, 'utf8').digest('hex').slice(0, 16);
}

export interface BuildRunFunctionInput {
  readonly capability: CapabilityName;
  readonly mode: RunMode;
  /** Only `.type`/`.baseUrl` are read — passing a full `Provider` (with `apiKey`) is safe by construction. */
  readonly provider: Pick<Provider, 'type' | 'baseUrl'>;
  /** Only `.modelId`/`.displayName` are read. */
  readonly model: Pick<Model, 'modelId' | 'displayName'>;
  readonly temperature: number;
  readonly promptVersion: PromptVersion;
  readonly setName: string;
  readonly setVersion: string;
  readonly itemCount: number;
  /** Defaults to `new Date().toISOString()`. Exposed for deterministic tests. */
  readonly timestamp?: string;
}

/**
 * Builds a `RunFunction` from the pieces of a completed (or about-to-run)
 * harness invocation. Never spreads `input.provider`/`input.model` — reads
 * only the named fields — so a credential or base URL on the source object
 * can never reach the returned record, regardless of what shape the caller
 * passes in.
 */
export function buildRunFunction(input: BuildRunFunctionInput): RunFunction {
  return {
    harnessVersion: `${HARNESS_SCHEMA_VERSION}+${VERSION}`,
    capability: input.capability,
    mode: input.mode,
    modelId: input.model.modelId,
    modelDisplayName: input.model.displayName,
    providerType: input.provider.type,
    endpointFingerprint: computeEndpointFingerprint(input.provider.baseUrl),
    temperature: input.temperature,
    promptVersion: input.promptVersion.digest,
    promptSource: input.promptVersion.source,
    setName: input.setName,
    setVersion: input.setVersion,
    itemCount: input.itemCount,
    timestamp: input.timestamp ?? new Date().toISOString(),
  };
}

/** Every `RunFunction` field `assertComparable` compares — everything except `timestamp`. */
const COMPARABLE_FIELDS = [
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
] as const satisfies readonly (keyof RunFunction)[];

/**
 * Thrown by `assertComparable` when two `RunFunction` records differ on any
 * field except `timestamp`. Carries every differing field name, not just
 * the first, following the named-error-subclass pattern established by
 * Phase 83 (`src/eval/types.ts`) rather than a bare `Error`.
 */
export class RunFunctionMismatchError extends Error {
  constructor(public readonly differingFields: readonly string[]) {
    super(`Run functions are not comparable — differing fields: ${differingFields.join(', ')}`);
    this.name = 'RunFunctionMismatchError';
  }
}

/**
 * Refuses to compare two runs whose function differs. Compares every field
 * of `RunFunction` EXCEPT `timestamp`: two runs of the exact same function
 * at different times are exactly the comparison Phase 86's run-to-run
 * variance measurement needs, so timestamp alone differing must never block
 * comparison.
 */
export function assertComparable(a: RunFunction, b: RunFunction): void {
  const differing = COMPARABLE_FIELDS.filter((field) => a[field] !== b[field]);
  if (differing.length > 0) {
    throw new RunFunctionMismatchError(differing);
  }
}

// ---------------------------------------------------------------------------
// Phase 85 seam — read before extending this module
// ---------------------------------------------------------------------------
//
// Phase 85 (pre-registered decision bars) adds a VERDICT object that CARRIES
// this RunFunction, plus a REQUIRED "power" field: the bar, the measured
// value, the variance ASSUMPTION the sample size was chosen from, and the
// observed variance. Phase 85 must NOT need to change any of the following:
//   - RunFunction's field set (the fourteen fields above)
//   - assertComparable's comparison semantics (every field but timestamp)
//   - the absence of any pass/fail judgement anywhere in this module
// Phase 84 records what a run is a function of; it does not judge the run.
// Do not add a bar, margin, threshold, or verdict to this module.
