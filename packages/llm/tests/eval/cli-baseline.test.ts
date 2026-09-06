/**
 * `luqen-llm eval baseline` CLI tests (Phase 86 Task 2, BASELINE-01/02,
 * T-86-12). A SECOND path to a live provider call -- `eval run`'s wall
 * (proven credential-free in cli-harness.test.ts) is NOT inherited by
 * writing a new command, so it is re-proven here independently, including
 * with `EVAL_HARNESS_API_KEY` unset.
 *
 * Only `providers/registry.js`'s `createAdapter` is mocked -- the same
 * technique `cli-harness.test.ts` uses -- so a live-mode invocation proves
 * this command hands the REAL production adapter factory to the capability
 * function, without this test file ever dialling a real provider. No live
 * model call is made anywhere in this file.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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

describe('luqen-llm eval baseline CLI', () => {
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

  it('exposes a baseline subcommand under eval, with no --db option anywhere in its option list', () => {
    const program = createProgram();
    const evalCmd = program.commands.find((c) => c.name() === 'eval');
    expect(evalCmd).toBeDefined();
    const baselineCmd = evalCmd!.commands.find((c) => c.name() === 'baseline');
    expect(baselineCmd).toBeDefined();

    const optionFlags = baselineCmd!.options.map((o) => o.long);
    expect(optionFlags).not.toContain('--db');
  });

  it('defaults to replay mode, runs the reference set 3 times, and completes with no provider credentials present in the environment', async () => {
    expect(process.env.EVAL_HARNESS_API_KEY).toBeUndefined();
    const program = createProgram();
    await program.parseAsync(
      ['node', 'cli', 'eval', 'baseline', '--capability', 'generate-fix'],
      { from: 'node' },
    );
    expect(process.exitCode).toBeUndefined();
    expect(mockCreateAdapter).not.toHaveBeenCalled();
    const output = logs.join('\n');
    expect(output).toMatch(/^Mode: replay$/m);
    expect(output).toMatch(/^Repeats: 3$/m);
  });

  it('rejects --repeats below 2, naming the minimum, before any run starts', async () => {
    const program = createProgram();
    await program.parseAsync(
      ['node', 'cli', 'eval', 'baseline', '--capability', 'generate-fix', '--repeats', '1'],
      { from: 'node' },
    );
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toMatch(/--repeats must be an integer >= 2/);
  });

  it('rejects live mode when the spend-acknowledgement flag is omitted, before any adapter is built', async () => {
    const program = createProgram();
    await program.parseAsync(
      [
        'node', 'cli', 'eval', 'baseline',
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

  it('rejects live mode when the credential environment variable is unset, before any network call is attempted -- a credential-free test of the credential gate', async () => {
    expect(process.env.EVAL_HARNESS_API_KEY).toBeUndefined();
    const program = createProgram();
    await program.parseAsync(
      [
        'node', 'cli', 'eval', 'baseline',
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

  it('live mode, once fully authorised, hands the REAL createAdapter (providers/registry.ts) to the capability function -- never a re-implemented dialing path', async () => {
    process.env.EVAL_HARNESS_API_KEY = 'sentinel-test-key-never-dialled';
    mockCreateAdapter.mockImplementation(() => stubAdapterReturning('not-json-response'));

    const program = createProgram();
    await program.parseAsync(
      [
        'node', 'cli', 'eval', 'baseline',
        '--capability', 'generate-fix',
        '--repeats', '2',
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
    expect(logs.join('\n')).toMatch(/^Mode: live$/m);
  });

  it('replay mode: the printed summary states the instability of a replay replication is zero by construction, and reports instability 0 for a real replay run', async () => {
    const program = createProgram();
    await program.parseAsync(
      ['node', 'cli', 'eval', 'baseline', '--capability', 'generate-fix'],
      { from: 'node' },
    );
    expect(process.exitCode).toBeUndefined();
    const output = logs.join('\n');
    expect(output).toMatch(
      /^Replay note: a replay replication's run-to-run instability is zero by construction and is not a measurement of a model\.$/m,
    );
    // The committed replay fixture is deterministic -- three identical
    // repeats through the SAME fixture adapter measure exactly 0.
    expect(output).toMatch(/^Run-to-run instability: measured \(0\)$/m);
  });

  it('live mode does NOT print the replay note', async () => {
    process.env.EVAL_HARNESS_API_KEY = 'sentinel-test-key-never-dialled';
    mockCreateAdapter.mockImplementation(() => stubAdapterReturning('not-json-response'));

    const program = createProgram();
    await program.parseAsync(
      [
        'node', 'cli', 'eval', 'baseline',
        '--capability', 'generate-fix',
        '--repeats', '2',
        '--mode', 'live',
        '--provider-type', 'ollama',
        '--endpoint', 'http://eval-harness-test.invalid',
        '--model-id', 'test-model',
        '--i-acknowledge-spend',
      ],
      { from: 'node' },
    );
    expect(logs.join('\n')).not.toMatch(/Replay note/);
  });

  it('writes per-repeat reports to --out-dir and the replication artifact to --out, matching the printed summary', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'luqen-eval-baseline-cli-test-'));
    const outPath = join(dir, 'artifact.json');
    const outDir = join(dir, 'repeats');
    try {
      const program = createProgram();
      await program.parseAsync(
        [
          'node', 'cli', 'eval', 'baseline',
          '--capability', 'generate-fix',
          '--repeats', '2',
          '--out-dir', outDir,
          '--out', outPath,
        ],
        { from: 'node' },
      );
      expect(process.exitCode).toBeUndefined();
      expect(existsSync(join(outDir, 'repeat-0.json'))).toBe(true);
      expect(existsSync(join(outDir, 'repeat-1.json'))).toBe(true);
      expect(existsSync(outPath)).toBe(true);
      const parsed = JSON.parse(readFileSync(outPath, 'utf-8')) as Record<string, unknown>;
      expect(parsed['_synthetic']).toBe(true);
      expect(parsed['runFunction']).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('analyse-visual is supported through the identical command, gating on verdictOutcome', async () => {
    const program = createProgram();
    await program.parseAsync(
      ['node', 'cli', 'eval', 'baseline', '--capability', 'analyse-visual'],
      { from: 'node' },
    );
    expect(process.exitCode).toBeUndefined();
    expect(logs.join('\n')).toMatch(/^Capability: analyse-visual$/m);
  });

  // -------------------------------------------------------------------
  // POSITIVE KEY-SET PIN on the printed baseline summary's labelled lines
  // (Phase 86 Task 2) -- not a blocklist. Fails on ANY new label added,
  // matching the discipline `cli-harness.test.ts`/`cli-verdict.test.ts`
  // already established for their own printed summaries.
  // -------------------------------------------------------------------
  it('prints EXACTLY the pinned set of labelled lines for the replay-mode summary', async () => {
    const program = createProgram();
    await program.parseAsync(
      ['node', 'cli', 'eval', 'baseline', '--capability', 'generate-fix'],
      { from: 'node' },
    );
    const output = logs.join('\n');
    const labels = output
      .split('\n')
      .map((l) => l.match(/^([A-Z][^:]*):\s/))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map((m) => m[1]);
    expect(new Set(labels)).toEqual(new Set([
      'Capability',
      'Mode',
      'Repeats',
      'Run-to-run instability',
      'Sample-size assumption survives',
      'Sample-size assumption check',
      'Replay note',
    ]));
  });
});
