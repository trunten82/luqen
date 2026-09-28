/**
 * PBH-B Task 3 — OPS-9: `rekey-at-rest` wired through the REAL CLI process
 * (not the in-process `runRekeyCommand` call the rest of rekey-command.test.ts
 * uses). Proves cli.ts's commander wiring, option parsing, and process exit
 * code actually work end-to-end.
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedAtRestFixture } from './seed.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/dashboard/tests/at-rest -> packages/dashboard
const DASHBOARD_ROOT = resolvePath(__dirname, '..', '..');
// packages/dashboard -> packages -> repo root
const REPO_ROOT = resolvePath(DASHBOARD_ROOT, '..', '..');

function resolveTsxBin(): string {
  const candidates = [
    resolvePath(DASHBOARD_ROOT, 'node_modules', '.bin', 'tsx'),
    resolvePath(REPO_ROOT, 'node_modules', '.bin', 'tsx'),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (found === undefined) {
    throw new Error(`tsx binary not found in any of: ${candidates.join(', ')}`);
  }
  return found;
}

function runCli(
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolveRun, rejectRun) => {
    const tsxBin = resolveTsxBin();
    const cliEntry = resolvePath(DASHBOARD_ROOT, 'src', 'cli.ts');
    const child = spawn(tsxBin, [cliEntry, ...args], {
      cwd: DASHBOARD_ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (c: Buffer) => {
      stdout += String(c);
    });
    child.stderr?.on('data', (c: Buffer) => {
      stderr += String(c);
    });
    child.on('close', (code) => resolveRun({ stdout, stderr, code }));
    child.on('error', rejectRun);
  });
}

describe('rekey-at-rest CLI wiring (PBH-B Task 3, OPS-9)', () => {
  it('OPS-9: real process, env NAMES -> exit 0 with per-store count lines', async () => {
    const seeded = await seedAtRestFixture();
    seeded.db.close();

    const { stdout, stderr, code } = await runCli(
      [
        'rekey-at-rest',
        '--db-path', seeded.dbPath,
        '--plugins-dir', seeded.pluginsDir,
        '--old-key-env', 'REKEY_SMOKE_OLD',
        '--new-key-env', 'REKEY_SMOKE_NEW',
      ],
      {
        ...process.env,
        REKEY_SMOKE_OLD: seeded.key,
        REKEY_SMOKE_NEW: `${seeded.key}-new-smoke-key-with-enough-length`,
      },
    );

    expect(code, `stdout:\n${stdout}\nstderr:\n${stderr}`).toBe(0);
    expect(stdout).toContain('oauth-signing-keys');
    expect(stdout).toContain('service-connections');
    expect(stdout).toContain('git-credentials');
    expect(stdout).toContain('plugin-configs');
    expect(stdout).not.toContain(seeded.key);
  }, 90_000);

  it('OPS-9: --help lists every documented option', async () => {
    const { stdout, code } = await runCli(['rekey-at-rest', '--help'], process.env);

    expect(code).toBe(0);
    expect(stdout).toContain('--old-key-env');
    expect(stdout).toContain('--new-key-env');
    expect(stdout).toContain('--apply');
    expect(stdout).toContain('--dry-run');
    expect(stdout).toContain('--rollback');
    expect(stdout).toContain('--db-path');
    expect(stdout).toContain('--config');
    expect(stdout).toContain('--plugins-dir');
  }, 90_000);
});
