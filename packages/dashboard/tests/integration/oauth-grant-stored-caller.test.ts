/**
 * HARD-21 end to end: the token endpoint mints MCP access only for a user the MCP endpoint would
 * serve right now. The refresh grant and the authorization-code exchange ask the same rule as
 * /api/v1/mcp (src/auth/stored-caller.ts resolveMcpCaller): a missing or deactivated user, a user who
 * left the token's organization, or a user without the MCP use permission there gets
 * 400 invalid_grant, and nothing is written.
 *
 * Boots the REAL createServer (tests/helpers/mcp-oauth-harness.ts). The authorization code comes from
 * the real consent flow; the exchange and every refresh are direct POST /oauth/token requests.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { startMcpOauthHarness, type McpOauthHarness } from '../helpers/mcp-oauth-harness.js';

const PASSWORD = 'Fabrikam-Grant-42!';
const REDIRECT_URI = 'https://mcp-client.example/callback';

let h: McpOauthHarness;

interface SeededReader {
  readonly orgId: string;
  readonly userId: string;
  readonly username: string;
  readonly roleId: string;
  readonly teamId: string;
}

interface TokenAnswer {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

interface ChainRow {
  readonly id: string;
  readonly rotated: number;
}

/** A fresh org and a member with global role 'viewer' whose org role grants mcp.use and reports.view. */
async function seedReader(tag: string): Promise<SeededReader> {
  const org = await h.seed.organizations.createOrg({ name: `Fabrikam ${tag}`, slug: `fabrikam-gr-${tag}` });
  const username = `fabrikam-grant-${tag}`;
  const user = await h.seed.users.createUser(username, PASSWORD, 'viewer');
  const role = await h.seed.roles.createRole({
    name: `fabrikam-${tag}-mcp`, description: '', permissions: ['mcp.use', 'reports.view'], orgId: org.id,
  });
  const team = await h.seed.teams.createTeam({ name: `fabrikam-${tag}-team`, description: '', orgId: org.id, roleId: role.id });
  await h.seed.teams.addTeamMember(team.id, user.id);
  await h.seed.organizations.addMember(org.id, user.id, 'member');
  return { orgId: org.id, userId: user.id, username, roleId: role.id, teamId: team.id };
}

function formBody(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

async function postToken(fields: Record<string, string>): Promise<TokenAnswer> {
  const res = await h.app.inject({
    method: 'POST', url: '/oauth/token',
    headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: formBody(fields),
  });
  let body: Record<string, unknown> = {};
  try {
    body = res.json() as Record<string, unknown>;
  } catch {
    body = { raw: res.body.slice(0, 200) };
  }
  return { status: res.statusCode, body };
}

/** Sign in, switch to the reader's org, authorize and consent; returns the code (not yet exchanged). */
async function codeFor(reader: SeededReader, trail: string[]): Promise<{ code: string; verifier: string; clientId: string } | undefined> {
  const clientId = await h.clientId();
  const login = await h.login(reader.username, PASSWORD);
  trail.push(`login=${login.status}`);
  const switched = await h.switchOrg(login.session, reader.orgId);
  trail.push(`switch=${switched.status}`);
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const resource = `${h.publicUrl}/api/v1/mcp`;
  const query = new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: REDIRECT_URI, scope: 'read', resource,
    code_challenge: challenge, code_challenge_method: 'S256', state: 'grant',
  });
  const authorize = await h.app.inject({ method: 'GET', url: `/oauth/authorize?${query.toString()}`, cookies: { session: switched.session.cookie } });
  trail.push(`authorize=${authorize.statusCode}`);
  let location = typeof authorize.headers.location === 'string' ? authorize.headers.location : undefined;
  if (location === undefined) {
    const pageToken = /name="_csrf" value="([^"]+)"/.exec(authorize.body)?.[1];
    const binding = /name="consent_binding"\s+value="([^"]+)"/.exec(authorize.body)?.[1];
    const cookie = authorize.cookies.find((c) => c.name === 'session')?.value ?? switched.session.cookie;
    if (authorize.statusCode !== 200 || pageToken === undefined) return undefined;
    const consent = await h.app.inject({
      method: 'POST', url: '/oauth/authorize/consent', cookies: { session: cookie },
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: formBody({
        _csrf: pageToken, client_id: clientId, redirect_uri: REDIRECT_URI, scope: 'read', resource, state: 'grant',
        code_challenge: challenge, code_challenge_method: 'S256', approved: 'true',
        ...(binding !== undefined ? { consent_binding: binding } : {}),
      }),
    });
    trail.push(`consent=${consent.statusCode}`);
    location = typeof consent.headers.location === 'string' ? consent.headers.location : undefined;
  }
  const code = location !== undefined && location.startsWith(REDIRECT_URI) ? new URL(location).searchParams.get('code') : null;
  return code === null ? undefined : { code, verifier, clientId };
}

async function exchange(grant: { code: string; verifier: string; clientId: string }): Promise<TokenAnswer> {
  return await postToken({
    grant_type: 'authorization_code', client_id: grant.clientId, code: grant.code,
    code_verifier: grant.verifier, redirect_uri: REDIRECT_URI,
  });
}

/** Consent and exchange; returns the first refresh token of a new chain. */
async function refreshTokenFor(reader: SeededReader, trail: string[]): Promise<{ refreshToken: string; clientId: string } | undefined> {
  const grant = await codeFor(reader, trail);
  if (grant === undefined) return undefined;
  const exchanged = await exchange(grant);
  trail.push(`exchange=${exchanged.status}`);
  const refreshToken = exchanged.body['refresh_token'];
  return exchanged.status === 200 && typeof refreshToken === 'string' ? { refreshToken, clientId: grant.clientId } : undefined;
}

async function refresh(chain: { refreshToken: string; clientId: string }): Promise<TokenAnswer> {
  return await postToken({ grant_type: 'refresh_token', client_id: chain.clientId, refresh_token: chain.refreshToken });
}

function chainRows(userId: string): ChainRow[] {
  return h.seed.getRawDatabase()
    .prepare('SELECT id, rotated FROM oauth_refresh_tokens WHERE user_id = ? ORDER BY id')
    .all(userId) as ChainRow[];
}

function codeRows(userId: string): number {
  return (h.seed.getRawDatabase()
    .prepare('SELECT COUNT(*) AS n FROM oauth_authorization_codes WHERE user_id = ?')
    .get(userId) as { n: number }).n;
}

function dropPermission(roleId: string, permission: string): number {
  return h.seed.getRawDatabase()
    .prepare('DELETE FROM role_permissions WHERE role_id = ? AND permission = ?')
    .run(roleId, permission).changes;
}

/** The refusal shape every token-endpoint refusal shares: 400, `{ error: 'invalid_grant' }`, no token. */
function expectRefused(answer: TokenAnswer, trail: string): void {
  expect(answer.status, trail).toBe(400);
  expect(answer.body, trail).toEqual({ error: 'invalid_grant' });
  expect(answer.body['access_token'], trail).toBeUndefined();
}

beforeAll(async () => {
  h = await startMcpOauthHarness('grant');
}, 120_000);

afterAll(async () => {
  if (h !== undefined) await h.close();
});

describe('HARD-21 the token endpoint mints only for a user the MCP endpoint would serve', () => {
  it('HARD-21 refresh refuses a deactivated user and works again after reactivation', async () => {
    const reader = await seedReader('t2');
    const trail: string[] = [];
    const chain = await refreshTokenFor(reader, trail);
    expect(chain, trail.join(' ')).toBeDefined(); // positive control: the chain exists
    const before = chainRows(reader.userId);
    trail.push(`rows-before=${JSON.stringify(before)}`);

    await h.seed.users.deactivateUser(reader.userId);
    const refused = await refresh(chain!);
    const after = chainRows(reader.userId);
    trail.push(`refused=${refused.status}/${JSON.stringify(refused.body).slice(0, 80)} rows-after=${JSON.stringify(after)}`);
    expectRefused(refused, trail.join(' '));
    expect(after, trail.join(' ')).toEqual(before);

    await h.seed.users.activateUser(reader.userId);
    const again = await refresh(chain!);
    trail.push(`again=${again.status}`);
    expect(again.status, trail.join(' ')).toBe(200);
    expect(typeof again.body['access_token'], trail.join(' ')).toBe('string');
  }, 60_000);

  it('HARD-21 refresh refuses a deleted user', async () => {
    const reader = await seedReader('t3');
    const trail: string[] = [];
    const chain = await refreshTokenFor(reader, trail);
    expect(chain, trail.join(' ')).toBeDefined();

    expect(await h.seed.users.deleteUser(reader.userId), trail.join(' ')).toBe(true);
    const refused = await refresh(chain!);
    trail.push(`refused=${refused.status}/${JSON.stringify(refused.body).slice(0, 80)}`);
    expectRefused(refused, trail.join(' '));
  }, 60_000);

  it('HARD-21 refresh refuses a user who left the token organization', async () => {
    const reader = await seedReader('t4');
    const trail: string[] = [];
    const chain = await refreshTokenFor(reader, trail);
    expect(chain, trail.join(' ')).toBeDefined();
    const before = chainRows(reader.userId);

    await h.seed.teams.removeTeamMember(reader.teamId, reader.userId);
    await h.seed.organizations.removeMember(reader.orgId, reader.userId);
    const refused = await refresh(chain!);
    const after = chainRows(reader.userId);
    trail.push(`refused=${refused.status}/${JSON.stringify(refused.body).slice(0, 80)} rows-after=${JSON.stringify(after)}`);
    expectRefused(refused, trail.join(' '));
    expect(after, trail.join(' ')).toEqual(before);
  }, 60_000);

  it('HARD-21 refresh refuses a user without the MCP use permission', async () => {
    const reader = await seedReader('t5');
    const trail: string[] = [];
    const chain = await refreshTokenFor(reader, trail);
    expect(chain, trail.join(' ')).toBeDefined();
    const before = chainRows(reader.userId);

    expect(dropPermission(reader.roleId, 'mcp.use'), trail.join(' ')).toBe(1);
    const refused = await refresh(chain!);
    const after = chainRows(reader.userId);
    trail.push(`refused=${refused.status}/${JSON.stringify(refused.body).slice(0, 80)} rows-after=${JSON.stringify(after)}`);
    expectRefused(refused, trail.join(' '));
    expect(after, trail.join(' ')).toEqual(before);
  }, 60_000);

  it('HARD-21 the code exchange refuses a user deactivated after consent', async () => {
    const reader = await seedReader('t6');
    const trail: string[] = [];
    const grant = await codeFor(reader, trail);
    expect(grant, trail.join(' ')).toBeDefined(); // positive control: consent wrote a code
    expect(codeRows(reader.userId), trail.join(' ')).toBe(1);

    await h.seed.users.deactivateUser(reader.userId);
    const refused = await exchange(grant!);
    trail.push(`refused=${refused.status}/${JSON.stringify(refused.body).slice(0, 80)} chain=${JSON.stringify(chainRows(reader.userId))}`);
    expectRefused(refused, trail.join(' '));
    expect(refused.body['refresh_token'], trail.join(' ')).toBeUndefined();
    expect(chainRows(reader.userId), trail.join(' ')).toEqual([]);
  }, 60_000);

  it('HARD-21 refresh answers for an active member holding the MCP use permission', async () => {
    const reader = await seedReader('t7');
    const trail: string[] = [];
    const chain = await refreshTokenFor(reader, trail);
    expect(chain, trail.join(' ')).toBeDefined();

    const answered = await refresh(chain!);
    const rows = chainRows(reader.userId);
    trail.push(`answered=${answered.status} rows=${JSON.stringify(rows)}`);
    expect(answered.status, trail.join(' ')).toBe(200);
    expect(typeof answered.body['access_token'], trail.join(' ')).toBe('string');
    expect(typeof answered.body['refresh_token'], trail.join(' ')).toBe('string');
    // The chain rotated: the presented row is marked rotated and a child row was added.
    expect(rows.length, trail.join(' ')).toBe(2);
    expect(rows.filter((r) => r.rotated === 1).length, trail.join(' ')).toBe(1);
  }, 60_000);
});

function reuseAudits(): number {
  return (h.seed.getRawDatabase()
    .prepare("SELECT COUNT(*) AS n FROM agent_audit_log WHERE tool_name = 'oauth.refresh_reuse_detected'")
    .get() as { n: number }).n;
}

describe('HARD-21 a refresh token answers only the client it was issued to', () => {
  it('HARD-21 a refresh token presented by another client leaves its owner chain usable', async () => {
    const reader = await seedReader('rw1');
    const trail: string[] = [];
    const chain = await refreshTokenFor(reader, trail);
    expect(chain, trail.join(' ')).toBeDefined(); // positive control: the chain exists
    const other = await h.newClient('rw1-other');
    const before = chainRows(reader.userId);
    trail.push(`rows-before=${JSON.stringify(before)}`);
    expect(before.length, trail.join(' ')).toBe(1);

    const refused = await postToken({ grant_type: 'refresh_token', client_id: other, refresh_token: chain!.refreshToken });
    const after = chainRows(reader.userId);
    trail.push(`refused=${refused.status}/${JSON.stringify(refused.body).slice(0, 80)} rows-after=${JSON.stringify(after)} reuse=${reuseAudits()}`);
    expectRefused(refused, trail.join(' '));
    expect(after, trail.join(' ')).toEqual(before);
    expect(reuseAudits(), trail.join(' ')).toBe(0);

    const owner = await refresh(chain!);
    trail.push(`owner=${owner.status}`);
    expect(owner.status, trail.join(' ')).toBe(200);
  }, 60_000);

  it('HARD-21 a rotated refresh token presented by another client leaves its owner chain usable', async () => {
    const reader = await seedReader('rw2');
    const trail: string[] = [];
    const chain = await refreshTokenFor(reader, trail);
    expect(chain, trail.join(' ')).toBeDefined();
    const first = await refresh(chain!);
    trail.push(`owner-first=${first.status}`);
    expect(first.status, trail.join(' ')).toBe(200); // positive control: the first token is now rotated
    const current = first.body['refresh_token'];
    expect(typeof current, trail.join(' ')).toBe('string');
    const other = await h.newClient('rw2-other');
    const before = chainRows(reader.userId);
    trail.push(`rows-before=${JSON.stringify(before)}`);
    expect(before.length, trail.join(' ')).toBe(2);

    const refused = await postToken({ grant_type: 'refresh_token', client_id: other, refresh_token: chain!.refreshToken });
    const after = chainRows(reader.userId);
    trail.push(`refused=${refused.status}/${JSON.stringify(refused.body).slice(0, 80)} rows-after=${JSON.stringify(after)} reuse=${reuseAudits()}`);
    expectRefused(refused, trail.join(' '));
    expect(after, trail.join(' ')).toEqual(before);
    expect(reuseAudits(), trail.join(' ')).toBe(0);

    const owner = await refresh({ refreshToken: current as string, clientId: chain!.clientId });
    trail.push(`owner=${owner.status}`);
    expect(owner.status, trail.join(' ')).toBe(200);
  }, 60_000);
});

describe('HARD-21 a refused code exchange', () => {
  it('HARD-21 a refused code exchange consumes its code', async () => {
    const reader = await seedReader('cx1');
    const trail: string[] = [];
    const grant = await codeFor(reader, trail);
    expect(grant, trail.join(' ')).toBeDefined(); // positive control: consent wrote a code
    expect(codeRows(reader.userId), trail.join(' ')).toBe(1);

    await h.seed.users.deactivateUser(reader.userId);
    const refused = await exchange(grant!);
    trail.push(`refused=${refused.status}/${JSON.stringify(refused.body).slice(0, 80)} codes=${codeRows(reader.userId)}`);
    expectRefused(refused, trail.join(' '));
    expect(codeRows(reader.userId), trail.join(' ')).toBe(0);

    await h.seed.users.activateUser(reader.userId);
    const again = await exchange(grant!);
    trail.push(`again=${again.status}/${JSON.stringify(again.body).slice(0, 80)} chain=${JSON.stringify(chainRows(reader.userId))}`);
    expectRefused(again, trail.join(' '));
    expect(chainRows(reader.userId), trail.join(' ')).toEqual([]);
  }, 60_000);
});
