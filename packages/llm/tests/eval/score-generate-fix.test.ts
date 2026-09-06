/**
 * RED/GREEN for the completed `generate-fix` scorer (84-01 Task 3,
 * HARNESS-05). `scoreGenerateFix` must be pure, axis-labelled, and
 * blend-free; every committed WCAG poison candidate must score down
 * against its own item's gold answer on at least one named axis.
 */
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { loadWcagFixSet } from '../../src/eval/load-reference-set.js';
import {
  scoreGenerateFix,
  goldResultFor,
  downgradesAgainst,
  type GenerateFixScoreRecord,
} from '../../src/eval/score-generate-fix.js';
import type { GenerateFixResult } from '../../src/capabilities/generate-fix.js';
import type { WcagFixItem } from '../../src/eval/types.js';

const SET_PATH = join(process.cwd(), 'tests', 'eval', 'sets', 'wcag-fixes.v1.json');

const EXPECTED_KEYS = [
  'effortMatch',
  'emptyFix',
  'exactMatch',
  'filenameShapedAlt',
  'missingMentions',
  'unchangedFromInput',
].sort();

function loadSet(): readonly WcagFixItem[] {
  return loadWcagFixSet(SET_PATH, 'v1').items;
}

describe('scoreGenerateFix — completed axis set (HARNESS-05)', () => {
  it('the record exposes exactly the pinned key set — no blended number, no convenience aggregate', () => {
    const items = loadSet();
    const item = items[0] as WcagFixItem;
    const record = scoreGenerateFix(goldResultFor(item), item);
    expect(Object.keys(record).sort()).toEqual(EXPECTED_KEYS);
  });

  it('all 17 gold answers score clean on every axis', () => {
    const items = loadSet();
    expect(items.length).toBe(17);

    for (const item of items) {
      const gold = goldResultFor(item);
      const record: GenerateFixScoreRecord = scoreGenerateFix(gold, item);
      expect(record.exactMatch, `${item.id}: exactMatch`).toBe(true);
      expect(record.unchangedFromInput, `${item.id}: unchangedFromInput`).toBe(false);
      expect(record.emptyFix, `${item.id}: emptyFix`).toBe(false);
      expect(record.missingMentions, `${item.id}: missingMentions`).toEqual([]);
      expect(record.effortMatch, `${item.id}: effortMatch`).toBe(true);
      expect(record.filenameShapedAlt, `${item.id}: filenameShapedAlt`).toBe(false);
    }
  });

  it('poison item wcag-css-background-image-info downgrades on at least one named axis (filename-shaped alt + missing mentions)', () => {
    const items = loadSet();
    const item = items.find((i) => i.id === 'wcag-css-background-image-info') as WcagFixItem;
    expect(item).toBeDefined();
    expect(item.poison).toBeDefined();

    const goldRecord = scoreGenerateFix(goldResultFor(item), item);
    const candidateRecord = scoreGenerateFix(item.poison!.candidate as GenerateFixResult, item);
    const downgrades = downgradesAgainst(goldRecord, candidateRecord);

    expect(downgrades.length).toBeGreaterThan(0);
    expect(downgrades).toContain('filenameShapedAlt');
    expect(downgrades).toContain('missingMentions');
    // "TopRate.png" is the image filename, not a text alternative — the F30 pattern.
    expect(candidateRecord.filenameShapedAlt).toBe(true);
    // The candidate's explanation omits two of the three required mentions
    // ("background-image" and "1.1.1").
    expect(candidateRecord.missingMentions.length).toBe(2);
  });

  it('poison item wcag-table-headers-not-marked-up downgrades: candidate markup is byte-identical to the offending input', () => {
    const items = loadSet();
    const item = items.find((i) => i.id === 'wcag-table-headers-not-marked-up') as WcagFixItem;
    expect(item).toBeDefined();
    expect(item.poison).toBeDefined();

    const goldRecord = scoreGenerateFix(goldResultFor(item), item);
    const candidateRecord = scoreGenerateFix(item.poison!.candidate as GenerateFixResult, item);
    const downgrades = downgradesAgainst(goldRecord, candidateRecord);

    expect(downgrades).toContain('unchangedFromInput');
    expect(candidateRecord.unchangedFromInput).toBe(true);
  });

  it('poison item wcag-form-control-no-label downgrades: candidate fix is the empty string beside a confident explanation', () => {
    const items = loadSet();
    const item = items.find((i) => i.id === 'wcag-form-control-no-label') as WcagFixItem;
    expect(item).toBeDefined();
    expect(item.poison).toBeDefined();

    const goldRecord = scoreGenerateFix(goldResultFor(item), item);
    const candidateRecord = scoreGenerateFix(item.poison!.candidate as GenerateFixResult, item);
    const downgrades = downgradesAgainst(goldRecord, candidateRecord);

    expect(downgrades).toContain('emptyFix');
    expect(candidateRecord.emptyFix).toBe(true);
  });

  it('downgradesAgainst returns an empty list when a candidate equals its gold', () => {
    const items = loadSet();
    const item = items[0] as WcagFixItem;
    const goldRecord = scoreGenerateFix(goldResultFor(item), item);
    const sameRecord = scoreGenerateFix(goldResultFor(item), item);
    expect(downgradesAgainst(goldRecord, sameRecord)).toEqual([]);
  });

  it('scoreGenerateFix is pure — same inputs, same output, no shared state across calls', () => {
    const items = loadSet();
    const item = items[0] as WcagFixItem;
    const gold = goldResultFor(item);
    const first = scoreGenerateFix(gold, item);
    const second = scoreGenerateFix(gold, item);
    expect(first).toEqual(second);
  });
});
