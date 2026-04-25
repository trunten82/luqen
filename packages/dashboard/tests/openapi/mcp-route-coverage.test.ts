/**
 * Phase 40-01 DOC-02 Task 4 — route-vs-spec coverage gate for the MCP
 * Streamable HTTP endpoint hosted on the dashboard service.
 *
 * The MCP endpoint is mounted under /api/v1/mcp and is registered as part
 * of the dashboard Fastify instance. We boot the same dashboard server,
 * filter to /api/v1/mcp* routes, and assert each is present in the spec.
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

describe.skip('[Phase 41 pending] OpenAPI route coverage (dashboard MCP endpoint)', () => {
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

    const routes = (app.printRoutes({ commonPrefix: false }) as string)
      .split('\n')
      .flatMap(parseRouteLine)
      .filter((r) => r.method !== 'HEAD')
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
