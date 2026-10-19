# Agent Companion Guide

> Luqen's in-dashboard chat agent — text + speech input, streaming responses,
> safe tool use, conversation history, and per-org context.

The agent companion is a side-drawer chat surface that lives on every
dashboard page. It uses Luqen's MCP catalogue under the hood, scoped to
your active organisation and your role.

## For end users

### Opening the agent

Click the **agent launch button** (chat-bubble icon, bottom-right of every
dashboard page) to open the drawer. The drawer state — open / closed and
size — persists across page navigations via `localStorage`. Press
`Escape` or click the backdrop to close.

The drawer is keyboard-accessible: focus moves into the input on open,
and `Tab` cycles through the controls.

### Asking a question

Type into the message box and press **Send** (or `Ctrl+Enter`). The agent
takes your turn together with a small slice of context (see
[Context hints](#context-hints)) and replies in the conversation transcript
above.

While a response is streaming, the **Send** button switches to a **Stop**
button. Hitting Stop cancels the in-flight stream cleanly — partial output
is preserved and the next turn starts fresh.

### Streaming responses

Responses arrive token-by-token over Server-Sent Events. The transcript
auto-scrolls only while you're already at the bottom — if you scroll up
to read earlier output the auto-scroll pauses so the agent doesn't yank
the viewport away from you. A subtle *streaming…* indicator appears at
the bottom of the transcript while data is flowing.

A live ARIA region announces stream status changes for screen readers.

### Tools the agent can use

The agent can call MCP tools on your behalf — listing scans, fetching
report details, querying issues, looking up brand scores, kicking off new
scans, and (for admins) the same admin tools surfaced via MCP. The exact
catalogue you see depends on your role — see the
[RBAC matrix](../reference/rbac-matrix.md) for the full mapping.

The agent runs only the tools your role allows in the current organisation,
and each tool runs with your permissions — the same rule the MCP endpoint
applies to you. A tool call outside that set is refused and recorded in the
agent audit.

When the agent decides to call a tool, you see a chip appear in the
transcript naming the tool, its arguments, and (when the call returns) a
collapsed result panel. You can expand any chip to see the raw JSON the
agent received.

For tools flagged as **destructive** (starting a site scan, queueing a
bulk fix), the agent must clear a native confirmation dialog before the
call runs. The dialog shows:

- The tool name and a one-line summary of what it will do
- The full JSON arguments
- **Approve** / **Cancel** buttons

Cancel is always safe — the conversation continues with the agent told
that you declined. Approve runs the tool and resumes streaming. Only you
can approve or cancel an action paused in your conversation, and Approve
checks again that your role still allows the tool: if it no longer does,
nothing runs and the dialog reports the error. Every approval is recorded
in the agent audit. If the approved tool fails to run, the action is closed
as failed and recorded in the agent audit as an error.

### Multi-step tool transparency

The agent can run multiple tools in a single turn — sometimes in
parallel, sometimes one after another (the result of one fed into the
next). Each step renders as its own chip in order so you can follow the
agent's reasoning. There is a per-turn retry budget; once exhausted the
agent stops calling tools and explains what it tried.

For the full mechanics see [multi-step-tools.md](./multi-step-tools.md).

### History panel

The drawer's **History** tab lists prior conversations. Each entry shows
the first user prompt, the conversation start time, and a turn count.
Click an entry to resume the conversation in place — the transcript
re-renders from the database and the agent picks up where you left off.

You can search conversation titles and soft-delete conversations you
don't want to keep. Soft-deleted conversations are recoverable for a
short window — see [agent-history.md](./agent-history.md).

### Share permalinks

Every conversation has a **Share** action that produces a permalink.
Anyone with the link who has access to your org can open the read-only
transcript at `/agent/share/<id>`. Permalinks are revocable from the
conversation menu.

For the share semantics and revocation model see
[streaming-share-links.md](./streaming-share-links.md).

### Org switching

If you belong to multiple organisations the drawer shows an **Org**
selector. Changing it does *not* affect the conversation you are reading,
but the *next* turn (and any new conversation) takes the new org as its
context. The org is also baked into every MCP tool call: the agent can
only see scans, reports, and brand data belonging to the active org.

For details, including how shared conversations behave when the viewer's
active org differs from the original, see
[multi-org-switching.md](./multi-org-switching.md).

### Speech input

If your browser supports the Web Speech API, a microphone button appears
next to the input. Tap it to start dictating; tap again to stop. The
recognised text populates the input box but is **never auto-submitted**
— you always get a chance to read and edit before pressing Send.

Browser support today: Chromium-based browsers (Chrome, Edge) and Safari
include speech recognition. Firefox does not — the microphone button is
hidden on browsers that lack the API and a small hint explains why.

Tap-to-start triggers the browser's microphone-permission prompt the
first time. If you decline, the button reverts to its idle state and
nothing else changes.

The recognition language follows `navigator.language`, falling back to
`en-US`.

### Context hints

The agent sees a small, automatically generated context bundle on every
turn, read with your permissions in the conversation's organisation: the
organisation's name, its most recent scans when your role can view reports
there (`reports.view`), and its brand guideline names when your role can
view branding there (`branding.view`). A user who holds no permission in
the organisation gets no context bundle. You don't need to paste in URLs or
report IDs — ask "what changed in my last scan?" and the agent already
knows which scan you mean.

Context hints are visible in the transcript as a faint "context"
indicator above your first turn — click it to expand the exact bundle
that was injected. If a turn would push the conversation past 85% of the
model's token budget, older turns are auto-compacted before the new turn
runs; you'll see a "summarised earlier turns" pill where the compaction
happened.

## For admins

### Who can use the agent

The agent is available to every signed-in user; there is no separate
"agent on/off" toggle, and the `mcp.use` permission governs connecting
external MCP clients (the OAuth consent screen and every MCP request), not
the in-dashboard agent. What the agent can do follows the user's permissions in the
organisation: tools are offered and run only when the user's role holds
the tool's permission, re-checked at every step, so removing a permission
removes the tools that need it from the agent's next step.

The agent acts for the signed-in dashboard user account. A person who signs
in through the compliance service needs a dashboard user account (managed
at `/admin/dashboard-users`) and signs in with it to use the agent.

### RBAC permissions

The agent's tool catalogue is the set of tools whose required permission
the user holds in the active org, resolved from the user's stored roles at
every step (a deactivated user, or a user who no longer belongs to the
organisation, is offered none; global administrators are served in every
organisation). A tool that is not in the
catalogue does not run, even if the model names it, and the tool that runs
receives the user's permissions, so a global administrator's agent works
across organisations where an organisation user's works in its own. See the
[RBAC matrix](../reference/rbac-matrix.md) for the complete mapping.

### Token cost considerations

The dashboard does not currently expose per-conversation or per-org token
spend in real time. Per-org cost dashboards are planned for v3.2.0;
today's visibility comes from:

- The audit log (one row per agent turn) at `/admin/audit`, including
  model name and token-budget compaction events
- The LLM provider's own dashboard (Ollama / OpenAI / etc.)

Plan for ~2k–6k tokens per turn including context bundle and tool
results.

### Audit log coverage

Every agent turn produces audit entries:

- The user prompt and the model response (truncated to a configurable
  preview length)
- Each tool call, with arguments and outcome (`success`, `error`,
  `denied`, `timeout`). An argument named like a password, secret, token,
  API key, authorization value or credential is stored as `[redacted]`,
  at any depth, in the agent audit and in the conversation's stored
  messages (including an action awaiting confirmation)
- Token-budget compaction events
- Soft-delete and share-link operations on conversations

Surface the audit at `/admin/audit`; CSV export is available via the
filter bar.

### Configuration env vars

Agent-relevant environment variables (see
[`installer-env-vars.md`](../reference/installer-env-vars.md) for the
full inventory):

- `LLM_BASE_URL` / `LLM_CLIENT_ID` / `LLM_CLIENT_SECRET` — points the
  dashboard at the LLM service
- `AGENT_HISTORY_RETENTION_TURNS` — rolling window for visible history
  (default 20)
- `AGENT_TOKEN_BUDGET_RATIO` — compaction threshold (default `0.85`)
- `AGENT_DEFAULT_MODEL` — the model used for agent turns when no
  per-org override is set

## See also

- [MCP integration guide](./mcp-integration.md) — connecting external
  clients to the same catalogue the agent uses
- [Agent history](./agent-history.md) — search, resume, soft-delete
- [Multi-step tools](./multi-step-tools.md) — parallel dispatch, retry
  budget, transparency UI
- [Streaming UX + share permalinks](./streaming-share-links.md)
- [Multi-org switching](./multi-org-switching.md)
- [Prompt templates](./prompt-templates.md) — authoring the prompts the
  agent runs on
- [RBAC matrix](../reference/rbac-matrix.md)
