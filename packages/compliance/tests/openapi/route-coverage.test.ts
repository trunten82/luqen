/**
 * Phase 40-01 DOC-02 Task 4 — route-vs-spec coverage gate.
 *
 * Enumerates every Fastify-registered route on the compliance service and
 * asserts each one appears in the OpenAPI spec produced by app.swagger().
 * A route registered without a `schema` option is invisible to the swagger
 * plugin and therefore fails this test — forcing Task 2 to add at least a
 * minimal schema (summary/tags/response) to every shipped route.
 *
 * Phase 41-01: gate flipped from `describe.skip` to `describe`. Parser
 * rewritten to walk Fastify's hierarchical `printRoutes` tree, joining
 * parent-prefix segments so paths like `/api/v1/jurisdictions/:id` are
 * recognised instead of bare `/:id`.
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
 * Parse Fastify v5 `printRoutes({ commonPrefix: false })` tree output and
 * yield one entry per (method, full-path). The tree uses box-drawing
 * characters (├ └ │) and indentation to denote parent → child nesting.
 *
 * Each line follows the pattern:
 *   <indent><box-chars> <pathSegment> [(<METHODS>)]
 *
 * A line with `(METHODS)` registers a route at the joined path of all
 * ancestor segments. A line without `(METHODS)` is a path-prefix node
 * that contributes its segment to descendants but does not register a
 * route itself (Fastify still prints it because children share that
 * prefix).
 */
function parseRouteTree(tree: string): readonly RegisteredRoute[] {
  const lines = tree.split('\n').filter((l) => l.trim().length > 0);
  // Stack of [depth, accumulated-path] entries for ancestry tracking.
  const stack: Array<{ depth: number; path: string }> = [];
  const routes: RegisteredRoute[] = [];

  for (const line of lines) {
    // Depth = number of leading whitespace characters before any box-drawing
    // glyph. Fastify uses 4-character indents (`│   ` or `    `) per level.
    const indentMatch = line.match(/^([\s│]*)([├└])?/);
    const indent = indentMatch ? indentMatch[1] ?? '' : '';
    const depth = Math.floor(indent.length / 4);

    // Strip the box characters + leading whitespace to isolate the segment.
    const cleaned = line.replace(/^[\s│├└─]+/, '').trim();
    if (cleaned.length === 0) continue;

    const methodsMatch = cleaned.match(/\s*\(([^)]+)\)\s*$/);
    const segment = (methodsMatch ? cleaned.slice(0, methodsMatch.index ?? 0) : cleaned).trim();
    const methods = methodsMatch
      ? (methodsMatch[1] ?? '').split(',').map((m) => m.trim()).filter(Boolean)
      : [];

    // Pop ancestors deeper than or equal to this line.
    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
      stack.pop();
    }
    const parentPath = stack.length > 0 ? stack[stack.length - 1].path : '';
    // Join: parent already ends with the relevant slash boundary; segment may
    // start with `/`. Avoid double slashes.
    const fullPath = parentPath + segment;

    stack.push({ depth, path: fullPath });

    for (const method of methods) {
      routes.push({ method, path: fullPath });
    }
  }

  return routes;
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
    const routes = parseRouteTree(tree)
      .filter((r) => r.path.startsWith('/api/v1') || r.path.startsWith('/.well-known'))
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
