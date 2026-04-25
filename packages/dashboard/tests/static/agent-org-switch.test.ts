/*
 * Phase 38 Plan 04 — Org switcher (AORG-01..03) JSDOM client tests.
 *
 * Loads src/static/agent.js into a fresh JSDOM per test. Exercises:
 *   - Delegated change handler on form[data-action=agentOrgSwitch]:
 *     POST /agent/active-org body shape, CSRF header, conversationId
 *     reset on success, toast textContent (no markup), rollback on
 *     403/500.
 *   - autoSwitchOrgIfNeeded: cross-org card click POSTs first, same-org
 *     is a no-op, missing switcher is a no-op (non-admin viewer).
 *   - History card render: data-org-id / data-org-name attrs + chip
 *     rendered for admin viewers, suppressed otherwise.
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_JS_PATH = resolve(__dirname, '..', '..', 'src', 'static', 'agent.js');
const AGENT_JS_SOURCE = readFileSync(AGENT_JS_PATH, 'utf8');
// Phase 39.1-02 — org switcher lives in agent-org.js. The test harness must
// load it after agent.js so the delegated change handler + test export shim
// are wired up in the JSDOM realm.
const AGENT_ORG_JS_PATH = resolve(__dirname, '..', '..', 'src', 'static', 'agent-org.js');
const AGENT_ORG_JS_SOURCE = readFileSync(AGENT_ORG_JS_PATH, 'utf8');

interface AgentTestExports {
  handleAgentOrgSwitch(form: HTMLFormElement): void;
  autoSwitchOrgIfNeeded(orgId: string, orgName: string): Promise<boolean>;
  getConversationId(): string;
  setHistoryShowOrgChip(v: boolean): void;
  renderHistoryItem(
    item: { id: string; title?: string; orgId?: string; orgName?: string },
    query: string,
    opts?: { showOrgChip?: boolean },
  ): HTMLLIElement;
}

interface Harness {
  readonly win: Window & typeof globalThis;
  readonly doc: Document;
  readonly fetchStub: ReturnType<typeof vi.fn>;
  exports(): AgentTestExports;
}

let currentDom: JSDOM | null = null;

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

function buildFixture(opts: { admin: boolean; activeOrgId?: string; conversationId?: string }): string {
  const switcher = opts.admin
    ? `<form class="agent-drawer__org-switcher" data-action="agentOrgSwitch" autocomplete="off">
         <label class="agent-drawer__org-switcher-label" for="agent-org-select">Active org</label>
         <select id="agent-org-select" name="orgId" class="agent-drawer__org-switcher-select" data-previous-org-id="${opts.activeOrgId || 'A'}">
           <option value="A" ${opts.activeOrgId === 'A' || !opts.activeOrgId ? 'selected' : ''}>OrgA</option>
           <option value="B" ${opts.activeOrgId === 'B' ? 'selected' : ''}>OrgB</option>
         </select>
         <output class="agent-drawer__toast agent-drawer__toast--org" data-role="orgToast" aria-live="polite"></output>
       </form>`
    : '';
  return `
    <meta name="csrf-token" content="test-csrf-tok">
    <button id="agent-launch" data-action="toggleAgentDrawer"></button>
    <aside id="agent-drawer" class="agent-drawer" aria-label="Agent">
      <header class="agent-drawer__header">
        <h2 class="agent-drawer__title"><span id="agent-display-name">Test</span></h2>
        ${switcher}
      </header>
      <div class="agent-drawer__messages" id="agent-messages" role="log"></div>
      <div class="agent-drawer__stream-status" id="agent-stream-status" role="status" aria-live="polite" hidden>
        <button type="button" class="btn btn--ghost btn--sm" id="agent-stop">Stop</button>
      </div>
      <ul id="agent-history-list" class="agent-drawer__history-list" role="list"></ul>
      <form id="agent-form" data-conversation-id="${opts.conversationId || 'c1'}"><input type="hidden" id="agent-conversation-id-field" name="conversationId" value="${opts.conversationId || 'c1'}"></form>
      <script type="application/json" id="agent-tools-i18n">{
        "chip.runningAria": "Running __NAME__",
        "chip.successAria": "Done __NAME__",
        "chip.errorAria":   "Error __NAME__: __ERROR__",
        "cap.label":        "Cap",
        "cap.aria":         "Cap aria",
        "org.switching":    "Switching…",
        "org.switched":     "Switched to __ORG_NAME__",
        "org.error":        "Couldn't switch org",
        "org.forbidden":    "Not allowed"
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

function setupHarness(opts: { admin: boolean; activeOrgId?: string; conversationId?: string }): Harness {
  const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body></body></html>`, {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });
  currentDom = dom;
  const win = dom.window as unknown as Window & typeof globalThis;
  const doc = win.document;
  (globalThis as { document: Document }).document = doc;
  (globalThis as { window: Window }).window = win;
  (globalThis as { HTMLElement: typeof HTMLElement }).HTMLElement = win.HTMLElement;
  (globalThis as { HTMLFormElement: typeof HTMLFormElement }).HTMLFormElement = win.HTMLFormElement;
  (globalThis as { HTMLInputElement: typeof HTMLInputElement }).HTMLInputElement = win.HTMLInputElement;
  (globalThis as { Event: typeof Event }).Event = win.Event;
  (globalThis as { DOMParser: typeof DOMParser }).DOMParser = win.DOMParser;

  importFixtureInto(doc, buildFixture(opts));
  if (opts.conversationId) {
    win.localStorage.setItem('luqen.agent.conversationId', opts.conversationId);
  }

  const fetchStub = vi.fn(async () => htmlResponse(''));
  // @ts-expect-error
  win.fetch = fetchStub;

  class FakeEventSource {
    readonly url: string;
    closed = false;
    constructor(url: string) { this.url = url; }
    addEventListener() { /* noop */ }
    removeEventListener() { /* noop */ }
    close() { this.closed = true; }
  }
  // @ts-expect-error
  win.EventSource = FakeEventSource;
  // @ts-expect-error
  globalThis.EventSource = FakeEventSource;

  // @ts-expect-error
  win.__agentTestMode = true;

  const fn = new win.Function(
    'window', 'document', 'localStorage', 'fetch',
    AGENT_JS_SOURCE,
  );
  fn.call(win, win, doc, win.localStorage, win.fetch);

  // Load agent-org.js in the same JSDOM realm so the org switcher (extracted
  // in 39.1-02) wires its delegated change listener and augments
  // window.__agentTestExports.
  const fnOrg = new win.Function(
    'window', 'document', 'localStorage', 'fetch',
    AGENT_ORG_JS_SOURCE,
  );
  fnOrg.call(win, win, doc, win.localStorage, win.fetch);

  return {
    win,
    doc,
    fetchStub,
    exports(): AgentTestExports {
      // @ts-expect-error
      return win.__agentTestExports as AgentTestExports;
    },
  };
}

function teardown() {
  if (currentDom) {
    try { currentDom.window.close(); } catch (_e) { /* ignore */ }
  }
  currentDom = null;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

afterEach(teardown);

describe('Phase 38 Plan 04 — agent.js org switcher', () => {
  describe('handleAgentOrgSwitch (delegated change)', () => {
    it('POSTs /agent/active-org with the chosen orgId and CSRF header on change', async () => {
      const h = setupHarness({ admin: true, activeOrgId: 'A', conversationId: 'conv-1' });
      h.fetchStub.mockResolvedValueOnce(jsonResponse({ activeOrgId: 'B', activeOrgName: 'OrgB' }));

      const select = h.doc.querySelector<HTMLSelectElement>('.agent-drawer__org-switcher-select')!;
      select.value = 'B';
      select.dispatchEvent(new h.win.Event('change', { bubbles: true }));
      await flush();

      const call = h.fetchStub.mock.calls.find((c) => String(c[0]) === '/agent/active-org');
      expect(call).toBeDefined();
      const init = call![1] as RequestInit;
      expect(init.method).toBe('POST');
      expect(JSON.parse(String(init.body))).toEqual({ orgId: 'B' });
      expect((init.headers as Record<string, string>)['x-csrf-token']).toBe('test-csrf-tok');
      expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    });

    it('resets conversationId and shows success toast on 200', async () => {
      const h = setupHarness({ admin: true, activeOrgId: 'A', conversationId: 'conv-1' });
      h.fetchStub.mockResolvedValueOnce(jsonResponse({ activeOrgId: 'B', activeOrgName: 'OrgB' }));

      expect(h.exports().getConversationId()).toBe('conv-1');

      const select = h.doc.querySelector<HTMLSelectElement>('.agent-drawer__org-switcher-select')!;
      select.value = 'B';
      select.dispatchEvent(new h.win.Event('change', { bubbles: true }));
      await flush();

      expect(h.exports().getConversationId()).toBe('');
      const toast = h.doc.querySelector<HTMLElement>('[data-role="orgToast"]')!;
      expect(toast.textContent).toBe('Switched to OrgB');
      expect(toast.classList.contains('is-visible')).toBe(true);
      expect(toast.classList.contains('is-error')).toBe(false);
    });

    it('rolls back the select and shows forbidden toast on 403', async () => {
      const h = setupHarness({ admin: true, activeOrgId: 'A' });
      h.fetchStub.mockResolvedValueOnce(jsonResponse({ error: 'forbidden' }, 403));

      const select = h.doc.querySelector<HTMLSelectElement>('.agent-drawer__org-switcher-select')!;
      select.value = 'B';
      select.dispatchEvent(new h.win.Event('change', { bubbles: true }));
      await flush();

      expect(select.value).toBe('A');
      const toast = h.doc.querySelector<HTMLElement>('[data-role="orgToast"]')!;
      expect(toast.textContent).toBe('Not allowed');
      expect(toast.classList.contains('is-error')).toBe(true);
    });

    it('rolls back and shows generic error toast on 500', async () => {
      const h = setupHarness({ admin: true, activeOrgId: 'A' });
      h.fetchStub.mockResolvedValueOnce(jsonResponse({ error: 'oops' }, 500));

      const select = h.doc.querySelector<HTMLSelectElement>('.agent-drawer__org-switcher-select')!;
      select.value = 'B';
      select.dispatchEvent(new h.win.Event('change', { bubbles: true }));
      await flush();

      expect(select.value).toBe('A');
      const toast = h.doc.querySelector<HTMLElement>('[data-role="orgToast"]')!;
      expect(toast.textContent).toBe("Couldn't switch org");
      expect(toast.classList.contains('is-error')).toBe(true);
    });

    it('writes toast text via textContent only (T-38-12 — no markup injection)', async () => {
      const h = setupHarness({ admin: true, activeOrgId: 'A' });
      h.fetchStub.mockResolvedValueOnce(jsonResponse({
        activeOrgId: 'B',
        activeOrgName: '<script>alert(1)</script>',
      }));
      const select = h.doc.querySelector<HTMLSelectElement>('.agent-drawer__org-switcher-select')!;
      select.value = 'B';
      select.dispatchEvent(new h.win.Event('change', { bubbles: true }));
      await flush();

      const toast = h.doc.querySelector<HTMLElement>('[data-role="orgToast"]')!;
      // textContent preserves the literal characters; innerHTML must NOT contain
      // a real <script> element.
      expect(toast.querySelector('script')).toBeNull();
      expect(toast.textContent).toContain('<script>alert(1)</script>');
    });
  });

  describe('autoSwitchOrgIfNeeded (cross-org history open)', () => {
    it('POSTs /agent/active-org once when targetOrgId differs from select.value', async () => {
      const h = setupHarness({ admin: true, activeOrgId: 'A' });
      h.fetchStub.mockResolvedValueOnce(jsonResponse({ activeOrgId: 'B', activeOrgName: 'OrgB' }));

      const ok = await h.exports().autoSwitchOrgIfNeeded('B', 'OrgB');
      await flush();

      expect(ok).toBe(true);
      const calls = h.fetchStub.mock.calls.filter((c) => String(c[0]) === '/agent/active-org');
      expect(calls.length).toBe(1);
      const select = h.doc.querySelector<HTMLSelectElement>('.agent-drawer__org-switcher-select')!;
      expect(select.value).toBe('B');
    });

    it('returns true without fetching when targetOrgId matches current select value', async () => {
      const h = setupHarness({ admin: true, activeOrgId: 'A' });
      const ok = await h.exports().autoSwitchOrgIfNeeded('A', 'OrgA');
      const calls = h.fetchStub.mock.calls.filter((c) => String(c[0]) === '/agent/active-org');
      expect(ok).toBe(true);
      expect(calls.length).toBe(0);
    });

    it('returns true without fetching when no switcher exists (non-admin viewer)', async () => {
      const h = setupHarness({ admin: false });
      const ok = await h.exports().autoSwitchOrgIfNeeded('B', 'OrgB');
      const calls = h.fetchStub.mock.calls.filter((c) => String(c[0]) === '/agent/active-org');
      expect(ok).toBe(true);
      expect(calls.length).toBe(0);
    });

    it('returns false on POST failure (403)', async () => {
      const h = setupHarness({ admin: true, activeOrgId: 'A' });
      h.fetchStub.mockResolvedValueOnce(jsonResponse({ error: 'forbidden' }, 403));
      const ok = await h.exports().autoSwitchOrgIfNeeded('B', 'OrgB');
      expect(ok).toBe(false);
    });
  });

  describe('renderHistoryItem (admin org chip + data attrs)', () => {
    it('exposes data-org-id and data-org-name on the rendered <li>', () => {
      const h = setupHarness({ admin: true });
      const li = h.exports().renderHistoryItem(
        { id: 'c-9', title: 'Hello', orgId: 'B', orgName: 'OrgB' },
        '',
        { showOrgChip: false },
      );
      expect(li.getAttribute('data-org-id')).toBe('B');
      expect(li.getAttribute('data-org-name')).toBe('OrgB');
    });

    it('renders the org chip when showOrgChip is true', () => {
      const h = setupHarness({ admin: true });
      const li = h.exports().renderHistoryItem(
        { id: 'c-9', title: 'Hello', orgId: 'B', orgName: 'OrgB' },
        '',
        { showOrgChip: true },
      );
      const chip = li.querySelector('.agent-drawer__history-item-org-chip');
      expect(chip).not.toBeNull();
      expect(chip!.textContent).toBe('OrgB');
    });

    it('omits the chip when showOrgChip is false (non-admin viewer)', () => {
      const h = setupHarness({ admin: false });
      const li = h.exports().renderHistoryItem(
        { id: 'c-9', title: 'Hello', orgId: 'A', orgName: 'OrgA' },
        '',
        { showOrgChip: false },
      );
      const chip = li.querySelector('.agent-drawer__history-item-org-chip');
      expect(chip).toBeNull();
    });
  });
});
