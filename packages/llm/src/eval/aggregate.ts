/**
 * Aggregate functions over per-item score records (Phase 84, HARNESS-03).
 *
 * One aggregate per capability, over arrays of that capability's own score
 * record type. Both aggregates' exact key sets are pinned in the committed
 * tests by positive equality against a literal array — a future convenience
 * field fusing two distinct counters (e.g. false-PASS + false-ISSUE into one
 * "wrong" count) fails that assertion the moment it is added, not the moment
 * someone notices in review.
 */
import type { GenerateFixScoreRecord } from './score-generate-fix.js';
import type { AnalyseVisualScoreRecord } from './score-analyse-visual.js';

export interface GenerateFixAggregate {
  readonly total: number;
  readonly exactMatchCount: number;
  readonly unchangedFromInputCount: number;
  readonly emptyFixCount: number;
  readonly missingMentionsCount: number;
  readonly effortMatchCount: number;
  readonly filenameShapedAltCount: number;
}

export function aggregateGenerateFix(
  records: readonly GenerateFixScoreRecord[],
): GenerateFixAggregate {
  return {
    total: records.length,
    exactMatchCount: records.filter((r) => r.exactMatch).length,
    unchangedFromInputCount: records.filter((r) => r.unchangedFromInput).length,
    emptyFixCount: records.filter((r) => r.emptyFix).length,
    missingMentionsCount: records.filter((r) => r.missingMentions.length > 0).length,
    effortMatchCount: records.filter((r) => r.effortMatch).length,
    filenameShapedAltCount: records.filter((r) => r.filenameShapedAlt).length,
  };
}

/**
 * The four verdict-outcome counters are kept SEPARATE by construction --
 * false-PASS and false-ISSUE never share a field, so there is no "wrong"
 * count to accidentally read as one blended accuracy figure (HARNESS-03).
 */
export interface AnalyseVisualAggregate {
  readonly total: number;
  readonly correct: number;
  readonly falsePass: number;
  readonly falseIssue: number;
  readonly uncertain: number;
  readonly altClassificationMismatchCount: number;
  readonly suggestedAltFilenameShapedCount: number;
  readonly suggestedAltEmptyDespiteInformationalCount: number;
}

export function aggregateAnalyseVisual(
  records: readonly AnalyseVisualScoreRecord[],
): AnalyseVisualAggregate {
  return {
    total: records.length,
    correct: records.filter((r) => r.verdictOutcome === 'correct').length,
    falsePass: records.filter((r) => r.verdictOutcome === 'false-pass').length,
    falseIssue: records.filter((r) => r.verdictOutcome === 'false-issue').length,
    uncertain: records.filter((r) => r.verdictOutcome === 'uncertain').length,
    altClassificationMismatchCount: records.filter((r) => r.altClassificationMismatch).length,
    suggestedAltFilenameShapedCount: records.filter((r) => r.suggestedAltAxis === 'filename-shaped').length,
    suggestedAltEmptyDespiteInformationalCount: records.filter(
      (r) => r.suggestedAltAxis === 'empty-despite-informational',
    ).length,
  };
}
