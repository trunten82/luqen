/**
 * `luqen-llm eval verdict` CLI tests (Phase 85, BARS-02/BARS-03, D-85-1,
 * D-85-7).
 *
 * The committed fixtures are envelopes, deliberately not report-shaped (see
 * `verdict-analyse-visual.test.ts`'s own doc comment). Every test here
 * writes the two bare report files it needs into a temporary directory from
 * an envelope's contents, runs the command, and lets the temp files
 * disappear with the test — no bare report file is committed by this plan.
 *
 * This module never dials a provider, spends money, or opens a network
 * connection anywhere — the structural test below pins that as a committed
 * assertion over the subcommand's own option list.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProgram } from '../../src/cli.js';
import type { AnalyseVisualReport, GenerateFixReport } from '../../src/eval/report.js';

const PACKAGE_ROOT = process.cwd();

interface GenerateFixEnvelope {
  readonly baseline: GenerateFixReport;
  readonly candidates: {
    readonly identical: GenerateFixReport;
    readonly regressedBeyondMargin: GenerateFixReport;
  };
}

interface AnalyseVisualEnvelope {
  readonly baseline: AnalyseVisualReport;
  readonly candidates: {
    readonly identical: AnalyseVisualReport;
    readonly regressedBeyondMargin: AnalyseVisualReport;
    readonly falsePassGateFails: AnalyseVisualReport;
  };
}

function loadGenerateFixEnvelope(): GenerateFixEnvelope {
  const path = join(PACKAGE_ROOT, 'tests', 'eval', 'fixtures', 'verdict', 'generate-fix-pair.synthetic.json');
  return JSON.parse(readFileSync(path, 'utf-8')) as unknown as GenerateFixEnvelope;
}

function loadAnalyseVisualEnvelope(): AnalyseVisualEnvelope {
  const path = join(PACKAGE_ROOT, 'tests', 'eval', 'fixtures', 'verdict', 'analyse-visual-pair.synthetic.json');
  return JSON.parse(readFileSync(path, 'utf-8')) as unknown as AnalyseVisualEnvelope;
}

describe('luqen-llm eval verdict CLI', () => {
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
    dir = mkdtempSync(join(tmpdir(), 'luqen-eval-verdict-cli-test-'));
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    process.exitCode = exitCodeBefore;
    rmSync(dir, { recursive: true, force: true });
  });

  function writeReport(name: string, report: unknown): string {
    const path = join(dir, name);
    writeFileSync(path, JSON.stringify(report));
    return path;
  }

  // ---------------------------------------------------------------------
  // Structural pin (D-85-7): the subcommand never reaches a provider.
  // ---------------------------------------------------------------------
  it('exposes a verdict subcommand under eval with EXACTLY --baseline/--candidate/--out -- no provider, endpoint, model, live-mode, spend or db option anywhere', () => {
    const program = createProgram();
    const evalCmd = program.commands.find((c) => c.name() === 'eval');
    expect(evalCmd).toBeDefined();
    const verdictCmd = evalCmd!.commands.find((c) => c.name() === 'verdict');
    expect(verdictCmd).toBeDefined();

    const optionFlags = verdictCmd!.options.map((o) => o.long);
    expect(new Set(optionFlags)).toEqual(new Set(['--baseline', '--candidate', '--out']));

    // Positive-set equality above already excludes every forbidden flag, but
    // name them explicitly too -- a reader should not have to infer the
    // absence from a Set diff (matches cli-harness.test.ts's convention).
    for (const forbidden of ['--provider-type', '--endpoint', '--model-id', '--i-acknowledge-spend', '--mode', '--db']) {
      expect(optionFlags).not.toContain(forbidden);
    }
  });

  // ---------------------------------------------------------------------
  // analyse-visual: both mechanisms always printed, overall never alone.
  // ---------------------------------------------------------------------
  it('analyse-visual PASS: prints BOTH clause outcomes with their licences and the derived overall word, exits 0', async () => {
    const envelope = loadAnalyseVisualEnvelope();
    const baselinePath = writeReport('baseline.json', envelope.baseline);
    const candidatePath = writeReport('candidate.json', envelope.candidates.identical);

    const program = createProgram();
    await program.parseAsync(
      ['node', 'cli', 'eval', 'verdict', '--baseline', baselinePath, '--candidate', candidatePath],
      { from: 'node' },
    );

    expect(process.exitCode).toBeUndefined();
    const output = logs.join('\n');
    expect(output).toMatch(/^Capability: analyse-visual$/m);
    expect(output).toMatch(/^False-PASS gate: PASS$/m);
    expect(output).toMatch(/^False-PASS gate licence: .+$/m);
    expect(output).toMatch(/^Non-inferiority clause: PASS$/m);
    expect(output).toMatch(/^Non-inferiority clause licence: .+$/m);
    expect(output).toMatch(/^Overall: PASS$/m);
    expect(output).toMatch(/^Overall note: .+$/m);
    expect(output).toMatch(/^Overall licence: .+$/m);

    // POSITIVE KEY-SET PIN on the PRINTED LINES (D-85-1 / BARS-02).
    // The toMatch assertions above prove every required line is PRESENT. That is
    // a strictly narrower predicate than "only these lines are printed", and the
    // gap is not hypothetical: with the assertions above alone, adding
    // `Overall confidence: 92%` — a single fused figure standing in for two
    // separately-reported clause results — left all 745 tests green. Verified by
    // breaking it. D-85-1 requires the two clause results never be collapsed into
    // one number, so pin the exact label set and fail on ANY addition, whatever
    // it is called. A blocklist (`not.toMatch(/confidence/i)`) is the wrong shape:
    // Phase 84 shipped one and a differently-named field sailed past it.
    const labels = output
      .split('\n')
      .map((l) => l.match(/^([A-Z][^:]*):\s/))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map((m) => m[1]);
    expect(new Set(labels)).toEqual(new Set([
      'Capability',
      'False-PASS gate',
      'False-PASS gate licence',
      'Non-inferiority clause',
      'Non-inferiority clause licence',
      'Non-inferiority clause power sufficient',
      'Overall',
      'Overall note',
      'Overall licence',
    ]));
  });

  it('analyse-visual FAIL (gate): a candidate that is PASS on the clause still FAILS overall when it clears one more real violation, exits non-zero', async () => {
    const envelope = loadAnalyseVisualEnvelope();
    const baselinePath = writeReport('baseline.json', envelope.baseline);
    const candidatePath = writeReport('candidate.json', envelope.candidates.falsePassGateFails);

    const program = createProgram();
    await program.parseAsync(
      ['node', 'cli', 'eval', 'verdict', '--baseline', baselinePath, '--candidate', candidatePath],
      { from: 'node' },
    );

    const output = logs.join('\n');
    // The clause is PASS...
    expect(output).toMatch(/^Non-inferiority clause: PASS$/m);
    // ...but the gate FAILED, and the overall word reflects that -- never the
    // clause's PASS alone, and never a silently-upgraded overall PASS.
    expect(output).toMatch(/^False-PASS gate: FAIL$/m);
    expect(output).toMatch(/^Overall: FAIL$/m);
    expect(process.exitCode).toBe(1);
  });

  it('analyse-visual FAIL (clause): overall FAIL, exits non-zero', async () => {
    const envelope = loadAnalyseVisualEnvelope();
    const baselinePath = writeReport('baseline.json', envelope.baseline);
    const candidatePath = writeReport('candidate.json', envelope.candidates.regressedBeyondMargin);

    const program = createProgram();
    await program.parseAsync(
      ['node', 'cli', 'eval', 'verdict', '--baseline', baselinePath, '--candidate', candidatePath],
      { from: 'node' },
    );

    const output = logs.join('\n');
    expect(output).toMatch(/^Non-inferiority clause: FAIL$/m);
    expect(output).toMatch(/^Overall: FAIL$/m);
    expect(process.exitCode).toBe(1);
  });

  // ---------------------------------------------------------------------
  // generate-fix: the single-clause capability, same command, dispatched by
  // the baseline report's own runFunction.capability field.
  // ---------------------------------------------------------------------
  it('generate-fix PASS: prints outcome, power assessment, and licence, exits 0', async () => {
    const envelope = loadGenerateFixEnvelope();
    const baselinePath = writeReport('baseline.json', envelope.baseline);
    const candidatePath = writeReport('candidate.json', envelope.candidates.identical);

    const program = createProgram();
    await program.parseAsync(
      ['node', 'cli', 'eval', 'verdict', '--baseline', baselinePath, '--candidate', candidatePath],
      { from: 'node' },
    );

    expect(process.exitCode).toBeUndefined();
    const output = logs.join('\n');
    expect(output).toMatch(/^Capability: generate-fix$/m);
    expect(output).toMatch(/^Outcome: PASS$/m);
    expect(output).toMatch(/^Non-inferiority clause power sufficient: true$/m);
    expect(output).toMatch(/^Licence: .+$/m);
  });

  it('generate-fix FAIL: exits non-zero', async () => {
    const envelope = loadGenerateFixEnvelope();
    const baselinePath = writeReport('baseline.json', envelope.baseline);
    const candidatePath = writeReport('candidate.json', envelope.candidates.regressedBeyondMargin);

    const program = createProgram();
    await program.parseAsync(
      ['node', 'cli', 'eval', 'verdict', '--baseline', baselinePath, '--candidate', candidatePath],
      { from: 'node' },
    );

    const output = logs.join('\n');
    expect(output).toMatch(/^Outcome: FAIL$/m);
    expect(process.exitCode).toBe(1);
  });

  // ---------------------------------------------------------------------
  // --out writes the full verdict; refusals surface as a clean error, not
  // a crash.
  // ---------------------------------------------------------------------
  it('--out writes the full JSON verdict, matching the printed outcome', async () => {
    const envelope = loadAnalyseVisualEnvelope();
    const baselinePath = writeReport('baseline.json', envelope.baseline);
    const candidatePath = writeReport('candidate.json', envelope.candidates.identical);
    const outPath = join(dir, 'verdict.json');

    const program = createProgram();
    await program.parseAsync(
      ['node', 'cli', 'eval', 'verdict', '--baseline', baselinePath, '--candidate', candidatePath, '--out', outPath],
      { from: 'node' },
    );

    expect(existsSync(outPath)).toBe(true);
    const written = JSON.parse(readFileSync(outPath, 'utf-8')) as { overallVerdict: { outcome: string } };
    expect(written.overallVerdict.outcome).toBe('PASS');
    expect(logs.join('\n')).toMatch(new RegExp(`^Verdict written to ${outPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  });

  it('refuses a bar/run mismatch with a clean error, not a crash -- e.g. a candidate whose set name does not match the bar', async () => {
    const envelope = loadAnalyseVisualEnvelope();
    const baseline = envelope.baseline;
    const candidate = structuredClone(envelope.candidates.identical) as { runFunction: { setName: string } };
    candidate.runFunction.setName = 'some-other-set';
    const baselinePath = writeReport('baseline.json', baseline);
    const candidatePath = writeReport('candidate.json', candidate);

    const program = createProgram();
    await program.parseAsync(
      ['node', 'cli', 'eval', 'verdict', '--baseline', baselinePath, '--candidate', candidatePath],
      { from: 'node' },
    );

    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toMatch(/error: /);
    expect(errors.join('\n')).toMatch(/refusing to apply/);
  });
});
