/**
 * `verdict-refusals.test.ts` — Phase 85 Task 3: the paths a verdict can be
 * reached through that the Task 1 tracer did not travel.
 *
 * Every refusal is exercised against a MUTATED (structuredClone'd) COPY of
 * the committed synthetic fixture — never the committed fixture itself,
 * mirroring `decision-bars.test.ts`'s convention. The A-6 both-directions
 * exercises (fire → neuter → sail through → restore) are NOT expressible
 * as vitest assertions on their own — they are scratch (uncommitted) source
 * edits run alongside this suite, with every observed output recorded
 * verbatim in 85-02-SUMMARY.md.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadDecisionBars } from '../../src/eval/decision-bars.js';
import { BarSetNameMismatchError, BarSetVersionMismatchError, BarItemCountMismatchError } from '../../src/eval/decision-bars.js';
import { compareGenerateFix, serialiseVerdict, parseVerdict, VerdictPassPowerContradictionError } from '../../src/eval/verdict.js';
import {
  VerdictInvariantFieldMismatchError,
  FailedItemInReportError,
  ItemIdSetMismatchError,
  AggregateRecountMismatchError,
} from '../../src/eval/verdict-comparability.js';
import type { GenerateFixReport } from '../../src/eval/report.js';

const PACKAGE_ROOT = process.cwd();
const FIXTURE_PATH = join(
  PACKAGE_ROOT,
  'tests',
  'eval',
  'fixtures',
  'verdict',
  'generate-fix-pair.synthetic.json',
);

interface SyntheticEnvelope {
  readonly baseline: GenerateFixReport;
  readonly candidates: {
    readonly identical: GenerateFixReport;
    readonly regressedBeyondMargin: GenerateFixReport;
  };
}

function loadFixture(): SyntheticEnvelope {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8')) as unknown as SyntheticEnvelope;
}

/** A fresh, independently-mutable clone of the baseline/identical-candidate pair for each test. */
function freshPair(): { baseline: GenerateFixReport; candidate: GenerateFixReport } {
  const fixture = loadFixture();
  return {
    baseline: structuredClone(fixture.baseline),
    candidate: structuredClone(fixture.candidates.identical),
  };
}

describe('verdict refusals — invariant fields must hold constant', () => {
  it('refuses a comparison whose runs differ on a CONSTANT field (temperature), naming it', () => {
    const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const { baseline, candidate } = freshPair();
    // Mutate a CONSTANT field only -- temperature must be held fixed.
    (candidate.runFunction as { temperature: number }).temperature = 0.7;

    let caught: unknown;
    try {
      compareGenerateFix(bar, baseline, candidate);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(VerdictInvariantFieldMismatchError);
    expect((caught as VerdictInvariantFieldMismatchError).differingFields).toContain('temperature');
  });

  it('POSITIVE CONTROL: a comparison differing ONLY on treatment fields is accepted, not refused', () => {
    const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const { baseline, candidate } = freshPair();
    // candidate already differs from baseline only on modelId/modelDisplayName/endpointFingerprint
    // (the fixture's own design) -- confirm this does NOT throw.
    expect(() => compareGenerateFix(bar, baseline, candidate)).not.toThrow();
    const verdict = compareGenerateFix(bar, baseline, candidate);
    expect(verdict.treatmentFieldsDiffered.modelId).toBe(true);
  });
});

describe('verdict refusals — bar registration (delegates to decision-bars.ts, not re-derived)', () => {
  it('refuses a candidate report whose set name does not match the bar (BarSetNameMismatchError)', () => {
    const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const { baseline, candidate } = freshPair();
    (candidate.runFunction as { setName: string }).setName = 'some-other-set';
    expect(() => compareGenerateFix(bar, baseline, candidate)).toThrow(BarSetNameMismatchError);
  });

  it('refuses a candidate report whose set version does not match the bar (BarSetVersionMismatchError)', () => {
    const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const { baseline, candidate } = freshPair();
    (candidate.runFunction as { setVersion: string }).setVersion = 'v2';
    expect(() => compareGenerateFix(bar, baseline, candidate)).toThrow(BarSetVersionMismatchError);
  });

  it('refuses a candidate report whose item count does not match the bar (BarItemCountMismatchError)', () => {
    const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const { baseline, candidate } = freshPair();
    (candidate.runFunction as { itemCount: number }).itemCount = 16;
    expect(() => compareGenerateFix(bar, baseline, candidate)).toThrow(BarItemCountMismatchError);
  });
});

describe('verdict refusals — a failed item in either report', () => {
  it('refuses when the BASELINE report contains a failed item, naming it', () => {
    const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const { baseline, candidate } = freshPair();
    const mutableItems = baseline.items as Array<Record<string, unknown>>;
    mutableItems[0] = { itemId: mutableItems[0]!['itemId'], outcome: 'failed', failureReason: 'synthetic failure for test' };

    let caught: unknown;
    try {
      compareGenerateFix(bar, baseline, candidate);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FailedItemInReportError);
    expect((caught as FailedItemInReportError).side).toBe('baseline');
  });

  it('refuses when the CANDIDATE report contains a failed item, naming it', () => {
    const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const { baseline, candidate } = freshPair();
    const mutableItems = candidate.items as Array<Record<string, unknown>>;
    mutableItems[0] = { itemId: mutableItems[0]!['itemId'], outcome: 'failed', failureReason: 'synthetic failure for test' };

    let caught: unknown;
    try {
      compareGenerateFix(bar, baseline, candidate);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FailedItemInReportError);
    expect((caught as FailedItemInReportError).side).toBe('candidate');
  });
});

describe('verdict refusals — item id sets must be identical', () => {
  it('refuses when the two reports do not carry the identical set of item ids, naming the difference', () => {
    const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const { baseline, candidate } = freshPair();
    const mutableItems = candidate.items as Array<Record<string, unknown>>;
    mutableItems[0]!['itemId'] = 'gf-synth-not-in-baseline';

    let caught: unknown;
    try {
      compareGenerateFix(bar, baseline, candidate);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ItemIdSetMismatchError);
    const mismatch = caught as ItemIdSetMismatchError;
    expect(mismatch.onlyInBaseline).toContain('gf-synth-01');
    expect(mismatch.onlyInCandidate).toContain('gf-synth-not-in-baseline');
  });
});

describe('verdict refusals — a report aggregate must match a recount of its own items', () => {
  it('refuses when the BASELINE aggregate disagrees with a recount on the gating counter', () => {
    const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const { baseline, candidate } = freshPair();
    (baseline.aggregate as { exactMatchCount: number }).exactMatchCount = 999;

    let caught: unknown;
    try {
      compareGenerateFix(bar, baseline, candidate);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AggregateRecountMismatchError);
    const mismatch = caught as AggregateRecountMismatchError;
    expect(mismatch.side).toBe('baseline');
    expect(mismatch.aggregateValue).toBe(999);
    expect(mismatch.recountedValue).toBe(10);
  });
});

describe('verdict refusals — parseVerdict is the only supported path back from JSON', () => {
  it('refuses a hand-written document claiming PASS with an insufficient power assessment, naming the contradiction', () => {
    const badDocument = JSON.stringify({
      capability: 'generate-fix',
      outcome: 'PASS',
      power: {
        sufficient: false,
        reasons: [{ kind: 'discordance-exceeds-assumption', assumedDiscordantPairRate: 0.25, observedDiscordantPairRate: 0.5 }],
        assumedDiscordantPairRate: 0.25,
        observedDiscordantPairRate: 0.5,
        runToRunInstability: { state: 'not-yet-measured' },
      },
    });
    expect(() => parseVerdict(badDocument)).toThrow(VerdictPassPowerContradictionError);
  });

  it('a well-formed verdict round-trips through parseVerdict unchanged', () => {
    const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const fixture = loadFixture();
    const verdict = compareGenerateFix(bar, fixture.baseline, fixture.candidates.regressedBeyondMargin);
    const json = serialiseVerdict(verdict);
    const roundTripped = parseVerdict(json);
    expect(roundTripped).toEqual(JSON.parse(json));
    expect(roundTripped.outcome).toBe('FAIL');
  });

  it('a well-formed PASS document parses cleanly (no false positive from the contradiction guard)', () => {
    const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const fixture = loadFixture();
    const verdict = compareGenerateFix(bar, fixture.baseline, fixture.candidates.identical);
    expect(verdict.outcome).toBe('PASS');
    const json = serialiseVerdict(verdict);
    expect(() => parseVerdict(json)).not.toThrow();
  });
});
