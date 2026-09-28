/**
 * `luqen-llm eval verdict --replication` CLI tests (86-VERIFICATION gap 1,
 * quick 260928-863).
 *
 * Closes the gap: `eval verdict` hardcoded `runToRunInstability:
 * { state: 'not-yet-measured' }`, so the measured instability committed
 * beside the two live baselines was never consumed and SC5's UNDERPOWERED
 * guard could not fire from the shipped CLI. This file proves the --replication
 * path end to end for both capabilities, using the SAME harness pattern
 * cli-verdict.test.ts already established (console spies, a temp dir per
 * test, `createProgram()` + `parseAsync`).
 *
 * `writeDerivedReplication` builds every mutated artifact by calling the REAL
 * builder (`buildGenerateFixBaselineReplicationArtifact` /
 * `buildAnalyseVisualBaselineReplicationArtifact`) over [original, derived]
 * report pairs -- never a hand-edited float -- so every number in the
 * artifact is self-consistent by construction.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProgram } from '../../src/cli.js';
import { loadDecisionBars } from '../../src/eval/decision-bars.js';
import {
  buildGenerateFixBaselineReplicationArtifact,
  buildAnalyseVisualBaselineReplicationArtifact,
  serialiseBaselineReplicationArtifact,
  isLiveBaselineReplicationArtifact,
} from '../../src/eval/baseline.js';
import { isScoredItem, type AnalyseVisualReport, type GenerateFixReport, type ItemRecord } from '../../src/eval/report.js';
import type { GenerateFixScoreRecord } from '../../src/eval/score-generate-fix.js';
import type { AnalyseVisualScoreRecord } from '../../src/eval/score-analyse-visual.js';
import { parseVerdict } from '../../src/eval/verdict.js';
import { parseAnalyseVisualVerdict } from '../../src/eval/verdict-analyse-visual.js';
import { UNMEASURED_INSTABILITY_CLAUSE_FRAGMENT } from '../../src/eval/licence-qualifier.js';

const PACKAGE_ROOT = process.cwd();

describe('luqen-llm eval verdict --replication CLI', () => {
  let logs: string[];
  let errors: string[];
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitCodeBefore: number | string | undefined;
  let dir: string;

  beforeEach(() => {
    logs = [];
    errors = [];
    logSpy = vi.spyOn(console, 'log').mockImplementation((msg: string) => {
      logs.push(String(msg));
    });
    errorSpy = vi.spyOn(console, 'error').mockImplementation((msg: string) => {
      errors.push(String(msg));
    });
    exitCodeBefore = process.exitCode;
    process.exitCode = undefined;
    dir = mkdtempSync(join(tmpdir(), 'luqen-eval-verdict-replication-cli-test-'));
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    process.exitCode = exitCodeBefore;
    rmSync(dir, { recursive: true, force: true });
  });

  /**
   * Reads the committed repeat report at `baseReportRelPath` (relative to
   * the package root), builds a SECOND report as a NEW object (never
   * mutating the parsed JSON: global immutability rule) whose
   * `runFunction.timestamp` is the fixed string below and whose gating
   * boolean is flipped on the first `flipCount` items, then calls the REAL
   * builder over [original, derived] and writes the resulting live
   * replication artifact into the test's temp dir. Returns its path.
   */
  function writeDerivedReplication(
    capability: 'generate-fix' | 'analyse-visual',
    baseReportRelPath: string,
    flipCount: number,
  ): string {
    const basePath = join(PACKAGE_ROOT, baseReportRelPath);
    const original = JSON.parse(readFileSync(basePath, 'utf-8')) as
      | GenerateFixReport
      | AnalyseVisualReport;

    const flipGenerateFix = (item: ItemRecord<GenerateFixScoreRecord>): ItemRecord<GenerateFixScoreRecord> =>
      isScoredItem(item) ? { ...item, score: { ...item.score, exactMatch: !item.score.exactMatch } } : item;

    const flipAnalyseVisual = (
      item: ItemRecord<AnalyseVisualScoreRecord>,
    ): ItemRecord<AnalyseVisualScoreRecord> =>
      isScoredItem(item)
        ? {
            ...item,
            score: {
              ...item.score,
              verdictOutcome: item.score.verdictOutcome === 'correct' ? 'uncertain' : 'correct',
            },
          }
        : item;

    const derived =
      capability === 'generate-fix'
        ? {
            ...(original as GenerateFixReport),
            runFunction: { ...original.runFunction, timestamp: '2026-09-28T00:00:00.000Z' },
            items: (original as GenerateFixReport).items.map((item, index) =>
              index < flipCount ? flipGenerateFix(item) : item,
            ),
          }
        : {
            ...(original as AnalyseVisualReport),
            runFunction: { ...original.runFunction, timestamp: '2026-09-28T00:00:00.000Z' },
            items: (original as AnalyseVisualReport).items.map((item, index) =>
              index < flipCount ? flipAnalyseVisual(item) : item,
            ),
          };

    const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const artifact =
      capability === 'generate-fix'
        ? buildGenerateFixBaselineReplicationArtifact(
            [original as GenerateFixReport, derived as GenerateFixReport],
            bar,
          )
        : buildAnalyseVisualBaselineReplicationArtifact(
            [original as AnalyseVisualReport, derived as AnalyseVisualReport],
            bar,
          );

    if (!isLiveBaselineReplicationArtifact(artifact)) {
      throw new Error('writeDerivedReplication: expected a live artifact from a live report pair');
    }

    const outPath = join(dir, `${capability}-derived-replication-${flipCount}.json`);
    writeFileSync(outPath, serialiseBaselineReplicationArtifact(artifact));
    return outPath;
  }

  it('generate-fix replication above the ceiling turns a CLI PASS into UNDERPOWERED', async () => {
    const baselinePath = join(PACKAGE_ROOT, 'tests/eval/baselines/generate-fix.repeat-01.report.json');
    const candidatePath = join(PACKAGE_ROOT, 'tests/eval/baselines/generate-fix.repeat-02.report.json');

    // Control: no --replication, unchanged.
    const controlProgram = createProgram();
    await controlProgram.parseAsync(
      ['node', 'cli', 'eval', 'verdict', '--baseline', baselinePath, '--candidate', candidatePath],
      { from: 'node' },
    );
    let output = logs.join('\n');
    expect(output).toMatch(/^Outcome: PASS$/m);
    expect(output).toMatch(/^Non-inferiority clause run-to-run instability: not-yet-measured$/m);

    // With --replication, above the 0.25 ceiling (5/17).
    logs = [];
    errors = [];
    const replicationPath = writeDerivedReplication(
      'generate-fix',
      'tests/eval/baselines/generate-fix.repeat-01.report.json',
      5,
    );
    const program = createProgram();
    await program.parseAsync(
      [
        'node',
        'cli',
        'eval',
        'verdict',
        '--baseline',
        baselinePath,
        '--candidate',
        candidatePath,
        '--replication',
        replicationPath,
      ],
      { from: 'node' },
    );

    output = logs.join('\n');
    const measuredValue = 5 / 17;
    expect(output).toMatch(/^Outcome: UNDERPOWERED$/m);
    expect(output).toContain(`run-to-run instability: measured (${measuredValue})`);
    expect(output).toMatch(/^Non-inferiority clause power insufficiency reason: run-to-run-instability-exceeds-ceiling/m);
    expect(output).toMatch(/^Licence qualifier: Run-to-run instability was measured at/m);
    expect(process.exitCode).toBeUndefined();
  });

  it('analyse-visual measured replication leaves the false-PASS caveat un-superseded', async () => {
    const baselinePath = join(PACKAGE_ROOT, 'tests/eval/baselines/analyse-visual.repeat-02.report.json');
    const candidatePath = join(PACKAGE_ROOT, 'tests/eval/baselines/analyse-visual.repeat-01.report.json');
    const replicationPath = join(PACKAGE_ROOT, 'tests/eval/baselines/analyse-visual.baseline.v1.json');
    const outPath = join(dir, 'f1-verdict.json');

    const program = createProgram();
    await program.parseAsync(
      [
        'node',
        'cli',
        'eval',
        'verdict',
        '--baseline',
        baselinePath,
        '--candidate',
        candidatePath,
        '--replication',
        replicationPath,
        '--out',
        outPath,
      ],
      { from: 'node' },
    );

    const output = logs.join('\n');
    expect(output).toMatch(/^Overall: PASS$/m);
    expect(output).toMatch(/^False-PASS gate: PASS$/m);
    const licenceQualifierLine = output.split('\n').find((l) => l.startsWith('Licence qualifier:'));
    expect(licenceQualifierLine).toBeDefined();
    expect(licenceQualifierLine).not.toContain('falsePassGate');

    const written = readFileSync(outPath, 'utf-8');
    const verdict = parseAnalyseVisualVerdict(written);
    expect(verdict.licenceQualifier.state).toBe('measured');
    expect(verdict.nonInferiorityClause.power.runToRunInstability.state).toBe('measured');
    if (verdict.licenceQualifier.state === 'measured') {
      expect(verdict.licenceQualifier.supersededClauses.map((c) => c.path)).toEqual([
        'licenceStrings.nonInferiorityClause.analyseVisualCorrect.pass.text',
      ]);
    }
    expect(verdict.falsePassGate.licence).toContain(UNMEASURED_INSTABILITY_CLAUSE_FRAGMENT);
  });

  // -------------------------------------------------------------------
  // T2-T13 (Task 3): the full CLI matrix for both capabilities.
  // -------------------------------------------------------------------

  /** Extracts the printed line labels using the SAME regex the D-85-1 pin uses (cli-verdict.test.ts). */
  function extractLabels(output: string): Set<string> {
    return new Set(
      output
        .split('\n')
        .map((l) => l.match(/^([A-Z][^:]*):\s/))
        .filter((m): m is RegExpMatchArray => m !== null)
        .map((m) => m[1]!),
    );
  }

  it('generate-fix committed replication at or below the ceiling leaves PASS and reports measured', async () => {
    const baselinePath = join(PACKAGE_ROOT, 'tests/eval/baselines/generate-fix.repeat-01.report.json');
    const candidatePath = join(PACKAGE_ROOT, 'tests/eval/baselines/generate-fix.repeat-02.report.json');
    const replicationPath = join(PACKAGE_ROOT, 'tests/eval/baselines/generate-fix.baseline.v1.json');
    const outPath = join(dir, 't2-verdict.json');

    const program = createProgram();
    await program.parseAsync(
      [
        'node', 'cli', 'eval', 'verdict',
        '--baseline', baselinePath, '--candidate', candidatePath,
        '--replication', replicationPath, '--out', outPath,
      ],
      { from: 'node' },
    );

    const output = logs.join('\n');
    expect(output).toMatch(/^Outcome: PASS$/m);
    expect(output).toContain('run-to-run instability: measured (0)');
    expect(output).toMatch(/^Licence qualifier:/m);

    const verdict = parseVerdict(readFileSync(outPath, 'utf-8'));
    expect(verdict.licenceQualifier.state).toBe('measured');
    expect(verdict.power.runToRunInstability).toEqual({ state: 'measured', value: 0 });
  });

  it('generate-fix replication not comparable with the baseline report is refused before any verdict', async () => {
    const baseline = JSON.parse(
      readFileSync(join(PACKAGE_ROOT, 'tests/eval/baselines/generate-fix.repeat-01.report.json'), 'utf-8'),
    ) as GenerateFixReport;
    const mutatedBaseline = { ...baseline, runFunction: { ...baseline.runFunction, modelId: 'a-different-model' } };
    const baselinePath = join(dir, 't3-baseline.json');
    writeFileSync(baselinePath, JSON.stringify(mutatedBaseline));
    const candidatePath = join(PACKAGE_ROOT, 'tests/eval/baselines/generate-fix.repeat-02.report.json');
    const replicationPath = join(PACKAGE_ROOT, 'tests/eval/baselines/generate-fix.baseline.v1.json');
    const outPath = join(dir, 't3-verdict.json');

    // CONTROL: the same derived pair WITHOUT --replication prints an Outcome: line.
    const controlProgram = createProgram();
    await controlProgram.parseAsync(
      ['node', 'cli', 'eval', 'verdict', '--baseline', baselinePath, '--candidate', candidatePath],
      { from: 'node' },
    );
    expect(logs.join('\n')).toMatch(/^Outcome:/m);

    logs = [];
    errors = [];
    const program = createProgram();
    await program.parseAsync(
      [
        'node', 'cli', 'eval', 'verdict',
        '--baseline', baselinePath, '--candidate', candidatePath,
        '--replication', replicationPath, '--out', outPath,
      ],
      { from: 'node' },
    );

    expect(process.exitCode).toBe(1);
    const errorOutput = errors.join('\n');
    expect(errorOutput).toMatch(/--replication/);
    expect(errorOutput).toMatch(/modelId/);
    expect(logs.join('\n')).not.toMatch(/^Outcome:/m);
    expect(existsSync(outPath)).toBe(false);
  });

  it('analyse-visual replication above the ceiling turns a CLI PASS into UNDERPOWERED', async () => {
    const baselinePath = join(PACKAGE_ROOT, 'tests/eval/baselines/analyse-visual.repeat-02.report.json');
    const candidatePath = join(PACKAGE_ROOT, 'tests/eval/baselines/analyse-visual.repeat-01.report.json');

    const controlProgram = createProgram();
    await controlProgram.parseAsync(
      ['node', 'cli', 'eval', 'verdict', '--baseline', baselinePath, '--candidate', candidatePath],
      { from: 'node' },
    );
    let output = logs.join('\n');
    expect(output).toMatch(/^Overall: PASS$/m);
    expect(output).toMatch(/^Non-inferiority clause run-to-run instability: not-yet-measured$/m);

    logs = [];
    errors = [];
    const replicationPath = writeDerivedReplication(
      'analyse-visual',
      'tests/eval/baselines/analyse-visual.repeat-02.report.json',
      4,
    );
    const program = createProgram();
    await program.parseAsync(
      [
        'node', 'cli', 'eval', 'verdict',
        '--baseline', baselinePath, '--candidate', candidatePath,
        '--replication', replicationPath,
      ],
      { from: 'node' },
    );

    output = logs.join('\n');
    const measuredValue = 4 / 13;
    expect(output).toMatch(/^Overall: UNDERPOWERED$/m);
    expect(output).toMatch(/^Non-inferiority clause: UNDERPOWERED$/m);
    expect(output).toMatch(/^False-PASS gate: PASS$/m);
    expect(output).toMatch(/^Non-inferiority clause power insufficiency reason: run-to-run-instability-exceeds-ceiling/m);
    expect(output).toContain(`run-to-run instability: measured (${measuredValue})`);
    expect(output).toMatch(/^Licence qualifier:/m);
  });

  it('analyse-visual committed replication at or below the ceiling leaves PASS and reports measured', async () => {
    const baselinePath = join(PACKAGE_ROOT, 'tests/eval/baselines/analyse-visual.repeat-02.report.json');
    const candidatePath = join(PACKAGE_ROOT, 'tests/eval/baselines/analyse-visual.repeat-01.report.json');
    const replicationPath = join(PACKAGE_ROOT, 'tests/eval/baselines/analyse-visual.baseline.v1.json');
    const outPath = join(dir, 't5-verdict.json');

    const program = createProgram();
    await program.parseAsync(
      [
        'node', 'cli', 'eval', 'verdict',
        '--baseline', baselinePath, '--candidate', candidatePath,
        '--replication', replicationPath, '--out', outPath,
      ],
      { from: 'node' },
    );

    const output = logs.join('\n');
    expect(output).toMatch(/^Overall: PASS$/m);
    expect(output).toContain('run-to-run instability: measured (0.23076923076923078)');

    const verdict = parseAnalyseVisualVerdict(readFileSync(outPath, 'utf-8'));
    expect(verdict.licenceQualifier.state).toBe('measured');
  });

  it('analyse-visual replication not comparable with the baseline report is refused before any verdict', async () => {
    const baseline = JSON.parse(
      readFileSync(join(PACKAGE_ROOT, 'tests/eval/baselines/analyse-visual.repeat-02.report.json'), 'utf-8'),
    ) as AnalyseVisualReport;
    const mutatedBaseline = { ...baseline, runFunction: { ...baseline.runFunction, modelId: 'a-different-model' } };
    const baselinePath = join(dir, 't6-baseline.json');
    writeFileSync(baselinePath, JSON.stringify(mutatedBaseline));
    const candidatePath = join(PACKAGE_ROOT, 'tests/eval/baselines/analyse-visual.repeat-01.report.json');
    const replicationPath = join(PACKAGE_ROOT, 'tests/eval/baselines/analyse-visual.baseline.v1.json');

    const controlProgram = createProgram();
    await controlProgram.parseAsync(
      ['node', 'cli', 'eval', 'verdict', '--baseline', baselinePath, '--candidate', candidatePath],
      { from: 'node' },
    );
    expect(logs.join('\n')).toMatch(/^Overall:/m);

    logs = [];
    errors = [];
    const program = createProgram();
    await program.parseAsync(
      [
        'node', 'cli', 'eval', 'verdict',
        '--baseline', baselinePath, '--candidate', candidatePath,
        '--replication', replicationPath,
      ],
      { from: 'node' },
    );

    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toMatch(/--replication/);
    expect(errors.join('\n')).toMatch(/modelId/);
    expect(logs.join('\n')).not.toMatch(/^Overall:/m);
  });

  it('a replication artifact for the other capability is refused', async () => {
    const baselinePath = join(PACKAGE_ROOT, 'tests/eval/baselines/generate-fix.repeat-01.report.json');
    const candidatePath = join(PACKAGE_ROOT, 'tests/eval/baselines/generate-fix.repeat-02.report.json');
    const replicationPath = join(PACKAGE_ROOT, 'tests/eval/baselines/analyse-visual.baseline.v1.json');

    const program = createProgram();
    await program.parseAsync(
      [
        'node', 'cli', 'eval', 'verdict',
        '--baseline', baselinePath, '--candidate', candidatePath,
        '--replication', replicationPath,
      ],
      { from: 'node' },
    );

    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toMatch(/capability/);
  });

  it('a synthetic replication artifact is refused as not a baseline', async () => {
    const gf = JSON.parse(
      readFileSync(join(PACKAGE_ROOT, 'tests/eval/baselines/generate-fix.baseline.v1.json'), 'utf-8'),
    ) as Record<string, unknown>;
    const { mode: _mode, runFunction: _runFunction, ...rest } = gf;
    const synthetic = { ...rest, _synthetic: true, syntheticNote: 'T8 scratch synthetic' };
    const replicationPath = join(dir, 't8-synthetic.json');
    writeFileSync(replicationPath, JSON.stringify(synthetic));

    const baselinePath = join(PACKAGE_ROOT, 'tests/eval/baselines/generate-fix.repeat-01.report.json');
    const candidatePath = join(PACKAGE_ROOT, 'tests/eval/baselines/generate-fix.repeat-02.report.json');

    const program = createProgram();
    await program.parseAsync(
      [
        'node', 'cli', 'eval', 'verdict',
        '--baseline', baselinePath, '--candidate', candidatePath,
        '--replication', replicationPath,
      ],
      { from: 'node' },
    );

    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toMatch(/not a baseline/);
    expect(logs.join('\n')).not.toMatch(/^Outcome:/m);
  });

  it('an unreadable or malformed replication file is refused with a clean error', async () => {
    const baselinePath = join(PACKAGE_ROOT, 'tests/eval/baselines/generate-fix.repeat-01.report.json');
    const candidatePath = join(PACKAGE_ROOT, 'tests/eval/baselines/generate-fix.repeat-02.report.json');

    const missingPath = join(dir, 'does-not-exist.json');
    const program1 = createProgram();
    await program1.parseAsync(
      [
        'node', 'cli', 'eval', 'verdict',
        '--baseline', baselinePath, '--candidate', candidatePath,
        '--replication', missingPath,
      ],
      { from: 'node' },
    );
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toMatch(/could not read --replication/);

    logs = [];
    errors = [];
    process.exitCode = undefined;
    const malformedPath = join(dir, 'malformed.json');
    writeFileSync(malformedPath, '{not json');
    const program2 = createProgram();
    await program2.parseAsync(
      [
        'node', 'cli', 'eval', 'verdict',
        '--baseline', baselinePath, '--candidate', candidatePath,
        '--replication', malformedPath,
      ],
      { from: 'node' },
    );
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toMatch(/--replication/);
    expect(errors.join('\n')).toMatch(/not valid JSON/);
  });

  it('generate-fix without the flag stays not-yet-measured with no licence qualifier line', async () => {
    const baselinePath = join(PACKAGE_ROOT, 'tests/eval/baselines/generate-fix.repeat-01.report.json');
    const candidatePath = join(PACKAGE_ROOT, 'tests/eval/baselines/generate-fix.repeat-02.report.json');
    const outPath = join(dir, 't10-verdict.json');

    const program = createProgram();
    await program.parseAsync(
      ['node', 'cli', 'eval', 'verdict', '--baseline', baselinePath, '--candidate', candidatePath, '--out', outPath],
      { from: 'node' },
    );

    const output = logs.join('\n');
    expect(output).toMatch(/^Outcome: PASS$/m);
    expect(output).toMatch(/^Non-inferiority clause run-to-run instability: not-yet-measured$/m);
    expect(output).not.toMatch(/^Licence qualifier:/m);

    const verdict = parseVerdict(readFileSync(outPath, 'utf-8'));
    expect(verdict.licenceQualifier.state).toBe('not-yet-measured');
  });

  it('analyse-visual without the flag stays not-yet-measured with no licence qualifier line', async () => {
    const baselinePath = join(PACKAGE_ROOT, 'tests/eval/baselines/analyse-visual.repeat-02.report.json');
    const candidatePath = join(PACKAGE_ROOT, 'tests/eval/baselines/analyse-visual.repeat-01.report.json');
    const outPath = join(dir, 't11-verdict.json');

    const program = createProgram();
    await program.parseAsync(
      ['node', 'cli', 'eval', 'verdict', '--baseline', baselinePath, '--candidate', candidatePath, '--out', outPath],
      { from: 'node' },
    );

    const output = logs.join('\n');
    expect(output).toMatch(/^Overall: PASS$/m);
    expect(output).toMatch(/^Non-inferiority clause run-to-run instability: not-yet-measured$/m);
    expect(output).not.toMatch(/^Licence qualifier:/m);

    const verdict = parseAnalyseVisualVerdict(readFileSync(outPath, 'utf-8'));
    expect(verdict.licenceQualifier.state).toBe('not-yet-measured');
  });

  it('generate-fix replication path prints the no-flag label set plus only the licence qualifier', async () => {
    const baselinePath = join(PACKAGE_ROOT, 'tests/eval/baselines/generate-fix.repeat-01.report.json');
    const candidatePath = join(PACKAGE_ROOT, 'tests/eval/baselines/generate-fix.repeat-02.report.json');
    const replicationPath = join(PACKAGE_ROOT, 'tests/eval/baselines/generate-fix.baseline.v1.json');

    const withProgram = createProgram();
    await withProgram.parseAsync(
      [
        'node', 'cli', 'eval', 'verdict',
        '--baseline', baselinePath, '--candidate', candidatePath,
        '--replication', replicationPath,
      ],
      { from: 'node' },
    );
    const withLabels = extractLabels(logs.join('\n'));

    logs = [];
    errors = [];
    const withoutProgram = createProgram();
    await withoutProgram.parseAsync(
      ['node', 'cli', 'eval', 'verdict', '--baseline', baselinePath, '--candidate', candidatePath],
      { from: 'node' },
    );
    const withoutLabels = extractLabels(logs.join('\n'));

    expect(withLabels).toEqual(new Set([...withoutLabels, 'Licence qualifier']));
    expect(withLabels.size).toBe(withoutLabels.size + 1);
  });

  it('analyse-visual replication path prints the no-flag label set plus only the licence qualifier', async () => {
    const baselinePath = join(PACKAGE_ROOT, 'tests/eval/baselines/analyse-visual.repeat-02.report.json');
    const candidatePath = join(PACKAGE_ROOT, 'tests/eval/baselines/analyse-visual.repeat-01.report.json');
    const replicationPath = join(PACKAGE_ROOT, 'tests/eval/baselines/analyse-visual.baseline.v1.json');

    const withProgram = createProgram();
    await withProgram.parseAsync(
      [
        'node', 'cli', 'eval', 'verdict',
        '--baseline', baselinePath, '--candidate', candidatePath,
        '--replication', replicationPath,
      ],
      { from: 'node' },
    );
    const withLabels = extractLabels(logs.join('\n'));

    logs = [];
    errors = [];
    const withoutProgram = createProgram();
    await withoutProgram.parseAsync(
      ['node', 'cli', 'eval', 'verdict', '--baseline', baselinePath, '--candidate', candidatePath],
      { from: 'node' },
    );
    const withoutLabels = extractLabels(logs.join('\n'));

    expect(withLabels).toEqual(new Set([...withoutLabels, 'Licence qualifier']));
    expect(withLabels.size).toBe(withoutLabels.size + 1);
  });
});
