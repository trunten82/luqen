/**
 * HARD-14 — the RBAC matrix generator's own startup and its refusals.
 *
 * The generator (scripts/generate-rbac-matrix.ts) reads the scan create permission from its
 * definition and refuses a scan-guard call it cannot place in a route registration. Neither
 * refusal was exercised by any test: when the constant moved to another file the generator
 * crashed and only the CI drift job would have noticed. These tests run the real generator
 * as a child process against a throwaway copy of the source tree made of symbolic links, so
 * a test can remove the constant or add an orphan call without touching the working tree and
 * without writing to docs/reference/rbac-matrix.md.
 *
 * Child processes are used here and not in matrix-coverage.test.ts, whose header promises
 * node:fs and node:path only.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../../../..');
const TSX_CLI = join(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs');
const GENERATOR = join(REPO_ROOT, 'scripts/generate-rbac-matrix.ts');
const LIFECYCLE = 'packages/dashboard/src/services/scan-lifecycle.ts';
const CONSTANT_LINE = "export const SCAN_CREATE_PERMISSION = 'scans.create';";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** Link every entry of `from` into `to`, except the names in `except`. */
function linkEntries(from: string, to: string, except: readonly string[] = []): void {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from)) {
    if (except.includes(entry)) continue;
    symlinkSync(join(from, entry), join(to, entry));
  }
}

interface TreeOptions {
  /** Replace the lifecycle file by a copy with its permission constant renamed. */
  readonly withoutConstant?: boolean;
  /** Add a route-directory file that calls a scan guard outside any registration. */
  readonly withOrphanCall?: boolean;
}

/** A throwaway repo root whose source files are links to the real ones, minus the requested edits. */
function buildTree(options: TreeOptions = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'rbac-generator-'));
  roots.push(root);
  const realPackages = join(REPO_ROOT, 'packages');
  const packages = join(root, 'packages');
  linkEntries(realPackages, packages, ['dashboard']);

  const realSrc = join(realPackages, 'dashboard/src');
  const src = join(packages, 'dashboard/src');
  linkEntries(realSrc, src, ['services', 'routes']);

  const services = join(src, 'services');
  linkEntries(join(realSrc, 'services'), services, ['scan-lifecycle.ts']);
  const lifecycle = readFileSync(join(REPO_ROOT, LIFECYCLE), 'utf8');
  expect(lifecycle, 'the real lifecycle file must still declare the constant on one line').toContain(
    CONSTANT_LINE,
  );
  writeFileSync(
    join(services, 'scan-lifecycle.ts'),
    options.withoutConstant === true
      ? lifecycle.replace(CONSTANT_LINE, "export const RENAMED_PERMISSION = 'scans.create';")
      : lifecycle,
  );

  const routes = join(src, 'routes');
  linkEntries(join(realSrc, 'routes'), routes);
  if (options.withOrphanCall === true) {
    writeFileSync(
      join(routes, 'zz-orphan-guard-call.ts'),
      [
        'export function orphan(service: { retryScanAuthorized(id: string): void }): void {',
        "  service.retryScanAuthorized('example');",
        '}',
        '',
      ].join('\n'),
    );
  }
  return root;
}

function runGenerator(root: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [TSX_CLI, GENERATOR], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120_000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('RBAC matrix generator startup', () => {
  it('HARD-14 rbac generator finds the scan create permission and writes the matrix', () => {
    const root = buildTree();
    const run = runGenerator(root);
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);

    const written = join(root, 'docs/reference/rbac-matrix.md');
    expect(existsSync(written)).toBe(true);
    const matrix = readFileSync(written, 'utf8');
    // The permission literal was read from its definition: the scan form row carries it.
    expect(matrix).toContain(
      '| scans.create | POST /scan/new | dashboard-page | packages/dashboard/src/routes/scan.ts |',
    );
    // The throwaway tree produces the committed matrix byte for byte.
    expect(matrix).toBe(readFileSync(join(REPO_ROOT, 'docs/reference/rbac-matrix.md'), 'utf8'));
  }, 120_000);

  it('HARD-14 rbac generator stops loudly when the scan create permission cannot be found', () => {
    const root = buildTree({ withoutConstant: true });
    const run = runGenerator(root);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('cannot find the SCAN_CREATE_PERMISSION');
    expect(existsSync(join(root, 'docs/reference/rbac-matrix.md'))).toBe(false);
  }, 120_000);

  it('HARD-14 rbac generator stops loudly on a scan guard call outside a route registration', () => {
    const root = buildTree({ withOrphanCall: true });
    const run = runGenerator(root);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('fall inside a server.METHOD(...) route region');
    expect(run.stderr).toContain('zz-orphan-guard-call.ts');
    expect(existsSync(join(root, 'docs/reference/rbac-matrix.md'))).toBe(false);
  }, 120_000);
});
