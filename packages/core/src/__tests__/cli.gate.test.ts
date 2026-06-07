/**
 * CLI gate integration tests.
 *
 * These tests verify the gate exit-code contract by:
 * 1. Testing the exported runGateAction helper (pure logic, no real scan)
 * 2. Verifying the built CLI help output includes the new flags
 * 3. Testing path-traversal rejection at the CLI call site (T-79-03)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fingerprint, normalizePath, writeBaseline, type BaselineFinding, type BaselineFile } from '../baseline/baseline.js';
import { diffBaseline, computeGateExitCode } from '../baseline/diff.js';
import { runGateAction, type GateActionOptions } from '../cli.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBaselineFinding(
  url: string,
  code: string,
  selector: string,
  type: BaselineFinding['type'] = 'error',
  message = 'Test issue',
): BaselineFinding {
  const normalizedP = normalizePath(url);
  return {
    fingerprint: fingerprint(normalizedP, code, selector),
    normalizedPath: normalizedP,
    code,
    type,
    selector,
    message,
  };
}

function makeBaselineFile(findings: BaselineFinding[], target = 'https://example.com'): BaselineFile {
  return {
    meta: {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      generatedBy: 'luqen scan --update-baseline',
      target,
    },
    findings,
  };
}

// ---------------------------------------------------------------------------
// Gate logic (via runGateAction helper + baseline/diff utilities)
// ---------------------------------------------------------------------------

describe('gate: --update-baseline round-trip', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'luqen-gate-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('writes a baseline file with the provided findings, exits 0', async () => {
    const baselinePath = join(tmpDir, '.luqen', 'baseline.json');
    const findings: BaselineFinding[] = [
      makeBaselineFinding('https://example.com/about', 'WCAG2AA.H37', 'img'),
    ];

    const result = await runGateAction({
      updateBaseline: true,
      baselinePath,
      currentFindings: findings,
      targetUrl: 'https://example.com',
    });

    expect(result.exitCode).toBe(0);
    // Verify the file was written
    const raw = await readFile(baselinePath, 'utf-8');
    const stored = JSON.parse(raw) as BaselineFile;
    expect(stored.meta.schemaVersion).toBe(1);
    expect(stored.findings).toHaveLength(1);
  });
});

describe('gate: --fail-on=new exit codes', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'luqen-gate-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('exits 0 when current findings == baseline (no new findings)', async () => {
    const baselinePath = join(tmpDir, 'baseline.json');
    const findings: BaselineFinding[] = [
      makeBaselineFinding('https://example.com/about', 'WCAG2AA.H37', 'img'),
    ];
    await writeBaseline(baselinePath, makeBaselineFile(findings));

    const result = await runGateAction({
      updateBaseline: false,
      baselinePath,
      currentFindings: findings,
      failOn: 'new',
      targetUrl: 'https://example.com',
    });

    expect(result.exitCode).toBe(0);
  });

  it('exits 1 when one new finding is introduced vs baseline (--fail-on=new)', async () => {
    const baselinePath = join(tmpDir, 'baseline.json');
    const baseline: BaselineFinding[] = [
      makeBaselineFinding('https://example.com/about', 'WCAG2AA.H37', 'img'),
    ];
    await writeBaseline(baselinePath, makeBaselineFile(baseline));

    const current: BaselineFinding[] = [
      ...baseline,
      makeBaselineFinding('https://example.com/about', 'WCAG2AA.H44', 'input', 'error', 'Missing label'),
    ];

    const result = await runGateAction({
      updateBaseline: false,
      baselinePath,
      currentFindings: current,
      failOn: 'new',
      targetUrl: 'https://example.com',
    });

    expect(result.exitCode).toBe(1);
  });

  it('exits 0 with --fail-on=none even when new findings exist', async () => {
    const baselinePath = join(tmpDir, 'baseline.json');
    await writeBaseline(baselinePath, makeBaselineFile([]));

    const current: BaselineFinding[] = [
      makeBaselineFinding('https://example.com/', 'WCAG2AA.H37', 'img'),
    ];

    const result = await runGateAction({
      updateBaseline: false,
      baselinePath,
      currentFindings: current,
      failOn: 'none',
      targetUrl: 'https://example.com',
    });

    expect(result.exitCode).toBe(0);
  });
});

describe('gate: missing/unreadable baseline → exit 2', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'luqen-gate-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('exits 2 when baseline file does not exist (--fail-on=new, non-update gate run)', async () => {
    const result = await runGateAction({
      updateBaseline: false,
      baselinePath: join(tmpDir, 'nonexistent.json'),
      currentFindings: [],
      failOn: 'new',
      targetUrl: 'https://example.com',
    });

    expect(result.exitCode).toBe(2);
    // The clean-run line must NOT appear on an infra-error branch (D-17, T-79-04)
    expect(result.summary).not.toContain('No new findings vs baseline.');
  });

  it('exits 2 for a --baseline=../escape path (T-79-03 call-site coverage)', async () => {
    const result = await runGateAction({
      updateBaseline: false,
      baselinePath: '../escape.json',
      currentFindings: [],
      failOn: 'new',
      targetUrl: 'https://example.com',
    });

    expect(result.exitCode).toBe(2);
  });
});

describe('gate: --gate-output writes BaselineDiff JSON', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'luqen-gate-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('writes a JSON file with newFindings/fixedFindings/unchanged arrays', async () => {
    const baselinePath = join(tmpDir, 'baseline.json');
    const gateOutputPath = join(tmpDir, 'gate-output.json');
    await writeBaseline(baselinePath, makeBaselineFile([]));

    const current: BaselineFinding[] = [
      makeBaselineFinding('https://example.com/', 'WCAG2AA.H37', 'img'),
    ];

    await runGateAction({
      updateBaseline: false,
      baselinePath,
      currentFindings: current,
      failOn: 'new',
      gateOutputPath,
      targetUrl: 'https://example.com',
    });

    const raw = await readFile(gateOutputPath, 'utf-8');
    const output = JSON.parse(raw) as Record<string, unknown>;
    expect(Array.isArray(output.newFindings)).toBe(true);
    expect(Array.isArray(output.fixedFindings)).toBe(true);
    expect(Array.isArray(output.unchanged)).toBe(true);
  });

  it('writes infraError:true marker on infra-error branch', async () => {
    const gateOutputPath = join(tmpDir, 'gate-error-output.json');

    await runGateAction({
      updateBaseline: false,
      baselinePath: join(tmpDir, 'nonexistent.json'),
      currentFindings: [],
      failOn: 'new',
      gateOutputPath,
      targetUrl: 'https://example.com',
    });

    const raw = await readFile(gateOutputPath, 'utf-8');
    const output = JSON.parse(raw) as Record<string, unknown>;
    expect(output.infraError).toBe(true);
    expect(Array.isArray(output.newFindings)).toBe(true);
    expect((output.newFindings as unknown[]).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// CLI --help option check (verifies the built program has the new flags)
// ---------------------------------------------------------------------------

describe('CLI program: scan command has gate options', () => {
  it('scan command includes --fail-on option', async () => {
    const { program } = await import('../cli.js');
    const scan = program.commands.find((c) => c.name() === 'scan');
    expect(scan).toBeDefined();
    const optionNames = scan!.options.map((o) => o.long);
    expect(optionNames).toContain('--fail-on');
  });

  it('scan command includes --min-severity option', async () => {
    const { program } = await import('../cli.js');
    const scan = program.commands.find((c) => c.name() === 'scan');
    const optionNames = scan!.options.map((o) => o.long);
    expect(optionNames).toContain('--min-severity');
  });

  it('scan command includes --baseline option', async () => {
    const { program } = await import('../cli.js');
    const scan = program.commands.find((c) => c.name() === 'scan');
    const optionNames = scan!.options.map((o) => o.long);
    expect(optionNames).toContain('--baseline');
  });

  it('scan command includes --update-baseline option', async () => {
    const { program } = await import('../cli.js');
    const scan = program.commands.find((c) => c.name() === 'scan');
    const optionNames = scan!.options.map((o) => o.long);
    expect(optionNames).toContain('--update-baseline');
  });

  it('scan command includes --gate-output option', async () => {
    const { program } = await import('../cli.js');
    const scan = program.commands.find((c) => c.name() === 'scan');
    const optionNames = scan!.options.map((o) => o.long);
    expect(optionNames).toContain('--gate-output');
  });
});
