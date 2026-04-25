/**
 * Phase 36 Plan 06 Task 2 — Multi-step tool-use end-to-end UX coverage
 * (chip strip lifecycle + /admin/audit rationale toggle).
 *
 * Harness shape (deviation Rule 3 — required infrastructure absent)
 * ------------------------------------------------------------------
 * The plan asks for a Playwright spec at tests/e2e/agent-multi-step.spec.ts.
 * Playwright is NOT wired in this repo (no @playwright/test dep, no
 * playwright.config). The established e2e pattern is vitest+JSDOM+Fastify
 * (see tests/e2e/agent-history.e2e.test.ts and Phase 35 Plan 06 SUMMARY).
 *
 * This file follows that local convention, exercising the same observable
 * UX surfaces:
 *
 *   E1 — chip strip populates with running chips during parallel dispatch.
 *   E2 — chips transition to success / error and the cap chip renders.
 *   E3 — chip strip clears on stream `done`.
 *   E4 — /admin/audit rationale toggle expands + collapses with correct
 *        aria-expanded transitions and the panel hidden attribute.
 *
 * The chip handlers in src/static/agent.js are wired to EventSource
 * events. We install a FakeEventSource into JSDOM, load agent.js into
 * the jsdom realm, then fire SSE events synthetically. This exercises
 * the production handler code paths verbatim (no mocking) while staying
 * deterministic (no real LLM provider needed — the equivalent of the
 * plan's `process.env.E2E_LLM_PROVIDER` skip path is moot here because
 * the LLM is replaced by direct frame dispatch).
 *
 * For /admin/audit we load src/static/agent-audit.js (the rationale
 * toggle handler), seed a row with the expected ARIA attribute shape,
 * and assert the toggle transitions are correct.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_ROOT = resolve(__dirname, '..', '..');
const AGENT_JS = readFileSync(join(DASHBOARD_ROOT, 'src/static/agent.js'), 'utf8');
const AGENT_AUDIT_JS = readFileSync(join(DASHBOARD_ROOT, 'src/static/agent-audit.js'), 'utf8');

// ---------------------------------------------------------------------------
// FakeEventSource — minimal in-jsdom shim that lets test code dispatch the
// same `tool_started` / `tool_completed` / `done` events agent.js consumes.
// ---------------------------------------------------------------------------

interface FakeESControl {
  fire: (eventName: string, data: unknown) => void;
  close: () => void;
  isClosed: () => boolean;
}

interface FakeESInternal {
  listeners: Map<string, Array<(ev: { data: string }) => void>>;
  closed: boolean;
}

function installFakeEventSource(win: Window): { sources: FakeESControl[] } {
  const sources: FakeESControl[] = [];

  class FakeEventSource {
    private readonly internal: FakeESInternal;
    public readonly url: string;
    public withCredentials: boolean;
    constructor(url: string, init?: { withCredentials?: boolean }) {
      this.url = url;
      this.withCredentials = init?.withCredentials === true;
      this.internal = { listeners: new Map(), closed: false };
      const internal = this.internal;
      sources.push({
        fire: (eventName, data) => {
          if (internal.closed) return;
          const list = internal.listeners.get(eventName) ?? [];
          const payload = { data: typeof data === 'string' ? data : JSON.stringify(data) };
          for (const fn of list) fn(payload);
        },
        close: () => { internal.closed = true; },
        isClosed: () => internal.closed,
      });
    }
    addEventListener(eventName: string, fn: (ev: { data: string }) => void): void {
      const list = this.internal.listeners.get(eventName) ?? [];
      list.push(fn);
      this.internal.listeners.set(eventName, list);
    }
    removeEventListener(eventName: string, fn: (ev: { data: string }) => void): void {
      const list = this.internal.listeners.get(eventName) ?? [];
      const idx = list.indexOf(fn);
      if (idx >= 0) list.splice(idx, 1);
    }
    close(): void { this.internal.closed = true; }
  }

  // @ts-expect-error — jsdom does not type EventSource on Window
  win.EventSource = FakeEventSource;
  return { sources };
}

// ---------------------------------------------------------------------------
// Drawer DOM fixture — minimal subset agent.js's chip strip targets.
// Mirrors src/views/partials/agent-drawer.hbs (Phase 36-04 chip strip slot
// + agent-tools-i18n JSON-script-block + stream-status).
// ---------------------------------------------------------------------------

function buildDrawerHtml(): string {
  return [
    '<meta name="csrf-token" content="e2e-csrf-tok">',
    '<button id="agent-launch" data-action="toggleAgentDrawer" aria-expanded="false"></button>',
    '<div id="agent-backdrop" hidden></div>',
    '<aside id="agent-drawer" class="agent-drawer" hidden aria-label="Agent">',
    '  <header class="agent-drawer__header">',
    '    <h2 class="agent-drawer__title"><span id="agent-display-name">Agent</span></h2>',
    '  </header>',
    '  <div class="agent-drawer__messages" id="agent-messages" role="log" aria-live="polite"></div>',
    '  <div class="agent-drawer__tool-chips" id="agent-tool-chips" role="status" aria-live="polite"></div>',
    '  <script type="application/json" id="agent-tools-i18n">',
    '  {',
    '    "chip.runningAria": "Running __NAME__",',
    '    "chip.successAria": "__NAME__ done",',
    '    "chip.errorAria":   "__NAME__ failed: __ERROR__",',
    '    "cap.label":        "Reached tool limit — producing answer with what we have",',
    '    "cap.aria":         "Tool limit reached"',
    '  }',
    '  </script>',
    '  <div id="agent-stream-status" hidden></div>',
    '  <form id="agent-form" data-conversation-id=""></form>',
    '  <input id="agent-input" />',
    '  <div id="agent-speech"></div>',
    '</aside>',
  ].join('\n');
}

interface ChipHarness {
  readonly dom: JSDOM;
  readonly win: Window;
  readonly doc: Document;
  readonly esSources: FakeESControl[];
}

function setupChipHarness(): ChipHarness {
  const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body>${buildDrawerHtml()}</body></html>`, {
    url: 'http://localhost/',
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });
  const win = dom.window as unknown as Window & typeof globalThis;
  const doc = win.document;

  // FakeEventSource MUST exist before agent.js executes its `new EventSource(...)`
  // path. agent.js only opens a stream on form-submit / resume, so it's fine
  // to install before the IIFE runs and trigger streams from the test.
  const { sources } = installFakeEventSource(win);

  // Bridge globals so the test body can use document/window/HTMLElement freely.
  (globalThis as { document: Document }).document = doc;
  (globalThis as { window: Window }).window = win;
  (globalThis as { HTMLElement: typeof HTMLElement }).HTMLElement = win.HTMLElement;
  (globalThis as { Event: typeof Event }).Event = win.Event;
  (globalThis as { CustomEvent: typeof CustomEvent }).CustomEvent = win.CustomEvent;

  // Load agent.js into the jsdom realm so its IIFE binds to win/doc.
  const fn = new (win as unknown as { Function: new (...args: string[]) => (...args: unknown[]) => void })
    .Function('window', 'document', 'localStorage', AGENT_JS);
  fn.call(win, win, doc, win.localStorage);

  return { dom, win, doc, esSources: sources };
}

// agent.js opens an EventSource only via `openStream(conversationId)`, which
// is invoked inside the form-submit handler after a successful POST. To
// stay deterministic we trigger the stream by directly invoking the same
// path agent.js uses — submitting the form. Because the form submit also
// performs a fetch, we stub fetch to return a 204-equivalent shape.
function stubFetchOk(win: Window, body: unknown = {}): void {
  // @ts-expect-error override jsdom's fetch
  win.fetch = async () => ({
    ok: true,
    status: 200,
    headers: new (win as unknown as { Headers: typeof Headers }).Headers({
      'content-type': 'application/json',
    }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

async function flush(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

// ---------------------------------------------------------------------------
// Tests E1..E3 — chip strip lifecycle
// ---------------------------------------------------------------------------

describe('Phase 36 Plan 06 — chip strip e2e (E1..E3)', () => {
  let h: ChipHarness;
  beforeEach(() => {
    h = setupChipHarness();
  });

  async function openStream(): Promise<FakeESControl> {
    // agent.js opens the EventSource in response to a successful htmx
    // POST to /agent/message (xhr.status === 202). Simulate that event
    // shape directly — keeps the test focused on chip-strip behaviour
    // and avoids reaching for a real fetch + handler chain.
    const form = h.doc.getElementById('agent-form') as HTMLFormElement;
    form.setAttribute('data-conversation-id', 'conv-test-1');
    const fakeXhr = {
      status: 202,
      getResponseHeader: (name: string) =>
        name.toLowerCase() === 'x-conversation-id' ? 'conv-test-1' : null,
    };
    const evt = new h.win.CustomEvent('htmx:afterRequest', {
      bubbles: true,
      detail: {
        requestConfig: { path: '/agent/message' },
        xhr: fakeXhr,
      },
    });
    h.doc.body.dispatchEvent(evt);
    await flush();
    expect(h.esSources.length).toBeGreaterThanOrEqual(1);
    return h.esSources[h.esSources.length - 1]!;
  }

  it('E1 — three tool_started frames render three running chips in input order', async () => {
    const es = await openStream();
    const strip = h.doc.getElementById('agent-tool-chips')!;
    expect(strip.children.length).toBe(0);

    es.fire('tool_started', { type: 'tool_started', toolCallId: 'a', toolName: 'tool_a' });
    es.fire('tool_started', { type: 'tool_started', toolCallId: 'b', toolName: 'tool_b' });
    es.fire('tool_started', { type: 'tool_started', toolCallId: 'c', toolName: 'tool_c' });

    const chips = strip.querySelectorAll('.agent-drawer__tool-chip');
    expect(chips.length).toBe(3);
    // All three are in --running state.
    for (const c of Array.from(chips)) {
      expect(c.classList.contains('agent-drawer__tool-chip--running')).toBe(true);
    }
    // DOM order matches input order (chips appended in tool_started order).
    expect((chips[0] as Element).getAttribute('data-tool-call-id')).toBe('a');
    expect((chips[1] as Element).getAttribute('data-tool-call-id')).toBe('b');
    expect((chips[2] as Element).getAttribute('data-tool-call-id')).toBe('c');
  });

  it('E2 — tool_completed transitions chips to success / error and renders cap chip on __loop__', async () => {
    const es = await openStream();
    es.fire('tool_started', { toolCallId: 'a', toolName: 'tool_a' });
    es.fire('tool_started', { toolCallId: 'b', toolName: 'tool_b' });

    es.fire('tool_completed', { toolCallId: 'a', toolName: 'tool_a', status: 'success' });
    es.fire('tool_completed', {
      toolCallId: 'b',
      toolName: 'tool_b',
      status: 'error',
      errorMessage: 'timeout',
    });

    const strip = h.doc.getElementById('agent-tool-chips')!;
    const aChip = strip.querySelector('[data-tool-call-id="a"]')!;
    const bChip = strip.querySelector('[data-tool-call-id="b"]')!;
    expect(aChip.classList.contains('agent-drawer__tool-chip--success')).toBe(true);
    expect(aChip.classList.contains('agent-drawer__tool-chip--running')).toBe(false);
    expect(bChip.classList.contains('agent-drawer__tool-chip--error')).toBe(true);
    // Error chip surfaces the error message in its label (per Phase 36-04).
    const bLabel = bChip.querySelector('.agent-drawer__tool-chip-label')!;
    expect(bLabel.textContent).toContain('timeout');

    // Synthetic __loop__ tool_completed renders the cap chip.
    es.fire('tool_completed', {
      toolCallId: '__loop__',
      toolName: '__loop__',
      status: 'error',
      errorMessage: 'iteration_cap',
    });
    const cap = strip.querySelector('.agent-drawer__tool-chip--cap')!;
    expect(cap).not.toBeNull();
    expect(cap.textContent).toContain('Reached tool limit');
  });

  it('E3 — chip strip clears on stream done (UAT decision, Phase 36-04)', async () => {
    const es = await openStream();
    es.fire('tool_started', { toolCallId: 'a', toolName: 'tool_a' });
    es.fire('tool_completed', { toolCallId: 'a', toolName: 'tool_a', status: 'success' });
    const strip = h.doc.getElementById('agent-tool-chips')!;
    expect(strip.children.length).toBe(1);

    es.fire('done', {});
    expect(strip.children.length).toBe(0);
    // EventSource closes on done.
    expect(es.isClosed()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test E4 — /admin/audit rationale expand/collapse via the production
// agent-audit.js handler. CSP-strict: no inline scripts; click delegated.
// ---------------------------------------------------------------------------

describe('Phase 36 Plan 06 — admin audit rationale toggle e2e (E4)', () => {
  function buildAuditFixture(): string {
    return [
      '<table class="audit-list">',
      '  <tbody>',
      '    <tr class="audit-row">',
      '      <td>',
      '        <button type="button"',
      '                data-action="toggleRationale"',
      '                aria-controls="rationale-panel-row1"',
      '                aria-expanded="false"',
      '                data-label-expand="Expand rationale"',
      '                data-label-collapse="Collapse rationale"',
      '                aria-label="Expand rationale">',
      '          <span class="audit-rationale__preview">Looking up org X to compare…</span>',
      '        </button>',
      '        <div id="rationale-panel-row1" class="audit-rationale__full" hidden>',
      '          Looking up org X to compare against the dashboard.',
      '        </div>',
      '      </td>',
      '    </tr>',
      '  </tbody>',
      '</table>',
    ].join('\n');
  }

  it('E4 — clicking toggle expands then collapses, aria-expanded and hidden flip in lockstep', () => {
    const dom = new JSDOM(
      `<!DOCTYPE html><html><body>${buildAuditFixture()}</body></html>`,
      { url: 'http://localhost/admin/audit', pretendToBeVisual: true, runScripts: 'outside-only' },
    );
    const win = dom.window as unknown as Window & typeof globalThis;
    const doc = win.document;

    // Bridge globals.
    (globalThis as { document: Document }).document = doc;
    (globalThis as { window: Window }).window = win;
    (globalThis as { Element: typeof Element }).Element = win.Element;

    // Load production rationale toggle handler.
    const fn = new (win as unknown as { Function: new (...args: string[]) => (...args: unknown[]) => void })
      .Function('window', 'document', AGENT_AUDIT_JS);
    fn.call(win, win, doc);

    const btn = doc.querySelector('[data-action="toggleRationale"]') as HTMLButtonElement;
    const panel = doc.getElementById('rationale-panel-row1')!;

    // Initial state — collapsed.
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(panel.hasAttribute('hidden')).toBe(true);
    expect(btn.getAttribute('aria-label')).toBe('Expand rationale');

    // Click — expand.
    btn.click();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(panel.hasAttribute('hidden')).toBe(false);
    expect(btn.getAttribute('aria-label')).toBe('Collapse rationale');

    // Click again — collapse.
    btn.click();
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(panel.hasAttribute('hidden')).toBe(true);
    expect(btn.getAttribute('aria-label')).toBe('Expand rationale');
  });
});
