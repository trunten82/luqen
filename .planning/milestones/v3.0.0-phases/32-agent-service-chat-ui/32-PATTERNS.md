# Phase 32: Agent Service + Chat UI — Pattern Map

**Mapped:** 2026-04-19
**Files analyzed:** 32 (11 NEW, 21 MODIFY)
**Analogs found:** 30 / 32 (2 greenfield: sse-frames, agent-conversation streaming capability — no existing streaming capability in the repo)

Scope derived from `32-CONTEXT.md` §Integration points, `32-AI-SPEC.md` §3 Recommended Project Structure + §4c.1 catalog registrations, and `32-UI-SPEC.md` Surfaces 1–5. Where UI-checker flagged the org-settings path as ambiguous, I resolved it by grep: the existing org-edit surface **does not exist today** — there is only `POST /admin/organizations` (create) and `POST /admin/organizations/:id/delete`. Phase 32 must introduce a new edit/settings route (recommended path `/admin/organizations/:id/settings`, modeled on the existing `/admin/organizations/:id/branding-mode` two-step handler in `packages/dashboard/src/routes/admin/organizations.ts` lines 438–540).

---

## File Classification

### Backend — `@luqen/llm`

| File | NEW/MOD | Role | Data Flow | Closest Analog | Match |
|------|---------|------|-----------|----------------|-------|
| `/root/luqen/packages/llm/src/providers/anthropic.ts` | NEW | provider-adapter | request-response + streaming | `packages/llm/src/providers/openai.ts` | role-match (no existing streaming adapter anywhere — SDK-wrapped adapter is a new pattern) |
| `/root/luqen/packages/llm/src/providers/openai.ts` | MOD | provider-adapter | request-response → + streaming | self (ext. D-11) | self |
| `/root/luqen/packages/llm/src/providers/ollama.ts` | MOD | provider-adapter | request-response → + streaming | self (line 43 `stream:false` → streaming code path) | self |
| `/root/luqen/packages/llm/src/providers/types.ts` | MOD | type-contract | n/a (interface) | self — extend `LLMProviderAdapter` with a `completeStream()` method | self |
| `/root/luqen/packages/llm/src/providers/registry.ts` | MOD | registry | n/a (factory) | self — append `anthropic: () => new AnthropicAdapter()` | self |
| `/root/luqen/packages/llm/src/capabilities/agent-conversation.ts` | NEW | capability | streaming (ReadableStream<SseFrame>) | `packages/llm/src/capabilities/extract-requirements.ts` | role-match; analog is synchronous — new file returns a stream |
| `/root/luqen/packages/llm/src/capabilities/types.ts` | MOD | type-contract | n/a (errors + result) | self — add streaming return variant | self |
| `/root/luqen/packages/llm/src/types.ts` | MOD | type-contract | n/a | self (lines 28–39) — add `'agent-conversation'` to `CapabilityName` + `CAPABILITY_NAMES` | self |
| `/root/luqen/packages/llm/src/api/routes/prompts.ts` | MOD | route | request-response | self — add `case 'agent-system':` branch in `getDefaultTemplate` switch at line 17 | self |
| `/root/luqen/packages/llm/src/prompts/agent-system.ts` | NEW | prompt-template | build-string | `packages/llm/src/prompts/*` existing build functions (e.g. `buildExtractionPrompt`) | role-match |

### Backend — `@luqen/dashboard` agent core

| File | NEW/MOD | Role | Data Flow | Closest Analog | Match |
|------|---------|------|-----------|----------------|-------|
| `/root/luqen/packages/dashboard/src/agent/agent-service.ts` | NEW | service (orchestrator) | event-driven + streaming | `packages/dashboard/src/services/scan-service.ts` (injected service class, constructor DI) + AI-SPEC §3 skeleton | role-match |
| `/root/luqen/packages/dashboard/src/agent/sse-frames.ts` | NEW | type-contract (zod schemas) | n/a | AI-SPEC §4b.1 skeleton + existing zod patterns in `packages/dashboard/src/mcp/tools/*.ts` (but those use `inputSchema`, not discriminated unions — this is a new shape) | greenfield |
| `/root/luqen/packages/dashboard/src/agent/tool-dispatch.ts` | NEW | service (MCP call wrapper) | request-response | `packages/dashboard/src/mcp/server.ts` composition + `packages/dashboard/src/mcp/tools/admin.ts` handler pattern | role-match |
| `/root/luqen/packages/dashboard/src/agent/jwt-minter.ts` | NEW | utility | stateless sign | `packages/dashboard/src/auth/oauth-signer.ts` (`createDashboardSigner` + `mintAccessToken`) | **exact** |
| `/root/luqen/packages/dashboard/src/agent/system-prompt.ts` | NEW | prompt-loader | read-through | `packages/llm/src/prompts/segments.ts` usage pattern; new file stays in dashboard (loader, not template owner) | role-match |

### Backend — `@luqen/dashboard` routes & wiring

| File | NEW/MOD | Role | Data Flow | Closest Analog | Match |
|------|---------|------|-----------|----------------|-------|
| `/root/luqen/packages/dashboard/src/routes/agent.ts` | NEW | route | request-response + SSE | `packages/dashboard/src/routes/oauth/token.ts` (Fastify plugin fn signature + DI) + `packages/dashboard/src/routes/scan.ts` (HTMX+JSON hybrid route style) | role-match (no existing SSE route — SSE writing pattern comes from AI-SPEC §4b.2) |
| `/root/luqen/packages/dashboard/src/server.ts` | MOD | wiring | n/a | self — existing `ScanService` construction at line 934; add AgentService construction + register `/agent` routes + rate-limit scope | self |
| `/root/luqen/packages/dashboard/src/db/sqlite/migrations.ts` | MOD | migration | DDL | self — existing migrations 047 (conversations) + 048 (audit log); add migration `050` (after 049 `oauth-clients-v2`) for `organizations.agent_display_name TEXT` column + optional capability-assignment seed | self |
| `/root/luqen/packages/dashboard/src/mcp/metadata.ts` | MOD | type-contract | n/a | self — extend `DASHBOARD_TOOL_METADATA` rows with optional `confirmationTemplate` field per D-28; widen `ToolMetadata` interface in `@luqen/core` | self |
| `/root/luqen/packages/core/src/mcp/types.ts` | MOD | type-contract | n/a | self — add optional `confirmationTemplate?: (args: Record<string,unknown>) => string` field to `ToolMetadata` interface (line 42) | self |

### Backend — admin surface extensions A/B/C/D

| File | NEW/MOD | Role | Data Flow | Closest Analog | Match |
|------|---------|------|-----------|----------------|-------|
| `/root/luqen/packages/dashboard/src/routes/admin/llm.ts` | MOD | route | request-response | self — extend rendering for Surface 3 (agent-conversation row), Surface 4 (agent-system locked fences), Surface 5 Part C (Anthropic models) | self |
| `/root/luqen/packages/dashboard/src/routes/admin/organizations.ts` | MOD | route | request-response | self — add `GET /admin/organizations/:id/settings` + `POST` handler (model on `/branding-mode` at lines 438–540) | self |
| `/root/luqen/packages/dashboard/src/views/admin/llm.hbs` | MOD | view (handlebars) | server-render | self — extend `capabilities` / `prompts` / `models` tab panels with Surface 3/4/5 markup | self |
| `/root/luqen/packages/dashboard/src/views/admin/organization-settings.hbs` | NEW | view-partial | server-render | `packages/dashboard/src/views/admin/organization-form.hbs` (create form) + `packages/dashboard/src/views/admin/partials/branding-mode-toggle.hbs` (two-step edit form) | role-match |
| `/root/luqen/packages/dashboard/src/i18n/locales/en.json` | MOD | i18n | static | self — append ~56 keys under new `agent.*` + extend existing `admin.llm.*` + `admin.orgs.*` | self |

### Frontend — chat drawer surfaces

| File | NEW/MOD | Role | Data Flow | Closest Analog | Match |
|------|---------|------|-----------|----------------|-------|
| `/root/luqen/packages/dashboard/src/views/layouts/main.hbs` | MOD | layout (handlebars) | server-render | self — inject floating button + drawer mount inside `{{#if user}}` block (next to `{{> sidebar}}` at line 27); also add SR-only live region `#agent-aria-status` | self |
| `/root/luqen/packages/dashboard/src/views/partials/agent-drawer.hbs` | NEW | view-partial | server-render | `packages/dashboard/src/views/partials/sidebar.hbs` (shares drawer+backdrop pattern; `is-open` class) + `packages/dashboard/src/views/partials/brand-drilldown-modal.hbs` (modal anatomy) | role-match |
| `/root/luqen/packages/dashboard/src/views/partials/agent-messages.hbs` | NEW | view-partial | server-render | `packages/dashboard/src/views/admin/partials/prompt-segments.hbs` (list partial w/ per-row rendering) | role-match |
| `/root/luqen/packages/dashboard/src/views/partials/agent-confirm-dialog.hbs` | NEW | view-partial (native `<dialog>`) | server-render + client `.showModal()` | `packages/dashboard/src/views/partials/rescore-button.hbs` (native `<dialog>` + `.modal__header` / `.modal__body` / `.modal__footer`) | **exact** |
| `/root/luqen/packages/dashboard/src/static/style.css` | MOD | stylesheet | n/a | self — append scoped `/* ---- Agent Drawer (Phase 32) ---- */` banner ≤ 200 LOC | self |
| `/root/luqen/packages/dashboard/src/static/agent.js` | NEW | client-script | EventSource + DOM | `packages/dashboard/src/static/app.js` (IIFE, event delegation, CSRF meta interceptor) — plus EventSource example in `packages/dashboard/src/static/htmx-sse.js:76-77` (then **unused**: new code uses a plain `new EventSource(url, { withCredentials: true })`) | role-match |

### Tests

| File | NEW/MOD | Role | Data Flow | Closest Analog | Match |
|------|---------|------|-----------|----------------|-------|
| `/root/luqen/packages/llm/tests/providers/anthropic.test.ts` | NEW | test | n/a | `packages/llm/tests/providers/openai.test.ts` | **exact** |
| `/root/luqen/packages/llm/tests/capabilities/agent-conversation.test.ts` | NEW | test | n/a | `packages/llm/tests/capabilities/extract-requirements.test.ts` | **exact** |
| `/root/luqen/packages/dashboard/tests/agent/agent-service.test.ts` | NEW | test | n/a | `packages/dashboard/tests/routes/oauth/token.test.ts` (SQLite-backed integration test) + `packages/dashboard/tests/mcp/middleware.test.ts` (dependency-injected stub storage) | role-match |
| `/root/luqen/packages/dashboard/tests/routes/agent.test.ts` | NEW | test | n/a | `packages/dashboard/tests/routes/oauth/token.test.ts` | role-match |
| `/root/luqen/packages/dashboard/tests/mcp/destructive-hint.test.ts` | NEW | test | n/a | `packages/dashboard/tests/mcp/middleware.test.ts` + `packages/dashboard/tests/mcp/tool-metadata-drift.test.ts` | role-match |

---

## Pattern Assignments

### NEW `packages/llm/src/providers/anthropic.ts` (provider-adapter, request-response + streaming)

**Analog:** `/root/luqen/packages/llm/src/providers/openai.ts`

**Imports pattern** (openai.ts:1):
```typescript
import type { LLMProviderAdapter, CompletionOptions, CompletionResult, RemoteModel } from './types.js';
```

**Class shape** (openai.ts:3–17):
```typescript
export class OpenAIAdapter implements LLMProviderAdapter {
  readonly type = 'openai';

  private baseUrl = '';
  private apiKey = '';

  async connect(config: { baseUrl: string; apiKey?: string }): Promise<void> {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey ?? '';
  }

  async disconnect(): Promise<void> {
    this.baseUrl = '';
    this.apiKey = '';
  }
```

**Complete + timeout/signal pattern** (openai.ts:38–65):
```typescript
async complete(prompt: string, options: CompletionOptions): Promise<CompletionResult> {
  const messages: Array<{ role: string; content: string }> = [];
  if (options.systemPrompt) messages.push({ role: 'system', content: options.systemPrompt });
  messages.push({ role: 'user', content: prompt });

  const timeoutMs = options.timeout ? options.timeout * 1000 : undefined;
  const signal = timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined;

  const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
    body: JSON.stringify(body),
    signal,
  });
```

**Delta notes:**
- Use the `@anthropic-ai/sdk` (pin during planning, AI-SPEC §3 install target = `0.90.0`) instead of raw `fetch` — per AI-SPEC §3 Pitfall 2 use `client.messages.stream({...}).finalMessage()` to avoid hand-rolling `input_json_delta.partial_json` accumulation.
- Add a new method `completeStream()` that returns a `ReadableStream<SseFrame>` (or `AsyncIterable`) so the capability can forward token deltas and one buffered `tool_calls` frame.
- Map `CompletionOptions` to Anthropic `messages` API (`system` param is top-level, not a message).
- Tool-result messages shape per AI-SPEC §4 Tool Use: `{role:'user', content:[{type:'tool_result', tool_use_id, content: JSON.stringify(result)}]}`.

---

### MOD `packages/llm/src/providers/openai.ts` (MOD: add streaming)

**Analog:** self — keep existing `complete()` untouched.

**Delta notes:**
- Add `completeStream()` method per the extended `LLMProviderAdapter` interface (see `providers/types.ts`).
- Set `stream: true` + `stream_options: { include_usage: true }` in body.
- Buffer `delta.tool_calls[].function.arguments` until `finish_reason === 'tool_calls'` (AI-SPEC §3 Pitfall 1) — emit **exactly one** `tool_calls` SSE frame once complete. Stream plain `delta.content` as `token` frames.

---

### MOD `packages/llm/src/providers/ollama.ts` (MOD: add streaming)

**Analog:** self. Line 43 currently hardcodes `stream: false`.

**Current non-streaming request body** (ollama.ts:40–48):
```typescript
const body = {
  model: options.model,
  messages,
  stream: false,
  options: {
    temperature: options.temperature,
    num_predict: options.maxTokens,
  },
};
```

**Delta notes:**
- Keep `complete()` as-is (used by other capabilities — touching breaks 4 unrelated tests).
- Add `completeStream()` that flips `stream: true`; parse NDJSON response using `res.body.getReader()` + `TextDecoder`.
- Per D-11: Ollama batches `tool_calls` at end-of-turn (emits one `message.tool_calls` array once `done=true`). So: accumulate content deltas → emit `token` frames; on `done=true`, if `message.tool_calls` is present emit one `tool_calls` SSE frame; otherwise emit `done`.

---

### MOD `packages/llm/src/providers/types.ts` (type-contract)

**Analog:** self.

**Current interface** (types.ts:22–29):
```typescript
export interface LLMProviderAdapter {
  readonly type: string;
  connect(config: { baseUrl: string; apiKey?: string }): Promise<void>;
  disconnect(): Promise<void>;
  healthCheck(): Promise<boolean>;
  listModels(): Promise<readonly RemoteModel[]>;
  complete(prompt: string, options: CompletionOptions): Promise<CompletionResult>;
}
```

**Delta notes:**
- Add:
```typescript
completeStream?(
  messages: readonly ChatMessage[],
  options: CompletionOptions & { tools?: readonly ToolDef[] },
  signal?: AbortSignal,
): AsyncIterable<SseFrame>;
```
- Keep the method **optional** to avoid breaking `extract-requirements`/`generate-fix`/etc. that never need streaming. `agent-conversation` capability can assert presence and throw a clear "provider does not support streaming" error otherwise.
- Add `ChatMessage`, `ToolDef` types co-located here.

---

### MOD `packages/llm/src/providers/registry.ts` (registry)

**Analog:** self (registry.ts:6–9):
```typescript
const ADAPTER_FACTORIES: Record<string, () => LLMProviderAdapter> = {
  ollama: () => new OllamaAdapter(),
  openai: () => new OpenAIAdapter(),
};
```

**Delta notes:** append `anthropic: () => new AnthropicAdapter()`. Add matching `import { AnthropicAdapter } from './anthropic.js'`. No other change — `getSupportedTypes()` picks it up automatically.

---

### NEW `packages/llm/src/capabilities/agent-conversation.ts` (capability, streaming)

**Analog:** `/root/luqen/packages/llm/src/capabilities/extract-requirements.ts`

**Execute-signature pattern** (extract-requirements.ts:36–47):
```typescript
export async function executeExtractRequirements(
  db: DbAdapter,
  adapterFactory: (type: string) => LLMProviderAdapter,
  input: ExtractRequirementsInput,
  retryOpts?: RetryOptions,
): Promise<CapabilityResult<ExtractedRequirements>> {
  const maxRetries = retryOpts?.maxRetries ?? 2;
  const models = await db.getModelsForCapability('extract-requirements', input.orgId);
  if (models.length === 0) throw new CapabilityNotConfiguredError('extract-requirements');
```

**Fallback-chain pattern** (extract-requirements.ts:55–98):
```typescript
for (const model of models) {
  const provider = await db.getProvider(model.providerId);
  if (provider == null) continue;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const adapter = adapterFactory(provider.type);
      await adapter.connect({ baseUrl: provider.baseUrl, apiKey: provider.apiKey });
      const result = await adapter.complete(prompt, { model: model.modelId, temperature: 0.1, timeout: provider.timeout });
      const data = parseExtractedRequirements(result.text);
      return { data, model: model.displayName, provider: provider.name, attempts: totalAttempts };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
}
throw new CapabilityExhaustedError('extract-requirements', totalAttempts, lastError);
```

**Error class pattern** (capabilities/types.ts:1–17):
```typescript
export class CapabilityExhaustedError extends Error { /* ... */ }
export class CapabilityNotConfiguredError extends Error { /* ... */ }
```

**Delta notes:**
- Signature returns `AsyncIterable<SseFrame>` (not `CapabilityResult<T>`). Capability engine's per-model fallback loop still applies — but fallback triggers on stream-open failure, not mid-stream (mid-stream errors become an `error` SSE frame and consume the turn, per D-23).
- Reads the `agent-system` prompt via `db.getPromptOverride('agent-system', orgId)` with fallback to the default template from `packages/llm/src/prompts/agent-system.ts`.
- Invokes `adapter.completeStream(messages, { model, tools, maxTokens: 2048, temperature: 0.3, timeout: 30 })` — per AI-SPEC §4 Model Configuration.
- Per §4b.3: system prompt NEVER concatenates user input; user messages flow as `role='user'`, tool results as `role='tool'` (or Anthropic's `tool_result`).

---

### MOD `packages/llm/src/types.ts` (line 28–39 capability union)

**Current:**
```typescript
export type CapabilityName =
  | 'extract-requirements'
  | 'generate-fix'
  | 'analyse-report'
  | 'discover-branding';

export const CAPABILITY_NAMES: readonly CapabilityName[] = [
  'extract-requirements',
  'generate-fix',
  'analyse-report',
  'discover-branding',
] as const;
```

**Delta notes:** append `| 'agent-conversation'` to the union AND `'agent-conversation'` to the array. No new interface. Zero TypeScript breakage elsewhere (union expansion is additive).

---

### MOD `packages/llm/src/api/routes/prompts.ts` (switch at line 17)

**Current switch body** (prompts.ts:16–44):
```typescript
function getDefaultTemplate(capability: CapabilityName): string {
  switch (capability) {
    case 'extract-requirements': return EXTRACT_DEFAULT_TEMPLATE;
    case 'generate-fix': return buildGenerateFixPrompt({ /* ... */ });
    case 'analyse-report': return buildAnalyseReportPrompt({ /* ... */ });
    case 'discover-branding': return buildDiscoverBrandingPrompt({ /* ... */ });
    default: return `Capability: ${capability}\nContent: {content}`;
  }
}
```

**Delta notes:**
- Add `case 'agent-system': return buildAgentSystemPrompt();` — no args needed; the template contains the three `<!-- LOCKED:rbac --> <!-- LOCKED:confirmation --> <!-- LOCKED:honesty -->` fences per AI-SPEC §4b.3 literal copy.
- Import from new file `../../prompts/agent-system.js`.
- The `validateOverride` call at line 134 already enforces locked-section preservation — no changes needed there. The info pill "Global only — per-org override disabled" is enforced at the admin UI template level and additionally by a server-side refusal to accept `orgId !== undefined` on PUT for `agent-system` (add a guard just after the existing `CAPABILITY_NAMES.includes` check on line 112; defence-in-depth per AI-SPEC §6.1 Guardrail 5).

---

### NEW `packages/dashboard/src/agent/agent-service.ts` (service, event-driven)

**Analog:** AI-SPEC §3 skeleton + `packages/dashboard/src/services/scan-service.ts` for DI class shape.

**Constructor DI shape** (scan-service.ts analog — note same package):
```typescript
export class ScanService {
  constructor(
    private readonly storage: StorageAdapter,
    private readonly orchestrator: ScanOrchestrator,
    private readonly config: DashboardConfig,
  ) {}
  // ...
}
```

**Copy-paste seed:** AI-SPEC §3 lines 192–298 (`AgentTurnInput` interface + `AgentService.runTurn()` with the 55-line while-loop, already annotated with D-06/D-07 cap and destructive-hint branch).

**Delta notes:**
- `AgentService` depends on: `storage: StorageAdapter` (for `conversations` + `agentAudit` repos), `llm: LlmClient` (existing `packages/dashboard/src/llm-client.ts`), `allTools: readonly ToolMetadata[]` (from `./mcp/metadata.js`), and a `dispatchTool` dep wired to `ToolDispatcher`.
- Do NOT cache `DASHBOARD_TOOL_METADATA` filtering across iterations — rebuild manifest every iteration (AI-SPEC §3 Pitfall 6 + §6.1 Guardrail 1).
- Per-iteration: `resolveEffectivePermissions(storage, userId, orgId)` from `packages/dashboard/src/permissions.ts`.
- **Global rule reminder (coding-style.md, immutability):** the `AgentTurnInput` and every emit should be treated as immutable — the `emit` callback receives a fresh frame per call, never mutated in place.

---

### NEW `packages/dashboard/src/agent/sse-frames.ts` (zod-typed frames)

**Analog:** AI-SPEC §4b.1 skeleton (lines 450–499) — verbatim.

**Core shape (zod discriminated union + typed writer):**
```typescript
export const SseFrameSchema = z.discriminatedUnion('type', [
  TokenFrameSchema, ToolCallsFrameSchema, PendingConfirmationFrameSchema, DoneFrameSchema, ErrorFrameSchema,
]);
export type SseFrame = z.infer<typeof SseFrameSchema>;

export function writeFrame(reply: FastifyReply, frame: SseFrame): boolean {
  SseFrameSchema.parse(frame);  // throws on malformed frame
  return reply.raw.write(`event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`);
}
```

**Delta notes:** greenfield. Zod 4.3.6 already installed. No existing SSE-frame union in the repo — closest zod use is inside MCP `inputSchema` definitions, not discriminated unions.

---

### NEW `packages/dashboard/src/agent/tool-dispatch.ts` (service — wraps MCP handler)

**Analog:** `/root/luqen/packages/dashboard/src/mcp/server.ts` (composition) + `/root/luqen/packages/dashboard/src/mcp/tools/admin.ts` (handler registration).

**MCP server composition pattern** (server.ts:42–65):
```typescript
export async function createDashboardMcpServer(options: DashboardMcpServerOptions): Promise<{
  readonly server: McpServer;
  readonly toolNames: readonly string[];
  readonly metadata: readonly ToolMetadata[];
}> {
  const { storage, scanService, serviceConnections } = options;
  const server = new McpServer(
    { name: 'luqen-dashboard', version: VERSION },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );
  registerDataTools(server, { storage, scanService });
  registerAdminTools(server, { storage, serviceConnections });
  // ...
  return { server, toolNames: [...DATA_TOOL_NAMES, ...ADMIN_TOOL_NAMES], metadata: DASHBOARD_TOOL_METADATA };
}
```

**Delta notes:**
- Phase 32 per D-08 + AI-SPEC §4 Tool Use: **direct in-process MCP handler invocation** (option a) — faster, no network hop. Wrap the existing `createDashboardMcpServer` result and call tool handlers through the SDK's in-memory transport.
- Per AI-SPEC §4b.1 Boundary 2 — `tool.inputSchema.safeParse(call.args)` BEFORE dispatch; on fail, return `{error:'invalid_args', issues: parsed.error.issues}` back to the LLM loop (§6.1 Guardrail 6). Maps to existing zod patterns — validated per `typescript/coding-style.md` rule "Use Zod for schema-based validation".
- Per-dispatch JWT mint via `jwt-minter.ts` (§3 Pitfall 5 — don't mint per-request, mint per-dispatch).

---

### NEW `packages/dashboard/src/agent/jwt-minter.ts` (utility)

**Analog:** `/root/luqen/packages/dashboard/src/auth/oauth-signer.ts` — **exact match**.

**`createDashboardSigner` pattern** (oauth-signer.ts:67–103):
```typescript
import { importPKCS8, SignJWT, type JWTPayload } from 'jose';
// ...
export async function createDashboardSigner(
  storage: StorageAdapter,
  encryptionKey: string,
): Promise<DashboardSigner> {
  const activeKeys = await storage.oauthSigningKeys.listActiveKeys();
  const activeKey = activeKeys[0];
  if (activeKey === undefined) throw new Error('No active OAuth signing key');
  const privateKeyPem = decryptSecret(activeKey.encryptedPrivateKeyPem, encryptionKey);
  const privateKey = await importPKCS8(privateKeyPem, 'RS256');
  const issuer = getDashboardIssuer();

  return {
    currentKid: activeKey.kid,
    async mintAccessToken(input: MintAccessTokenInput): Promise<string> {
      const claims: JWTPayload = {
        sub: input.sub, scopes: [...input.scopes], orgId: input.orgId,
        aud: [...input.aud], client_id: input.clientId,
      };
      return new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid: activeKey.kid })
        .setIssuedAt().setExpirationTime(`${input.expiresInSeconds}s`)
        .setIssuer(issuer).sign(privateKey);
    },
  };
}
```

**Delta notes:**
- **Reuse the same `DashboardSigner` instance already constructed in `server.ts:954`** — do NOT build a new signer with a different key. Inject the existing one into AgentService.
- Per D-03 + D-04 + AI-SPEC §6.1 Guardrail 7: mint with `sub = dashboard_users.id` (the user's session `sub`), `orgId = request.user.currentOrgId`, `scopes = resolveEffectivePermissions(...)` flattened to the permission-suffix scope list, `aud = [dashboard MCP resource URI]`, `expiresInSeconds = 300`, `clientId` = a reserved pseudo-client id (e.g. `'__agent-internal__'`) for the Phase 31.2 D-20 revoke-check carve-out. Planner should confirm the chosen `clientId` value during Task 1 and coordinate with the mcp/middleware revoked-client check so internal agent tokens aren't matched against the `oauth_clients_v2` table.
- **Security rule (common/security.md):** no hardcoded secrets — reuse the DB-persisted signing key already handled by `createDashboardSigner`. Zero new secret material.

---

### NEW `packages/dashboard/src/routes/agent.ts` (route — SSE + HTMX hybrid)

**Analog:** `/root/luqen/packages/dashboard/src/routes/oauth/token.ts` (Fastify plugin fn DI) + `/root/luqen/packages/dashboard/src/routes/scan.ts` (HTMX+JSON hybrid route).

**Plugin fn shape** (token.ts:86–91):
```typescript
export async function registerTokenRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
  signer: DashboardSigner,
): Promise<void> {
  server.post('/oauth/token', async (request: FastifyRequest, reply: FastifyReply) => {
    // ...
  });
}
```

**HTMX+JSON hybrid pattern** (scan.ts:130–140):
```typescript
if (!result.ok) {
  const isHtmx = request.headers['hx-request'] === 'true';
  if (isHtmx || request.headers['accept']?.includes('text/html')) {
    // render HTML partial
  }
  // else JSON
}
```

**Per-route rate-limit example** (scan.ts:78):
```typescript
server.post('/scan/new', { config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } }, ...);
```

**CSRF + auth-guard pattern** (existing admin routes — e.g. organizations.ts:47):
```typescript
server.get('/admin/organizations', { preHandler: requirePermission('admin.system') }, ...);
```

**Delta notes:**
- Five routes: `POST /agent/message`, `GET /agent/stream/:conversationId`, `POST /agent/confirm/:messageId`, `POST /agent/deny/:messageId`, `GET /agent/panel`.
- All routes session-guarded (D-03) via existing `preHandler: requirePermission` or lighter cookie-session auth guard (whichever matches the "logged-in user, any role" shape — grep existing home.ts routes for the lightest pattern).
- SSE route uses `reply.raw` after setting `Content-Type: text/event-stream` + `Cache-Control: no-cache` + `Connection: keep-alive` headers (AI-SPEC §4b.2). AbortSignal plumbed from `request.raw.socket` close event.
- Rate limit: 60/min per user per AI-SPEC §6.1 Guardrail 4. Use `config.rateLimit: { max: 60, timeWindow: '1 minute' }` at route level. **JSON-only response** (not HTML) per `feedback_rate_limiter.md` — the global rate-limit onSend hook in `server.ts:338–348` only rewrites HTML for browsers; for `/agent/*` which browsers consume as fetch/JSON we need the default JSON shape or a local `errorResponseBuilder` override returning `{error:'rate_limited', retry_after_ms}`.
- **Global convention (common/coding-style.md, error handling):** use explicit try/catch around the SSE streaming loop; `error` frame + `reply.raw.end()` on any catch, and persist `status='failed'` via `conversations.updateMessageStatus` per D-23.

---

### MOD `packages/dashboard/src/server.ts` (wiring)

**Existing ScanService construction pattern** (server.ts:934):
```typescript
const mcpScanService = new ScanService(storage, orchestrator, config);
await registerMcpRoutes(server, {
  verifyToken: mcpVerifier, storage, scanService: mcpScanService,
  serviceConnections: serviceConnectionsRepo,
  resourceMetadataUrl: `${dashboardPublicUrl}/.well-known/oauth-protected-resource`,
});
```

**Existing DashboardSigner construction** (server.ts:954):
```typescript
const dashboardSigner = await createDashboardSigner(storage, config.sessionSecret);
```

**Delta notes:**
- After `dashboardSigner` is created, instantiate `AgentService`:
  ```typescript
  const agentService = new AgentService(storage, llmClient, DASHBOARD_TOOL_METADATA, dashboardSigner);
  await registerAgentRoutes(server, agentService, storage, getLLMClient);
  ```
- No global rate-limit change — per-route config on `/agent/*` handles it (see route file).
- Import `AgentService` from `./agent/agent-service.js`, `registerAgentRoutes` from `./routes/agent.js`.

---

### MOD `packages/dashboard/src/db/sqlite/migrations.ts` (migration — add `050`)

**Analog:** existing migration 049 (migrations.ts:1276):
```typescript
{
  id: '049',
  name: 'oauth-clients-v2',
  sql: `CREATE TABLE IF NOT EXISTS oauth_clients_v2 (...);`,
},
```

**Delta notes:**
- Append migration `{ id: '050', name: 'agent-display-name', sql: "ALTER TABLE organizations ADD COLUMN agent_display_name TEXT;" }`.
- Idempotent via `IF NOT EXISTS` for DDL; the migration runner at migrations.ts:50–63 skips already-applied ids so this is safe on re-run.
- Seed (optional) for AI-SPEC §4c.1 item #5 — "pre-assign `claude-haiku-4-5-20251001` to `agent-conversation` at priority 1 for bootstrap org" — is better done in the `@luqen/llm` package migration rather than here (the capability assignment lives in the LLM module's DB, not the dashboard's).

---

### MOD `packages/dashboard/src/mcp/metadata.ts` + `packages/core/src/mcp/types.ts` (add confirmationTemplate)

**Current** (`packages/core/src/mcp/types.ts:42–46`):
```typescript
export interface ToolMetadata {
  readonly name: string;
  readonly requiredPermission?: string;
  readonly destructive?: boolean;
}
```

**Current dashboard metadata** (`packages/dashboard/src/mcp/metadata.ts:26–33`):
```typescript
export const DASHBOARD_DATA_TOOL_METADATA: readonly ToolMetadata[] = [
  { name: 'dashboard_scan_site',         requiredPermission: 'scans.create',  destructive: true },
  { name: 'dashboard_list_reports',      requiredPermission: 'reports.view' },
  // ...
];
```

**Delta notes (core/types.ts):**
- Add optional field:
  ```typescript
  readonly confirmationTemplate?: (args: Record<string, unknown>) => string;
  ```
- Phase 32 AgentService reads this via `this.allTools.find(t => t.name === call.name)?.confirmationTemplate?.(call.args)`. Fallback to tool description when undefined (AI-SPEC §4 Tool Use + UI-SPEC Surface 2 "Friendly template absent" state).
- Rename the **field semantics note**: D-26 uses `destructiveHint: true`. Luqen's `ToolMetadata.destructive` already matches semantically — keep existing field name to avoid a rename storm; the planner may alias `destructiveHint = destructive` in AgentService only.

**Delta notes (dashboard/mcp/metadata.ts):**
- Add `confirmationTemplate` closures on destructive rows, e.g. `dashboard_scan_site: (args) => \`Start a WCAG scan of ${args.siteUrl}\``. Keep the list concise (≤ 80 chars per template).

---

### MOD `packages/dashboard/src/routes/admin/llm.ts` (add agent-conversation + agent-system + Anthropic rendering)

**Current loop** (llm.ts:89–92):
```typescript
const CAPABILITY_NAMES = ['extract-requirements', 'generate-fix', 'analyse-report', 'discover-branding'];
const promptData = llmConnected ? await Promise.all(CAPABILITY_NAMES.map(async (cap) => { /* ... */ })) : [];
```

**Delta notes:**
- Extend the local `CAPABILITY_NAMES` constant to include `'agent-conversation'` for the prompts tab to list the new entry. Note: this is a local copy — the canonical list lives in `@luqen/llm/types.ts:CAPABILITY_NAMES` — plan a follow-up TODO to consolidate.
- Extend the admin-llm route to render Surface 3 badges on the agent-conversation row (AI-SPEC §4c.2.A + UI-SPEC Surface 3): tool-use badge, manifest-size indicator, destructive-count badge, iteration-cap static copy. Manifest-size query = `dashboard_mcp_server.tools.length` after filtering by org permissions.
- For Surface 4 (agent-system prompt editor) — hide the per-org override control when `capability === 'agent-conversation'`; render locked-fence distinct borders via new CSS classes (§4c.2.B).
- For Surface 5 Part C — Anthropic models auto-appear once catalog entry lands; no route change needed here (purely a model-registry seed).

---

### MOD `packages/dashboard/src/routes/admin/organizations.ts` (add settings edit route for agent_display_name)

**Analog:** Same file — `/admin/organizations/:id/branding-mode` GET+POST at lines 439–540 (two-step confirm pattern; use simpler single-step for agent_display_name).

**GET handler pattern** (organizations.ts:439–467):
```typescript
server.get(
  '/admin/organizations/:id/branding-mode',
  { preHandler: requirePermission('admin.system', 'admin.org') },
  async (request, reply) => {
    const { id } = request.params as { id: string };
    const org = await storage.organizations.getOrg(id);
    if (org === null) return reply.code(404).header('content-type','text/html').send(toastHtml('Organization not found.','error'));
    const isAdmin = request.user?.role === 'admin';
    if (!isAdmin && request.user?.currentOrgId !== id) {
      return reply.code(403).header('content-type','text/html').send(toastHtml('Forbidden', 'error'));
    }
    return reply.view('admin/partials/branding-mode-toggle.hbs', { mode: 'form', org });
  },
);
```

**Delta notes:**
- Add `GET /admin/organizations/:id/settings` (render form) + `POST /admin/organizations/:id/settings` (update `agent_display_name`).
- Zod validation per AI-SPEC §4c.2.D + UI-SPEC Surface 5 Part D Validation: `z.string().trim().max(40).regex(/^(?!.*(?:<|>|https?:\/\/|\/\/))/).or(z.literal(''))`.
- Permission preHandler: `requirePermission('admin.system', 'admin.org')` (matches branding-mode); tenant isolation check `!isAdmin && currentOrgId !== id`.
- Add a new `updateOrgAgentDisplayName(orgId, displayName)` method on `storage.organizations` (write-through to `organizations.agent_display_name` column added by migration 050). Mirror the shape of existing `updateOrgComplianceClient` at organizations.ts:114.
- Surface success/failure via `toastHtml` (existing helper in `routes/admin/helpers.ts`) to match the file's convention.
- **User-input validation rule (typescript/coding-style.md):** validate at the system boundary. Server-side zod runs first; client `maxlength=40` is cosmetic.

---

### MOD `packages/dashboard/src/views/admin/llm.hbs` (add Surface 3/4/5 markup)

**Analog:** self (llm.hbs:18–40 — tab nav) + `packages/dashboard/src/views/admin/partials/prompt-segments.hbs` (locked-fence card pattern).

**Locked-fence card pattern** (prompt-segments.hbs:20–30):
```handlebars
<div class="card card--muted mb-sm" aria-label="{{t "admin.llm.prompts.lockedSection"}}">
  <div class="card__header" style="gap:0.5rem;align-items:center">
    <span aria-hidden="true" style="font-size:0.9rem">&#x1F512;</span>
    <code class="text-sm text-muted">{{name}}</code>
    <span class="badge badge--neutral text-sm">{{t "admin.llm.prompts.lockedSection"}}</span>
  </div>
  <div class="card__body" style="padding-top:0">
    <pre class="prompt-segment-content">{{content}}</pre>
  </div>
</div>
```

**Delta notes:** apply new BEM-style modifier classes `.card--locked-rbac`, `.card--locked-confirmation`, `.card--locked-honesty` from UI-SPEC Surface 4. Reuse all existing badge/alert classes; no inventing new primitives. The three new `card--locked-*` CSS rules live in style.css under the Phase 32 banner, each ≤ 3 lines of border-left declaration.

---

### NEW `packages/dashboard/src/views/partials/agent-drawer.hbs` (drawer partial)

**Analog structure:** sidebar.hbs (drawer+backdrop, `is-open` class) + brand-drilldown-modal.hbs (modal anatomy). Use UI-SPEC Surface 1 DOM literally (already complete handlebars in the spec).

**Pattern excerpt (sidebar backdrop — main.hbs:25):**
```handlebars
<div class="sidebar-backdrop" id="sidebar-backdrop" data-action="closeSidebar"></div>
```

**Delta notes:** UI-SPEC Surface 1 "DOM Structure" section provides the full handlebars body — copy verbatim. New helpers to register in `src/i18n/index.ts` or `src/views/helpers/*`: none needed, `{{t "key" name=agentDisplayName}}` syntax is already supported by the existing i18n helper.

---

### NEW `packages/dashboard/src/views/partials/agent-confirm-dialog.hbs` (native `<dialog>`)

**Analog:** `/root/luqen/packages/dashboard/src/views/partials/rescore-button.hbs` — **exact match** for native `<dialog>` + `.modal__*` + `.btn--danger` pattern.

**Pattern** (rescore-button.hbs:8–34):
```handlebars
<dialog id="rescore-confirm-dialog">
  <div class="modal__header">
    <h3>{{t "rescore.confirmHeading"}}</h3>
  </div>
  <div class="modal__body">
    {{#if (eq candidateCount 0)}}
      <p>{{t "rescore.noCandidates"}}</p>
    {{else}}
      <p>{{t "rescore.confirmBody" count=candidateCount}}</p>
    {{/if}}
  </div>
  <div class="modal__footer">
    <button type="button" class="btn btn--secondary" autofocus
            {{#if (eq candidateCount 0)}}disabled{{/if}}
            hx-post="/brand-overview/rescore/start"
            hx-target="#rescore-region"
            hx-swap="outerHTML"
            hx-vals='{"_csrf": "{{csrfToken}}"}'
            onclick="this.closest('dialog').close()">
      {{t "rescore.confirmStart"}}
    </button>
    <button type="button" class="btn btn--ghost"
            onclick="this.closest('dialog').close()">
      {{t "rescore.confirmCancel"}}
    </button>
  </div>
</dialog>
```

**Delta notes:**
- Copy UI-SPEC Surface 2 DOM verbatim (lines 536–569). Key differences from rescore analog: `autofocus` lands on **Cancel** (safe default, UI-SPEC acceptance #4) rather than Approve; Approve uses `.btn--danger` and wires to `/agent/confirm/:messageId` via plain-JS fetch (CSP-safe `data-action` delegation in `agent.js`), NOT `hx-post` — the rescore form's `onclick="this.closest('dialog').close()"` needs to be replaced with `data-action="agentConfirmApprove"` since the CSP in main.hbs forbids inline-handler-scripts by default (check `@fastify/helmet` config).

---

### NEW `packages/dashboard/src/static/agent.js` (client-script)

**Analog:** `/root/luqen/packages/dashboard/src/static/app.js` — IIFE wrapper, event delegation, CSRF interceptor, `data-action=` selector pattern.

**IIFE + CSRF pattern** (app.js:1–8):
```javascript
(function () {
  'use strict';
  /* ── CSRF: send token on every HTMX request ─────────────────────── */
  document.addEventListener('htmx:configRequest', function (e) {
    var meta = document.querySelector('meta[name="csrf-token"]');
    if (meta) e.detail.headers['x-csrf-token'] = meta.getAttribute('content');
  });
  // ...
})();
```

**Event delegation pattern** (app.js:46–78):
```javascript
document.addEventListener('click', function (e) {
  var btn = e.target.closest && e.target.closest('[data-action="some-action"]');
  if (!btn) return;
  // ...
});
```

**EventSource — plain, per D-20 / D-21 (do NOT use htmx-sse.js):**
```javascript
var es = new EventSource('/agent/stream/' + encodeURIComponent(conversationId), { withCredentials: true });
es.addEventListener('token', function (ev) { /* append tokens */ });
es.addEventListener('pending_confirmation', function (ev) {
  var data = JSON.parse(ev.data);
  populateDialog(data);
  document.getElementById('agent-confirm-dialog').showModal();
});
es.addEventListener('done', function () { es.close(); });
es.addEventListener('error', function () { es.close(); renderErrorCard(); });
```

**Delta notes:**
- Use plain JS fetch for `/agent/confirm/:messageId` (with CSRF header via existing `meta[name="csrf-token"]` pattern); do NOT use `hx-post` inside the `<dialog>` because HTMX's `hx-select` inheritance has caused cross-section swap breakage (memory `feedback_htmx_inheritance`).
- localStorage: `localStorage.luqen.agent.panel = 'open' | 'closed'` read on DOMContentLoaded, apply class before first paint (UI-SPEC Surface 1 Persistence Rules).
- Web Speech API: `const SR = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SR) { hide speech button }` — D-31.
- **Global rule (typescript/coding-style.md):** no `console.log` in production code. Use comments for in-file notes only.
- **Global rule (typescript/security.md):** the EventSource URL includes `conversationId` from the server-rendered drawer — escape via `encodeURIComponent` to prevent user-controlled characters being appended.

---

### MOD `packages/dashboard/src/static/style.css` (≤ 200 LOC Phase 32 banner)

**Analog:** existing banner structure in style.css (`/* ---- Design Tokens (Light Mode) ---- */` lines 7, 100, 148, 158, 180, 199, 211, 213, 391, 426, 485, 512, 529, 560, 644, 692, 697, 704, 769, 838 ...).

**Delta notes:**
- Append single banner `/* ---- Agent Drawer (Phase 32) ---- */` at end of file. All new classes: `.agent-launch`, `.agent-drawer`, `.agent-drawer__*`, `.agent-msg*`, `.agent-confirm__*`, `.agent-backdrop`, `.chat-btn--icon`, `.sr-only`, `.card--locked-rbac`, `.card--locked-confirmation`, `.card--locked-honesty`.
- All values reference existing tokens — no new CSS custom properties (UI-SPEC Registry Safety: "no third-party registries; all CSS from internal design system").
- Reduced-motion already enforced globally at style.css:148–155 — new transitions will inherit.

---

### MOD `packages/dashboard/src/views/layouts/main.hbs` (floating button + drawer mount + SR live region)

**Analog:** self — inject near the `{{#if user}}` block (line 23) so the drawer is only rendered for authenticated pages.

**Delta notes:**
- Inside `{{#if user}}`, after `{{> sidebar}}` (line 27), add:
  ```handlebars
  {{> agent-drawer agentDisplayName=(or user.orgAgentDisplayName "Luqen Assistant") csrfToken=csrfToken locale=locale}}
  {{> agent-confirm-dialog agentDisplayName=...}}
  <div id="agent-aria-status" class="sr-only" aria-live="polite" aria-atomic="true"></div>
  ```
- Add `<script src="/static/agent.js?v=1.0.0"></script>` after the existing `app.js` tag (main.hbs:120). Order matters: agent.js depends on app.js's CSRF interceptor.
- The `user.orgAgentDisplayName` must be populated by the existing session-decorator code (whoever populates `request.user` — check `packages/dashboard/src/auth/session.ts`). Planner adds a new passthrough during Task 3.

---

### MOD `packages/dashboard/src/i18n/locales/en.json` (~56 new keys)

**Analog:** self — existing key shape `{"common": {...}, "admin": {...}}` pattern; nested per-scope.

**Delta notes:**
- Add top-level `"agent": { "launch": {...}, "drawer": {...}, "firstOpen": {...}, "input": {...}, "speech": {...}, "stream": {...}, "role": {...}, "tool": {...}, "error": {...}, "confirm": {...} }` per UI-SPEC Copywriting Contract.
- Extend existing `"admin.llm"` with `agentConv.*` and `prompts.agentSystem*` groups.
- Extend existing `"admin.orgs.settings"` with `agentDisplayName*` keys.
- Mirror additions to `de.json`, `es.json`, `fr.json`, `it.json`, `pt.json` — at minimum duplicate English defaults so the admin pages don't 404 on translations.
- **Global rule (feedback_i18n_templates):** all template text must use `{{t}}` keys — no hardcoded English in the handlebars files.

---

### NEW `packages/llm/tests/providers/anthropic.test.ts` (test)

**Analog:** `/root/luqen/packages/llm/tests/providers/openai.test.ts` — **exact**.

**Vitest + fetch-stub pattern** (openai.test.ts:1–15):
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIAdapter } from '../../src/providers/openai.js';

describe('OpenAIAdapter', () => {
  let adapter: OpenAIAdapter;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    adapter = new OpenAIAdapter();
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    await adapter.connect({ baseUrl: 'https://api.openai.com', apiKey: 'sk-test-key' });
  });
  // ...
});
```

**Delta notes:**
- For the SDK-wrapped Anthropic adapter, stub the SDK (`vi.mock('@anthropic-ai/sdk', ...)`) instead of `fetch`. Exercise `completeStream()` via an async-iterable fake; assert that plain-text deltas surface as `token` frames and a buffered `tool_use` block surfaces as a single `tool_calls` frame.
- Parity tests against Ollama + OpenAI fixtures per AI-SPEC §5.1 Dimension 6 live in `tests/providers/registry.test.ts` or a new `parity.test.ts` — scope them during plan-phase Task 1.

---

### NEW `packages/llm/tests/capabilities/agent-conversation.test.ts`

**Analog:** `/root/luqen/packages/llm/tests/capabilities/extract-requirements.test.ts` — **exact** for SQLite-backed capability test.

**SQLite-backed test pattern** (extract-requirements.test.ts:12–48):
```typescript
const TEST_DIR = mkdtempSync(join(tmpdir(), 'llm-cap-exec-test-'));
const TEST_DB = join(TEST_DIR, 'test.db');
function cleanup() { if (existsSync(TEST_DB)) unlinkSync(TEST_DB); }

function makeAdapter(responses: Array<{ text: string } | Error>): LLMProviderAdapter {
  let callIndex = 0;
  return {
    type: 'mock',
    connect: vi.fn().mockResolvedValue(undefined),
    // ...
    complete: vi.fn(async () => { /* ... */ }),
  };
}
```

**Delta notes:**
- Build a mock adapter implementing `completeStream` that yields `SseFrame` events. Assert the capability forwards `token` frames and terminates on `done` or `tool_calls`.
- Seed a `Provider` + `Model` + capability assignment of `'agent-conversation'` (requires the MOD to `types.ts` landed first).

---

### NEW `packages/dashboard/tests/agent/agent-service.test.ts`

**Analog:** `/root/luqen/packages/dashboard/tests/routes/oauth/token.test.ts` (SQLite-backed integration — lines 1–80) + `/root/luqen/packages/dashboard/tests/mcp/middleware.test.ts` (stub-storage DI).

**Integration test ctx pattern** (token.test.ts:39–80):
```typescript
async function buildCtx(): Promise<Ctx> {
  setEncryptionSalt('phase-31-1-plan-02-token-test-salt');
  const dbPath = join(tmpdir(), `test-token-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  await ensureInitialSigningKey(storage, ENC_KEY);
  const signer = await createDashboardSigner(storage, ENC_KEY);
  // seed users + clients ...
  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));
  await registerTokenRoutes(server, storage, signer);
  await server.ready();
  return { server, storage, /* ... */, cleanup: async () => { await server.close(); await storage.disconnect(); if (existsSync(dbPath)) rmSync(dbPath); } };
}
```

**Delta notes:**
- Fixtures per AI-SPEC §5.3 (22 fixtures) — at minimum the Critical 7 + Critical 2 cross-tenant land in Task 1.
- Adversarial tests: `rbac-revoked-mid-turn`, `pending-confirmation-reload`, `destructive-batch-pause`. Match §5 Dimension numbers in test names for traceability.
- **Global rule (common/testing.md, TDD):** write the failing test first for every guarded invariant (RBAC manifest rebuild, destructive-pause, iteration cap, invalid-args, JWT subject pin).

---

### NEW `packages/dashboard/tests/routes/agent.test.ts`

**Analog:** `/root/luqen/packages/dashboard/tests/routes/oauth/token.test.ts` — full integration against Fastify + SQLite.

**Delta notes:**
- Simulate `EventSource` via `fetch` with `Accept: text/event-stream`; parse the SSE response body line-by-line (split on `\n\n`, match `event:` + `data:`).
- Cover: session-guarded 302/401; rate-limit hit → JSON body (not HTML); SSE reconnect-after-`done` is idempotent (re-opening returns 204 or empty stream — do NOT replay persisted assistant message, which the client should already have).

---

### NEW `packages/dashboard/tests/mcp/destructive-hint.test.ts`

**Analog:** `/root/luqen/packages/dashboard/tests/mcp/tool-metadata-drift.test.ts` (metadata enumeration) + `packages/dashboard/tests/mcp/middleware.test.ts` (stub storage).

**Delta notes:**
- Assert every `destructive: true` row in `DASHBOARD_TOOL_METADATA` has an associated `confirmationTemplate` function OR is in an allow-list of "template-fallback OK" names (planner decides).
- Assert that the AgentService's destructive-batch-pause behavior fires when any tool in the `tool_calls` batch is destructive (Section 1b Failure Mode #4).

---

## Shared Patterns

### Authentication (for agent routes)

**Source:** `packages/dashboard/src/auth/middleware.ts` — `requirePermission` / `createAuthGuard`; `packages/dashboard/src/routes/admin/organizations.ts:47` shows the canonical call site.

**Apply to:** All `POST /agent/message`, `GET /agent/stream/:id`, `POST /agent/confirm/:id`, `POST /agent/deny/:id`, `GET /agent/panel`. Session-guard only (not `requirePermission` — agent is any-authenticated-user scope per D-03). Internal per-request JWT mint for MCP dispatch uses `jwt-minter.ts` analog from `oauth-signer.ts`.

```typescript
// Pattern (existing):
server.get('/admin/organizations', { preHandler: requirePermission('admin.system') }, ...);
// Phase 32 adaptation — lighter session guard (any logged-in user):
server.post('/agent/message', { preHandler: server.authGuard /* or requireSession */ }, ...);
```

### Error handling

**Source:** `packages/dashboard/src/services/scan-service.ts` (validate-first pattern — `{ok: false, error: string}` vs `{ok: true, data}`) + `packages/llm/src/capabilities/types.ts` (typed error classes).

**Apply to:** All service-layer code. AgentService returns nothing from `runTurn` — it emits frames — so the error convention is: always emit an `error` SSE frame before closing; always persist `status='failed'` on the in-flight assistant row; always audit-log the outcome.

```typescript
// Pattern (scan-service.ts):
export interface ScanValidationError { readonly ok: false; readonly error: string; }
// Phase 32 adaptation — SSE frame is the error channel:
emit({ type: 'error', code: 'provider_failed', message: '...', retryable: true });
```

### Validation (tool-call args, org form input)

**Source:** `packages/llm/src/api/routes/prompts.ts:134` (`validateOverride` zod check) + AI-SPEC §4b.1 `tool.inputSchema.safeParse(call.args)`.

**Apply to:** AgentService tool-dispatch, `POST /admin/organizations/:id/settings` (agent_display_name validation).

```typescript
const parsed = schema.safeParse(input);
if (!parsed.success) {
  return { error: 'invalid_args', issues: parsed.error.issues };
}
```

### HTMX + CSRF

**Source:** `packages/dashboard/src/views/layouts/main.hbs:17` (meta tag), `packages/dashboard/src/views/layouts/main.hbs:65–72` (CSRF interceptor), `packages/dashboard/src/views/admin/organization-form.hbs:9` (`<input type="hidden" name="_csrf" value="{{csrfToken}}">`).

**Apply to:** Every form partial in agent-drawer.hbs. Plain-JS fetch from `agent.js` reads the meta tag: `document.querySelector('meta[name="csrf-token"]').getAttribute('content')`.

### Rate-limit (JSON response, not HTML)

**Source:** `packages/dashboard/src/server.ts:315–348` (global) — note `onSend` hook returns HTML for browser Accept; for `/agent/*` we override to JSON.

**Apply to:** Per-route config on `/agent/*`:
```typescript
server.post('/agent/message', {
  config: {
    rateLimit: {
      max: 60,
      timeWindow: '1 minute',
      errorResponseBuilder: (_req, ctx) => ({
        error: 'rate_limited',
        retry_after_ms: ctx.ttl,
      }),
    },
  },
}, ...);
```

### Native `<dialog>` pattern

**Source:** `packages/dashboard/src/views/partials/rescore-button.hbs` (canonical), `packages/dashboard/src/views/partials/brand-drilldown-modal.hbs` (overlay-class variant).

**Apply to:** `agent-confirm-dialog.hbs` — use `<dialog>` with `.modal__header/__body/__footer`, native focus-trap, `showModal()`/`close()`.

### MCP ToolMetadata + RBAC filter

**Source:** `packages/core/src/mcp/tool-filter.ts:24` (`filterToolsByScope`) + `packages/dashboard/src/permissions.ts` (`resolveEffectivePermissions`).

**Apply to:** AgentService every iteration — rebuild manifest per-turn.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `packages/dashboard/src/agent/sse-frames.ts` | type-contract (zod discriminated union) | n/a | Zod unions exist but no SSE-frame discriminated-union module is in the repo. Use AI-SPEC §4b.1 skeleton verbatim. |
| `packages/llm/src/capabilities/agent-conversation.ts` (streaming return shape) | capability | streaming | All existing capabilities return `CapabilityResult<T>` synchronously. Streaming is new ground — follow AI-SPEC §4b.2 async-iterable contract. |

---

## Resolved Ambiguities

- **Org-settings route file:** UI-checker flagged ambiguity about `routes/admin/orgs.ts` vs `routes/admin/organizations.ts`. Confirmed by grep — `/root/luqen/packages/dashboard/src/routes/admin/organizations.ts` is the canonical file; there is no `orgs.ts` under `routes/admin/`. The existing file is the target.
- **Edit form existence:** The existing org admin surface has no "edit" form — only create (`POST /admin/organizations`), delete, branding-mode, and members. Phase 32 must introduce `GET/POST /admin/organizations/:id/settings` routes — model on the existing `/admin/organizations/:id/branding-mode` GET+POST handler at organizations.ts:438–540 (simpler single-step, no `_confirm` two-step needed for a free-text field).
- **View template:** No existing `organization-settings.hbs` exists (confirmed via `ls packages/dashboard/src/views/admin/`). Create new, mirror the structure of `organization-form.hbs` (create form) + `partials/branding-mode-toggle.hbs` (two-mode edit partial).
- **Migration numbering:** Next available id is `050` (047 = agent-conversations+messages; 048 = agent-audit-log; 049 = oauth-clients-v2). Use `050` for the `agent_display_name` column.
- **Capability-name list duplication:** `CAPABILITY_NAMES` is defined in `packages/llm/src/types.ts:34` but also hand-duplicated in `packages/dashboard/src/routes/admin/llm.ts:90`. Planner should extend BOTH — and file a technical-debt TODO to consolidate the local copy by importing from `@luqen/llm/types`.
- **Per-org override block for `agent-system`:** MOD `packages/llm/src/api/routes/prompts.ts` PUT handler needs a defence-in-depth refusal for `orgId !== undefined` when `capability === 'agent-system'` — add just after line 112's `CAPABILITY_NAMES.includes` check.

---

## Metadata

**Analog search scope:**
- `/root/luqen/packages/llm/src/` + `/root/luqen/packages/llm/tests/`
- `/root/luqen/packages/dashboard/src/` + `/root/luqen/packages/dashboard/tests/`
- `/root/luqen/packages/core/src/mcp/` (for `ToolMetadata` shape)

**Pattern extraction date:** 2026-04-19
**Files scanned:** ~45 source files + 6 test files read; glob over `views/`, `static/`, `routes/`, `db/sqlite/`.
