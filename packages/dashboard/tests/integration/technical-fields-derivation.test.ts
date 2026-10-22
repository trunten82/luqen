/**
 * D-07 (Phase 93): the list of issue fields a viewer without reports.view_technical does not get
 * is DERIVED from the rendered report page, not copied from a comment. The same finding carries a
 * distinct canary in message, selector, context and runner; the report page is rendered for the
 * org Owner and for an Analyst who differs from the Owner only in lacking reports.view_technical.
 * A field is hidden when its canary is on the Owner's page and not on the Analyst's. The derived set
 * must equal TECHNICAL_ISSUE_FIELDS, and the REST data API must withhold exactly those canaries.
 *
 * Boots the REAL createServer and logs in through /login, so the permission resolution, the report
 * route and the full template are the production ones.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../src/server.js';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { TECHNICAL_ISSUE_FIELDS } from '../../src/services/technical-details.js';
import { seedSurfaceScan } from '../helpers/dismissal-surface-fixture.js';

const PASSWORD = 'Derivation-Pass-123!';
// A code and message the fix-suggestion engine recognises, so the page renders a fix hint (which is
// where the flagged element's markup travels) for a viewer holding issues.fix.
const CODE = 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37';
const HEX = randomUUID().replace(/-/g, '').slice(0, 14);
const CANARIES = {
  message: `msgcanary${HEX}`,
  selector: `selcanary${HEX}`,
  context: `ctxcanary${HEX}`,
  runner: `runcanary${HEX}`,
} as const;
type Field = keyof typeof CANARIES;
const FIELDS = Object.keys(CANARIES) as Field[];

let tmpRoot: string;
let app: FastifyInstance;
let seed: SqliteStorageAdapter;
let scanId: string;
const cookies = new Map<string, string>();

const tokenOf = (html: string): string | undefined =>
  /name="csrf-token" content="([^"]+)"/.exec(html)?.[1] ?? /name="_csrf" value="([^"]+)"/.exec(html)?.[1];

async function cookieFor(username: string): Promise<string> {
  const cached = cookies.get(username);
  if (cached !== undefined) return cached;
  const loginPage = await app.inject({ method: 'GET', url: '/login' });
  const loginCookie = loginPage.cookies.find((c) => c.name === 'session')!.value;
  const res = await app.inject({
    method: 'POST', url: '/login', cookies: { session: loginCookie },
    headers: { 'x-csrf-token': tokenOf(loginPage.body)! },
    payload: { username, password: PASSWORD },
  });
  expect(res.statusCode).toBe(302);
  const cookie = res.cookies.find((c) => c.name === 'session')!.value;
  cookies.set(username, cookie);
  return cookie;
}

async function get(username: string, url: string): Promise<string> {
  const res = await app.inject({ method: 'GET', url, cookies: { session: await cookieFor(username) } });
  expect(res.statusCode).toBe(200);
  return res.body;
}

const presentIn = (body: string): Set<Field> => new Set(FIELDS.filter((f) => body.includes(CANARIES[f])));

beforeAll(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'luqen-technical-fields-derivation-'));
  const dbPath = join(tmpRoot, 'dashboard.db');
  const reportsDir = join(tmpRoot, 'reports');
  mkdirSync(reportsDir, { recursive: true });
  app = (await createServer({
    dbPath, reportsDir, sessionSecret: 'd'.repeat(32),
    catalogueUrl: '', catalogueCacheTtl: 0, redisUrl: '', maxConcurrentScans: 1,
  } as never)) as FastifyInstance;
  await app.ready();
  seed = new SqliteStorageAdapter(dbPath);
  await seed.migrate();
  const orgId = (await seed.organizations.createOrg({ name: 'Fabrikam', slug: `fabrikam-${HEX.slice(0, 8)}` })).id;

  const owner = await seed.users.createUser('fabrikam-owner', PASSWORD, 'user');
  const ownerRole = await seed.roles.getRoleByNameAndOrg('Owner', orgId);
  const owners = await seed.teams.createTeam({ name: 'owners', description: '', orgId, roleId: ownerRole!.id });
  await seed.teams.addTeamMember(owners.id, owner.id);
  await seed.organizations.addMember(orgId, owner.id, 'owner');

  // Every control that could carry a field renders for this role: fix hint, assign, dismiss.
  const analyst = await seed.users.createUser('fabrikam-analyst', PASSWORD, 'user');
  const analystRole = await seed.roles.createRole({
    name: 'Analyst', description: 'All report work without technical details',
    permissions: ['reports.view', 'reports.export', 'issues.fix', 'issues.assign', 'issues.dismiss', 'llm.view'], orgId,
  });
  const analysts = await seed.teams.createTeam({ name: 'analysts', description: '', orgId, roleId: analystRole.id });
  await seed.teams.addTeamMember(analysts.id, analyst.id);
  await seed.organizations.addMember(orgId, analyst.id, 'member');

  const siteUrl = `https://fabrikam.example/${HEX.slice(0, 8)}/`;
  scanId = await seedSurfaceScan(seed, {
    orgId, siteUrl, location: 'both', reportsDir,
    report: {
      summary: { pagesScanned: 1, totalIssues: 1, byLevel: { error: 1, warning: 0, notice: 0 } },
      pages: [{
        url: siteUrl, issueCount: 1,
        issues: [{
          type: 'error', code: CODE, message: `Image is missing a text alternative ${CANARIES.message}`,
          selector: `#${CANARIES.selector}`, context: `<img id="${CANARIES.context}" src="hero.png">`,
          runner: CANARIES.runner,
        }],
      }],
    },
  });
}, 120_000);

afterAll(async () => {
  if (seed !== undefined) await seed.disconnect();
  if (app !== undefined) await app.close();
  if (tmpRoot !== undefined) rmSync(tmpRoot, { recursive: true, force: true });
});

describe('the technical field list derived from the rendered report page', () => {
  it('D-07 the message canary is on both renders, proving the matcher can match', async () => {
    expect(presentIn(await get('fabrikam-owner', `/reports/${scanId}`))).toContain('message');
    expect(presentIn(await get('fabrikam-analyst', `/reports/${scanId}`))).toContain('message');
  }, 60_000);

  it('D-07 the set of issue fields whose canary the Owner page shows and the Analyst page does not equals TECHNICAL_ISSUE_FIELDS', async () => {
    const owner = presentIn(await get('fabrikam-owner', `/reports/${scanId}`));
    const analyst = presentIn(await get('fabrikam-analyst', `/reports/${scanId}`));
    const hidden = FIELDS.filter((f) => owner.has(f) && !analyst.has(f)).sort();
    // Printed so a reader of the run sees the derived list, not only the verdict.
    console.info(`D-07 derived hidden fields: ${JSON.stringify(hidden)}; owner shows ${JSON.stringify([...owner].sort())}; analyst shows ${JSON.stringify([...analyst].sort())}`);
    expect(hidden).toEqual([...TECHNICAL_ISSUE_FIELDS].sort());
  }, 60_000);

  it('D-06 the Analyst REST issues and scan detail bodies carry none of the derived hidden canaries and do carry the message canary', async () => {
    const owner = presentIn(await get('fabrikam-owner', `/reports/${scanId}`));
    const analyst = presentIn(await get('fabrikam-analyst', `/reports/${scanId}`));
    const hidden = FIELDS.filter((f) => owner.has(f) && !analyst.has(f));
    expect(hidden.length).toBeGreaterThan(0);
    for (const url of [`/api/v1/scans/${scanId}/issues`, `/api/v1/scans/${scanId}`]) {
      const body = await get('fabrikam-analyst', url);
      for (const field of hidden) expect(body, `${field} canary in ${url}`).not.toContain(CANARIES[field]);
      expect(body, `message canary in ${url}`).toContain(CANARIES.message);
    }
  }, 60_000);
});
