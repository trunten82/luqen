/**
 * Phase 89 Plan 04 — issue-dismissals.js behaviour in a JSDOM realm (FP-14, FP-16).
 *
 * The body is the REAL dialog partial rendered with the real `t`, so the markup/script
 * contract (data-* attribute names, selectors, ids) is tested together. fetch, timers,
 * <dialog> methods, scrollIntoView and the reload indirection are stubs; everything else
 * is the production script.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import Handlebars from 'handlebars';
import { loadTranslations, t, type Locale } from '../../src/i18n/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const VIEWS_DIR = join(HERE, '..', '..', 'src', 'views');
const SCRIPT = readFileSync(join(HERE, '..', '..', 'src', 'static', 'issue-dismissals.js'), 'utf8');
const FLASH_KEY = 'luqen.issueDismissals.flash';
const REASON_MAX = 50;
const COMMENT_MAX = 40;
const CODE = 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37';
const SELECTOR = '#hero > p';
const SERVER_TEXT = 'SERVER-ENGLISH-DETAIL-9f3';

let dialogHtml: string;
let revokeDialogHtml: string;

beforeAll(() => {
  loadTranslations();
  const hb = Handlebars.create();
  hb.registerHelper(
    't',
    function (key: string, options: { hash?: Record<string, unknown> }) {
      const params = options?.hash != null
        ? Object.fromEntries(Object.entries(options.hash).map(([k, v]) => [k, String(v ?? '')]))
        : undefined;
      return t(key, 'en' as Locale, params);
    },
  );
  const source = readFileSync(join(VIEWS_DIR, 'partials', 'issue-dismiss-dialog.hbs'), 'utf8');
  dialogHtml = hb.compile(source)({
    scan: { id: 'scan-fabrikam-1' },
    perm: { reportsViewTechnical: true },
    dismissalControls: { reasonMax: REASON_MAX, commentMax: 1000 },
  });
  revokeDialogHtml = hb.compile(readFileSync(join(VIEWS_DIR, 'partials', 'issue-revoke-dialog.hbs'), 'utf8'))({
    scan: { id: 'scan-fabrikam-1' },
    dismissalControls: { reasonMax: REASON_MAX, commentMax: COMMENT_MAX },
  });
});

interface FetchCall {
  readonly url: string;
  readonly init: RequestInit | undefined;
}
interface Deferred {
  resolve(res: unknown): void;
  reject(err: unknown): void;
}
interface Harness {
  readonly dom: JSDOM;
  readonly win: Window & typeof globalThis;
  readonly doc: Document;
  readonly calls: FetchCall[];
  readonly pending: Deferred[];
  readonly timers: Array<{ fn: () => void; ms: number }>;
  readonly reloads: { count: number };
  readonly switched: string[];
  readonly scrolled: Element[];
}

const BODY = `
<div id="toast-container"></div>
<div id="panel-issues" class="rpt-tab-panel">
  <div class="rpt-group rpt-group--collapsed" data-issue-group data-criterion="1.1.1">
    <div class="rpt-group__header" role="button" aria-expanded="false"></div>
    <div class="rpt-group__body">
      <button id="opener" type="button" class="rpt-dismiss-btn" data-action="rptDismissIssue"
        data-code="${CODE}" data-selector="${SELECTOR}" data-message="Plain finding" data-criterion="1.1.1">Dismiss</button>
      <button id="opener2" type="button" class="rpt-dismiss-btn" data-action="rptDismissIssue"
        data-code="OTHER.code" data-selector=".other" data-message="Other finding" data-criterion="">Dismiss</button>
      <button id="refused" type="button" class="rpt-dismiss-btn" aria-disabled="true">Dismiss</button>
    </div>
  </div>
  <details id="rpt-dismissed">
    <button id="revoker" type="button" class="btn btn--ghost btn--sm" data-action="rptRevokeIssue"
      data-id="dis-1" data-code="${CODE}">Revoke</button>
    <button id="revoker2" type="button" class="btn btn--ghost btn--sm" data-action="rptRevokeIssue"
      data-id="dis/2 x" data-code="OTHER.code">Revoke</button>
  </details>
</div>
<div id="panel-templates" class="rpt-tab-panel">
  <button id="tpl-opener" type="button" class="rpt-dismiss-btn" data-action="rptDismissIssue"
    data-code="${CODE}" data-selector=".nav a" data-message="Template finding" data-criterion="">Dismiss</button>
</div>
`;

/** Build the realm. Pass storage seeds to simulate a page that loads after a reload. */
async function boot(opts: { flash?: unknown; panels?: boolean } = {}): Promise<Harness> {
  const dom = new JSDOM(
    `<!doctype html><html><head><meta name="csrf-token" content="tok-123"></head><body>${BODY}${dialogHtml}${revokeDialogHtml}</body></html>`,
    { url: 'http://localhost/reports/scan-fabrikam-1', runScripts: 'outside-only' },
  );
  const win = dom.window as unknown as Window & typeof globalThis;
  const doc = win.document;
  if (opts.panels === false) doc.getElementById('panel-templates')?.remove();

  const calls: FetchCall[] = [];
  const pending: Deferred[] = [];
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const reloads = { count: 0 };
  const switched: string[] = [];
  const scrolled: Element[] = [];

  const w = win as unknown as Record<string, unknown>;
  w['fetch'] = (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Promise((resolve, reject) => { pending.push({ resolve, reject }); });
  };
  w['setTimeout'] = (fn: () => void, ms: number) => { timers.push({ fn, ms }); return timers.length; };
  w['rptSwitchTab'] = (tab: string) => { switched.push(tab); };
  (win.Element.prototype as unknown as Record<string, unknown>)['scrollIntoView'] = function (this: Element) { scrolled.push(this); };
  const proto = win.HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  proto['showModal'] = function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  proto['close'] = function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new win.Event('close'));
  };
  w['luqenIssueDismissals'] = { reload: () => { reloads.count += 1; } };
  if (opts.flash !== undefined) win.sessionStorage.setItem(FLASH_KEY, JSON.stringify(opts.flash));

  // jsdom's document is still "loading" right after construction; wait so the script's
  // page-load hook takes its already-loaded branch deterministically.
  if (doc.readyState !== 'complete') {
    await new Promise<void>((resolve) => win.addEventListener('load', () => resolve()));
  }
  const fn = new (win as unknown as { Function: FunctionConstructor }).Function('window', 'document', SCRIPT);
  fn.call(win, win, win.document);
  return { dom, win, doc, calls, pending, timers, reloads, switched, scrolled };
}

function res(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
}
async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await new Promise<void>((r) => setImmediate(r));
}

const el = (h: Harness, sel: string) => h.doc.querySelector(sel) as HTMLElement;
const dialog = (h: Harness) => h.doc.getElementById('issue-dismiss-dialog') as HTMLDialogElement;
const confirmBtn = (h: Harness) => el(h, '[data-action="rptDismissConfirm"]') as HTMLButtonElement;
const cancelBtn = (h: Harness) => el(h, '[data-action="rptDismissCancel"]') as HTMLButtonElement;
const reason = (h: Harness) => h.doc.getElementById('issue-dismiss-reason') as HTMLTextAreaElement;
const errorText = (h: Harness) => (h.doc.getElementById('issue-dismiss-error') as HTMLElement).textContent;
const status = (h: Harness) => (el(h, '[data-preview="status"]')).textContent;
const attr = (h: Harness, name: string) => dialog(h).getAttribute(name) ?? '';
const call = (h: Harness, fn: string, ...a: unknown[]) => (h.win as unknown as Record<string, (...x: unknown[]) => void>)[fn](...a);

function type(h: Harness, text: string): void {
  reason(h).value = text;
  call(h, 'rptDismissReasonInput', reason(h));
}
function open(h: Harness, id = 'opener'): void {
  call(h, 'rptDismissIssue', h.doc.getElementById(id));
}
/** Open and answer the preview with a usable result. */
async function openReady(h: Harness, id = 'opener'): Promise<void> {
  open(h, id);
  h.pending[h.pending.length - 1].resolve(res(200, { occurrences: 2, pages: 2 }));
  await flush();
}
function toasts(h: Harness): HTMLElement[] {
  return [...h.doc.querySelectorAll<HTMLElement>('#toast-container .toast')];
}

let live: Harness[] = [];
async function make(opts?: Parameters<typeof boot>[0]): Promise<Harness> {
  const h = await boot(opts);
  live.push(h);
  return h;
}
beforeEach(() => { live = []; });
afterEach(() => { for (const h of live) h.dom.window.close(); });

describe('opening and the preview', () => {
  it('opening the dialog copies the finding as text and asks the preview endpoint', async () => {
    const h = await make();
    open(h);
    expect(dialog(h).hasAttribute('open')).toBe(true);
    expect(el(h, '[data-field="code"]').textContent).toBe(CODE);
    expect(el(h, '[data-field="selector"]').textContent).toBe(SELECTOR);
    expect(el(h, '[data-field="message"]').textContent).toBe('Plain finding');
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].url).toBe(
      `/api/v1/scans/scan-fabrikam-1/dismissals/preview?code=${encodeURIComponent(CODE)}&selector=${encodeURIComponent(SELECTOR)}`,
    );
    expect(h.calls[0].url).toContain('selector=%23hero%20%3E%20p');
    expect(h.calls[0].init?.credentials).toBe('include');
    expect(el(h, '[data-preview-region]').getAttribute('aria-busy')).toBe('true');
    expect(el(h, '[data-preview="occurrences"]').textContent).toBe('—');
    expect(status(h)).toBe(attr(h, 'data-preview-loading'));
  });

  it('a successful preview shows both numbers and clears the hint', async () => {
    const h = await make();
    await openReady(h);
    expect(el(h, '[data-preview="occurrences"]').textContent).toBe('2');
    expect(el(h, '[data-preview="pages"]').textContent).toBe('2');
    expect(status(h)).toBe('');
    expect(el(h, '[data-preview-region]').getAttribute('aria-busy')).toBe('false');
  });

  it('an aria-disabled dismiss button opens nothing', async () => {
    const h = await make();
    open(h, 'refused');
    expect(dialog(h).hasAttribute('open')).toBe(false);
    expect(h.calls).toHaveLength(0);
  });
});

describe('confirm gating', () => {
  it('confirm stays disabled until the trimmed reason is non-empty and the preview found the finding', async () => {
    const h = await make();
    open(h);
    expect(confirmBtn(h).disabled).toBe(true);
    type(h, 'A real reason');
    expect(confirmBtn(h).disabled).toBe(true); // preview still pending
    h.pending[0].resolve(res(200, { occurrences: 2, pages: 2 }));
    await flush();
    expect(confirmBtn(h).disabled).toBe(false);
    type(h, '');
    expect(confirmBtn(h).disabled).toBe(true);
    type(h, 'Again');
    expect(confirmBtn(h).disabled).toBe(false);
    type(h, 'x'.repeat(REASON_MAX + 1));
    expect(confirmBtn(h).disabled).toBe(true); // over the limit read from the textarea
  });

  it('a whitespace-only reason keeps confirm disabled', async () => {
    const h = await make();
    await openReady(h);
    type(h, '   \n\t  ');
    expect(confirmBtn(h).disabled).toBe(true);
    expect(el(h, '[data-reason-count]').textContent).toBe('7'); // the counter shows the raw length
  });

  it('a failed preview shows Try again and keeps confirm disabled; Try again re-runs it', async () => {
    const h = await make();
    open(h);
    h.pending[0].resolve(res(500, {}));
    await flush();
    type(h, 'A real reason');
    const retry = el(h, '[data-action="rptDismissRetryPreview"]');
    expect(status(h)).toBe(attr(h, 'data-preview-error'));
    expect(retry.classList.contains('is-hidden')).toBe(false);
    expect(confirmBtn(h).disabled).toBe(true);

    call(h, 'rptDismissRetryPreview', retry);
    expect(h.calls).toHaveLength(2);
    expect(retry.classList.contains('is-hidden')).toBe(true);
    h.pending[1].resolve(res(200, { occurrences: 1, pages: 1 }));
    await flush();
    expect(confirmBtn(h).disabled).toBe(false);
  });

  it('a network failure on the preview is treated like a failed preview', async () => {
    const h = await make();
    open(h);
    h.pending[0].reject(new Error('offline'));
    await flush();
    expect(status(h)).toBe(attr(h, 'data-preview-error'));
    expect(el(h, '[data-action="rptDismissRetryPreview"]').classList.contains('is-hidden')).toBe(false);
  });

  it.each([
    ['a refused selector', { occurrences: 0, pages: 0, refused: true, reason: 'selector' }, 'data-preview-refused'],
    ['zero matches', { occurrences: 0, pages: 0 }, 'data-preview-none'],
    ['an already-dismissed key', { occurrences: 2, pages: 2, alreadyDismissed: true }, 'data-preview-already'],
  ])('%s keeps confirm disabled with its own hint', async (_label, body, hintAttr) => {
    const h = await make();
    open(h);
    h.pending[0].resolve(res(200, body));
    await flush();
    type(h, 'A real reason');
    expect(confirmBtn(h).disabled).toBe(true);
    expect(status(h)).toBe(attr(h, hintAttr));
    expect(status(h)).not.toBe('');
  });

  it('a late answer for a previous opening cannot enable the current one', async () => {
    const h = await make();
    open(h);
    call(h, 'rptDismissCancel');
    open(h, 'opener2');
    h.pending[0].resolve(res(200, { occurrences: 9, pages: 9 })); // stale: belongs to the first opening
    await flush();
    type(h, 'A real reason');
    expect(confirmBtn(h).disabled).toBe(true);
    expect(el(h, '[data-preview="occurrences"]').textContent).toBe('—');
  });
});

describe('confirm request', () => {
  it('the mark request is JSON with the trimmed reason and the CSRF header', async () => {
    const h = await make();
    await openReady(h);
    type(h, '  Injected by a script after load.  ');
    call(h, 'rptDismissConfirm', confirmBtn(h));
    const post = h.calls[1];
    expect(post.url).toBe('/api/v1/scans/scan-fabrikam-1/dismissals');
    expect(post.init?.method).toBe('POST');
    expect(post.init?.credentials).toBe('include');
    const headers = post.init?.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['X-CSRF-Token']).toBe('tok-123');
    expect(JSON.parse(String(post.init?.body))).toEqual({
      code: CODE,
      selector: SELECTOR,
      reason: 'Injected by a script after load.',
    });
  });

  it('a successful mark stores the flash and reloads', async () => {
    const h = await make();
    await openReady(h);
    type(h, 'Reason');
    call(h, 'rptDismissConfirm', confirmBtn(h));
    h.pending[1].resolve(res(201, { recomputed_scans: 3, failed_scans: 0, recompute_complete: true }));
    await flush();
    const flash = JSON.parse(h.win.sessionStorage.getItem(FLASH_KEY) ?? 'null');
    expect(flash).toEqual({
      kind: 'success',
      message: 'Finding dismissed. Scans of this site updated: 3.',
      tab: 'issues',
      criterion: '1.1.1',
    });
    expect(h.reloads.count).toBe(1);
  });

  it('the flash remembers the Templates tab when the dialog was opened there', async () => {
    const h = await make();
    await openReady(h, 'tpl-opener');
    type(h, 'Reason');
    call(h, 'rptDismissConfirm', confirmBtn(h));
    h.pending[1].resolve(res(201, { recomputed_scans: 1, failed_scans: 0, recompute_complete: true }));
    await flush();
    const flash = JSON.parse(h.win.sessionStorage.getItem(FLASH_KEY) ?? 'null');
    expect(flash.tab).toBe('templates');
    expect(flash.criterion).toBe('');
  });

  it.each([
    ['failed scans', { recomputed_scans: 1, failed_scans: 2, recompute_complete: true }, 'Saved, but 2 scans of this site could not be updated.'],
    ['an incomplete recompute', { recomputed_scans: 1, failed_scans: 0, recompute_complete: false }, 'Saved, but the other scans of this site could not be fully updated.'],
  ])('%s become a warning flash', async (_label, body, text) => {
    const h = await make();
    await openReady(h);
    type(h, 'Reason');
    call(h, 'rptDismissConfirm', confirmBtn(h));
    h.pending[1].resolve(res(201, body));
    await flush();
    const flash = JSON.parse(h.win.sessionStorage.getItem(FLASH_KEY) ?? 'null');
    expect(flash.kind).toBe('warning');
    expect(flash.message).toContain(text);
    expect(flash.message).not.toContain('__FAILED__');
  });

  it('a mark that succeeds with an unreadable body still reloads with a success flash', async () => {
    const h = await make();
    await openReady(h);
    type(h, 'Reason');
    call(h, 'rptDismissConfirm', confirmBtn(h));
    h.pending[1].resolve({ ok: true, status: 201, json: () => Promise.reject(new Error('bad json')) });
    await flush();
    expect(h.reloads.count).toBe(1);
    expect(JSON.parse(h.win.sessionStorage.getItem(FLASH_KEY) ?? 'null').kind).toBe('success');
  });

  it('a storage failure does not stop the reload', async () => {
    const h = await make();
    await openReady(h);
    type(h, 'Reason');
    vi.spyOn(h.win.Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    call(h, 'rptDismissConfirm', confirmBtn(h));
    h.pending[1].resolve(res(201, { recomputed_scans: 1, failed_scans: 0, recompute_complete: true }));
    await flush();
    expect(h.reloads.count).toBe(1);
  });
});

describe('errors', () => {
  const MAP: ReadonlyArray<readonly [number | 'network', string]> = [
    [400, 'data-err-invalid'],
    [401, 'data-err-session'],
    [403, 'data-err-forbidden'],
    [404, 'data-err-not-found'],
    [409, 'data-err-conflict'],
    [422, 'data-err-no-match'],
    [429, 'data-err-rate-limited'],
    [503, 'data-err-unavailable'],
    [500, 'data-err-generic'],
    ['network', 'data-err-generic'],
  ];

  it.each(MAP)('each error status shows its own translated message and never the server text (%s)', async (code, attrName) => {
    const h = await make();
    await openReady(h);
    type(h, 'My reason stays');
    reason(h).blur();
    call(h, 'rptDismissConfirm', confirmBtn(h));
    if (code === 'network') h.pending[1].reject(new Error(SERVER_TEXT));
    else h.pending[1].resolve(res(code, { error: SERVER_TEXT }));
    await flush();

    expect(errorText(h)).toBe(attr(h, attrName));
    expect(errorText(h)).not.toBe('');
    expect(errorText(h)).not.toContain(SERVER_TEXT);
    expect(dialog(h).hasAttribute('open')).toBe(true);
    expect(reason(h).value).toBe('My reason stays');
    expect(h.doc.activeElement).toBe(reason(h));
    expect(confirmBtn(h).disabled).toBe(false); // retry is possible
    expect(cancelBtn(h).disabled).toBe(false);
    expect(h.reloads.count).toBe(0);
  });

  it('the error messages are all different where the statuses are different', () => {
    return make().then((h) => {
      const texts = MAP.filter(([c]) => c !== 500 && c !== 'network').map(([, a]) => attr(h, a));
      expect(new Set(texts).size).toBe(texts.length);
    });
  });
});

describe('in-flight lock', () => {
  it('while saving, confirm and cancel are disabled and Escape does not close the dialog', async () => {
    const h = await make();
    await openReady(h);
    type(h, 'Reason');
    const confirmLabel = confirmBtn(h).textContent;
    call(h, 'rptDismissConfirm', confirmBtn(h));

    expect(confirmBtn(h).disabled).toBe(true);
    expect(cancelBtn(h).disabled).toBe(true);
    expect(confirmBtn(h).textContent).toBe('Saving…');
    const escape = new h.win.Event('cancel', { cancelable: true });
    dialog(h).dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);

    // A second click while in flight sends nothing.
    call(h, 'rptDismissConfirm', confirmBtn(h));
    expect(h.calls.filter((c) => c.init?.method === 'POST')).toHaveLength(1);

    // The request fails: everything is released again.
    h.pending[1].resolve(res(500, {}));
    await flush();
    expect(cancelBtn(h).disabled).toBe(false);
    expect(confirmBtn(h).disabled).toBe(false);
    expect(confirmBtn(h).textContent).toBe(confirmLabel);
    const escapeAgain = new h.win.Event('cancel', { cancelable: true });
    dialog(h).dispatchEvent(escapeAgain);
    expect(escapeAgain.defaultPrevented).toBe(false);
  });
});

describe('reset on open', () => {
  it('reopening the dialog clears the previous reason, error and preview', async () => {
    const h = await make();
    await openReady(h);
    type(h, 'A reason that must not survive');
    call(h, 'rptDismissConfirm', confirmBtn(h));
    h.pending[1].resolve(res(409, { error: SERVER_TEXT }));
    await flush();
    expect(errorText(h)).not.toBe('');
    call(h, 'rptDismissCancel');
    expect(dialog(h).hasAttribute('open')).toBe(false);

    open(h, 'opener2');
    expect(reason(h).value).toBe('');
    expect(el(h, '[data-reason-count]').textContent).toBe('0');
    expect(errorText(h)).toBe('');
    expect(el(h, '[data-preview="occurrences"]').textContent).toBe('—');
    expect(el(h, '[data-preview="pages"]').textContent).toBe('—');
    expect(confirmBtn(h).disabled).toBe(true);
    expect(cancelBtn(h).disabled).toBe(false);
    expect(el(h, '[data-field="code"]').textContent).toBe('OTHER.code');
  });
});

describe('finding text is data, never markup', () => {
  const HOSTILE = '<img src=x onerror="window.__pwned=1">';

  it('finding text is written as text, not markup', async () => {
    const h = await make();
    h.doc.getElementById('opener')!.setAttribute('data-message', HOSTILE);
    h.doc.getElementById('opener')!.setAttribute('data-selector', HOSTILE);
    h.doc.getElementById('opener')!.setAttribute('data-code', HOSTILE);
    open(h);
    expect(dialog(h).querySelector('img')).toBeNull();
    expect(el(h, '[data-field="message"]').textContent).toBe(HOSTILE);
    expect(el(h, '[data-field="selector"]').textContent).toBe(HOSTILE);
    expect(el(h, '[data-field="code"]').textContent).toBe(HOSTILE);
    expect((h.win as unknown as Record<string, unknown>)['__pwned']).toBeUndefined();
  });

  it('a flash message is written as text, not markup', async () => {
    const h = await make({ flash: { kind: 'success', message: HOSTILE, tab: 'issues', criterion: '' } });
    const [toast] = toasts(h);
    expect(toast.querySelector('img')).toBeNull();
    expect(toast.textContent).toBe(HOSTILE);
  });
});

describe('result toast after the reload', () => {
  it('shows nothing when there is no flash', async () => {
    const h = await make();
    expect(toasts(h)).toHaveLength(0);
    expect(h.switched).toEqual([]);
  });

  it('the toast after reload is a success: role status, auto-dismissed after five seconds', async () => {
    const h = await make({ flash: { kind: 'success', message: 'Finding dismissed. Scans of this site updated: 3.', tab: 'issues', criterion: '' } });
    const [toast] = toasts(h);
    expect(toast.className).toContain('toast--success');
    expect(toast.getAttribute('role')).toBe('status');
    expect(toast.textContent).toBe('Finding dismissed. Scans of this site updated: 3.');
    expect(toast.querySelector('.toast__close')).toBeNull();
    expect(toast.hasAttribute('data-toast-persist')).toBe(false);
    expect(h.timers.some((t) => t.ms === 5000)).toBe(true);
    expect(h.win.sessionStorage.getItem(FLASH_KEY)).toBeNull(); // read once
    h.timers.filter((t) => t.ms === 5000).forEach((t) => t.fn());
    h.timers.filter((t) => t.ms === 300).forEach((t) => t.fn());
    expect(toasts(h)).toHaveLength(0);
  });

  it('the toast after reload is a persistent warning when scans failed or the recompute was incomplete', async () => {
    const h = await make({ flash: { kind: 'warning', message: 'Saved, but 2 scans of this site could not be updated.', tab: 'issues', criterion: '' } });
    const [toast] = toasts(h);
    expect(toast.className).toContain('toast--warning');
    expect(toast.getAttribute('role')).toBe('alert');
    expect(toast.hasAttribute('data-toast-persist')).toBe(true);
    expect(h.timers.filter((t) => t.ms === 5000)).toHaveLength(0); // never auto-dismissed
    const close = toast.querySelector('.toast__close') as HTMLButtonElement;
    expect(close.getAttribute('data-action')).toBe('rptToastClose');
    expect(close.getAttribute('aria-label')).toBe('Close');
    call(h, 'rptToastClose', close);
    expect(toasts(h)).toHaveLength(0);
  });

  it('an unreadable flash is ignored and removed', async () => {
    const h = await boot();
    live.push(h);
    h.win.sessionStorage.setItem(FLASH_KEY, '{not json');
    expect(() => new (h.win as unknown as { Function: FunctionConstructor }).Function('window', 'document', SCRIPT).call(h.win, h.win, h.doc)).not.toThrow();
    expect(toasts(h)).toHaveLength(0);
    expect(h.win.sessionStorage.getItem(FLASH_KEY)).toBeNull();
  });
});

describe('return to place', () => {
  it('the flash returns to the saved tab and expands the saved criterion group', async () => {
    const h = await make({ flash: { kind: 'success', message: 'ok', tab: 'issues', criterion: '1.1.1' } });
    expect(h.switched).toEqual(['issues']);
    const group = h.doc.querySelector('[data-issue-group]') as HTMLElement;
    expect(group.classList.contains('rpt-group--collapsed')).toBe(false);
    expect(group.querySelector('.rpt-group__header')?.getAttribute('aria-expanded')).toBe('true');
    expect(h.scrolled).toContain(group);
  });

  it('the flash returns to the issues tab when the saved panel is gone', async () => {
    const h = await make({ flash: { kind: 'success', message: 'ok', tab: 'templates', criterion: '' }, panels: false });
    expect(h.switched).toEqual(['issues']);
  });

  it('the flash returns to the Templates tab when it still exists and opens no group', async () => {
    const h = await make({ flash: { kind: 'success', message: 'ok', tab: 'templates', criterion: '' } });
    expect(h.switched).toEqual(['templates']);
    expect((h.doc.querySelector('[data-issue-group]') as HTMLElement).classList.contains('rpt-group--collapsed')).toBe(true);
  });

  it('a saved criterion that no longer exists changes nothing', async () => {
    const h = await make({ flash: { kind: 'success', message: 'ok', tab: 'issues', criterion: '9.9.9' } });
    expect((h.doc.querySelector('[data-issue-group]') as HTMLElement).classList.contains('rpt-group--collapsed')).toBe(true);
    expect(h.scrolled).toHaveLength(0);
  });
});


// ── Plan 05: revoke (FP-15, D-08) ────────────────────────────────────────────────────────────
// Revoke is the SIBLING of mark. Every invariant the mark tests above prove (CSRF + credentials,
// translated status map that never shows server text, in-flight lock, reset on open, text-only
// writes, flash + reload) is proven AGAIN here against revoke's own dialog and request.
const revokeDialog = (h: Harness) => h.doc.getElementById('issue-revoke-dialog') as HTMLDialogElement;
const revokeConfirm = (h: Harness) => el(h, '[data-action="rptRevokeConfirm"]') as HTMLButtonElement;
const revokeCancel = (h: Harness) => el(h, '[data-action="rptRevokeCancel"]') as HTMLButtonElement;
const comment = (h: Harness) => h.doc.getElementById('issue-revoke-comment') as HTMLTextAreaElement;
const revokeError = (h: Harness) => (h.doc.getElementById('issue-revoke-error') as HTMLElement).textContent;
const revokeAttr = (h: Harness, name: string) => revokeDialog(h).getAttribute(name) ?? '';

function openRevoke(h: Harness, id = 'revoker'): void {
  call(h, 'rptRevokeIssue', h.doc.getElementById(id));
}
function typeComment(h: Harness, text: string): void {
  comment(h).value = text;
  call(h, 'rptRevokeCommentInput', comment(h));
}

describe('revoke — opening', () => {
  it('opening copies the rule as text, sends nothing and enables confirm at once', async () => {
    const h = await make();
    openRevoke(h);
    expect(revokeDialog(h).hasAttribute('open')).toBe(true);
    expect(el(h, '#issue-revoke-dialog [data-field="code"]').textContent).toBe(CODE);
    expect(h.calls).toHaveLength(0); // no preview round trip for revoke
    expect(revokeConfirm(h).disabled).toBe(false); // the comment is optional
    expect(comment(h).hasAttribute('autofocus')).toBe(true); // native focus lands in the comment
  });

  it('reopening clears the previous comment, counter and error and releases the buttons', async () => {
    const h = await make();
    openRevoke(h);
    typeComment(h, 'A comment that must not survive');
    call(h, 'rptRevokeConfirm', revokeConfirm(h));
    h.pending[0].resolve(res(409, { error: SERVER_TEXT }));
    await flush();
    expect(revokeError(h)).not.toBe('');
    call(h, 'rptRevokeCancel');
    expect(revokeDialog(h).hasAttribute('open')).toBe(false);

    openRevoke(h, 'revoker2');
    expect(comment(h).value).toBe('');
    expect(el(h, '[data-comment-count]').textContent).toBe('0');
    expect(revokeError(h)).toBe('');
    expect(revokeConfirm(h).disabled).toBe(false);
    expect(revokeCancel(h).disabled).toBe(false);
    expect(el(h, '#issue-revoke-dialog [data-field="code"]').textContent).toBe('OTHER.code');
  });

  it('the counter shows the raw length of the comment', async () => {
    const h = await make();
    openRevoke(h);
    typeComment(h, '  abc  ');
    expect(el(h, '[data-comment-count]').textContent).toBe('7');
    expect(revokeConfirm(h).disabled).toBe(false);
  });

  it('the rule text is data, never markup', async () => {
    const h = await make();
    const HOSTILE = '<img src=x onerror="window.__pwned=1">';
    h.doc.getElementById('revoker')!.setAttribute('data-code', HOSTILE);
    openRevoke(h);
    expect(revokeDialog(h).querySelector('img')).toBeNull();
    expect(el(h, '#issue-revoke-dialog [data-field="code"]').textContent).toBe(HOSTILE);
    expect((h.win as unknown as Record<string, unknown>)['__pwned']).toBeUndefined();
  });
});

describe('revoke — request', () => {
  it('revoke without a comment sends an empty JSON object', async () => {
    const h = await make();
    openRevoke(h);
    call(h, 'rptRevokeConfirm', revokeConfirm(h));
    expect(h.calls).toHaveLength(1);
    const post = h.calls[0];
    expect(post.url).toBe('/api/v1/dismissals/dis-1/revoke');
    expect(post.init?.method).toBe('POST');
    expect(post.init?.credentials).toBe('include');
    const headers = post.init?.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['X-CSRF-Token']).toBe('tok-123');
    expect(post.init?.body).toBe('{}'); // never an empty body (Phase 87 IN-01)
  });

  it('revoke with a comment sends the trimmed comment', async () => {
    const h = await make();
    openRevoke(h);
    typeComment(h, '  Selector was too broad.  ');
    call(h, 'rptRevokeConfirm', revokeConfirm(h));
    expect(JSON.parse(String(h.calls[0].init?.body))).toEqual({ comment: 'Selector was too broad.' });
  });

  it('a whitespace-only comment is treated as no comment', async () => {
    const h = await make();
    openRevoke(h);
    typeComment(h, ' \n\t ');
    call(h, 'rptRevokeConfirm', revokeConfirm(h));
    expect(h.calls[0].init?.body).toBe('{}');
  });

  it('the dismissal id is URL-encoded into the path', async () => {
    const h = await make();
    openRevoke(h, 'revoker2');
    call(h, 'rptRevokeConfirm', revokeConfirm(h));
    expect(h.calls[0].url).toBe('/api/v1/dismissals/dis%2F2%20x/revoke');
  });

  it('a successful revoke stores the revoked flash and reloads', async () => {
    const h = await make();
    openRevoke(h);
    call(h, 'rptRevokeConfirm', revokeConfirm(h));
    h.pending[0].resolve(res(200, { recomputed_scans: 2, failed_scans: 0, recompute_complete: true }));
    await flush();
    const flash = JSON.parse(h.win.sessionStorage.getItem(FLASH_KEY) ?? 'null');
    expect(flash).toEqual({
      kind: 'success',
      message: 'Dismissal revoked. Scans of this site updated: 2.',
      tab: 'issues',
      criterion: '',
    });
    expect(h.reloads.count).toBe(1);
  });

  it.each([
    ['failed scans', { recomputed_scans: 1, failed_scans: 2, recompute_complete: true }, 'Saved, but 2 scans of this site could not be updated.'],
    ['an incomplete recompute', { recomputed_scans: 1, failed_scans: 0, recompute_complete: false }, 'Saved, but the other scans of this site could not be fully updated.'],
  ])('%s after a revoke become a warning flash', async (_label, body, text) => {
    const h = await make();
    openRevoke(h);
    call(h, 'rptRevokeConfirm', revokeConfirm(h));
    h.pending[0].resolve(res(200, body));
    await flush();
    const flash = JSON.parse(h.win.sessionStorage.getItem(FLASH_KEY) ?? 'null');
    expect(flash.kind).toBe('warning');
    expect(flash.message).toContain(text);
    expect(flash.message).not.toContain('__FAILED__');
    expect(flash.message).not.toContain('Finding dismissed');
  });

  it('only a 200 is a revoked dismissal: any other 2xx is reported as a failure and does not reload', async () => {
    const h = await make();
    openRevoke(h);
    call(h, 'rptRevokeConfirm', revokeConfirm(h));
    h.pending[0].resolve(res(204, {}));
    await flush();
    expect(h.reloads.count).toBe(0);
    expect(h.win.sessionStorage.getItem(FLASH_KEY)).toBeNull();
    expect(revokeError(h)).toBe(revokeAttr(h, 'data-err-generic'));
  });

  it('a revoke that succeeds with an unreadable body still reloads with a success flash', async () => {
    const h = await make();
    openRevoke(h);
    call(h, 'rptRevokeConfirm', revokeConfirm(h));
    h.pending[0].resolve({ ok: true, status: 200, json: () => Promise.reject(new Error('bad json')) });
    await flush();
    expect(h.reloads.count).toBe(1);
    expect(JSON.parse(h.win.sessionStorage.getItem(FLASH_KEY) ?? 'null').kind).toBe('success');
  });
});

describe('revoke — errors', () => {
  const MAP: ReadonlyArray<readonly [number | 'network', string]> = [
    [400, 'data-err-invalid'],
    [401, 'data-err-session'],
    [403, 'data-err-forbidden'],
    [404, 'data-err-not-found'],
    [409, 'data-err-conflict'],
    [422, 'data-err-no-match'],
    [429, 'data-err-rate-limited'],
    [503, 'data-err-unavailable'],
    [500, 'data-err-generic'],
    ['network', 'data-err-generic'],
  ];

  it.each(MAP)('each error status shows its own translated message and never the server text (%s)', async (code, attrName) => {
    const h = await make();
    openRevoke(h);
    typeComment(h, 'My comment stays');
    call(h, 'rptRevokeConfirm', revokeConfirm(h));
    if (code === 'network') h.pending[0].reject(new Error(SERVER_TEXT));
    else h.pending[0].resolve(res(code, { error: SERVER_TEXT }));
    await flush();

    expect(revokeError(h)).toBe(revokeAttr(h, attrName));
    expect(revokeError(h)).not.toBe('');
    expect(revokeError(h)).not.toContain(SERVER_TEXT);
    expect(revokeDialog(h).hasAttribute('open')).toBe(true);
    expect(comment(h).value).toBe('My comment stays');
    expect(h.doc.activeElement).toBe(comment(h));
    expect(revokeConfirm(h).disabled).toBe(false); // retry is possible
    expect(revokeCancel(h).disabled).toBe(false);
    expect(h.reloads.count).toBe(0);
  });

  it('a 409 on revoke shows the revoke-specific conflict text, not the mark one', async () => {
    const h = await make();
    openRevoke(h);
    call(h, 'rptRevokeConfirm', revokeConfirm(h));
    h.pending[0].resolve(res(409, { error: SERVER_TEXT }));
    await flush();
    expect(revokeError(h)).toBe('This dismissal was already revoked. Reload the page.');
    expect(revokeError(h)).not.toBe(attr(h, 'data-err-conflict')); // the mark dialog's own 409 text
    expect(attr(h, 'data-err-conflict')).toContain('already dismissed');
  });

  // 89-11 item 1 (D-15 Q1): the 400 slot of the revoke dialog said "This finding cannot be
  // dismissed, or the reason is not valid" - mark wording for a revoke request.
  it('a 400 on revoke shows the revoke-specific invalid text, not the mark one', async () => {
    const h = await make();
    openRevoke(h);
    typeComment(h, 'My comment stays');
    call(h, 'rptRevokeConfirm', revokeConfirm(h));
    h.pending[0].resolve(res(400, { error: SERVER_TEXT }));
    await flush();
    expect(revokeError(h)).toBe(t('issueDismissals.error.invalidRevoke', 'en'));
    expect(revokeError(h)).not.toBe(attr(h, 'data-err-invalid')); // the mark dialog's own 400 text
    expect(attr(h, 'data-err-invalid')).toBe(t('issueDismissals.error.invalid', 'en'));
    expect(comment(h).value).toBe('My comment stays');
    expect(revokeDialog(h).hasAttribute('open')).toBe(true);
  });
});

describe('revoke — in-flight lock', () => {
  it('while revoking, confirm and cancel are disabled and Escape does not close the dialog', async () => {
    const h = await make();
    openRevoke(h);
    const confirmLabel = revokeConfirm(h).textContent;
    call(h, 'rptRevokeConfirm', revokeConfirm(h));

    expect(revokeConfirm(h).disabled).toBe(true);
    expect(revokeCancel(h).disabled).toBe(true);
    expect(revokeConfirm(h).textContent).toBe('Revoking…');
    const escape = new h.win.Event('cancel', { cancelable: true });
    revokeDialog(h).dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);

    // Cancel while in flight closes nothing; a second Confirm sends nothing.
    call(h, 'rptRevokeCancel');
    expect(revokeDialog(h).hasAttribute('open')).toBe(true);
    call(h, 'rptRevokeConfirm', revokeConfirm(h));
    expect(h.calls.filter((c) => c.init?.method === 'POST')).toHaveLength(1);

    h.pending[0].resolve(res(500, {}));
    await flush();
    expect(revokeCancel(h).disabled).toBe(false);
    expect(revokeConfirm(h).disabled).toBe(false);
    expect(revokeConfirm(h).textContent).toBe(confirmLabel);
    const escapeAgain = new h.win.Event('cancel', { cancelable: true });
    revokeDialog(h).dispatchEvent(escapeAgain);
    expect(escapeAgain.defaultPrevented).toBe(false);
  });

  it('revoking never disables the mark dialog and vice versa', async () => {
    const h = await make();
    openRevoke(h);
    call(h, 'rptRevokeConfirm', revokeConfirm(h));
    h.pending[0].resolve(res(500, {}));
    await flush();
    expect(confirmBtn(h).disabled).toBe(true); // mark confirm is still gated on reason + preview
    expect(confirmBtn(h).textContent).toBe('Dismiss as false positive');
    expect(cancelBtn(h).disabled).toBe(false);
  });
});

describe('revoke — one implementation shared with mark', () => {
  it('the status map, the request and the flash/toast code exist once', () => {
    expect((SCRIPT.match(/var ERR_ATTR\s*=/g) ?? []).length).toBe(1);
    expect((SCRIPT.match(/function showFlashToast/g) ?? []).length).toBe(1);
    expect((SCRIPT.match(/function storeFlash/g) ?? []).length).toBe(1);
    expect((SCRIPT.match(/method:\s*'POST'/g) ?? []).length).toBe(1);
    expect((SCRIPT.match(/X-CSRF-Token/g) ?? []).length).toBe(1);
  });
});
