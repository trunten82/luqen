/**
 * Phase 40-01 DOC-02 Task 4 — route-vs-spec coverage gate (dashboard service).
 *
 * The dashboard's createServer() requires a full DashboardConfig, plugin
 * manager, redis-or-null, etc. This test boots a minimal config against
 * an in-memory-style sqlite tmpfile and asserts every Fastify route is
 * surfaced in the swagger spec. MCP-prefixed routes are EXCLUDED here —
 * they live in mcp-route-coverage.test.ts.
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

function parseRouteLine(line: string): readonly RegisteredRoute[] {
  const trimmed = line.replace(/[└├│─\s]+/g, ' ').trim();
  const match = trimmed.match(/^(\S+)\s+\(([^)]+)\)\s*$/);
  if (!match) return [];
  const path = match[1] ?? '';
  const methods = (match[2] ?? '').split(',').map((m) => m.trim()).filter(Boolean);
  return methods.map((method) => ({ method, path }));
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

    const routes = (app.printRoutes({ commonPrefix: false }) as string)
      .split('\n')
      .flatMap(parseRouteLine)
      .filter((r) => r.path !== '*' && !r.path.startsWith('/__'))
      .filter((r) => r.method !== 'HEAD')
      // MCP routes are covered by mcp-route-coverage.test.ts.
      .filter((r) => !r.path.startsWith('/api/v1/mcp'));

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
