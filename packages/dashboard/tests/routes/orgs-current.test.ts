/**
 * GET /orgs/current reports the organization the request acts in.
 *
 * Boots the REAL createServer and logs in through /login, so the request's organization is the one
 * the production request middleware resolves (a fresh session has no stored organization; the
 * middleware acts in the user's first organization). An org-scoped GraphQL read of the same session
 * is the independent witness of that organization: `scan` answers only for a scan of the org the
 * request acts in.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../src/server.js';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';

const PASSWORD = 'Current-Org-123!';

let tmpRoot: string;
let app: FastifyInstance;
let seed: SqliteStorageAdapter;
const scans: Record<string, string> = {};
const orgs: Record<string, string> = {};

const tokenOf = (html: string): string | undefined =>
  /name="csrf-token" content="([^"]+)"/.exec(html)?.[1] ?? /name="_csrf" value="([^"]+)"/.exec(html)?.[1];

async function freshLogin(username: string): Promise<string> {
  const loginPage = await app.inject({ method: 'GET', url: '/login' });
  const loginCookie = loginPage.cookies.find((c) => c.name === 'session')!.value;
  const login = await app.inject({
    method: 'POST', url: '/login', cookies: { session: loginCookie },
    headers: { 'x-csrf-token': tokenOf(loginPage.body)! },
    payload: { username, password: PASSWORD },
  });
  expect(login.statusCode).toBe(302);
  return login.cookies.find((c) => c.name === 'session')!.value;
}

async function seedOrgWithScan(name: string, slug: string, userId: string): Promise<void> {
  const org = await seed.organizations.createOrg({ name, slug: `${slug}-${randomUUID().slice(0, 8)}` });
  orgs[name] = org.id;
  const ownerRole = await seed.roles.getRoleByNameAndOrg('Owner', org.id);
  const team = await seed.teams.createTeam({ name: `${slug}-owners`, description: '', orgId: org.id, roleId: ownerRole!.id });
  await seed.teams.addTeamMember(team.id, userId);
  await seed.organizations.addMember(org.id, userId, 'owner');
  const scanId = `scan_${randomUUID().replace(/-/g, '')}`;
  scans[name] = scanId;
  await seed.scans.createScan({
    id: scanId, siteUrl: `https://${slug}.example/`, standard: 'WCAG2AA', jurisdictions: [], regulations: [],
    createdBy: 'seed', createdAt: new Date().toISOString(), orgId: org.id,
  });
}

beforeAll(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'luqen-orgs-current-'));
  const dbPath = join(tmpRoot, 'dashboard.db');
  app = (await createServer({
    dbPath, reportsDir: join(tmpRoot, 'reports'), sessionSecret: 'o'.repeat(32),
    catalogueUrl: '', catalogueCacheTtl: 0, redisUrl: '', maxConcurrentScans: 1,
  } as never)) as FastifyInstance;
  await app.ready();
  seed = new SqliteStorageAdapter(dbPath);
  await seed.migrate();
  const user = await seed.users.createUser('fabrikam-two-orgs', PASSWORD, 'user');
  // Created in this order, so Fabrikam is the user's first organization.
  await seedOrgWithScan('Fabrikam', 'fabrikam', user.id);
  await new Promise((r) => setTimeout(r, 5));
  await seedOrgWithScan('Northwind', 'northwind', user.id);
}, 120_000);

afterAll(async () => {
  if (seed !== undefined) await seed.disconnect();
  if (app !== undefined) await app.close();
  if (tmpRoot !== undefined) rmSync(tmpRoot, { recursive: true, force: true });
});

describe('GET /orgs/current', () => {
  it('orgs current reports the organization a fresh login acts in', async () => {
    const cookie = await freshLogin('fabrikam-two-orgs');

    const current = await app.inject({ method: 'GET', url: '/orgs/current', cookies: { session: cookie } });
    expect(current.statusCode).toBe(200);
    const body = current.json() as { currentOrgId: string | null; currentOrg: { id: string } | null; userOrgs: Array<{ id: string }> };
    expect(body.userOrgs.map((o) => o.id)).toEqual([orgs['Fabrikam'], orgs['Northwind']]);

    // The independent witness: the org-scoped GraphQL read answers in exactly one organization.
    const scanOrg = async (name: string): Promise<string | null> => {
      const res = await app.inject({
        method: 'POST', url: '/graphql', cookies: { session: cookie },
        headers: { 'content-type': 'application/json' },
        payload: { query: 'query Q($id: ID!) { scan(id: $id) { orgId } }', variables: { id: scans[name] } },
      });
      expect(res.statusCode, name).toBe(200);
      return (res.json() as { data?: { scan?: { orgId?: string } | null } }).data?.scan?.orgId ?? null;
    };
    const actsIn = [await scanOrg('Fabrikam'), await scanOrg('Northwind')].filter((v) => v !== null);
    expect(actsIn).toEqual([orgs['Fabrikam']]);

    expect(body.currentOrgId).toBe(actsIn[0]);
    expect(body.currentOrg?.id).toBe(actsIn[0]);
  }, 60_000);
});
