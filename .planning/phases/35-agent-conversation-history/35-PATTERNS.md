# Phase 35: Agent Conversation History — Pattern Map

**Mapped:** 2026-04-24
**Files analyzed:** 14 (new + modified)
**Analogs found:** 12 / 14 (2 without direct analog — noted below)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/db/sqlite/migrations.ts` (append migration `050`) | migration | schema DDL | entries `047`, `048` in same file | exact |
| `src/db/interfaces/conversation-repository.ts` (extend) | interface | CRUD contract | same file (existing methods) | exact |
| `src/db/sqlite/repositories/conversation-repository.ts` (extend) | repo impl | CRUD + search | same file's `listForUser` / `getConversation` | exact |
| `src/agent/conversation-title-generator.ts` (NEW) | service | request-response (LLM) | `src/agent/agent-service.ts` §`runTurn` (LLM invocation via `llm.streamAgentConversation`) | role-match |
| `src/agent/agent-service.ts` (hook post-first-assistant) | service | event-driven | itself (post-stream completion block) | exact |
| `src/routes/agent.ts` (add 5 endpoints under `/agent/conversations*`) | route | request-response | same file's `/message`, `/panel`, `/confirm/:id` handlers | exact |
| `src/views/partials/agent-drawer.hbs` (insert stacked panel markup + history open button) | view partial | server-render | same file (header-button + `<aside>` slot pattern) | exact |
| `src/views/partials/agent-history-panel.hbs` (NEW, stacked region) | view partial | server-render | `agent-messages.hbs` + `agent-drawer.hbs` | role-match |
| `src/views/partials/agent-history-item.hbs` (NEW, list row) | view partial | server-render | `agent-message.hbs` (conditional render + data-id attrs) | role-match |
| `src/static/agent.js` (add history panel hydration + fetch + IO + menu wiring) | client script | event-driven | same file's `loadPanel()` + event-delegation listener | exact |
| `src/static/style.css` (add `.agent-drawer__history*` BEM block) | CSS | static | existing `.agent-drawer__*` / `.agent-msg--*` blocks in same file | exact |
| `src/i18n/locales/en.json` (add `agent.history.*` namespace, ~23 keys) | i18n | static | existing `agent.*` block (lines 1585–1628) | exact |
| Three-dot action menu (popover) | component | interaction | **no analog** — all admin tables use inline `btn btn--sm btn--danger` + `hx-confirm`, no kebab/popover precedent | NONE |
| Live search input with debounce + clear button | component | interaction | **no analog** — first debounced search in dashboard; use UI-SPEC contract | NONE |

---

## Pattern Assignments

### `src/db/sqlite/migrations.ts` — add migration `050-agent-conversations-soft-delete`

**Analog:** migration `047`/`048` in the same file (`migrations.ts:1221-1273`).

**Shape to copy** (mirrors 047 structure — `ALTER TABLE` variant for column additions):
```ts
// migrations.ts:1221-1273 — migration-entry envelope
{
  id: '047',
  name: 'agent-conversations-and-messages',
  sql: `
CREATE TABLE IF NOT EXISTS agent_conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  title TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_message_at TEXT,
  FOREIGN KEY (user_id) REFERENCES dashboard_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_agent_conversations_user_org_last
  ON agent_conversations(user_id, org_id, last_message_at DESC);
...
  `,
},
```

**For phase 35** — append a NEW migration (do not edit 047):
```ts
{
  id: '050',
  name: 'agent-conversations-soft-delete',
  sql: `
ALTER TABLE agent_conversations ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agent_conversations ADD COLUMN deleted_at TEXT;
-- Keep the hot index covering the live-list query path.
-- Existing idx_agent_conversations_user_org_last remains; add a partial
-- replacement if/when list queries are consistently filtering is_deleted=0:
CREATE INDEX IF NOT EXISTS idx_agent_conversations_user_org_active_last
  ON agent_conversations(user_id, org_id, last_message_at DESC)
  WHERE is_deleted = 0;
  `,
},
```
(SQLite's partial-index support is stable since 3.8 — Node's `better-sqlite3` bundles 3.42+. Decision on partial vs plain is at planner discretion.)

---

### `src/db/interfaces/conversation-repository.ts` — extend contract

**Analog:** same file (lines 76–135, existing method signatures).

**Import pattern & signature style to copy** (`conversation-repository.ts:76-94`):
```ts
export interface ConversationRepository {
  createConversation(input: CreateConversationInput): Promise<Conversation>;

  getConversation(id: string, orgId: string): Promise<Conversation | null>;

  listForUser(
    userId: string,
    orgId: string,
    options?: ListConversationsOptions,
  ): Promise<Conversation[]>;
  ...
}
```

**New methods to add (phase 35)** — follow the same org-scoped + options-last style:
```ts
export interface SearchConversationsOptions extends ListConversationsOptions {
  readonly query: string;   // case-insensitive substring, title + message content
}

export interface ConversationSearchHit {
  readonly conversation: Conversation;
  readonly snippet: string;            // 60–120 chars, match window
  readonly matchField: 'title' | 'content';
}

// Add to ConversationRepository:
  /** Search user's non-deleted conversations by title or message content. */
  searchForUser(
    userId: string,
    orgId: string,
    options: SearchConversationsOptions,
  ): Promise<ConversationSearchHit[]>;

  /** Update title. Returns null if not found or wrong org. */
  renameConversation(
    id: string,
    orgId: string,
    title: string,
  ): Promise<Conversation | null>;

  /** Soft-delete: set is_deleted=1, deleted_at=now(). Returns false on miss. */
  softDeleteConversation(id: string, orgId: string): Promise<boolean>;
```

Also extend existing `listForUser` contract doc to note that `is_deleted = 0` is filtered; alternatively add an `includeDeleted?: boolean` option for admin-audit usage.

---

### `src/db/sqlite/repositories/conversation-repository.ts` — implementation

**Analog:** same file's `listForUser` (`conversation-repository.ts:82-100`) and `getConversation` (`:75-80`).

**Imports pattern** (`:1-12`):
```ts
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type {
  AppendMessageInput,
  Conversation,
  ConversationRepository,
  ...
} from '../../interfaces/conversation-repository.js';
```

**Org-scoped list query to extend** (`:90-97`):
```ts
const rows = this.db
  .prepare(
    `SELECT * FROM agent_conversations
     WHERE user_id = @userId AND org_id = @orgId
     ORDER BY COALESCE(last_message_at, created_at) DESC
     LIMIT @limit OFFSET @offset`,
  )
  .all({ userId, orgId, limit, offset }) as ConversationRow[];
```

**Pattern to copy for `listForUser` update — add `is_deleted = 0`** (same shape, new WHERE clause):
```ts
WHERE user_id = @userId AND org_id = @orgId AND is_deleted = 0
```

**Pattern to copy for `searchForUser`** (new method, same prepare/run style):
```ts
async searchForUser(
  userId: string,
  orgId: string,
  options: SearchConversationsOptions,
): Promise<ConversationSearchHit[]> {
  const limit = Math.min(options.limit ?? 20, 50);
  const offset = options.offset ?? 0;
  const q = `%${options.query.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
  // Match title OR any message.content via EXISTS subquery.
  // Both paths respect is_deleted=0 + org_id guard.
  const rows = this.db.prepare(
    `SELECT c.* FROM agent_conversations c
     WHERE c.user_id = @userId AND c.org_id = @orgId AND c.is_deleted = 0
       AND (
         LOWER(COALESCE(c.title, '')) LIKE LOWER(@q) ESCAPE '\\'
         OR EXISTS (
           SELECT 1 FROM agent_messages m
           WHERE m.conversation_id = c.id
             AND LOWER(COALESCE(m.content, '')) LIKE LOWER(@q) ESCAPE '\\'
         )
       )
     ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
     LIMIT @limit OFFSET @offset`,
  ).all({ userId, orgId, q, limit, offset }) as ConversationRow[];
  // Snippet extraction: second pass per row, read first match against title
  // then content, return a ±60-char window. Keeps the primary query cheap.
  return rows.map((r) => ({
    conversation: this.rowToConversation(r),
    ...this.computeSnippet(r.id, r.title, options.query),
  }));
}
```

**Pattern to copy for `softDeleteConversation` (org-guarded write)** — mirror `updateMessageStatus` (`:192-209`):
```ts
async softDeleteConversation(id: string, orgId: string): Promise<boolean> {
  const now = new Date().toISOString();
  const result = this.db.prepare(
    `UPDATE agent_conversations
     SET is_deleted = 1, deleted_at = @now, updated_at = @now
     WHERE id = @id AND org_id = @orgId AND is_deleted = 0`,
  ).run({ id, orgId, now });
  return result.changes > 0;
}
```

**Row mapper pattern (keep)** (`:257-267`):
```ts
private rowToConversation(row: ConversationRow): Conversation {
  return {
    id: row.id, userId: row.user_id, orgId: row.org_id, title: row.title,
    createdAt: row.created_at, updatedAt: row.updated_at,
    lastMessageAt: row.last_message_at,
  };
}
```
Extend `Conversation` + `ConversationRow` to include `isDeleted` / `deletedAt` for audit surfacing (keeps user-facing reads filtered via WHERE clause; types remain accurate).

---

### `src/agent/conversation-title-generator.ts` (NEW)

**Analog:** `src/agent/agent-service.ts` §`runTurn` LLM invocation pattern (`agent-service.ts:307-309`) + `llm-client.ts:468-499` (`streamAgentConversation`).

**Core pattern to copy — LLM call with signal + fallback** (composited from agent-service + llm-client):
```ts
// Structural dep mirroring AgentService's llm injection so tests can stub.
export interface TitleGeneratorLLM {
  readonly streamAgentConversation: (
    input: AgentStreamInput,
    opts: AgentStreamOptions,
  ) => Promise<AgentStreamTurn>;
}

export async function generateConversationTitle(args: {
  readonly llm: TitleGeneratorLLM;
  readonly orgId: string;
  readonly userId: string;
  readonly agentDisplayName: string;
  readonly userMessage: string;
  readonly assistantReply: string;
  readonly signal?: AbortSignal;
}): Promise<string> {
  const prompt = buildTitlePrompt(args.userMessage, args.assistantReply);
  try {
    const turn = await args.llm.streamAgentConversation(
      {
        messages: [{ role: 'user', content: prompt }],
        tools: [],                // no tools for title generation
        orgId: args.orgId,
        userId: args.userId,
        agentDisplayName: args.agentDisplayName,
        contextHintsBlock: '',
      },
      { signal: args.signal, onFrame: () => { /* ignore */ } },
    );
    const text = (turn.accumulatedText ?? '').trim();
    return sanitiseTitle(text) || fallbackTitle(args.userMessage);
  } catch {
    // D-03 — any failure falls back to truncated first user message.
    return fallbackTitle(args.userMessage);
  }
}

function fallbackTitle(userMessage: string): string {
  return userMessage.replace(/\s+/g, ' ').trim().slice(0, 50);
}
```

---

### `src/agent/agent-service.ts` — hook post-first-assistant title generation

**Analog:** itself — post-stream completion block after `runTurn` loop (`agent-service.ts:307-…`).

**Pattern:** after the first assistant reply finishes and before emitting the `done` frame, check if the conversation's `title IS NULL` AND this is the very first assistant turn; if so, dispatch title generation. Must not block the SSE `done` frame — fire-and-forget with error swallowed. Hook via the existing `storage.conversations.getConversation` / `renameConversation` calls.

```ts
// After successful first-assistant-turn persistence:
const conv = await this.storage.conversations.getConversation(conversationId, orgId);
if (conv !== null && conv.title === null && isFirstAssistantTurn) {
  // Fire-and-forget; errors fall back inside generateConversationTitle.
  void generateConversationTitle({
    llm: this.llm, orgId, userId,
    agentDisplayName,
    userMessage, assistantReply: turn.accumulatedText,
    signal,
  }).then((title) => this.storage.conversations.renameConversation(
    conversationId, orgId, title,
  )).catch(() => { /* swallow — fallback already applied */ });
}
```

---

### `src/routes/agent.ts` — add 5 conversation endpoints

**Analog:** same file's existing handlers under the `scope` register block (`routes/agent.ts:137-455`).

**Scope-register pattern to copy** (`:137-150`) — all new routes land INSIDE the same scope so rate-limit + `onSend` 429 rewrite apply:
```ts
await server.register(async (scope) => {
  await scope.register(rateLimit, { ... });
  scope.addHook('onSend', async (_req, reply, payload) => { ... });

  scope.post('/message', async (request, reply) => { ... });
  scope.get('/stream/:conversationId', async (request, reply) => { ... });
  // NEW — phase 35:
  scope.get('/conversations', handleListConversations);
  scope.get('/conversations/search', handleSearchConversations);
  scope.get('/conversations/:id', handleGetConversation);
  scope.post('/conversations/:id/rename', handleRenameConversation);
  scope.post('/conversations/:id/delete', handleDeleteConversation);
  ...
}, { prefix: '/agent' });
```

**Auth-guard + org-resolve pattern to copy** (`:174-205`) — applies to ALL 5 new handlers:
```ts
scope.post('/message', async (request, reply) => {
  const user = request.user;
  if (user === undefined) return reply.code(401).send({ error: 'unauthenticated' });
  const parsed = MessageBodySchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
  const orgId = resolveAgentOrgId(user, getPermissions(request));
  if (orgId === undefined) return reply.code(400).send({ error: 'no_org_context' });
  // ... business logic ...
});
```

**Org-scoped read pattern to copy** (`:244-251`):
```ts
const conv = await storage.conversations.getConversation(conversationId, orgId);
if (conv === null) return reply.code(404).send({ error: 'conversation_not_found' });
```

**Zod body schema pattern to copy** (`:69-72`):
```ts
const RenameBodySchema = z.object({
  title: z.string().trim().min(1).max(120),
});
```

**HTMX fragment return pattern to copy** (`:213-220`) — for list/search responses that replace the stacked-panel content; alternatively return JSON and render client-side (planner discretion). If HTML fragments: follow the `renderAgentMessagesFragment` compile-cache pattern (`:527-569`).

**Handler registration shape (new)**:
```ts
scope.get('/conversations', async (request, reply) => {
  const user = request.user;
  if (user === undefined) return reply.code(401).send({ error: 'unauthenticated' });
  const orgId = resolveAgentOrgId(user, getPermissions(request));
  if (orgId === undefined) return reply.code(400).send({ error: 'no_org_context' });
  const q = (request.query ?? {}) as Record<string, unknown>;
  const limit = Math.min(Number(q['limit'] ?? 20), 50);
  const offset = Math.max(Number(q['offset'] ?? 0), 0);
  const items = await storage.conversations.listForUser(user.id, orgId, { limit, offset });
  void reply.type('application/json'); // or text/html + partial render
  return reply.code(200).send({ items, nextOffset: items.length === limit ? offset + limit : null });
});
```

CSRF for POST `/rename` + `/delete`: use the existing `<meta name="csrf-token">` + HTMX interceptor (project convention); `@fastify/csrf-protection` is already registered (`server.ts:366`).

---

### `src/views/partials/agent-drawer.hbs` — insert history panel + history-open button

**Analog:** same file (existing header layout `:26-35` + `<aside>` slot).

**Pattern to copy — header button insertion alongside new-chat button** (`:28-31`):
```hbs
<button type="button" class="agent-drawer__new-chat btn btn--ghost btn--sm"
        aria-label="{{t "agent.newChat.label"}}"
        title="{{t "agent.newChat.label"}}"
        data-action="newChat">{{t "agent.newChat.button"}}</button>
```

Add alongside it:
```hbs
<button type="button" class="agent-drawer__history-open btn btn--ghost btn--sm"
        aria-label="{{t "agent.history.openAria"}}"
        title="{{t "agent.history.open"}}"
        aria-expanded="false"
        aria-controls="agent-history-panel"
        data-action="openAgentHistory">
  <svg ...>...</svg>
  <span class="sr-only">{{t "agent.history.open"}}</span>
</button>
```

**Slot pattern to copy for the stacked panel** — mirror the existing `.agent-drawer__messages` container (`:37-45`). Insert `{{> agent-history-panel ...}}` as a SIBLING so it can slide over via CSS `position: absolute; inset: 0; transform: translateX(100%)`.

---

### `src/views/partials/agent-history-panel.hbs` (NEW)

**Analog:** composite of `agent-messages.hbs` (empty/populated conditional) + `agent-drawer.hbs` (header shell).

**Pattern to copy — conditional empty/populated** (`agent-messages.hbs:1-8`):
```hbs
{{#if messages.length}}
  {{#each messages}}{{> agent-message this agentDisplayName=../agentDisplayName locale=../locale}}{{/each}}
{{else}}
  <div class="empty-state">
    <p>{{t "agent.firstOpen.greeting" name=agentDisplayName}}</p>
    <p class="form-hint">{{t "agent.emptyThread.hint"}}</p>
  </div>
{{/if}}
```

**For phase 35 — apply the same conditional around the list:**
```hbs
<section id="agent-history-panel" class="agent-drawer__history"
         role="region" aria-label="{{t "agent.history.panelLabel"}}" hidden>
  <header class="agent-drawer__history-head">
    <button type="button" class="agent-drawer__history-back btn btn--ghost btn--sm"
            data-action="closeAgentHistory"
            aria-label="{{t "agent.history.back"}}">{{t "agent.history.back"}}</button>
    <h3>{{t "agent.history.panelTitle"}}</h3>
  </header>
  <div class="agent-drawer__history-search">
    <input type="search" id="agent-history-search-input"
           role="searchbox" aria-controls="agent-history-list"
           placeholder="{{t "agent.history.search.placeholder"}}"
           autocomplete="off">
    <button type="button" class="agent-drawer__history-search-clear btn btn--ghost"
            data-action="clearAgentHistorySearch"
            aria-label="{{t "agent.history.search.clearAria"}}" hidden>&times;</button>
  </div>
  <div role="status" aria-live="polite" class="sr-only" id="agent-history-live"></div>
  <ul id="agent-history-list" class="agent-drawer__history-list" role="list">
    {{#if items.length}}
      {{#each items}}{{> agent-history-item this}}{{/each}}
    {{else}}
      <li class="agent-drawer__history-empty">
        <h4>{{t "agent.history.empty.title"}}</h4>
        <p class="form-hint">{{t "agent.history.empty.body"}}</p>
      </li>
    {{/if}}
  </ul>
  <div class="agent-drawer__history-sentinel" data-action="historySentinel" role="presentation"></div>
</section>
```

---

### `src/views/partials/agent-history-item.hbs` (NEW)

**Analog:** `agent-message.hbs:1-5` — data-id attribute pattern + conditional block.

**Pattern to copy** (`agent-message.hbs:1-5`):
```hbs
<div class="agent-msg agent-msg--user" data-message-id="{{id}}">
  <span class="agent-msg__role">{{t "agent.role.user"}}</span>
  <div class="agent-msg__body">{{content}}</div>
</div>
```

**For phase 35 item:**
```hbs
<li class="agent-drawer__history-item" data-conversation-id="{{id}}"
    role="button" tabindex="-1" data-action="resumeConversation"
    title="{{title}}">
  <div class="agent-drawer__history-item-title">{{#if title}}{{title}}{{else}}{{t "agent.history.untitled"}}{{/if}}</div>
  {{#if snippet}}
    <div class="agent-drawer__history-item-snippet">{{{snippet}}}</div>
  {{else}}
    <div class="agent-drawer__history-item-meta">{{t "agent.history.item.meta" timestamp=lastMessageAt count=messageCount}}</div>
  {{/if}}
  <button type="button" class="agent-drawer__history-item-menu btn btn--ghost"
          aria-haspopup="menu" aria-expanded="false"
          aria-label="{{t "agent.history.item.menuLabel" title=title}}"
          data-action="openHistoryItemMenu">
    <svg>...</svg>
  </button>
</li>
```

Note: `{{{snippet}}}` triple-brace renders the `<mark>`-wrapped HTML — server MUST produce escape-safe output (escape all non-match text, wrap only the match span).

---

### `src/static/agent.js` — history panel hydration + fetch + menu wiring

**Analog:** same file's `loadPanel()` (`agent.js:355-387`) + delegated event listener (`:637-675`).

**Fetch + fragment-swap pattern to copy** (`:355-387`):
```js
function loadPanel() {
  var cid = getConversationId();
  if (!cid || cid.length === 0) { return; }
  var url = '/agent/panel?conversationId=' + encodeURIComponent(cid);
  fetch(url, { credentials: 'same-origin', headers: { 'x-csrf-token': csrfToken() } })
    .then(function (r) { return r.ok ? r.text() : ''; })
    .then(function (html) {
      if (html.length > 0) { replaceMessagesFromHtml(html); }
      ...
    })
    .catch(function () { /* user can re-open */ });
}
```

**Event-delegation pattern to copy** (`:637-675`):
```js
document.addEventListener('click', function (e) {
  if (!e.target || !e.target.closest) return;
  if (e.target.closest('[data-action="toggleAgentDrawer"]')) { e.preventDefault(); if (isOpen()) closeDrawer(); else openDrawer(true); return; }
  if (e.target.closest('[data-action="closeAgentDrawer"]')) { e.preventDefault(); closeDrawer(); return; }
  if (e.target.closest('[data-action="newChat"]')) { e.preventDefault(); startNewConversation(); return; }
  ...
});
```

**For phase 35 — add handlers under the same delegated listener** (CSP-safe, no inline):
```js
// History panel toggle, search, menu, rename, delete, resume.
if (e.target.closest('[data-action="openAgentHistory"]')) { e.preventDefault(); openHistoryPanel(); return; }
if (e.target.closest('[data-action="closeAgentHistory"]'))  { e.preventDefault(); closeHistoryPanel(); return; }
if (e.target.closest('[data-action="clearAgentHistorySearch"]')) { e.preventDefault(); clearHistorySearch(); return; }
if (e.target.closest('[data-action="openHistoryItemMenu"]')) { e.preventDefault(); toggleItemMenu(e.target.closest('.agent-drawer__history-item')); return; }
if (e.target.closest('[data-action="renameConversation"]')) { ... }
if (e.target.closest('[data-action="deleteConversation"]')) { ... }  // opens inline confirm row
if (e.target.closest('[data-action="confirmDelete"]')) { ... }
if (e.target.closest('[data-action="cancelDelete"]')) { ... }
if (e.target.closest('[data-action="resumeConversation"]')) { e.preventDefault(); resumeConversation(e.target.closest('.agent-drawer__history-item').getAttribute('data-conversation-id')); return; }
```

**CSRF + fetch POST pattern** (mirrors `loadPanel`):
```js
fetch('/agent/conversations/' + encodeURIComponent(cid) + '/rename', {
  method: 'POST',
  credentials: 'same-origin',
  headers: {
    'Content-Type': 'application/json',
    'x-csrf-token': csrfToken(),
  },
  body: JSON.stringify({ title: newTitle }),
})
.then(function (r) { if (!r.ok) throw new Error('rename_failed'); return r.json(); })
.then(function (payload) { /* update DOM via createElement/textContent — never innerHTML */ })
.catch(function () { /* show form-hint--error under input */ });
```

**Debounce pattern** (new — UI-SPEC 250 ms):
```js
var historySearchTimer = null;
function onHistorySearchInput(value) {
  if (historySearchTimer) clearTimeout(historySearchTimer);
  historySearchTimer = setTimeout(function () {
    fetchHistorySearch(value);
  }, 250);
}
```

**IntersectionObserver pattern** (new — pagination sentinel):
```js
var historyIO = null;
function armHistorySentinel() {
  var sentinel = document.querySelector('.agent-drawer__history-sentinel');
  if (!sentinel || typeof IntersectionObserver !== 'function') return;
  if (historyIO) historyIO.disconnect();
  historyIO = new IntersectionObserver(function (entries) {
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].isIntersecting && !isFetchingMore) { fetchNextHistoryPage(); }
    }
  });
  historyIO.observe(sentinel);
}
```

**XSS safety reminder** (from the file header, `:6-9`): use `createTextNode` / `textContent` for user-supplied strings; use `DOMParser + importNode` for trusted same-origin HTML fragments. `<mark>` highlighting MUST be built in JS via `createElement('mark')`, not via string concat.

---

### `src/static/style.css` — new BEM block

**Analog:** existing `.agent-drawer__*` block and `.agent-msg--*` block in same file. BEM prefix locked to `agent-drawer__history*` per UI-SPEC.

Scope additions:
```css
.agent-drawer__history { position: absolute; inset: 0; background: var(--bg-primary);
  transform: translateX(100%); transition: transform var(--transition-base); }
.agent-drawer__history[aria-hidden="false"], .agent-drawer--history-open .agent-drawer__history {
  transform: translateX(0); }
@media (prefers-reduced-motion: reduce) {
  .agent-drawer__history { transition: none; }
}
/* ... list, item, menu, rename, confirm rows — all tokens from style.css */
```
No new CSS custom properties; tokens only (`--space-*`, `--font-size-*`, `--accent`, `--status-error`, `--focus-outline`). Empty-state reuses existing `.empty-state` class (see `agent-messages.hbs:4-7` usage).

---

### `src/i18n/locales/en.json` — add `agent.history.*` namespace

**Analog:** existing `agent.*` keys (lines 1585–1628 — flat keys with dots, value may contain `{{name}}` / `{{count}}` interpolation).

**Pattern to copy** (`en.json:1585-1628`):
```json
"agent.launch.label": "Open {{name}}",
"agent.launch.tooltip": "Chat with {{name}}",
"agent.drawer.title": "{{name}}",
"agent.firstOpen.greeting": "Hi, I'm {{name}}. I can help ...",
"agent.newChat.button": "New chat"
```

**For phase 35 — insert before the trailing `}` at line 1629**, adding exactly the keys listed in UI-SPEC §Copywriting Contract. Use the same flat-dotted style; ICU plural syntax (`{{count, plural, one {} other {s}}}`) is the project convention.

---

## Shared Patterns

### Authentication (all 5 new routes)
**Source:** `src/routes/agent.ts:174-188`
**Apply to:** every new `/agent/conversations*` handler
```ts
const user = request.user;
if (user === undefined) return reply.code(401).send({ error: 'unauthenticated' });
const orgId = resolveAgentOrgId(user, getPermissions(request));
if (orgId === undefined) return reply.code(400).send({ error: 'no_org_context' });
```

### Org-scoped lookup (defence against T-31-01)
**Source:** `src/db/sqlite/repositories/conversation-repository.ts:75-80`
**Apply to:** ALL new repo methods — NEVER query by `id` alone; always `id + org_id`.
```sql
WHERE id = ? AND org_id = ?
```

### Input validation
**Source:** `src/routes/agent.ts:69-72, 179-182`
**Apply to:** `/rename` body, search `q` param, pagination `limit`/`offset`.
```ts
const RenameBodySchema = z.object({ title: z.string().trim().min(1).max(120) });
const parsed = RenameBodySchema.safeParse(request.body);
if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
```

### CSRF
**Source:** project convention + `server.ts:366` (`@fastify/csrf-protection` globally registered) + `agent.js:359` (`'x-csrf-token': csrfToken()`)
**Apply to:** every POST from `agent.js` (rename, delete-confirm).

### Fragment-render caching (Handlebars)
**Source:** `src/routes/agent.ts:511-569` (`cachedAgentMessagesTemplate`, `resolveViewsDir`, helper registration)
**Apply to:** any HTML-fragment endpoint for the history panel. Reuse `resolveViewsDir()` and the same `{{t}}` + `eq` helper fallback block.

### XSS-safe DOM mutation (client)
**Source:** `src/static/agent.js:6-9` header comment + `:143-157` (DOMParser + importNode) + `:396-400` (createElement + textContent)
**Apply to:** every DOM insertion driven by server response. Never innerHTML untrusted strings.

### Rate-limit + onSend 429 rewrite
**Source:** `src/routes/agent.ts:140-171`
**Apply to:** automatic — new routes live inside the same `scope`, so no extra wiring needed. DO NOT re-register rate-limit outside scope.

---

## No Analog Found

| File / Concern | Role | Reason |
|----------------|------|--------|
| Three-dot kebab menu popover (`.agent-drawer__history-menu`) | component | No existing kebab/popover in admin tables — they use inline `btn btn--sm btn--danger` + `hx-confirm` instead. Build fresh from UI-SPEC's ARIA contract (`aria-haspopup="menu"`, `role="menu"`, `role="menuitem"`, roving focus). |
| Debounced live search input | component | No debounced search exists anywhere in dashboard. Build fresh per UI-SPEC (250 ms debounce, clear button, `<mark>`-highlighted snippets, SR live-region count). |
| IntersectionObserver infinite scroll | component | No existing IO-based pagination in dashboard (other paginated views use explicit buttons). Build fresh per UI-SPEC sentinel at bottom of list. |

Planner should reference RESEARCH.md / UI-SPEC for these three patterns rather than any codebase analog.

---

## Metadata

**Analog search scope:** `packages/dashboard/src/{routes,views,static,db,agent,i18n}`
**Files scanned:** 31 (incl. agent-drawer, agent-message, agent-messages, agent.js, style.css, routes/agent.ts, migrations.ts, conversation-repository.ts, admin views for kebab scout)
**Pattern extraction date:** 2026-04-24
