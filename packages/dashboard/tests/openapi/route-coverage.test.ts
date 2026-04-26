/**
 * Phase 40-01 DOC-02 Task 4 — route-vs-spec coverage gate (dashboard service).
 * Phase 41-04 — flipped from describe.skip to active. Routes are captured via
 * a server-side onRoute hook (server.ts attaches __collectedRoutes before any
 * route registers). The previous printRoutes() trie parser was lossy — nested
 * branches lost their parent prefix.
 *
 * The dashboard's createServer() requires a full DashboardConfig, plugin
 * manager, redis-or-null, etc. This test boots a minimal config against
 * an in-memory-style sqlite tmpfile and asserts every Fastify route is
 * surfaced in the swagger spec. MCP-prefixed routes are EXCLUDED here —
 * they live in mcp-route-coverage.test.ts (owned by Plan 41-05).
 *
 * Phase 41.1-05 — adds the schema-fidelity assertion that closes OAPI-04
 * PARTIAL: ≥95% of in-scope operations declare a typed 2xx response, every
 * in-scope POST/PUT/PATCH declares a requestBody, and no in-scope operation
 * is left as a bare "Default Response" without intentional documentation
 * (`html-page` tag). The filter excludes routes that are out of OAPI-04
 * scope per .planning/phases/41.1-.../41.1-CONTEXT.md (agent.ts Zod
 * migration deferred; framework-injected /graphql, /graphiql/*, /health,
 * /robots.txt) and a small set of architecturally-bodyless API routes
 * (per-file in-source comments document why).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';

interface RegisteredRoute {
  readonly method: string;
  readonly path: string;
}

function toOpenApiPath(fastifyPath: string): string {
  return fastifyPath.replace(/:([^/]+)/g, '{$1}');
}

describe('OpenAPI route coverage (dashboard, non-MCP)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;

  beforeAll(async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'luqen-dash-openapi-'));
    const minimalConfig = {
      dbPath: join(tmpRoot, 'dashboard.db'),
      reportsDir: join(tmpRoot, 'reports'),
      sessionSecret: 'a'.repeat(32),
      catalogueUrl: '',
      catalogueCacheTtl: 0,
      redisUrl: '',
      maxConcurrentScans: 1,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app = await createServer(minimalConfig as any);
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('every non-MCP registered route appears in /docs/json paths', () => {
    const spec = app.swagger() as { paths?: Record<string, unknown> };
    const specPaths = spec.paths ?? {};

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const collected = ((app as any).__collectedRoutes ?? []) as RegisteredRoute[];
    const routes = collected
      .filter((r) => r.path !== '*' && !r.path.startsWith('/__'))
      .filter((r) => r.method !== 'HEAD' && r.method !== 'OPTIONS')
      // MCP routes are covered by mcp-route-coverage.test.ts (Plan 41-05).
      .filter((r) => !r.path.startsWith('/api/v1/mcp'))
      // Framework-provided routes (swagger-ui assets, fastify-static
      // wildcards) are not application surface and live outside the OpenAPI
      // spec by design.
      .filter((r) => !r.path.startsWith('/docs'))
      .filter((r) => !r.path.startsWith('/static'))
      .filter((r) => !r.path.startsWith('/uploads'));

    const missing: string[] = [];
    for (const route of routes) {
      const openApiPath = toOpenApiPath(route.path);
      if (!Object.prototype.hasOwnProperty.call(specPaths, openApiPath)) {
        missing.push(`${route.method} ${route.path}`);
      }
    }

    expect(
      missing,
      `dashboard routes missing from OpenAPI spec — add a schema to each:\n${missing.join('\n')}`,
    ).toEqual([]);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 41.1-05 — Schema fidelity assertion (closes OAPI-04 PARTIAL).
  //
  // Three sub-assertions enforce per CONTEXT.md verification depth:
  //   A. ≥95% of in-scope operations declare a typed 2xx response.
  //   B. Every in-scope POST/PUT/PATCH declares a requestBody.
  //   C. No in-scope operation is left as a bare "Default Response"
  //      (responses[200].description == 'Default Response' AND no content).
  //
  // The "html-page" tag (or text/html 2xx content) marks an operation as
  // intentionally HTML/HTMX-rendering — these are exempt from B and counted
  // as typed for A. See packages/dashboard/src/api/schemas/envelope.ts
  // (HtmlPageSchema) and the per-file `HtmlPartialResponse`/`MixedResponse`
  // helpers across routes/admin/*.
  //
  // Filter exclusions (out of OAPI-04 scope per Phase 41.1 CONTEXT.md):
  //
  //   - /agent/*           : agent.ts uses route-level Zod that was explicitly
  //                          deferred (CONTEXT.md "Out of scope" section).
  //                          Schema migration is its own future concern.
  //   - /graphql, /graphiql/*: framework-injected by the GraphQL plugin;
  //                          schemas live with the plugin, not in our routes.
  //   - /health, /robots.txt : framework / standard-response endpoints.
  //   - /api/v1/plugins/*, /api/v1/setup, /api/v1/sources/scan : intentionally
  //                          bodyless because Fastify body validation runs
  //                          BEFORE the auth/permission preHandler — declaring
  //                          a body schema would short-circuit the 401/403
  //                          path. Each file documents this explicitly in its
  //                          source comments.
  // ─────────────────────────────────────────────────────────────────────────
  it('schema fidelity — ≥95% typed 2xx, all writes have requestBody, no bare Default Response', () => {
    interface OperationObject {
      readonly tags?: ReadonlyArray<string>;
      readonly requestBody?: unknown;
      readonly responses?: Readonly<Record<string, {
        readonly description?: string;
        readonly content?: Readonly<Record<string, unknown>>;
      }>>;
    }

    const spec = app.swagger() as { paths?: Record<string, Record<string, OperationObject>> };
    const operations: Array<{ path: string; method: string; op: OperationObject }> = [];
    for (const [path, methods] of Object.entries(spec.paths ?? {})) {
      for (const [method, op] of Object.entries(methods)) {
        if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
        operations.push({ path, method: method.toUpperCase(), op });
      }
    }

    // Out-of-scope filter (see comment block above).
    const inScope = operations.filter((o) => {
      // Same exclusions as the route-coverage assertion above.
      if (o.path.startsWith('/api/v1/mcp')) return false;
      if (o.path.startsWith('/docs')) return false;
      if (o.path.startsWith('/static')) return false;
      if (o.path.startsWith('/uploads')) return false;
      // Phase 41.1 CONTEXT — agent.ts route-level Zod migration deferred.
      if (o.path === '/agent' || o.path.startsWith('/agent/')) return false;
      // Framework-injected GraphQL plugin routes.
      if (o.path === '/graphql' || o.path.startsWith('/graphiql')) return false;
      // Standard framework endpoints.
      if (o.path === '/health' || o.path === '/robots.txt') return false;
      return true;
    });

    // Detect HTML-rendering operations: tagged 'html-page' OR 2xx content has
    // text/html. Both are intentional documentation per envelope.ts D-05.
    const isHtmlPage = (op: OperationObject): boolean => {
      const tags = op.tags ?? [];
      if (tags.includes('html-page')) return true;
      const responses = op.responses ?? {};
      for (const [code, val] of Object.entries(responses)) {
        if (/^2\d\d$/.test(code) && val.content && Object.prototype.hasOwnProperty.call(val.content, 'text/html')) {
          return true;
        }
      }
      return false;
    };

    // Architecturally-bodyless write routes (auth-gate-before-validation).
    const ARCHITECTURALLY_BODYLESS_WRITES = new Set<string>([
      'POST /api/v1/setup',
      'POST /api/v1/sources/scan',
      'POST /api/v1/plugins/install',
      'POST /api/v1/plugins/{id}/activate',
      'POST /api/v1/plugins/{id}/deactivate',
      'PATCH /api/v1/plugins/{id}/config',
      'DELETE /api/v1/plugins/{id}',
    ]);

    // ── Assertion A: typed 2xx response coverage ≥ 95% ────────────────────
    const typedTwoXX = inScope.filter((o) => {
      const responses = o.op.responses ?? {};
      // Any 2xx with content counts as typed.
      for (const [code, val] of Object.entries(responses)) {
        if (/^2\d\d$/.test(code) && val.content !== undefined) return true;
      }
      // html-page tagged ops are intentionally documented.
      return isHtmlPage(o.op);
    });
    const typedRatio = inScope.length === 0 ? 1 : typedTwoXX.length / inScope.length;
    expect(
      typedRatio,
      `Schema fidelity: typed 2xx ratio ${(typedRatio * 100).toFixed(2)}% < 95%. ` +
        `${inScope.length - typedTwoXX.length} of ${inScope.length} in-scope operations ` +
        `lack a typed 2xx response (or html-page tag).`,
    ).toBeGreaterThanOrEqual(0.95);

    // ── Assertion B: every POST/PUT/PATCH has a requestBody ───────────────
    const writeOps = inScope.filter((o) => ['POST', 'PUT', 'PATCH'].includes(o.method));
    const writeOpsMissingBody = writeOps.filter((o) => {
      if (o.op.requestBody !== undefined) return false;
      if (isHtmlPage(o.op)) return false;
      // Architecturally bodyless (auth-gate-before-validation) — see file comment.
      if (ARCHITECTURALLY_BODYLESS_WRITES.has(`${o.method} ${o.path}`)) return false;
      return true;
    });
    expect(
      writeOpsMissingBody.map((o) => `${o.method} ${o.path}`),
      `Schema fidelity: in-scope POST/PUT/PATCH operations must declare a requestBody, ` +
        `tag 'html-page', or be listed in ARCHITECTURALLY_BODYLESS_WRITES.`,
    ).toEqual([]);

    // ── Assertion C: no bare 'Default Response' on in-scope ops ───────────
    const bareDefault = inScope.filter((o) => {
      if (isHtmlPage(o.op)) return false;
      const r200 = (o.op.responses ?? {})['200'];
      if (!r200) return false;
      return r200.description === 'Default Response' && r200.content === undefined;
    });
    expect(
      bareDefault.map((o) => `${o.method} ${o.path}`),
      `Schema fidelity: in-scope operations must NOT have a bare 'Default Response' ` +
        `200. Either declare a typed response, tag 'html-page', or add to the ` +
        `out-of-scope filter (with rationale comment).`,
    ).toEqual([]);
  });
});
