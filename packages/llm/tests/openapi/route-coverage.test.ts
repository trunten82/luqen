/**
 * Phase 40-01 DOC-02 Task 4 + Phase 41-03 — route-vs-spec coverage gate (LLM service).
 *
 * Phase 41-03: parser rewritten to reconstruct full paths from the indented
 * tree shape produced by `app.printRoutes({ commonPrefix: false })`. Routes
 * appear as nested branches (e.g. `/:id` under `/api/v1/clients`); previous
 * naive line-by-line parsing dropped the parent prefix and produced false
 * positives. We track depth via the leading box-drawing prefix length.
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

function joinSegments(parent: string, child: string): string {
  if (child === '/') return parent === '' ? '/' : parent;
  if (child.startsWith('/')) {
    if (parent === '' || parent === '/') return child;
    // child like "/:id" appended to parent like "/api/v1/clients"
    const trimmedParent = parent.replace(/\/$/, '');
    return `${trimmedParent}${child}`;
  }
  // child like "static/index.html" — append with separator
  if (parent === '' || parent === '/') return `/${child}`;
  return `${parent.replace(/\/$/, '')}/${child}`;
}

/**
 * Parse the printRoutes() tree output into fully-qualified routes.
 *
 * Sample input lines:
 * ```
 * ├── /api/v1/clients (GET, HEAD, POST)
 * │   └── /:id (DELETE)
 * ```
 *
 * The leading prefix (├── │   └── etc.) length determines the depth in the
 * tree; we maintain a depth→path stack so that `/:id` resolves to
 * `/api/v1/clients/:id`.
 */
function parseRouteTree(output: string): readonly RegisteredRoute[] {
  const lines = output.split('\n').filter((l) => l.trim().length > 0);
  const stack: Array<{ depth: number; path: string }> = [];
  const routes: RegisteredRoute[] = [];

  for (const line of lines) {
    // Strip ANSI just in case.
    const clean = line.replace(/\u001b\[[0-9;]*m/g, '');
    // Find the position of the first non-tree character. Tree chars are: └ ├ │ ─ space.
    const treePrefixMatch = clean.match(/^[└├│─\s]*/);
    const depthChars = treePrefixMatch ? treePrefixMatch[0].length : 0;
    // Each tree level is 4 chars wide (e.g. "│   " or "├── " or "    ").
    const depth = Math.floor(depthChars / 4);
    const rest = clean.slice(depthChars);
    const match = rest.match(/^(\S+)\s+\(([^)]+)\)\s*$/);
    if (!match) continue;
    const segment = match[1] ?? '';
    const methodsRaw = match[2] ?? '';
    // Pop stack down to the current depth's parent.
    while (stack.length > 0 && stack[stack.length - 1]!.depth >= depth) {
      stack.pop();
    }
    const parent = stack.length > 0 ? stack[stack.length - 1]!.path : '';
    const fullPath = joinSegments(parent, segment);
    stack.push({ depth, path: fullPath });

    const methods = methodsRaw.split(',').map((m) => m.trim()).filter(Boolean);
    for (const method of methods) {
      routes.push({ method, path: fullPath });
    }
  }

  return routes;
}

// Internal/utility paths that are not part of the public API surface and
// therefore not advertised in the OpenAPI document. The Swagger UI assets
// and the wildcard OPTIONS handler are filtered here so the gate stays
// focused on real API routes.
const IGNORED_PATH_PATTERNS: readonly RegExp[] = [
  /^\/docs(\/|$)/,
  /^\*$/,
  /^\/api\/v1\/openapi\.json$/, // alias that redirects to /docs/json
];

function isIgnored(path: string): boolean {
  for (const re of IGNORED_PATH_PATTERNS) {
    if (re.test(path)) return true;
  }
  return false;
}

describe('OpenAPI route coverage (llm)', () => {
  let app: Awaited<ReturnType<typeof createServer>>;

  beforeAll(async () => {
    process.env['DASHBOARD_JWKS_URL'] = '';
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
      .filter((r) => !isIgnored(r.path))
      .filter((r) => r.method !== 'HEAD' && r.method !== 'OPTIONS');

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
