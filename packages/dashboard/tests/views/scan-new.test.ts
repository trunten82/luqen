import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import handlebars from 'handlebars';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const VIEWS_DIR = join(__dirname, '..', '..', 'src', 'views');

// Register the minimal helpers used by scan-new.hbs so we can compile it in isolation.
beforeAll(async () => {
  const { loadTranslations, t: translateKey } = await import(
    '../../src/i18n/index.js'
  );
  loadTranslations();

  if (!handlebars.helpers['eq']) {
    handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);
  }
  if (!handlebars.helpers['t']) {
    handlebars.registerHelper('t', function (
      key: string,
      options: {
        hash?: Record<string, unknown>;
        data?: { root?: { locale?: string } };
      },
    ) {
      const locale = (options?.data?.root?.locale ?? 'en') as 'en';
      const params: Record<string, string> = {};
      if (options?.hash) {
        for (const [k, v] of Object.entries(options.hash)) params[k] = String(v);
      }
      return translateKey(key, locale, params);
    });
  }
});

function renderScanNew(context: Record<string, unknown>): string {
  const source = readFileSync(join(VIEWS_DIR, 'scan-new.hbs'), 'utf8');
  const template = handlebars.compile(source);
  return template(context);
}

describe('scan-new.hbs template', () => {
  const baseContext = {
    csrfToken: 'test-token',
    maxPages: 50,
    maxConcurrency: 4,
    defaultConcurrency: 2,
    defaultStandard: 'WCAG2AA',
    defaultRunner: 'htmlcs',
    standards: ['WCAG2A', 'WCAG2AA', 'WCAG2AAA'],
    jurisdictions: [
      { id: 'EU', name: 'European Union' },
      { id: 'US-FED', name: 'United States (Federal)' },
    ],
    regulations: [
      {
        id: 'ADA',
        name: 'Americans with Disabilities Act',
        shortName: 'ADA',
        jurisdictionId: 'US-FED',
      },
      {
        id: 'EAA',
        name: 'European Accessibility Act',
        shortName: 'EAA',
        jurisdictionId: 'EU',
      },
    ],
    locale: 'en',
  };

  it('renders exactly one regulations checkbox per regulation with name="regulations" and value=regulation.id', () => {
    const html = renderScanNew(baseContext);

    const adaMatches = html.match(/name="regulations"\s+value="ADA"/g) ?? [];
    expect(adaMatches.length).toBe(1);

    const eaaMatches = html.match(/name="regulations"\s+value="EAA"/g) ?? [];
    expect(eaaMatches.length).toBe(1);
  });

  it('renders exactly one jurisdictions checkbox per jurisdiction', () => {
    const html = renderScanNew(baseContext);

    const euMatches = html.match(/name="jurisdictions"\s+value="EU"/g) ?? [];
    expect(euMatches.length).toBe(1);

    const usFedMatches =
      html.match(/name="jurisdictions"\s+value="US-FED"/g) ?? [];
    expect(usFedMatches.length).toBe(1);
  });

  it('does NOT render the old bug (regulations submitting jurisdictionId as name="jurisdictions")', () => {
    const html = renderScanNew(baseContext);

    // The previous buggy line produced <input name="jurisdictions" value="US-FED"> or "EU"
    // inside the regulations loop. After the fix, US-FED and EU appear exactly once each
    // (the jurisdiction checkbox), never the duplicate from the regulation loop.
    const allJurisdictionCheckboxes =
      html.match(/name="jurisdictions"\s+value="[^"]+"/g) ?? [];
    expect(allJurisdictionCheckboxes.length).toBe(2);
  });

  it('tags picker items with data-type for visual differentiation', () => {
    const html = renderScanNew(baseContext);
    expect(html).toContain('data-type="jurisdiction"');
    expect(html).toContain('data-type="regulation"');
  });
});
