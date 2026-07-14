/**
 * Template handlebars-helper coverage gate.
 *
 * Regression for `Missing helper: "concat"`: rpt-exposure-card.hbs (Phase 81)
 * shipped using a `concat` subexpression that was never registered on the
 * server handlebars instance. The partial only renders when a scan has a
 * banded legal exposure, so it 500'd the report-detail page in production
 * weeks after shipping. Same latent bug existed for `lt` in the digest risk
 * table.
 *
 * This test extracts every helper invocation from every .hbs view — block
 * helpers, inline helpers called with arguments, and subexpressions — and
 * asserts each one is either a handlebars builtin or registered somewhere in
 * src/ via registerHelper('name').
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(__dirname, '../../src');
const VIEWS_DIR = join(SRC_DIR, 'views');

const BUILTINS = new Set([
  'if', 'unless', 'each', 'with', 'lookup', 'log', 'else', 'this',
]);

function collectFiles(dir: string, ext: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectFiles(full, ext));
    } else if (entry.endsWith(ext)) {
      out.push(full);
    }
  }
  return out;
}

/** Helper names registered anywhere in src via registerHelper('name'). */
function registeredHelpers(): Set<string> {
  const names = new Set<string>();
  for (const file of collectFiles(SRC_DIR, '.ts')) {
    const source = readFileSync(file, 'utf-8');
    for (const m of source.matchAll(/registerHelper\(\s*['"]([^'"]+)['"]/g)) {
      names.add(m[1]);
    }
  }
  return names;
}

/** Helper names invoked (with arguments) in a template's mustaches. */
function helpersUsed(source: string): Set<string> {
  const used = new Set<string>();
  // Strip handlebars comments first: {{!-- ... --}} and {{! ... }}
  const stripped = source
    .replace(/\{\{!--[\s\S]*?--\}\}/g, '')
    .replace(/\{\{![\s\S]*?\}\}/g, '');

  for (const m of stripped.matchAll(/\{\{\{?([^{}]+)\}?\}\}/g)) {
    const content = m[1].trim();
    // Skip partials, closers, inverse sections
    if (/^[>/^]/.test(content)) continue;

    // Subexpressions: (helperName arg...)
    for (const sub of content.matchAll(/\(\s*([A-Za-z][\w-]*)[\s)]/g)) {
      used.add(sub[1]);
    }

    // Top-level invocation: first token, only when called WITH arguments
    // (a bare {{variable}} resolves as a path, never as helperMissing).
    const body = content.replace(/^[#~]+/, '').trim();
    const tokens = body.split(/\s+/);
    if (tokens.length < 2) continue;
    const name = tokens[0];
    if (/^[A-Za-z][\w-]*$/.test(name)) {
      used.add(name);
    }
  }
  used.delete('else');
  return used;
}

describe('handlebars template helper coverage', () => {
  it('every helper invoked in a view is registered or a builtin', () => {
    const registered = registeredHelpers();
    const missing: string[] = [];

    for (const file of collectFiles(VIEWS_DIR, '.hbs')) {
      const source = readFileSync(file, 'utf-8');
      for (const name of helpersUsed(source)) {
        if (!BUILTINS.has(name) && !registered.has(name)) {
          missing.push(`${relative(VIEWS_DIR, file)}: ${name}`);
        }
      }
    }

    expect(
      missing,
      `Helpers used in templates but never registered (render as 500 "Missing helper"):\n${missing.join('\n')}`,
    ).toEqual([]);
  });
});
