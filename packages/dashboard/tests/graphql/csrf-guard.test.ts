/**
 * /graphql is exempt from the dashboard's CSRF token check (server.ts
 * isCsrfExempt) and authenticates browsers by the session cookie
 * (SameSite=Lax). @fastify/formbody is registered globally, so a plain HTML
 * form POST of `query=mutation{...}` parses into a valid GraphQL body.
 * Lax keeps the cookie off cross-SITE POSTs, but a same-site origin (a sibling
 * subdomain) still sends it. A form is a "simple" request — no CORS preflight —
 * so the guard requires cookie-authenticated POSTs to use a non-simple
 * content type (application/json or application/graphql). Bearer / X-API-Key
 * callers are not cookie-authenticated and are left alone.
 *
 * The harness mirrors server.ts: formbody registered globally, the guard,
 * then mercurius with a context whose user stands in for the cookie session.
 */
import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import mercurius from 'mercurius';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { schema as graphqlSchema } from '../../src/graphql/schema.js';
import { resolvers as graphqlResolvers } from '../../src/graphql/resolvers.js';
import type { GraphQLContext } from '../../src/graphql/resolvers.js';
import { registerGraphqlCsrfGuard } from '../../src/graphql/csrf-guard.js';

const PASSWORD = 'Placeholder-Pass-2026!x';
const VALID_TOKEN = 'placeholder-valid-token';
const MUTATION = `mutation { createUser(username: "csrf-probe", password: "${PASSWORD}") { id } }`;

interface Ctx { readonly server: FastifyInstance; readonly storage: SqliteStorageAdapter; readonly cleanup: () => void }
let ctx: Ctx | undefined;
afterEach(() => { ctx?.cleanup(); ctx = undefined; });

async function setup(): Promise<Ctx> {
  const dbPath = join(tmpdir(), `test-graphql-csrf-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));
  // Stands in for AuthService.hasValidApiCredential: only VALID_TOKEN validates.
  registerGraphqlCsrfGuard(server, (request) => request.headers.authorization === `Bearer ${VALID_TOKEN}`
    || request.headers['x-api-key'] === VALID_TOKEN);
  await server.register(mercurius, {
    schema: graphqlSchema,
    resolvers: graphqlResolvers as Parameters<typeof mercurius>[1]['resolvers'],
    graphiql: false,
    context: (): GraphQLContext => ({
      storage,
      user: { id: 'admin-1', username: 'victim-admin', role: 'admin' },
      permissions: new Set(['users.create']),
      orgId: 'system',
      brandingOrchestrator: {} as GraphQLContext['brandingOrchestrator'],
    }),
  });
  await server.ready();
  return {
    server,
    storage,
    cleanup: () => {
      void storage.disconnect();
      if (existsSync(dbPath)) rmSync(dbPath);
      void server.close();
    },
  };
}

async function probeCreated(storage: SqliteStorageAdapter): Promise<boolean> {
  return (await storage.users.listUsers()).some((u) => u.username === 'csrf-probe');
}

describe('/graphql CSRF guard for cookie-authenticated POSTs', () => {
  it('refuses a form-encoded mutation (csrf)', async () => {
    ctx = await setup();
    const res = await ctx.server.inject({
      method: 'POST', url: '/graphql',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: `query=${encodeURIComponent(MUTATION)}`,
    });
    expect(res.statusCode).toBe(403);
    expect(await probeCreated(ctx.storage)).toBe(false);
  });

  it('refuses a text/plain mutation (csrf)', async () => {
    ctx = await setup();
    const res = await ctx.server.inject({
      method: 'POST', url: '/graphql',
      headers: { 'content-type': 'text/plain' },
      payload: JSON.stringify({ query: MUTATION }),
    });
    expect(res.statusCode).toBe(403);
    expect(await probeCreated(ctx.storage)).toBe(false);
  });

  it('accepts an application/json mutation (needs a CORS preflight cross-origin)', async () => {
    ctx = await setup();
    const res = await ctx.server.inject({
      method: 'POST', url: '/graphql',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      payload: JSON.stringify({ query: MUTATION }),
    });
    expect(res.statusCode).toBe(200);
    expect(await probeCreated(ctx.storage)).toBe(true);
  });

  it('leaves callers with a VALID Bearer API key untouched', async () => {
    ctx = await setup();
    const res = await ctx.server.inject({
      method: 'POST', url: '/graphql',
      headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Bearer ${VALID_TOKEN}` },
      payload: `query=${encodeURIComponent(MUTATION)}`,
    });
    expect(res.statusCode).not.toBe(403);
  });

  it('leaves callers with a VALID X-API-Key untouched', async () => {
    ctx = await setup();
    const res = await ctx.server.inject({
      method: 'POST', url: '/graphql',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-api-key': VALID_TOKEN },
      payload: `query=${encodeURIComponent(MUTATION)}`,
    });
    expect(res.statusCode).not.toBe(403);
  });

  it('refuses a form-encoded mutation carrying a BOGUS Bearer token (csrf)', async () => {
    ctx = await setup();
    const res = await ctx.server.inject({
      method: 'POST', url: '/graphql',
      headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Bearer bogus-token' },
      payload: `query=${encodeURIComponent(MUTATION)}`,
    });
    expect(res.statusCode).toBe(403);
    expect(await probeCreated(ctx.storage)).toBe(false);
  });

  it('refuses a form-encoded mutation carrying a BOGUS X-API-Key (csrf)', async () => {
    ctx = await setup();
    const res = await ctx.server.inject({
      method: 'POST', url: '/graphql',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-api-key': 'bogus-token' },
      payload: `query=${encodeURIComponent(MUTATION)}`,
    });
    expect(res.statusCode).toBe(403);
    expect(await probeCreated(ctx.storage)).toBe(false);
  });

  it('does not touch other paths', async () => {
    ctx = await setup();
    ctx.server.log.level = 'silent';
    const res = await ctx.server.inject({
      method: 'POST', url: '/graphql-not', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'a=1',
    });
    expect(res.statusCode).toBe(404);
  });
});
