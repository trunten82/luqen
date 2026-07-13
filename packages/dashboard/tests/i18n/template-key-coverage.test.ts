/**
 * Template i18n key coverage gate.
 *
 * Regression for the branding-mode page shipping with 23 unresolved
 * `admin.org.brandingMode.*` keys (raw key ids rendered to users). t()
 * falls back to the key itself when a key is missing from EVERY locale,
 * so nothing failed at runtime — this test makes that a build-time error.
 *
 * Every `{{t "some.key"}}` in any .hbs view must resolve in the English
 * dictionary (English is the fallback for all locales, so en coverage is
 * the invariant that guarantees no raw ids are ever shown).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTranslations, getLocaleData } from '../../src/i18n/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VIEWS_DIR = join(__dirname, '../../src/views');

function collectHbsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectHbsFiles(full));
    } else if (entry.endsWith('.hbs')) {
      out.push(full);
    }
  }
  return out;
}

describe('i18n template key coverage', () => {
  beforeAll(() => {
    loadTranslations();
  });

  it('every {{t "key"}} used in a view resolves in the English dictionary', () => {
    const en = getLocaleData('en');
    const missing: string[] = [];
    for (const file of collectHbsFiles(VIEWS_DIR)) {
      const source = readFileSync(file, 'utf-8');
      // Static keys only: {{t "..."}} / {{t '...'}} (dynamic keys can't be
      // statically verified and are not used in views today).
      const keys = [...source.matchAll(/\{\{t ["']([^"']+)["']/g)].map((m) => m[1]);
      for (const key of new Set(keys)) {
        if (en[key] === undefined) {
          missing.push(`${relative(VIEWS_DIR, file)}: ${key}`);
        }
      }
    }
    expect(missing, `Missing i18n keys (would render as raw ids):\n${missing.join('\n')}`).toEqual([]);
  });
});
