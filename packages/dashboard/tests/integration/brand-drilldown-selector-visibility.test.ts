/**
 * HARD-02: the brand drilldown modal (GET /reports/:id/brand-drilldown, loaded into the report page
 * from the brand score panel) lists brand-matched findings. A viewer without
 * reports.view_technical must not receive any finding's raw element selector or markup in that
 * response; a viewer with it still gets the Element column.
 *
 * Boots the REAL createServer and logs in through /login, so permission resolution, the route and
 * the real partial are the production ones. Each finding's selector is a unique canary, asserted
 * over the WHOLE response body. The two roles differ by exactly one permission
 * (reports.view_technical), so the control shows the matcher can match and that nothing else
 * decides the outcome.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { JSDOM } from 'jsdom';
import { createServer } from '../../src/server.js';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';

const PASSWORD = 'Drilldown-Pass-123!';
const canary = (label: string): string => `${label}-canary-${randomUUID().replace(/-/g, '').slice(0, 12)}`;

/** One brand-matched finding per drilldown dimension: selector id, markup id, message, match detail. */
const FINDINGS = {
  color: {
    selectorId: canary('color-selector'), markupId: canary('color-markup'),
    code: 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail', strategy: 'color-pair',
    message: 'Contrast of the Fabrikam promo banner is too low', matchDetail: 'Fabrikam blue on white',
  },
  typography: {
    selectorId: canary('typography-selector'), markupId: canary('typography-markup'),
    code: 'WCAG2AA.Principle1.Guideline1_4.1_4_12.C36', strategy: 'font',
    message: 'Fabrikam body text spacing cannot be adjusted', matchDetail: 'Fabrikam Sans (Brand Font)',
  },
  components: {
    selectorId: canary('components-selector'), markupId: canary('components-markup'),
    code: 'WCAG2AA.Principle4.Guideline4_1.4_1_2.H91', strategy: 'selector',
    message: 'Fabrikam primary button has no accessible name', matchDetail: 'Matched selector: .fabrikam-button',
  },
} as const;
type Dimension = keyof typeof FINDINGS;
const DIMENSIONS = Object.keys(FINDINGS) as Dimension[];

let tmpRoot: string;
let app: FastifyInstance;
let seed: SqliteStorageAdapter;
let orgId: string;
let scanId: string;
let plainId: string;
let technicalId: string;
const sessions = new Map<string, string>();

const tokenOf = (html: string): string | undefined =>
  /name="csrf-token" content="([^"]+)"/.exec(html)?.[1] ?? /name="_csrf" value="([^"]+)"/.exec(html)?.[1];

async function sessionFor(username: string): Promise<string> {
  const cached = sessions.get(username);
  if (cached !== undefined) return cached;
  const loginPage = await app.inject({ method: 'GET', url: '/login' });
  const loginCookie = loginPage.cookies.find((c) => c.name === 'session')!.value;
  const login = await app.inject({
    method: 'POST', url: '/login', cookies: { session: loginCookie },
    headers: { 'x-csrf-token': tokenOf(loginPage.body)! },
    payload: { username, password: PASSWORD },
  });
  expect(login.statusCode).toBe(302);
  const cookie = login.cookies.find((c) => c.name === 'session')!.value;
  sessions.set(username, cookie);
  return cookie;
}

/** The drilldown exactly as the brand score panel requests it (an HTMX fragment). */
async function drilldownAs(username: string, dimension: Dimension): Promise<string> {
  const res = await app.inject({
    method: 'GET', url: `/reports/${scanId}/brand-drilldown?dimension=${dimension}`,
    cookies: { session: await sessionFor(username) }, headers: { 'hx-request': 'true' },
  });
  expect(res.statusCode).toBe(200);
  // The finding itself is listed for both viewers, so an absent selector is the gate, not an empty list.
  expect(res.body).toContain(FINDINGS[dimension].message);
  expect(res.body).toContain(FINDINGS[dimension].matchDetail);
  return res.body;
}

/** The modal table's column headers and the cell count of its one row. */
function table(html: string): { readonly headers: string[]; readonly cells: number } {
  const doc = new JSDOM(html).window.document;
  const headers = [...doc.querySelectorAll('.modal table thead th')].map((th) => th.textContent?.trim() ?? '');
  const rows = [...doc.querySelectorAll('.modal table tbody tr')];
  expect(rows.length).toBe(1);
  return { headers, cells: rows[0]!.querySelectorAll('td').length };
}

async function addMember(username: string, roleName: string, permissions: string[]): Promise<string> {
  const user = await seed.users.createUser(username, PASSWORD, 'user');
  const role = await seed.roles.createRole({ name: roleName, description: roleName, permissions, orgId });
  const team = await seed.teams.createTeam({ name: `${roleName} team`, description: '', orgId, roleId: role.id });
  await seed.teams.addTeamMember(team.id, user.id);
  await seed.organizations.addMember(orgId, user.id, 'member');
  return user.id;
}

beforeAll(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'luqen-brand-drilldown-visibility-'));
  const dbPath = join(tmpRoot, 'dashboard.db');
  app = (await createServer({
    dbPath, reportsDir: join(tmpRoot, 'reports'), sessionSecret: 'd'.repeat(32),
    catalogueUrl: '', catalogueCacheTtl: 0, redisUrl: '', maxConcurrentScans: 1,
  } as never)) as FastifyInstance;
  await app.ready();
  seed = new SqliteStorageAdapter(dbPath);
  await seed.migrate();
  orgId = (await seed.organizations.createOrg({ name: 'Fabrikam', slug: 'fabrikam-brand-drilldown' })).id;

  plainId = await addMember('fabrikam-brand-reviewer', 'Brand reviewer', ['reports.view']);
  technicalId = await addMember('fabrikam-brand-engineer', 'Brand engineer', ['reports.view', 'reports.view_technical']);

  const siteUrl = `https://fabrikam.test/${randomUUID().slice(0, 8)}/`;
  scanId = `scan_${randomUUID().replace(/-/g, '')}`;
  await seed.scans.createScan({
    id: scanId, siteUrl, standard: 'WCAG2AA', jurisdictions: [], regulations: [],
    createdBy: 'seed', createdAt: new Date().toISOString(), orgId,
  });
  const issues = DIMENSIONS.map((d) => ({
    type: 'error', code: FINDINGS[d].code, message: FINDINGS[d].message,
    selector: `#${FINDINGS[d].selectorId}`, context: `<div id="${FINDINGS[d].markupId}">x</div>`,
    brandMatch: { matched: true, strategy: FINDINGS[d].strategy, matchDetail: FINDINGS[d].matchDetail },
  }));
  await seed.scans.updateScan(scanId, {
    status: 'completed',
    completedAt: new Date().toISOString(),
    jsonReport: JSON.stringify({
      pages: [{ url: siteUrl, issues }],
      summary: { pagesScanned: 1, totalIssues: issues.length, byLevel: { error: issues.length, warning: 0, notice: 0 } },
    }),
  });
}, 120_000);

afterAll(async () => {
  if (seed !== undefined) await seed.disconnect();
  if (app !== undefined) await app.close();
  if (tmpRoot !== undefined) rmSync(tmpRoot, { recursive: true, force: true });
});

describe('brand drilldown selector visibility', () => {
  it('HARD-02 drilldown roles differ only by reports.view_technical', async () => {
    const plain = await seed.roles.getEffectivePermissions(plainId, orgId);
    const technical = await seed.roles.getEffectivePermissions(technicalId, orgId);
    expect(plain.has('reports.view')).toBe(true);
    expect(plain.has('reports.view_technical')).toBe(false);
    expect([...technical].filter((p) => !plain.has(p))).toEqual(['reports.view_technical']);
  });

  it.each(DIMENSIONS)(
    'HARD-02 brand drilldown %s omits the raw selector for a viewer without technical details',
    async (dimension) => {
      const html = await drilldownAs('fabrikam-brand-reviewer', dimension);
      for (const d of DIMENSIONS) {
        expect(html.includes(FINDINGS[d].selectorId), `${d} selector in the ${dimension} drilldown`).toBe(false);
        expect(html.includes(FINDINGS[d].markupId), `${d} markup in the ${dimension} drilldown`).toBe(false);
      }
      // The Element column is gone, header and cell alike: no empty column left behind.
      expect(table(html)).toEqual({ headers: ['Issue', 'Brand Match'], cells: 2 });
    },
    60_000,
  );

  it.each(DIMENSIONS)(
    'HARD-02 brand drilldown %s shows the raw selector to a viewer with technical details',
    async (dimension) => {
      const html = await drilldownAs('fabrikam-brand-engineer', dimension);
      expect(html.includes(FINDINGS[dimension].selectorId), `${dimension} selector in its drilldown`).toBe(true);
      expect(table(html)).toEqual({ headers: ['Element', 'Issue', 'Brand Match'], cells: 3 });
    },
    60_000,
  );
});
