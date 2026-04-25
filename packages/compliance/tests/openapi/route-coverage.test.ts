/**
 * Phase 40-01 DOC-02 Task 4 — route-vs-spec coverage gate.
 *
 * Enumerates every Fastify-registered route on the compliance service and
 * asserts each one appears in the OpenAPI spec produced by app.swagger().
 * A route registered without a `schema` option is invisible to the swagger
 * plugin and therefore fails this test — forcing Task 2 to add at least a
 * minimal schema (summary/tags/response) to every shipped route.
 */

import { describe, it, expect } from 'vitest';
import { createTestApp } from '../api/helpers.js';

interface RegisteredRoute {
  readonly method: string;
  readonly path: string;
}

/**
 * Convert a Fastify route path with `:param` segments to the OpenAPI
 * `{param}` form so paths can be looked up in the generated spec.
 */
function toOpenApiPath(fastifyPath: string): string {
  return fastifyPath.replace(/:([^/]+)/g, '{$1}');
}

/**
 * Parse one line of `app.printRoutes({ commonPrefix: false })` output.
 * The output looks like:
 *   └── /api/v1/health (GET)
 *   └── /api/v1/jurisdictions/:id (GET, PUT, DELETE)
 * Returns one entry per method.
 */
function parseRouteLine(line: string): readonly RegisteredRoute[] {
  const trimmed = line.replace(/[└├│─\s]+/g, ' ').trim();
  const match = trimmed.match(/^(\S+)\s+\(([^)]+)\)\s*$/);
  if (!match) return [];
  const path = match[1] ?? '';
  const methods = (match[2] ?? '').split(',').map((m) => m.trim()).filter(Boolean);
  return methods.map((method) => ({ method, path }));
}

describe('OpenAPI route coverage (compliance)', () => {
  it('every registered route appears in /docs/json paths', async () => {
    const ctx = await createTestApp();
    const app = ctx.app;
    await app.ready();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const spec = (app as any).swagger() as { paths?: Record<string, unknown> };
    const specPaths = spec.paths ?? {};

    const tree = app.printRoutes({ commonPrefix: false });
    const routes = tree
      .split('\n')
      .flatMap(parseRouteLine)
      .filter((r) => r.path !== '*' && !r.path.startsWith('/__'))
      // HEAD is auto-registered alongside GET by Fastify and not surfaced in spec.
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

    await app.close();
  });
});
