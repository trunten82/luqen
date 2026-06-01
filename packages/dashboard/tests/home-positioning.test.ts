/**
 * Phase 78 (POS-02) — the authenticated dashboard landing must carry the
 * genuine-remediation / anti-overlay positioning, linking to the comparison
 * surface. Renders the real home.hbs with the real `t` (en.json) + `eq`
 * helpers (no login needed) and asserts the positioning line + link.
 */
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import HandlebarsLib from 'handlebars';

const __dirname = resolve(fileURLToPath(new URL('.', import.meta.url)));

async function renderHome(): Promise<string> {
  const hb = HandlebarsLib.create();
  const en = JSON.parse(await readFile(join(__dirname, '..', 'src', 'i18n', 'locales', 'en.json'), 'utf8'));
  hb.registerHelper('t', (key: string) =>
    String(key).split('.').reduce((o: unknown, k) => (o as Record<string, unknown> | undefined)?.[k], en) ?? key,
  );
  hb.registerHelper('eq', (a: unknown, b: unknown) => a === b);
  const tpl = hb.compile(await readFile(join(__dirname, '..', 'src', 'views', 'home.hbs'), 'utf8'));
  return tpl({
    stats: { complianceRate: 100, sitesMonitored: 0, pagesScanned: 0, scansThisWeek: 0, issuesFound: 0, trendDirection: 'flat' },
    perm: { scansCreate: true },
    recentScans: [],
  });
}

describe('dashboard landing — anti-overlay positioning (Phase 78 POS-02)', () => {
  it('renders the genuine-remediation positioning line', async () => {
    const html = await renderHome();
    expect(html).toContain('not an overlay');
    expect(html).toContain('docket__rail-positioning');
  });

  it('links to the why-not-an-overlay comparison surface', async () => {
    const html = await renderHome();
    expect(html).toContain('docs/why-not-an-overlay.md');
    expect(html).toContain('Why that matters');
  });
});
