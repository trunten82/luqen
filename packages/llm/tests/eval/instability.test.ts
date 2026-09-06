/**
 * `instability.test.ts` — Phase 86 Task 1: run-to-run instability, end to
 * end, over the committed synthetic three-repeat fixture, for BOTH
 * capabilities through ONE implementation.
 *
 * Every fixture consumed here is hand-written data, NOT model output — see
 * `tests/eval/fixtures/verdict/instability-repeats.synthetic.json`'s own
 * `_synthetic` envelope key. The three repeats' gating booleans were chosen
 * by hand so the three pairwise disagreement rates (0.2, 0.6, 0.4) are all
 * different from one another and none is zero — a fixture whose maximum and
 * mean coincide could not distinguish a correct implementation from one
 * that silently returns the mean.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  computeRunToRunInstability,
  runToRunInstabilityForGenerateFix,
  runToRunInstabilityForAnalyseVisual,
  TooFewRepeatReportsError,
} from '../../src/eval/instability.js';
import { RunFunctionMismatchError } from '../../src/eval/run-manifest.js';
import { FailedItemInReportError, ItemIdSetMismatchError } from '../../src/eval/verdict-comparability.js';
import type { GenerateFixReport, AnalyseVisualReport } from '../../src/eval/report.js';
import type { GenerateFixScoreRecord } from '../../src/eval/score-generate-fix.js';

const PACKAGE_ROOT = process.cwd();
const FIXTURE_PATH = join(
  PACKAGE_ROOT,
  'tests',
  'eval',
  'fixtures',
  'verdict',
  'instability-repeats.synthetic.json',
);

interface SyntheticEnvelope {
  readonly _synthetic: true;
  readonly syntheticNote: string;
  readonly generateFix: { readonly repeats: readonly GenerateFixReport[] };
  readonly analyseVisual: { readonly repeats: readonly AnalyseVisualReport[] };
}

function loadFixtureRaw(): Record<string, unknown> {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8')) as Record<string, unknown>;
}

function loadFixture(): SyntheticEnvelope {
  return loadFixtureRaw() as unknown as SyntheticEnvelope;
}

describe('instability fixture — the committed synthetic envelope', () => {
  it('carries the synthetic envelope key, and no report carries a top-level runFunction outside the envelope', () => {
    const raw = loadFixtureRaw();
    expect(raw['_synthetic']).toBe(true);
    expect(typeof raw['syntheticNote']).toBe('string');
    expect((raw['syntheticNote'] as string).length).toBeGreaterThan(0);
    expect(raw['runFunction']).toBeUndefined();
  });

  it('has 3 repeats of 5 items each, for both capabilities', () => {
    const fixture = loadFixture();
    expect(fixture.generateFix.repeats).toHaveLength(3);
    expect(fixture.analyseVisual.repeats).toHaveLength(3);
    for (const repeat of fixture.generateFix.repeats) {
      expect(repeat.items).toHaveLength(5);
      expect(repeat.runFunction.itemCount).toBe(5);
    }
    for (const repeat of fixture.analyseVisual.repeats) {
      expect(repeat.items).toHaveLength(5);
      expect(repeat.runFunction.itemCount).toBe(5);
    }
  });
});

describe('computeRunToRunInstability — generate-fix, end to end (Task 1)', () => {
  it('returns a hand-checkable maximum/mean over the three pairwise rates (0.2, 0.6, 0.4)', () => {
    const fixture = loadFixture();
    const record = runToRunInstabilityForGenerateFix(fixture.generateFix.repeats);

    expect(record.repeatCount).toBe(3);
    expect(record.itemCount).toBe(5);
    expect(record.modelId).toBe('synthetic-instability-model');
    expect(record.setName).toBe('instability-repeats');
    expect(record.setVersion).toBe('v1');
    expect(record.repeatTimestamps).toEqual([
      '2026-09-06T00:00:00.000Z',
      '2026-09-06T00:05:00.000Z',
      '2026-09-06T00:10:00.000Z',
    ]);
    expect(record.gatingCountByRepeat).toEqual([5, 4, 2]);

    // Every pairwise rate, hand-computed: repeat0=[T,T,T,T,T], repeat1=[T,T,T,T,F],
    // repeat2=[T,T,F,F,F]. (0,1) differs on item5 -> 1/5. (0,2) differs on
    // items 3,4,5 -> 3/5. (1,2) differs on items 3,4 -> 2/5.
    expect(record.pairwiseRates).toHaveLength(3);
    const byPair = new Map(record.pairwiseRates.map((p) => [`${p.repeatIndexA}-${p.repeatIndexB}`, p]));
    expect(byPair.get('0-1')?.disagreementCount).toBe(1);
    expect(byPair.get('0-1')?.rate).toBeCloseTo(0.2, 10);
    expect(byPair.get('0-2')?.disagreementCount).toBe(3);
    expect(byPair.get('0-2')?.rate).toBeCloseTo(0.6, 10);
    expect(byPair.get('1-2')?.disagreementCount).toBe(2);
    expect(byPair.get('1-2')?.rate).toBeCloseTo(0.4, 10);

    // The gating value is the MAXIMUM (A-1, err toward alarm) -- not the mean.
    expect(record.maximum).toBeCloseTo(0.6, 10);
    expect(record.mean).toBeCloseTo(0.4, 10);
    expect(record.maximum).not.toBe(record.mean);

    expect(record.runToRunInstability).toEqual({ state: 'measured', value: record.maximum });
  });

  it('the identical implementation, called via the generic entry point with an explicit gating predicate, agrees exactly', () => {
    const fixture = loadFixture();
    const viaWrapper = runToRunInstabilityForGenerateFix(fixture.generateFix.repeats);
    const viaGeneric = computeRunToRunInstability<GenerateFixScoreRecord>(
      fixture.generateFix.repeats,
      (score) => score.exactMatch,
    );
    expect(viaGeneric).toEqual(viaWrapper);
  });
});

describe('computeRunToRunInstability — analyse-visual, the SAME arithmetic path (Task 1)', () => {
  it('returns the identical maximum/mean shape, gating on verdictOutcome === "correct"', () => {
    const fixture = loadFixture();
    const record = runToRunInstabilityForAnalyseVisual(fixture.analyseVisual.repeats);

    expect(record.repeatCount).toBe(3);
    expect(record.gatingCountByRepeat).toEqual([5, 4, 2]);
    expect(record.maximum).toBeCloseTo(0.6, 10);
    expect(record.mean).toBeCloseTo(0.4, 10);
    expect(record.runToRunInstability).toEqual({ state: 'measured', value: record.maximum });
  });
});

describe('computeRunToRunInstability — refusals', () => {
  it('refuses a single report: K must be at least 2 (TooFewRepeatReportsError)', () => {
    const fixture = loadFixture();
    const single = [fixture.generateFix.repeats[0]!];
    let caught: unknown;
    try {
      runToRunInstabilityForGenerateFix(single);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TooFewRepeatReportsError);
    expect((caught as TooFewRepeatReportsError).count).toBe(1);
  });

  it('refuses zero reports the same way', () => {
    expect(() => runToRunInstabilityForGenerateFix([])).toThrow(TooFewRepeatReportsError);
  });

  it('refuses two reports whose run functions differ on modelId, naming it — a variance across two different experiments is not a variance', () => {
    const fixture = loadFixture();
    const a = structuredClone(fixture.generateFix.repeats[0]!);
    const b = structuredClone(fixture.generateFix.repeats[1]!);
    (b.runFunction as { modelId: string }).modelId = 'a-different-model';

    let caught: unknown;
    try {
      runToRunInstabilityForGenerateFix([a, b]);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RunFunctionMismatchError);
    expect((caught as RunFunctionMismatchError).differingFields).toContain('modelId');
  });

  it('refuses a report containing a FailedItemRecord, naming the side', () => {
    const fixture = loadFixture();
    const a = structuredClone(fixture.generateFix.repeats[0]!);
    const b = structuredClone(fixture.generateFix.repeats[1]!);
    const mutableItems = b.items as Array<Record<string, unknown>>;
    mutableItems[0] = { itemId: mutableItems[0]!['itemId'], outcome: 'failed', failureReason: 'synthetic failure for test' };

    let caught: unknown;
    try {
      runToRunInstabilityForGenerateFix([a, b]);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FailedItemInReportError);
  });

  it('refuses two repeats whose item id sets differ, naming the difference', () => {
    const fixture = loadFixture();
    const a = structuredClone(fixture.generateFix.repeats[0]!);
    const b = structuredClone(fixture.generateFix.repeats[1]!);
    const mutableItems = b.items as Array<Record<string, unknown>>;
    mutableItems[0]!['itemId'] = 'gf-instab-not-in-a';

    let caught: unknown;
    try {
      runToRunInstabilityForGenerateFix([a, b]);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ItemIdSetMismatchError);
  });
});

describe('computeRunToRunInstability — zero-instability is DATA, not an absence', () => {
  it('three repeats that agree on every item report instability exactly 0, as a real number, not an omitted field', () => {
    const fixture = loadFixture();
    const base = fixture.generateFix.repeats[0]!;
    const repeatA = structuredClone(base);
    const repeatB = structuredClone(base);
    const repeatC = structuredClone(base);
    (repeatB.runFunction as { timestamp: string }).timestamp = '2026-09-06T01:00:00.000Z';
    (repeatC.runFunction as { timestamp: string }).timestamp = '2026-09-06T02:00:00.000Z';

    const record = runToRunInstabilityForGenerateFix([repeatA, repeatB, repeatC]);

    expect(record.maximum).toBe(0);
    expect(record.mean).toBe(0);
    expect(record.pairwiseRates).toHaveLength(3);
    for (const pair of record.pairwiseRates) {
      expect(pair.disagreementCount).toBe(0);
      expect(pair.rate).toBe(0);
    }
    expect(record.runToRunInstability).toEqual({ state: 'measured', value: 0 });
    // The field is present and typed as a real number, never undefined/omitted.
    expect(record.runToRunInstability.state).toBe('measured');
  });
});
