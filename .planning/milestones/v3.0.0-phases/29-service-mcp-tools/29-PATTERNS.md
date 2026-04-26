# Phase 29: Service MCP Tools - Pattern Map

**Mapped:** 2026-04-17
**Files analyzed:** 6 modified (2 servers, 2 tests, 2 docs)
**Analogs found:** 6 / 6 (100% — all analogs are already-landed Phase 28 artefacts)

---

## File Classification

| Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------|------|-----------|----------------|---------------|
| `packages/branding/src/mcp/server.ts` | service/tool-registry | event-driven (MCP tool dispatch → store reads) | `packages/compliance/src/mcp/server.ts` | exact |
| `packages/branding/tests/mcp/http.test.ts` | test (integration) | request-response over MCP JSON-RPC | `packages/compliance/tests/mcp/http.test.ts` | exact |
| `packages/llm/src/mcp/server.ts` | service/tool-registry | event-driven (MCP tool dispatch → capability executor calls) | `packages/compliance/src/mcp/server.ts` | exact |
| `packages/llm/tests/mcp/http.test.ts` | test (integration) | request-response over MCP JSON-RPC | `packages/compliance/tests/mcp/http.test.ts` | exact |
| `.planning/REQUIREMENTS.md` | docs (traceability) | n/a | `.planning/REQUIREMENTS.md` itself (self — existing table) | exact |
| `.planning/ROADMAP.md` | docs (phase plan) | n/a | `.planning/ROADMAP.md` itself (self) | exact |

**Scope note:** `packages/branding/src/api/routes/mcp.ts` and `packages/llm/src/api/routes/mcp.ts` are already wired correctly by Phase 28 (plugin registration picks up new tools automatically). No modification needed in Phase 29.

---

## Pattern Assignments

### `packages/branding/src/mcp/server.ts` (service/tool-registry, event-driven)

**Analog:** `packages/compliance/src/mcp/server.ts` (exact template — mirror line-for-line).

**Current state** (`packages/branding/src/mcp/server.ts` lines 12–34):
```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolMetadata } from '@luqen/core/mcp';
import { VERSION } from '../version.js';

export const BRANDING_TOOL_METADATA: readonly ToolMetadata[] = [];

export async function createBrandingMcpServer(
  _options: Record<string, never> = {},
): Promise<{
  server: McpServer;
  toolNames: readonly string[];
  metadata: readonly ToolMetadata[];
}> {
  const server = new McpServer(
    { name: 'luqen-branding', version: VERSION },
    { capabilities: { tools: {} } },
  );
  return { server, toolNames: [], metadata: BRANDING_TOOL_METADATA };
}
```

**Target pattern (mirror from compliance lines 1–92 + 94–131):**

**Imports block to copy/adapt** (compliance server.ts lines 1–9):
```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getCurrentToolContext } from '@luqen/core/mcp';
// service-specific imports replace compliance imports:
import { GuidelineStore } from '../store.js';
import { BrandingMatcher } from '../matcher/index.js';
import type { IBrandingStore, MatchableIssue } from '../types.js';
import { BRANDING_TOOL_METADATA } from './metadata.js';
export { BRANDING_TOOL_METADATA } from './metadata.js';
```

**Options + factory signature** (compliance lines 63–92) — adapt to accept an `IBrandingStore`:
```typescript
export interface BrandingMcpServerOptions {
  readonly store?: IBrandingStore;
}

export async function createBrandingMcpServer(
  options: BrandingMcpServerOptions = {},
): Promise<{
  server: McpServer;
  toolNames: readonly string[];
  metadata: typeof BRANDING_TOOL_METADATA;
}> {
  const store = options.store ?? new GuidelineStore();

  const server = new McpServer(
    { name: 'luqen-branding', version: VERSION },
    { capabilities: { tools: {} } },
  );
  // ... registerTool blocks for the 4 tools ...
  return { server, toolNames: [...TOOL_NAMES], metadata: BRANDING_TOOL_METADATA };
}
```

**orgId resolution helper** (compliance lines 58–61) — **COPY VERBATIM**:
```typescript
function resolveOrgId(): string {
  const ctx = getCurrentToolContext();
  return ctx?.orgId ?? 'system';
}
```

**Core tool registration pattern** (compliance lines 133–150 — `compliance_list_jurisdictions` is the cleanest template for the 3 list-style branding tools):
```typescript
// ---- compliance_list_jurisdictions ----
server.registerTool(
  'compliance_list_jurisdictions',
  {
    description: 'List all jurisdictions with optional filters',
    inputSchema: z.object({
      type: z.enum(['supranational', 'country', 'state']).optional(),
      parentId: z.string().optional(),
    }),
  },
  // orgId: ctx.orgId (org-scoped — returns system + caller-org jurisdictions)
  async (args) => {
    const _ctx = getCurrentToolContext();
    const orgId = resolveOrgId();
    const items = await db.listJurisdictions({ ...args, orgId });
    return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
  },
);
```

**Classification comment (MANDATORY for every handler — D-13 invariant):**
- All 4 branding tools are ORG-SCOPED → every handler MUST carry the comment `// orgId: ctx.orgId (org-scoped — ...)` immediately above `async (args) => {`.
- NO `TODO(phase-30)` markers. No deferrals.

**Specific tool implementations — adapters over `GuidelineStore` methods:**

1. `branding_list_guidelines` (wraps `GET /api/v1/guidelines` → `store.listGuidelines(orgId)`):
```typescript
server.registerTool(
  'branding_list_guidelines',
  {
    description: 'List all brand guidelines for the current org. Use when the user asks about brand setup or before calling branding_match.',
    inputSchema: z.object({}),
  },
  // orgId: ctx.orgId (org-scoped — returns caller-org guidelines)
  async () => {
    const _ctx = getCurrentToolContext();
    const orgId = resolveOrgId();
    const items = store.listGuidelines(orgId);
    return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
  },
);
```

2. `branding_get_guideline` (wraps `GET /api/v1/guidelines/:id` → `store.getGuideline(id)` + cross-org guard pattern from compliance `compliance_get_regulation` lines 192–223):
```typescript
server.registerTool(
  'branding_get_guideline',
  {
    description: 'Get a single brand guideline by ID, including its colors, fonts, and selectors.',
    inputSchema: z.object({
      id: z.string().describe('Guideline ID'),
    }),
  },
  // orgId: ctx.orgId (org-scoped — guard ensures guideline.orgId matches caller)
  async (args) => {
    const _ctx = getCurrentToolContext();
    const orgId = resolveOrgId();
    const guideline = store.getGuideline(args.id);
    if (guideline == null) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `Guideline "${args.id}" not found` }) }],
        isError: true,
      };
    }
    // Cross-org leakage guard (MCPI-04): guideline.orgId must match caller.
    if (guideline.orgId !== orgId) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `Guideline "${args.id}" not found` }) }],
        isError: true,
      };
    }
    return { content: [{ type: 'text', text: JSON.stringify(guideline, null, 2) }] };
  },
);
```

3. `branding_list_sites` (wraps `GET /api/v1/guidelines/:id/sites` → `store.getSiteAssignments(id)` with the same cross-org guard):
```typescript
server.registerTool(
  'branding_list_sites',
  {
    description: 'List site URLs assigned to a brand guideline.',
    inputSchema: z.object({
      id: z.string().describe('Guideline ID'),
    }),
  },
  // orgId: ctx.orgId (org-scoped — guards guideline.orgId before listing sites)
  async (args) => {
    const _ctx = getCurrentToolContext();
    const orgId = resolveOrgId();
    const guideline = store.getGuideline(args.id);
    if (guideline == null || guideline.orgId !== orgId) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `Guideline "${args.id}" not found` }) }],
        isError: true,
      };
    }
    const sites = store.getSiteAssignments(args.id);
    return { content: [{ type: 'text', text: JSON.stringify(sites, null, 2) }] };
  },
);
```

4. `branding_match` (wraps `POST /api/v1/match` — matcher logic lives in `BrandingMatcher` + `store.getGuideline` / `store.getGuidelineForSite`; mirror api/server.ts lines 506–548 directly, reading orgId from ctx not body):
```typescript
server.registerTool(
  'branding_match',
  {
    description: 'Match pa11y issues against a brand guideline. Returns per-issue brand correlations. This does not persist anything — run dashboard_scan_site (Phase 30) to persist.',
    inputSchema: z.object({
      issues: z.array(
        z.object({
          code: z.string(),
          type: z.enum(['error', 'warning', 'notice']),
          message: z.string(),
          selector: z.string(),
          context: z.string(),
        }),
      ).describe('Pa11y issues to match against the guideline'),
      siteUrl: z.string().optional().describe('Resolve guideline via site assignment if guidelineId not provided'),
      guidelineId: z.string().optional().describe('Explicit guideline ID (wins over siteUrl)'),
    }),
  },
  // orgId: ctx.orgId (org-scoped — guideline resolution filters by caller org; D-07: orgId NEVER from args)
  async (args) => {
    const _ctx = getCurrentToolContext();
    const orgId = resolveOrgId();

    let guideline = args.guidelineId != null ? store.getGuideline(args.guidelineId) : null;
    // Cross-org leakage guard: if explicit guidelineId resolves to a different org, treat as not found
    if (guideline != null && guideline.orgId !== orgId) {
      guideline = null;
    }
    if (guideline == null && args.siteUrl != null) {
      guideline = store.getGuidelineForSite(args.siteUrl, orgId);
    }

    if (guideline == null || !guideline.active) {
      const payload = {
        data: args.issues.map((issue: MatchableIssue) => ({ issue, brandMatch: { matched: false } })),
        meta: { matched: 0, total: args.issues.length, guidelineId: null },
      };
      return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
    }

    const matcher = new BrandingMatcher();
    const branded = matcher.match(args.issues, guideline);
    const payload = {
      data: branded,
      meta: {
        matched: branded.filter((b) => b.brandMatch.matched).length,
        total: args.issues.length,
        guidelineId: guideline.id,
        guidelineName: guideline.name,
      },
    };
    return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
  },
);
```

**Metadata file to create** (`packages/branding/src/mcp/metadata.ts` — mirror `packages/compliance/src/mcp/metadata.ts` lines 13–27 exactly in shape):
```typescript
import type { ToolMetadata } from '@luqen/core/mcp';

export const BRANDING_TOOL_METADATA: readonly ToolMetadata[] = [
  { name: 'branding_list_guidelines', requiredPermission: 'branding.view' },
  { name: 'branding_get_guideline',   requiredPermission: 'branding.view' },
  { name: 'branding_list_sites',      requiredPermission: 'branding.view' },
  { name: 'branding_match',           requiredPermission: 'branding.view' },
];
```

**TOOL_NAMES constant** (compliance lines 16–28 — same pattern):
```typescript
const TOOL_NAMES = [
  'branding_list_guidelines',
  'branding_get_guideline',
  'branding_list_sites',
  'branding_match',
] as const;
```

**Top-of-file classification block** — copy from compliance lines 30–56 in structure, adapted to branding's reality. Every tool explicitly listed and classified ORG-SCOPED with rationale: "guidelines and site assignments are stored per-org; the DB layer filters by org_id and the in-memory store filters by guideline.orgId".

---

### `packages/branding/tests/mcp/http.test.ts` (test, integration over MCP JSON-RPC)

**Analog:** `packages/compliance/tests/mcp/http.test.ts` lines 10–238 (exact template).

**Current state:** 3 smoke tests (401, initialize, empty tools list). Phase 29 keeps these and ADDS the 4 assertion blocks from compliance.

**Shared helper imports + SSE parser** (compliance tests lines 10–47 — already present in branding test; keep unchanged).

**Tool-list content assertion pattern** (compliance tests lines 90–117 — adapt tool name check):
```typescript
it('tools/list with branding.view — returns exactly the 4 branding tools', async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/mcp',
    headers: {
      authorization: `Bearer ${readToken}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    payload: listToolsPayload(),
  });
  expect(response.statusCode).toBe(200);
  const parsed = parseSseOrJson(response.body);
  const result = parsed['result'] as { tools?: Array<{ name: string }> } | undefined;
  const names = (result?.tools ?? []).map((t) => t.name);
  expect(names).toContain('branding_list_guidelines');
  expect(names).toContain('branding_get_guideline');
  expect(names).toContain('branding_list_sites');
  expect(names).toContain('branding_match');
  expect(names.length).toBe(4);
});
```

**Runtime orgId-absent iteration test** (compliance tests lines 140–194 — COPY VERBATIM, adapt imports + expected count):
```typescript
it('D-13 runtime guard — NO branding tool inputSchema contains orgId', async () => {
  const { server, metadata, toolNames } = await createBrandingMcpServer();

  expect(toolNames.length).toBe(4);
  expect(metadata.length).toBe(4);

  const registered = (server as unknown as {
    _registeredTools?: Record<string, { inputSchema?: unknown }>;
  })._registeredTools ?? {};
  const entries = Object.entries(registered);
  expect(entries.length).toBe(4);

  for (const [name, tool] of entries) {
    const schema = tool.inputSchema as Record<string, unknown> | undefined;
    let shapeRecord: Record<string, unknown> = {};
    if (schema != null && typeof schema === 'object') {
      const def = (schema as { _def?: { shape?: unknown } })._def;
      if (def != null && typeof def === 'object' && 'shape' in def) {
        const shape = (def as { shape?: unknown }).shape;
        if (typeof shape === 'function') {
          shapeRecord = (shape as () => Record<string, unknown>)() ?? {};
        } else if (shape != null && typeof shape === 'object') {
          shapeRecord = shape as Record<string, unknown>;
        }
      }
      if (Object.keys(shapeRecord).length === 0) {
        const s = (schema as { shape?: unknown }).shape;
        if (s != null && typeof s === 'object') {
          shapeRecord = s as Record<string, unknown>;
        }
      }
      if (Object.keys(shapeRecord).length === 0) {
        shapeRecord = schema as Record<string, unknown>;
      }
    }
    expect(shapeRecord, `tool ${name} must not accept orgId (D-13)`).not.toHaveProperty('orgId');
    let serialised = '';
    try {
      serialised = JSON.stringify(schema, (_k, v) => (typeof v === 'function' ? '[fn]' : v));
    } catch {
      serialised = String(schema);
    }
    expect(serialised.includes('"orgId"'), `tool ${name} schema must not contain "orgId" (D-13)`).toBe(false);
  }
});
```

**Classification coverage test** (compliance tests lines 196–229 — adapt comment counts; all 4 branding tools are ORG-SCOPED so the split is `orgScopedMatches.length === 4`, `globalMatches.length === 0`):
```typescript
it('Classification coverage — every handler carries an explicit comment, NO TODO deferrals', async () => {
  const source = await readFile(resolve(__dirname, '../../src/mcp/server.ts'), 'utf-8');
  expect(source).not.toMatch(/TODO\(phase-30\)/);
  expect(source).not.toMatch(/TODO phase-30/);
  expect(source).not.toMatch(/TODO phase 30/);

  const globalMatches = source.match(/\/\/ orgId: N\/A /g) ?? [];
  const orgScopedMatches = source.match(/\/\/ orgId: ctx\.orgId /g) ?? [];
  const totalClassifications = globalMatches.length + orgScopedMatches.length;
  expect(totalClassifications).toBe(4);
  expect(orgScopedMatches.length).toBe(4);
  expect(globalMatches.length).toBe(0);

  expect(source).not.toMatch(/orgId\s*:\s*z\./);
  expect(source).not.toMatch(/console\.log/);
});
```

**Permission filter cross-org test** (new pattern — not present in compliance because compliance.view tools are the default read path; branding needs an explicit write-scope gate test since `branding.manage` isn't used in Phase 29):
```typescript
it('tools/list with no permissions (service-to-service read scope) — still sees all 4 branding.view tools via scope fallback', async () => {
  // read scope covers branding.view — filterToolsByScope admits *.view tools
  const response = await app.inject({ /* Bearer with scopes=['read'] */ });
  // ... assert 4 tools returned
});
```

---

### `packages/llm/src/mcp/server.ts` (service/tool-registry, event-driven)

**Analog:** `packages/compliance/src/mcp/server.ts` (same as branding). Differences below.

**Key classification difference (D-06):** All 4 LLM tools are **GLOBAL**, not ORG-SCOPED. LLM inputs are supplied by caller; outputs are provider-derived. Every handler carries `// orgId: N/A (global — inputs supplied by caller)` — mirrors compliance's `// orgId: N/A (global reference data)` pattern from lines 201, 288, 351 but with the LLM-specific rationale.

**Imports** (adapt compliance lines 1–9):
```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getCurrentToolContext } from '@luqen/core/mcp';
import type { DbAdapter } from '../db/adapter.js';
import { createAdapter } from '../providers/registry.js';
import { executeExtractRequirements } from '../capabilities/extract-requirements.js';
import { executeGenerateFix } from '../capabilities/generate-fix.js';
import { executeAnalyseReport } from '../capabilities/analyse-report.js';
import { executeDiscoverBranding } from '../capabilities/discover-branding.js';
import { CapabilityNotConfiguredError, CapabilityExhaustedError } from '../capabilities/types.js';
import { VERSION } from '../version.js';
import { LLM_TOOL_METADATA } from './metadata.js';
export { LLM_TOOL_METADATA } from './metadata.js';
```

**Factory options — accept `DbAdapter` (mirror compliance lines 65–68 but for LLM's db):**
```typescript
export interface LlmMcpServerOptions {
  readonly db: DbAdapter;
}

export async function createLlmMcpServer(
  options: LlmMcpServerOptions,
): Promise<{
  server: McpServer;
  toolNames: readonly string[];
  metadata: typeof LLM_TOOL_METADATA;
}> {
  const { db } = options;
  const server = new McpServer(
    { name: 'luqen-llm', version: VERSION },
    { capabilities: { tools: {} } },
  );
  // ... registerTool blocks ...
  return { server, toolNames: [...TOOL_NAMES], metadata: LLM_TOOL_METADATA };
}
```

**Note:** The current Phase 28 stub takes `_options: Record<string, never> = {}`. Phase 29 MUST change this signature (and update `packages/llm/src/api/routes/mcp.ts` to pass `{ db }` — this is ONE extra line there) because the capability executors all require a DbAdapter for model/prompt resolution.

**Core tool registration — adapters over `execute*` capability executors:**

The LLM REST handlers (`packages/llm/src/api/routes/capabilities-exec.ts` lines 138–186 for generate-fix) show the exact shape to mirror. Key patterns to preserve:
- Validate inputs the same way the REST route does (early-return with an error envelope)
- Resolve `orgId` from ctx (never from args — D-13)
- Call the same `execute*` executor the REST handler calls
- Normalise the envelope into `{ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }`
- Wrap provider errors in `isError: true` form

1. `llm_generate_fix` (mirrors `POST /api/v1/generate-fix` — capabilities-exec.ts lines 138–186):
```typescript
server.registerTool(
  'llm_generate_fix',
  {
    description: 'Generate an AI fix suggestion for a WCAG accessibility issue. Returns fixed HTML, explanation, and effort estimate. Falls back to 50 hardcoded patterns when the LLM provider is unavailable (D-09).',
    inputSchema: z.object({
      wcagCriterion: z.string().describe('WCAG success criterion (e.g. "1.1.1 Non-text Content")'),
      issueMessage: z.string().describe('Accessibility issue description from the scanner'),
      htmlContext: z.string().describe('HTML snippet containing the problematic element'),
      cssContext: z.string().optional().describe('Optional: relevant CSS for the element'),
    }),
  },
  // orgId: N/A (global — inputs supplied by caller; orgId used only for per-org prompt overrides)
  async (args) => {
    const _ctx = getCurrentToolContext();
    const orgId = getCurrentToolContext()?.orgId ?? 'system';
    try {
      const capResult = await executeGenerateFix(
        db,
        (type: string) => createAdapter(type as import('../types.js').ProviderType),
        {
          wcagCriterion: args.wcagCriterion,
          issueMessage: args.issueMessage,
          htmlContext: args.htmlContext,
          ...(args.cssContext != null ? { cssContext: args.cssContext } : {}),
          orgId,
        },
      );
      const payload = {
        ...capResult.data,
        model: capResult.model,
        provider: capResult.provider,
        attempts: capResult.attempts,
      };
      return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
    } catch (err) {
      // Same error envelope shape as REST 502/503/504 responses
      const message = err instanceof CapabilityNotConfiguredError
        ? err.message
        : err instanceof CapabilityExhaustedError
          ? err.message
          : 'Upstream LLM error';
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  },
);
```

2. `llm_analyse_report` — mirror capabilities-exec.ts lines 238–292. Schema fields: `siteUrl`, `totalIssues`, `issuesList` (array of `{criterion, message, count, level}`), `complianceSummary`, `recurringPatterns`. Same error-envelope pattern.

3. `llm_discover_branding` — mirror capabilities-exec.ts lines 352–393. Schema: `url` (http/https). Same fallback + error pattern. Description: "Auto-detect brand colors, fonts, and logo from a URL. Runs via LLM service (D-08 — not branding MCP)."

4. `llm_extract_requirements` — mirror capabilities-exec.ts lines 49–99. Schema: `content`, `regulationId`, `regulationName`, `jurisdictionId?`. Same error pattern.

**Error-handling pattern to reuse** (compliance server.ts lines 206–218, 296–304 — the `isError: true` envelope):
```typescript
if (regulation == null) {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: `Regulation "${args.id}" not found` }) }],
    isError: true,
  };
}
```

**Metadata file** (`packages/llm/src/mcp/metadata.ts`):
```typescript
import type { ToolMetadata } from '@luqen/core/mcp';

export const LLM_TOOL_METADATA: readonly ToolMetadata[] = [
  { name: 'llm_generate_fix',         requiredPermission: 'llm.view' },
  { name: 'llm_analyse_report',       requiredPermission: 'llm.view' },
  { name: 'llm_discover_branding',    requiredPermission: 'llm.view' },
  { name: 'llm_extract_requirements', requiredPermission: 'llm.view' },
];
```

**TOOL_NAMES constant:**
```typescript
const TOOL_NAMES = [
  'llm_generate_fix',
  'llm_analyse_report',
  'llm_discover_branding',
  'llm_extract_requirements',
] as const;
```

**Wiring update** — `packages/llm/src/api/routes/mcp.ts` currently calls `createLlmMcpServer()` with no args. Phase 29 must change this to `createLlmMcpServer({ db })` — `db` is already available in the calling `packages/llm/src/api/server.ts` scope. One-line change per service, mirrors how `packages/compliance/src/api/routes/mcp.ts` passes `{ db: opts.db }` to its factory (see 28-02-PLAN.md Task 1 step 4).

---

### `packages/llm/tests/mcp/http.test.ts` (test, integration)

**Analog:** Same as branding — `packages/compliance/tests/mcp/http.test.ts`.

**Differences from branding test:**
- Expected tool count: 4 (same as branding)
- Classification split: `globalMatches.length === 4`, `orgScopedMatches.length === 0` (all LLM tools are GLOBAL per D-06)
- `TODO` negative check targets `TODO\(phase-30\)` the same way
- Tool names asserted: `llm_generate_fix`, `llm_analyse_report`, `llm_discover_branding`, `llm_extract_requirements`
- Invocation tests should use a **mocked provider adapter** (Phase 29 Claude's Discretion #4 — shared fixture vs per-tool). Mirror the LLM capability unit tests' existing provider-mock pattern — do not hit a real provider.

**New invocation-smoke test template** (not present in compliance test because compliance tools hit SQLite directly; LLM needs provider mocking). Minimal example — executor is the seam:
```typescript
it('llm_generate_fix — dispatches to executeGenerateFix and returns provider result envelope', async () => {
  // Inject a provider stub via the existing LLM test harness pattern; assert
  // the tool handler returns the same shape the REST handler does
  // (fixedHtml, explanation, effort, model, provider, attempts).
});
```

**CRITICAL — all other test scaffolding (401 no Bearer, 200 initialize, tools/list content, D-13 iteration, classification coverage) is structurally identical to branding's test file.** Build via copy-and-substitute: `branding` → `llm`, count stays 4, classification flips all-ORG-SCOPED → all-GLOBAL.

---

### `.planning/REQUIREMENTS.md` (docs traceability)

**Analog:** Self — use existing requirement-table format.

**Changes required** (per D-14):
- `MCPT-01` (scan/report/issue tools): change "Phase" column from `29` to `30`.
- `MCPT-02`: split into two rows or annotate "Phase 29 partial (list_guidelines + llm_discover_branding); Phase 30 completes (brand score retrieval)".
- `MCPT-03` (LLM fix + analyse): unchanged, stays Phase 29.
- `MCPI-05` (Resources): move from Phase 29 to Phase 30.
- `MCPI-06` (Prompts): move from Phase 29 to Phase 30.

**Pattern to copy:** Mirror the existing row formatting (`| ID | Requirement | Phase | Status |`). Do not introduce new columns.

---

### `.planning/ROADMAP.md` (docs phase plan)

**Analog:** Self — existing Phase 29 success-criteria bullets.

**Changes required** (per D-15):
- Phase 29 success criterion #1 (about scan/report tools): remove or retarget to Phase 30.
- Phase 29 success criterion #2 (brand score retrieval): split — keep "list guidelines + invoke discover-branding via MCP" for Phase 29; move "retrieve brand scores" to Phase 30.
- Phase 29 success criterion #3 (LLM fix + analyse): unchanged.
- Add note that MCP Resources (MCPI-05) and MCP Prompts (MCPI-06) land in Phase 30.
- Phase 30 success criteria: add scan/report tools, brand score tools, resources, and chat-message prompt templates (D-12).

---

## Shared Patterns

### Tool factory shape (apply to both branding + LLM servers)
**Source:** `packages/compliance/src/mcp/server.ts` lines 72–92
**Apply to:** `packages/branding/src/mcp/server.ts`, `packages/llm/src/mcp/server.ts`

```typescript
export async function createXxxMcpServer(
  options: XxxMcpServerOptions = {},
): Promise<{
  server: McpServer;
  toolNames: readonly string[];
  metadata: typeof XXX_TOOL_METADATA;
}> {
  // 1) resolve backing resource (store or db)
  // 2) new McpServer({ name, version }, { capabilities: { tools: {} } })
  // 3) server.registerTool(...) × N
  // 4) return { server, toolNames: [...TOOL_NAMES], metadata: XXX_TOOL_METADATA }
}
```

The `{ capabilities: { tools: {} } }` second argument to `new McpServer(...)` is MANDATORY — both current stubs include it (`packages/branding/src/mcp/server.ts` line 31, `packages/llm/src/mcp/server.ts` line 28). Without it, `Server.setRequestHandler(ListToolsRequestSchema)` throws "Server does not support tools" (Phase 28 footnote).

### orgId resolution (apply to every handler)
**Source:** `packages/compliance/src/mcp/server.ts` lines 58–61
**Apply to:** every branding tool handler; every LLM tool handler

```typescript
function resolveOrgId(): string {
  const ctx = getCurrentToolContext();
  return ctx?.orgId ?? 'system';
}
```

D-13 invariant: orgId is NEVER read from `args`, ALWAYS from `getCurrentToolContext()`. Runtime-tested per service by iterating `_registeredTools` and asserting no `orgId` key in any schema shape.

### Classification comment discipline
**Source:** `packages/compliance/src/mcp/server.ts` lines 115, 143, 163, 183, 201, 245, 269, 288, 314, 335, 351
**Apply to:** every handler in branding + LLM

Exactly one of these two comment forms IMMEDIATELY above each `async (args) => {` line:
- `// orgId: ctx.orgId (org-scoped — <rationale>)` — for ORG-SCOPED (all 4 branding tools)
- `// orgId: N/A (global — <rationale>)` — for GLOBAL (all 4 LLM tools)

Test assertion (mirror compliance test lines 207–219):
```typescript
const globalMatches = source.match(/\/\/ orgId: N\/A /g) ?? [];
const orgScopedMatches = source.match(/\/\/ orgId: ctx\.orgId /g) ?? [];
expect(globalMatches.length + orgScopedMatches.length).toBe(4);  // per service
```

### Tool response envelope
**Source:** `packages/compliance/src/mcp/server.ts` lines 129, 148, 168, 188, 221, 258, 274, 303, 319, 340
**Apply to:** every handler

Success:
```typescript
return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
```

Error (mirror compliance lines 207–210, 213–217, 296–300):
```typescript
return {
  content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
  isError: true,
};
```

### Zod schema conventions
**Source:** `packages/compliance/src/mcp/server.ts` lines 99–113, 138–141, 197–199, 230–243
**Apply to:** every tool `inputSchema`

- Every field `.describe('...')` — populates the MCP manifest the LLM consumes.
- NO `orgId` field anywhere (D-13) — runtime-tested.
- Use `z.enum([...])` for closed sets (mirrors compliance lines 112, 139, 159, 180, 232).
- Use `z.array(z.object({...}))` for issue-list inputs (mirrors compliance lines 101–110).
- For LLM tools: mirror the REST route's `body.properties` from `packages/llm/src/api/routes/capabilities-exec.ts` 1:1 (D-07 — tool inputs mirror REST body exactly, minus `orgId`).

### Metadata file layout
**Source:** `packages/compliance/src/mcp/metadata.ts` lines 1–27
**Apply to:** `packages/branding/src/mcp/metadata.ts`, `packages/llm/src/mcp/metadata.ts`

Single `readonly ToolMetadata[]` array with `{ name, requiredPermission, destructive? }` entries. Permission strings must match `ALL_PERMISSION_IDS` in `packages/dashboard/src/permissions.ts` (`branding.view`, `llm.view`). No `destructive: true` entries in Phase 29 (all tools are non-destructive per CONTEXT.md D-03/D-06).

### stdio safety (critical for all MCP files)
**Source:** PITFALLS.md #11; compliance test line 225
**Apply to:** every file under `packages/*/src/mcp/**`

NO `console.log`. Errors via `return { ..., isError: true }` or `throw`. Test assertion: `expect(source).not.toMatch(/console\.log/)`.

### Fastify plugin composition order (inheritance, NOT modification)
**Source:** `packages/branding/src/api/server.ts` line 550; `packages/llm/src/api/server.ts` line 136
**Apply to:** N/A — inherited automatically

Both `registerMcpRoutes(app)` calls are already in place from Phase 28. Adding tools to the factory is enough — the plugin picks them up. No changes needed in `api/server.ts` for either service.

### Integration test helpers (SSE parser, payload factories)
**Source:** `packages/compliance/tests/mcp/http.test.ts` lines 21–47 + `packages/branding/tests/mcp/http.test.ts` lines 20–46 + `packages/llm/tests/mcp/http.test.ts` lines 21–47
**Apply to:** both Phase 29 test files

The `parseSseOrJson`, `initializePayload`, `listToolsPayload` helpers are identical across all three existing test files — keep them unchanged when extending the branding + LLM tests.

---

## No Analog Found

None. Every Phase 29 file has an exact-match analog in Phase 28's already-landed compliance MCP implementation.

---

## Metadata

**Analog search scope:**
- `packages/compliance/src/mcp/**` (reference implementation — 11 tools landed in Phase 28)
- `packages/compliance/tests/mcp/**` (reference test suite)
- `packages/branding/src/mcp/**` (current empty stub to upgrade)
- `packages/branding/tests/mcp/**` (current 3-test smoke suite to extend)
- `packages/branding/src/store.ts`, `packages/branding/src/matcher/**`, `packages/branding/src/types.ts` (source-of-truth for `branding_match` adapter)
- `packages/branding/src/api/server.ts` lines 259, 265, 423, 506–548 (REST handlers to mirror as tools)
- `packages/llm/src/mcp/**` (current empty stub to upgrade)
- `packages/llm/tests/mcp/**` (current 3-test smoke suite to extend)
- `packages/llm/src/capabilities/**` (4 executor entry points — `executeGenerateFix`, `executeAnalyseReport`, `executeDiscoverBranding`, `executeExtractRequirements`)
- `packages/llm/src/api/routes/capabilities-exec.ts` (REST handlers to mirror body shapes, validation, and error envelopes)
- `@luqen/core/mcp` exports (Phase 28: `getCurrentToolContext`, `ToolMetadata`, `createMcpHttpPlugin`)

**Files scanned:** 18
**Pattern extraction date:** 2026-04-17
