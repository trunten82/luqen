/**
 * The Audit Log page through the REAL createServer and real cookie routes
 * (tests/helpers/mcp-oauth-harness.ts).
 *
 * Phase 95 plan 02: AUD-01 (an org Owner holding audit view reaches the page from the menu, and the
 * page stays scoped to the Owner's organization), AUD-02 (the Action filter), AUD-03 (the HTML error
 * page for a browser without permission, JSON for the others) and TEAM-02 (Load More carries the
 * page limit).
 *
 * Public repo: Fabrikam and Northwind placeholders only. Logins per file: 3 (the login route is
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
  owner = await signIn('fabrikam-audit-owner', fabrikamOrgId);
  member = await signIn('fabrikam-audit-member', fabrikamOrgId);
  globalAdmin = await signIn('fabrikam-audit-admin', null);
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
