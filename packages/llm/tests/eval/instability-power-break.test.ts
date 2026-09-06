/**
 * `instability-power-break.test.ts` — Phase 86 Task 3, ROADMAP SC5.
 *
 * THE PHASE'S SINGLE MOST IMPORTANT DELIVERABLE. This is the committed
 * break-test evidence in the same spirit as Phase 84's `break-test.test.ts`:
 * it is not a regression test that happens to pass, it is the artifact a
 * maintainer points at when asked why any green from this instrument should
 * be believed.
 *
 * ENTIRELY SYNTHETIC BY DESIGN. Every case here is driven from the committed
 * synthetic fixture pairs (`generate-fix-pair.synthetic.json`,
 * `analyse-visual-pair.synthetic.json`) plus a LITERAL instability value
 * passed as the comparators' fourth argument — never from a replay
 * replication. A replay run is deterministic (the fixture adapter returns
 * the same string every time it is asked for the same item), so its
 * run-to-run instability is exactly ZERO by construction. A test built on a
 * replay run would have NO REACHABLE FAILURE STATE for the thing under test
 * here — the exact "guard with an unreachable failure state" shape this
 * repository has shipped before and is trying not to ship again. Do not
 * "improve" this test by replacing the literal instability values below with
 * a real replication run; that would silently disable the only path that can
 * ever fail red.
 *
 * A-6 (85-CONTEXT.md): breaking the watched thing and seeing red proves the
 * harness ran. It does not prove the guard did the catching. Every case
 * below is proven in BOTH directions: (1) the guard fires on the broken
 * input (asserted here); (2) the guard is NEUTERED, the SAME broken input is
 * unchanged, and the case is watched to sail through to PASS (a scratch
 * source edit + a full re-run of THIS file, recorded verbatim in
 * 86-02-SUMMARY.md — not expressible as a vitest assertion, because the
 * whole point is that the neutered code behaves differently from what is
 * committed here).
 *
 * A-9 (85-CONTEXT.md): UNDERPOWERED is the EXPECTED verdict at these sample
 * sizes, not a fault. Nothing in this file treats an UNDERPOWERED outcome as
 * an error to fix — it is the outcome being tested FOR.
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
import type { GenerateFixReport, AnalyseVisualReport } from '../../src/eval/report.js';
import type { RunToRunInstability } from '../../src/eval/verdict-types.js';

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
  readonly candidates: { readonly identical: GenerateFixReport };
}

interface AnalyseVisualEnvelope {
  readonly baseline: AnalyseVisualReport;
  readonly candidates: { readonly identical: AnalyseVisualReport };
}

function loadGenerateFixFixture(): GenerateFixEnvelope {
  return JSON.parse(readFileSync(GENERATE_FIX_FIXTURE_PATH, 'utf-8')) as unknown as GenerateFixEnvelope;
}

function loadAnalyseVisualFixture(): AnalyseVisualEnvelope {
  return JSON.parse(readFileSync(ANALYSE_VISUAL_FIXTURE_PATH, 'utf-8')) as unknown as AnalyseVisualEnvelope;
}

// The pre-registered varianceAssumption ceiling for BOTH capabilities is
// 0.25 (decision-bars.v1.json) — 0.1 sits below it, 0.9 sits strictly above
// it. Read from the LITERAL constant here rather than the loaded bar so the
// two calls in each pair differ in EXACTLY the instability argument, never
// in how the ceiling is obtained.
const BELOW_CEILING_INSTABILITY: RunToRunInstability = { state: 'measured', value: 0.1 };
const ABOVE_CEILING_INSTABILITY: RunToRunInstability = { state: 'measured', value: 0.9 };

// ---------------------------------------------------------------------------
// generate-fix
// ---------------------------------------------------------------------------
describe('SC5 -- generate-fix: measured instability decides PASS vs UNDERPOWERED', () => {
  it('below the ceiling: PASS (the control -- without this, the flip below proves nothing)', () => {
    const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const fixture = loadGenerateFixFixture();
    const verdict = compareGenerateFix(bar, fixture.baseline, fixture.candidates.identical, BELOW_CEILING_INSTABILITY);
    expect(verdict.outcome).toBe('PASS');
  });

  it('the SAME pair, above the ceiling, nothing else changed: UNDERPOWERED -- the two calls differ in exactly one argument', () => {
    const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const fixture = loadGenerateFixFixture();

    const belowVerdict = compareGenerateFix(
      bar,
      fixture.baseline,
      fixture.candidates.identical,
      BELOW_CEILING_INSTABILITY,
    );
    const aboveVerdict = compareGenerateFix(
      bar,
      fixture.baseline,
      fixture.candidates.identical,
      ABOVE_CEILING_INSTABILITY,
    );

    // Assert on the OUTCOME field, never merely on the presence of a reason
    // string -- a reason that appears while the outcome stays PASS is an
    // inert guard.
    expect(belowVerdict.outcome).toBe('PASS');
    expect(aboveVerdict.outcome).toBe('UNDERPOWERED');

    // Secondary evidence, never instead of the outcome assertion above.
    if (aboveVerdict.outcome === 'UNDERPOWERED') {
      const kinds = aboveVerdict.power.reasons.map((r) => r.kind);
      expect(kinds).toContain('run-to-run-instability-exceeds-ceiling');
    }
  });

  it('a serialised UNDERPOWERED verdict hand-edited to claim PASS is refused by parseVerdict on read-back', () => {
    const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const fixture = loadGenerateFixFixture();
    const aboveVerdict = compareGenerateFix(
      bar,
      fixture.baseline,
      fixture.candidates.identical,
      ABOVE_CEILING_INSTABILITY,
    );
    expect(aboveVerdict.outcome).toBe('UNDERPOWERED');

    const tampered = JSON.parse(serialiseVerdict(aboveVerdict)) as Record<string, unknown>;
    tampered['outcome'] = 'PASS'; // power.sufficient stays false -- untouched
    tampered['licenceQualifier'] = {
      state: 'measured',
      observedRunToRunInstability: 0.9,
      assumedCeiling: 0.25,
      supersededClauses: [{ path: 'scratch', clauseText: 'scratch' }],
      note: 'tampered to match the tampered power state; the PASS/power contradiction fires first',
    };

    let caught: unknown;
    try {
      parseVerdict(JSON.stringify(tampered));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(VerdictPassPowerContradictionError);
  });
});

// ---------------------------------------------------------------------------
// analyse-visual
// ---------------------------------------------------------------------------
describe('SC5 -- analyse-visual: measured instability decides overallVerdict.outcome (PASS vs UNDERPOWERED)', () => {
  it('below the ceiling: PASS (the control)', () => {
    const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const fixture = loadAnalyseVisualFixture();
    const verdict = compareAnalyseVisual(
      bar,
      fixture.baseline,
      fixture.candidates.identical,
      BELOW_CEILING_INSTABILITY,
    );
    expect(verdict.overallVerdict.outcome).toBe('PASS');
  });

  it('the SAME pair, above the ceiling, nothing else changed: overallVerdict.outcome flips to UNDERPOWERED', () => {
    const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const fixture = loadAnalyseVisualFixture();

    const belowVerdict = compareAnalyseVisual(
      bar,
      fixture.baseline,
      fixture.candidates.identical,
      BELOW_CEILING_INSTABILITY,
    );
    const aboveVerdict = compareAnalyseVisual(
      bar,
      fixture.baseline,
      fixture.candidates.identical,
      ABOVE_CEILING_INSTABILITY,
    );

    expect(belowVerdict.overallVerdict.outcome).toBe('PASS');
    expect(aboveVerdict.overallVerdict.outcome).toBe('UNDERPOWERED');

    if (!aboveVerdict.nonInferiorityClause.power.sufficient) {
      const kinds = aboveVerdict.nonInferiorityClause.power.reasons.map((r) => r.kind);
      expect(kinds).toContain('run-to-run-instability-exceeds-ceiling');
    } else {
      throw new Error('expected nonInferiorityClause.power.sufficient to be false above the ceiling');
    }
  });

  it('a serialised UNDERPOWERED verdict hand-edited to claim overall PASS is refused by parseAnalyseVisualVerdict on read-back', () => {
    const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const fixture = loadAnalyseVisualFixture();
    const aboveVerdict = compareAnalyseVisual(
      bar,
      fixture.baseline,
      fixture.candidates.identical,
      ABOVE_CEILING_INSTABILITY,
    );
    expect(aboveVerdict.overallVerdict.outcome).toBe('UNDERPOWERED');

    const tampered = JSON.parse(serialiseAnalyseVisualVerdict(aboveVerdict)) as Record<string, unknown>;
    (tampered['overallVerdict'] as Record<string, unknown>)['outcome'] = 'PASS';
    (tampered['nonInferiorityClause'] as Record<string, unknown>)['outcome'] = 'PASS'; // power.sufficient stays false
    tampered['licenceQualifier'] = {
      state: 'measured',
      observedRunToRunInstability: 0.9,
      assumedCeiling: 0.25,
      supersededClauses: [{ path: 'scratch', clauseText: 'scratch' }],
      note: 'tampered to match the tampered power state; the PASS/power contradiction fires first',
    };

    let caught: unknown;
    try {
      parseAnalyseVisualVerdict(JSON.stringify(tampered));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(VerdictPassPowerContradictionError);
  });
});
