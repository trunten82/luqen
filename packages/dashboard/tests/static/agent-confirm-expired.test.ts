/**
 * HARD-21: an approval the server answers with 409 (the action expired, or was already approved or
 * declined elsewhere) closes the confirmation dialog with a message saying so and offers no Retry,
 * because a retry cannot succeed. Any other failure keeps the Retry button.
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

const EXPIRED_TEXT = "Sentinel-expired l'action & co";
const RESOLVED_TEXT = "Sentinel-resolved l'action & co";
const MESSAGE_ID = 'm-paused-1';

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

/** The drawer with the real confirmation dialog; `confirmAnswer` answers the approve POST. */
function setup(confirmAnswer: () => Response): Harness {
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
    expect(h.doc.getElementById('agent-aria-status')?.textContent).toBe(EXPIRED_TEXT);
    expect(h.panelFetchesAfterConfirm()).toBeGreaterThanOrEqual(1);
    expect(h.doc.querySelector('[data-action="agentConfirmApprove"]')?.hasAttribute('disabled')).toBe(false);
  });

  it('HARD-21 an approval already resolved elsewhere closes the dialog without retry', async () => {
    const h = setup(() => response({ error: 'not_pending' }, 409));

    await approve(h);

    expect(h.confirmIndex()).toBeGreaterThanOrEqual(0);
    expect(h.doc.querySelector('[data-action="agentConfirmRetry"]')).toBeNull();
    expect(h.doc.querySelector('.alert--error')).toBeNull();
    expect(h.doc.getElementById('agent-aria-status')?.textContent).toBe(RESOLVED_TEXT);
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
});
