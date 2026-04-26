/**
 * Phase 40-01 DOC-02 Task 4 — route-vs-spec coverage gate for the MCP
 * Streamable HTTP endpoint hosted on the dashboard service.
 *
 * Phase 41-05 (OAPI-05) — flipped from describe.skip to active. The
 * dashboard MCP route is wired with a JSON-RPC body schema (in
 * routes/api/mcp.ts) and one virtual operation per registered tool is
 * injected via packages/dashboard/src/mcp/openapi-bridge.ts so the
 * Fastify swagger generator emits a substantive entry per tool.
 *
 * Routes are captured via the server-side `onRoute` hook attached in
 * server.ts (`__collectedRoutes`) — same approach as
 * route-coverage.test.ts (Plan 41-04). The previous printRoutes() trie
 * parser was lossy for nested branches.
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

describe('OpenAPI route coverage (dashboard MCP endpoint)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;

  beforeAll(async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'luqen-mcp-openapi-'));
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

  it('every /api/v1/mcp* route appears in /docs/json paths', () => {
    const spec = app.swagger() as { paths?: Record<string, unknown> };
    const specPaths = spec.paths ?? {};

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const collected = ((app as any).__collectedRoutes ?? []) as RegisteredRoute[];
    const routes = collected
      .filter((r) => r.method !== 'HEAD' && r.method !== 'OPTIONS')
      .filter((r) => r.path === '/api/v1/mcp' || r.path.startsWith('/api/v1/mcp/'));

    expect(routes.length, 'expected at least one /api/v1/mcp* route').toBeGreaterThan(0);

    const missing: string[] = [];
    for (const route of routes) {
      const openApiPath = toOpenApiPath(route.path);
      if (!Object.prototype.hasOwnProperty.call(specPaths, openApiPath)) {
        missing.push(`${route.method} ${route.path}`);
      }
    }

    expect(
      missing,
      `MCP routes missing from OpenAPI spec — add a schema to each:\n${missing.join('\n')}`,
    ).toEqual([]);
  });
});
