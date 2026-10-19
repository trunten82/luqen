/**
 * HARD-18: every path that deletes a scan follows the one delete rule (src/services/scan-delete-access.ts):
 * the caller holds reports.delete or is the signed-in user who started the scan (never an API key), and the
 * scan belongs to the caller's current organization ('system' for a caller outside every organization),
 * unless the caller is a global administrator.
 *
 * Boots the REAL createServer (tests/helpers/mcp-oauth-harness.ts) and drives the REST delete
 * (DELETE /api/v1/scans/:id), GraphQL deleteScan and the report page delete (DELETE /reports/:id) with
 * password sessions and API keys. Every assertion reads the stored scan back, never only the response.
 * Organization names, user names and site hosts are placeholders (Fabrikam / Northwind, *.example).
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateApiKey } from '../../src/auth/api-key.js';
import { DASHBOARD_TOOL_METADATA } from '../../src/mcp/metadata.js';
import { startMcpOauthHarness, type HarnessSession, type McpOauthHarness } from '../helpers/mcp-oauth-harness.js';
import { isCommentLine, readSources } from '../helpers/source-walk.js';

const PASSWORD = 'Fabrikam-Delete-42!';
const SRC = join(__dirname, '..', '..', 'src');
const OWNER = 'fabrikam-delete-owner';
const MEMBER = 'fabrikam-delete-member';
const SOLO = 'solo-delete-user';
const GLOBAL_ADMIN = 'delete-global-admin';
const NORTHWIND_OWNER = 'northwind-delete-owner';

let h: McpOauthHarness;
let fabrikamId: string;
let northwindId: string;
let orgAdminKey: string;
let readOnlyKey: string;
const sessions = new Map<string, HarnessSession>();
/** Files that a stored report path may name but that sit outside the reports directory (removed in afterAll). */
let outsideDir: string;

/** A caller: a password session (by user name) or an API key. */
type Credential = { readonly session: string } | { readonly key: string };

const tokenOf = (html: string): string | undefined => /name="csrf-token" content="([^"]+)"/.exec(html)?.[1];

async function addOrgUser(orgId: string, username: string, globalRole: string, orgRole: string, membership: string): Promise<void> {
  const user = await h.seed.users.createUser(username, PASSWORD, globalRole);
  const role = await h.seed.roles.getRoleByNameAndOrg(orgRole, orgId);
  const team = await h.seed.teams.createTeam({ name: `${username}-team`, description: '', orgId, roleId: role!.id });
  await h.seed.teams.addTeamMember(team.id, user.id);
  await h.seed.organizations.addMember(orgId, user.id, membership);
}

async function seedScan(orgId: string, createdBy: string): Promise<string> {
  const id = randomUUID();
  await h.seed.scans.createScan({
    id, siteUrl: 'https://fabrikam.example', standard: 'WCAG2AA', jurisdictions: [],
    createdBy, createdAt: new Date().toISOString(), orgId,
  });
  return id;
}

const scanExists = async (id: string): Promise<boolean> => (await h.seed.scans.getScan(id)) !== null;

/**
 * A scan whose stored report file exists on disk, in the server's reports directory unless `dir` names
 * another one; returns the scan id and the file path.
 */
async function seedScanWithReportFile(orgId: string, createdBy: string, dir?: string): Promise<{ id: string; file: string }> {
  const id = await seedScan(orgId, createdBy);
  const file = join(dir ?? h.reportsDir, `${id}.json`);
  writeFileSync(file, '{"pages":[]}');
  await h.seed.scans.updateScan(id, { jsonReportPath: file });
  return { id, file };
}

/** A scan whose stored report path names a directory, which unlink cannot remove. */
async function seedScanWithUnremovableReport(orgId: string, createdBy: string): Promise<{ id: string; file: string }> {
  const id = await seedScan(orgId, createdBy);
  const file = join(h.reportsDir, `${id}.json`);
  mkdirSync(file);
  await h.seed.scans.updateScan(id, { jsonReportPath: file });
  return { id, file };
}

/** REST status/body, GraphQL answer and page status of one delete each, for three scans. */
async function deleteThroughEveryPath(ids: readonly [string, string, string]): Promise<{ rest: string; graphql: string; page: string }> {
  const { headers, cookies } = await headersOf({ session: MEMBER });
  const rest = await h.app.inject({ method: 'DELETE', url: `/api/v1/scans/${ids[0]}`, headers, cookies });
  const graphql = await graphqlDelete({ session: MEMBER }, ids[1]);
  const page = await h.app.inject({ method: 'DELETE', url: `/reports/${ids[2]}`, headers, cookies });
  return { rest: `${rest.statusCode}:${rest.body}`, graphql, page: `${page.statusCode}:${page.body}` };
}

/** A browser's session after sign-in: the cookie and the page token of an authenticated page. */
async function sessionOf(username: string): Promise<HarnessSession> {
  const cached = sessions.get(username);
  if (cached !== undefined) return cached;
  const login = await h.login(username, PASSWORD);
  expect(login.status, `login ${username}`).toBe(302);
  const page = await h.app.inject({ method: 'GET', url: '/reports', cookies: { session: login.session.cookie } });
  const cookie = page.cookies.find((c) => c.name === 'session')?.value ?? login.session.cookie;
  const session = { cookie, csrf: tokenOf(page.body) ?? login.session.csrf };
  sessions.set(username, session);
  return session;
}

async function headersOf(cred: Credential): Promise<{ headers: Record<string, string>; cookies: Record<string, string> }> {
  if ('key' in cred) return { headers: { 'x-api-key': cred.key }, cookies: {} };
  const s = await sessionOf(cred.session);
  return { headers: { 'x-csrf-token': s.csrf }, cookies: { session: s.cookie } };
}

/** DELETE /api/v1/scans/:id; returns the status. */
async function restDelete(cred: Credential, id: string): Promise<number> {
  const { headers, cookies } = await headersOf(cred);
  return (await h.app.inject({ method: 'DELETE', url: `/api/v1/scans/${id}`, headers, cookies })).statusCode;
}

/** GraphQL deleteScan; returns the status and the first error message (or 'deleted'). */
async function graphqlDelete(cred: Credential, id: string): Promise<string> {
  const { headers, cookies } = await headersOf(cred);
  const res = await h.app.inject({
    method: 'POST', url: '/graphql', cookies,
    headers: { ...headers, 'content-type': 'application/json' },
    payload: { query: 'mutation Del($id: ID!) { deleteScan(id: $id) }', variables: { id } },
  });
  let body: { data?: { deleteScan?: boolean } | null; errors?: Array<{ message?: string }> } = {};
  try {
    body = res.json() as typeof body;
  } catch {
    body = {};
  }
  return `${res.statusCode}:${body.data?.deleteScan === true ? 'deleted' : body.errors?.[0]?.message ?? 'no-answer'}`;
}

/** DELETE /reports/:id; returns the status. */
async function pageDelete(cred: Credential, id: string): Promise<number> {
  const { headers, cookies } = await headersOf(cred);
  return (await h.app.inject({ method: 'DELETE', url: `/reports/${id}`, headers, cookies })).statusCode;
}

beforeAll(async () => {
  outsideDir = mkdtempSync(join(tmpdir(), 'luqen-scan-delete-outside-'));
  h = await startMcpOauthHarness('scan-delete');
  fabrikamId = (await h.seed.organizations.createOrg({ name: 'Fabrikam Delete', slug: 'fabrikam-delete' })).id;
  northwindId = (await h.seed.organizations.createOrg({ name: 'Northwind Delete', slug: 'northwind-delete' })).id;
  await addOrgUser(fabrikamId, OWNER, 'user', 'Owner', 'owner');
  // The global role 'executive' holds no reports.delete, so this Member holds none in Fabrikam.
  await addOrgUser(fabrikamId, MEMBER, 'executive', 'Member', 'member');
  await h.seed.users.createUser(SOLO, PASSWORD, 'user');
  await h.seed.users.createUser(GLOBAL_ADMIN, PASSWORD, 'admin');
  orgAdminKey = generateApiKey();
  await h.seed.apiKeys.storeKey(orgAdminKey, 'fabrikam-delete-admin-key', fabrikamId, 'admin');
  readOnlyKey = generateApiKey();
  await h.seed.apiKeys.storeKey(readOnlyKey, 'delete-read-only-key', 'system', 'read-only');
}, 120_000);

afterAll(async () => {
  if (h !== undefined) await h.close();
  if (outsideDir !== undefined) rmSync(outsideDir, { recursive: true, force: true });
});

describe('HARD-18 scan delete paths', () => {
  it('HARD-18 the api delete refuses a member who neither holds reports delete nor started the scan', async () => {
    const id = await seedScan(fabrikamId, OWNER);
    const status = await restDelete({ session: MEMBER }, id);
    expect(status).toBe(403);
    expect(await scanExists(id)).toBe(true);
  }, 60_000);

  it('HARD-18 the api delete lets the signed in user who started the scan delete it', async () => {
    const id = await seedScan(fabrikamId, MEMBER);
    const status = await restDelete({ session: MEMBER }, id);
    expect(status).toBe(200);
    expect(await scanExists(id)).toBe(false);
  }, 60_000);

  it('HARD-18 an organization admin api key deletes a scan of its organization through the api', async () => {
    const id = await seedScan(fabrikamId, OWNER);
    expect(await restDelete({ key: orgAdminKey }, id)).toBe(200);
    expect(await scanExists(id)).toBe(false);
    // An organization key works on the /api endpoints only: GraphQL and the report page refuse it.
    const other = await seedScan(fabrikamId, OWNER);
    const trail = [`graphql=${await graphqlDelete({ key: orgAdminKey }, other)}`, `page=${await pageDelete({ key: orgAdminKey }, other)}`];
    expect(trail).toEqual(['graphql=403:no-answer', 'page=403']);
    expect(await scanExists(other)).toBe(true);
  }, 60_000);

  it('HARD-18 a read only api key deletes no scan through any path', async () => {
    // A scan recorded as started by 'api-key', the user name every key signs in under.
    const id = await seedScan('system', 'api-key');
    const trail = [
      `rest=${await restDelete({ key: readOnlyKey }, id)}`,
      `graphql=${await graphqlDelete({ key: readOnlyKey }, id)}`,
      `page=${await pageDelete({ key: readOnlyKey }, id)}`,
    ];
    expect(await scanExists(id), trail.join(' ')).toBe(true);
    expect(trail[0]).toBe('rest=403');
    expect(trail[1]).toMatch(/^graphql=\d+:Forbidden/);
    expect(trail[2]).toBe('page=403');
  }, 60_000);

  it('HARD-18 the graphql delete lets the signed in user who started the scan delete it', async () => {
    const id = await seedScan(fabrikamId, MEMBER);
    const answer = await graphqlDelete({ session: MEMBER }, id);
    expect(answer).toBe('200:deleted');
    expect(await scanExists(id)).toBe(false);
  }, 60_000);

  it('HARD-18 the report page delete refuses an organization user on a scan shared with every organization', async () => {
    const id = await seedScan('system', OWNER);
    const status = await pageDelete({ session: OWNER }, id);
    expect(status).toBe(403);
    expect(await scanExists(id)).toBe(true);
  }, 60_000);

  it('HARD-18 every delete path gives the same answer for the same caller and scan', async () => {
    // One row per (signed-in caller, scan). Each path gets its own freshly seeded scan with the same
    // organization and starter, and its answer is read back from storage: deleted, or still there.
    const rows: ReadonlyArray<{ readonly label: string; readonly caller: string; readonly org: () => string; readonly createdBy: string }> = [
      { label: 'owner, own organization scan started by the member', caller: OWNER, org: () => fabrikamId, createdBy: MEMBER },
      { label: 'member, scan the owner started', caller: MEMBER, org: () => fabrikamId, createdBy: OWNER },
      { label: 'member, scan it started', caller: MEMBER, org: () => fabrikamId, createdBy: MEMBER },
      { label: 'owner, scan shared with every organization', caller: OWNER, org: () => 'system', createdBy: OWNER },
      { label: 'user outside every organization, scan shared with every organization', caller: SOLO, org: () => 'system', createdBy: OWNER },
      { label: 'owner, scan of another organization', caller: OWNER, org: () => northwindId, createdBy: NORTHWIND_OWNER },
      { label: 'global admin, scan of another organization', caller: GLOBAL_ADMIN, org: () => northwindId, createdBy: NORTHWIND_OWNER },
    ];
    const answers: string[] = [];
    const disagreements: string[] = [];
    for (const row of rows) {
      const cred = { session: row.caller };
      const outcome: Record<string, string> = {};
      const rest = await seedScan(row.org(), row.createdBy);
      const restStatus = await restDelete(cred, rest);
      outcome['rest'] = (await scanExists(rest)) ? 'kept' : 'deleted';
      const gql = await seedScan(row.org(), row.createdBy);
      const gqlAnswer = await graphqlDelete(cred, gql);
      outcome['graphql'] = (await scanExists(gql)) ? 'kept' : 'deleted';
      const page = await seedScan(row.org(), row.createdBy);
      const pageStatus = await pageDelete(cred, page);
      outcome['page'] = (await scanExists(page)) ? 'kept' : 'deleted';
      const line = `${row.label}: rest=${outcome['rest']}(${restStatus}) graphql=${outcome['graphql']}(${gqlAnswer}) page=${outcome['page']}(${pageStatus})`;
      answers.push(line);
      if (new Set(Object.values(outcome)).size !== 1) disagreements.push(line);
    }
    expect(disagreements, answers.join('\n')).toEqual([]);
  }, 120_000);

  it('HARD-18 every scan delete call site goes through the shared delete rule', () => {
    // Any file under src/ (the repository layer under db/ aside) that deletes scan rows, directly or
    // through the shared delete function, must also ask the shared rule, and the callers are exactly the
    // three delete paths. A new caller fails here until it is listed AND asks the rule. The shared
    // delete function's own module is the one place that removes the row (pinned line by line below).
    const code = (text: string): string => text.split('\n').filter((l) => !isCommentLine(l)).join('\n');
    const callers: string[] = [];
    const withoutRule: string[] = [];
    for (const [rel, text] of readSources(SRC)) {
      if (rel.startsWith('db/') || rel === 'services/scan-delete-access.ts') continue;
      const src = code(text);
      if (!src.includes('.deleteScan(') && !src.includes('.deleteOrgScans(') && !src.includes('deleteScanAndFiles(')) continue;
      callers.push(rel);
      if (!src.includes('scanDeleteRefusal(')) withoutRule.push(rel);
    }
    expect(withoutRule).toEqual([]);
    expect(callers.sort()).toEqual(['graphql/resolvers.ts', 'routes/api/data.ts', 'routes/reports.ts']);
  });

  it('HARD-18 no mcp tool deletes a scan', () => {
    // tests/mcp/tool-metadata-drift.test.ts holds DASHBOARD_TOOL_METADATA equal to the registered tool set.
    const deleting = DASHBOARD_TOOL_METADATA.map((t) => t.name)
      .filter((n) => /(delete|remove|purge|destroy).*(scan|report)|(scan|report).*(delete|remove|purge|destroy)/i.test(n));
    expect(deleting).toEqual([]);
    const mcpCallers = [...readSources(join(SRC, 'mcp'))].filter(([, text]) => /\.delete(Scan|OrgScans)\(/.test(text)).map(([rel]) => rel);
    expect(mcpCallers).toEqual([]);
  });

  it('HARD-18 the graphql delete removes the report file of the scan', async () => {
    const { id, file } = await seedScanWithReportFile(fabrikamId, MEMBER);
    expect(existsSync(file)).toBe(true);
    const answer = await graphqlDelete({ session: MEMBER }, id);
    expect(answer).toBe('200:deleted');
    expect(await scanExists(id)).toBe(false);
    expect(existsSync(file), 'report file after the graphql delete').toBe(false);
  }, 60_000);

  it('HARD-18 the api and report page deletes remove the report file of the scan', async () => {
    const rest = await seedScanWithReportFile(fabrikamId, MEMBER);
    expect(await restDelete({ session: MEMBER }, rest.id)).toBe(200);
    const page = await seedScanWithReportFile(fabrikamId, MEMBER);
    await pageDelete({ session: MEMBER }, page.id);
    expect([await scanExists(rest.id), await scanExists(page.id)]).toEqual([false, false]);
    expect([existsSync(rest.file), existsSync(page.file)]).toEqual([false, false]);
  }, 60_000);

  it('HARD-18 every delete path keeps the scan when its report file cannot be removed', async () => {
    const seeded = [
      await seedScanWithUnremovableReport(fabrikamId, MEMBER),
      await seedScanWithUnremovableReport(fabrikamId, MEMBER),
      await seedScanWithUnremovableReport(fabrikamId, MEMBER),
    ] as const;
    const answers = await deleteThroughEveryPath([seeded[0].id, seeded[1].id, seeded[2].id]);
    expect(answers.rest.startsWith('500:')).toBe(true);
    expect(answers.rest).toContain('The scan could not be deleted');
    expect(answers.graphql).toBe('200:The scan could not be deleted');
    expect(answers.page.startsWith('500:')).toBe(true);
    expect(JSON.stringify(answers)).not.toContain(h.reportsDir);
    for (const { id, file } of seeded) {
      expect(await scanExists(id), `scan ${id} kept`).toBe(true);
      expect(existsSync(file)).toBe(true);
    }
  }, 60_000);

  it('HARD-18 every delete path keeps the scan and the file when the stored report path is outside the reports directory', async () => {
    const seeded = [
      await seedScanWithReportFile(fabrikamId, MEMBER, outsideDir),
      await seedScanWithReportFile(fabrikamId, MEMBER, outsideDir),
      await seedScanWithReportFile(fabrikamId, MEMBER, outsideDir),
    ] as const;
    const answers = await deleteThroughEveryPath([seeded[0].id, seeded[1].id, seeded[2].id]);
    expect(answers.rest.startsWith('500:')).toBe(true);
    expect(answers.rest).toContain('The scan could not be deleted');
    expect(answers.graphql).toBe('200:The scan could not be deleted');
    expect(answers.page.startsWith('500:')).toBe(true);
    expect(JSON.stringify(answers)).not.toContain(outsideDir);
    for (const { id, file } of seeded) {
      expect(await scanExists(id), `scan ${id} kept`).toBe(true);
      expect(existsSync(file), 'the file outside the reports directory').toBe(true);
    }
  }, 60_000);

  it('HARD-18 only the shared delete function removes a scan row', () => {
    const hits: string[] = [];
    for (const [rel, text] of readSources(SRC)) {
      text.split('\n').forEach((line, i) => {
        if (!isCommentLine(line) && line.includes('.deleteScan(')) hits.push(`${rel}:${i + 1}`);
      });
    }
    expect(hits.map((hit) => hit.split(':')[0])).toEqual(['services/scan-delete-access.ts']);
    // ...and that line sits inside deleteScanAndFiles.
    const source = readFileSync(join(SRC, 'services', 'scan-delete-access.ts'), 'utf8');
    const start = source.indexOf('export async function deleteScanAndFiles(');
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start, source.indexOf('\n}\n', start));
    expect(body).toContain('.deleteScan(');
  });
});
