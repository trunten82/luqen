/*
 * Phase 37 Plan 04 — Per-message action handlers (JSDOM client tests).
 *
 * Loads src/static/agent.js into a fresh JSDOM per test (mirrors the harness
 * from agent-history.test.ts). Exercises:
 *   Task 1 — markdownSourceById accumulation, getMarkdownSource fallback,
 *            writeToClipboard primary + execCommand fallback, announce().
 *   Task 2 — stop, retry, copy, share delegated handlers.
 *   Task 3 — edit / cancel / submitEditUserMessage flow.
 *
 * Test exports surface: agent.js opts into a thin debug shim when
 * window.__agentTestMode === true. The shim sticks the helpers we need to
 * exercise (writeToClipboard, announce, getMarkdownSource, markdownSourceById)
 * onto window.__agentTestExports. Production builds never set
 * __agentTestMode so the shim is dead code at runtime.
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_JS_PATH = resolve(__dirname, '..', '..', 'src', 'static', 'agent.js');
const AGENT_JS_SOURCE = readFileSync(AGENT_JS_PATH, 'utf8');

interface AgentTestExports {
  writeToClipboard(text: string): Promise<boolean>;
  announce(message: string): void;
  getMarkdownSource(messageId: string, conversationId: string): Promise<string>;
  recordMarkdownSource(messageId: string, text: string): void;
  readMarkdownSource(messageId: string): string | undefined;
}

interface Harness {
  readonly win: Window & typeof globalThis;
  readonly doc: Document;
  readonly fetchStub: ReturnType<typeof vi.fn>;
  readonly clipboardStub: ReturnType<typeof vi.fn>;
  readonly execCommandStub: ReturnType<typeof vi.fn>;
  readonly eventSourceCalls: string[];
  exports(): AgentTestExports;
}

let currentDom: JSDOM | null = null;

function appendParsed(target: Element, html: string): void {
  // Use DOMParser (CSP-safe equivalent of innerHTML for trusted test fixtures).
  const parsed = new DOMParser().parseFromString(
    `<!DOCTYPE html><html><body>${html}</body></html>`, 'text/html');
  const body = parsed.body;
  while (body.firstChild) {
    target.appendChild(target.ownerDocument!.importNode(body.firstChild, true));
    body.removeChild(body.firstChild);
  }
}

function buildDrawerHtml(conversationId = 'c1'): string {
  return `
    <meta name="csrf-token" content="test-csrf-tok">
    <button id="agent-launch" data-action="toggleAgentDrawer"></button>
    <aside id="agent-drawer" class="agent-drawer" aria-label="Agent">
      <div class="agent-drawer__messages" id="agent-messages" role="log"></div>
      <div class="agent-drawer__stream-status" id="agent-stream-status" role="status" aria-live="polite" hidden>
        <button type="button" class="btn btn--ghost btn--sm" id="agent-stop">Stop</button>
      </div>
      <form id="agent-form" data-conversation-id="${conversationId}"></form>
      <script type="application/json" id="agent-tools-i18n">{
        "actions.copied": "Copied to clipboard",
        "actions.copyFailed": "Could not copy",
        "actions.shareCreated": "Share link copied to clipboard",
        "actions.shareFailed": "Could not create share link",
        "actions.stopped": "Stopped by user",
        "actions.stopFailed": "Could not stop",
        "actions.retryFailed": "Could not retry",
        "actions.editEmpty": "Message cannot be empty",
        "actions.editFailed": "Could not save edit"
      }</script>
    </aside>
  `;
}

function importFixtureInto(doc: Document, html: string): void {
  while (doc.body.firstChild) doc.body.removeChild(doc.body.firstChild);
  while (doc.head.firstChild) doc.head.removeChild(doc.head.firstChild);
  const parsed = new DOMParser().parseFromString(
    `<!DOCTYPE html><html><head></head><body>${html}</body></html>`,
    'text/html',
  );
  const meta = parsed.querySelector('meta[name="csrf-token"]');
  if (meta) doc.head.appendChild(doc.importNode(meta, true));
  for (const node of Array.from(parsed.body.childNodes)) {
    if (node.nodeType === 1 && (node as Element).tagName === 'META') continue;
    doc.body.appendChild(doc.importNode(node, true));
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  const payload = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => JSON.parse(payload) as unknown,
    text: async () => payload,
  } as unknown as Response;
}

function htmlResponse(html: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'text/html' }),
    json: async () => { throw new Error('not json'); },
    text: async () => html,
  } as unknown as Response;
}

function setupHarness(opts?: {
  noClipboard?: boolean;
  execCommandResult?: boolean;
  conversationId?: string;
  initialMessages?: string;
}): Harness {
  const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body></body></html>`, {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });
  currentDom = dom;
  const win = dom.window as unknown as Window & typeof globalThis;
  const doc = win.document;
  // Bridge globals
  (globalThis as { document: Document }).document = doc;
  (globalThis as { window: Window }).window = win;
  (globalThis as { HTMLElement: typeof HTMLElement }).HTMLElement = win.HTMLElement;
  (globalThis as { HTMLInputElement: typeof HTMLInputElement }).HTMLInputElement = win.HTMLInputElement;
  (globalThis as { HTMLFormElement: typeof HTMLFormElement }).HTMLFormElement = win.HTMLFormElement;
  (globalThis as { HTMLTextAreaElement: typeof HTMLTextAreaElement }).HTMLTextAreaElement = win.HTMLTextAreaElement;
  (globalThis as { Event: typeof Event }).Event = win.Event;
  (globalThis as { KeyboardEvent: typeof KeyboardEvent }).KeyboardEvent = win.KeyboardEvent;
  (globalThis as { DOMParser: typeof DOMParser }).DOMParser = win.DOMParser;

  importFixtureInto(doc, buildDrawerHtml(opts?.conversationId ?? 'c1'));
  if (opts?.initialMessages) {
    const msgs = doc.getElementById('agent-messages')!;
    appendParsed(msgs, opts.initialMessages);
  }

  const fetchStub = vi.fn(async () => jsonResponse({}));
  // @ts-expect-error attach to window
  win.fetch = fetchStub;

  const clipboardStub = vi.fn(async (_t: string) => undefined);
  if (!opts?.noClipboard) {
    Object.defineProperty(win.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboardStub },
    });
    Object.defineProperty(win, 'isSecureContext', { configurable: true, value: true });
  } else {
    Object.defineProperty(win, 'isSecureContext', { configurable: true, value: false });
  }

  const execCommandResult = opts?.execCommandResult !== false;
  const execCommandStub = vi.fn(() => execCommandResult);
  // @ts-expect-error
  doc.execCommand = execCommandStub;

  const eventSourceCalls: string[] = [];
  class FakeEventSource {
    readonly url: string;
    readonly listeners: Record<string, Array<(ev: { data: string }) => void>> = {};
    closed = false;
    constructor(url: string) {
      this.url = url;
      eventSourceCalls.push(url);
    }
    addEventListener(name: string, cb: (ev: { data: string }) => void) {
      (this.listeners[name] ??= []).push(cb);
    }
    removeEventListener() { /* noop */ }
    close() { this.closed = true; }
    emit(name: string, data: unknown) {
      const cbs = this.listeners[name] ?? [];
      for (const cb of cbs) cb({ data: JSON.stringify(data) });
    }
  }
  // @ts-expect-error attach
  win.EventSource = FakeEventSource;
  // @ts-expect-error
  globalThis.EventSource = FakeEventSource;

  // Opt into the test-export shim before loading.
  // @ts-expect-error
  win.__agentTestMode = true;

  const fn = new win.Function(
    'window', 'document', 'localStorage', 'fetch',
    AGENT_JS_SOURCE,
  );
  fn.call(win, win, doc, win.localStorage, win.fetch);

  return {
    win,
    doc,
    fetchStub,
    clipboardStub,
    execCommandStub,
    eventSourceCalls,
    exports() {
      // @ts-expect-error
      return win.__agentTestExports as AgentTestExports;
    },
  };
}

function teardownHarness(): void {
  if (currentDom) {
    try { currentDom.window.close(); } catch (_e) { /* ignore */ }
  }
  currentDom = null;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
}

function fetchCalls(stub: ReturnType<typeof vi.fn>): Array<[string, RequestInit | undefined]> {
  return stub.mock.calls.map((c) => [String(c[0]), c[1] as RequestInit | undefined]);
}

function findCall(stub: ReturnType<typeof vi.fn>, predicate: (url: string) => boolean) {
  return fetchCalls(stub).find(([u]) => predicate(u));
}

function makeAssistantBubble(id: string): string {
  return `<div class="agent-msg agent-msg--assistant" data-message-id="${id}" data-status="final">
    <span class="agent-msg__role">Assistant</span>
    <div class="agent-msg__body">Some bold markdown</div>
    <div class="agent-msg__actions">
      <button type="button" class="agent-msg__action" data-action="retryAssistant" data-message-id="${id}" aria-label="Retry">R</button>
      <button type="button" class="agent-msg__action" data-action="copyAssistant" data-message-id="${id}" aria-label="Copy">C</button>
      <button type="button" class="agent-msg__action" data-action="shareAssistant" data-message-id="${id}" aria-label="Share">S</button>
    </div>
  </div>`;
}

function makeUserBubble(id: string, text: string, mostRecent = true): string {
  const actions = mostRecent
    ? `<div class="agent-msg__actions agent-msg__actions--user">
         <button type="button" class="agent-msg__action" data-action="editUserMessage" data-message-id="${id}" aria-label="Edit">E</button>
       </div>`
    : '';
  return `<div class="agent-msg agent-msg--user" data-message-id="${id}" data-status="sent">
    <span class="agent-msg__role">You</span>
    <div class="agent-msg__body">${text}</div>
    ${actions}
  </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Task 1 — primitives
// ─────────────────────────────────────────────────────────────────────────────

describe('agent.js per-message primitives — Task 1', () => {
  afterEach(() => { teardownHarness(); });

  it('1. writeToClipboard primary path uses navigator.clipboard.writeText', async () => {
    const h = setupHarness();
    const ok = await h.exports().writeToClipboard('hello');
    expect(ok).toBe(true);
    expect(h.clipboardStub).toHaveBeenCalledWith('hello');
  });

  it('2. writeToClipboard fallback uses execCommand("copy") when clipboard API absent', async () => {
    const h = setupHarness({ noClipboard: true });
    const ok = await h.exports().writeToClipboard('legacy');
    expect(ok).toBe(true);
    expect(h.execCommandStub).toHaveBeenCalledWith('copy');
  });

  it('3. writeToClipboard returns false when both paths fail', async () => {
    const h = setupHarness({ noClipboard: true, execCommandResult: false });
    const ok = await h.exports().writeToClipboard('nope');
    expect(ok).toBe(false);
  });

  it('4. announce() updates #agent-aria-live textContent', async () => {
    const h = setupHarness();
    h.exports().announce('Copied to clipboard');
    await flush();
    const live = h.doc.getElementById('agent-aria-live');
    expect(live).not.toBeNull();
    await new Promise((r) => setTimeout(r, 30));
    expect(live!.textContent).toBe('Copied to clipboard');
  });

  it('5. recordMarkdownSource stores text by message id', () => {
    const h = setupHarness();
    h.exports().recordMarkdownSource('mid-1', 'Hello bold');
    expect(h.exports().readMarkdownSource('mid-1')).toBe('Hello bold');
  });

  it('6. getMarkdownSource falls back to GET when map miss', async () => {
    const h = setupHarness();
    h.fetchStub.mockResolvedValueOnce(jsonResponse({ id: 'mid-2', content: 'fetched md' }));
    const text = await h.exports().getMarkdownSource('mid-2', 'c1');
    expect(text).toBe('fetched md');
    const call = findCall(h.fetchStub, (u) => u.includes('/agent/conversations/c1/messages/mid-2'));
    expect(call).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 2 — stop / retry / copy / share handlers
// ─────────────────────────────────────────────────────────────────────────────

describe('agent.js delegated action handlers — Task 2', () => {
  afterEach(() => { teardownHarness(); });

  it('7. retryAssistant POSTs /retry with csrf and re-opens stream', async () => {
    const h = setupHarness({ initialMessages: makeAssistantBubble('a1') });
    h.fetchStub.mockResolvedValueOnce(jsonResponse({ conversationId: 'c1', retried: true }));
    const btn = h.doc.querySelector('[data-action="retryAssistant"]') as HTMLElement;
    btn.click();
    await flush();
    const call = findCall(h.fetchStub, (u) => u.includes('/agent/conversations/c1/messages/a1/retry'));
    expect(call).toBeDefined();
    const [, init] = call!;
    expect(init?.method).toBe('POST');
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers['x-csrf-token']).toBe('test-csrf-tok');
    await flush();
    expect(h.doc.querySelector('[data-message-id="a1"]')).toBeNull();
    expect(h.eventSourceCalls.some((u) => u.includes('/agent/stream/c1'))).toBe(true);
  });

  it('8. retryAssistant failure re-enables button and announces error', async () => {
    const h = setupHarness({ initialMessages: makeAssistantBubble('a1') });
    h.fetchStub.mockResolvedValueOnce(jsonResponse({ error: 'nope' }, 400));
    const btn = h.doc.querySelector('[data-action="retryAssistant"]') as HTMLButtonElement;
    btn.click();
    await flush();
    expect(btn.disabled).toBe(false);
    await new Promise((r) => setTimeout(r, 30));
    const live = h.doc.getElementById('agent-aria-live');
    expect(live?.textContent ?? '').toMatch(/retry|Could/i);
  });

  it('9. copyAssistant uses cached markdownSource when present', async () => {
    const h = setupHarness({ initialMessages: makeAssistantBubble('a1') });
    h.exports().recordMarkdownSource('a1', 'cached md');
    const btn = h.doc.querySelector('[data-action="copyAssistant"]') as HTMLElement;
    btn.click();
    await flush();
    expect(h.clipboardStub).toHaveBeenCalledWith('cached md');
    expect(findCall(h.fetchStub, (u) => u.includes('/messages/a1') && !u.includes('/retry') && !u.includes('/share'))).toBeUndefined();
  });

  it('10. copyAssistant falls back to GET when source not cached', async () => {
    const h = setupHarness({ initialMessages: makeAssistantBubble('a1') });
    h.fetchStub.mockResolvedValueOnce(jsonResponse({ id: 'a1', content: 'server md' }));
    const btn = h.doc.querySelector('[data-action="copyAssistant"]') as HTMLElement;
    btn.click();
    await flush();
    expect(h.clipboardStub).toHaveBeenCalledWith('server md');
  });

  it('11. copyAssistant clipboard failure announces failure', async () => {
    const h = setupHarness({ noClipboard: true, execCommandResult: false, initialMessages: makeAssistantBubble('a1') });
    h.exports().recordMarkdownSource('a1', 'cached');
    const btn = h.doc.querySelector('[data-action="copyAssistant"]') as HTMLElement;
    btn.click();
    await flush();
    await new Promise((r) => setTimeout(r, 30));
    const live = h.doc.getElementById('agent-aria-live');
    expect(live?.textContent ?? '').toMatch(/Could not copy|copyFailed/i);
  });

  it('12. shareAssistant POSTs /share, copies returned URL, announces success', async () => {
    const h = setupHarness({ initialMessages: makeAssistantBubble('a1') });
    h.fetchStub.mockResolvedValueOnce(jsonResponse({ shareId: 'sh1', url: '/agent/share/sh1' }, 201));
    const btn = h.doc.querySelector('[data-action="shareAssistant"]') as HTMLElement;
    btn.click();
    await flush();
    const call = findCall(h.fetchStub, (u) => u.includes('/agent/conversations/c1/messages/a1/share'));
    expect(call).toBeDefined();
    expect(call![1]?.method).toBe('POST');
    expect(h.clipboardStub).toHaveBeenCalledWith('http://localhost/agent/share/sh1');
    await new Promise((r) => setTimeout(r, 30));
    const live = h.doc.getElementById('agent-aria-live');
    expect(live?.textContent ?? '').toMatch(/Share link|shareCreated/i);
  });

  it('13. shareAssistant failure announces failure and re-enables button', async () => {
    const h = setupHarness({ initialMessages: makeAssistantBubble('a1') });
    h.fetchStub.mockResolvedValueOnce(jsonResponse({ error: 'oops' }, 400));
    const btn = h.doc.querySelector('[data-action="shareAssistant"]') as HTMLButtonElement;
    btn.click();
    await flush();
    expect(btn.disabled).toBe(false);
    await new Promise((r) => setTimeout(r, 30));
    const live = h.doc.getElementById('agent-aria-live');
    expect(live?.textContent ?? '').toMatch(/share/i);
  });

  it('14. #agent-stop click closes activeStream and announces stopped', async () => {
    const h = setupHarness({ initialMessages: makeAssistantBubble('a1') });
    h.fetchStub.mockResolvedValueOnce(jsonResponse({ conversationId: 'c1', retried: true }));
    (h.doc.querySelector('[data-action="retryAssistant"]') as HTMLElement).click();
    await flush();
    expect(h.eventSourceCalls.length).toBeGreaterThan(0);
    const stopBtn = h.doc.getElementById('agent-stop') as HTMLButtonElement;
    stopBtn.click();
    await flush();
    await new Promise((r) => setTimeout(r, 30));
    const live = h.doc.getElementById('agent-aria-live');
    expect(live?.textContent ?? '').toMatch(/Stopped|stopped/i);
  });

  it('15. retryAssistant ignores click when no message-id present', async () => {
    const h = setupHarness();
    const msgs = h.doc.getElementById('agent-messages')!;
    appendParsed(msgs, `<button data-action="retryAssistant" id="bad-btn">x</button>`);
    h.fetchStub.mockClear();
    (h.doc.getElementById('bad-btn') as HTMLElement).click();
    await flush();
    expect(h.fetchStub).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 3 — edit / cancel / submit handlers
// ─────────────────────────────────────────────────────────────────────────────

describe('agent.js edit-and-resend handlers — Task 3', () => {
  afterEach(() => { teardownHarness(); });

  function editFormHtml(id: string, content: string): string {
    return `<form class="agent-msg__edit-form" data-action="submitEditUserMessage" data-message-id="${id}">
      <textarea name="content">${content}</textarea>
      <div class="agent-msg__edit-buttons">
        <button type="submit">Save</button>
        <button type="button" data-action="cancelEditUserMessage" data-message-id="${id}">Cancel</button>
      </div>
    </form>`;
  }

  it('16. editUserMessage GETs edit-form partial and swaps body', async () => {
    const h = setupHarness({ initialMessages: makeUserBubble('u1', 'original text') });
    h.fetchStub.mockResolvedValueOnce(htmlResponse(editFormHtml('u1', 'original text')));
    (h.doc.querySelector('[data-action="editUserMessage"]') as HTMLElement).click();
    await flush();
    const call = findCall(h.fetchStub, (u) => u.includes('/agent/conversations/c1/messages/u1/edit-form'));
    expect(call).toBeDefined();
    const ta = h.doc.querySelector('.agent-msg[data-message-id="u1"] textarea') as HTMLTextAreaElement | null;
    expect(ta).not.toBeNull();
    expect(ta!.value).toBe('original text');
  });

  it('17. submit with valid content POSTs /edit-resend then re-opens stream', async () => {
    const h = setupHarness({ initialMessages: makeUserBubble('u1', 'orig') });
    h.fetchStub.mockResolvedValueOnce(htmlResponse(editFormHtml('u1', 'orig')));
    (h.doc.querySelector('[data-action="editUserMessage"]') as HTMLElement).click();
    await flush();
    h.fetchStub.mockResolvedValueOnce(jsonResponse({ conversationId: 'c1', newUserMessageId: 'u2' }));
    h.fetchStub.mockResolvedValueOnce(htmlResponse(
      '<div class="agent-msg agent-msg--user" data-message-id="u2"><div class="agent-msg__body">edited</div></div>'));
    const ta = h.doc.querySelector('.agent-msg[data-message-id="u1"] textarea') as HTMLTextAreaElement;
    ta.value = 'edited content';
    const form = h.doc.querySelector('form[data-action="submitEditUserMessage"]') as HTMLFormElement;
    form.dispatchEvent(new h.win.Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    const editCall = findCall(h.fetchStub, (u) => u.includes('/messages/u1/edit-resend'));
    expect(editCall).toBeDefined();
    expect(editCall![1]?.method).toBe('POST');
    expect(JSON.parse(String(editCall![1]?.body))).toEqual({ content: 'edited content' });
    await flush();
    expect(h.eventSourceCalls.some((u) => u.includes('/agent/stream/c1'))).toBe(true);
  });

  it('18. submit with empty content does not POST and announces error', async () => {
    const h = setupHarness({ initialMessages: makeUserBubble('u1', 'orig') });
    h.fetchStub.mockResolvedValueOnce(htmlResponse(editFormHtml('u1', 'orig')));
    (h.doc.querySelector('[data-action="editUserMessage"]') as HTMLElement).click();
    await flush();
    const ta = h.doc.querySelector('.agent-msg[data-message-id="u1"] textarea') as HTMLTextAreaElement;
    ta.value = '   ';
    h.fetchStub.mockClear();
    const form = h.doc.querySelector('form[data-action="submitEditUserMessage"]') as HTMLFormElement;
    form.dispatchEvent(new h.win.Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    expect(findCall(h.fetchStub, (u) => u.includes('/edit-resend'))).toBeUndefined();
    await new Promise((r) => setTimeout(r, 30));
    const live = h.doc.getElementById('agent-aria-live');
    expect(live?.textContent ?? '').toMatch(/empty|cannot/i);
  });

  it('19. submit failure (400) keeps form open and announces error', async () => {
    const h = setupHarness({ initialMessages: makeUserBubble('u1', 'orig') });
    h.fetchStub.mockResolvedValueOnce(htmlResponse(editFormHtml('u1', 'orig')));
    (h.doc.querySelector('[data-action="editUserMessage"]') as HTMLElement).click();
    await flush();
    h.fetchStub.mockResolvedValueOnce(jsonResponse({ error: 'not_most_recent_user' }, 400));
    const ta = h.doc.querySelector('.agent-msg[data-message-id="u1"] textarea') as HTMLTextAreaElement;
    ta.value = 'edited';
    const form = h.doc.querySelector('form[data-action="submitEditUserMessage"]') as HTMLFormElement;
    form.dispatchEvent(new h.win.Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    expect(h.doc.querySelector('form[data-action="submitEditUserMessage"]')).not.toBeNull();
    await new Promise((r) => setTimeout(r, 30));
    const live = h.doc.getElementById('agent-aria-live');
    expect(live?.textContent ?? '').toMatch(/edit/i);
  });

  it('20. cancel restores original body text', async () => {
    const h = setupHarness({ initialMessages: makeUserBubble('u1', 'pristine value') });
    h.fetchStub.mockResolvedValueOnce(htmlResponse(editFormHtml('u1', 'pristine value')));
    (h.doc.querySelector('[data-action="editUserMessage"]') as HTMLElement).click();
    await flush();
    (h.doc.querySelector('[data-action="cancelEditUserMessage"]') as HTMLElement).click();
    await flush();
    const body = h.doc.querySelector('.agent-msg[data-message-id="u1"] .agent-msg__body');
    expect(body).not.toBeNull();
    expect(body!.textContent?.trim()).toBe('pristine value');
    expect(h.doc.querySelector('[data-action="editUserMessage"][data-message-id="u1"]')).not.toBeNull();
  });

  it('21. edit-form GET failure announces error and leaves bubble intact', async () => {
    const h = setupHarness({ initialMessages: makeUserBubble('u1', 'orig text') });
    h.fetchStub.mockResolvedValueOnce(jsonResponse({ error: 'not_most_recent_user' }, 400));
    (h.doc.querySelector('[data-action="editUserMessage"]') as HTMLElement).click();
    await flush();
    const body = h.doc.querySelector('.agent-msg[data-message-id="u1"] .agent-msg__body');
    expect(body?.textContent?.trim()).toBe('orig text');
    await new Promise((r) => setTimeout(r, 30));
    const live = h.doc.getElementById('agent-aria-live');
    expect(live?.textContent ?? '').toMatch(/edit|fail|could/i);
  });
});
