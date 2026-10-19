/**
 * HARD-02 (owner ruling: hide the controls): the raw element selector of a finding reaches a
 * viewer's browser only when the viewer holds reports.view_technical. The Dismiss and per-issue
 * Assign controls carry the selector, so they need that permission too.
 *
 * Boots the REAL createServer and logs in through /login, so the permission resolution, the
 * report route and the full template are all the production ones. The finding's selector is a
 * unique canary string; the assertion is over the WHOLE response HTML, not one element, and the
 * same page opened by the org Owner is the control that shows the matcher can match.
 *
 * The fix hint (issues.fix) carries the flagged element's markup in its request only for a viewer who
 * holds reports.view_technical; a second scan whose report renders every hint site checks that.
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

const CODE = 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail';
const PASSWORD = 'Visible-Pass-123!';
const CANARY = `#selector-canary-${randomUUID().replace(/-/g, '').slice(0, 16)}`;
const CANARY_ID = CANARY.slice(1);
const MESSAGE = 'Contrast of the promo note is too low';
/** Unique markup ids in the hint scan's issue contexts (the flagged elements' markup). */
const TEMPLATE_MARKUP_ID = `template-markup-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
const PAGE_MARKUP_ID = `page-markup-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
const HINT_MESSAGE = 'Image is missing a text alternative';

let tmpRoot: string;
let app: FastifyInstance;
let seed: SqliteStorageAdapter;
let orgId: string;
let scanId: string;
let reviewerId: string;
let fixerId: string;
let hintScanId: string;

const tokenOf = (html: string): string | undefined =>
  /name="csrf-token" content="([^"]+)"/.exec(html)?.[1] ?? /name="_csrf" value="([^"]+)"/.exec(html)?.[1];

async function reportHtmlAs(username: string, reportScanId: string = scanId): Promise<string> {
  const loginPage = await app.inject({ method: 'GET', url: '/login' });
  const loginCookie = loginPage.cookies.find((c) => c.name === 'session')!.value;
  const login = await app.inject({
    method: 'POST', url: '/login', cookies: { session: loginCookie },
    headers: { 'x-csrf-token': tokenOf(loginPage.body)! },
    payload: { username, password: PASSWORD },
  });
  expect(login.statusCode).toBe(302);
  const cookie = login.cookies.find((c) => c.name === 'session')!.value;
  const page = await app.inject({ method: 'GET', url: `/reports/${reportScanId}`, cookies: { session: cookie } });
  expect(page.statusCode).toBe(200);
  // The finding itself is on the page for both viewers, so an absent selector is the gate.
  expect(page.body).toContain(reportScanId === scanId ? MESSAGE : HINT_MESSAGE);
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

  // A custom org role that may see fix hints but not technical details.
  const fixer = await seed.users.createUser('fabrikam-fixer', PASSWORD, 'user');
  fixerId = fixer.id;
  const fixerRole = await seed.roles.createRole({
    name: 'Fixer', description: 'Fix hints without technical details',
    permissions: ['reports.view', 'issues.fix'], orgId,
  });
  const fixers = await seed.teams.createTeam({ name: 'fixers', description: '', orgId, roleId: fixerRole.id });
  await seed.teams.addTeamMember(fixers.id, fixer.id);
  await seed.organizations.addMember(orgId, fixer.id, 'member');

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

  // The hint scan: one finding repeated on three pages with identical markup (a template item, shown in
  // the criterion groups and on the Templates tab) and one finding on a single page (a page issue, in the
  // criterion groups and the per-page table).
  const hintSite = `https://fabrikam.test/${randomUUID().slice(0, 8)}/`;
  hintScanId = `scan_${randomUUID().replace(/-/g, '')}`;
  const templateIssue = {
    type: 'error', code: CODE, message: MESSAGE, selector: '#template-note',
    context: `<p id="${TEMPLATE_MARKUP_ID}">note</p>`,
  };
  const pageIssue = {
    type: 'error', code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37', message: HINT_MESSAGE, selector: '#hero-img',
    context: `<img id="${PAGE_MARKUP_ID}" src="hero.png">`,
  };
  await seed.scans.createScan({
    id: hintScanId, siteUrl: hintSite, standard: 'WCAG2AA', jurisdictions: [], regulations: [],
    createdBy: 'seed', createdAt: new Date().toISOString(), orgId,
  });
  await seed.scans.updateScan(hintScanId, {
    status: 'completed',
    completedAt: new Date().toISOString(),
    jsonReport: JSON.stringify({
      pages: [
        { url: `${hintSite}a`, issues: [templateIssue, pageIssue] },
        { url: `${hintSite}b`, issues: [templateIssue] },
        { url: `${hintSite}c`, issues: [templateIssue] },
      ],
      summary: { pagesScanned: 3, totalIssues: 4, byLevel: { error: 4, warning: 0, notice: 0 } },
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

// HARD-02: the report page's fix hint carries the flagged element's markup in its request only for a
// viewer holding reports.view_technical, at every place the page renders a hint.
describe('report page fix hint markup', () => {
  /** Each fix hint on the page: where it sits (nearest ancestor with an id) and the markup its request carries. */
  function fixHints(html: string): Array<{ readonly site: string; readonly htmlContext: string }> {
    const doc = new JSDOM(html).window.document;
    return [...doc.querySelectorAll('details.rpt-fix-hint')].map((el) => {
      const url = new URL(el.getAttribute('hx-get') ?? '', 'https://dashboard.example');
      // The place on the page (nearest ancestor id) and which finding (the template item or the page issue).
      const place = el.parentElement?.closest('[id]')?.id ?? '(none)';
      const finding = url.searchParams.get('message') === HINT_MESSAGE ? 'page issue' : 'template item';
      return { site: `${place} / ${finding}`, htmlContext: url.searchParams.get('htmlContext') ?? '' };
    });
  }

  /** One hint at each of the four places the page renders one. */
  const HINT_SITES = {
    'rpt-issue-list / template item': 1,
    'rpt-issue-list / page issue': 1,
    'panel-templates / template item': 1,
    'rpt-page-list / page issue': 1,
  };

  function perSite(hints: ReadonlyArray<{ readonly site: string }>): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const h of hints) counts[h.site] = (counts[h.site] ?? 0) + 1;
    return counts;
  }

  it('HARD-02 report page fix hints carry no element markup for a viewer without technical details', async () => {
    const effective = await seed.roles.getEffectivePermissions(fixerId, orgId);
    expect(effective.has('issues.fix')).toBe(true);
    expect(effective.has('reports.view_technical')).toBe(false);

    const html = await reportHtmlAs('fabrikam-fixer', hintScanId);
    const hints = fixHints(html);
    // Every hint site renders: the criterion groups (template items and page issues), the Templates
    // tab and the per-page table.
    expect(perSite(hints)).toEqual(HINT_SITES);
    expect(hints.filter((h) => h.htmlContext !== '').map((h) => h.site)).toEqual([]);
    expect(html.includes(TEMPLATE_MARKUP_ID) || html.includes(PAGE_MARKUP_ID)).toBe(false);
  }, 60_000);

  it('HARD-02 report page fix hints carry the element markup for a viewer with technical details', async () => {
    const html = await reportHtmlAs('fabrikam-owner', hintScanId);
    const hints = fixHints(html);
    expect(perSite(hints)).toEqual(HINT_SITES);
    expect(hints.filter((h) => h.htmlContext === '').map((h) => h.site)).toEqual([]);
    expect(hints.some((h) => h.htmlContext.includes(TEMPLATE_MARKUP_ID))).toBe(true);
    expect(hints.some((h) => h.htmlContext.includes(PAGE_MARKUP_ID))).toBe(true);
  }, 60_000);
});
