import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import handlebars from 'handlebars';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const VIEWS_DIR = join(__dirname, '..', '..', 'src', 'views');

let translateKey: (key: string, locale: string, params?: Record<string, string>) => string;

beforeAll(async () => {
  const i18n = await import('../../src/i18n/index.js');
  i18n.loadTranslations();
  translateKey = i18n.t;

  if (!handlebars.helpers['t']) {
    handlebars.registerHelper('t', function (
      key: string,
      options: { hash?: Record<string, unknown>; data?: { root?: { locale?: string } } },
    ) {
      const locale = (options?.data?.root?.locale ?? 'en') as string;
      const params: Record<string, string> = {};
      if (options?.hash) {
        for (const [k, v] of Object.entries(options.hash)) params[k] = String(v);
      }
      return translateKey(key, locale, params);
    });
  }
  if (!handlebars.helpers['eq']) {
    handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);
  }
  if (!handlebars.helpers['formatStandard']) {
    handlebars.registerHelper('formatStandard', (value: unknown) => String(value ?? ''));
  }
});

function renderScanProgress(scan: Record<string, unknown>, locale = 'en'): string {
  const source = readFileSync(join(VIEWS_DIR, 'scan-progress.hbs'), 'utf8');
  const template = handlebars.compile(source);
  return template({ scan, locale });
}

describe('scan-progress.hbs — discovery-blocked banner (WAF-SURFACE-1)', () => {
  it('progress page shows the warning for a completed flagged scan', () => {
    const html = renderScanProgress({
      id: 'scan-1',
      status: 'completed',
      pagesScanned: 1,
      discoveryWarning: 'waf-blocked',
    });
    const match = html.match(/<div\s+id="discovery-blocked"[^>]*>([\s\S]*?)<\/div>/);
    expect(match).toBeTruthy();
    const openTag = html.match(/<div\s+id="discovery-blocked"[^>]*>/)![0];
    expect(openTag).not.toContain('is-hidden');
    expect(match![1]).toContain('Scanned 1 page(s); site discovery was blocked by bot protection');
  });

  it('progress page keeps the warning hidden for an unflagged scan', () => {
    const html = renderScanProgress({
      id: 'scan-2',
      status: 'completed',
      pagesScanned: 1,
    });
    const openTag = html.match(/<div\s+id="discovery-blocked"[^>]*>/);
    expect(openTag).toBeTruthy();
    expect(openTag![0]).toContain('is-hidden');
    const match = html.match(/<div\s+id="discovery-blocked"[^>]*>([\s\S]*?)<\/div>/);
    expect(match![1]).not.toContain('Scanned 1 page');
  });

  it('live template holds the untranslated count placeholder in an attribute', () => {
    const html = renderScanProgress({
      id: 'scan-3',
      status: 'completed',
      pagesScanned: 1,
    });
    const placeholder = ['{{', 'pages', '}}'].join('');
    const openTag = html.match(/<div\s+id="discovery-blocked"[^>]*>/)![0];
    expect(openTag).toContain(`data-template="`);
    expect(openTag).toContain(placeholder);
  });

  it('complete listener reveals the warning from the event', () => {
    const html = renderScanProgress({
      id: 'scan-4',
      status: 'running',
      pagesScanned: 0,
    });
    expect(html).toContain('discoveryWarning');
    expect(html).toContain('data-template');
  });
});
