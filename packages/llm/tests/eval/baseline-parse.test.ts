/**
 * `baseline-parse.test.ts` — Phase 86 gap-1 quick (260928-863) Task 3: parser
 * hardening for `parseLiveBaselineReplicationArtifact` and
 * `measuredInstabilityForBaseline` (`baseline.ts`).
 *
 * A `--replication` artifact is a maintainer-supplied JSON file that cannot
 * be trusted to be well-formed, self-consistent, live, or about the SAME
 * experiment as the `--baseline` report it is meant to supply the noise
 * floor for (T-Q863-01..03). Every mutated input here is built as a NEW
 * object from a committed artifact's already-parsed JSON, never mutated in
 * place (global immutability rule).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseLiveBaselineReplicationArtifact,
  measuredInstabilityForBaseline,
  buildGenerateFixBaselineReplicationArtifact,
  serialiseBaselineReplicationArtifact,
  isLiveBaselineReplicationArtifact,
  InvalidBaselineReplicationArtifactError,
  BaselineArtifactRuntimeModeMismatchError,
  type LiveBaselineReplicationArtifact,
} from '../../src/eval/baseline.js';
import { RunFunctionMismatchError } from '../../src/eval/run-manifest.js';
import { loadDecisionBars } from '../../src/eval/decision-bars.js';
import type { GenerateFixReport } from '../../src/eval/report.js';

const PACKAGE_ROOT = process.cwd();

function loadCommittedArtifact(name: string): Record<string, unknown> {
  const path = join(PACKAGE_ROOT, 'tests', 'eval', 'baselines', name);
  return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
}

const GENERATE_FIX_ARTIFACT_NAME = 'generate-fix.baseline.v1.json';
const ANALYSE_VISUAL_ARTIFACT_NAME = 'analyse-visual.baseline.v1.json';

describe('parseLiveBaselineReplicationArtifact', () => {
  it('parses both committed live replication artifacts to their recorded measured instability', () => {
    const gf = loadCommittedArtifact(GENERATE_FIX_ARTIFACT_NAME);
    const av = loadCommittedArtifact(ANALYSE_VISUAL_ARTIFACT_NAME);

    const parsedGf = parseLiveBaselineReplicationArtifact(JSON.stringify(gf));
    const parsedAv = parseLiveBaselineReplicationArtifact(JSON.stringify(av));

    expect(parsedGf.instability.runToRunInstability).toEqual({ state: 'measured', value: 0 });
    expect(parsedAv.instability.runToRunInstability).toEqual({
      state: 'measured',
      value: 0.23076923076923078,
    });
  });

  it('refuses a synthetic replication artifact as not a baseline', () => {
    const gf = loadCommittedArtifact(GENERATE_FIX_ARTIFACT_NAME);
    const { mode: _mode, runFunction: _runFunction, ...rest } = gf;
    const synthetic = { ...rest, _synthetic: true, syntheticNote: 'a scratch synthetic note for P2' };

    expect(() => parseLiveBaselineReplicationArtifact(JSON.stringify(synthetic))).toThrow(
      InvalidBaselineReplicationArtifactError,
    );
    try {
      parseLiveBaselineReplicationArtifact(JSON.stringify(synthetic));
      expect.unreachable('expected a throw');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidBaselineReplicationArtifactError);
      expect((err as Error).message).toMatch(/not a baseline/);
    }
  });

  it('refuses a live-shaped artifact whose run function mode is replay', () => {
    const gf = loadCommittedArtifact(GENERATE_FIX_ARTIFACT_NAME);
    const runFunction = gf.runFunction as Record<string, unknown>;
    const mutated = { ...gf, runFunction: { ...runFunction, mode: 'replay' } };

    expect(() => parseLiveBaselineReplicationArtifact(JSON.stringify(mutated))).toThrow(
      BaselineArtifactRuntimeModeMismatchError,
    );
  });

  it('refuses an instability whose state is not measured', () => {
    const gf = loadCommittedArtifact(GENERATE_FIX_ARTIFACT_NAME);
    const instability = gf.instability as Record<string, unknown>;
    const mutated = {
      ...gf,
      instability: { ...instability, runToRunInstability: { state: 'not-yet-measured' } },
    };

    expect(() => parseLiveBaselineReplicationArtifact(JSON.stringify(mutated))).toThrow(
      InvalidBaselineReplicationArtifactError,
    );
  });

  // The test above cannot see the state clause alone: its fixture has no value, so the sibling
  // `typeof value` clause refuses it too (break-test E, 2026-09-28, reddened nothing). This one
  // carries a VALID value under a non-measured state, so only the state clause can refuse it.
  it('refuses a non-measured state even when it carries a valid numeric value', () => {
    const gf = loadCommittedArtifact(GENERATE_FIX_ARTIFACT_NAME);
    const instability = gf.instability as Record<string, unknown>;
    const mutated = {
      ...gf,
      instability: { ...instability, runToRunInstability: { state: 'not-yet-measured', value: 0 } },
    };

    expect(() => parseLiveBaselineReplicationArtifact(JSON.stringify(mutated))).toThrow(
      InvalidBaselineReplicationArtifactError,
    );
  });

  it('refuses a measured value that is not a finite rate between 0 and 1', () => {
    const gf = loadCommittedArtifact(GENERATE_FIX_ARTIFACT_NAME);
    const instability = gf.instability as Record<string, unknown>;

    const withValue = (value: unknown) =>
      JSON.stringify({
        ...gf,
        instability: { ...instability, runToRunInstability: { state: 'measured', value } },
      });

    // NaN serialises to null via JSON.stringify -- exercised directly as the
    // parser's actual input (a hand-edited document could contain a `null`
    // there just as easily).
    expect(() => parseLiveBaselineReplicationArtifact(withValue(null))).toThrow(
      InvalidBaselineReplicationArtifactError,
    );
    expect(() => parseLiveBaselineReplicationArtifact(withValue(-0.1))).toThrow(
      InvalidBaselineReplicationArtifactError,
    );
    expect(() => parseLiveBaselineReplicationArtifact(withValue(1.5))).toThrow(
      InvalidBaselineReplicationArtifactError,
    );
    expect(() => parseLiveBaselineReplicationArtifact(withValue('0.3'))).toThrow(
      InvalidBaselineReplicationArtifactError,
    );
  });

  it('refuses an artifact whose maximum disagrees with its runToRunInstability value', () => {
    const gf = loadCommittedArtifact(GENERATE_FIX_ARTIFACT_NAME);
    const instability = gf.instability as Record<string, unknown>;
    const mutated = { ...gf, instability: { ...instability, maximum: 0.4 } };

    expect(() => parseLiveBaselineReplicationArtifact(JSON.stringify(mutated))).toThrow(
      InvalidBaselineReplicationArtifactError,
    );
  });

  it('refuses an artifact whose sampleSizeAssumptionCheck disagrees with its instability', () => {
    const gf = loadCommittedArtifact(GENERATE_FIX_ARTIFACT_NAME);
    const check = gf.sampleSizeAssumptionCheck as Record<string, unknown>;
    const mutated = {
      ...gf,
      sampleSizeAssumptionCheck: { ...check, observedRunToRunInstability: 0.4 },
    };

    expect(() => parseLiveBaselineReplicationArtifact(JSON.stringify(mutated))).toThrow(
      InvalidBaselineReplicationArtifactError,
    );
  });

  it('refuses an artifact whose repeat run functions differ on a compared field', () => {
    const gf = loadCommittedArtifact(GENERATE_FIX_ARTIFACT_NAME);
    const repeats = gf.repeats as Record<string, unknown>[];
    const mutatedRepeats = repeats.map((repeat, index) =>
      index === 1 ? { ...repeat, temperature: (repeat.temperature as number) + 1 } : repeat,
    );
    const mutated = { ...gf, repeats: mutatedRepeats };

    expect(() => parseLiveBaselineReplicationArtifact(JSON.stringify(mutated))).toThrow(RunFunctionMismatchError);
  });

  it('accepts repeats that differ from the artifact only in timestamp', () => {
    const gf = loadCommittedArtifact(GENERATE_FIX_ARTIFACT_NAME);
    const repeats = gf.repeats as { timestamp: string; [key: string]: unknown }[];
    const runFunction = gf.runFunction as { timestamp: string };

    const parsed = parseLiveBaselineReplicationArtifact(JSON.stringify(gf));
    expect(parsed).toBeDefined();

    // Non-vacuous positive control: at least one committed repeat's
    // timestamp actually differs from the artifact's own runFunction
    // timestamp -- so this test would fail if the committed fixtures were
    // ever accidentally made fully identical.
    expect(repeats.some((repeat) => repeat.timestamp !== runFunction.timestamp)).toBe(true);
  });

  it('refuses input that is not a JSON object', () => {
    expect(() => parseLiveBaselineReplicationArtifact('null')).toThrow(InvalidBaselineReplicationArtifactError);
    expect(() => parseLiveBaselineReplicationArtifact('[]')).toThrow(InvalidBaselineReplicationArtifactError);
    expect(() => parseLiveBaselineReplicationArtifact('42')).toThrow(InvalidBaselineReplicationArtifactError);
    expect(() => parseLiveBaselineReplicationArtifact('{not json')).toThrow(InvalidBaselineReplicationArtifactError);

    for (const input of ['null', '[]', '42', '{not json']) {
      try {
        parseLiveBaselineReplicationArtifact(input);
        expect.unreachable('expected a throw');
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidBaselineReplicationArtifactError);
      }
    }
  });

  it('round-trips an artifact built by the real builder and live writer', () => {
    const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const reports: GenerateFixReport[] = [1, 2, 3].map((n) =>
      loadCommittedArtifact(`generate-fix.repeat-0${n}.report.json`),
    ) as unknown as GenerateFixReport[];

    const artifact = buildGenerateFixBaselineReplicationArtifact(reports, bar);
    if (!isLiveBaselineReplicationArtifact(artifact)) {
      throw new Error('expected a live artifact');
    }
    const serialised = serialiseBaselineReplicationArtifact(artifact);
    const parsed = parseLiveBaselineReplicationArtifact(serialised);

    expect(parsed).toEqual(artifact);
  });

  it('measuredInstabilityForBaseline refuses a baseline differing on a compared field and accepts a timestamp-only difference', () => {
    const gf = loadCommittedArtifact(GENERATE_FIX_ARTIFACT_NAME);
    const parsed = parseLiveBaselineReplicationArtifact(JSON.stringify(gf)) as LiveBaselineReplicationArtifact;
    const baselineRunFunction = parsed.runFunction as unknown as Record<string, unknown>;

    const differentModelId = { ...baselineRunFunction, modelId: 'a-different-model' };
    try {
      measuredInstabilityForBaseline(parsed, differentModelId as never);
      expect.unreachable('expected a throw');
    } catch (err) {
      expect(err).toBeInstanceOf(RunFunctionMismatchError);
      expect((err as RunFunctionMismatchError).differingFields).toContain('modelId');
    }

    const timestampOnlyDifference = { ...baselineRunFunction, timestamp: '2000-01-01T00:00:00.000Z' };
    const result = measuredInstabilityForBaseline(parsed, timestampOnlyDifference as never);
    expect(result).toEqual(parsed.instability.runToRunInstability);
  });
});
