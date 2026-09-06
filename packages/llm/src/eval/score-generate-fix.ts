/**
 * `scoreGenerateFix` — a pure scorer for `generate-fix` candidates against a
 * `WcagFixItem`'s known-good answer (Phase 84, HARNESS-01/HARNESS-05).
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
 *
 * The record emits NO blended number and NO convenience score field, here
 * or anywhere downstream. Phase 85 sets the non-inferiority margin and
 * decides which combination of these axes constitutes a pass — collapsing
 * them now would quietly decide Phase 85's bar before Phase 85 exists.
 * `downgradesAgainst` expresses "scored down" as a SET of named failures,
 * never as one number crossing a threshold.
 */
import type { GenerateFixResult } from '../capabilities/generate-fix.js';
import type { WcagFixItem } from './types.js';

function normaliseMarkup(html: string): string {
  return html.trim().replace(/\s+/g, ' ');
}

// Matches an `alt="..."` (or single-quoted) value ending in a common image
// file extension -- the W3C F30 failure pattern: placeholder/filename text
// used in place of a real text alternative.
const ALT_ATTR_PATTERN = /alt=["']([^"']*)["']/gi;
const IMAGE_FILENAME_PATTERN = /\.(jpe?g|png|gif|webp|svg|bmp)$/i;

function hasFilenameShapedAlt(html: string): boolean {
  const altValues = [...html.matchAll(ALT_ATTR_PATTERN)].map((m) => (m[1] ?? '').trim());
  return altValues.some((value) => IMAGE_FILENAME_PATTERN.test(value));
}

export interface GenerateFixScoreRecord {
  /** Candidate's fixedHtml matches the item's known-good fix, after normalisation. */
  readonly exactMatch: boolean;
  /** Candidate's fixedHtml is unchanged from the offending input markup -- no fix was applied. */
  readonly unchangedFromInput: boolean;
  /** Candidate's fixedHtml is empty (or whitespace-only). */
  readonly emptyFix: boolean;
  /** Which of the item's required explanation mentions are NOT present (case-insensitive substring). Empty = all present. */
  readonly missingMentions: readonly string[];
  /** Candidate's effort estimate matches the item's expected effort. */
  readonly effortMatch: boolean;
  /** Any alt attribute value in the candidate markup ends in an image file extension (W3C F30). */
  readonly filenameShapedAlt: boolean;
}

export type ScoredCandidate = Pick<GenerateFixResult, 'fixedHtml' | 'explanation' | 'effort'>;

export function scoreGenerateFix(candidate: ScoredCandidate, item: WcagFixItem): GenerateFixScoreRecord {
  const normalisedCandidate = normaliseMarkup(candidate.fixedHtml);
  const explanationLower = candidate.explanation.toLowerCase();

  return {
    exactMatch: normalisedCandidate === normaliseMarkup(item.expected.fixedHtml),
    unchangedFromInput: normalisedCandidate === normaliseMarkup(item.input.htmlContext),
    emptyFix: candidate.fixedHtml.trim() === '',
    missingMentions: item.expected.explanationMustMention.filter(
      (mention) => !explanationLower.includes(mention.toLowerCase()),
    ),
    effortMatch: candidate.effort === item.expected.effort,
    filenameShapedAlt: hasFilenameShapedAlt(candidate.fixedHtml),
  };
}

/** Synthesises the item's known-good answer into the capability's own result shape. */
export function goldResultFor(item: WcagFixItem): GenerateFixResult {
  return {
    fixedHtml: item.expected.fixedHtml,
    // No `expected.explanation` field exists on a reference item -- the
    // required mentions ARE the checklist, so joining them is a genuine
    // (if inelegant) known-good explanation: every required mention is
    // present by construction.
    explanation: item.expected.explanationMustMention.join('. '),
    effort: item.expected.effort,
    wcagCriterion: item.input.wcagCriterion,
  };
}

// Axis polarity for the boolean axes: true means "true is the GOOD value".
// `missingMentions` is handled separately (fewer is better, list not count).
const GOOD_WHEN_TRUE: Record<
  'exactMatch' | 'unchangedFromInput' | 'emptyFix' | 'effortMatch' | 'filenameShapedAlt',
  boolean
> = {
  exactMatch: true,
  unchangedFromInput: false,
  emptyFix: false,
  effortMatch: true,
  filenameShapedAlt: false,
};

/**
 * Returns the NAMES of the axes on which `candidate` is worse than `gold`.
 * Empty when `candidate` equals `gold`. This is how "scored down" is
 * expressed in this phase -- as a set of named failures, never as one
 * number crossing a threshold.
 */
export function downgradesAgainst(
  gold: GenerateFixScoreRecord,
  candidate: GenerateFixScoreRecord,
): readonly string[] {
  const downgrades: string[] = [];

  for (const axis of Object.keys(GOOD_WHEN_TRUE) as Array<keyof typeof GOOD_WHEN_TRUE>) {
    const goodWhenTrue = GOOD_WHEN_TRUE[axis];
    const goldIsGood = goodWhenTrue ? gold[axis] : !gold[axis];
    const candidateIsGood = goodWhenTrue ? candidate[axis] : !candidate[axis];
    if (goldIsGood && !candidateIsGood) downgrades.push(axis);
  }

  if (candidate.missingMentions.length > gold.missingMentions.length) {
    downgrades.push('missingMentions');
  }

  return downgrades;
}
