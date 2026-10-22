/**
 * TEAM-02 (D-08): a registered Handlebars helper wins over a context value of the same name, so a
 * view that prints `{{limit}}` bare renders EMPTY when a helper named `limit` is registered (the
 * Audit Log Load More link then carried `limit=`). This static guard fails when any registered
 * helper name is printed bare, as `{{name}}` or `{{{name}}}`, in a view. Block openers (`{{#name}}`),
 * partials, closers, comments and expressions with arguments, dots or paths are not bare prints.
 *
 * Companion of template-helper-coverage.test.ts (every helper a view CALLS is registered); this one
 * covers the opposite direction (no registered helper shadows a value a view PRINTS).
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../src');
const VIEWS_DIR = join(SRC_DIR, 'views');

function collect(dir: string, ext: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collect(full, ext));
    else if (entry.endsWith(ext)) out.push(full);
  }
  return out;
}

function registeredHelpers(): Set<string> {
  const names = new Set<string>();
  for (const file of collect(SRC_DIR, '.ts')) {
    for (const m of readFileSync(file, 'utf-8').matchAll(/registerHelper\(\s*['"]([^'"]+)['"]/g)) {
      names.add(m[1] as string);
    }
  }
  return names;
}

/** Bare prints in a template: `{{name}}` and `{{{name}}}` with one identifier and nothing else. */
function barePrints(source: string): Set<string> {
  const stripped = source
    .replace(/\{\{!--[\s\S]*?--\}\}/g, '')
    .replace(/\{\{![\s\S]*?\}\}/g, '');
  const names = new Set<string>();
  for (const m of stripped.matchAll(/\{\{\{?\s*([A-Za-z_][\w-]*)\s*\}?\}\}/g)) names.add(m[1] as string);
  return names;
}

describe('helper names versus printed values', () => {
  it('TEAM-02 no registered template helper shares its name with a value a view prints bare', () => {
    const helpers = registeredHelpers();
    const filesByName = new Map<string, string[]>();
    const bareNames = new Set<string>();
    for (const file of collect(VIEWS_DIR, '.hbs')) {
      for (const name of barePrints(readFileSync(file, 'utf-8'))) {
        bareNames.add(name);
        if (helpers.has(name)) filesByName.set(name, [...(filesByName.get(name) ?? []), relative(VIEWS_DIR, file)]);
      }
    }
    // Positive controls: the scans found a real set of helpers and bare prints, so a scan that
    // matches nothing cannot pass.
    expect(helpers.size).toBeGreaterThanOrEqual(30);
    expect(bareNames.size).toBeGreaterThanOrEqual(200);
    const collisions = [...filesByName.entries()].map(([name, files]) => `${name}: ${files.sort().join(', ')}`);
    expect(collisions, 'a helper name is printed bare in a view; rename the helper').toEqual([]);
  });
});
