/**
 * Phase 40 Plan 02 Task 3 — RBAC matrix coverage test (DOC-07).
 *
 * Walks packages/dashboard/src/routes/ recursively, extracts every permission
 * name passed to `requirePermission(...)`, and asserts each one appears as a
 * literal substring in docs/reference/rbac-matrix.md.
 *
 * Security note: uses ONLY `node:fs` and `node:path`. No subprocess imports,
 * no shell invocation, no glob libraries.
 *
 * Failure mode: if this test goes RED, the matrix generator
 * (scripts/generate-rbac-matrix.ts) is missing routes — fix the generator,
 * not this test, and not the source files.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../../../..');
const ROUTES_DIR = join(REPO_ROOT, 'packages/dashboard/src/routes');
const MATRIX_PATH = join(REPO_ROOT, 'docs/reference/rbac-matrix.md');

function walkTs(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '__tests__' || entry === 'tests') continue;
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      out.push(...walkTs(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

function extractPermissions(): Set<string> {
  const perms = new Set<string>();
  const callRe = /requirePermission\(([^)]*)\)/g;
  const argRe = /['"]([a-z0-9._-]+)['"]/gi;
  for (const file of walkTs(ROUTES_DIR)) {
    const src = readFileSync(file, 'utf8');
    let m: RegExpExecArray | null;
    while ((m = callRe.exec(src)) !== null) {
      const args = m[1] ?? '';
      let am: RegExpExecArray | null;
      while ((am = argRe.exec(args)) !== null) {
        perms.add(am[1]!);
      }
    }
  }
  return perms;
}

describe('RBAC matrix coverage', () => {
  it('contains every permission name used in dashboard requirePermission callsites', () => {
    const matrix = readFileSync(MATRIX_PATH, 'utf8');
    const perms = extractPermissions();

    // Sanity: at least some permissions found — guards against a broken walker.
    expect(perms.size).toBeGreaterThan(5);

    const missing: string[] = [];
    for (const perm of perms) {
      if (!matrix.includes(perm)) {
        missing.push(perm);
      }
    }
    expect(missing).toEqual([]);
  });
});
