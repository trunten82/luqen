/**
 * HARD-02 (owner ruling: hide the controls): the raw element selector of a finding reaches a
 * viewer's browser only when the viewer holds reports.view_technical. The Dismiss and per-issue
 * Assign controls carry the selector, so they need that permission too.
 *
 * Boots the REAL createServer and logs in through /login, so the permission resolution, the
 * report route and the full template are all the production ones. The finding's selector is a
 * unique canary string; the assertion is over the WHOLE response HTML, not one element, and the
 * same page opened by the org Owner is the control that shows the matcher can match.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../src/server.js';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';

const CODE = 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail';
const PASSWORD = 'Visible-Pass-123!';
const CANARY = `#selector-canary-${randomUUID().replace(/-/g, '').slice(0, 16)}`;
const CANARY_ID = CANARY.slice(1);
const MESSAGE = 'Contrast of the promo note is too low';

let tmpRoot: string;
let app: FastifyInstance;
let seed: SqliteStorageAdapter;
let orgId: string;
let scanId: string;
let reviewerId: string;

const tokenOf = (html: string): string | undefined =>
  /name="csrf-token" content="([^"]+)"/.exec(html)?.[1] ?? /name="_csrf" value="([^"]+)"/.exec(html)?.[1];

async function reportHtmlAs(username: string): Promise<string> {
  const loginPage = await app.inject({ method: 'GET', url: '/login' });
  const loginCookie = loginPage.cookies.find((c) => c.name === 'session')!.value;
  const login = await app.inject({
    method: 'POST', url: '/login', cookies: { session: loginCookie },
    headers: { 'x-csrf-token': tokenOf(loginPage.body)! },
    payload: { username, password: PASSWORD },
  });
  expect(login.statusCode).toBe(302);
  const cookie = login.cookies.find((c) => c.name === 'session')!.value;
  const page = await app.inject({ method: 'GET', url: `/reports/${scanId}`, cookies: { session: cookie } });
  expect(page.statusCode).toBe(200);
  // The finding itself is on the page for both viewers, so an absent selector is the gate.
  expect(page.body).toContain(MESSAGE);
  return page.body;
}

beforeAll(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'luqen-report-selector-visibility-'));
  const dbPath = join(tmpRoot, 'dashboard.db');
  app = (await createServer({
    dbPath, reportsDir: join(tmpRoot, 'reports'), sessionSecret: 'v'.repeat(32),
    catalogueUrl: '', catalogueCacheTtl: 0, redisUrl: '', maxConcurrentScans: 1,
  } as never)) as FastifyInstance;
  await app.ready();
  seed = new SqliteStorageAdapter(dbPath);
  await seed.migrate();
  orgId = (await seed.organizations.createOrg({ name: 'Fabrikam', slug: 'fabrikam-selector-visibility' })).id;

  const owner = await seed.users.createUser('fabrikam-owner', PASSWORD, 'user');
  const ownerRole = await seed.roles.getRoleByNameAndOrg('Owner', orgId);
  const owners = await seed.teams.createTeam({ name: 'owners', description: '', orgId, roleId: ownerRole!.id });
  await seed.teams.addTeamMember(owners.id, owner.id);
  await seed.organizations.addMember(orgId, owner.id, 'owner');

  // A custom org role that may dismiss and assign but not see technical details.
  const reviewer = await seed.users.createUser('fabrikam-reviewer', PASSWORD, 'user');
  reviewerId = reviewer.id;
  const reviewerRole = await seed.roles.createRole({
    name: 'Reviewer', description: 'Dismiss and assign without technical details',
    permissions: ['reports.view', 'issues.dismiss', 'issues.assign'], orgId,
  });
  const reviewers = await seed.teams.createTeam({ name: 'reviewers', description: '', orgId, roleId: reviewerRole.id });
  await seed.teams.addTeamMember(reviewers.id, reviewer.id);
  await seed.organizations.addMember(orgId, reviewer.id, 'member');

  const siteUrl = `https://fabrikam.test/${randomUUID().slice(0, 8)}/`;
  scanId = `scan_${randomUUID().replace(/-/g, '')}`;
  await seed.scans.createScan({
    id: scanId, siteUrl, standard: 'WCAG2AA', jurisdictions: [], regulations: [],
    createdBy: 'seed', createdAt: new Date().toISOString(), orgId,
  });
  await seed.scans.updateScan(scanId, {
    status: 'completed',
    completedAt: new Date().toISOString(),
    jsonReport: JSON.stringify({
      pages: [{ url: siteUrl, issues: [{ type: 'error', code: CODE, message: MESSAGE, selector: CANARY, context: '<p>x</p>' }] }],
      summary: { pagesScanned: 1, totalIssues: 1, byLevel: { error: 1, warning: 0, notice: 0 } },
    }),
  });
}, 120_000);

afterAll(async () => {
  if (seed !== undefined) await seed.disconnect();
  if (app !== undefined) await app.close();
  if (tmpRoot !== undefined) rmSync(tmpRoot, { recursive: true, force: true });
});

describe('report page selector visibility', () => {
  it('HARD-02 report page omits the raw selector for a viewer without technical details', async () => {
    // Precondition: the reviewer holds the dismiss and assign permissions in this org and not
    // the technical one, so the controls are the only thing that could carry the selector.
    const effective = await seed.roles.getEffectivePermissions(reviewerId, orgId);
    expect(effective.has('issues.dismiss')).toBe(true);
    expect(effective.has('issues.assign')).toBe(true);
    expect(effective.has('reports.view_technical')).toBe(false);

    const html = await reportHtmlAs('fabrikam-reviewer');
    expect(html.includes(CANARY_ID), 'canary selector found in the report HTML').toBe(false);
  }, 60_000);

  it('HARD-02 report page shows the selector to a viewer with technical details', async () => {
    const html = await reportHtmlAs('fabrikam-owner');
    expect(html.includes(CANARY_ID), 'canary selector found in the report HTML').toBe(true);
  }, 60_000);
});
