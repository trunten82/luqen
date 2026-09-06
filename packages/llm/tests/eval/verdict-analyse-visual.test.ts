/**
 * `verdict-analyse-visual.test.ts` — Phase 85 Task 1: the `analyse-visual`
 * verdict, both mechanisms, end to end, over the committed synthetic report
 * pair.
 *
 * Every fixture consumed here is hand-written data, NOT model output — see
 * `tests/eval/fixtures/verdict/analyse-visual-pair.synthetic.json`'s own
 * `_synthetic` envelope key. The baseline is shared by all five candidates,
 * mirroring 85-02's `generate-fix-pair.synthetic.json` convention.
 *
 * `falsePassGateFails` is the fixture's central scenario: baseline and
 * candidate agree on every `correct`-relevant item (clause is a clean PASS,
 * b=0), but the candidate turns one baseline `uncertain` item into a
 * `false-pass` — invisible to the correctness clause (an `uncertain` item
 * was already "not correct" in the pairing) but caught by the gate, because
 * `falsePass` is a count read straight off the aggregate, independent of the
 * clause's pairing. It proves must_haves.truths #1 literally: "a candidate
 * that is non-inferior on average while clearing one more real violation
 * FAILS".
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadDecisionBars } from '../../src/eval/decision-bars.js';
import { compareAnalyseVisual, serialiseAnalyseVisualVerdict } from '../../src/eval/verdict-analyse-visual.js';
import type { AnalyseVisualReport } from '../../src/eval/report.js';

const PACKAGE_ROOT = process.cwd();
const FIXTURE_PATH = join(
  PACKAGE_ROOT,
  'tests',
  'eval',
  'fixtures',
  'verdict',
  'analyse-visual-pair.synthetic.json',
);

interface SyntheticEnvelope {
  readonly _synthetic: true;
  readonly syntheticNote: string;
  readonly capability: 'analyse-visual';
  readonly baseline: AnalyseVisualReport;
  readonly candidates: {
    readonly identical: AnalyseVisualReport;
    readonly regressedBeyondMargin: AnalyseVisualReport;
    readonly discordanceExceedsAssumption: AnalyseVisualReport;
    readonly boundDoesNotClearMargin: AnalyseVisualReport;
    readonly falsePassGateFails: AnalyseVisualReport;
  };
}

function loadFixtureRaw(): Record<string, unknown> {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8')) as Record<string, unknown>;
}

function loadFixture(): SyntheticEnvelope {
  return loadFixtureRaw() as unknown as SyntheticEnvelope;
}

describe('analyse-visual verdict — the committed synthetic fixture', () => {
  it('carries the synthetic envelope key and carries NO top-level runFunction', () => {
    const raw = loadFixtureRaw();
    expect(raw['_synthetic']).toBe(true);
    expect(typeof raw['syntheticNote']).toBe('string');
    expect((raw['syntheticNote'] as string).length).toBeGreaterThan(0);
    // A bare HarnessReport carries `runFunction` at its TOP level (report.ts).
    // The envelope must not -- its two reports sit nested under baseline/candidates.
    expect(raw['runFunction']).toBeUndefined();
  });

  it('has 13 items in the baseline report, matching the bar-registered n', () => {
    const fixture = loadFixture();
    expect(fixture.baseline.items).toHaveLength(13);
    expect(fixture.baseline.runFunction.itemCount).toBe(13);
    expect(fixture.baseline.runFunction.setName).toBe('image-alt');
    expect(fixture.baseline.runFunction.setVersion).toBe('v1');
    expect(fixture.baseline.aggregate.correct).toBe(9);
    expect(fixture.baseline.aggregate.falsePass).toBe(0);
  });
});

describe('analyse-visual verdict — end to end (Task 1)', () => {
  it('PASS: candidate matches baseline on every item -> both clauses clear, overall PASS', () => {
    const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const fixture = loadFixture();
    const verdict = compareAnalyseVisual(bar, fixture.baseline, fixture.candidates.identical);

    expect(verdict.nonInferiorityClause.outcome).toBe('PASS');
    expect(verdict.nonInferiorityClause.gatingAxis.counterName).toBe('correct');
    expect(verdict.nonInferiorityClause.gatingAxis.baselineBetterCount).toBe(0);
    expect(verdict.nonInferiorityClause.gatingAxis.candidateBetterCount).toBe(0);
    expect(verdict.nonInferiorityClause.gatingAxis.marginItems).toBe(3);
    expect(verdict.nonInferiorityClause.gatingAxis.upperBound).toBeCloseTo(0.2058, 3);
    expect(verdict.nonInferiorityClause.gatingAxis.certifies).toBe(true);
    expect(verdict.nonInferiorityClause.power.sufficient).toBe(true);
    expect(verdict.nonInferiorityClause.licence).toBe(
      bar.licenceStrings.nonInferiorityClause.analyseVisualCorrect.pass.text,
    );

    expect(verdict.falsePassGate.outcome).toBe('PASS');
    expect(verdict.falsePassGate.baselineFalsePassCount).toBe(0);
    expect(verdict.falsePassGate.candidateFalsePassCount).toBe(0);
    expect(verdict.falsePassGate.opportunityDenominator).toBe(7);
    // The verbatim D-85-4 sentence must be present, untouched, in the PASS licence.
    expect(verdict.falsePassGate.licence).toContain(
      'no observed increase across 7 opportunities; by rule of three this bounds the true false-PASS rate only below ~43%. It is a screen against visible regression, NOT evidence of parity.',
    );
    // Plus the run-to-run-instability caveat the bar file requires alongside it.
    expect(verdict.falsePassGate.licence).toContain('Run-to-run instability was not measured');

    expect(verdict.overallVerdict.outcome).toBe('PASS');
    expect(verdict.overallVerdict.licence).toBe(bar.licenceStrings.overallVerdict.pass.text);
    expect(verdict.overallVerdict.derivedNote).toBe(bar.licenceStrings.overallVerdict.note);
    expect(verdict.decisionBarsDigestSha256).toBe(bar.digestSha256);
    expect(verdict.decisionBarsVersion).toBe('v1');
  });

  it('FAIL (clause): candidate loses more items on `correct` than the margin allows -> overall FAIL', () => {
    const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const fixture = loadFixture();
    const verdict = compareAnalyseVisual(bar, fixture.baseline, fixture.candidates.regressedBeyondMargin);

    expect(verdict.nonInferiorityClause.outcome).toBe('FAIL');
    expect(verdict.nonInferiorityClause.gatingAxis.baselineBetterCount).toBe(4);
    expect(verdict.nonInferiorityClause.gatingAxis.candidateBetterCount).toBe(0);
    expect(verdict.nonInferiorityClause.gatingAxis.observedItemDelta).toBe(4);
    expect(verdict.nonInferiorityClause.gatingAxis.marginItems).toBe(3);
    expect(verdict.nonInferiorityClause.licence).toBe(
      bar.licenceStrings.nonInferiorityClause.analyseVisualCorrect.fail.text,
    );

    expect(verdict.falsePassGate.outcome).toBe('PASS');
    expect(verdict.falsePassGate.baselineFalsePassCount).toBe(0);
    expect(verdict.falsePassGate.candidateFalsePassCount).toBe(0);

    expect(verdict.overallVerdict.outcome).toBe('FAIL');
    expect(verdict.overallVerdict.licence).toBe(bar.licenceStrings.overallVerdict.fail.text);
  });

  it('UNDERPOWERED (discordance exceeds assumption): names that reason, and no other', () => {
    const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const fixture = loadFixture();
    const verdict = compareAnalyseVisual(bar, fixture.baseline, fixture.candidates.discordanceExceedsAssumption);

    expect(verdict.nonInferiorityClause.outcome).toBe('UNDERPOWERED');
    expect(verdict.nonInferiorityClause.gatingAxis.baselineBetterCount).toBe(0);
    expect(verdict.nonInferiorityClause.gatingAxis.candidateBetterCount).toBe(4);
    expect(verdict.nonInferiorityClause.gatingAxis.discordantPairCount).toBe(4);
    expect(verdict.nonInferiorityClause.gatingAxis.observedItemDelta).toBe(-4);
    // b=0 still CERTIFIES the bound -- this UNDERPOWERED is purely about discordance.
    expect(verdict.nonInferiorityClause.gatingAxis.certifies).toBe(true);

    expect(verdict.nonInferiorityClause.power.sufficient).toBe(false);
    if (!verdict.nonInferiorityClause.power.sufficient) {
      const kinds = verdict.nonInferiorityClause.power.reasons.map((r) => r.kind);
      expect(kinds).toEqual(['discordance-exceeds-assumption']);
      const reason = verdict.nonInferiorityClause.power.reasons[0];
      if (reason.kind === 'discordance-exceeds-assumption') {
        expect(reason.assumedDiscordantPairRate).toBe(0.25);
        expect(reason.observedDiscordantPairRate).toBeCloseTo(4 / 13, 6);
      }
    }
    expect(verdict.nonInferiorityClause.licence).toBe(
      bar.licenceStrings.nonInferiorityClause.analyseVisualCorrect.underpowered.text,
    );

    expect(verdict.falsePassGate.outcome).toBe('PASS');
    expect(verdict.overallVerdict.outcome).toBe('UNDERPOWERED');
    expect(verdict.overallVerdict.licence).toBe(bar.licenceStrings.overallVerdict.underpowered.text);
  });

  it('UNDERPOWERED (bound does not clear margin): names that second, distinct reason, and no other', () => {
    const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const fixture = loadFixture();
    const verdict = compareAnalyseVisual(bar, fixture.baseline, fixture.candidates.boundDoesNotClearMargin);

    expect(verdict.nonInferiorityClause.outcome).toBe('UNDERPOWERED');
    expect(verdict.nonInferiorityClause.gatingAxis.baselineBetterCount).toBe(2);
    expect(verdict.nonInferiorityClause.gatingAxis.candidateBetterCount).toBe(0);
    expect(verdict.nonInferiorityClause.gatingAxis.observedItemDelta).toBe(2);
    expect(verdict.nonInferiorityClause.gatingAxis.discordantPairCount).toBe(2);
    // Discordance (2/13 ≈ 0.154) is WITHIN the 0.25 assumption -- must not
    // also trigger discordance-exceeds-assumption.
    expect(verdict.nonInferiorityClause.gatingAxis.certifies).toBe(false);

    expect(verdict.nonInferiorityClause.power.sufficient).toBe(false);
    if (!verdict.nonInferiorityClause.power.sufficient) {
      const kinds = verdict.nonInferiorityClause.power.reasons.map((r) => r.kind);
      expect(kinds).toEqual(['bound-does-not-clear-margin']);
      expect(kinds).not.toContain('discordance-exceeds-assumption');
      const reason = verdict.nonInferiorityClause.power.reasons[0];
      if (reason.kind === 'bound-does-not-clear-margin') {
        expect(reason.upperBound).toBeCloseTo(0.4101, 3);
        expect(reason.marginProportion).toBeCloseTo(3 / 13, 6);
      }
    }

    expect(verdict.falsePassGate.outcome).toBe('PASS');
    expect(verdict.overallVerdict.outcome).toBe('UNDERPOWERED');
  });

  it('FAIL (gate): a candidate non-inferior (PASS) on the clause still FAILS overall when it clears one more real violation than baseline', () => {
    const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const fixture = loadFixture();
    const verdict = compareAnalyseVisual(bar, fixture.baseline, fixture.candidates.falsePassGateFails);

    // The clause is a CLEAN PASS -- the item that turned into a false-pass
    // was already `uncertain` (not correct) in the baseline, so the
    // correctness pairing sees no change on it.
    expect(verdict.nonInferiorityClause.outcome).toBe('PASS');
    expect(verdict.nonInferiorityClause.gatingAxis.baselineBetterCount).toBe(0);
    expect(verdict.nonInferiorityClause.gatingAxis.candidateBetterCount).toBe(0);

    // The gate independently catches it: candidate.falsePass (1) > baseline.falsePass (0).
    expect(verdict.falsePassGate.outcome).toBe('FAIL');
    expect(verdict.falsePassGate.baselineFalsePassCount).toBe(0);
    expect(verdict.falsePassGate.candidateFalsePassCount).toBe(1);
    expect(verdict.falsePassGate.licence).toBe(bar.licenceStrings.falsePassGate.fail.text);

    // The gate FAILing outranks a PASSing clause -- rank 2, "regardless of
    // everything else" -- this is the must_haves.truths scenario verbatim.
    expect(verdict.overallVerdict.outcome).toBe('FAIL');
    expect(verdict.overallVerdict.licence).toBe(bar.licenceStrings.overallVerdict.fail.text);
  });

  it('every verdict carries the five non-gating axis deltas as context, and never `correct` or `falsePass` among them', () => {
    const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const fixture = loadFixture();
    const verdict = compareAnalyseVisual(bar, fixture.baseline, fixture.candidates.identical);

    expect(verdict.nonGatingAxisDeltas).toHaveLength(5);
    const counterNames = verdict.nonGatingAxisDeltas.map((d) => d.counterName).sort();
    expect(counterNames).toEqual(
      [
        'altClassificationMismatchCount',
        'falseIssue',
        'suggestedAltEmptyDespiteInformationalCount',
        'suggestedAltFilenameShapedCount',
        'uncertain',
      ].sort(),
    );
    // The two GATING counters must never appear among the non-gating list.
    expect(counterNames).not.toContain('correct');
    expect(counterNames).not.toContain('falsePass');

    expect(verdict.treatmentFieldsDiffered.modelId).toBe(true);
    expect(verdict.treatmentFieldsDiffered.modelDisplayName).toBe(true);
    expect(verdict.treatmentFieldsDiffered.endpointFingerprint).toBe(true);
    expect(verdict.treatmentFieldsDiffered.providerType).toBe(false);
  });

  it('the serialised verdict round-trips to JSON with no field lost', () => {
    const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const fixture = loadFixture();
    const verdict = compareAnalyseVisual(bar, fixture.baseline, fixture.candidates.falsePassGateFails);

    const json = serialiseAnalyseVisualVerdict(verdict);
    const roundTripped = JSON.parse(json);
    expect(roundTripped).toEqual(JSON.parse(JSON.stringify(verdict)));
    expect(Object.keys(roundTripped).sort()).toEqual(Object.keys(verdict).sort());
  });
});

describe('analyse-visual verdict — no committed file parses as a bare harness report', () => {
  it('the synthetic envelope has no top-level runFunction/aggregate (T-85-07 equivalent)', () => {
    const raw = loadFixtureRaw();
    expect(raw['runFunction']).toBeUndefined();
    expect(raw['aggregate']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// D-85-1 / T-85-11: the verdict's exact key set, and each clause object's
// exact key set, pinned by POSITIVE equality against a literal array -- so a
// later convenience field (fusing false-PASS with false-ISSUE, or fusing the
// two clause results into one number) fails the moment it is added.
// ---------------------------------------------------------------------------
describe('analyse-visual verdict — exact key sets pinned (D-85-1, T-85-11, T-85-12)', () => {
  it('the top-level verdict carries EXACTLY these keys, and no others', () => {
    const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const fixture = loadFixture();
    const verdict = compareAnalyseVisual(bar, fixture.baseline, fixture.candidates.identical);

    expect(Object.keys(verdict).sort()).toEqual(
      [
        'capability',
        'baselineRunFunction',
        'candidateRunFunction',
        'falsePassGate',
        'nonInferiorityClause',
        'nonGatingAxisDeltas',
        'treatmentFieldsDiffered',
        'decisionBarsVersion',
        'decisionBarsDigestSha256',
        'overallVerdict',
      ].sort(),
    );
  });

  it('falsePassGate carries EXACTLY these keys -- no field fusing it with falseIssue or with nonInferiorityClause', () => {
    const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const fixture = loadFixture();
    const verdict = compareAnalyseVisual(bar, fixture.baseline, fixture.candidates.identical);

    expect(Object.keys(verdict.falsePassGate).sort()).toEqual(
      ['outcome', 'counterName', 'baselineFalsePassCount', 'candidateFalsePassCount', 'opportunityDenominator', 'licence'].sort(),
    );
  });

  it('nonInferiorityClause carries EXACTLY these keys -- no field fusing it with falsePassGate', () => {
    const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const fixture = loadFixture();
    const verdict = compareAnalyseVisual(bar, fixture.baseline, fixture.candidates.identical);

    expect(Object.keys(verdict.nonInferiorityClause).sort()).toEqual(
      ['outcome', 'gatingAxis', 'power', 'licence'].sort(),
    );
  });

  it('overallVerdict (the DERIVED summary, A-5) carries EXACTLY these keys, and its own licence is never rendered without the note labelling it as derived', () => {
    const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const fixture = loadFixture();
    const verdict = compareAnalyseVisual(bar, fixture.baseline, fixture.candidates.identical);

    expect(Object.keys(verdict.overallVerdict).sort()).toEqual(['outcome', 'derivedNote', 'licence'].sort());
    expect(verdict.overallVerdict.derivedNote.length).toBeGreaterThan(0);
  });
});
