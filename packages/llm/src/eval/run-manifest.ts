/**
 * `run-manifest.ts` — HARNESS-04: the run function, and the refusal to
 * compare across it.
 *
 * A harness result is meaningless without recording what it is a function
 * of. This module computes the one field that has no existing concept
 * anywhere in this codebase (prompt version), and — once Task 3 lands —
 * defines `RunFunction` itself plus the refusal to compare two runs whose
 * function differs on anything but timestamp.
 *
 * This module does NOT judge a run. No bar, margin, or verdict is
 * implemented here.
 */
import { createHash } from 'node:crypto';
import type { PromptOverride } from '../types.js';
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
