/**
 * HARD-21: an approval the server answers with 409 (the action expired, or was already approved or
 * declined elsewhere) closes the confirmation dialog and offers no Retry, because a retry cannot
 * succeed; once the panel has reloaded, a visible notice saying so sits in the conversation log, which
 * announces it. Any other failure keeps the Retry button and shows no such notice.
 *
 * Loads src/static/agent.js into a fresh JSDOM (the harness shape of agent-actions-handlers.test.ts).
 * The dialog is the REAL agent-confirm-dialog.hbs, compiled with the handlebars package and a `t`
 * helper that answers sentinel texts containing an apostrophe and an ampersand, so the attribute
 * round trip (escaped by Handlebars, decoded by the HTML parser) is part of what is tested.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import Handlebars from 'handlebars';
import { JSDOM } from 'jsdom';

const HERE = dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = resolve(HERE, '..', '..', 'src', 'static');
const AGENT_JS = readFileSync(resolve(STATIC_DIR, 'agent.js'), 'utf8');
const DIALOG_HBS = readFileSync(resolve(HERE, '..', '..', 'src', 'views', 'partials', 'agent-confirm-dialog.hbs'), 'utf8');
const DRAWER_HBS = readFileSync(resolve(HERE, '..', '..', 'src', 'views', 'partials', 'agent-drawer.hbs'), 'utf8');

const EXPIRED_TEXT = "Sentinel-expired l'action & co";
const RESOLVED_TEXT = "Sentinel-resolved l'action & co";
const MESSAGE_ID = 'm-paused-1';
const RELOADED_MARKER = 'PANEL-RELOADED-MARKER';
/** What the panel answers after the approval: the conversation as the server renders it, one user bubble. */
const PANEL_HTML = `<div class="agent-msg agent-msg--user" data-message-id="u-reloaded"><div class="agent-msg__body">${RELOADED_MARKER}</div></div>`;

function renderDialog(): string {
  const hb = Handlebars.create();
  hb.registerHelper('t', (key: string) => {
    if (key === 'agent.confirm.expired') return EXPIRED_TEXT;
    if (key === 'agent.confirm.notPending') return RESOLVED_TEXT;
    return key;
  });
  return hb.compile(DIALOG_HBS)({ agentDisplayName: 'Assistant' });
}

function response(body: unknown, status: number): Response {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': typeof body === 'string' ? 'text/html' : 'application/json' }),
    json: async () => JSON.parse(payload) as unknown,
    text: async () => payload,
  } as unknown as Response;
}

interface Harness {
  readonly doc: Document;
  readonly win: Window & typeof globalThis;
  readonly fetchStub: ReturnType<typeof vi.fn>;
  /** The confirm POST's position among the fetch calls, and the panel fetches after it. */
  confirmIndex(): number;
  panelFetchesAfterConfirm(): number;
}

let currentDom: JSDOM | null = null;

/** The drawer with the real confirmation dialog; `confirmAnswer` answers the approve POST and the panel answers `panelHtml`. */
function setup(confirmAnswer: () => Response, panelHtml = ''): Harness {
  const dom = new JSDOM(
    `<!DOCTYPE html><html><head><meta name="csrf-token" content="test-csrf-tok"></head><body>
       <div id="agent-aria-status" class="sr-only" aria-live="polite"></div>
       <aside id="agent-drawer" class="agent-drawer" aria-label="Agent">
         <div class="agent-drawer__messages" id="agent-messages" role="log"></div>
         <form id="agent-form" data-conversation-id="c1"></form>
         ${renderDialog()}
       </aside>
     </body></html>`,
    { url: 'http://localhost/', pretendToBeVisual: true },
  );
  currentDom = dom;
  const win = dom.window as unknown as Window & typeof globalThis;
  const doc = win.document;
  for (const name of ['document', 'window', 'HTMLElement', 'HTMLInputElement', 'HTMLFormElement', 'HTMLTextAreaElement', 'Event', 'KeyboardEvent', 'DOMParser'] as const) {
    (globalThis as Record<string, unknown>)[name] = name === 'document' ? doc : name === 'window' ? win : (win as unknown as Record<string, unknown>)[name];
  }
  const fetchStub = vi.fn(async (url: unknown) => {
    if (String(url).startsWith('/agent/confirm/')) return confirmAnswer();
    if (String(url).startsWith('/agent/panel?')) return response(panelHtml, 200);
    return response('', 200);
  });
  (win as unknown as { fetch: unknown }).fetch = fetchStub;
  class FakeEventSource {
    constructor(public readonly url: string) { /* never opened by these tests */ }
    addEventListener(): void { /* noop */ }
    removeEventListener(): void { /* noop */ }
    close(): void { /* noop */ }
  }
  (win as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
  (globalThis as Record<string, unknown>)['EventSource'] = FakeEventSource;
  (win as unknown as { __agentTestMode: boolean }).__agentTestMode = true;
  new win.Function('window', 'document', 'localStorage', 'fetch', AGENT_JS).call(win, win, doc, win.localStorage, win.fetch);

  const urls = (): string[] => fetchStub.mock.calls.map((c) => String(c[0]));
  return {
    doc,
    win,
    fetchStub,
    confirmIndex: () => urls().findIndex((u) => u.startsWith('/agent/confirm/')),
    panelFetchesAfterConfirm: () => {
      const at = urls().findIndex((u) => u.startsWith('/agent/confirm/'));
      return at === -1 ? 0 : urls().slice(at + 1).filter((u) => u.startsWith('/agent/panel?conversationId=')).length;
    },
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 40; i++) await Promise.resolve();
}

/** The dialog shows the paused action and the user clicks Approve. */
async function approve(h: Harness): Promise<void> {
  h.doc.dispatchEvent(new h.win.CustomEvent('agent:pending-confirmation', { detail: { messageId: MESSAGE_ID, toolName: 'dashboard_scan_site', args: {} } }));
  const button = h.doc.querySelector('[data-action="agentConfirmApprove"]') as HTMLElement;
  button.click();
  await flush();
}

/** Waits (bounded, in microtask ticks) until the reloaded panel is in the messages list, then 40 more ticks. */
async function panelReloaded(h: Harness): Promise<void> {
  const messages = h.doc.getElementById('agent-messages');
  for (let i = 0; i < 2000 && !(messages?.textContent ?? '').includes(RELOADED_MARKER); i++) await Promise.resolve();
  expect(messages?.textContent ?? '').toContain(RELOADED_MARKER);
  await flush();
}

/** Inside #agent-messages, outside the dialog, and neither it nor an ancestor is sr-only, hidden or aria-hidden. */
function isVisibleInPanel(h: Harness, el: Element): boolean {
  const messages = h.doc.getElementById('agent-messages');
  if (messages === null || !messages.contains(el)) return false;
  if (el.closest('dialog') !== null) return false;
  for (let node: Element | null = el; node !== null; node = node.parentElement) {
    if (node.classList.contains('sr-only') || node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true') return false;
  }
  return true;
}

/** The nearest element, from `el` up, that is a live region (aria-live, or role log, status or alert). */
function nearestLiveRegion(el: Element): Element | null {
  for (let node: Element | null = el; node !== null; node = node.parentElement) {
    if (node.hasAttribute('aria-live') || ['log', 'status', 'alert'].includes(node.getAttribute('role') ?? '')) return node;
  }
  return null;
}

function expectPanelNotice(h: Harness, text: string): void {
  const notices = h.doc.querySelectorAll('[data-agent-notice]');
  expect(notices).toHaveLength(1);
  const notice = notices[0]!;
  expect(isVisibleInPanel(h, notice)).toBe(true);
  expect(notice.classList.contains('alert--warning')).toBe(true);
  expect((notice.textContent ?? '').trim()).toBe(text);
  expect(h.doc.getElementById('agent-messages')?.textContent ?? '').toContain(RELOADED_MARKER);
}

afterEach(() => {
  if (currentDom) {
    try { currentDom.window.close(); } catch (_e) { /* ignore */ }
  }
  currentDom = null;
});

describe('HARD-21 an approval the server refuses as no longer pending', () => {
  it('HARD-21 an expired approval closes the dialog with the expired message and no retry', async () => {
    const h = setup(() => response({ error: 'expired' }, 409));

    await approve(h);

    expect(h.confirmIndex()).toBeGreaterThanOrEqual(0);
    expect(h.doc.querySelector('[data-action="agentConfirmRetry"]')).toBeNull();
    expect(h.doc.querySelector('.alert--error')).toBeNull();
    expect(h.doc.getElementById('agent-aria-status')?.textContent).not.toBe(EXPIRED_TEXT);
    expect(h.panelFetchesAfterConfirm()).toBeGreaterThanOrEqual(1);
    expect(h.doc.querySelector('[data-action="agentConfirmApprove"]')?.hasAttribute('disabled')).toBe(false);
  });

  it('HARD-21 an approval already resolved elsewhere closes the dialog without retry', async () => {
    const h = setup(() => response({ error: 'not_pending' }, 409));

    await approve(h);

    expect(h.confirmIndex()).toBeGreaterThanOrEqual(0);
    expect(h.doc.querySelector('[data-action="agentConfirmRetry"]')).toBeNull();
    expect(h.doc.querySelector('.alert--error')).toBeNull();
    expect(h.doc.getElementById('agent-aria-status')?.textContent).not.toBe(RESOLVED_TEXT);
    expect(h.panelFetchesAfterConfirm()).toBeGreaterThanOrEqual(1);
    expect(h.doc.querySelector('[data-action="agentConfirmApprove"]')?.hasAttribute('disabled')).toBe(false);
  });

  it('HARD-21 an approval that failed on the server keeps the retry button', async () => {
    const h = setup(() => response({ error: 'internal' }, 500));

    await approve(h);

    const retry = h.doc.querySelector('[data-action="agentConfirmRetry"]');
    expect(retry).not.toBeNull();
    expect(retry?.getAttribute('data-retry-message-id')).toBe(MESSAGE_ID);
    const status = h.doc.getElementById('agent-aria-status')?.textContent ?? '';
    expect(status).not.toBe(EXPIRED_TEXT);
    expect(status).not.toBe(RESOLVED_TEXT);
  });

  it('HARD-21 an expired approval shows its message in the assistant panel', async () => {
    const h = setup(() => response({ error: 'expired' }, 409), PANEL_HTML);

    await approve(h);
    await panelReloaded(h);

    expectPanelNotice(h, EXPIRED_TEXT);
  });

  it('HARD-21 an approval already resolved elsewhere shows its message in the assistant panel', async () => {
    const h = setup(() => response({ error: 'not_pending' }, 409), PANEL_HTML);

    await approve(h);
    await panelReloaded(h);

    expectPanelNotice(h, RESOLVED_TEXT);
  });

  it('HARD-21 an approval that failed on the server shows no expiry notice in the panel', async () => {
    const h = setup(() => response({ error: 'internal' }, 500), PANEL_HTML);

    await approve(h);
    await flush();

    expect(h.doc.querySelectorAll('[data-agent-notice]')).toHaveLength(0);
    expect(h.doc.querySelector('[data-action="agentConfirmRetry"]')).not.toBeNull();
  });

  it('HARD-21 an expired approval notice is announced by the conversation log', async () => {
    // The drawer the server renders marks the messages list as a polite log that announces additions.
    const messagesTag = /<div[^>]*id="agent-messages"[^>]*>/.exec(DRAWER_HBS)?.[0] ?? '';
    expect(messagesTag).toContain('role="log"');
    expect(messagesTag).toContain('aria-live="polite"');
    const h = setup(() => response({ error: 'expired' }, 409), PANEL_HTML);

    await approve(h);
    await panelReloaded(h);

    const notice = h.doc.querySelector('[data-agent-notice]');
    expect(notice).not.toBeNull();
    expect(notice!.hasAttribute('role')).toBe(false);
    expect(notice!.hasAttribute('aria-live')).toBe(false);
    expect(nearestLiveRegion(notice!)).toBe(h.doc.getElementById('agent-messages'));
    // Announced once: the status line does not repeat the sentence.
    expect(h.doc.getElementById('agent-aria-status')?.textContent ?? '').not.toContain(EXPIRED_TEXT);
  });
});
