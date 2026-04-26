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
});
