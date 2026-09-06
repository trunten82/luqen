/**
 * `verdict-parse-round-trip.test.ts` — Phase 86 Task 3: the round-trip
 * re-check the second path never got.
 *
 * `generate-fix`'s `parseVerdict` has refused the PASS/insufficient-power
 * contradiction since 85-02. `analyse-visual` never had a parse counterpart
 * at all until this task's `parseAnalyseVisualVerdict`. Both capabilities'
 * cases live in ONE file, side by side, so the two paths are visibly held
 * to the same standard — including the `generate-fix` positive control,
 * which already passes and is run anyway (a positive control that is not
 * run is not a control).
 *
 * The break-it-both-directions exercise (A-6: neuter the contradiction
 * check, watch the SAME contradictory document parse cleanly, restore) is
 * NOT expressible as a vitest assertion — it is a scratch source edit run
 * alongside this suite, with every observed output recorded verbatim in
 * 86-01-SUMMARY.md.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadDecisionBars } from '../../src/eval/decision-bars.js';
import { compareGenerateFix, serialiseVerdict, parseVerdict, VerdictPassPowerContradictionError } from '../../src/eval/verdict.js';
import {
  compareAnalyseVisual,
  serialiseAnalyseVisualVerdict,
  parseAnalyseVisualVerdict,
} from '../../src/eval/verdict-analyse-visual.js';
import { InvalidVerdictJsonError } from '../../src/eval/verdict.js';
import type { GenerateFixReport, AnalyseVisualReport } from '../../src/eval/report.js';

const PACKAGE_ROOT = process.cwd();

const GENERATE_FIX_FIXTURE_PATH = join(
  PACKAGE_ROOT,
  'tests',
  'eval',
  'fixtures',
  'verdict',
  'generate-fix-pair.synthetic.json',
);
const ANALYSE_VISUAL_FIXTURE_PATH = join(
  PACKAGE_ROOT,
  'tests',
  'eval',
  'fixtures',
  'verdict',
  'analyse-visual-pair.synthetic.json',
);

interface GenerateFixEnvelope {
  readonly baseline: GenerateFixReport;
  readonly candidates: {
    readonly identical: GenerateFixReport;
    readonly regressedBeyondMargin: GenerateFixReport;
    readonly discordanceExceedsAssumption: GenerateFixReport;
  };
}

interface AnalyseVisualEnvelope {
  readonly baseline: AnalyseVisualReport;
  readonly candidates: {
    readonly identical: AnalyseVisualReport;
    readonly regressedBeyondMargin: AnalyseVisualReport;
    readonly discordanceExceedsAssumption: AnalyseVisualReport;
  };
}

function loadGenerateFixFixture(): GenerateFixEnvelope {
  return JSON.parse(readFileSync(GENERATE_FIX_FIXTURE_PATH, 'utf-8')) as unknown as GenerateFixEnvelope;
}

function loadAnalyseVisualFixture(): AnalyseVisualEnvelope {
  return JSON.parse(readFileSync(ANALYSE_VISUAL_FIXTURE_PATH, 'utf-8')) as unknown as AnalyseVisualEnvelope;
}

// ---------------------------------------------------------------------------
// generate-fix — the POSITIVE CONTROL. Already passes since 85-02; run here
// anyway, side by side with analyse-visual, so both paths are visibly held
// to the same standard (a positive control that is not run is not a
// control).
// ---------------------------------------------------------------------------
describe('generate-fix — parseVerdict round-trips all three outcomes (positive control)', () => {
  it('PASS round-trips unchanged', () => {
    const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const fixture = loadGenerateFixFixture();
    const verdict = compareGenerateFix(bar, fixture.baseline, fixture.candidates.identical, {
      state: 'not-yet-measured',
    });
    expect(verdict.outcome).toBe('PASS');
    const json = serialiseVerdict(verdict);
    const roundTripped = parseVerdict(json);
    expect(roundTripped).toEqual(JSON.parse(json));
  });

  it('FAIL round-trips unchanged', () => {
    const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const fixture = loadGenerateFixFixture();
    const verdict = compareGenerateFix(bar, fixture.baseline, fixture.candidates.regressedBeyondMargin, {
      state: 'not-yet-measured',
    });
    expect(verdict.outcome).toBe('FAIL');
    const json = serialiseVerdict(verdict);
    const roundTripped = parseVerdict(json);
    expect(roundTripped).toEqual(JSON.parse(json));
  });

  it('UNDERPOWERED round-trips unchanged', () => {
    const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const fixture = loadGenerateFixFixture();
    const verdict = compareGenerateFix(bar, fixture.baseline, fixture.candidates.discordanceExceedsAssumption, {
      state: 'not-yet-measured',
    });
    expect(verdict.outcome).toBe('UNDERPOWERED');
    const json = serialiseVerdict(verdict);
    const roundTripped = parseVerdict(json);
    expect(roundTripped).toEqual(JSON.parse(json));
  });

  it('refuses a hand-written PASS/insufficient-power contradiction, naming the error class', () => {
    const badDocument = JSON.stringify({
      capability: 'generate-fix',
      outcome: 'PASS',
      power: {
        sufficient: false,
        reasons: [
          { kind: 'discordance-exceeds-assumption', assumedDiscordantPairRate: 0.25, observedDiscordantPairRate: 0.5 },
        ],
        assumedDiscordantPairRate: 0.25,
        observedDiscordantPairRate: 0.5,
        runToRunInstability: { state: 'not-yet-measured' },
      },
    });
    let caught: unknown;
    try {
      parseVerdict(badDocument);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(VerdictPassPowerContradictionError);
  });

  it('refuses a non-object top-level value with the shape-level error, not a TypeError', () => {
    let caught: unknown;
    try {
      parseVerdict(JSON.stringify(['not', 'an', 'object']));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(InvalidVerdictJsonError);
  });
});

// ---------------------------------------------------------------------------
// analyse-visual — the SECOND PATH, closed by this task. Same standard as
// generate-fix above: all three outcomes round-trip, the contradiction is
// refused, the shape check fires before any property access can throw.
// ---------------------------------------------------------------------------
describe('analyse-visual — parseAnalyseVisualVerdict round-trips all three outcomes (Task 3)', () => {
  it('PASS round-trips unchanged', () => {
    const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const fixture = loadAnalyseVisualFixture();
    const verdict = compareAnalyseVisual(bar, fixture.baseline, fixture.candidates.identical, {
      state: 'not-yet-measured',
    });
    expect(verdict.overallVerdict.outcome).toBe('PASS');
    const json = serialiseAnalyseVisualVerdict(verdict);
    const roundTripped = parseAnalyseVisualVerdict(json);
    expect(roundTripped).toEqual(JSON.parse(json));
  });

  it('FAIL round-trips unchanged', () => {
    const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const fixture = loadAnalyseVisualFixture();
    const verdict = compareAnalyseVisual(bar, fixture.baseline, fixture.candidates.regressedBeyondMargin, {
      state: 'not-yet-measured',
    });
    expect(verdict.overallVerdict.outcome).toBe('FAIL');
    const json = serialiseAnalyseVisualVerdict(verdict);
    const roundTripped = parseAnalyseVisualVerdict(json);
    expect(roundTripped).toEqual(JSON.parse(json));
  });

  it('UNDERPOWERED round-trips unchanged', () => {
    const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const fixture = loadAnalyseVisualFixture();
    const verdict = compareAnalyseVisual(bar, fixture.baseline, fixture.candidates.discordanceExceedsAssumption, {
      state: 'not-yet-measured',
    });
    expect(verdict.overallVerdict.outcome).toBe('UNDERPOWERED');
    const json = serialiseAnalyseVisualVerdict(verdict);
    const roundTripped = parseAnalyseVisualVerdict(json);
    expect(roundTripped).toEqual(JSON.parse(json));
  });

  it('refuses a hand-edited overallVerdict.outcome: PASS while nonInferiorityClause.power.sufficient is false — the SAME contradiction generate-fix already refuses', () => {
    const badDocument = JSON.stringify({
      capability: 'analyse-visual',
      overallVerdict: { outcome: 'PASS', derivedNote: 'synthetic', licence: 'synthetic' },
      nonInferiorityClause: {
        outcome: 'PASS',
        power: {
          sufficient: false,
          reasons: [
            {
              kind: 'discordance-exceeds-assumption',
              assumedDiscordantPairRate: 0.25,
              observedDiscordantPairRate: 0.5,
            },
          ],
          assumedDiscordantPairRate: 0.25,
          observedDiscordantPairRate: 0.5,
          runToRunInstability: { state: 'not-yet-measured' },
        },
      },
    });
    let caught: unknown;
    try {
      parseAnalyseVisualVerdict(badDocument);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(VerdictPassPowerContradictionError);
  });

  it('refuses a non-object top-level value with the shape-level error, not a TypeError from a later property access', () => {
    let caught: unknown;
    try {
      parseAnalyseVisualVerdict(JSON.stringify(42));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(InvalidVerdictJsonError);
  });

  it('refuses a null top-level value with the shape-level error', () => {
    let caught: unknown;
    try {
      parseAnalyseVisualVerdict(JSON.stringify(null));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(InvalidVerdictJsonError);
  });

  it('a well-formed PASS document parses cleanly (no false positive from the contradiction guard)', () => {
    const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const fixture = loadAnalyseVisualFixture();
    const verdict = compareAnalyseVisual(bar, fixture.baseline, fixture.candidates.identical, {
      state: 'not-yet-measured',
    });
    expect(verdict.overallVerdict.outcome).toBe('PASS');
    const json = serialiseAnalyseVisualVerdict(verdict);
    expect(() => parseAnalyseVisualVerdict(json)).not.toThrow();
  });
});
