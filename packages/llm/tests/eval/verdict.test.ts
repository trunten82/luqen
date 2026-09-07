/**
 * `verdict.test.ts` — Phase 85 Task 1: one verdict, end to end, over the
 * committed synthetic `generate-fix` report pair.
 *
 * Every fixture consumed here is hand-written data, NOT model output — see
 * `tests/eval/fixtures/verdict/generate-fix-pair.synthetic.json`'s own
 * `_synthetic` envelope key.
 *
 * The compile-time refusal exercise (D-85-6 — a PASS carrying an
 * insufficient power assessment must not compile) and the exhaustiveness
 * guard break (verdict-comparability.ts) are NOT expressible as a vitest
 * assertion — they are compiler-level facts, exercised via scratch
 * (uncommitted) edits and `tsc --noEmit`, with every observed output
 * recorded verbatim in 85-02-SUMMARY.md, per A-6.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadDecisionBars } from '../../src/eval/decision-bars.js';
import { compareGenerateFix, serialiseVerdict } from '../../src/eval/verdict.js';
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
  readonly _synthetic: true;
  readonly syntheticNote: string;
  readonly capability: 'generate-fix';
  readonly baseline: GenerateFixReport;
  readonly candidates: {
    readonly identical: GenerateFixReport;
    readonly regressedBeyondMargin: GenerateFixReport;
    readonly discordanceExceedsAssumption: GenerateFixReport;
    readonly boundDoesNotClearMargin: GenerateFixReport;
  };
}

function loadFixtureRaw(): Record<string, unknown> {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8')) as Record<string, unknown>;
}

function loadFixture(): SyntheticEnvelope {
  return loadFixtureRaw() as unknown as SyntheticEnvelope;
}

describe('generate-fix verdict tracer — the committed synthetic fixture', () => {
  it('carries the synthetic envelope key and carries NO top-level runFunction (T-85-07)', () => {
    const raw = loadFixtureRaw();
    expect(raw['_synthetic']).toBe(true);
    expect(typeof raw['syntheticNote']).toBe('string');
    expect((raw['syntheticNote'] as string).length).toBeGreaterThan(0);
    // A bare HarnessReport carries `runFunction` at its TOP level (report.ts).
    // The envelope must not — its two reports sit nested under baseline/candidates.
    expect(raw['runFunction']).toBeUndefined();
  });

  it('has 17 items in the baseline report, matching the bar-registered n', () => {
    const fixture = loadFixture();
    expect(fixture.baseline.items).toHaveLength(17);
    expect(fixture.baseline.runFunction.itemCount).toBe(17);
    expect(fixture.baseline.runFunction.setName).toBe('wcag-fixes');
    expect(fixture.baseline.runFunction.setVersion).toBe('v1');
  });
});

describe('generate-fix verdict tracer — end to end (Task 1)', () => {
  it('PASS: candidate matches baseline on every item -> zero discordant pairs, zero-event bound, sufficient power', () => {
    const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const fixture = loadFixture();
    const verdict = compareGenerateFix(bar, fixture.baseline, fixture.candidates.identical, { state: 'not-yet-measured' });

    expect(verdict.outcome).toBe('PASS');
    expect(verdict.gatingAxis.counterName).toBe('exactMatchCount');
    expect(verdict.gatingAxis.baselineBetterCount).toBe(0);
    expect(verdict.gatingAxis.candidateBetterCount).toBe(0);
    expect(verdict.gatingAxis.discordantPairCount).toBe(0);
    expect(verdict.gatingAxis.observedItemDelta).toBe(0);
    expect(verdict.gatingAxis.marginItems).toBe(3);
    expect(verdict.gatingAxis.upperBound).toBeCloseTo(0.1616, 3);
    expect(verdict.gatingAxis.certifies).toBe(true);
    expect(verdict.power.sufficient).toBe(true);

    if (verdict.outcome === 'PASS') {
      // The narrowing this whole task exists to prove: inside this branch,
      // TypeScript itself knows verdict.power is SufficientPower, not the
      // full PowerAssessment union — no runtime check required to read it.
      expect(verdict.power.observedDiscordantPairRate).toBe(0);
      expect(verdict.power.runToRunInstability.state).toBe('not-yet-measured');
    }

    expect(verdict.licence).toBe(bar.licenceStrings.nonInferiorityClause.generateFix.pass.text);
    expect(verdict.licence).toContain('Zero items scored worse than baseline');
    expect(verdict.decisionBarsDigestSha256).toBe(bar.digestSha256);
    expect(verdict.decisionBarsVersion).toBe('v1');
  });

  it('FAIL: candidate loses more items on the gating axis than the margin allows -> FAIL, names the observed delta and margin', () => {
    const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const fixture = loadFixture();
    const verdict = compareGenerateFix(bar, fixture.baseline, fixture.candidates.regressedBeyondMargin, { state: 'not-yet-measured' });

    expect(verdict.outcome).toBe('FAIL');
    expect(verdict.gatingAxis.baselineBetterCount).toBe(4);
    expect(verdict.gatingAxis.candidateBetterCount).toBe(0);
    expect(verdict.gatingAxis.observedItemDelta).toBe(4);
    expect(verdict.gatingAxis.marginItems).toBe(3);
    // FAILS regardless of power — a power field is still attached (either shape permitted).
    expect(verdict.power).toBeDefined();
    expect(verdict.licence).toBe(bar.licenceStrings.nonInferiorityClause.generateFix.fail.text);
  });

  it('UNDERPOWERED (discordance exceeds assumption): names that reason, and no other', () => {
    const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const fixture = loadFixture();
    const verdict = compareGenerateFix(bar, fixture.baseline, fixture.candidates.discordanceExceedsAssumption, { state: 'not-yet-measured' });

    expect(verdict.outcome).toBe('UNDERPOWERED');
    expect(verdict.gatingAxis.baselineBetterCount).toBe(0);
    expect(verdict.gatingAxis.candidateBetterCount).toBe(5);
    expect(verdict.gatingAxis.discordantPairCount).toBe(5);
    expect(verdict.gatingAxis.observedItemDelta).toBe(-5);
    // b=0 still CERTIFIES the bound -- this UNDERPOWERED is purely about discordance.
    expect(verdict.gatingAxis.certifies).toBe(true);

    expect(verdict.power.sufficient).toBe(false);
    if (!verdict.power.sufficient) {
      const kinds = verdict.power.reasons.map((r) => r.kind);
      expect(kinds).toEqual(['discordance-exceeds-assumption']);
      const reason = verdict.power.reasons[0];
      expect(reason.kind).toBe('discordance-exceeds-assumption');
      if (reason.kind === 'discordance-exceeds-assumption') {
        expect(reason.assumedDiscordantPairRate).toBe(0.25);
        expect(reason.observedDiscordantPairRate).toBeCloseTo(5 / 17, 6);
      }
    }
    expect(verdict.licence).toBe(bar.licenceStrings.nonInferiorityClause.generateFix.underpowered.text);
  });

  it('UNDERPOWERED (bound does not clear margin): names that second, distinct reason, and equal flips report NONZERO discordance, not zero', () => {
    const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const fixture = loadFixture();
    const verdict = compareGenerateFix(bar, fixture.baseline, fixture.candidates.boundDoesNotClearMargin, { state: 'not-yet-measured' });

    expect(verdict.outcome).toBe('UNDERPOWERED');
    // Equal flips: 2 items the candidate fixed, 2 the candidate broke.
    expect(verdict.gatingAxis.baselineBetterCount).toBe(2);
    expect(verdict.gatingAxis.candidateBetterCount).toBe(2);
    // Net (aggregate-style) delta is ZERO, but per-item pairing shows the
    // discordance is NOT zero -- this is the assertion the plan requires:
    // an aggregate delta of zero must never be read as zero discordance.
    expect(verdict.gatingAxis.observedItemDelta).toBe(0);
    expect(verdict.gatingAxis.discordantPairCount).toBe(4);
    expect(verdict.gatingAxis.discordantPairCount).not.toBe(0);
    expect(verdict.gatingAxis.certifies).toBe(false);

    expect(verdict.power.sufficient).toBe(false);
    if (!verdict.power.sufficient) {
      const kinds = verdict.power.reasons.map((r) => r.kind);
      expect(kinds).toEqual(['bound-does-not-clear-margin']);
      // Discordance (4/17 ≈ 0.235) is WITHIN the 0.25 assumption -- the
      // discordance-exceeds-assumption reason must NOT also fire here.
      expect(kinds).not.toContain('discordance-exceeds-assumption');
      const reason = verdict.power.reasons[0];
      if (reason.kind === 'bound-does-not-clear-margin') {
        expect(reason.upperBound).toBeCloseTo(0.3262, 3);
        expect(reason.marginProportion).toBeCloseTo(3 / 17, 6);
      }
    }
  });

  it('every verdict carries the five non-gating axis deltas as context, and the treatment fields that actually differed', () => {
    const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const fixture = loadFixture();
    const verdict = compareGenerateFix(bar, fixture.baseline, fixture.candidates.identical, { state: 'not-yet-measured' });

    expect(verdict.nonGatingAxisDeltas).toHaveLength(5);
    const counterNames = verdict.nonGatingAxisDeltas.map((d) => d.counterName).sort();
    expect(counterNames).toEqual(
      [
        'effortMatchCount',
        'emptyFixCount',
        'filenameShapedAltCount',
        'missingMentionsCount',
        'unchangedFromInputCount',
      ].sort(),
    );
    // The gating axis's own counter must never appear among the non-gating list.
    expect(counterNames).not.toContain('exactMatchCount');

    // Baseline and candidate use the SAME modelId/displayName/endpointFingerprint
    // scheme except deliberately-different model identity -- provider type is
    // identical (both 'ollama'), model identity fields differ.
    expect(verdict.treatmentFieldsDiffered.modelId).toBe(true);
    expect(verdict.treatmentFieldsDiffered.modelDisplayName).toBe(true);
    expect(verdict.treatmentFieldsDiffered.endpointFingerprint).toBe(true);
    expect(verdict.treatmentFieldsDiffered.providerType).toBe(false);
  });

  it('the serialised verdict round-trips to JSON and back with no field lost', () => {
    const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const fixture = loadFixture();
    const verdict = compareGenerateFix(bar, fixture.baseline, fixture.candidates.regressedBeyondMargin, { state: 'not-yet-measured' });

    const json = serialiseVerdict(verdict);
    const roundTripped = JSON.parse(json);
    expect(roundTripped).toEqual(JSON.parse(JSON.stringify(verdict)));
    expect(Object.keys(roundTripped).sort()).toEqual(Object.keys(verdict).sort());
  });

  // Phase 86 Task 2 (BASELINE-02, D-85-5): the instability now arrives from
  // OUTSIDE the comparator as a required parameter. This proves a supplied
  // `{ state: 'measured', value }` reaches `power.runToRunInstability`
  // unchanged -- the comparator neither overwrites it nor drops it.
  it('a supplied measured runToRunInstability reaches power.runToRunInstability unchanged', () => {
    const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const fixture = loadFixture();
    const verdict = compareGenerateFix(bar, fixture.baseline, fixture.candidates.identical, {
      state: 'measured',
      value: 0.1234,
    });

    expect(verdict.outcome).toBe('PASS');
    if (verdict.outcome === 'PASS') {
      expect(verdict.power.runToRunInstability).toEqual({ state: 'measured', value: 0.1234 });
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 86 Task 1 (BASELINE-02/SC4/SC5, D-85-5): the third insufficiency
// reason -- measured instability above the pre-registered ceiling. Both
// below-ceiling and not-yet-measured must add nothing (byte-identical to
// every pre-existing verdict test above); only above-ceiling adds the
// third reason, under its own distinctly-named fields.
// ---------------------------------------------------------------------------
describe('generate-fix verdict — the third insufficiency reason (Phase 86 Task 1)', () => {
  it('not-yet-measured adds nothing: PASS stays PASS, only the two pre-existing reasons are possible', () => {
    const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const fixture = loadFixture();
    const verdict = compareGenerateFix(bar, fixture.baseline, fixture.candidates.identical, {
      state: 'not-yet-measured',
    });

    expect(verdict.outcome).toBe('PASS');
    expect(verdict.power.sufficient).toBe(true);
  });

  it('measured AT the ceiling (0.25) does not exceed it -- exclusive boundary, matching discordance-exceeds-assumption', () => {
    const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const fixture = loadFixture();
    const verdict = compareGenerateFix(bar, fixture.baseline, fixture.candidates.identical, {
      state: 'measured',
      value: 0.25,
    });

    expect(verdict.outcome).toBe('PASS');
    expect(verdict.power.sufficient).toBe(true);
  });

  it('measured BELOW the ceiling adds nothing: still PASS, still sufficient', () => {
    const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const fixture = loadFixture();
    const verdict = compareGenerateFix(bar, fixture.baseline, fixture.candidates.identical, {
      state: 'measured',
      value: 0.1,
    });

    expect(verdict.outcome).toBe('PASS');
    expect(verdict.power.sufficient).toBe(true);
  });

  it('measured STRICTLY ABOVE the ceiling flips an otherwise-PASS pair to UNDERPOWERED, naming the third reason with its own distinct field names', () => {
    const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const fixture = loadFixture();
    const verdict = compareGenerateFix(bar, fixture.baseline, fixture.candidates.identical, {
      state: 'measured',
      value: 0.9,
    });

    expect(verdict.outcome).toBe('UNDERPOWERED');
    expect(verdict.power.sufficient).toBe(false);
    if (!verdict.power.sufficient) {
      const kinds = verdict.power.reasons.map((r) => r.kind);
      expect(kinds).toEqual(['run-to-run-instability-exceeds-ceiling']);
      const reason = verdict.power.reasons[0];
      expect(reason.kind).toBe('run-to-run-instability-exceeds-ceiling');
      if (reason.kind === 'run-to-run-instability-exceeds-ceiling') {
        // Distinct field names -- never observedDiscordantPairRate/assumedDiscordantPairRate.
        expect(reason.observedRunToRunInstability).toBe(0.9);
        expect(reason.assumedCeiling).toBe(0.25);
      }
    }
  });
});
