/**
 * `scoreAnalyseVisual` — a pure scorer for `analyse-visual` candidates against
 * an `ImageAltItem`'s known-good answer (Phase 84, HARNESS-03/HARNESS-05).
 *
 * Purity is a requirement, not a preference, for the same reason as
 * `score-generate-fix.ts`: this function takes no db, no adapter, no
 * filesystem, no clock. HARNESS-05's break-test (84-03) must run in CI with
 * no provider credentials and no spend, and it does so by feeding
 * `item.poison.candidate` (shaped exactly like `AnalyseVisualResult`)
 * straight into this function.
 *
 * HARNESS-03's central discipline: a false PASS (accepting `pass` on a real
 * violation) is the expensive error — it can elevate a criterion to
 * "Supports" in a document someone relies on legally — while a false ISSUE
 * (flagging an already-correct alt) is cheap. `verdictOutcome` keeps the two
 * directions as two SEPARATE named outcomes, never fused into one number,
 * and keeps the candidate's own `uncertain` as a FOURTH outcome — neither a
 * correct answer nor either error, so a swallowed-parse case is never hidden
 * inside a bucket that would make it look like a confident answer.
 *
 * The record emits NO number. Phase 85 sets the bars and decides which
 * combination of these outcomes constitutes a pass; a blended figure
 * invented here would quietly decide Phase 85's bar before Phase 85 exists.
 */
import type { AnalyseVisualResult } from '../capabilities/analyse-visual.js';
import type { ImageAltItem } from './types.js';

// Matches a suggestedAlt value ending in a common image file extension --
// the W3C F30 failure pattern: placeholder/filename text used in place of a
// real text alternative. Deliberately checks the bare suggestedAlt string
// (not an `alt="..."` HTML attribute) since AnalyseVisualResult.suggestedAlt
// is already the extracted value, not markup.
const IMAGE_FILENAME_PATTERN = /\.(jpe?g|png|gif|webp|svg|bmp)$/i;

function isFilenameShaped(suggestedAlt: string): boolean {
  return IMAGE_FILENAME_PATTERN.test(suggestedAlt.trim());
}

export type VerdictOutcome = 'correct' | 'false-pass' | 'false-issue' | 'uncertain';
export type SuggestedAltAxis = 'ok' | 'filename-shaped' | 'empty-despite-informational';

export interface AnalyseVisualScoreRecord {
  /**
   * Four named outcomes, never two and never one blended figure. `uncertain`
   * is the candidate's OWN uncertain verdict -- not a correct answer and not
   * either error, for BOTH ground-truth directions.
   */
  readonly verdictOutcome: VerdictOutcome;
  /** Candidate's altClassification does not match the item's stored expected classification, independent of verdictOutcome. */
  readonly altClassificationMismatch: boolean;
  /**
   * Two DISTINCT labelled failure modes for suggestedAlt, never reduced to a
   * single not-ok flag: 'filename-shaped' (the W3C F30 pattern) and
   * 'empty-despite-informational' (empty text beside a confident,
   * non-decorative classification -- the shape a swallowed parse failure
   * produces). 'ok' for a plausible alt string.
   */
  readonly suggestedAltAxis: SuggestedAltAxis;
}

function classifyVerdict(
  candidateVerdict: AnalyseVisualResult['verdict'],
  expectedVerdict: ImageAltItem['expectedVerdict'],
): VerdictOutcome {
  if (candidateVerdict === 'uncertain') return 'uncertain';
  if (expectedVerdict === 'issue') {
    return candidateVerdict === 'issue' ? 'correct' : 'false-pass';
  }
  return candidateVerdict === 'pass' ? 'correct' : 'false-issue';
}

function classifySuggestedAlt(candidate: AnalyseVisualResult): SuggestedAltAxis {
  const suggestedAlt = candidate.suggestedAlt ?? '';
  if (isFilenameShaped(suggestedAlt)) return 'filename-shaped';
  if (suggestedAlt.trim() === '' && candidate.altClassification === 'informational') {
    return 'empty-despite-informational';
  }
  return 'ok';
}

export function scoreAnalyseVisual(
  candidate: AnalyseVisualResult,
  item: ImageAltItem,
): AnalyseVisualScoreRecord {
  return {
    verdictOutcome: classifyVerdict(candidate.verdict, item.expectedVerdict),
    altClassificationMismatch: candidate.altClassification !== item.expected.altClassification,
    suggestedAltAxis: classifySuggestedAlt(candidate),
  };
}

/**
 * Synthesises the item's known-good answer into the capability's own result
 * shape -- mirrors `goldResultFor` in `score-generate-fix.ts`. There is no
 * `expected.findings` field on a reference item, so a single gold finding is
 * constructed only when ground truth is `issue` (an `issue` verdict with an
 * empty findings array would itself trip the manufactured-pass shape this
 * plan exists to characterise).
 */
export function goldAnalyseVisualResultFor(item: ImageAltItem): AnalyseVisualResult {
  return {
    verdict: item.expectedVerdict,
    findings: item.expectedVerdict === 'issue'
      ? [{ description: 'Reference set gold finding', wcagCriterion: '1.1.1', confidence: 'high' }]
      : [],
    altClassification: item.expected.altClassification,
    suggestedAlt: item.expected.suggestedAlt,
  };
}

/**
 * Returns the NAMES of the axes on which `candidate` is worse than `gold`.
 * Empty when `candidate` equals `gold` on every axis. Mirrors
 * `downgradesAgainst` in `score-generate-fix.ts`: "scored down" is a SET of
 * named failures, never a number crossing a threshold.
 */
export function downgradesAgainstAnalyseVisual(
  gold: AnalyseVisualScoreRecord,
  candidate: AnalyseVisualScoreRecord,
): readonly string[] {
  const downgrades: string[] = [];

  if (gold.verdictOutcome === 'correct' && candidate.verdictOutcome !== 'correct') {
    downgrades.push('verdictOutcome');
  }
  if (!gold.altClassificationMismatch && candidate.altClassificationMismatch) {
    downgrades.push('altClassificationMismatch');
  }
  if (gold.suggestedAltAxis === 'ok' && candidate.suggestedAltAxis !== 'ok') {
    downgrades.push('suggestedAltAxis');
  }

  return downgrades;
}
