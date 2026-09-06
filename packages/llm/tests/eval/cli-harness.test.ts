/**
 * `luqen-llm eval` CLI tests (Phase 84, HARNESS-01/HARNESS-02/HARNESS-04).
 *
 * Only `providers/registry.js`'s `createAdapter` is mocked here — the same
 * technique 84-01's non-leak guard uses (tests/capabilities/
 * raw-response-seam.test.ts) — so a live-mode invocation proves the CLI
 * hands `executeGenerateFix`/`executeAnalyseVisual` the REAL production
 * adapter factory, without this test file ever dialling a real provider.
 * No live model call is made anywhere in this file.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../../src/providers/registry.js', () => ({
  createAdapter: vi.fn(),
  getSupportedTypes: vi.fn(() => ['ollama']),
}));

import { createAdapter } from '../../src/providers/registry.js';
import { createProgram } from '../../src/cli.js';
import type { LLMProviderAdapter, CompletionResult } from '../../src/providers/types.js';

const mockCreateAdapter = vi.mocked(createAdapter);

function stubAdapterReturning(text: string): LLMProviderAdapter {
  return {
    type: 'fixture',
    connect: async () => {},
    disconnect: async () => {},
    healthCheck: async () => true,
    listModels: async () => [],
    complete: async (): Promise<CompletionResult> => ({
      text,
      usage: { inputTokens: 1, outputTokens: 1 },
    }),
  };
}

describe('luqen-llm eval CLI', () => {
  let logs: string[];
  let errors: string[];
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitCodeBefore: number | string | undefined;

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
    mockCreateAdapter.mockReset();
    delete process.env.EVAL_HARNESS_API_KEY;
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    process.exitCode = exitCodeBefore;
    delete process.env.EVAL_HARNESS_API_KEY;
  });

  it('exposes an eval command group with run and compare subcommands, and no --db option anywhere in the group', () => {
    const program = createProgram();
    const evalCmd = program.commands.find((c) => c.name() === 'eval');
    expect(evalCmd).toBeDefined();
    const subcommands = evalCmd!.commands.map((c) => c.name());
    expect(subcommands).toContain('run');
    expect(subcommands).toContain('compare');

    // T-84-10: the eval command group exposes NO database-path option
    // anywhere — the run database is always in memory, nothing to mistype.
    for (const sub of evalCmd!.commands) {
      const optionFlags = sub.options.map((o) => o.long);
      expect(optionFlags).not.toContain('--db');
    }
  });

  it('rejects a capability outside the two durable ones with a clear message, before the runner ever starts', async () => {
    const program = createProgram();
    await program.parseAsync(
      ['node', 'cli', 'eval', 'run', '--capability', 'extract-requirements'],
      { from: 'node' },
    );
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toMatch(/--capability must be one of/);
  });

  it('defaults to replay mode and completes with no provider credentials present in the environment', async () => {
    expect(process.env.EVAL_HARNESS_API_KEY).toBeUndefined();
    const program = createProgram();
    await program.parseAsync(
      ['node', 'cli', 'eval', 'run', '--capability', 'generate-fix'],
      { from: 'node' },
    );
    expect(process.exitCode).toBeUndefined();
    expect(mockCreateAdapter).not.toHaveBeenCalled();
    expect(logs.join('\n')).toMatch(/Mode: replay/);
  });

  it('rejects live mode when the spend-acknowledgement flag is omitted, before any adapter is built', async () => {
    const program = createProgram();
    await program.parseAsync(
      [
        'node', 'cli', 'eval', 'run',
        '--capability', 'generate-fix',
        '--mode', 'live',
        '--provider-type', 'ollama',
        '--endpoint', 'http://eval-harness-test.invalid',
        '--model-id', 'test-model',
      ],
      { from: 'node' },
    );
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toMatch(/--i-acknowledge-spend/);
    expect(mockCreateAdapter).not.toHaveBeenCalled();
  });

  it('rejects live mode when the credential environment variable is unset, before any network call is attempted', async () => {
    expect(process.env.EVAL_HARNESS_API_KEY).toBeUndefined();
    const program = createProgram();
    await program.parseAsync(
      [
        'node', 'cli', 'eval', 'run',
        '--capability', 'generate-fix',
        '--mode', 'live',
        '--provider-type', 'ollama',
        '--endpoint', 'http://eval-harness-test.invalid',
        '--model-id', 'test-model',
        '--i-acknowledge-spend',
      ],
      { from: 'node' },
    );
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toMatch(/EVAL_HARNESS_API_KEY environment variable/);
    expect(mockCreateAdapter).not.toHaveBeenCalled();
  });

  it('live mode, once fully authorised, hands the REAL createAdapter (providers/registry.ts) to the capability function — never a re-implemented dialing path', async () => {
    process.env.EVAL_HARNESS_API_KEY = 'sentinel-test-key-never-dialled';
    mockCreateAdapter.mockImplementation(() => stubAdapterReturning('not-json-response'));

    const program = createProgram();
    await program.parseAsync(
      [
        'node', 'cli', 'eval', 'run',
        '--capability', 'generate-fix',
        '--mode', 'live',
        '--provider-type', 'ollama',
        '--endpoint', 'http://eval-harness-test.invalid',
        '--model-id', 'test-model',
        '--i-acknowledge-spend',
      ],
      { from: 'node' },
    );

    expect(process.exitCode).toBeUndefined();
    expect(mockCreateAdapter).toHaveBeenCalledWith('ollama');
    expect(logs.join('\n')).toMatch(/Mode: live/);
  });

  it('printed summary shows false-PASS and false-ISSUE as two separate lines for analyse-visual (anti-fusion, CLI layer)', async () => {
    const program = createProgram();
    await program.parseAsync(
      ['node', 'cli', 'eval', 'run', '--capability', 'analyse-visual'],
      { from: 'node' },
    );
    expect(process.exitCode).toBeUndefined();
    const output = logs.join('\n');
    expect(output).toMatch(/^False-PASS: \d+\/\d+$/m);
    expect(output).toMatch(/^False-ISSUE: \d+\/\d+$/m);
    // Never a single fused figure standing in for both.
    expect(output).not.toMatch(/accuracy/i);
  });

  it('writes a valid JSON report to --out and prints it is comparable to itself', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'luqen-eval-cli-test-'));
    const outPath = join(dir, 'report.json');
    try {
      const program = createProgram();
      await program.parseAsync(
        ['node', 'cli', 'eval', 'run', '--capability', 'generate-fix', '--out', outPath],
        { from: 'node' },
      );
      expect(existsSync(outPath)).toBe(true);
      const parsed = JSON.parse(readFileSync(outPath, 'utf-8')) as { runFunction: unknown };
      expect(parsed.runFunction).toBeDefined();

      logs.length = 0;
      const compareProgram = createProgram();
      await compareProgram.parseAsync(
        ['node', 'cli', 'eval', 'compare', '--a', outPath, '--b', outPath],
        { from: 'node' },
      );
      expect(process.exitCode).toBeUndefined();
      expect(logs.join('\n')).toMatch(/comparable/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('compare refuses two reports whose run functions differ, naming the differing fields', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'luqen-eval-cli-test-'));
    const pathA = join(dir, 'a.json');
    const pathB = join(dir, 'b.json');
    try {
      const program = createProgram();
      await program.parseAsync(
        ['node', 'cli', 'eval', 'run', '--capability', 'generate-fix', '--out', pathA],
        { from: 'node' },
      );
      await program.parseAsync(
        ['node', 'cli', 'eval', 'run', '--capability', 'analyse-visual', '--out', pathB],
        { from: 'node' },
      );

      logs.length = 0;
      errors.length = 0;
      const compareProgram = createProgram();
      await compareProgram.parseAsync(
        ['node', 'cli', 'eval', 'compare', '--a', pathA, '--b', pathB],
        { from: 'node' },
      );
      expect(process.exitCode).toBe(1);
      expect(errors.join('\n')).toMatch(/not comparable/);
      expect(errors.join('\n')).toMatch(/capability/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('compare accepts two reports differing only by timestamp', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'luqen-eval-cli-test-'));
    const pathA = join(dir, 'a.json');
    const pathB = join(dir, 'b.json');
    try {
      const program = createProgram();
      await program.parseAsync(
        ['node', 'cli', 'eval', 'run', '--capability', 'generate-fix', '--out', pathA],
        { from: 'node' },
      );
      const rawA = JSON.parse(readFileSync(pathA, 'utf-8')) as { runFunction: { timestamp: string } };
      const rawB = JSON.parse(JSON.stringify(rawA)) as typeof rawA;
      rawB.runFunction.timestamp = '2099-01-01T00:00:00.000Z';
      writeFileSync(pathB, JSON.stringify(rawB));

      logs.length = 0;
      const compareProgram = createProgram();
      await compareProgram.parseAsync(
        ['node', 'cli', 'eval', 'compare', '--a', pathA, '--b', pathB],
        { from: 'node' },
      );
      expect(process.exitCode).toBeUndefined();
      expect(logs.join('\n')).toMatch(/comparable/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
