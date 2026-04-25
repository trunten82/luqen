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

function parseRouteLine(line: string): readonly RegisteredRoute[] {
  const trimmed = line.replace(/[└├│─\s]+/g, ' ').trim();
  const match = trimmed.match(/^(\S+)\s+\(([^)]+)\)\s*$/);
  if (!match) return [];
  const path = match[1] ?? '';
  const methods = (match[2] ?? '').split(',').map((m) => m.trim()).filter(Boolean);
  return methods.map((method) => ({ method, path }));
}

describe.skip('[Phase 41 pending] OpenAPI route coverage (branding)', () => {
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

    const routes = app.printRoutes({ commonPrefix: false })
      .split('\n')
      .flatMap(parseRouteLine)
      .filter((r) => r.path !== '*' && !r.path.startsWith('/__'))
      .filter((r) => r.method !== 'HEAD');

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
