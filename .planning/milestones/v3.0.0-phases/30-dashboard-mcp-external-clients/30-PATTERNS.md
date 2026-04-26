# Phase 30: Dashboard MCP + External Clients — Pattern Map

**Mapped:** 2026-04-17
**Files analyzed:** 9 new/modified files
**Analogs found:** 8 / 9 (MCP Resources + Prompts have NO in-repo analog — SDK types are the primary reference; see "No Analog Found")
**SDK version:** `@modelcontextprotocol/sdk` **1.27.1** (from `/root/luqen/node_modules/@modelcontextprotocol/sdk/package.json`)
**Upstream inputs:** 30-CONTEXT.md (D-01..D-17), 28-PATTERNS.md, 28-03-PLAN.md, 29-CONTEXT.md (D-12, D-13), 29-01-PLAN.md, 29-02-PLAN.md

---

## File Classification

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------------|------|-----------|----------------|---------------|
| `packages/dashboard/src/mcp/server.ts` (REWRITE — from empty stub to 6 data + ≥13 admin tools + 2 resources + 3 prompts) | tool/resource/prompt registry | request-response + URI read | **tools:** `packages/branding/src/mcp/server.ts` (org-scoped) + `packages/llm/src/mcp/server.ts` (global error-mapping) · **resources + prompts:** MCP SDK (no in-repo) | exact for tools; no analog for resources/prompts |
| `packages/dashboard/src/mcp/metadata.ts` (NEW) | metadata table | n/a | `packages/branding/src/mcp/metadata.ts` | exact |
| `packages/dashboard/src/mcp/prompts.ts` (NEW — optional split per Claude's Discretion) | prompt factory | n/a | MCP SDK `registerPrompt` (no in-repo) | none — see SDK refs |
| `packages/dashboard/src/mcp/resources.ts` (NEW — optional split per Claude's Discretion) | resource factory | URI read | MCP SDK `registerResource` (no in-repo) | none — see SDK refs |
| `packages/core/src/mcp/tool-filter.ts` (MODIFIED — add `filterResourcesByPermissions` + `filterResourcesByScope`) | utility/filter | request-response | self — existing `filterToolsByPermissions` / `filterToolsByScope` | exact (mirror) |
| `packages/core/src/mcp/http-plugin.ts` (MODIFIED — add `ListResourcesRequestSchema` + `ReadResourceRequestSchema` filter overrides mirroring existing `ListToolsRequestSchema`) | plugin/factory | request-response | self — existing `ListToolsRequestSchema` override (lines 113–140) | exact (mirror) |
| `packages/core/src/mcp/types.ts` (MODIFIED — add `ResourceMetadata` alongside `ToolMetadata` if RBAC annotation needed per-URI) | model/types | n/a | self — existing `ToolMetadata` | exact (mirror) |
| `packages/dashboard/src/routes/api/mcp.ts` (MODIFIED — pass `storage` through to the factory for repo access) | controller/bootstrap | request-response | self — existing registerMcpRoutes (Phase 28 baseline) | exact |
| `packages/dashboard/tests/mcp/http.test.ts` (MODIFIED — extend Phase 28's 6 cases with tools, resources, prompts, D-17 iteration, admin-tool assertions) | integration-test | n/a | `packages/branding/tests/mcp/http.test.ts` + `packages/compliance/tests/mcp/http.test.ts` lines 140–229 | exact (pattern reuse) |
| `packages/dashboard/tests/mcp/inspector-smoke.test.ts` (NEW) | integration-test / CLI spawn | child_process | no direct analog | none — SDK CLI pattern |
| `docs/mcp-client-setup.md` (NEW) | docs | n/a | `docs/reference/mcp-tools.md` (existing MCP reference — 3 stdio servers documented) | role-match |

---

## Pattern Assignments

### 1. `packages/dashboard/src/mcp/server.ts` — tools (6 data + ≥13 admin)

**Primary analog — org-scoped tool pattern (D-01 data tools):** `packages/branding/src/mcp/server.ts` lines 60–188.

**Imports block to replicate** (`packages/branding/src/mcp/server.ts` lines 12–19):

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getCurrentToolContext } from '@luqen/core/mcp';
import type { SqliteAdapter } from '../db/sqlite-adapter.js';
import { BrandingMatcher } from '../matcher/index.js';
import type { MatchableIssue } from '../types.js';
import { VERSION } from '../version.js';
import { BRANDING_TOOL_METADATA } from './metadata.js';
```

For dashboard, substitute repository imports:

```typescript
import type { Storage } from '../storage.js';  // or individual repos
import type { ScanService } from '../services/scan-service.js';
// ... one import per repo the tools touch
```

**McpServer constructor with capability pre-registration** (`packages/branding/src/mcp/server.ts` lines 61–64):

```typescript
const server = new McpServer(
  { name: 'luqen-branding', version: VERSION },
  { capabilities: { tools: {} } },
);
```

**CRITICAL for Phase 30:** Phase 28's dashboard stub uses `server.server.registerCapabilities({ tools: { listChanged: false } })` after construction (see `packages/dashboard/src/mcp/server.ts` line 35). Since Phase 30 adds resources + prompts too, the constructor line MUST declare all three capabilities up-front:

```typescript
const server = new McpServer(
  { name: 'luqen-dashboard', version: VERSION },
  { capabilities: { tools: {}, resources: {}, prompts: {} } },
);
```

(The SDK's `registerResource` / `registerPrompt` auto-register their capabilities via `setResourceRequestHandlers` / `setPromptRequestHandlers` — see `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js` lines 339–343, 403–407 — but declaring them up-front keeps the shape identical to Phase 28 and avoids drift with the HTTP plugin's `setRequestHandler` overrides Phase 30 will install for Resources.)

**Tool registration shape — org-scoped handler** (`packages/branding/src/mcp/server.ts` lines 82–104):

```typescript
server.registerTool(
  'branding_get_guideline',
  {
    description: 'Get a single brand guideline by ID, including its colors, fonts, and selectors.',
    inputSchema: z.object({
      id: z.string().describe('Guideline ID'),
    }),
  },
  // orgId: ctx.orgId (org-scoped — cross-org guard: guideline.orgId must match caller)
  async (args) => {
    const _ctx = getCurrentToolContext();
    const orgId = resolveOrgId();
    const guideline = db.getGuideline(args.id);
    if (guideline == null || guideline.orgId !== orgId) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `Guideline "${args.id}" not found` }) }],
        isError: true,
      };
    }
    return { content: [{ type: 'text', text: JSON.stringify(guideline, null, 2) }] };
  },
);
```

Copy this shape verbatim for every Phase 30 data tool (`dashboard_list_reports`, `dashboard_get_report`, `dashboard_query_issues`, `dashboard_list_brand_scores`, `dashboard_get_brand_score`). Dashboard repos already filter by `orgId` at the SQL layer (see `packages/dashboard/src/db/sqlite/repositories/scan-repository.ts` §152 `listScans(filters)` and §316 `getLatestPerSite(orgId)`) — reuse that surface unchanged.

**resolveOrgId helper — VERBATIM copy** (`packages/branding/src/mcp/server.ts` lines 43–46):

```typescript
function resolveOrgId(): string {
  const ctx = getCurrentToolContext();
  return ctx?.orgId ?? 'system';
}
```

**Classification comment discipline — ORG-SCOPED** (`packages/branding/src/mcp/server.ts` line 91):

```typescript
// orgId: ctx.orgId (org-scoped — <one-line rationale, e.g. "cross-org guard: guideline.orgId must match caller">)
```

**Classification comment discipline — GLOBAL** (`packages/llm/src/mcp/server.ts` line 93):

```typescript
// orgId: N/A (global — inputs supplied by caller; orgId used only for per-org prompt overrides)
```

For Phase 30, most/all tools are ORG-SCOPED. The only likely GLOBAL ones are admin tools that operate on system-wide resources (e.g. `dashboard_list_orgs` when called with `admin.system` — but even these still read `ctx.orgId` per CONTEXT D-07 so the repo layer can enforce the caller's scope). Treat every Phase 30 tool as ORG-SCOPED unless the dashboard repository truly ignores `orgId` (verified by reading the repo method).

**Destructive flag (D-03 for `dashboard_scan_site`):** MCP SDK 1.27.1's `registerTool` accepts `annotations?: ToolAnnotations` in the config (see `node_modules/@modelcontextprotocol/sdk/dist/cjs/server/mcp.d.ts` line 155). For destructive tools, add to the config object:

```typescript
server.registerTool(
  'dashboard_scan_site',
  {
    description: 'Trigger an accessibility scan for a URL. Runs async — returns {scanId, status: "queued", url} immediately. Poll dashboard_get_report with the scanId for progress. This will run a real scan against the URL and may take minutes.',
    inputSchema: z.object({
      url: z.string().describe('The URL to scan (http:// or https://)'),
      standard: z.enum(['WCAG2A', 'WCAG2AA', 'WCAG2AAA']).optional().describe('WCAG level; defaults to WCAG2AA'),
    }),
    annotations: { destructiveHint: true, readOnlyHint: false },
  },
  // orgId: ctx.orgId (org-scoped — scan is recorded against caller's org via ScanService.initiateScan)
  async (args) => { /* ... */ },
);
```

(The SDK's `ToolAnnotations` is the standard shape — `destructiveHint`, `readOnlyHint`, `openWorldHint`, `idempotentHint` — see `node_modules/@modelcontextprotocol/sdk/dist/cjs/types.d.ts`. ADDITIONALLY, the Phase 30 `ToolMetadata` in `@luqen/core/mcp/types.ts` already has a `destructive?: boolean` field used by `BRANDING_TOOL_METADATA` — reuse it for discoverability within Luqen.)

**Async dispatch pattern for `dashboard_scan_site` (D-02):** the ScanService entry point is `initiateScan` (confirmed at `packages/dashboard/src/services/scan-service.ts` line 176). It returns an `InitiateScanResult` (validation-or-success union). Handler:

```typescript
async (args) => {
  const _ctx = getCurrentToolContext();
  const orgId = resolveOrgId();
  const result = await scanService.initiateScan({ url: args.url, orgId, standard: args.standard ?? 'WCAG2AA' });
  if ('error' in result) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: result.error }) }], isError: true };
  }
  return {
    content: [{ type: 'text', text: JSON.stringify({ scanId: result.scanId, status: 'queued', url: args.url }, null, 2) }],
  };
}
```

**Error envelope with provider-error mapping (for tools calling service executors)** — see `packages/llm/src/mcp/server.ts` lines 56–60 + 112–117:

```typescript
function mapCapabilityError(err: unknown): string {
  if (err instanceof CapabilityNotConfiguredError) return err.message;
  if (err instanceof CapabilityExhaustedError) return err.message;
  return 'Upstream LLM error';
}
// in handler:
} catch (err) {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: mapCapabilityError(err) }) }],
    isError: true,
  };
}
```

Phase 30 dashboard tools mostly wrap thin SQL reads — not LLM calls — so the simpler branding error envelope (null-check → isError:true) is the usual pattern. Admin tools that invoke `service-connection-tester.ts` should use the `mapCapabilityError` shape because the tester does live OAuth probes.

**Service-connection redaction (D-06) — unique to Phase 30**, no in-repo analog. Recommended shape:

```typescript
function redactConnection(conn: ServiceConnection): RedactedConnection {
  return {
    id: conn.id,
    serviceType: conn.serviceType,
    baseUrl: conn.baseUrl,
    clientId: conn.clientId,
    hasSecret: conn.encryptedClientSecret != null && conn.encryptedClientSecret.length > 0,
    secretPreview: null,  // or 'xxxx...last4' if you store a preview column
    // NEVER include encryptedClientSecret or plaintext clientSecret
  };
}
```

And in error envelopes for `dashboard_test_service_connection`:

```typescript
catch (err) {
  // DO NOT echo the secret or stack trace.
  const safeMsg = err instanceof Error ? err.message.replace(/\b[A-Za-z0-9_-]{20,}\b/g, '[redacted]') : 'Connection test failed';
  return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: safeMsg }) }], isError: true };
}
```

**Return shape contract** (every Phase 30 factory must return this — mirrors `packages/branding/src/mcp/server.ts` line 187):

```typescript
return { server, toolNames: [...TOOL_NAMES], metadata: DASHBOARD_TOOL_METADATA };
```

---

### 2. `packages/dashboard/src/mcp/metadata.ts` (NEW)

**Analog:** `packages/branding/src/mcp/metadata.ts` (complete file reproduced verbatim — only table contents change).

```typescript
/**
 * DASHBOARD_TOOL_METADATA — per-tool RBAC annotations for the Phase 30
 * dashboard MCP tools. Consumed by the shared @luqen/core/mcp HTTP plugin
 * to filter tools/list by the caller's effective permissions (D-07).
 *
 * Permission strings match ALL_PERMISSION_IDS in packages/dashboard/src/permissions.ts.
 */

import type { ToolMetadata } from '@luqen/core/mcp';

export const DASHBOARD_TOOL_METADATA: readonly ToolMetadata[] = [
  // Data tools (D-01)
  { name: 'dashboard_scan_site',          requiredPermission: 'scans.create', destructive: true },
  { name: 'dashboard_list_reports',       requiredPermission: 'reports.view' },
  { name: 'dashboard_get_report',         requiredPermission: 'reports.view' },
  { name: 'dashboard_query_issues',       requiredPermission: 'reports.view' },
  { name: 'dashboard_list_brand_scores',  requiredPermission: 'branding.view' },
  { name: 'dashboard_get_brand_score',    requiredPermission: 'branding.view' },
  // Admin tools (D-05, D-07) — 13 entries, adjust as planner finalises names
  { name: 'dashboard_list_users',         requiredPermission: 'admin.users' },
  // ... see CONTEXT.md D-05 / D-07 for full table
];
```

Permission IDs are confirmed present in `packages/dashboard/src/permissions.ts` (`scans.create` line 9, `reports.view` line 11, `branding.view` line 36, `admin.users` line 27, `admin.org` line 31, `admin.system` line 32).

---

### 3. MCP **Resources** (D-09..D-12) — `server.registerResource(...)` — **NO in-repo analog**

Resources are **first-time** in this codebase. The SDK is the authoritative reference. Below are verbatim extracts from `node_modules/@modelcontextprotocol/sdk/dist/cjs/server/mcp.d.ts`.

**`registerResource` overloads** (mcp.d.ts lines 99–103):

```typescript
/**
 * Registers a resource with a config object and callback.
 * For static resources, use a URI string. For dynamic resources, use a ResourceTemplate.
 */
registerResource(name: string, uriOrTemplate: string,          config: ResourceMetadata, readCallback: ReadResourceCallback):         RegisteredResource;
registerResource(name: string, uriOrTemplate: ResourceTemplate, config: ResourceMetadata, readCallback: ReadResourceTemplateCallback): RegisteredResourceTemplate;
```

**Supporting types** (mcp.d.ts lines 294–324):

```typescript
/**  Additional, optional information for annotating a resource. */
export type ResourceMetadata = Omit<Resource, 'uri' | 'name'>;  // includes: title?, description?, mimeType?, annotations?

export type ReadResourceCallback = (
  uri: URL,
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
) => ReadResourceResult | Promise<ReadResourceResult>;

export type ReadResourceTemplateCallback = (
  uri: URL,
  variables: Variables,   // URI template variable map
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
) => ReadResourceResult | Promise<ReadResourceResult>;
```

**`ResourceTemplate` constructor** (mcp.d.ts lines 222–248):

```typescript
export declare class ResourceTemplate {
  constructor(
    uriTemplate: string | UriTemplate,
    _callbacks: {
      /** REQUIRED (even if undefined) — avoids accidentally forgetting resource listing. */
      list: ListResourcesCallback | undefined;
      complete?: { [variable: string]: CompleteResourceTemplateCallback };
    },
  );
}

export type ListResourcesCallback = (
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
) => ListResourcesResult | Promise<ListResourcesResult>;
```

**Read-result envelope (what `readCallback` returns)** — from the SDK's live `ReadResourceRequestSchema` handler (`node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js` lines 376–394). Per CONTEXT.md D-11 the shape is:

```typescript
{
  contents: [
    {
      uri: 'scan://report/abc-123',
      mimeType: 'application/json',
      text: JSON.stringify(reportRow, null, 2),
    },
  ],
}
```

**Default SDK List behaviour (from `setResourceRequestHandlers`, mcp.js lines 344–366):** merges static resources + template `listCallback()` results. Phase 30 uses **two URI templates** — `scan://report/{id}` and `brand://score/{siteUrl}` — so both are `ResourceTemplate` entries, not static URIs.

**Recommended registration pattern for Phase 30 (D-09, D-10, D-11):**

```typescript
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';

// scan://report/{id}
server.registerResource(
  'scan-report',
  new ResourceTemplate('scan://report/{id}', {
    list: async () => {
      const _ctx = getCurrentToolContext();
      const orgId = resolveOrgId();
      // D-10: last 50 completed scan reports for caller's org
      const scans = await storage.scans.listScans({ orgId, status: 'complete', limit: 50 });
      return {
        resources: scans.map((s) => ({
          uri: `scan://report/${s.id}`,
          name: `Scan report for ${s.url}`,
          mimeType: 'application/json',
        })),
      };
    },
  }),
  {
    title: 'Scan reports',
    description: 'Recent completed accessibility scan reports for the current org',
    mimeType: 'application/json',
  },
  // orgId: ctx.orgId (org-scoped — list + read guarded by caller's orgId)
  async (uri, variables) => {
    const _ctx = getCurrentToolContext();
    const orgId = resolveOrgId();
    const scanId = variables['id'] as string;
    const result = await scanService.getScanForOrg(scanId, orgId);  // from scan-service.ts §277
    if ('error' in result) throw new Error(`Resource ${uri} not found`);
    return {
      contents: [{ uri: uri.toString(), mimeType: 'application/json', text: JSON.stringify(result, null, 2) }],
    };
  },
);

// brand://score/{siteUrl}
server.registerResource(
  'brand-score',
  new ResourceTemplate('brand://score/{siteUrl}', {
    list: async () => {
      const _ctx = getCurrentToolContext();
      const orgId = resolveOrgId();
      const scores = await storage.brandScores.listForOrg(orgId);  // adjust to actual repo method
      return {
        resources: scores.map((s) => ({
          uri: `brand://score/${encodeURIComponent(s.siteUrl)}`,  // D-09 url-encoding
          name: `Brand score for ${s.siteUrl}`,
          mimeType: 'application/json',
        })),
      };
    },
  }),
  { title: 'Brand scores', description: 'Brand scores per assigned site for the current org', mimeType: 'application/json' },
  // orgId: ctx.orgId (org-scoped — brandScores.getLatestForScan / brand-score-repo already filters by orgId)
  async (uri, variables) => {
    const _ctx = getCurrentToolContext();
    const orgId = resolveOrgId();
    const siteUrl = decodeURIComponent(variables['siteUrl'] as string);
    const score = await storage.brandScores.getLatestForSite(siteUrl, orgId);
    if (score == null) throw new Error(`Resource ${uri} not found`);
    return {
      contents: [{ uri: uri.toString(), mimeType: 'application/json', text: JSON.stringify(score, null, 2) }],
    };
  },
);
```

**D-12 RBAC gating applies at both list AND read.** The SDK's default `list` callback returns everything; our org filter already limits rows, but a caller without `reports.view` must not see any `scan://` entries and must 403 on direct read. Since the SDK's built-in handler does not take a permission hook, this is handled in `@luqen/core/mcp/http-plugin.ts` — see section 5 below for the override.

---

### 4. MCP **Prompts** (D-13..D-15) — `server.registerPrompt(...)` — **NO in-repo analog**

Prompts are **first-time** in this codebase. Below are verbatim extracts from the SDK.

**`registerPrompt` signature** (mcp.d.ts lines 180–185):

```typescript
/** Registers a prompt with a config object and callback. */
registerPrompt<Args extends PromptArgsRawShape>(
  name: string,
  config: {
    title?: string;
    description?: string;
    argsSchema?: Args;       // a zod raw shape — NOT JSON Schema; SDK derives the MCP-wire `arguments[]` from it
  },
  cb: PromptCallback<Args>,
): RegisteredPrompt;
```

Where `PromptArgsRawShape = ZodRawShapeCompat` (mcp.d.ts line 343) — i.e. a plain object of zod schemas, same shape as `inputSchema` for tools. Each field's `.describe()` becomes the argument's `description`, and `.optional()` becomes `required: false` in the MCP wire format.

**Wire-format arguments shape** (from `ListPromptsResultSchema.prompts.arguments`, `types.d.ts` lines 1849–1853):

```typescript
arguments: z.array(
  z.object({
    name: z.string(),
    description: z.string().optional(),
    required: z.boolean().optional(),
  }),
).optional(),
```

This matches CONTEXT.md D-14's locked "placeholder arg schema per prompt — `{name, description, required}`, NOT JSON Schema". The SDK auto-converts a zod raw shape into this wire format via `promptArgumentsFromSchema` (mcp.js line 416).

**Get-prompt result envelope (`PromptCallback` return type) — what the handler must return:** `GetPromptResult` from `types.d.ts`. Shape (per CONTEXT.md D-15):

```typescript
{
  description?: string,
  messages: [
    { role: 'user' | 'assistant', content: { type: 'text', text: string } },
    // 'system' is rendered as role: 'user' with a prepended "system:" marker in MCP's chat model,
    // but the SDK also supports 'system' in its PromptMessage union — verify with SDK 1.27.1 once
    // planner opens the file. Per CONTEXT.md D-15 there's one "system" and one "user" message.
  ],
}
```

**Recommended registration pattern for Phase 30:**

```typescript
// /scan prompt
server.registerPrompt(
  'scan',  // exposed as '/scan' in the client UI
  {
    title: 'Scan a site',
    description: 'Scan a website for WCAG compliance and summarize the top issues.',
    argsSchema: {
      siteUrl: z.string().describe('The website URL to scan'),
      standard: z.string().optional().describe('WCAG level: WCAG2A, WCAG2AA, or WCAG2AAA — defaults to WCAG2AA'),
    },
  },
  // orgId: N/A (prompt templates are global — tool calls triggered by the prompt source orgId from JWT via ToolContext ALS)
  (args) => ({
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `System: You are a WCAG compliance assistant in the Luqen dashboard. Available tools include dashboard_scan_site, dashboard_get_report, dashboard_query_issues, llm_analyse_report, llm_generate_fix, and branding_match. Pick the appropriate tool when the user asks a question — no explicit sequencing required.\n\nUser: Scan ${args.siteUrl} for WCAG ${args.standard ?? 'WCAG2AA'} compliance and summarize the top 5 issues.`,
        },
      },
    ],
  }),
);

// /report prompt
server.registerPrompt(
  'report',
  {
    title: 'Summarize a scan report',
    description: 'Summarize a scan report with executive-level findings.',
    argsSchema: {
      scanId: z.string().describe('Scan ID returned from dashboard_scan_site or dashboard_list_reports'),
    },
  },
  // orgId: N/A
  (args) => ({ messages: [ /* one user msg referencing dashboard_get_report + llm_analyse_report */ ] }),
);

// /fix prompt
server.registerPrompt(
  'fix',
  {
    title: 'Generate a fix for an issue',
    description: 'Generate an AI fix suggestion for a specific WCAG issue.',
    argsSchema: {
      issueId: z.string().describe('The pa11y issue code, e.g. WCAG2AA.Principle1.Guideline1_1.1_1_1.H37'),
      scanId: z.string().optional().describe('Scan context for the issue'),
    },
  },
  // orgId: N/A
  (args) => ({ messages: [ /* one user msg referencing dashboard_query_issues + llm_generate_fix */ ] }),
);
```

**D-17 invariant — no `orgId` in `argsSchema`:** enforced by the same runtime iteration test as tools (see section 9). The SDK stores the zod raw shape on `_registeredPrompts[name].argsSchema`.

---

### 5. `packages/core/src/mcp/http-plugin.ts` — **ADD `ListResourcesRequestSchema` + `ReadResourceRequestSchema` filter overrides**

**Analog:** self — the existing `ListToolsRequestSchema` override is the exact template (lines 113–140).

**Existing tools filter to mirror** (`packages/core/src/mcp/http-plugin.ts` lines 113–140):

```typescript
mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => {
  const ctx = getCurrentToolContext();
  const allowedNames: readonly string[] = ctx == null
    ? []
    : ctx.permissions.size > 0
      ? filterToolsByPermissions(toolMetadata, ctx.permissions)
      : filterToolsByScope(toolMetadata, ctx.scopes);
  const allowedSet = new Set(allowedNames);

  const registered = serverAsAny._registeredTools ?? {};
  const tools = Object.entries(registered)
    .filter(([name, def]) => allowedSet.has(name) && def.enabled !== false)
    .map(([name, def]) => ({ name, description: def.description ?? '', inputSchema: def.inputSchema ?? { type: 'object' } }));
  return { tools };
});
```

**Proposed additions for Phase 30 (D-12):**

```typescript
import {
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

// ... inside createMcpHttpPlugin, after the existing tools filter:

// Resources list — filtered by resource-family permission (scan:// needs reports.view, brand:// needs branding.view).
// The SDK's default list merges static resources + template list callbacks; we call it first to
// get the full set, then apply the filter to preserve SDK list semantics.
// Plan author: decide whether to (a) invoke the SDK default and filter, or (b) re-implement a
// permission-aware list. Option (a) is simpler and keeps SDK behaviour authoritative.

mcpServer.server.setRequestHandler(ListResourcesRequestSchema, async (request, extra) => {
  const ctx = getCurrentToolContext();
  if (ctx == null) return { resources: [] };

  // Invoke SDK default list handler through a private-field access, mirroring the pattern we
  // already use for _registeredTools. Alternative: re-derive both static + template lists here.
  const serverAsAny2 = mcpServer as unknown as {
    _registeredResources?: Record<string, { enabled: boolean; metadata?: Record<string, unknown>; name: string }>;
    _registeredResourceTemplates?: Record<string, { resourceTemplate: { listCallback?: Function; uriTemplate: { toString(): string } }; metadata?: Record<string, unknown> }>;
  };
  const staticResources = Object.entries(serverAsAny2._registeredResources ?? {})
    .filter(([, r]) => r.enabled)
    .map(([uri, r]) => ({ uri, name: r.name, ...r.metadata }));
  const templateResources: Array<Record<string, unknown>> = [];
  for (const t of Object.values(serverAsAny2._registeredResourceTemplates ?? {})) {
    if (!t.resourceTemplate.listCallback) continue;
    const result = await (t.resourceTemplate.listCallback as Function)(extra);
    for (const r of (result as { resources: Array<Record<string, unknown>> }).resources) {
      templateResources.push({ ...t.metadata, ...r });
    }
  }
  const all = [...staticResources, ...templateResources];
  const filtered = all.filter((r) => {
    const uri = String(r['uri'] ?? '');
    if (uri.startsWith('scan://')) return ctxHasPerm(ctx, 'reports.view');
    if (uri.startsWith('brand://')) return ctxHasPerm(ctx, 'branding.view');
    return true;  // unknown scheme — let through
  });
  return { resources: filtered };
});

mcpServer.server.setRequestHandler(ReadResourceRequestSchema, async (request, extra) => {
  const ctx = getCurrentToolContext();
  if (ctx == null) throw new McpError(ErrorCode.InvalidParams, 'Not authenticated');
  const uri = String(request.params.uri);
  if (uri.startsWith('scan://') && !ctxHasPerm(ctx, 'reports.view')) {
    throw new McpError(ErrorCode.InvalidParams, 'Forbidden');
  }
  if (uri.startsWith('brand://') && !ctxHasPerm(ctx, 'branding.view')) {
    throw new McpError(ErrorCode.InvalidParams, 'Forbidden');
  }
  // Delegate to the SDK's default read dispatch — it uses the registered templates + readCallback chain.
  // Invoke directly by looking up on the private map — mirrors SDK mcp.js lines 376–394:
  const serverAsAny3 = mcpServer as unknown as {
    _registeredResources?: Record<string, { enabled: boolean; readCallback: Function }>;
    _registeredResourceTemplates?: Record<string, { resourceTemplate: { uriTemplate: { match(uri: string): Record<string, string> | null } }; readCallback: Function }>;
  };
  const parsed = new URL(uri);
  const exact = serverAsAny3._registeredResources?.[parsed.toString()];
  if (exact?.enabled) return await exact.readCallback(parsed, extra);
  for (const t of Object.values(serverAsAny3._registeredResourceTemplates ?? {})) {
    const vars = t.resourceTemplate.uriTemplate.match(parsed.toString());
    if (vars) return await t.readCallback(parsed, vars, extra);
  }
  throw new McpError(ErrorCode.InvalidParams, `Resource ${uri} not found`);
});

function ctxHasPerm(ctx: ToolContext, perm: string): boolean {
  if (ctx.permissions.has(perm)) return true;
  // Scope fallback for service-to-service callers — mirrors filterToolsByScope rules.
  if (ctx.scopes.includes('admin')) return true;
  return false;
}
```

**Alternative simpler approach — metadata-driven filter:** if each registered resource carries a permission tag (parallel to `ToolMetadata`), the filter reduces to set-inclusion. Recommended if planner wants to reuse `filterToolsByPermissions`. Add to `packages/core/src/mcp/types.ts`:

```typescript
export interface ResourceMetadata {
  readonly uriScheme: string;  // 'scan' or 'brand'
  readonly requiredPermission?: string;
}
```

Then extend `tool-filter.ts`:

```typescript
export function filterResourcesByPermissions(
  allResources: readonly ResourceMetadata[],
  effectivePerms: ReadonlySet<string>,
): readonly string[] {
  return allResources
    .filter((r) => r.requiredPermission == null || effectivePerms.has(r.requiredPermission))
    .map((r) => r.uriScheme);
}

export function filterResourcesByScope(
  allResources: readonly ResourceMetadata[],
  tokenScopes: readonly string[],
): readonly string[] {
  const hasAdmin = tokenScopes.includes('admin');
  const hasRead = hasAdmin || tokenScopes.includes('read') || tokenScopes.includes('write');
  return allResources
    .filter((r) => r.requiredPermission == null || hasAdmin || hasRead)
    .map((r) => r.uriScheme);
}
```

Existing filter functions to mirror (`packages/core/src/mcp/tool-filter.ts` lines 23–58):

```typescript
export function filterToolsByPermissions(
  allTools: readonly ToolMetadata[],
  effectivePerms: ReadonlySet<string>,
): readonly string[] {
  return allTools
    .filter((t) => t.requiredPermission == null || effectivePerms.has(t.requiredPermission))
    .map((t) => t.name);
}

export function filterToolsByScope(
  allTools: readonly ToolMetadata[],
  tokenScopes: readonly string[],
): readonly string[] {
  const hasAdmin = tokenScopes.includes('admin');
  const hasWrite = tokenScopes.includes('write') || hasAdmin;
  const hasRead = tokenScopes.includes('read') || hasWrite;
  return allTools
    .filter((t) => { /* see file */ })
    .map((t) => t.name);
}
```

---

### 6. `packages/dashboard/src/routes/api/mcp.ts` — **thread `storage` through to the factory**

**Analog:** self — Phase 28 baseline (already present).

**Existing shape** (`packages/dashboard/src/routes/api/mcp.ts` lines 33–47):

```typescript
export async function registerMcpRoutes(
  app: FastifyInstance,
  opts: McpRouteOptions,
): Promise<void> {
  const { server: mcpServer } = await createDashboardMcpServer();
  const plugin = await createMcpHttpPlugin({
    mcpServer,
    toolMetadata: DASHBOARD_TOOL_METADATA,
    requiredScope: 'read',
  });
  await app.register(async (scoped) => {
    scoped.addHook('preHandler', createMcpAuthPreHandler(opts));
    await plugin(scoped, {});
  });
}
```

**Phase 30 modification — pass `storage` + `scanService` into `createDashboardMcpServer`:**

```typescript
export interface McpRouteOptions {
  readonly verifyToken: McpTokenVerifier;
  readonly storage: Storage;  // repositories for scans, reports, brand-scores, users, orgs, service-connections
  readonly scanService: ScanService;
}

export async function registerMcpRoutes(
  app: FastifyInstance,
  opts: McpRouteOptions,
): Promise<void> {
  const { server: mcpServer } = await createDashboardMcpServer({ storage: opts.storage, scanService: opts.scanService });
  // ... rest unchanged
}
```

And the single call-site in `packages/dashboard/src/server.ts` adds `scanService` alongside `storage` (they're already both in scope — see `packages/dashboard/src/server.ts` lines 640–647 for existing storage usage). Mirror the Phase 29 branding/LLM pattern (`packages/branding/src/api/server.ts` line 550: `await registerMcpRoutes(app, { db });`).

---

### 7. `packages/dashboard/tests/mcp/http.test.ts` — **extend Phase 28 baseline**

**Analog 1 — existing file** (Phase 28 baseline): `packages/dashboard/tests/mcp/http.test.ts` lines 1–284. KEEP all 8 existing tests (Cases 1–6 + two startup-fail cases).

**Analog 2 — Phase 29 branding test extensions** (`packages/branding/tests/mcp/http.test.ts` via 29-01-PLAN Task 2): adds `tools/list` content assertion + D-13 runtime iteration + classification coverage + admin-scope fallback.

**Analog 3 — Phase 28 compliance runtime iteration test** (`packages/compliance/tests/mcp/http.test.ts` lines 140–194) — the authoritative D-17 iteration pattern:

```typescript
it('MCPI-04 runtime guard — NO compliance tool inputSchema contains orgId', async () => {
  const freshDb = new SqliteAdapter(':memory:');
  const { server, metadata, toolNames } = await createComplianceMcpServer({ db: freshDb });

  expect(toolNames.length).toBe(11);
  expect(metadata.length).toBe(11);

  const registered = (server as unknown as {
    _registeredTools?: Record<string, { inputSchema?: unknown }>;
  })._registeredTools ?? {};
  const entries = Object.entries(registered);
  expect(entries.length).toBe(11);

  for (const [name, tool] of entries) {
    const schema = tool.inputSchema as Record<string, unknown> | undefined;
    let shapeRecord: Record<string, unknown> = {};
    if (schema != null && typeof schema === 'object') {
      const def = (schema as { _def?: { shape?: unknown } })._def;
      if (def != null && typeof def === 'object' && 'shape' in def) {
        const shape = (def as { shape?: unknown }).shape;
        if (typeof shape === 'function') shapeRecord = (shape as () => Record<string, unknown>)() ?? {};
        else if (shape != null && typeof shape === 'object') shapeRecord = shape as Record<string, unknown>;
      }
      if (Object.keys(shapeRecord).length === 0) {
        const s = (schema as { shape?: unknown }).shape;
        if (s != null && typeof s === 'object') shapeRecord = s as Record<string, unknown>;
      }
      if (Object.keys(shapeRecord).length === 0) shapeRecord = schema as Record<string, unknown>;
    }
    expect(shapeRecord, `tool ${name} must not accept orgId (D-17)`).not.toHaveProperty('orgId');
    let serialised = '';
    try { serialised = JSON.stringify(schema, (_k, v) => (typeof v === 'function' ? '[fn]' : v)); }
    catch { serialised = String(schema); }
    expect(serialised.includes('"orgId"'), `tool ${name} schema must not contain "orgId"`).toBe(false);
  }

  await freshDb.close();
});
```

**Phase 30 extensions (mirror + add Resources + Prompts iteration):**

```typescript
// tools/list assertion — 6 data + 13 admin (adjust to the real admin count).
it('tools/list returns all data + admin tools filtered by permissions', async () => {
  app = await buildApp({
    verifyToken: makeFakeVerifier({ sub: 'u', scopes: ['read'], orgId: 'org-1', role: 'admin' }),
    storage: makeStubStorage(['admin']),  // admin → all permissions
    scanService: /* stub */,
  });
  // POST tools/list, assert names include dashboard_scan_site, dashboard_list_reports, ...,
  // dashboard_list_users, dashboard_list_orgs, dashboard_list_service_connections.
  expect(names).toContain('dashboard_scan_site');
  expect(names).toContain('dashboard_list_reports');
  // ...
  expect(names.length).toBe(19);  // 6 data + 13 admin — final count per D-05 planner refinement
});

// resources/list assertion — two schemes visible to admin, filtered for limited caller.
it('resources/list returns scan:// + brand:// for admin; filters by perms for others', async () => {
  // With admin perms: both schemes present, up to 50 scan URIs + all brand URIs (D-10).
  // With only reports.view: only scan:// URIs present.
  // With no perms: empty list.
});

// prompts/list assertion — exactly /scan, /report, /fix.
it('prompts/list returns exactly /scan, /report, /fix', async () => {
  const names = (result.prompts ?? []).map((p: { name: string }) => p.name);
  expect(names).toEqual(['scan', 'report', 'fix']);  // or ['/scan','/report','/fix'] depending on final naming
  expect(names.length).toBe(3);
});

// D-17 runtime iteration — no orgId in any tool inputSchema / prompt argsSchema / resource read vars.
it('D-17 runtime guard — NO orgId in any tool inputSchema, prompt argsSchema, or resource URI variables', async () => {
  const { server, toolNames, metadata } = await createDashboardMcpServer({ storage: stubStorage, scanService: stubScanService });

  expect(toolNames.length).toBe(19);  // adjust
  expect(metadata.length).toBe(19);

  // Tools — copy compliance iteration block verbatim, replace expected count.
  const tools = (server as unknown as { _registeredTools?: Record<string, { inputSchema?: unknown }> })._registeredTools ?? {};
  for (const [name, tool] of Object.entries(tools)) { /* ... same shape extraction ... */ }

  // Prompts — argsSchema is a zod raw shape object (keys are arg names). Assert no 'orgId' key.
  const prompts = (server as unknown as { _registeredPrompts?: Record<string, { argsSchema?: Record<string, unknown> }> })._registeredPrompts ?? {};
  expect(Object.keys(prompts).length).toBe(3);
  for (const [name, p] of Object.entries(prompts)) {
    const shape = p.argsSchema ?? {};
    expect(shape, `prompt ${name} must not accept orgId`).not.toHaveProperty('orgId');
    expect(JSON.stringify(shape).includes('"orgId"')).toBe(false);
  }

  // Resources — templates expose a `uriTemplate`; assert no '{orgId}' variable.
  const resourceTemplates = (server as unknown as { _registeredResourceTemplates?: Record<string, { resourceTemplate: { uriTemplate: { toString(): string } } }> })._registeredResourceTemplates ?? {};
  for (const [name, rt] of Object.entries(resourceTemplates)) {
    const tpl = rt.resourceTemplate.uriTemplate.toString();
    expect(tpl.includes('{orgId}'), `resource template ${name} must not expose orgId variable`).toBe(false);
  }
});

// Classification coverage — every tool handler carries an explicit comment.
it('Classification coverage — every Phase 30 handler carries explicit orgId comment, NO TODO(phase-31/32) deferrals', async () => {
  const source = await readFile(resolve(__dirname, '../../src/mcp/server.ts'), 'utf-8');
  expect(source).not.toMatch(/TODO\(phase-3[12]\)/);
  const orgScoped = (source.match(/\/\/ orgId: ctx\.orgId /g) ?? []).length;
  const global = (source.match(/\/\/ orgId: N\/A /g) ?? []).length;
  expect(orgScoped + global).toBe(19 + 3);  // 19 tools + 3 prompts (prompts are global)
  expect(source).not.toMatch(/orgId\s*:\s*z\./);
  expect(source).not.toMatch(/console\.log/);
});
```

---

### 8. `packages/dashboard/tests/mcp/inspector-smoke.test.ts` (NEW) — **no direct analog**

No existing test in the repo spawns the MCP Inspector CLI. Pattern suggestion using `child_process.spawn`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import Fastify, { type FastifyInstance } from 'fastify';
// ... bootstrap the dashboard Fastify app with a stub verifier, as in http.test.ts

describe('MCP Inspector smoke (D-16 part 1)', () => {
  let app: FastifyInstance;
  let token: string;
  let baseUrl: string;

  beforeAll(async () => {
    // Build dashboard app; start on ephemeral port.
    app = await buildApp({ /* ... */ });
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    baseUrl = address;  // e.g. 'http://127.0.0.1:34567'
    token = /* sign a real RS256 test JWT — use the test keypair pattern from verifier.test.ts */;
  });

  afterAll(async () => { if (app) await app.close(); });

  it('inspector CLI lists 19 tools, 2 resources, 3 prompts', async () => {
    const inspector: ChildProcess = spawn('npx', [
      '-y', '@modelcontextprotocol/inspector',
      '--cli',
      '--url', `${baseUrl}/api/v1/mcp`,
      '--header', `Authorization: Bearer ${token}`,
      '--command', 'tools/list',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = await collectStdout(inspector);
    expect(out).toMatch(/dashboard_scan_site/);
    expect(out).toMatch(/dashboard_list_reports/);
    // ... assert names + counts
  }, 30_000);  // inspector cold-start can take 10s
});
```

**Caveats:** inspector CLI flags (`--cli`, `--command`) — planner must verify against the installed inspector version, since its CLI UX has shifted. The package is `@modelcontextprotocol/inspector` on npm. If the CLI doesn't expose a non-interactive flag in the installed version, fall back to direct HTTP JSON-RPC POSTs (mirrors the existing `http.test.ts` approach) and rename the test to `external-client-smoke.test.ts`.

---

### 9. `docs/mcp-client-setup.md` (NEW) — **role-match analog in `docs/reference/mcp-tools.md`**

The existing reference (`docs/reference/mcp-tools.md` lines 1–70) already documents stdio-based MCP setup for 3 services. Phase 30 adds a NEW file focused on **HTTP-based external clients** (Claude Desktop, IDE extensions, MCP Inspector).

**Analog — structure + section flow to mirror** (`docs/reference/mcp-tools.md` lines 1–50):

```markdown
# MCP Tools Reference
...
## Server Connection Config
### Core (luqen)
Start the server:
```bash
npx @luqen/core mcp
```
Claude Desktop / VS Code config:
```json
{ "mcpServers": { "luqen": { "command": "npx", "args": ["@luqen/core", "mcp"] } } }
```
```

**Phase 30 additions to mirror that shape — HTTP Bearer flow:**

```markdown
# External MCP Client Setup

## Acquiring a Bearer Token

`curl -s -X POST http://lxc-luqen:3000/api/v1/oauth/token -d 'grant_type=client_credentials&client_id=...&client_secret=...'`

## Claude Desktop (HTTP with Bearer)

```json
{
  "mcpServers": {
    "luqen-dashboard": {
      "url": "http://lxc-luqen:3000/api/v1/mcp",
      "transport": "http",
      "headers": {
        "Authorization": "Bearer <token>"
      }
    }
  }
}
```

## MCP Inspector

`npx @modelcontextprotocol/inspector --url http://lxc-luqen:3000/api/v1/mcp --header "Authorization: Bearer <token>"`

## Troubleshooting

- 401 Bearer token required → missing Authorization header
- 401 Invalid or expired token → wrong signing key (see DASHBOARD_JWT_PUBLIC_KEY)
- 403 Insufficient scope → token scope lacks `read`
- Empty tools list → caller lacks `reports.view` / `branding.view` / `admin.*` perms
```

---

## Shared Patterns (apply across multiple Phase 30 files)

### Authentication + RBAC (Phase 28 deliverable — reuse unchanged)
**Source:** `packages/dashboard/src/mcp/middleware.ts` (Phase 28), `packages/core/src/mcp/http-plugin.ts` lines 143–185, `packages/dashboard/src/routes/api/mcp.ts` lines 33–47
**Apply to:** All dashboard MCP additions in Phase 30

Phase 30 does NOT modify the auth layer. Every handler reads orgId via `getCurrentToolContext()`; the Bearer-only preHandler and RS256 verifier installed in Phase 28 (28-03 plan) are unchanged.

### Classification comment (ORG-SCOPED vs GLOBAL)
**Source:** `packages/branding/src/mcp/server.ts` line 91 (ORG-SCOPED), `packages/llm/src/mcp/server.ts` line 93 (GLOBAL)
**Apply to:** Every tool handler AND every prompt handler in Phase 30

- ORG-SCOPED: `// orgId: ctx.orgId (org-scoped — <rationale>)`
- GLOBAL:     `// orgId: N/A (global — inputs supplied by caller; orgId used only for per-org prompt overrides)`

All 19 Phase 30 tools are expected ORG-SCOPED. All 3 prompts are GLOBAL (template handlers don't touch DBs). Resources are ORG-SCOPED via the list callback.

### D-17 invariant — no `orgId` in any schema
**Source:** `packages/compliance/tests/mcp/http.test.ts` lines 140–194 (runtime iteration); `packages/branding/src/mcp/server.ts` line 43 (resolveOrgId helper)
**Apply to:** Every tool, every prompt, every resource template — enforced by runtime iteration test

### Tool response envelope
**Source:** `packages/branding/src/mcp/server.ts` lines 77, 97–102, 127; `packages/llm/src/mcp/server.ts` lines 111–117
**Apply to:** Every tool handler

```typescript
return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
// On error:
return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true };
```

### Resource read envelope (D-11)
**Source:** MCP SDK `ReadResourceRequestSchema` handler (`node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js` lines 376–394 — return shape is whatever readCallback returns; by convention `{ contents: [...] }`)
**Apply to:** Both `scan://report/{id}` and `brand://score/{siteUrl}` read callbacks

```typescript
return { contents: [{ uri: uri.toString(), mimeType: 'application/json', text: JSON.stringify(entity, null, 2) }] };
```

### Prompt messages envelope (D-15)
**Source:** MCP SDK `GetPromptRequestSchema` handler (mcp.js lines 420–444) — return shape is `GetPromptResult`
**Apply to:** All 3 prompts

```typescript
return {
  messages: [
    { role: 'user', content: { type: 'text', text: 'System: <tool-aware system text>\n\nUser: <task>' } },
  ],
};
```

### stdio safety + no `console.log`
**Source:** `.planning/research/PITFALLS.md` #11, `packages/branding/src/mcp/server.ts` (clean), verification step in 29-01-PLAN
**Apply to:** All Phase 30 MCP source files

`grep -n "console\\.log" packages/dashboard/src/mcp/` MUST return no matches. HTTP transport does not prevent the file being used via stdio by CLI.

---

## No Analog Found

| File / Feature | Role | Why no analog | Primary reference |
|----------------|------|---------------|-------------------|
| MCP Resources (D-09..D-12) — `server.registerResource(new ResourceTemplate(...))` | URI-addressable read-only data | First time in codebase. Phase 28 + Phase 29 used only `registerTool`. | `node_modules/@modelcontextprotocol/sdk/dist/cjs/server/mcp.d.ts` lines 99–103, 222–248, 294–324; `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js` lines 332–396 |
| MCP Prompts (D-13..D-15) — `server.registerPrompt(...)` with `argsSchema` | Chat-message templates | First time in codebase. | `node_modules/@modelcontextprotocol/sdk/dist/cjs/server/mcp.d.ts` lines 180–185, 343–349; `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js` lines 397–446 |
| `ListResourcesRequestSchema` + `ReadResourceRequestSchema` override in `http-plugin.ts` (D-12 RBAC gate) | request-handler override | Phase 28 only installed `ListToolsRequestSchema` override. | Mirror existing tools override at `packages/core/src/mcp/http-plugin.ts` lines 113–140; SDK schemas at `node_modules/@modelcontextprotocol/sdk/dist/cjs/types.d.ts` lines 1440, 1601 |
| `inspector-smoke.test.ts` — spawn `@modelcontextprotocol/inspector` via `child_process` | CLI-driven integration test | No existing test in the repo spawns inspector. | npm package `@modelcontextprotocol/inspector` — planner must verify installed CLI flags |
| Service-connection secret redaction (D-06) | business-logic filter | Admin-tool shape is unique to Phase 30. | Mirror redaction pattern used elsewhere — review `packages/dashboard/src/services/service-connection-tester.ts` (referenced in CONTEXT §156) for the existing test-button posture |

---

## SDK Reference Summary (Resources + Prompts — verbatim locations)

For planner verbatim citation:

- **`registerResource` overloads:** `node_modules/@modelcontextprotocol/sdk/dist/cjs/server/mcp.d.ts` lines 99–103
- **`ResourceTemplate` constructor + `list` callback requirement:** mcp.d.ts lines 222–248 (NOTE: `list` is REQUIRED per the docstring even if `undefined`)
- **`ReadResourceCallback` / `ReadResourceTemplateCallback` signatures:** mcp.d.ts lines 302, 324
- **`ResourceMetadata` = `Omit<Resource, 'uri' | 'name'>`** (title, description, mimeType, annotations): mcp.d.ts line 294
- **`registerPrompt` signature with `argsSchema: ZodRawShapeCompat`:** mcp.d.ts lines 180–185
- **`PromptArgsRawShape = ZodRawShapeCompat` + argument wire shape `{name, description, required}`:** mcp.d.ts line 343; `types.d.ts` lines 1849–1853
- **SDK default `setResourceRequestHandlers` (list + templates + read dispatch):** `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js` lines 332–396
- **SDK default `setPromptRequestHandlers` (list + get with zod arg validation):** mcp.js lines 397–446
- **Request-schema exports to import in `http-plugin.ts`:** `@modelcontextprotocol/sdk/types.js` re-exports `ListResourcesRequestSchema` (types.d.ts line 1440), `ReadResourceRequestSchema` (line 1601), `ListPromptsRequestSchema` (line 1812), `GetPromptRequestSchema` (line 1890)

---

## Metadata

**Analog search scope:**
- `packages/dashboard/src/mcp/**` (Phase 28 baseline)
- `packages/dashboard/src/routes/api/mcp.ts`
- `packages/dashboard/tests/mcp/**`
- `packages/dashboard/src/db/sqlite/repositories/**`
- `packages/dashboard/src/services/scan-service.ts`
- `packages/dashboard/src/services/service-connection-tester.ts`
- `packages/dashboard/src/permissions.ts`
- `packages/branding/src/mcp/**` (Phase 29 analog for ORG-SCOPED tools + metadata)
- `packages/llm/src/mcp/**` (Phase 29 analog for error envelope mapping)
- `packages/compliance/src/mcp/**` (Phase 28 baseline for iteration test + classification)
- `packages/compliance/tests/mcp/http.test.ts` (iteration test template)
- `packages/core/src/mcp/**` (http-plugin, tool-filter, types)
- `node_modules/@modelcontextprotocol/sdk/dist/{cjs,esm}/server/mcp.{d.ts,js}` (canonical Resources + Prompts API)
- `node_modules/@modelcontextprotocol/sdk/dist/cjs/types.d.ts` (request-schema exports)
- `docs/reference/mcp-tools.md` (existing MCP docs — role-match for the new external-client setup doc)

**Files scanned:** 22

**Pattern extraction date:** 2026-04-17
