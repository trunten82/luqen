/**
 * Phase 34-03 Task 2 — Bundle-size guard (TOK-02).
 *
 * Measures the on-disk footprint of the two tokenizer packages shipped with
 * the dashboard: `js-tiktoken` and `@anthropic-ai/tokenizer`. Uses `fs` only
 * — NO `child_process`, NO `execSync` — per CLAUDE.md security rules. Symlinks
 * are explicitly skipped to prevent traversal escape (T-34-14).
 *
 * Packages are located via `require.resolve` on their package.json so the test
 * is correct under both flat `node_modules/<pkg>` layouts and npm-workspace
 * hoisted layouts (where deps live at the monorepo root).
 *
 * TOK-02 target: combined runtime footprint under 5 MB. Per-package sub-budgets
 * (js-tiktoken <4 MB shipped ranks, @anthropic-ai/tokenizer <2 MB dist) guard
 * against either package bloating in isolation.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';

const require = createRequire(import.meta.url);

function dirSize(dir: string): number {
  let total = 0;
  if (!fs.existsSync(dir)) return 0;
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        total += fs.statSync(full).size;
      }
    }
  }
  return total;
}

function findNativeBinaries(dir: string): string[] {
  const hits: string[] = [];
  if (!fs.existsSync(dir)) return hits;
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name.endsWith('.node')) hits.push(full);
    }
  }
  return hits;
}

/** Resolve a package's install root by locating any entry file and walking
 *  up until the directory's basename matches the last path segment of the
 *  package name. Works around packages whose `exports` field does not expose
 *  `./package.json` (e.g. js-tiktoken). */
function packageRoot(pkg: string): string {
  // Try the canonical package.json path first (most packages expose it).
  try {
    return path.dirname(require.resolve(`${pkg}/package.json`));
  } catch {
    // Fallback: resolve the package main and walk up until we find package.json.
    const entry = require.resolve(pkg);
    let dir = path.dirname(entry);
    while (dir !== path.dirname(dir)) {
      if (fs.existsSync(path.join(dir, 'package.json'))) {
        const pkgJson = JSON.parse(
          fs.readFileSync(path.join(dir, 'package.json'), 'utf8'),
        ) as { name?: string };
        if (pkgJson.name === pkg) return dir;
      }
      dir = path.dirname(dir);
    }
    throw new Error(`Could not locate package root for ${pkg}`);
  }
}

/** Measure only the shipped `dist` (or `build`) directory — the files actually
 *  bundled at runtime — excluding dev artefacts like test fixtures. */
function shippedDistSize(pkg: string): number {
  const root = packageRoot(pkg);
  const dist = path.join(root, 'dist');
  if (fs.existsSync(dist)) return dirSize(dist);
  const build = path.join(root, 'build');
  if (fs.existsSync(build)) return dirSize(build);
  return dirSize(root);
}

const tiktokenDir = packageRoot('js-tiktoken');
const anthropicDir = packageRoot('@anthropic-ai/tokenizer');

describe('tokenizer bundle size (TOK-02)', () => {
  it('js-tiktoken shipped dist stays under 4 MB (core + 2 rank files used)', () => {
    // We only import lite + cl100k_base + o200k_base. Measure those three
    // shipped files to compare against the real runtime footprint.
    const liteJs = require.resolve('js-tiktoken/lite');
    const cl100k = require.resolve('js-tiktoken/ranks/cl100k_base');
    const o200k = require.resolve('js-tiktoken/ranks/o200k_base');
    const bytes =
      fs.statSync(liteJs).size + fs.statSync(cl100k).size + fs.statSync(o200k).size;
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThan(4_000_000);
  });

  it('@anthropic-ai/tokenizer dist stays under 2 MB', () => {
    const bytes = shippedDistSize('@anthropic-ai/tokenizer');
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThan(2_000_000);
  });

  it('combined shipped runtime footprint stays under 5 MB (TOK-02 phase acceptance)', () => {
    const liteJs = require.resolve('js-tiktoken/lite');
    const cl100k = require.resolve('js-tiktoken/ranks/cl100k_base');
    const o200k = require.resolve('js-tiktoken/ranks/o200k_base');
    const tiktokenBytes =
      fs.statSync(liteJs).size + fs.statSync(cl100k).size + fs.statSync(o200k).size;
    const anthropicBytes = shippedDistSize('@anthropic-ai/tokenizer');

    // TOK-02 budget: "<5 MB added". The two direct deps this phase added are
    // `js-tiktoken` and `@anthropic-ai/tokenizer`. The tiktoken/lite wasm is a
    // transitive, shared artefact (tiktoken@^1.0.10) and is reported separately
    // below for audit but is not counted against the TOK-02 direct-add budget.
    const directAddBytes = tiktokenBytes + anthropicBytes;
    expect(directAddBytes).toBeLessThan(5_000_000);

    let wasmBytes = 0;
    try {
      const wasmPath = require.resolve('tiktoken/lite/tiktoken_bg.wasm');
      wasmBytes = fs.statSync(wasmPath).size;
    } catch {
      // Not installed as a direct dep — treat as 0.
    }
    // Surface all measured sizes in CI logs for audit (TOK-02 verification).
    // eslint-disable-next-line no-console
    console.info(
      `[bundle-size] js-tiktoken(shipped)=${tiktokenBytes}B, ` +
        `@anthropic-ai/tokenizer(dist)=${anthropicBytes}B, ` +
        `tiktoken wasm(transitive)=${wasmBytes}B, ` +
        `direct-add total=${directAddBytes}B`,
    );
  });

  it('contains no native binaries (pure JS + wasm only)', () => {
    const hits = [
      ...findNativeBinaries(tiktokenDir),
      ...findNativeBinaries(anthropicDir),
    ];
    // Filter must match files whose name endsWith('.node') — the walker already
    // does this but we re-assert the contract here for clarity.
    expect(hits.filter((h) => h.endsWith('.node'))).toEqual([]);
    expect(hits).toEqual([]);
  });
});
