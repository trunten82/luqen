/**
 * HARNESS-05 — the committed break-test.
 *
 * Loads BOTH committed reference sets through the real Phase 83 loaders,
 * selects every item carrying a poison flag, and for each one scores two
 * things through the same real scorer: the item's own gold answer
 * (synthesised from its stored expected fields) and the item's poison
 * candidate. No provider credentials, no network, no db — `poison.candidate`
 * is shaped exactly like the capability's own result type, so it feeds
 * straight into the pure scorer.
 *
 * This is the evidence HARNESS-05 asks a maintainer to be able to point at.
 * A summary that merely asserts the test passes does not satisfy it — the
 * observed failure output from deliberately breaking each guard is recorded
 * verbatim in the plan's SUMMARY.md, not just asserted here.
 */
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { loadWcagFixSet, loadImageAltSet } from '../../src/eval/load-reference-set.js';
import {
  scoreGenerateFix,
  goldResultFor,
  downgradesAgainst,
} from '../../src/eval/score-generate-fix.js';
import {
  scoreAnalyseVisual,
  goldAnalyseVisualResultFor,
  downgradesAgainstAnalyseVisual,
} from '../../src/eval/score-analyse-visual.js';
import { parseAnalyseVisualResponse } from '../../src/capabilities/analyse-visual.js';
import type { GenerateFixResult } from '../../src/capabilities/generate-fix.js';
import type { AnalyseVisualResult } from '../../src/capabilities/analyse-visual.js';
import type { WcagFixItem, ImageAltItem } from '../../src/eval/types.js';

const WCAG_SET_PATH = join(process.cwd(), 'tests', 'eval', 'sets', 'wcag-fixes.v1.json');
const IMAGE_SET_PATH = join(process.cwd(), 'tests', 'eval', 'sets', 'image-alt.v1.json');

const wcagItems: readonly WcagFixItem[] = loadWcagFixSet(WCAG_SET_PATH, 'v1').items;
const imageItems: readonly ImageAltItem[] = loadImageAltSet(IMAGE_SET_PATH, 'v1').items;

const wcagPoisonItems = wcagItems.filter((i) => i.poison !== undefined);
const imagePoisonItems = imageItems.filter((i) => i.poison !== undefined);

function findWcagItem(id: string): WcagFixItem {
  const item = wcagItems.find((i) => i.id === id);
  if (item === undefined) throw new Error(`wcag fixture item "${id}" not found`);
  return item;
}

function findImageItem(id: string): ImageAltItem {
  const item = imageItems.find((i) => i.id === id);
  if (item === undefined) throw new Error(`image fixture item "${id}" not found`);
  return item;
}

describe('HARNESS-05 break-test — poison item counts', () => {
  // A set edit that silently dropped a poison item would leave a loop-based
  // break-test green over an empty selection. Assert the count explicitly
  // and fail below it, rather than merely iterating over whatever is found.
  it('wcag-fixes.v1.json carries exactly 3 poison items', () => {
    expect(wcagPoisonItems.length).toBe(3);
  });

  it('image-alt.v1.json carries exactly 4 poison items', () => {
    expect(imagePoisonItems.length).toBe(4);
  });
});

describe('HARNESS-05 break-test — clean-gold positive control', () => {
  // A break-test that only ever shows poison scoring down cannot distinguish
  // a working scorer from a scorer that condemns everything. Every gold
  // answer, poison item or not, must score clean.
  it('every wcag-fixes gold answer scores clean on every axis', () => {
    for (const item of wcagItems) {
      const record = scoreGenerateFix(goldResultFor(item), item);
      expect(record.exactMatch, `${item.id}: exactMatch`).toBe(true);
      expect(record.unchangedFromInput, `${item.id}: unchangedFromInput`).toBe(false);
      expect(record.emptyFix, `${item.id}: emptyFix`).toBe(false);
      expect(record.missingMentions, `${item.id}: missingMentions`).toEqual([]);
      expect(record.effortMatch, `${item.id}: effortMatch`).toBe(true);
      expect(record.filenameShapedAlt, `${item.id}: filenameShapedAlt`).toBe(false);
    }
  });

  it('every image-alt gold answer scores clean on every axis', () => {
    for (const item of imageItems) {
      const record = scoreAnalyseVisual(goldAnalyseVisualResultFor(item), item);
      expect(record.verdictOutcome, `${item.id}: verdictOutcome`).toBe('correct');
      expect(record.altClassificationMismatch, `${item.id}: altClassificationMismatch`).toBe(false);
      expect(record.suggestedAltAxis, `${item.id}: suggestedAltAxis`).toBe('ok');
    }
  });
});

describe('HARNESS-05 break-test — wcag-fixes poison items score down (3 of 7)', () => {
  it('wcag-css-background-image-info downgrades on filenameShapedAlt', () => {
    const item = findWcagItem('wcag-css-background-image-info');
    const goldRecord = scoreGenerateFix(goldResultFor(item), item);
    const candidateRecord = scoreGenerateFix(item.poison!.candidate as GenerateFixResult, item);
    const downgrades = downgradesAgainst(goldRecord, candidateRecord);
    expect(downgrades).toContain('filenameShapedAlt');
  });

  it('wcag-table-headers-not-marked-up downgrades on unchangedFromInput', () => {
    const item = findWcagItem('wcag-table-headers-not-marked-up');
    const goldRecord = scoreGenerateFix(goldResultFor(item), item);
    const candidateRecord = scoreGenerateFix(item.poison!.candidate as GenerateFixResult, item);
    const downgrades = downgradesAgainst(goldRecord, candidateRecord);
    expect(downgrades).toContain('unchangedFromInput');
  });

  it('wcag-form-control-no-label downgrades on emptyFix', () => {
    const item = findWcagItem('wcag-form-control-no-label');
    const goldRecord = scoreGenerateFix(goldResultFor(item), item);
    const candidateRecord = scoreGenerateFix(item.poison!.candidate as GenerateFixResult, item);
    const downgrades = downgradesAgainst(goldRecord, candidateRecord);
    expect(downgrades).toContain('emptyFix');
  });
});

describe('HARNESS-05 break-test — image-alt poison items score down (4 of 7)', () => {
  // The two ground-truth error directions, covered BY NAME (not merely by
  // count) — these are the two poison items whose sole purpose is letting
  // the false-PASS and false-ISSUE counters be told apart.
  it('img-informative-seed produces the false-pass outcome', () => {
    const item = findImageItem('img-informative-seed');
    const candidateRecord = scoreAnalyseVisual(item.poison!.candidate as AnalyseVisualResult, item);
    expect(candidateRecord.verdictOutcome).toBe('false-pass');
  });

  it('functional-print-icon produces the false-issue outcome', () => {
    const item = findImageItem('functional-print-icon');
    const candidateRecord = scoreAnalyseVisual(item.poison!.candidate as AnalyseVisualResult, item);
    expect(candidateRecord.verdictOutcome).toBe('false-issue');
  });

  // The two suggested-alt poison items — both carry an entirely CORRECT
  // verdict; only the suggestedAlt axis catches them.
  it('complex-energy-consumption produces the filename-shaped suggestedAlt axis', () => {
    const item = findImageItem('complex-energy-consumption');
    const candidateRecord = scoreAnalyseVisual(item.poison!.candidate as AnalyseVisualResult, item);
    expect(candidateRecord.suggestedAltAxis).toBe('filename-shaped');
    expect(candidateRecord.verdictOutcome).toBe('correct');
  });

  it('complex-thyroid-incidence produces the empty-despite-informational suggestedAlt axis', () => {
    const item = findImageItem('complex-thyroid-incidence');
    const candidateRecord = scoreAnalyseVisual(item.poison!.candidate as AnalyseVisualResult, item);
    expect(candidateRecord.suggestedAltAxis).toBe('empty-despite-informational');
    expect(candidateRecord.verdictOutcome).toBe('correct');
  });

  it('every image-alt poison candidate downgrades against its own gold, axes reported by name', () => {
    for (const item of imagePoisonItems) {
      const goldRecord = scoreAnalyseVisual(goldAnalyseVisualResultFor(item), item);
      const candidateRecord = scoreAnalyseVisual(item.poison!.candidate as AnalyseVisualResult, item);
      const downgrades = downgradesAgainstAnalyseVisual(goldRecord, candidateRecord);
      expect(downgrades.length, `${item.id} should downgrade on a named axis`).toBeGreaterThan(0);
    }
  });
});

describe('HARNESS-05 break-test — the parser-manufactured false-PASS travels the same code path', () => {
  // analyse-visual.ts:51-53: a response that parses cleanly but carries no
  // verdict and no findings becomes 'pass'. This is a characterisation of
  // CURRENT shipped behaviour, recorded so a future reader can see it was
  // known and deliberate — NOT a bug report to act on in this phase, and
  // this test must never be turned into a fix.
  it('a parseable response with no verdict and no findings is parsed as pass (characterisation, not a fix)', () => {
    const rawResponse = '{}';
    const parsed = parseAnalyseVisualResponse(rawResponse, 'alt-text');
    expect(parsed.verdict).toBe('pass');
    expect(parsed.findings).toEqual([]);
  });

  it('that manufactured pass is counted in the false-pass bucket by the SAME scorer as the deliberate poison item', () => {
    const rawResponse = '{}';
    const parsed = parseAnalyseVisualResponse(rawResponse, 'alt-text');

    // An item whose stored expected verdict is 'issue' -- any such item
    // demonstrates the point; 'informative-telephone-icon' is used here
    // (distinct from the img-informative-seed poison-item test above) so
    // the parser characterisation and the deliberate poison item remain
    // separately traceable failures even though they share one code path.
    const item = findImageItem('informative-telephone-icon');
    expect(item.expectedVerdict).toBe('issue');

    const record = scoreAnalyseVisual(parsed, item);
    expect(record.verdictOutcome).toBe('false-pass');
  });
});
