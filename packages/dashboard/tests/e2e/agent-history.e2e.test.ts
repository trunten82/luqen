/**
 * Phase 35 Plan 06 Task 1 — End-to-end round-trip for the agent
 * conversation-history panel (AHIST-01..04).
 *
 * Harness shape
 * -------------
 * The existing dashboard "E2E" suite does not run a real browser — it
 * combines Fastify (`server.inject`) for the back-end with JSDOM +
 * the production `src/static/agent.js` for the front-end (see
 * `tests/e2e/agent-panel.test.ts` note and `tests/static/agent-history.test.ts`
 * for precedent). Plan 06's `<action>` explicitly permits this
 * vitest+Fastify fallback when Playwright is not wired in (which it
 * is not — no playwright dep, no browser runtime, no playwright config).
 *
 * This test loads:
 *   - the real SQLite `SqliteStorageAdapter` (real migrations 047 + 056)
 *   - the real `registerAgentRoutes` handler surface (Plan 03)
 *   - the real `src/static/agent.js` IIFE (Plan 05)
 * and exercises the full list → search → resume → rename → delete
 * round-trip end-to-end, with DB-level assertions for the soft-delete
 * contract (AHIST-04 / T-35-20) including an `agent_audit_log` row
 * check after delete.
 *
 * Seed policy: 21 conversations to force a second page (initial page
 * size 20, AHIST-02 infinite scroll). One of them carries the literal
 * string `uniqueSeedToken123` in an assistant message so the search
 * round-trip has a deterministic single-row match.
 */

import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { registerAgentRoutes } from '../../src/routes/agent.js';
import type { AgentService } from '../../src/agent/agent-service.js';
import type { ToolDispatcher } from '../../src/agent/tool-dispatch.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_JS_PATH = resolve(__dirname, '..', '..', 'src', 'static', 'agent.js');
const AGENT_JS_SOURCE = readFileSync(AGENT_JS_PATH, 'utf8');

const UNIQUE_TOKEN = 'uniqueSeedToken123';
const SEEDED = 21 as const;

interface Ctx {
  readonly server: FastifyInstance;
  readonly storage: SqliteStorageAdapter;
  readonly userId: string;
  readonly orgId: string;
  readonly seededConversationIds: readonly string[];
  readonly tokenConversationId: string;
  readonly dbPath: string;
  readonly cleanup: () => Promise<void>;
}

async function buildCtx(): Promise<Ctx> {
  const dbPath = join(tmpdir(), `e2e-agent-history-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();

  const orgId = randomUUID();
  const userId = randomUUID();
  const raw = storage.getRawDatabase();
  raw.prepare('INSERT INTO organizations (id, name, slug, created_at) VALUES (?, ?, ?, datetime(\'now\'))').run(
    orgId, 'E2E Org', 'e2e-org',
  );
  raw.prepare('INSERT INTO dashboard_users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, datetime(\'now\'))').run(
    userId, 'e2e-user', 'x', 'user',
  );

  // Seed SEEDED conversations. One of them carries the UNIQUE_TOKEN in its
  // assistant reply so search has a deterministic one-row match.
  const ids: string[] = [];
  for (let i = 0; i < SEEDED; i++) {
    const conv = await storage.conversations.createConversation({
      userId, orgId, title: `Seed conversation ${String(i + 1).padStart(2, '0')}`,
    });
    ids.push(conv.id);
    await storage.conversations.appendMessage({
      conversationId: conv.id, role: 'user', content: `user message ${i + 1}`,
    });
    const assistantContent = i === 10
      ? `Here is an answer referencing ${UNIQUE_TOKEN} for accessibility.`
      : `plain assistant reply ${i + 1}`;
    await storage.conversations.appendMessage({
      conversationId: conv.id, role: 'assistant', content: assistantContent,
    });
  }
  const tokenConversationId = ids[10]!;

  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));
  server.addHook('preHandler', async (request) => {
    (request as unknown as { user: { id: string; username: string; role: string; currentOrgId: string } }).user = {
      id: userId, username: 'e2e-user', role: 'user', currentOrgId: orgId,
    };
  });

  // Stub the AgentService + ToolDispatcher — history endpoints don't invoke them.
  const stubService: Pick<AgentService, 'runTurn'> = { runTurn: async () => { /* no-op */ } };
  const stubDispatcher: Pick<ToolDispatcher, 'dispatch'> = {
    dispatch: async () => ({ ok: true, data: {} }) as unknown as ReturnType<ToolDispatcher['dispatch']> extends Promise<infer R> ? R : never,
  };

  await registerAgentRoutes(server, {
    agentService: stubService,
    dispatcher: stubDispatcher,
    storage,
    publicUrl: 'http://localhost',
  });
  await server.ready();

  const cleanup = async () => {
    await server.close();
    await storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
  };

  return {
    server, storage, userId, orgId,
    seededConversationIds: ids, tokenConversationId,
    dbPath, cleanup,
  };
}

// ---------------------------------------------------------------------------
// JSDOM harness — bridges the real agent.js IIFE to Fastify via a custom
// `fetch()` stub that rewrites same-origin calls through `server.inject`.
// ---------------------------------------------------------------------------

interface Harness {
  readonly dom: JSDOM;
  readonly win: Window;
  readonly doc: Document;
}

function buildDrawerHtml(): string {
  return [
    '<meta name="csrf-token" content="e2e-csrf-tok">',
    '<button id="agent-launch" data-action="toggleAgentDrawer"></button>',
    '<aside id="agent-drawer" class="agent-drawer" hidden aria-label="Agent">',
    '  <header class="agent-drawer__header">',
    '    <h2 class="agent-drawer__title"><span id="agent-display-name">Agent</span></h2>',
    '    <button type="button" class="agent-drawer__history-open"',
    '            aria-expanded="false" aria-controls="agent-history-panel"',
    '            data-action="openAgentHistory">History</button>',
    '  </header>',
    '  <div class="agent-drawer__messages" id="agent-messages" role="log" aria-live="polite"></div>',
    '  <section id="agent-history-panel" class="agent-drawer__history"',
    '           role="region" aria-label="Conversation history"',
    '           aria-hidden="true" hidden>',
    '    <header class="agent-drawer__history-head">',
    '      <button type="button" class="agent-drawer__history-back"',
    '              data-action="closeAgentHistory" aria-label="Back to chat">Back</button>',
    '      <h3>History</h3>',
    '    </header>',
    '    <div class="agent-drawer__history-search">',
    '      <label for="agent-history-search-input" class="sr-only">Search conversations</label>',
    '      <input type="search" id="agent-history-search-input" role="searchbox"',
    '             aria-controls="agent-history-list" placeholder="Search conversations"',
    '             autocomplete="off">',
    '      <button type="button" class="agent-drawer__history-search-clear"',
    '              data-action="clearAgentHistorySearch"',
    '              aria-label="Clear search" hidden>&times;</button>',
    '    </div>',
    '    <div role="status" aria-live="polite" class="sr-only" id="agent-history-live"></div>',
    '    <ul id="agent-history-list" class="agent-drawer__history-list" role="list">',
    '      <li class="agent-drawer__history-empty">',
    '        <h4>No conversations yet</h4>',
    '        <p class="form-hint">Ask a question.</p>',
    '      </li>',
    '    </ul>',
    '    <div class="agent-drawer__history-sentinel"',
    '         data-action="historySentinel" role="presentation"></div>',
    '    <div class="agent-drawer__history-error" hidden role="alert">',
    '      <h4>Could not load history</h4>',
    '      <button type="button" data-action="retryHistory">Retry</button>',
    '    </div>',
    '  </section>',
    '  <form id="agent-form" data-conversation-id=""></form>',
    '</aside>',
  ].join('\n');
}

function installServerInjectFetch(win: Window, ctx: { server: FastifyInstance }): void {
  // @ts-expect-error override jsdom's fetch
  win.fetch = async (input: RequestInfo, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = init.headers as Record<string, string>;
      for (const k of Object.keys(h)) headers[k.toLowerCase()] = String(h[k]);
    }
    const res = await ctx.server.inject({
      method: method as 'GET' | 'POST',
      url,
      headers,
      payload: init?.body ? (typeof init.body === 'string' ? init.body : JSON.stringify(init.body)) : undefined,
    });
    const bodyText = res.body;
    return {
      ok: res.statusCode >= 200 && res.statusCode < 300,
      status: res.statusCode,
      headers: new (win as unknown as { Headers: typeof Headers }).Headers({
        'content-type': String(res.headers['content-type'] ?? 'application/json'),
      }),
      json: async () => JSON.parse(bodyText) as unknown,
      text: async () => bodyText,
    } as unknown as Response;
  };
}

interface IoState {
  readonly trigger: () => void;
}

function installIntersectionObserverStub(win: Window): IoState {
  const instances: Array<{ cb: IntersectionObserverCallback; observed: Element[]; disconnected: boolean }> = [];
  const trigger = (): void => {
    for (const inst of instances) {
      if (inst.disconnected) continue;
      const entries = inst.observed.map((el) => ({
        isIntersecting: true, target: el, intersectionRatio: 1,
        boundingClientRect: el.getBoundingClientRect(),
        intersectionRect: el.getBoundingClientRect(),
        rootBounds: null, time: 0,
      })) as unknown as IntersectionObserverEntry[];
      inst.cb(entries, {} as IntersectionObserver);
    }
  };
  class FakeIO {
    private readonly inst: { cb: IntersectionObserverCallback; observed: Element[]; disconnected: boolean };
    constructor(cb: IntersectionObserverCallback) {
      this.inst = { cb, observed: [], disconnected: false };
      instances.push(this.inst);
    }
    observe(t: Element): void { this.inst.observed.push(t); }
    unobserve(t: Element): void {
      const i = this.inst.observed.indexOf(t); if (i >= 0) this.inst.observed.splice(i, 1);
    }
    disconnect(): void { this.inst.disconnected = true; }
    takeRecords(): IntersectionObserverEntry[] { return []; }
  }
  // @ts-expect-error attach
  win.IntersectionObserver = FakeIO;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).IntersectionObserver = FakeIO;
  return { trigger };
}

function loadAgentJs(win: Window, doc: Document): void {
  // `new win.Function(...)` creates a function in jsdom's realm whose bare
  // identifier lookups fall through to Node's globalThis. We pass the jsdom
  // window/document/localStorage/fetch explicitly so agent.js binds to them.
  const fn = new (win as unknown as { Function: new (...args: string[]) => (...args: unknown[]) => void })
    .Function('window', 'document', 'localStorage', 'fetch', AGENT_JS_SOURCE);
  fn.call(win, win, doc, win.localStorage, (win as unknown as { fetch: unknown }).fetch);
}

function clearNode(n: Node): void {
  while (n.firstChild) n.removeChild(n.firstChild);
}

function setupHarness(ctx: Ctx): Harness & { ioTrigger: () => void } {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
    url: 'http://localhost/', pretendToBeVisual: true,
  });
  const win = dom.window as unknown as Window & typeof globalThis;
  const doc = win.document;

  // Global bridges so the test body can freely use document/window/HTMLElement.
  (globalThis as { document: Document }).document = doc;
  (globalThis as { window: Window }).window = win;
  (globalThis as { HTMLElement: typeof HTMLElement }).HTMLElement = win.HTMLElement;
  (globalThis as { HTMLInputElement: typeof HTMLInputElement }).HTMLInputElement = win.HTMLInputElement;
  (globalThis as { Event: typeof Event }).Event = win.Event;
  (globalThis as { KeyboardEvent: typeof KeyboardEvent }).KeyboardEvent = win.KeyboardEvent;
  (globalThis as { DOMParser: typeof DOMParser }).DOMParser = win.DOMParser;

  // Import fixture via DOMParser + importNode (no innerHTML on untrusted text).
  clearNode(doc.body);
  clearNode(doc.head);
  const parsed = new win.DOMParser().parseFromString(
    `<!DOCTYPE html><html><head></head><body>${buildDrawerHtml()}</body></html>`,
    'text/html',
  );
  const meta = parsed.querySelector('meta[name="csrf-token"]');
  if (meta) doc.head.appendChild(doc.importNode(meta, true));
  for (const node of Array.from(parsed.body.childNodes)) {
    if (node.nodeType === 1 && (node as Element).tagName === 'META') continue;
    doc.body.appendChild(doc.importNode(node, true));
  }

  installServerInjectFetch(win, ctx);
  const io = installIntersectionObserverStub(win);
  loadAgentJs(win, doc);
  return { dom, win, doc, ioTrigger: io.trigger };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
}

async function flushAfterSearchDebounce(): Promise<void> {
  // 250 ms debounce + microtask drain + fetch resolution.
  await sleep(320);
  await flush();
  await sleep(50);
  await flush();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Phase 35 Plan 06 Task 1 — agent history E2E round-trip', () => {
  let ctx: Ctx;

  beforeAll(async () => { ctx = await buildCtx(); });
  afterAll(async () => { await ctx.cleanup(); });

  it('test 1 — seeds 21 conversations including one carrying uniqueSeedToken123', async () => {
    const raw = ctx.storage.getRawDatabase();
    const countRow = raw.prepare(
      'SELECT COUNT(*) as n FROM agent_conversations WHERE user_id = ? AND org_id = ? AND is_deleted = 0',
    ).get(ctx.userId, ctx.orgId) as { n: number };
    expect(countRow.n).toBe(SEEDED);

    const tokenHit = raw.prepare(
      'SELECT m.conversation_id as cid FROM agent_messages m WHERE m.content LIKE ? LIMIT 1',
    ).get(`%${UNIQUE_TOKEN}%`) as { cid: string } | undefined;
    expect(tokenHit?.cid).toBe(ctx.tokenConversationId);
  });

  it('test 2 — opening history panel lists 20 items with data-conversation-id each (first page)', async () => {
    const h = setupHarness(ctx);
    (h.doc.querySelector('[data-action="openAgentHistory"]') as HTMLElement).click();
    await flush(); await sleep(50); await flush();

    const rows = h.doc.querySelectorAll('#agent-history-list li.agent-drawer__history-item');
    expect(rows.length).toBe(20);
    for (const row of Array.from(rows)) {
      const cid = row.getAttribute('data-conversation-id');
      expect(cid).toBeTruthy();
      expect(ctx.seededConversationIds).toContain(cid!);
    }
  });

  it('test 3 — infinite scroll sentinel loads the 21st item (AHIST-02 IntersectionObserver path)', async () => {
    const h = setupHarness(ctx);
    (h.doc.querySelector('[data-action="openAgentHistory"]') as HTMLElement).click();
    await flush(); await sleep(50); await flush();

    expect(h.doc.querySelectorAll('#agent-history-list li.agent-drawer__history-item').length).toBe(20);
    h.ioTrigger();
    await flush(); await sleep(50); await flush();
    expect(h.doc.querySelectorAll('#agent-history-list li.agent-drawer__history-item').length).toBe(SEEDED);
  });

  it('test 4 — search for uniqueSeedToken123 returns exactly 1 row with <mark>-wrapped match', async () => {
    const h = setupHarness(ctx);
    (h.doc.querySelector('[data-action="openAgentHistory"]') as HTMLElement).click();
    await flush(); await sleep(50); await flush();

    const input = h.doc.getElementById('agent-history-search-input') as HTMLInputElement;
    input.value = UNIQUE_TOKEN;
    input.dispatchEvent(new h.win.Event('input', { bubbles: true }));
    await flushAfterSearchDebounce();

    const rows = h.doc.querySelectorAll('#agent-history-list li.agent-drawer__history-item');
    expect(rows.length).toBe(1);
    expect(rows[0]!.getAttribute('data-conversation-id')).toBe(ctx.tokenConversationId);
    const mark = rows[0]!.querySelector('mark');
    expect(mark).not.toBeNull();
    expect(mark!.textContent?.toLowerCase()).toBe(UNIQUE_TOKEN.toLowerCase());
  });

  it('test 5 — resume: clicking the matched row fetches full history, closes panel, wires conversation id on form', async () => {
    const h = setupHarness(ctx);
    (h.doc.querySelector('[data-action="openAgentHistory"]') as HTMLElement).click();
    await flush(); await sleep(50); await flush();

    const input = h.doc.getElementById('agent-history-search-input') as HTMLInputElement;
    input.value = UNIQUE_TOKEN;
    input.dispatchEvent(new h.win.Event('input', { bubbles: true }));
    await flushAfterSearchDebounce();

    const row = h.doc.querySelector(`#agent-history-list li[data-conversation-id="${ctx.tokenConversationId}"]`) as HTMLElement;
    expect(row).not.toBeNull();
    row.click();
    await flush(); await sleep(50); await flush();

    const panel = h.doc.getElementById('agent-history-panel')!;
    expect(panel.getAttribute('aria-hidden')).toBe('true');
    const form = h.doc.getElementById('agent-form')!;
    expect(form.getAttribute('data-conversation-id')).toBe(ctx.tokenConversationId);

    const raw = ctx.storage.getRawDatabase();
    const msgCount = raw.prepare(
      'SELECT COUNT(*) as n FROM agent_messages WHERE conversation_id = ?',
    ).get(ctx.tokenConversationId) as { n: number };
    expect(msgCount.n).toBe(2);
  });

  it('test 6 — rename: three-dot → Rename → type → Enter → title persists after refetch', async () => {
    const h = setupHarness(ctx);
    (h.doc.querySelector('[data-action="openAgentHistory"]') as HTMLElement).click();
    await flush(); await sleep(50); await flush();

    const firstRow = h.doc.querySelector('#agent-history-list li.agent-drawer__history-item') as HTMLElement;
    const targetId = firstRow.getAttribute('data-conversation-id')!;
    const menuBtn = firstRow.querySelector('[data-action="openHistoryItemMenu"]') as HTMLElement;
    menuBtn.click();
    await flush();

    const renameItem = h.doc.querySelector('[data-action="renameConversation"]') as HTMLElement;
    expect(renameItem).not.toBeNull();
    renameItem.click();
    await flush();

    const input = firstRow.querySelector('.agent-drawer__history-rename input') as HTMLInputElement;
    expect(input).not.toBeNull();
    input.value = 'Renamed in e2e';
    input.dispatchEvent(new h.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush(); await sleep(50); await flush();

    const raw = ctx.storage.getRawDatabase();
    const row = raw.prepare('SELECT title FROM agent_conversations WHERE id = ?').get(targetId) as { title: string };
    expect(row.title).toBe('Renamed in e2e');

    // Reload the panel — list should still show the new title.
    const h2 = setupHarness(ctx);
    (h2.doc.querySelector('[data-action="openAgentHistory"]') as HTMLElement).click();
    await flush(); await sleep(50); await flush();
    const reloadedRow = h2.doc.querySelector(`#agent-history-list li[data-conversation-id="${targetId}"]`)!;
    const titleEl = reloadedRow.querySelector('.agent-drawer__history-item-title');
    expect(titleEl?.textContent).toBe('Renamed in e2e');
  });

  it('test 7 — delete: three-dot → Delete → confirm → row gone, panel reload still hides it, is_deleted=1, deleted_at set, conversation_soft_deleted audit row exists', async () => {
    const h = setupHarness(ctx);
    (h.doc.querySelector('[data-action="openAgentHistory"]') as HTMLElement).click();
    await flush(); await sleep(50); await flush();

    const rows = h.doc.querySelectorAll('#agent-history-list li.agent-drawer__history-item');
    const victim = rows[rows.length - 1] as HTMLElement;
    const victimId = victim.getAttribute('data-conversation-id')!;

    const menuBtn = victim.querySelector('[data-action="openHistoryItemMenu"]') as HTMLElement;
    menuBtn.click();
    await flush();

    const deleteItem = h.doc.querySelector('[data-action="deleteConversation"]') as HTMLElement;
    deleteItem.click();
    await flush();

    const confirmBtn = victim.querySelector('[data-action="confirmDelete"]') as HTMLElement;
    expect(confirmBtn).not.toBeNull();
    confirmBtn.click();
    await flush(); await sleep(50); await flush();

    expect(h.doc.querySelector(`#agent-history-list li[data-conversation-id="${victimId}"]`)).toBeNull();

    // DB-level soft-delete assertion — is_deleted flipped, deleted_at populated.
    const raw = ctx.storage.getRawDatabase();
    const dbRow = raw.prepare(
      'SELECT is_deleted, deleted_at FROM agent_conversations WHERE id = ?',
    ).get(victimId) as { is_deleted: number; deleted_at: string | null };
    expect(dbRow.is_deleted).toBe(1);
    expect(dbRow.deleted_at).not.toBeNull();
    expect(typeof dbRow.deleted_at).toBe('string');

    // Audit log assertion (T-35-20 mitigation evidence).
    const auditRow = raw.prepare(
      `SELECT id, tool_name, conversation_id FROM agent_audit_log
       WHERE conversation_id = ? AND tool_name = 'conversation_soft_deleted'`,
    ).get(victimId) as { id: string; tool_name: string; conversation_id: string } | undefined;
    expect(auditRow).toBeDefined();
    expect(auditRow!.tool_name).toBe('conversation_soft_deleted');

    // Reload the panel — soft-deleted conversation MUST NOT reappear.
    const h2 = setupHarness(ctx);
    (h2.doc.querySelector('[data-action="openAgentHistory"]') as HTMLElement).click();
    await flush(); await sleep(50); await flush();
    expect(h2.doc.querySelector(`#agent-history-list li[data-conversation-id="${victimId}"]`)).toBeNull();
  });
});
