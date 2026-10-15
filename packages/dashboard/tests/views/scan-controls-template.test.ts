/**
 * HARD-14 (report page half) — report-detail.hbs offers Retry and Cancel only when the route
 * set `scanControls`. The template is compiled in an isolated Handlebars instance with the real
 * partials and the real `t`; the no-report-data branch is rendered for a failed, a running and a
 * queued scan.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Handlebars from 'handlebars';
import { collectPartials, dismissalRefused } from '../../src/server.js';
import { loadTranslations, t, type Locale } from '../../src/i18n/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const VIEWS_DIR = join(HERE, '..', '..', 'src', 'views');

const SCAN_ID = 'scan-fabrikam-1';
type Status = 'failed' | 'running' | 'queued';

let hb: typeof Handlebars;
let reportSource: string;

beforeAll(() => {
  loadTranslations();
  hb = Handlebars.create();
  hb.registerHelper('helperMissing', () => '');
  hb.registerHelper('eq', (a: unknown, b: unknown) => a === b);
  hb.registerHelper('issueAssignStatus', () => '');
  hb.registerHelper('fixSuggestion', () => '');
  hb.registerHelper('dismissalRefused', dismissalRefused);
  hb.registerHelper(
    't',
    function (key: string, options: { hash?: Record<string, unknown>; data?: { root?: { locale?: string } } }) {
      const locale = (options?.data?.root?.locale as Locale) ?? 'en';
      const params =
        options?.hash != null
          ? Object.fromEntries(Object.entries(options.hash).map(([k, v]) => [k, String(v ?? '')]))
          : undefined;
      return t(key, locale, params);
    },
  );
  for (const [name, rel] of Object.entries(collectPartials(VIEWS_DIR))) {
    hb.registerPartial(name, readFileSync(join(VIEWS_DIR, rel), 'utf8'));
  }
  reportSource = readFileSync(join(VIEWS_DIR, 'report-detail.hbs'), 'utf8');
});

function render(status: Status, withControls: boolean): string {
  const template = hb.compile(reportSource);
  return template({
    scan: {
      id: SCAN_ID,
      siteUrl: 'https://fabrikam.example',
      status,
      ...(status === 'failed' ? { error: 'Connection refused' } : {}),
    },
    locale: 'en',
    perm: { reportsViewTechnical: true },
    brandingGuidelineActive: false,
    llmEnabled: false,
    assignedMap: {},
    ...(withControls ? { scanControls: true } : {}),
  });
}

function controlPosts(html: string, action: 'retry' | 'cancel'): string[] {
  return [...html.matchAll(new RegExp(`<button[^>]*hx-post="/reports/${SCAN_ID}/${action}"[^>]*>`, 'g'))].map(
    (m) => m[0],
  );
}

const EXPECTED_BUTTONS: Readonly<Record<Status, { retry: number; cancel: number }>> = {
  failed: { retry: 1, cancel: 0 },
  running: { retry: 0, cancel: 1 },
  queued: { retry: 1, cancel: 1 },
};

describe('report page scan controls', () => {
  it('HARD-14 report page renders no retry or cancel button without scan controls', () => {
    for (const status of ['failed', 'running', 'queued'] as const) {
      const html = render(status, false);
      expect(controlPosts(html, 'retry'), `${status} retry`).toHaveLength(0);
      expect(controlPosts(html, 'cancel'), `${status} cancel`).toHaveLength(0);
      expect(html, `${status} posts`).not.toMatch(/hx-post="\/reports\/[^"]*\/(retry|cancel)"/);
    }
    // The status messages and the progress links are not gated.
    expect(render('failed', false)).toContain('Scan Failed');
    expect(render('failed', false)).toContain('Connection refused');
    expect(render('running', false)).toContain('Scan is still in progress.');
    expect(render('running', false)).toContain(`/scan/${SCAN_ID}/progress`);
    expect(render('queued', false)).toContain('Scan is queued.');
    expect(render('queued', false)).toContain(`/scan/${SCAN_ID}/progress`);
  });

  it('HARD-14 report page renders retry and cancel for a viewer with scan controls', () => {
    for (const status of ['failed', 'running', 'queued'] as const) {
      const html = render(status, true);
      expect(controlPosts(html, 'retry'), `${status} retry`).toHaveLength(EXPECTED_BUTTONS[status].retry);
      expect(controlPosts(html, 'cancel'), `${status} cancel`).toHaveLength(EXPECTED_BUTTONS[status].cancel);
    }
    expect(render('failed', true)).toContain('Retry Scan');
    expect(render('running', true)).toContain('Cancel');
  });
});
