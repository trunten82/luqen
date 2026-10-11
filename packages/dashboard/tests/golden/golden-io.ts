/**
 * Golden capture / compare helper (Phase 88, D-20a).
 *
 * goldenCheck(file, surface, value) serialises `value` (after the documented
 * scrub) and compares it as an exact STRING with the entry stored under
 * `surface` in tests/golden/baseline/<file>.json.
 *
 * Capture mode (GOLDEN_CAPTURE=1) only ever ADDS a surface that is missing from
 * the baseline file. It NEVER overwrites an existing entry: an existing entry
 * is compared as usual. A red golden is a finding, never a baseline refresh (P9).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';

const BASELINE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'baseline');

/**
 * Keys whose VALUE is environment-dependent, replaced by '<volatile:KEY>' at any
 * depth. Every entry carries the reason it is volatile.
 */
export const VOLATILE_KEYS: Readonly<Record<string, string>> = {
  createdAtDisplay: 'Date.prototype.toLocaleString(): depends on the process locale (LANG) and TZ',
  completedAtDisplay: 'Date.prototype.toLocaleString(): depends on the process locale (LANG) and TZ',
};

export function scrubVolatile(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubVolatile);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = Object.prototype.hasOwnProperty.call(VOLATILE_KEYS, k) ? `<volatile:${k}>` : scrubVolatile(v);
    }
    return out;
  }
  return value;
}

/**
 * Exact-literal replacements applied to the serialised text, for values that
 * are random per run (org ids, the tmp reports dir) or locale-formatted inside
 * an HTML/text string where a key-name scrub cannot reach.
 */
export type Literals = Readonly<Record<string, string>>;

function applyLiterals(text: string, literals: Literals): string {
  let out = text;
  for (const literal of Object.keys(literals).sort((a, b) => b.length - a.length)) {
    if (literal === '') throw new Error('goldenCheck: empty literal');
    out = out.split(literal).join(literals[literal]);
  }
  return out;
}

function serialise(value: unknown, literals: Literals): string {
  const text = JSON.stringify(scrubVolatile(value), null, 2);
  if (text === undefined) throw new Error('goldenCheck: value is not JSON-serialisable');
  return applyLiterals(text, literals);
}

function baselinePath(fileName: string): string {
  return join(BASELINE_DIR, `${fileName}.json`);
}

function readBaseline(fileName: string): Record<string, unknown> {
  const path = baselinePath(fileName);
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
}

function writeBaseline(fileName: string, content: Record<string, unknown>): void {
  mkdirSync(BASELINE_DIR, { recursive: true });
  const path = baselinePath(fileName);
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(content, null, 2)}\n`, 'utf-8');
  renameSync(tmp, path);
}

export function goldenCheck(
  fileName: string,
  surface: string,
  value: unknown,
  literals: Literals = {},
): void {
  const produced = serialise(value, literals);
  const baseline = readBaseline(fileName);
  const has = Object.prototype.hasOwnProperty.call(baseline, surface);

  if (!has) {
    if (process.env['GOLDEN_CAPTURE'] === '1') {
      writeBaseline(fileName, { ...baseline, [surface]: JSON.parse(produced) });
      return;
    }
    throw new Error(`no baseline for ${surface}: capture it before wiring`);
  }

  const stored = JSON.stringify(baseline[surface], null, 2);
  expect(produced, `golden "${surface}" differs from the pre-wiring baseline`).toBe(stored);
}
