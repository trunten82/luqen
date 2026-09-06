/**
 * `scoreGenerateFix` — a pure scorer for `generate-fix` candidates against a
 * `WcagFixItem`'s known-good answer (Phase 84, HARNESS-01/HARNESS-05).
 *
 * THIN TRACER VERSION (84-01 Task 2): only the signature, purity, and the
 * two axes needed to prove the end-to-end path. Task 3 (84-01) completes the
 * full labelled axis set (missing mentions, effort match, filename-shaped
 * alt) via its own RED/GREEN TDD cycle — do not treat this file's shape as
 * final until that commit lands.
 *
 * Purity is a requirement, not a preference: this function takes no db, no
 * adapter, no filesystem, no clock. HARNESS-05's break-test (84-03) must run
 * in CI with no provider credentials and no spend, and it does so by feeding
 * `item.poison.candidate` (shaped exactly like `GenerateFixResult`) straight
 * into this function.
 *
 * Markup normalisation rule (shared by every axis comparing HTML): trim
 * leading/trailing whitespace, then collapse any run of whitespace
 * (including newlines) into a single space. This exists so harmless
 * formatting variance is never mistaken for a real mismatch, and so a real
 * mismatch is never masked by whitespace differences alone.
 */
import type { GenerateFixResult } from '../capabilities/generate-fix.js';
import type { WcagFixItem } from './types.js';

function normaliseMarkup(html: string): string {
  return html.trim().replace(/\s+/g, ' ');
}

export interface GenerateFixScoreRecord {
  readonly exactMatch: boolean;
  readonly emptyFix: boolean;
}

export type ScoredCandidate = Pick<GenerateFixResult, 'fixedHtml' | 'explanation' | 'effort'>;

export function scoreGenerateFix(candidate: ScoredCandidate, item: WcagFixItem): GenerateFixScoreRecord {
  return {
    exactMatch: normaliseMarkup(candidate.fixedHtml) === normaliseMarkup(item.expected.fixedHtml),
    emptyFix: candidate.fixedHtml.trim() === '',
  };
}

/** Synthesises the item's known-good answer into the capability's own result shape. */
export function goldResultFor(item: WcagFixItem): GenerateFixResult {
  return {
    fixedHtml: item.expected.fixedHtml,
    explanation: item.expected.explanationMustMention.join('. '),
    effort: item.expected.effort,
    wcagCriterion: item.input.wcagCriterion,
  };
}
