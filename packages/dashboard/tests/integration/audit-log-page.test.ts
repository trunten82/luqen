/**
 * The Audit Log page through the REAL createServer and real cookie routes
 * (tests/helpers/mcp-oauth-harness.ts).
 *
 * Phase 95 plan 02: AUD-01 (an org Owner holding audit view reaches the page from the menu, and the
 * page stays scoped to the Owner's organization), AUD-02 (the Action filter), AUD-03 (the HTML error
 * page for a browser without permission, JSON for the others) and TEAM-02 (Load More carries the
 * page limit).
 * A caller in no organization reads no audit rows, on the page or through GraphQL, and is not offered
 * the menu entry.
 *
 * Public repo: Fabrikam and Northwind placeholders only. Logins per file: 4 (the login route is
 * rate limited).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { startMcpOauthHarness, type HarnessSession, type McpOauthHarness } from '../helpers/mcp-oauth-harness.js';

const PASSWORD = 'Fabrikam-Audit-42!';
const HTML_ACCEPT = 'text/html,application/xhtml+xml';

let h: McpOauthHarness;
let fabrikamOrgId: string;
let northwindOrgId: string;
let owner: HarnessSession;
let member: HarnessSession;
let globalAdmin: HarnessSession;
let noOrgAuditor: HarnessSession;

interface PageResult {
  readonly status: number;
  readonly contentType: string;
  readonly body: string;
}

async function page(session: HarnessSession, url: string, headers: Record<string, string> = {}): Promise<PageResult> {
  const res = await h.app.inject({ method: 'GET', url, cookies: { session: session.cookie }, headers });
  return { status: res.statusCode, contentType: String(res.headers['content-type'] ?? ''), body: res.body };
}

/** True when the rendered sidebar holds the Audit Log link. */
function menuHasAuditLog(html: string): boolean {
  const doc = new JSDOM(html).window.document;
  return doc.querySelector('a[href="/admin/audit-log"]') !== null;
}

async function seedUser(username: string, orgId: string, roleName: 'Owner' | 'Member', orgRole: 'owner' | 'member'): Promise<void> {
  const user = await h.seed.users.createUser(username, PASSWORD, 'user');
  const role = await h.seed.roles.getRoleByNameAndOrg(roleName, orgId);
  const team = await h.seed.teams.createTeam({ name: `${username}-team`, description: '', orgId, roleId: role!.id });
  await h.seed.teams.addTeamMember(team.id, user.id);
  await h.seed.organizations.addMember(orgId, user.id, orgRole);
}

async function signIn(username: string, orgId: string | null): Promise<HarnessSession> {
  const login = await h.login(username, PASSWORD);
  expect(login.status, `login ${username}`).toBe(302);
  if (orgId === null) return login.session;
  const switched = await h.switchOrg(login.session, orgId);
  expect(switched.status, `switch ${username}`).toBeLessThan(400);
  return switched.session;
}

beforeAll(async () => {
  h = await startMcpOauthHarness('audit-log');
  fabrikamOrgId = (await h.seed.organizations.createOrg({ name: 'Fabrikam', slug: 'fabrikam-audit-log' })).id;
  northwindOrgId = (await h.seed.organizations.createOrg({ name: 'Northwind', slug: 'northwind-audit-log' })).id;
  await seedUser('fabrikam-audit-owner', fabrikamOrgId, 'Owner', 'owner');
  await seedUser('fabrikam-audit-member', fabrikamOrgId, 'Member', 'member');
  await h.seed.users.createUser('fabrikam-audit-admin', PASSWORD, 'admin');
  await h.seed.audit.log({ actor: 'fabrikam-owner', action: 'scan.create', resourceType: 'scan', resourceId: 'fabrikam-scan', orgId: fabrikamOrgId });
  await h.seed.audit.log({ actor: 'northwind-owner', action: 'scan.create', resourceType: 'scan', resourceId: 'northwind-scan', orgId: northwindOrgId });
  // A row written without an organization (stored as 'system').
  await h.seed.audit.log({ actor: 'fabrikam-audit-admin', action: 'scan.create', resourceType: 'scan', resourceId: 'system-scan' });
  // A global custom role that holds View audit log, for a user in no organization.
  await h.seed.roles.createRole({ name: 'fabrikam-auditor', description: '', permissions: ['audit.view', 'reports.view'], orgId: 'system' });
  await h.seed.users.createUser('fabrikam-no-org-auditor', PASSWORD, 'fabrikam-auditor');
  owner = await signIn('fabrikam-audit-owner', fabrikamOrgId);
  member = await signIn('fabrikam-audit-member', fabrikamOrgId);
  globalAdmin = await signIn('fabrikam-audit-admin', null);
  noOrgAuditor = await signIn('fabrikam-no-org-auditor', null);
}, 120_000);

afterAll(async () => {
  if (h !== undefined) await h.close();
});

describe('AUD-01 the Audit Log menu entry follows the audit view permission', () => {
  it('AUD-01 an org Owner holding audit view sees the Audit Log menu entry', async () => {
    const res = await page(owner, '/home');
    expect(res.status).toBe(200);
    expect(menuHasAuditLog(res.body)).toBe(true);
  });

  it('AUD-01 a member without audit view sees no Audit Log menu entry', async () => {
    const res = await page(member, '/home');
    expect(res.status).toBe(200);
    expect(menuHasAuditLog(res.body)).toBe(false);
  });

  it('AUD-01 a global administrator still sees the Audit Log menu entry', async () => {
    const res = await page(globalAdmin, '/home');
    expect(res.status).toBe(200);
    expect(menuHasAuditLog(res.body)).toBe(true);
  });

  it('AUD-01 the Owner Audit Log lists only the Owner organization', async () => {
    const res = await page(owner, '/admin/audit-log');
    expect(res.status).toBe(200);
    expect(res.body).toContain('fabrikam-scan');
    expect(res.body).not.toContain('northwind-scan');
  });

  it('AUD-01 a caller in no organization sees no Audit Log menu entry', async () => {
    const res = await page(noOrgAuditor, '/home');
    expect(res.status).toBe(200);
    expect(menuHasAuditLog(res.body)).toBe(false);
  });

  it('AUD-01 a caller in no organization reads no rows on the Audit Log page', async () => {
    const res = await page(noOrgAuditor, '/admin/audit-log');
    expect(res.status).toBe(200);
    for (const row of ['fabrikam-scan', 'northwind-scan', 'system-scan']) expect(res.body, row).not.toContain(row);
    // Positive control: a global administrator's page lists all three rows.
    const admin = await page(globalAdmin, '/admin/audit-log');
    for (const row of ['fabrikam-scan', 'northwind-scan', 'system-scan']) expect(admin.body, row).toContain(row);
  });

  it('AUD-01 a caller in no organization reads no rows through GraphQL auditLog', async () => {
    const query = async (session: HarnessSession) => {
      const res = await h.app.inject({
        method: 'POST', url: '/graphql', cookies: { session: session.cookie },
        headers: { 'content-type': 'application/json' },
        payload: { query: '{ auditLog(limit: 200) { totalCount nodes { resourceId } } }' },
      });
      expect(res.statusCode, res.body).toBe(200);
      const data = (res.json() as { data?: { auditLog?: { totalCount: number; nodes: { resourceId: string | null }[] } } }).data;
      return data?.auditLog;
    };
    const none = await query(noOrgAuditor);
    expect(none).toEqual({ totalCount: 0, nodes: [] });
    // Positive control: the Owner reads the Owner organization's row through the same query.
    const ownerRows = (await query(owner))?.nodes.map((n) => n.resourceId) ?? [];
    expect(ownerRows).toContain('fabrikam-scan');
    expect(ownerRows).not.toContain('northwind-scan');
  });
});

describe('the sidebar marks one current page', () => {
  const currentLinks = (html: string): (string | null)[] =>
    [...new JSDOM(html).window.document.querySelectorAll('a[aria-current="page"]')].map((a) => a.getAttribute('href'));

  it('the Audit Log page marks only the Audit Log entry as the current page', async () => {
    const res = await page(owner, '/admin/audit-log');
    expect(res.status).toBe(200);
    expect(currentLinks(res.body)).toEqual(['/admin/audit-log']);
  });

  it('the Agent audit page marks only the Agent audit entry as the current page', async () => {
    const res = await page(owner, '/admin/audit');
    expect(res.status).toBe(200);
    expect(currentLinks(res.body)).toEqual(['/admin/audit']);
  });
});

describe('AUD-02 the Action and Resource Type filters show the active filter', () => {
  const actionSelect = (html: string): HTMLSelectElement =>
    new JSDOM(html).window.document.querySelector('select#filter-action') as HTMLSelectElement;
  const selectedValues = (select: HTMLSelectElement): string[] =>
    [...select.querySelectorAll('option')].filter((o) => o.hasAttribute('selected')).map((o) => o.getAttribute('value') ?? '');

  it('AUD-02 the rendered Action filter shows the dismissal filter as selected', async () => {
    const res = await page(owner, '/admin/audit-log?action=issue_dismissal.mark');
    expect(res.status).toBe(200);
    const select = actionSelect(res.body);
    expect(selectedValues(select)).toEqual(['issue_dismissal.mark']);
    const labels = new Map([...select.querySelectorAll('option')].map((o) => [o.getAttribute('value'), (o.textContent ?? '').trim()]));
    expect(labels.get('issue_dismissal.mark')).toBe('Finding dismissed as false positive');
    expect(labels.get('issue_dismissal.revoke')).toBe('Dismissal revoked');
  });

  it('AUD-02 the rendered All actions option is selected only without an action filter', async () => {
    const without = actionSelect((await page(owner, '/admin/audit-log')).body);
    expect(selectedValues(without)).toEqual(['']);
    const withFilter = actionSelect((await page(owner, '/admin/audit-log?action=login.success')).body);
    expect(selectedValues(withFilter)).toEqual(['login.success']);
  });

  it('AUD-02 an unlisted filter value is shown as escaped text', async () => {
    const raw = '<b>fabrikam</b>';
    const res = await page(owner, `/admin/audit-log?action=${encodeURIComponent(raw)}&resourceType=${encodeURIComponent(raw)}`);
    expect(res.status).toBe(200);
    const doc = new JSDOM(res.body).window.document;
    const select = doc.querySelector('select#filter-action') as HTMLSelectElement;
    const selected = [...select.querySelectorAll('option')].filter((o) => o.hasAttribute('selected'));
    expect(selected.map((o) => (o.textContent ?? '').trim())).toEqual([raw]);
    expect(doc.querySelector('select#filter-action b')).toBeNull();
    expect(doc.querySelector('select#filter-resource-type b')).toBeNull();
    const typeSelected = [...doc.querySelectorAll('select#filter-resource-type option')].filter((o) => o.hasAttribute('selected'));
    expect(typeSelected.map((o) => (o.textContent ?? '').trim())).toEqual([raw]);
  });
});

describe('AUD-03 a refusal answers a browser with the dashboard error page', () => {
  it('AUD-03 opening the Audit Log without permission renders the HTML error page', async () => {
    const res = await page(member, '/admin/audit-log', { accept: HTML_ACCEPT });
    expect(res.status).toBe(403);
    expect(res.contentType).toContain('text/html');
    expect(res.body).toContain('<h1 class="error-card__title">Access Denied</h1>');
    expect(res.body).not.toContain('"statusCode"');
  });

  it('AUD-03 a JSON caller without permission still gets a JSON 403', async () => {
    const res = await page(member, '/admin/audit-log', { accept: 'application/json' });
    expect(res.status).toBe(403);
    expect(res.contentType).toContain('application/json');
    expect(() => JSON.parse(res.body)).not.toThrow();
  });

  it('AUD-03 an HTMX caller without permission still gets a JSON 403', async () => {
    const res = await page(member, '/admin/audit-log', { accept: HTML_ACCEPT, 'hx-request': 'true' });
    expect(res.status).toBe(403);
    expect(res.contentType).toContain('application/json');
    expect(() => JSON.parse(res.body)).not.toThrow();
  });
});

describe('TEAM-02 Load More carries the page limit', () => {
  it('TEAM-02 the Audit Log Load More link carries the page limit', async () => {
    for (const id of ['fabrikam-scan-2', 'fabrikam-scan-3']) {
      await h.seed.audit.log({ actor: 'fabrikam-owner', action: 'scan.create', resourceType: 'scan', resourceId: id, orgId: fabrikamOrgId });
    }
    const res = await page(owner, '/admin/audit-log?limit=2');
    expect(res.status).toBe(200);
    const link = new JSDOM(res.body).window.document.querySelector('.load-more a');
    expect(link, 'Load More link rendered').not.toBeNull();
    const href = link?.getAttribute('href') ?? '';
    expect(href).toContain('limit=2&');
    expect(href).toContain('offset=2');
  });
});
