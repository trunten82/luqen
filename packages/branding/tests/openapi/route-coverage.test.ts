/**
 * Phase 40-01 DOC-02 Task 4 — route-vs-spec coverage gate (branding service).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import { createTokenSigner, createTokenVerifier } from '../../src/auth/oauth.js';
import { createServer } from '../../src/api/server.js';

interface RegisteredRoute {
  readonly method: string;
  readonly path: string;
}

function toOpenApiPath(fastifyPath: string): string {
  return fastifyPath.replace(/:([^/]+)/g, '{$1}');
}

/**
 * Fastify's `printRoutes({ commonPrefix: false })` returns an indented tree
 * where each node prints only its own path segment. To reconstruct full
 * paths we walk the tree, tracking the prefix at each indent level.
 */
function parseRouteTree(tree: string): readonly RegisteredRoute[] {
  const lines = tree.split('\n');
  const stack: string[] = [];
  const routes: RegisteredRoute[] = [];

  for (const raw of lines) {
    if (raw.trim().length === 0) continue;
    // Each tree level is 4 chars wide (`│   `, `├── `, `└── `, `    `).
    const indentMatch = raw.match(/^([│ ]*[├└]?─?─? ?)/);
    const indent = indentMatch ? indentMatch[0]!.length : 0;
    const level = Math.floor(indent / 4);
    const content = raw.slice(indent).trim();
    const m = content.match(/^(\S+)\s+\(([^)]+)\)\s*$/);
    if (!m) continue;
    const segment = m[1] ?? '';
    const methods = (m[2] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    stack.length = level;
    stack.push(segment);
    const fullPath = stack.join('').replace(/\/+/g, '/');
    if (fullPath === '*' || fullPath.startsWith('/__')) continue;
    for (const method of methods) {
      if (method === 'HEAD') continue;
      routes.push({ method, path: fullPath });
    }
  }
  return routes;
}

describe('OpenAPI route coverage (branding)', () => {
  let app: Awaited<ReturnType<typeof createServer>>;

  beforeAll(async () => {
    const db = new SqliteAdapter(':memory:');
    const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
    const privateKeyPem = await exportPKCS8(privateKey);
    const publicKeyPem = await exportSPKI(publicKey);
    app = await createServer({
      db,
      signToken: await createTokenSigner(privateKeyPem),
      verifyToken: await createTokenVerifier(publicKeyPem),
      tokenExpiry: '1h',
      logger: false,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('every registered route appears in /docs/json paths', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const spec = (app as any).swagger() as { paths?: Record<string, unknown> };
    const specPaths = spec.paths ?? {};

    const routes = parseRouteTree(app.printRoutes({ commonPrefix: false }))
      // /docs/* is the @fastify/swagger-ui surface itself, not part of the API.
      .filter((r) => !r.path.startsWith('/docs'))
      // Backwards-compat alias that 302-redirects to /docs/json — intentionally hidden.
      .filter((r) => r.path !== '/api/v1/openapi.json');

    const missing: string[] = [];
    for (const route of routes) {
      const openApiPath = toOpenApiPath(route.path);
      if (!Object.prototype.hasOwnProperty.call(specPaths, openApiPath)) {
        missing.push(`${route.method} ${route.path}`);
      }
    }

    expect(
      missing,
      `routes missing from OpenAPI spec — add a schema to each:\n${missing.join('\n')}`,
    ).toEqual([]);
  });
});
