/**
 * HARD-01: a refused preview in the mark dialog shows the copy for ITS reason.
 *
 * issue-dismissals.js runs in a JSDOM realm against the REAL dialog partial rendered with the real
 * `t` (English), so the status -> data attribute -> translation key chain is tested in one piece.
 * fetch and the <dialog> methods are stubs; everything else is the production script.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import Handlebars from 'handlebars';
import { loadTranslations, t, type Locale } from '../../src/i18n/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const VIEWS_DIR = join(HERE, '..', '..', 'src', 'views');
const SCRIPT = readFileSync(join(HERE, '..', '..', 'src', 'static', 'issue-dismissals.js'), 'utf8');
const SERVER_TEXT = 'SERVER-ENGLISH-DETAIL-7c1';

let dialogHtml: string;
const open: JSDOM[] = [];

beforeAll(() => {
  loadTranslations();
  const hb = Handlebars.create();
  hb.registerHelper('t', function (key: string) {
    return t(key, 'en' as Locale);
  });
  dialogHtml = hb.compile(readFileSync(join(VIEWS_DIR, 'partials', 'issue-dismiss-dialog.hbs'), 'utf8'))({
    scan: { id: 'scan-fabrikam-1' },
    perm: { reportsViewTechnical: true },
    dismissalControls: { reasonMax: 50, commentMax: 1000 },
  });
});

afterEach(() => {
  for (const dom of open.splice(0)) dom.window.close();
});

interface Realm {
  readonly doc: Document;
  readonly answer: (status: number, body: unknown) => Promise<void>;
}

async function openDialog(): Promise<Realm> {
  const dom = new JSDOM(
    `<!doctype html><html><head><meta name="csrf-token" content="tok"></head><body>
      <div id="panel-issues" class="rpt-tab-panel">
        <button id="opener" type="button" class="rpt-dismiss-btn" data-action="rptDismissIssue"
          data-code="WCAG2AA.Principle1.Guideline1_1.1_1_1.H37" data-selector="#hero > p" data-message="Finding">Dismiss</button>
      </div>${dialogHtml}</body></html>`,
    { url: 'http://localhost/reports/scan-fabrikam-1', runScripts: 'outside-only' },
  );
  open.push(dom);
  const win = dom.window as unknown as Window & typeof globalThis & Record<string, unknown>;
  const doc = win.document;
  const pending: Array<(res: unknown) => void> = [];
  win['fetch'] = () => new Promise((resolve) => { pending.push(resolve); });
  (win.Element.prototype as unknown as Record<string, unknown>)['scrollIntoView'] = () => undefined;
  const proto = win.HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  proto['showModal'] = function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  proto['close'] = function (this: HTMLDialogElement) { this.removeAttribute('open'); };
  win['luqenIssueDismissals'] = { reload: () => undefined };
  if (doc.readyState !== 'complete') {
    await new Promise<void>((resolve) => win.addEventListener('load', () => resolve()));
  }
  new (win as unknown as { Function: FunctionConstructor }).Function('window', 'document', SCRIPT).call(win, win, doc);
  (win['rptDismissIssue'] as (b: Element | null) => void)(doc.getElementById('opener'));
  return {
    doc,
    answer: async (status, body) => {
      pending[pending.length - 1]({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
      for (let i = 0; i < 6; i += 1) await new Promise<void>((r) => setImmediate(r));
    },
  };
}

const statusText = (r: Realm) => r.doc.querySelector('[data-preview="status"]')?.textContent ?? '';
const retryHidden = (r: Realm) =>
  r.doc.querySelector('[data-action="rptDismissRetryPreview"]')?.classList.contains('is-hidden') === true;

describe('a refused preview names its reason', () => {
  it('HARD-01 a refused preview shows the copy for its reason', async () => {
    // [what the server answered, the translation key whose text the dialog must show]
    const cases: ReadonlyArray<readonly [string, number, unknown, string]> = [
      ['a whole-page selector', 200, { occurrences: 0, pages: 0, refused: true, reason: 'selector' }, 'issueDismissals.dialog.preview.refused'],
      ['an over-long selector', 200, { occurrences: 0, pages: 0, refused: true, reason: 'selector-too-long' }, 'issueDismissals.dialog.preview.refusedSelectorTooLong'],
      ['400', 400, { error: SERVER_TEXT }, 'issueDismissals.dialog.preview.refusedInvalid'],
      ['401', 401, { error: SERVER_TEXT }, 'issueDismissals.error.session'],
      ['403', 403, { error: SERVER_TEXT }, 'issueDismissals.error.forbidden'],
      ['404', 404, { error: SERVER_TEXT }, 'issueDismissals.error.notFound'],
      ['422', 422, { error: SERVER_TEXT }, 'issueDismissals.dialog.preview.reportUnavailable'],
      ['410 (any other refused status)', 410, { error: SERVER_TEXT }, 'issueDismissals.dialog.preview.refusedGeneric'],
    ];
    const shown: string[] = [];
    for (const [why, status, body, key] of cases) {
      const r = await openDialog();
      await r.answer(status, body);
      const want = t(key, 'en');
      expect(want, `${why}: ${key} has English text`).not.toBe(key);
      expect(statusText(r), why).toBe(want);
      expect(retryHidden(r), `${why}: no Try again`).toBe(true);
      expect((r.doc.querySelector('[data-action="rptDismissConfirm"]') as HTMLButtonElement).disabled, why).toBe(true);
      expect(r.doc.body.textContent, why).not.toContain(SERVER_TEXT);
      shown.push(statusText(r));
    }
    // Every reason has its own sentence.
    expect(new Set(shown).size).toBe(cases.length);
    // 408 and 429 mean "not now": they keep the retryable error and Try again.
    for (const status of [408, 429]) {
      const r = await openDialog();
      await r.answer(status, {});
      expect(statusText(r), String(status)).toBe(t('issueDismissals.dialog.preview.error', 'en'));
      expect(retryHidden(r), String(status)).toBe(false);
    }
  });
});
