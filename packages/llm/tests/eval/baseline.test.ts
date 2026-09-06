/**
 * `baseline.test.ts` — Phase 86 Task 1: the committable replication
 * artifact, its required sample-size assumption check, and the structural
 * refusal that a replay run is not a baseline (T-86-11, non-negotiable 1).
 *
 * Reuses the committed `instability-repeats.synthetic.json` fixture (86-01)
 * unmodified for the SYNTHETIC-shape assertions (its repeats are already
 * `mode: 'replay'`), and clones+mutates `mode` to `'live'` for the
 * PRODUCTION-shape assertions — the SAME clone-and-mutate convention
 * `instability.test.ts` already uses for its own refusal tests, rather than
 * committing a second fixture file. No live provider call, no network call,
 * and no measurement of any kind is produced by this file.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildGenerateFixBaselineReplicationArtifact,
  buildAnalyseVisualBaselineReplicationArtifact,
  serialiseLiveBaselineReplicationArtifact,
  serialiseSyntheticBaselineReplicationArtifact,
  serialiseBaselineReplicationArtifact,
  isLiveBaselineReplicationArtifact,
  BaselineArtifactRuntimeModeMismatchError,
  type LiveBaselineReplicationArtifact,
  type SyntheticBaselineReplicationArtifact,
} from '../../src/eval/baseline.js';
import { loadDecisionBars } from '../../src/eval/decision-bars.js';
import { TooFewRepeatReportsError } from '../../src/eval/instability.js';
import { RunFunctionMismatchError } from '../../src/eval/run-manifest.js';
import type { GenerateFixReport, AnalyseVisualReport } from '../../src/eval/report.js';

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

function loadFixture(): SyntheticEnvelope {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8')) as unknown as SyntheticEnvelope;
}

/** Clones repeats and flips `mode` to `'live'` -- mirrors `instability.test.ts`'s own clone-and-mutate refusal tests. */
function asLiveMode<T extends { runFunction: { mode: string } }>(reports: readonly T[]): T[] {
  return reports.map((report) => {
    const clone = structuredClone(report);
    (clone.runFunction as { mode: string }).mode = 'live';
    return clone;
  });
}

const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');

describe('buildGenerateFixBaselineReplicationArtifact -- live-mode reports -> the production shape', () => {
  it('returns a top-level runFunction, mode:"live", and the required assumption check', () => {
    const fixture = loadFixture();
    const liveReports = asLiveMode(fixture.generateFix.repeats);
    const artifact = buildGenerateFixBaselineReplicationArtifact(liveReports, bar);

    expect(isLiveBaselineReplicationArtifact(artifact)).toBe(true);
    if (!isLiveBaselineReplicationArtifact(artifact)) throw new Error('unreachable');

    expect(artifact.mode).toBe('live');
    expect(artifact.runFunction.mode).toBe('live');
    expect(artifact.runFunction).toEqual(liveReports[0]!.runFunction);
    expect(artifact.instability.repeatCount).toBe(3);
    expect(artifact.instability.maximum).toBeCloseTo(0.6, 10);
    expect(artifact.repeats).toHaveLength(3);
    expect(artifact.repeats.every((r) => r.mode === 'live')).toBe(true);
    expect('_synthetic' in artifact).toBe(false);

    expect(artifact.sampleSizeAssumptionCheck.observedRunToRunInstability).toBeCloseTo(0.6, 10);
    expect(artifact.sampleSizeAssumptionCheck.assumedDiscordantPairRateCeiling).toBe(
      bar.varianceAssumption['generate-fix'].assumedValue,
    );
    expect(typeof artifact.sampleSizeAssumptionCheck.assumptionSurvives).toBe('boolean');
    expect(artifact.sampleSizeAssumptionCheck.consequence).toContain('run-to-run instability');
    expect(artifact.sampleSizeAssumptionCheck.consequence).toContain(
      "REUSE of a differently-named quantity's number",
    );
  });

  it('the assumption check reports NOT surviving when measured instability exceeds the ceiling, naming both quantities and stating UNDERPOWERED, never a relaxed bar', () => {
    const fixture = loadFixture();
    const liveReports = asLiveMode(fixture.generateFix.repeats); // maximum 0.6, ceiling 0.25
    const artifact = buildGenerateFixBaselineReplicationArtifact(liveReports, bar);
    const ceiling = bar.varianceAssumption['generate-fix'].assumedValue;

    expect(artifact.sampleSizeAssumptionCheck.assumptionSurvives).toBe(false);
    expect(artifact.sampleSizeAssumptionCheck.consequence).toContain('DOES NOT SURVIVE');
    expect(artifact.sampleSizeAssumptionCheck.consequence).toContain('UNDERPOWERED');
    expect(artifact.sampleSizeAssumptionCheck.consequence).toContain('UNCHANGED');
    expect(artifact.sampleSizeAssumptionCheck.consequence).toMatch(/0\.6/);
    expect(artifact.sampleSizeAssumptionCheck.consequence).toContain(String(ceiling));
  });

  it('the assumption check SURVIVES when measured instability is below the ceiling', () => {
    const fixture = loadFixture();
    const base = fixture.generateFix.repeats[0]!;
    const a = structuredClone(base);
    const b = structuredClone(base);
    (a.runFunction as { mode: string }).mode = 'live';
    (b.runFunction as { mode: string; timestamp: string }).mode = 'live';
    (b.runFunction as { timestamp: string }).timestamp = '2026-09-06T03:00:00.000Z';
    const artifact = buildGenerateFixBaselineReplicationArtifact([a, b], bar);
    expect(artifact.sampleSizeAssumptionCheck.observedRunToRunInstability).toBe(0);
    expect(artifact.sampleSizeAssumptionCheck.assumptionSurvives).toBe(true);
    expect(artifact.sampleSizeAssumptionCheck.consequence).toContain('SURVIVES');
  });
});

describe('buildAnalyseVisualBaselineReplicationArtifact -- the SAME shape, gating on verdictOutcome', () => {
  it('returns the identical production shape for analyse-visual', () => {
    const fixture = loadFixture();
    const liveReports = asLiveMode(fixture.analyseVisual.repeats);
    const artifact = buildAnalyseVisualBaselineReplicationArtifact(liveReports, bar);
    expect(isLiveBaselineReplicationArtifact(artifact)).toBe(true);
    expect(artifact.instability.maximum).toBeCloseTo(0.6, 10);
    expect(artifact.sampleSizeAssumptionCheck.assumedDiscordantPairRateCeiling).toBe(
      bar.varianceAssumption['analyse-visual'].assumedValue,
    );
  });
});

describe('replay-mode reports -> the SYNTHETIC shape, never the production one', () => {
  it('returns `_synthetic: true`, a syntheticNote stating the zero-by-construction fact, and NO top-level runFunction', () => {
    const fixture = loadFixture();
    // The fixture's own repeats are already mode: 'replay' -- unmodified.
    const artifact = buildGenerateFixBaselineReplicationArtifact(fixture.generateFix.repeats, bar);
    expect(isLiveBaselineReplicationArtifact(artifact)).toBe(false);
    expect('_synthetic' in artifact).toBe(true);
    if (isLiveBaselineReplicationArtifact(artifact)) throw new Error('unreachable');

    expect(artifact._synthetic).toBe(true);
    expect(typeof artifact.syntheticNote).toBe('string');
    expect(artifact.syntheticNote.length).toBeGreaterThan(0);
    expect(artifact.syntheticNote).toContain('0 BY CONSTRUCTION');
    expect('runFunction' in artifact).toBe(false);
    expect(artifact.sampleSizeAssumptionCheck).toBeDefined();
  });
});

describe('refusals propagate from computeRunToRunInstability -- no second comparison written in baseline.ts', () => {
  it('fewer than two repeats: TooFewRepeatReportsError propagates', () => {
    const fixture = loadFixture();
    expect(() =>
      buildGenerateFixBaselineReplicationArtifact([fixture.generateFix.repeats[0]!], bar),
    ).toThrow(TooFewRepeatReportsError);
  });

  it('mixed modes across repeats -- the SAME RunFunctionMismatchError assertComparable already throws, naming "mode"', () => {
    const fixture = loadFixture();
    const a = structuredClone(fixture.generateFix.repeats[0]!);
    const b = structuredClone(fixture.generateFix.repeats[1]!);
    (b.runFunction as { mode: string }).mode = 'live';
    let caught: unknown;
    try {
      buildGenerateFixBaselineReplicationArtifact([a, b], bar);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RunFunctionMismatchError);
    expect((caught as RunFunctionMismatchError).differingFields).toContain('mode');
  });

  it('two repeat reports whose run functions differ on modelId propagate RunFunctionMismatchError', () => {
    const fixture = loadFixture();
    const a = structuredClone(fixture.generateFix.repeats[0]!);
    const b = structuredClone(fixture.generateFix.repeats[1]!);
    (b.runFunction as { modelId: string }).modelId = 'a-different-model';
    expect(() => buildGenerateFixBaselineReplicationArtifact([a, b], bar)).toThrow(RunFunctionMismatchError);
  });
});

describe('the two writers -- each accepts only its own shape, the production writer re-asserts at runtime', () => {
  it('serialiseLiveBaselineReplicationArtifact writes JSON with a top-level runFunction for a genuine live artifact', () => {
    const fixture = loadFixture();
    const liveReports = asLiveMode(fixture.generateFix.repeats);
    const artifact = buildGenerateFixBaselineReplicationArtifact(liveReports, bar) as LiveBaselineReplicationArtifact;
    const json = serialiseLiveBaselineReplicationArtifact(artifact);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed['runFunction']).toBeDefined();
    expect(parsed['_synthetic']).toBeUndefined();
  });

  it('serialiseSyntheticBaselineReplicationArtifact writes JSON with `_synthetic` and no top-level runFunction', () => {
    const fixture = loadFixture();
    const artifact = buildGenerateFixBaselineReplicationArtifact(
      fixture.generateFix.repeats,
      bar,
    ) as SyntheticBaselineReplicationArtifact;
    const json = serialiseSyntheticBaselineReplicationArtifact(artifact);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed['_synthetic']).toBe(true);
    expect(parsed['runFunction']).toBeUndefined();
  });

  it('serialiseBaselineReplicationArtifact dispatches to the correct writer for either shape', () => {
    const fixture = loadFixture();
    const liveArtifact = buildGenerateFixBaselineReplicationArtifact(asLiveMode(fixture.generateFix.repeats), bar);
    const syntheticArtifact = buildGenerateFixBaselineReplicationArtifact(fixture.generateFix.repeats, bar);
    expect(JSON.parse(serialiseBaselineReplicationArtifact(liveArtifact))['runFunction']).toBeDefined();
    expect(JSON.parse(serialiseBaselineReplicationArtifact(syntheticArtifact))['_synthetic']).toBe(true);
  });

  // -------------------------------------------------------------------
  // Non-negotiable 1 / T-86-11: a replay run is not a baseline. The
  // FORWARD direction is committed here. The REVERSE direction (neuter the
  // runtime check, watch the SAME forged input write a document with a
  // top-level runFunction and no synthetic envelope) is a manual
  // break-and-restore exercise, recorded verbatim in SUMMARY.md, matching
  // this milestone's established convention for reverse-direction proofs
  // (86-02-SUMMARY.md "RECORDED EVIDENCE").
  // -------------------------------------------------------------------
  it('FORWARD: a production write attempted on a non-live run function is refused with a named error', () => {
    const fixture = loadFixture();
    // Build the SYNTHETIC shape from genuine replay-mode reports, then forge
    // an object that STRUCTURALLY matches the production shape (mode:
    // 'live' + top-level runFunction) while the embedded runFunction still
    // says 'replay' -- the exact "object literal that claims the production
    // shape while carrying a replay-mode run function" scenario the plan's
    // <behavior> describes.
    const synthetic = buildGenerateFixBaselineReplicationArtifact(
      fixture.generateFix.repeats,
      bar,
    ) as SyntheticBaselineReplicationArtifact;
    const forged: LiveBaselineReplicationArtifact = {
      mode: 'live',
      runFunction: synthetic.repeats[0]!, // .mode === 'replay'
      instability: synthetic.instability,
      repeats: synthetic.repeats,
      sampleSizeAssumptionCheck: synthetic.sampleSizeAssumptionCheck,
    };
    expect(forged.runFunction.mode).toBe('replay');

    let caught: unknown;
    try {
      serialiseLiveBaselineReplicationArtifact(forged);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BaselineArtifactRuntimeModeMismatchError);
    expect((caught as BaselineArtifactRuntimeModeMismatchError).actualMode).toBe('replay');
    expect((caught as Error).message).toContain('a replay run is not a baseline');
  });
});
