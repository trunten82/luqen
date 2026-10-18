/**
 * Real-server MCP harness: boots the REAL createServer on 127.0.0.1 with its own JWKS endpoint, so a
 * test can drive the dashboard the way an MCP client does — password session, org switch, real
 * routes, the real OAuth flow (register -> authorize with PKCE S256 -> consent -> token) and MCP
 * JSON-RPC over /api/v1/mcp verified against the server's own signing keys.
 *
 * The MCP verifier fetches its keys over HTTP from DASHBOARD_JWKS_URI, so the harness picks a free
 * port, points DASHBOARD_JWKS_URI and DASHBOARD_PUBLIC_URL at it BEFORE createServer reads them,
 * listens there, and restores both variables on close. A second SqliteStorageAdapter on the same file
 * seeds rows and reads them back.
 *
 * Every step returns its status and body, so a test can say why a chain stopped.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createNetServer } from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { createServer } from '../../src/server.js';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';

/** A browser's view of a password session: the session cookie and the page CSRF token. */
export interface HarnessSession {
  readonly cookie: string;
  readonly csrf: string;
}

/** What one step of a chain produced. */
export interface StepResult {
  readonly step: string;
  readonly status: number;
  readonly body: string;
  readonly location?: string;
  readonly session: HarnessSession;
}

export interface TokenResult {
  readonly steps: readonly { readonly step: string; readonly status: number }[];
  readonly token?: string;
}

export interface McpCallResult {
  readonly status: number;
  readonly isError: boolean;
  readonly text: string;
}

export interface McpOauthHarness {
  readonly app: FastifyInstance;
  readonly seed: SqliteStorageAdapter;
  readonly publicUrl: string;
  login(username: string, password: string): Promise<StepResult>;
  switchOrg(session: HarnessSession, orgId: string): Promise<StepResult>;
  postForm(session: HarnessSession, url: string, fields: Record<string, string | readonly string[]>): Promise<StepResult>;
  mintToken(session: HarnessSession, scopes: readonly string[]): Promise<TokenResult>;
  callTool(token: string, name: string, args: Record<string, unknown>): Promise<McpCallResult>;
  close(): Promise<void>;
}

const REDIRECT_URI = 'https://mcp-client.example/callback';

const tokenOf = (html: string): string | undefined =>
  /name="csrf-token" content="([^"]+)"/.exec(html)?.[1] ?? /name="_csrf" value="([^"]+)"/.exec(html)?.[1];

const s256 = (verifier: string): string => createHash('sha256').update(verifier).digest('base64url');

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

function nextSession(res: LightMyRequestResponse, prior: HarnessSession): HarnessSession {
  const cookie = res.cookies.find((c) => c.name === 'session')?.value ?? prior.cookie;
  return { cookie, csrf: tokenOf(res.body) ?? prior.csrf };
}

function stepOf(step: string, res: LightMyRequestResponse, prior: HarnessSession): StepResult {
  const location = typeof res.headers.location === 'string' ? res.headers.location : undefined;
  return { step, status: res.statusCode, body: res.body, session: nextSession(res, prior), ...(location !== undefined ? { location } : {}) };
}

function formBody(fields: Record<string, string | readonly string[]>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    for (const v of typeof value === 'string' ? [value] : value) params.append(key, v);
  }
  return params.toString();
}

function parseRpc(body: string): Record<string, unknown> {
  const trimmed = body.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed) as Record<string, unknown>;
  const dataLine = trimmed.split('\n').map((l) => l.trim()).find((l) => l.startsWith('data:'));
  return dataLine === undefined ? {} : (JSON.parse(dataLine.slice('data:'.length).trim()) as Record<string, unknown>);
}

/** Boot the real server on a free 127.0.0.1 port. Call close() in afterAll. */
export async function startMcpOauthHarness(tag: string): Promise<McpOauthHarness> {
  const priorPublicUrl = process.env['DASHBOARD_PUBLIC_URL'];
  const priorJwksUri = process.env['DASHBOARD_JWKS_URI'];
  const restoreEnv = (): void => {
    if (priorPublicUrl === undefined) delete process.env['DASHBOARD_PUBLIC_URL'];
    else process.env['DASHBOARD_PUBLIC_URL'] = priorPublicUrl;
    if (priorJwksUri === undefined) delete process.env['DASHBOARD_JWKS_URI'];
    else process.env['DASHBOARD_JWKS_URI'] = priorJwksUri;
  };
  const port = await freePort();
  const publicUrl = `http://127.0.0.1:${port}`;
  process.env['DASHBOARD_PUBLIC_URL'] = publicUrl;
  process.env['DASHBOARD_JWKS_URI'] = `${publicUrl}/oauth/jwks.json`;
  const tmpRoot = mkdtempSync(join(tmpdir(), `luqen-mcp-oauth-${tag}-`));
  const dbPath = join(tmpRoot, 'dashboard.db');
  let app: FastifyInstance | undefined;
  let seed: SqliteStorageAdapter | undefined;
  const close = async (): Promise<void> => {
    if (seed !== undefined) await seed.disconnect();
    if (app !== undefined) await app.close();
    rmSync(tmpRoot, { recursive: true, force: true });
    restoreEnv();
  };
  try {
    app = (await createServer({
      dbPath, reportsDir: join(tmpRoot, 'reports'), sessionSecret: 'm'.repeat(32),
      catalogueUrl: '', catalogueCacheTtl: 0, redisUrl: '', maxConcurrentScans: 1,
    } as never)) as FastifyInstance;
    await app.listen({ host: '127.0.0.1', port });
    seed = new SqliteStorageAdapter(dbPath);
    await seed.migrate();
  } catch (err) {
    await close();
    throw err;
  }
  const server = app;
  const resource = `${publicUrl}/api/v1/mcp`;
  let clientId: string | undefined;

  const login = async (username: string, password: string): Promise<StepResult> => {
    const page = await server.inject({ method: 'GET', url: '/login' });
    const first: HarnessSession = { cookie: page.cookies.find((c) => c.name === 'session')?.value ?? '', csrf: tokenOf(page.body) ?? '' };
    const res = await server.inject({
      method: 'POST', url: '/login', cookies: { session: first.cookie },
      headers: { 'x-csrf-token': first.csrf }, payload: { username, password },
    });
    const loggedIn = stepOf('login', res, first);
    // A page token issued for the authenticated session (the login page token belongs to the anonymous one).
    const home = await server.inject({ method: 'GET', url: '/admin/teams', cookies: { session: loggedIn.session.cookie } });
    return { ...loggedIn, session: nextSession(home, loggedIn.session) };
  };

  const postForm = async (
    session: HarnessSession, url: string, fields: Record<string, string | readonly string[]>,
  ): Promise<StepResult> => {
    const res = await server.inject({
      method: 'POST', url, cookies: { session: session.cookie },
      headers: { 'x-csrf-token': session.csrf, 'content-type': 'application/x-www-form-urlencoded' },
      payload: formBody(fields),
    });
    return stepOf(`POST ${url}`, res, session);
  };

  const switchOrg = async (session: HarnessSession, orgId: string): Promise<StepResult> =>
    await postForm(session, '/orgs/switch', { orgId });

  const registerClient = async (): Promise<string | undefined> => {
    if (clientId !== undefined) return clientId;
    const res = await server.inject({
      method: 'POST', url: '/oauth/register',
      payload: {
        client_name: `harness-${tag}`, redirect_uris: [REDIRECT_URI],
        grant_types: ['authorization_code', 'refresh_token'], token_endpoint_auth_method: 'none', scope: 'read write',
      },
    });
    if (res.statusCode !== 201) return undefined;
    clientId = (res.json() as { client_id: string }).client_id;
    return clientId;
  };

  const mintToken = async (session: HarnessSession, scopes: readonly string[]): Promise<TokenResult> => {
    const steps: Array<{ step: string; status: number }> = [];
    const id = await registerClient();
    steps.push({ step: 'register', status: id === undefined ? 0 : 201 });
    if (id === undefined) return { steps };
    const verifier = randomBytes(32).toString('base64url');
    const scope = scopes.join(' ');
    const query = new URLSearchParams({
      response_type: 'code', client_id: id, redirect_uri: REDIRECT_URI, scope, resource,
      code_challenge: s256(verifier), code_challenge_method: 'S256', state: 'harness',
    });
    const authorize = await server.inject({ method: 'GET', url: `/oauth/authorize?${query.toString()}`, cookies: { session: session.cookie } });
    steps.push({ step: 'authorize', status: authorize.statusCode });
    let location = typeof authorize.headers.location === 'string' ? authorize.headers.location : undefined;
    if (location === undefined) {
      const consentSession = nextSession(authorize, session);
      const pageToken = tokenOf(authorize.body);
      if (authorize.statusCode !== 200 || pageToken === undefined) return { steps };
      const consent = await server.inject({
        method: 'POST', url: '/oauth/authorize/consent', cookies: { session: consentSession.cookie },
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: formBody({
          _csrf: pageToken, client_id: id, redirect_uri: REDIRECT_URI, scope, resource, state: 'harness',
          code_challenge: s256(verifier), code_challenge_method: 'S256', approved: 'true',
        }),
      });
      steps.push({ step: 'consent', status: consent.statusCode });
      location = typeof consent.headers.location === 'string' ? consent.headers.location : undefined;
    }
    const code = location !== undefined && location.startsWith(REDIRECT_URI) ? new URL(location).searchParams.get('code') : null;
    if (code === null) return { steps };
    const token = await server.inject({
      method: 'POST', url: '/oauth/token', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: formBody({ grant_type: 'authorization_code', client_id: id, code, code_verifier: verifier, redirect_uri: REDIRECT_URI }),
    });
    steps.push({ step: 'token', status: token.statusCode });
    if (token.statusCode !== 200) return { steps };
    return { steps, token: (token.json() as { access_token: string }).access_token };
  };

  const callTool = async (token: string, name: string, args: Record<string, unknown>): Promise<McpCallResult> => {
    const res = await server.inject({
      method: 'POST', url: '/api/v1/mcp',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
    });
    const parsed = res.statusCode === 200 ? parseRpc(res.body) : {};
    const result = parsed['result'] as { isError?: boolean; content?: Array<{ text?: string }> } | undefined;
    const rpcError = parsed['error'] as { message?: string } | undefined;
    return {
      status: res.statusCode,
      isError: result === undefined || result.isError === true,
      text: result?.content?.[0]?.text ?? rpcError?.message ?? res.body.slice(0, 200),
    };
  };

  return { app: server, seed: seed!, publicUrl, login, switchOrg, postForm, mintToken, callTool, close };
}
