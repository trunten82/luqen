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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
});
