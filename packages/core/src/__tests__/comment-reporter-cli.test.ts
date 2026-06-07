/**
 * Tests for comment-reporter-cli.ts — CLI entry point that reads a BaselineDiff
 * JSON and prints the GitHub PR comment body to stdout.
 *
 * Tests use execFileSync/spawnSync to invoke the built CLI or import the module
 * directly (via the TypeScript source via vitest's transform), writing sample
 * diff files to tmp to exercise the file-in/stdout-out path.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// Sample diff fixtures
// ---------------------------------------------------------------------------

const sampleFinding = {
  fingerprint: 'abc1234567890123',
  normalizedPath: '/about',
  code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
  type: 'error',
  selector: '#main img.hero',
  message: 'Missing alt attribute',
};

const findingsDiff = {
  newFindings: [sampleFinding],
  fixedFindings: [],
  unchanged: [],
};

const cleanDiff = {
  newFindings: [],
  fixedFindings: [],
  unchanged: [],
};

const infraErrorDiff = {
  newFindings: [],
  fixedFindings: [],
  unchanged: [],
  infraError: true,
};

// ---------------------------------------------------------------------------
// Setup: write fixture files to tmp
// ---------------------------------------------------------------------------

let findingsDiffPath: string;
let cleanDiffPath: string;
let infraErrorDiffPath: string;

beforeAll(() => {
  const tmpDir = join(tmpdir(), `luqen-cli-test-${process.pid}`);
  mkdirSync(tmpDir, { recursive: true });

  findingsDiffPath = join(tmpDir, 'findings-diff.json');
  cleanDiffPath = join(tmpDir, 'clean-diff.json');
  infraErrorDiffPath = join(tmpDir, 'infra-error-diff.json');

  writeFileSync(findingsDiffPath, JSON.stringify(findingsDiff, null, 2), 'utf-8');
  writeFileSync(cleanDiffPath, JSON.stringify(cleanDiff, null, 2), 'utf-8');
  writeFileSync(infraErrorDiffPath, JSON.stringify(infraErrorDiff, null, 2), 'utf-8');
});

// ---------------------------------------------------------------------------
// Helper: run the CLI via ts-node / vitest module loader
// We test via direct module import to avoid needing a compiled dist.
// ---------------------------------------------------------------------------

/**
 * Import the CLI module and capture what it would write to stdout.
 * We stub process.argv and process.stdout.write, run the module's
 * exported runCli() function if available, or import it as a side-effect
 * (for main-guard pattern).
 */
async function runCliModule(diffJsonPath: string, enrichmentPath?: string): Promise<string> {
  const chunks: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  // Capture stdout writes
  const originalArgv = process.argv;

  try {
    process.argv = ['node', 'comment-reporter-cli.js', diffJsonPath, ...(enrichmentPath ? [enrichmentPath] : [])];
    process.stdout.write = (chunk: string | Uint8Array, ...rest: unknown[]) => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'));
      // Call the original but suppress actual output during tests
      return true;
    };

    // Import with cache-busting query to allow re-imports in the same process
    const mod = await import(`../../comment-reporter-cli.js?t=${Date.now()}`);
    if (mod && typeof mod.runCli === 'function') {
      await mod.runCli(diffJsonPath, enrichmentPath);
    }
  } finally {
    process.stdout.write = originalWrite;
    process.argv = originalArgv;
  }

  return chunks.join('');
}

// ---------------------------------------------------------------------------
// Tests: via spawnSync against the TypeScript source using tsx
// ---------------------------------------------------------------------------

/**
 * Run the CLI via tsx (TypeScript runner) and capture stdout.
 */
function runCliViaTsx(diffJsonPath: string, enrichmentPath?: string): {
  stdout: string;
  stderr: string;
  status: number | null;
} {
  const args = [
    'packages/core/src/comment-reporter-cli.ts',
    diffJsonPath,
    ...(enrichmentPath ? [enrichmentPath] : []),
  ];

  const result = spawnSync('npx', ['tsx', ...args], {
    cwd: '/root/luqen/.claude/worktrees/agent-adba7cae886b9b2bd',
    encoding: 'utf-8',
    timeout: 30_000,
  });

  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('comment-reporter-cli', () => {
  describe('findings-present diff', () => {
    it('produces non-empty body from a findings diff', () => {
      const result = runCliViaTsx(findingsDiffPath);
      expect(result.status).toBe(0);
      expect(result.stdout.length).toBeGreaterThan(0);
    });

    it('body starts with <!-- luqen-gate -->', () => {
      const result = runCliViaTsx(findingsDiffPath);
      expect(result.stdout.trimStart().split('\n')[0]).toBe('<!-- luqen-gate -->');
    });

    it('body contains the disclaimer', () => {
      const result = runCliViaTsx(findingsDiffPath);
      expect(result.stdout).toContain('Not legal advice.');
      expect(result.stdout).toContain('does not assert conformance');
    });
  });

  describe('clean diff', () => {
    it('produces non-empty body from a clean diff', () => {
      const result = runCliViaTsx(cleanDiffPath);
      expect(result.status).toBe(0);
      expect(result.stdout.length).toBeGreaterThan(0);
    });

    it('body starts with <!-- luqen-gate -->', () => {
      const result = runCliViaTsx(cleanDiffPath);
      expect(result.stdout.trimStart().split('\n')[0]).toBe('<!-- luqen-gate -->');
    });

    it('body contains the disclaimer', () => {
      const result = runCliViaTsx(cleanDiffPath);
      expect(result.stdout).toContain('Not legal advice.');
    });
  });

  describe('infra-error diff', () => {
    it('produces non-empty body from an infra-error diff', () => {
      const result = runCliViaTsx(infraErrorDiffPath);
      expect(result.status).toBe(0);
      expect(result.stdout.length).toBeGreaterThan(0);
    });

    it('body starts with <!-- luqen-gate -->', () => {
      const result = runCliViaTsx(infraErrorDiffPath);
      expect(result.stdout.trimStart().split('\n')[0]).toBe('<!-- luqen-gate -->');
    });

    it('body contains the disclaimer in infra-error variant', () => {
      const result = runCliViaTsx(infraErrorDiffPath);
      expect(result.stdout).toContain('Not legal advice.');
    });

    it('infra-error body does not assert clean run', () => {
      const result = runCliViaTsx(infraErrorDiffPath);
      expect(result.stdout).not.toContain('No new findings vs baseline.');
    });
  });

  describe('error handling', () => {
    it('exits 0 and emits degraded body on invalid JSON path (no raw stack trace to stdout)', () => {
      const result = runCliViaTsx('/nonexistent/path/to/diff.json');
      // Should exit 0 with a degraded body, not throw a raw error
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('<!-- luqen-gate -->');
      expect(result.stdout).toContain('Not legal advice.');
    });
  });
});
