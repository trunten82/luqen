/**
 * `scoreAnalyseVisual` and `aggregate.ts` -- four named verdict outcomes,
 * two labelled axes, no fused number (Phase 84, HARNESS-03).
 */
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { loadImageAltSet } from '../../src/eval/load-reference-set.js';
import {
  scoreAnalyseVisual,
  goldAnalyseVisualResultFor,
  downgradesAgainstAnalyseVisual,
} from '../../src/eval/score-analyse-visual.js';
import { aggregateAnalyseVisual, aggregateGenerateFix } from '../../src/eval/aggregate.js';
import type { AnalyseVisualResult } from '../../src/capabilities/analyse-visual.js';
import type { ImageAltItem } from '../../src/eval/types.js';

const SET_PATH = join(process.cwd(), 'tests', 'eval', 'sets', 'image-alt.v1.json');

const EXPECTED_RECORD_KEYS = ['altClassificationMismatch', 'suggestedAltAxis', 'verdictOutcome'].sort();

const EXPECTED_ANALYSE_VISUAL_AGGREGATE_KEYS = [
  'altClassificationMismatchCount',
  'correct',
  'falseIssue',
  'falsePass',
  'suggestedAltEmptyDespiteInformationalCount',
  'suggestedAltFilenameShapedCount',
  'total',
  'uncertain',
].sort();

const EXPECTED_GENERATE_FIX_AGGREGATE_KEYS = [
  'effortMatchCount',
  'emptyFixCount',
  'exactMatchCount',
  'filenameShapedAltCount',
  'missingMentionsCount',
  'total',
  'unchangedFromInputCount',
].sort();

function loadSet(): readonly ImageAltItem[] {
  return loadImageAltSet(SET_PATH, 'v1').items;
}

function findItem(items: readonly ImageAltItem[], id: string): ImageAltItem {
  const item = items.find((i) => i.id === id);
  if (item === undefined) throw new Error(`fixture item "${id}" not found in committed set`);
  return item;
}

describe('scoreAnalyseVisual — four named verdict outcomes, two labelled axes (HARNESS-03)', () => {
  it('the per-item record exposes exactly the pinned key set — no numeric field', () => {
    const items = loadSet();
    const item = items[0] as ImageAltItem;
    const record = scoreAnalyseVisual(goldAnalyseVisualResultFor(item), item);
    expect(Object.keys(record).sort()).toEqual(EXPECTED_RECORD_KEYS);
  });

  it('correct outcome: candidate verdict matches an issue ground truth', () => {
    const items = loadSet();
    const item = findItem(items, 'informative-telephone-icon');
    expect(item.expectedVerdict).toBe('issue');
    const candidate: AnalyseVisualResult = {
      verdict: 'issue',
      findings: [{ description: 'Missing alt text', wcagCriterion: '1.1.1', confidence: 'high' }],
      altClassification: 'informational',
      suggestedAlt: 'Telephone',
    };
    expect(scoreAnalyseVisual(candidate, item).verdictOutcome).toBe('correct');
  });

  it('correct outcome: candidate verdict matches a pass ground truth', () => {
    const items = loadSet();
    const item = findItem(items, 'informative-fax-icon');
    expect(item.expectedVerdict).toBe('pass');
    const candidate: AnalyseVisualResult = {
      verdict: 'pass',
      findings: [],
      altClassification: 'informational',
      suggestedAlt: 'Fax',
    };
    expect(scoreAnalyseVisual(candidate, item).verdictOutcome).toBe('correct');
  });

  it('false-pass outcome: expectedVerdict issue, candidate verdict pass — the expensive error', () => {
    const items = loadSet();
    const item = findItem(items, 'img-informative-seed');
    const record = scoreAnalyseVisual(item.poison!.candidate as AnalyseVisualResult, item);
    expect(record.verdictOutcome).toBe('false-pass');
  });

  it('false-issue outcome: expectedVerdict pass, candidate verdict issue — the cheap error', () => {
    const items = loadSet();
    const item = findItem(items, 'functional-print-icon');
    const record = scoreAnalyseVisual(item.poison!.candidate as AnalyseVisualResult, item);
    expect(record.verdictOutcome).toBe('false-issue');
  });

  it('uncertain outcome: candidate uncertain against an issue ground truth is never folded into false-pass', () => {
    const items = loadSet();
    const item = findItem(items, 'img-informative-seed');
    const candidate: AnalyseVisualResult = { verdict: 'uncertain', findings: [] };
    const record = scoreAnalyseVisual(candidate, item);
    expect(record.verdictOutcome).toBe('uncertain');
    expect(record.verdictOutcome).not.toBe('false-pass');
    expect(record.verdictOutcome).not.toBe('correct');
  });

  it('uncertain outcome: candidate uncertain against a pass ground truth is never folded into false-issue or correct', () => {
    const items = loadSet();
    const item = findItem(items, 'functional-print-icon');
    const candidate: AnalyseVisualResult = { verdict: 'uncertain', findings: [] };
    const record = scoreAnalyseVisual(candidate, item);
    expect(record.verdictOutcome).toBe('uncertain');
    expect(record.verdictOutcome).not.toBe('false-issue');
    expect(record.verdictOutcome).not.toBe('correct');
  });

  it('altClassification axis reports a mismatch independently of verdict outcome', () => {
    const items = loadSet();
    const item = findItem(items, 'decorative-geometric-pattern');
    expect(item.expected.altClassification).toBe('decorative');
    expect(item.expectedVerdict).toBe('pass');
    const candidate: AnalyseVisualResult = {
      verdict: 'pass',
      findings: [],
      altClassification: 'informational',
      suggestedAlt: '',
    };
    const record = scoreAnalyseVisual(candidate, item);
    expect(record.verdictOutcome).toBe('correct');
    expect(record.altClassificationMismatch).toBe(true);
  });

  it('suggestedAlt axis: filename-shaped and empty-despite-informational are two DISTINCT states', () => {
    const items = loadSet();
    const filenameItem = findItem(items, 'complex-energy-consumption');
    const emptyItem = findItem(items, 'complex-thyroid-incidence');

    const filenameRecord = scoreAnalyseVisual(
      filenameItem.poison!.candidate as AnalyseVisualResult,
      filenameItem,
    );
    const emptyRecord = scoreAnalyseVisual(emptyItem.poison!.candidate as AnalyseVisualResult, emptyItem);

    expect(filenameRecord.suggestedAltAxis).toBe('filename-shaped');
    expect(emptyRecord.suggestedAltAxis).toBe('empty-despite-informational');
    expect(filenameRecord.suggestedAltAxis).not.toBe(emptyRecord.suggestedAltAxis);
    // Both poison items have an entirely CORRECT verdict — only the
    // suggestedAlt axis catches them. A verdict-only scorer would score both
    // clean, which is the exact gap this axis exists to close.
    expect(filenameRecord.verdictOutcome).toBe('correct');
    expect(emptyRecord.verdictOutcome).toBe('correct');
  });

  it('suggestedAlt axis reports neither state for a plausible alt string', () => {
    const items = loadSet();
    const item = findItem(items, 'informative-bicycle-photo');
    const record = scoreAnalyseVisual(goldAnalyseVisualResultFor(item), item);
    expect(record.suggestedAltAxis).toBe('ok');
  });

  it('suggestedAlt axis does not fire on a legitimately empty decorative alt', () => {
    const items = loadSet();
    const item = findItem(items, 'decorative-wallpaper-corner');
    expect(item.expected.altClassification).toBe('decorative');
    const record = scoreAnalyseVisual(goldAnalyseVisualResultFor(item), item);
    expect(record.suggestedAltAxis).toBe('ok');
  });

  it('downgradesAgainstAnalyseVisual names the fired axis, empty when candidate equals gold', () => {
    const items = loadSet();
    const item = findItem(items, 'img-informative-seed');
    const gold = goldAnalyseVisualResultFor(item);
    const goldRecord = scoreAnalyseVisual(gold, item);
    const sameRecord = scoreAnalyseVisual(gold, item);
    expect(downgradesAgainstAnalyseVisual(goldRecord, sameRecord)).toEqual([]);

    const candidateRecord = scoreAnalyseVisual(item.poison!.candidate as AnalyseVisualResult, item);
    const downgrades = downgradesAgainstAnalyseVisual(goldRecord, candidateRecord);
    expect(downgrades).toContain('verdictOutcome');
  });

  it('scoreAnalyseVisual is pure — same inputs, same output, no shared state across calls', () => {
    const items = loadSet();
    const item = items[0] as ImageAltItem;
    const gold = goldAnalyseVisualResultFor(item);
    expect(scoreAnalyseVisual(gold, item)).toEqual(scoreAnalyseVisual(gold, item));
  });
});

describe('aggregate.ts — pinned key sets, no fused counter (HARNESS-03)', () => {
  it('aggregateAnalyseVisual exposes exactly the pinned key set', () => {
    const items = loadSet();
    const records = items.map((item) => scoreAnalyseVisual(goldAnalyseVisualResultFor(item), item));
    const aggregate = aggregateAnalyseVisual(records);
    expect(Object.keys(aggregate).sort()).toEqual(EXPECTED_ANALYSE_VISUAL_AGGREGATE_KEYS);
  });

  it('aggregateAnalyseVisual keeps false-pass and false-issue as separate counters, never fused', () => {
    const items = loadSet();
    const seed = findItem(items, 'img-informative-seed');
    const printIcon = findItem(items, 'functional-print-icon');
    const records = [
      scoreAnalyseVisual(seed.poison!.candidate as AnalyseVisualResult, seed),
      scoreAnalyseVisual(printIcon.poison!.candidate as AnalyseVisualResult, printIcon),
    ];
    const aggregate = aggregateAnalyseVisual(records);
    expect(aggregate.falsePass).toBe(1);
    expect(aggregate.falseIssue).toBe(1);
    expect(aggregate.total).toBe(2);
  });

  it('aggregateGenerateFix exposes exactly the pinned key set', () => {
    // Minimal, self-contained records — this test exercises aggregate.ts
    // alone, not score-generate-fix.ts (owned by 84-01).
    const records = [
      {
        exactMatch: true,
        unchangedFromInput: false,
        emptyFix: false,
        missingMentions: [],
        effortMatch: true,
        filenameShapedAlt: false,
      },
    ];
    const aggregate = aggregateGenerateFix(records);
    expect(Object.keys(aggregate).sort()).toEqual(EXPECTED_GENERATE_FIX_AGGREGATE_KEYS);
    expect(aggregate.total).toBe(1);
    expect(aggregate.exactMatchCount).toBe(1);
  });
});
