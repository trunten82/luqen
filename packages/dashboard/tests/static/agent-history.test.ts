/*
 * Phase 35 Plan 05 — client history-panel behaviour tests.
 *
 * Loads the real src/static/agent.js into a FRESH JSDOM instance per test
 * (via the jsdom package directly — NOT the vitest jsdom env, which reuses
 * one document across tests and causes the IIFE's document-level listeners
 * to pile up). Exercises fetch+csrf, debounced search, <mark> XSS safety,
 * IntersectionObserver, rename/delete/resume flows, and the keyboard contract
 * from UI-SPEC.
 *
 * Ground rules:
 *  - CSP-strict: agent.js must mutate the DOM via createElement/textContent;
 *    test 7 proves a script tag in a snippet is never executed.
 *  - All fetches MUST carry the csrf header we seed.
 *  - IntersectionObserver is stubbed with a manually-triggerable observe().
 */

import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_JS_PATH = resolve(__dirname, '..', '..', 'src', 'static', 'agent.js');
const AGENT_JS_SOURCE = readFileSync(AGENT_JS_PATH, 'utf8');
// Phase 39.1-02 — history panel moved to agent-history.js. The harness must
// load it after agent.js so delegated click+keydown listeners and the test
// export shim (renderHistoryItem, openHistoryPanel, fetchHistoryPage, etc.)
// are wired up in the JSDOM realm. agent-org.js is loaded too because the
// resume flow calls into autoSwitchOrgIfNeeded.
const AGENT_ORG_JS_PATH = resolve(__dirname, '..', '..', 'src', 'static', 'agent-org.js');
const AGENT_ORG_JS_SOURCE = readFileSync(AGENT_ORG_JS_PATH, 'utf8');
const AGENT_HISTORY_JS_PATH = resolve(__dirname, '..', '..', 'src', 'static', 'agent-history.js');
const AGENT_HISTORY_JS_SOURCE = readFileSync(AGENT_HISTORY_JS_PATH, 'utf8');

type FetchArgs = readonly [string, RequestInit | undefined];

interface StubbedIO {
  readonly instances: StubbedIOInstance[];
  trigger(intersecting: boolean): void;
}

interface StubbedIOInstance {
  readonly callback: IntersectionObserverCallback;
  readonly observed: Element[];
  disconnected: boolean;
}

function buildDrawerHtml(): string {
  return `
    <meta name="csrf-token" content="test-csrf-tok">
    <button id="agent-launch" data-action="toggleAgentDrawer"></button>
    <aside id="agent-drawer" class="agent-drawer" hidden aria-label="Agent">
      <header class="agent-drawer__header">
        <h2 class="agent-drawer__title"><span id="agent-display-name">Agent</span></h2>
        <button type="button" class="agent-drawer__history-open"
                aria-expanded="false"
                aria-controls="agent-history-panel"
                data-action="openAgentHistory">History</button>
      </header>
      <div class="agent-drawer__messages" id="agent-messages" role="log"></div>
      <section id="agent-history-panel" class="agent-drawer__history"
               role="region" aria-label="Conversation history"
               aria-hidden="true" hidden>
        <header class="agent-drawer__history-head">
          <button type="button" class="agent-drawer__history-back"
                  data-action="closeAgentHistory" aria-label="Back to chat">Back</button>
          <h3>History</h3>
        </header>
        <div class="agent-drawer__history-search">
          <input type="search" id="agent-history-search-input" role="searchbox"
                 aria-controls="agent-history-list" placeholder="Search conversations"
                 autocomplete="off">
          <button type="button" class="agent-drawer__history-search-clear"
                  data-action="clearAgentHistorySearch"
                  aria-label="Clear search" hidden>&times;</button>
        </div>
        <div role="status" aria-live="polite" class="sr-only" id="agent-history-live"></div>
        <ul id="agent-history-list" class="agent-drawer__history-list" role="list">
          <li class="agent-drawer__history-empty">
            <h4>No conversations yet</h4>
            <p class="form-hint">Ask a question.</p>
          </li>
        </ul>
        <div class="agent-drawer__history-sentinel"
             data-action="historySentinel" role="presentation"></div>
        <div class="agent-drawer__history-error" hidden role="alert">
          <h4>Couldn't load history</h4>
          <button type="button" data-action="retryHistory">Retry</button>
        </div>
      </section>
      <form id="agent-form" data-conversation-id=""></form>
    </aside>
  `;
}

function installIntersectionObserverStub(win: Window): StubbedIO {
  const state: StubbedIO = {
    instances: [],
    trigger(intersecting: boolean) {
      for (const inst of state.instances) {
        if (inst.disconnected) continue;
        const entries = inst.observed.map((el) => ({
          isIntersecting: intersecting,
          target: el,
          intersectionRatio: intersecting ? 1 : 0,
          boundingClientRect: el.getBoundingClientRect(),
          intersectionRect: el.getBoundingClientRect(),
          rootBounds: null,
          time: 0,
        })) as unknown as IntersectionObserverEntry[];
        inst.callback(entries, {} as IntersectionObserver);
      }
    },
  };

  class FakeIO {
    private readonly inst: StubbedIOInstance;
    constructor(cb: IntersectionObserverCallback) {
      this.inst = { callback: cb, observed: [], disconnected: false };
      state.instances.push(this.inst);
    }
    observe(target: Element) { this.inst.observed.push(target); }
    unobserve(target: Element) {
      const i = this.inst.observed.indexOf(target);
      if (i >= 0) this.inst.observed.splice(i, 1);
    }
    disconnect() { this.inst.disconnected = true; }
    takeRecords() { return []; }
  }
  // @ts-expect-error — attach to jsdom window
  win.IntersectionObserver = FakeIO;
  // Also expose on the Node globalThis because `new win.Function(...)` created
  // functions resolve bare identifiers against the Node-level global scope,
  // not jsdom's window. This is a jsdom+Function quirk.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).IntersectionObserver = FakeIO;
  return state;
}

interface Harness {
  readonly win: Window;
  readonly doc: Document;
  readonly fetchStub: ReturnType<typeof vi.fn>;
  readonly io: StubbedIO;
}

function loadAgentJs(doc: Document, win: Window): void {
  // Execute the IIFE source against the provided window/document/jsdom env.
  const fn = new win.Function(
    'window', 'document', 'localStorage', 'fetch',
    AGENT_JS_SOURCE,
  );
  fn.call(win, win, doc, win.localStorage, win.fetch);
  // Phase 39.1-02 — load agent-org.js + agent-history.js after agent.js so
  // their delegated listeners + test export shims are wired.
  const fnOrg = new win.Function(
    'window', 'document', 'localStorage', 'fetch',
    AGENT_ORG_JS_SOURCE,
  );
  fnOrg.call(win, win, doc, win.localStorage, win.fetch);
  const fnHist = new win.Function(
    'window', 'document', 'localStorage', 'fetch',
    AGENT_HISTORY_JS_SOURCE,
  );
  fnHist.call(win, win, doc, win.localStorage, win.fetch);
}

function importFixtureInto(doc: Document, html: string): void {
  const parsed = new DOMParser().parseFromString(
    `<!DOCTYPE html><html><head></head><body>${html}</body></html>`,
    'text/html',
  );
  while (doc.body.firstChild) doc.body.removeChild(doc.body.firstChild);
  while (doc.head.firstChild) doc.head.removeChild(doc.head.firstChild);
  const meta = parsed.querySelector('meta[name="csrf-token"]');
  if (meta) doc.head.appendChild(doc.importNode(meta, true));
  const bodyChildren = Array.from(parsed.body.childNodes);
  for (const node of bodyChildren) {
    if (node.nodeType === 1 && (node as Element).tagName === 'META') continue;
    doc.body.appendChild(doc.importNode(node, true));
  }
}

let currentDom: JSDOM | null = null;

function setupHarness(): Harness {
  const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body></body></html>`, {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });
  currentDom = dom;
  const win = dom.window as unknown as Window & typeof globalThis;
  const doc = win.document;
  // Bridge DOM globals for the test body (which uses `document`, `window`, etc.).
  (globalThis as { document: Document }).document = doc;
  (globalThis as { window: Window }).window = win;
  (globalThis as { HTMLElement: typeof HTMLElement }).HTMLElement = win.HTMLElement;
  (globalThis as { HTMLInputElement: typeof HTMLInputElement }).HTMLInputElement = win.HTMLInputElement;
  (globalThis as { Event: typeof Event }).Event = win.Event;
  (globalThis as { KeyboardEvent: typeof KeyboardEvent }).KeyboardEvent = win.KeyboardEvent;
  (globalThis as { DOMParser: typeof DOMParser }).DOMParser = win.DOMParser;

  importFixtureInto(doc, buildDrawerHtml());

  const fetchStub = vi.fn(async () => jsonResponse({}));
  // @ts-expect-error attach to window
  win.fetch = fetchStub;
  const io = installIntersectionObserverStub(win);
  loadAgentJs(doc, win);
  return { win, doc, fetchStub, io };
}

function teardownHarness(): void {
  if (currentDom) {
    try { currentDom.window.close(); } catch (_e) { /* ignore */ }
  }
  currentDom = null;
}

function fetchCalls(stub: ReturnType<typeof vi.fn>): FetchArgs[] {
  return stub.mock.calls.map((c) => [String(c[0]), c[1] as RequestInit | undefined]);
}

function findCall(stub: ReturnType<typeof vi.fn>, prefix: string): FetchArgs | undefined {
  return fetchCalls(stub).find(([url]) => url.startsWith(prefix));
}

function jsonResponse(body: unknown, status = 200): Response {
  // Node 22 ships a global Response (undici) — jsdom doesn't expose one, but
  // since fetch is stubbed we can return a minimal shape that exposes `ok`
  // and `json()` + `text()` the way the production agent.js consumes it.
  const payload = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => JSON.parse(payload) as unknown,
    text: async () => payload,
  } as unknown as Response;
}

function openHistoryPanel(): void {
  const btn = document.querySelector('[data-action="openAgentHistory"]') as HTMLElement;
  btn.click();
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

describe('agent-history client (Plan 35-05)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    teardownHarness();
  });

  it('1. Clicking History button fetches /agent/conversations?limit=20&offset=0 with csrf + same-origin', async () => {
    const h = setupHarness();
    h.fetchStub.mockResolvedValue(jsonResponse({ items: [], nextOffset: null }));
    openHistoryPanel();
    await flush();
    const call = findCall(h.fetchStub, '/agent/conversations?');
    expect(call).toBeDefined();
    const [url, init] = call!;
    expect(url).toContain('limit=20');
    expect(url).toContain('offset=0');
    expect(init?.credentials).toBe('same-origin');
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers['x-csrf-token']).toBe('test-csrf-tok');
  });

  it('2. Panel becomes visible and focus moves to Back button', async () => {
    const h = setupHarness();
    h.fetchStub.mockResolvedValue(jsonResponse({ items: [], nextOffset: null }));
    openHistoryPanel();
    await flush();
    const panel = document.getElementById('agent-history-panel')!;
    expect(panel.getAttribute('aria-hidden')).toBe('false');
    expect(panel.hasAttribute('hidden')).toBe(false);
    const back = document.querySelector('.agent-drawer__history-back');
    expect(document.activeElement).toBe(back);
  });

  it('3. Empty list shows empty state; sentinel observation does not fetch more', async () => {
    const h = setupHarness();
    h.fetchStub.mockResolvedValue(jsonResponse({ items: [], nextOffset: null }));
    openHistoryPanel();
    await flush();
    const list = document.getElementById('agent-history-list')!;
    expect(list.querySelector('.agent-drawer__history-empty')).not.toBeNull();
    const initialCount = h.fetchStub.mock.calls.length;
    h.io.trigger(true);
    await flush();
    expect(h.fetchStub.mock.calls.length).toBe(initialCount);
  });

  it('4. Populated list renders one <li data-conversation-id> per item', async () => {
    const h = setupHarness();
    h.fetchStub.mockResolvedValue(jsonResponse({
      items: [
        { id: 'c1', title: 'First', lastMessageAt: '2026-04-24', messageCount: 3 },
        { id: 'c2', title: 'Second', lastMessageAt: '2026-04-23', messageCount: 2 },
      ],
      nextOffset: null,
    }));
    openHistoryPanel();
    await flush();
    const rows = document.querySelectorAll('#agent-history-list li.agent-drawer__history-item');
    expect(rows.length).toBe(2);
    expect(rows[0].getAttribute('data-conversation-id')).toBe('c1');
    expect(rows[1].getAttribute('data-conversation-id')).toBe('c2');
  });

  it('5. Search debounces 250ms — 4 keystrokes within 240ms fire zero requests; after +250ms exactly one search request', async () => {
    const h = setupHarness();
    h.fetchStub.mockResolvedValue(jsonResponse({ items: [], nextOffset: null }));
    openHistoryPanel();
    await flush();
    h.fetchStub.mockClear();
    const input = document.getElementById('agent-history-search-input') as HTMLInputElement;
    const fire = (v: string) => {
      input.value = v;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    fire('w'); vi.advanceTimersByTime(60);
    fire('wc'); vi.advanceTimersByTime(60);
    fire('wca'); vi.advanceTimersByTime(60);
    fire('wcag'); vi.advanceTimersByTime(60);
    await flush();
    const before = findCall(h.fetchStub, '/agent/conversations/search');
    expect(before).toBeUndefined();
    vi.advanceTimersByTime(300);
    await flush();
    const searchCalls = fetchCalls(h.fetchStub).filter(([u]) => u.startsWith('/agent/conversations/search'));
    expect(searchCalls.length).toBe(1);
    expect(searchCalls[0][0]).toContain('q=wcag');
  });

  it('6. Clearing search restores the un-filtered list without a network call', async () => {
    const h = setupHarness();
    // Initial page 1 fetch
    h.fetchStub.mockResolvedValueOnce(jsonResponse({
      items: [{ id: 'a', title: 'Alpha', lastMessageAt: 't', messageCount: 1 }],
      nextOffset: null,
    }));
    // search fetch
    h.fetchStub.mockResolvedValueOnce(jsonResponse({ items: [] }));
    openHistoryPanel();
    await flush();
    const input = document.getElementById('agent-history-search-input') as HTMLInputElement;
    input.value = 'zz';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(260);
    await flush();
    const beforeClear = h.fetchStub.mock.calls.length;
    const clearBtn = document.querySelector('[data-action="clearAgentHistorySearch"]') as HTMLElement;
    clearBtn.click();
    await flush();
    expect(h.fetchStub.mock.calls.length).toBe(beforeClear);
    const rows = document.querySelectorAll('#agent-history-list li.agent-drawer__history-item');
    expect(rows.length).toBe(1);
    expect(rows[0].getAttribute('data-conversation-id')).toBe('a');
  });

  it('7. Match wrapping is XSS-safe: <mark> has exact match textContent, script tag never enters DOM', async () => {
    const h = setupHarness();
    h.fetchStub.mockResolvedValueOnce(jsonResponse({ items: [], nextOffset: null }));
    h.fetchStub.mockResolvedValueOnce(jsonResponse({
      items: [{
        id: 'x1',
        title: 'Sample',
        snippet: '<script>alert(1)</script>Check WCAG 2.2 AA',
        matchField: 'content',
        lastMessageAt: 't',
        messageCount: 1,
      }],
    }));
    openHistoryPanel();
    await flush();
    const input = document.getElementById('agent-history-search-input') as HTMLInputElement;
    input.value = 'wcag';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(260);
    await flush();
    const mark = document.querySelector('#agent-history-list mark');
    expect(mark).not.toBeNull();
    expect(mark!.textContent).toBe('WCAG');
    expect(document.querySelector('#agent-history-list script')).toBeNull();
    const snippetEl = document.querySelector('.agent-drawer__history-item-snippet');
    expect(snippetEl!.textContent).toContain('<script>');
  });

  it('8. IntersectionObserver isIntersecting fires next page fetch offset=20', async () => {
    const h = setupHarness();
    h.fetchStub.mockResolvedValueOnce(jsonResponse({
      items: [{ id: 'a', title: 'A', lastMessageAt: 't', messageCount: 1 }],
      nextOffset: 20,
    }));
    openHistoryPanel();
    await flush();
    h.fetchStub.mockResolvedValueOnce(jsonResponse({
      items: [{ id: 'b', title: 'B', lastMessageAt: 't', messageCount: 1 }],
      nextOffset: null,
    }));
    h.io.trigger(true);
    await flush();
    const call = fetchCalls(h.fetchStub).find(([u]) => u.includes('offset=20'));
    expect(call).toBeDefined();
  });

  it('9. Three-dot click sets aria-expanded=true on trigger and shows menu', async () => {
    const h = setupHarness();
    h.fetchStub.mockResolvedValueOnce(jsonResponse({
      items: [{ id: 'c1', title: 'First', lastMessageAt: 't', messageCount: 1 }],
      nextOffset: null,
    }));
    openHistoryPanel();
    await flush();
    const trigger = document.querySelector('.agent-drawer__history-item-menu') as HTMLElement;
    trigger.click();
    await flush();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const menu = document.querySelector('.agent-drawer__history-menu') as HTMLElement | null;
    expect(menu).not.toBeNull();
    expect(menu!.hasAttribute('hidden')).toBe(false);
  });

  it('10. Shift+F10 on focused list item opens the menu', async () => {
    const h = setupHarness();
    h.fetchStub.mockResolvedValueOnce(jsonResponse({
      items: [{ id: 'c1', title: 'First', lastMessageAt: 't', messageCount: 1 }],
      nextOffset: null,
    }));
    openHistoryPanel();
    await flush();
    const row = document.querySelector('.agent-drawer__history-item') as HTMLElement;
    row.focus();
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true }));
    await flush();
    const menu = document.querySelector('.agent-drawer__history-menu') as HTMLElement | null;
    expect(menu).not.toBeNull();
    expect(menu!.hasAttribute('hidden')).toBe(false);
  });

  it('11. Rename menu click replaces row with an <input> (focused with value)', async () => {
    const h = setupHarness();
    h.fetchStub.mockResolvedValueOnce(jsonResponse({
      items: [{ id: 'c1', title: 'Hello', lastMessageAt: 't', messageCount: 1 }],
      nextOffset: null,
    }));
    openHistoryPanel();
    await flush();
    (document.querySelector('.agent-drawer__history-item-menu') as HTMLElement).click();
    await flush();
    const rename = document.querySelector('[data-action="renameConversation"]') as HTMLElement;
    expect(rename).not.toBeNull();
    rename.click();
    await flush();
    const input = document.querySelector('.agent-drawer__history-rename input') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe('Hello');
    expect(document.activeElement).toBe(input);
  });

  it('12. Rename Enter POSTs /rename with csrf + JSON body {title}', async () => {
    const h = setupHarness();
    h.fetchStub.mockResolvedValueOnce(jsonResponse({
      items: [{ id: 'c1', title: 'Hello', lastMessageAt: 't', messageCount: 1 }],
      nextOffset: null,
    }));
    openHistoryPanel();
    await flush();
    (document.querySelector('.agent-drawer__history-item-menu') as HTMLElement).click();
    await flush();
    (document.querySelector('[data-action="renameConversation"]') as HTMLElement).click();
    await flush();
    h.fetchStub.mockResolvedValueOnce(jsonResponse({ id: 'c1', title: 'NewTitle' }));
    const input = document.querySelector('.agent-drawer__history-rename input') as HTMLInputElement;
    input.value = 'NewTitle';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    const call = fetchCalls(h.fetchStub).find(([u]) => u.includes('/agent/conversations/c1/rename'));
    expect(call).toBeDefined();
    const [, init] = call!;
    expect(init?.method).toBe('POST');
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers['x-csrf-token']).toBe('test-csrf-tok');
    expect(JSON.parse(String(init?.body))).toEqual({ title: 'NewTitle' });
  });

  it('13. Rename server error renders .form-hint--error under input; input keeps focus/value', async () => {
    const h = setupHarness();
    h.fetchStub.mockResolvedValueOnce(jsonResponse({
      items: [{ id: 'c1', title: 'Hello', lastMessageAt: 't', messageCount: 1 }],
      nextOffset: null,
    }));
    openHistoryPanel();
    await flush();
    (document.querySelector('.agent-drawer__history-item-menu') as HTMLElement).click();
    await flush();
    (document.querySelector('[data-action="renameConversation"]') as HTMLElement).click();
    await flush();
    h.fetchStub.mockResolvedValueOnce(jsonResponse({ error: 'server' }, 500));
    const input = document.querySelector('.agent-drawer__history-rename input') as HTMLInputElement;
    input.value = 'Broken';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    await flush();
    const err = document.querySelector('.agent-drawer__history-rename .form-hint--error');
    expect(err).not.toBeNull();
    expect(input.value).toBe('Broken');
    expect(document.activeElement).toBe(input);
  });

  it('14. Delete menu click replaces row with confirm row; focus on Cancel', async () => {
    const h = setupHarness();
    h.fetchStub.mockResolvedValueOnce(jsonResponse({
      items: [{ id: 'c1', title: 'Hello', lastMessageAt: 't', messageCount: 1 }],
      nextOffset: null,
    }));
    openHistoryPanel();
    await flush();
    (document.querySelector('.agent-drawer__history-item-menu') as HTMLElement).click();
    await flush();
    (document.querySelector('[data-action="deleteConversation"]') as HTMLElement).click();
    await flush();
    const confirm = document.querySelector('.agent-drawer__history-confirm');
    expect(confirm).not.toBeNull();
    const cancel = confirm!.querySelector('[data-action="cancelDelete"]');
    expect(document.activeElement).toBe(cancel);
  });

  it('15. Delete confirm fires POST /delete and removes the <li> on 200', async () => {
    const h = setupHarness();
    h.fetchStub.mockResolvedValueOnce(jsonResponse({
      items: [{ id: 'c1', title: 'Hello', lastMessageAt: 't', messageCount: 1 }],
      nextOffset: null,
    }));
    openHistoryPanel();
    await flush();
    (document.querySelector('.agent-drawer__history-item-menu') as HTMLElement).click();
    await flush();
    (document.querySelector('[data-action="deleteConversation"]') as HTMLElement).click();
    await flush();
    h.fetchStub.mockResolvedValueOnce(jsonResponse({ ok: true }));
    (document.querySelector('[data-action="confirmDelete"]') as HTMLElement).click();
    await flush();
    await flush();
    const call = fetchCalls(h.fetchStub).find(([u]) => u.includes('/agent/conversations/c1/delete'));
    expect(call).toBeDefined();
    expect(call![1]?.method).toBe('POST');
    expect(document.querySelector('[data-conversation-id="c1"]')).toBeNull();
  });

  it('16. Delete Cancel restores original row without network', async () => {
    const h = setupHarness();
    h.fetchStub.mockResolvedValueOnce(jsonResponse({
      items: [{ id: 'c1', title: 'Hello', lastMessageAt: 't', messageCount: 1 }],
      nextOffset: null,
    }));
    openHistoryPanel();
    await flush();
    (document.querySelector('.agent-drawer__history-item-menu') as HTMLElement).click();
    await flush();
    (document.querySelector('[data-action="deleteConversation"]') as HTMLElement).click();
    await flush();
    const before = h.fetchStub.mock.calls.length;
    (document.querySelector('[data-action="cancelDelete"]') as HTMLElement).click();
    await flush();
    expect(h.fetchStub.mock.calls.length).toBe(before);
    const row = document.querySelector('[data-conversation-id="c1"]');
    expect(row).not.toBeNull();
    expect(row!.querySelector('.agent-drawer__history-confirm')).toBeNull();
  });

  it('17. Clicking a row GETs /agent/conversations/:id and closes the panel', async () => {
    const h = setupHarness();
    h.fetchStub.mockResolvedValueOnce(jsonResponse({
      items: [{ id: 'c1', title: 'Hello', lastMessageAt: 't', messageCount: 1 }],
      nextOffset: null,
    }));
    openHistoryPanel();
    await flush();
    h.fetchStub.mockResolvedValueOnce(jsonResponse({
      conversation: { id: 'c1', title: 'Hello' },
      messages: [],
    }));
    const row = document.querySelector('.agent-drawer__history-item') as HTMLElement;
    row.click();
    await flush();
    await flush();
    const call = fetchCalls(h.fetchStub).find(([u]) => u === '/agent/conversations/c1' || u.startsWith('/agent/conversations/c1?'));
    expect(call).toBeDefined();
    const panel = document.getElementById('agent-history-panel')!;
    expect(panel.getAttribute('aria-hidden')).toBe('true');
  });

  it('18. Esc with menu open closes menu and returns focus to trigger', async () => {
    const h = setupHarness();
    h.fetchStub.mockResolvedValueOnce(jsonResponse({
      items: [{ id: 'c1', title: 'Hello', lastMessageAt: 't', messageCount: 1 }],
      nextOffset: null,
    }));
    openHistoryPanel();
    await flush();
    const trigger = document.querySelector('.agent-drawer__history-item-menu') as HTMLElement;
    trigger.click();
    await flush();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flush();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  it('19. Esc with panel open (no menu) closes panel, focus returns to History button', async () => {
    const h = setupHarness();
    h.fetchStub.mockResolvedValueOnce(jsonResponse({ items: [], nextOffset: null }));
    openHistoryPanel();
    await flush();
    const panel = document.getElementById('agent-history-panel')!;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flush();
    expect(panel.getAttribute('aria-hidden')).toBe('true');
    const openBtn = document.querySelector('[data-action="openAgentHistory"]');
    expect(document.activeElement).toBe(openBtn);
  });

  it('20. ArrowDown moves roving tabindex: previous row tabindex=-1, next=0, and focused', async () => {
    const h = setupHarness();
    h.fetchStub.mockResolvedValueOnce(jsonResponse({
      items: [
        { id: 'c1', title: 'A', lastMessageAt: 't', messageCount: 1 },
        { id: 'c2', title: 'B', lastMessageAt: 't', messageCount: 1 },
      ],
      nextOffset: null,
    }));
    openHistoryPanel();
    await flush();
    const rows = document.querySelectorAll('#agent-history-list li.agent-drawer__history-item');
    const first = rows[0] as HTMLElement;
    const second = rows[1] as HTMLElement;
    first.setAttribute('tabindex', '0');
    first.focus();
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await flush();
    expect(first.getAttribute('tabindex')).toBe('-1');
    expect(second.getAttribute('tabindex')).toBe('0');
    expect(document.activeElement).toBe(second);
  });
});
