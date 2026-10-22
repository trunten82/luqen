/**
 * The team page through the REAL createServer and real cookie routes
 * (tests/helpers/mcp-oauth-harness.ts).
 *
 * Phase 95 plan 03: TEAM-01 (Add Member offers the organization's teamless members, and the add
 * request accepts exactly the users the list offers), TEAM-03 (the empty members row goes after the
 * first add) and TEAM-04 (the team form's empty organization option names the current organization).
 *
 * Public repo: Fabrikam and Northwind placeholders only. Logins per file: 2 (the login route is rate
 * limited).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { startMcpOauthHarness, type HarnessSession, type McpOauthHarness } from '../helpers/mcp-oauth-harness.js';
import { getLocaleData, loadTranslations, SUPPORTED_LOCALES, t } from '../../src/i18n/index.js';

const PASSWORD = 'Fabrikam-Team-42!';
const FABRIKAM_NAME = 'Fabrikam Team Add';

let h: McpOauthHarness;
let fabrikamOrgId: string;
let owner: HarnessSession;
let globalAdmin: HarnessSession;
const userIds = new Map<string, string>();

async function seedUser(username: string): Promise<string> {
  const user = await h.seed.users.createUser(username, PASSWORD, 'user');
  userIds.set(username, user.id);
  return user.id;
}

async function seedTeam(name: string, orgId: string): Promise<string> {
  const team = await h.seed.teams.createTeam({ name, description: '', orgId });
  return team.id;
}

/** The user names offered by the Add Member list of one team page (the text before the role). */
async function addMemberOptions(session: HarnessSession, teamId: string): Promise<string[]> {
  const res = await h.app.inject({ method: 'GET', url: `/admin/teams/${teamId}`, cookies: { session: session.cookie } });
  expect(res.statusCode, 'GET team page').toBe(200);
  const doc = new JSDOM(res.body).window.document;
  return Array.from(doc.querySelectorAll('select[name="userId"] option'))
    .map((o) => (o.textContent ?? '').trim())
    .filter((text) => text !== '' && !text.startsWith('Select a user'))
    .map((text) => text.replace(/ \(.*\)$/, ''));
}

async function addMember(session: HarnessSession, teamId: string, userId: string, htmx: boolean) {
  return await h.app.inject({
    method: 'POST',
    url: `/admin/teams/${teamId}/members`,
    cookies: { session: session.cookie },
    headers: {
      'x-csrf-token': session.csrf,
      'content-type': 'application/x-www-form-urlencoded',
      ...(htmx ? { 'hx-request': 'true' } : {}),
    },
    payload: new URLSearchParams({ userId }).toString(),
  });
}

async function memberIdsOf(teamId: string): Promise<string[]> {
  const team = await h.seed.teams.getTeam(teamId);
  return (team?.members ?? []).map((m) => m.userId);
}

beforeAll(async () => {
  loadTranslations();
  h = await startMcpOauthHarness('team-add-member');
  const fabrikam = await h.seed.organizations.createOrg({ name: FABRIKAM_NAME, slug: 'fabrikam-team-add' });
  const northwind = await h.seed.organizations.createOrg({ name: 'Northwind Team Add', slug: 'northwind-team-add' });
  fabrikamOrgId = fabrikam.id;

  // The Owner of Fabrikam (Owners team + org membership 'owner').
  const ownerId = await seedUser('fabrikam-owner');
  const ownerRole = await h.seed.roles.getRoleByNameAndOrg('Owner', fabrikam.id);
  const ownersTeam = await h.seed.teams.createTeam({ name: 'fabrikam-owners', description: '', orgId: fabrikam.id, roleId: ownerRole!.id });
  await h.seed.teams.addTeamMember(ownersTeam.id, ownerId);
  await h.seed.organizations.addMember(fabrikam.id, ownerId, 'owner');

  // A second Fabrikam team with a member.
  const reviewerId = await seedUser('fabrikam-reviewer');
  const reviewers = await seedTeam('fabrikam-reviewers', fabrikam.id);
  await h.seed.teams.addTeamMember(reviewers, reviewerId);

  // A Fabrikam member who is in no team.
  const teamlessId = await seedUser('fabrikam-teamless');
  await h.seed.organizations.addMember(fabrikam.id, teamlessId, 'member');

  // A Northwind member in a Northwind team.
  const northwindMemberId = await seedUser('northwind-member');
  const northwindTeam = await seedTeam('northwind-staff', northwind.id);
  await h.seed.teams.addTeamMember(northwindTeam, northwindMemberId);

  // A member of BOTH organizations who is in no team.
  const sharedId = await seedUser('shared-teamless');
  await h.seed.organizations.addMember(fabrikam.id, sharedId, 'member');
  await h.seed.organizations.addMember(northwind.id, sharedId, 'member');

  await h.seed.users.createUser('fabrikam-global-admin', PASSWORD, 'admin');

  const ownerLogin = await h.login('fabrikam-owner', PASSWORD);
  expect(ownerLogin.status, 'login owner').toBe(302);
  const switched = await h.switchOrg(ownerLogin.session, fabrikam.id);
  expect(switched.status, 'switch owner').toBeLessThan(400);
  owner = switched.session;
  const adminLogin = await h.login('fabrikam-global-admin', PASSWORD);
  expect(adminLogin.status, 'login global admin').toBe(302);
  globalAdmin = adminLogin.session;
}, 120_000);

afterAll(async () => {
  if (h !== undefined) await h.close();
});

describe('team page: Add Member offers what the add request accepts', () => {
  it('TEAM-01 Add Member offers an organization member who is in no team', async () => {
    const teamId = await seedTeam('fabrikam-list-a', fabrikamOrgId);
    const options = await addMemberOptions(owner, teamId);
    expect(options).toContain('fabrikam-teamless');
  }, 60_000);

  it('TEAM-01 Add Member still offers a member of another team of the organization', async () => {
    const teamId = await seedTeam('fabrikam-list-b', fabrikamOrgId);
    const options = await addMemberOptions(owner, teamId);
    expect(options).toContain('fabrikam-reviewer');
    expect(options).toContain('fabrikam-owner');
  }, 60_000);

  it('TEAM-01 Add Member does not offer a teamless member who also belongs to another organization', async () => {
    const teamId = await seedTeam('fabrikam-list-c', fabrikamOrgId);
    const options = await addMemberOptions(owner, teamId);
    expect(options).not.toContain('shared-teamless');
    // Positive control: the list is not empty, so the absence above is about this user.
    expect(options.length).toBeGreaterThan(0);
  }, 60_000);

  it('TEAM-01 Add Member does not offer a user of another organization', async () => {
    const teamId = await seedTeam('fabrikam-list-d', fabrikamOrgId);
    const options = await addMemberOptions(owner, teamId);
    expect(options).not.toContain('northwind-member');
    expect(options).toContain('fabrikam-reviewer');
  }, 60_000);

  it('TEAM-01 the add member request refuses a user the list does not offer', async () => {
    const teamId = await seedTeam('fabrikam-refuse', fabrikamOrgId);
    const trail: string[] = [];
    for (const username of ['northwind-member', 'shared-teamless']) {
      const res = await addMember(owner, teamId, userIds.get(username)!, true);
      trail.push(`${username}=${res.statusCode}`);
      expect(res.statusCode, trail.join(' ')).toBe(403);
      expect(res.body, trail.join(' ')).toContain('This user cannot be added to this team');
    }
    const plain = await addMember(owner, teamId, userIds.get('northwind-member')!, false);
    trail.push(`plain=${plain.statusCode}`);
    expect(plain.statusCode, trail.join(' ')).toBe(403);
    expect(plain.json(), trail.join(' ')).toEqual({ error: 'This user cannot be added to this team' });
    expect(await memberIdsOf(teamId), trail.join(' ')).toEqual([]);
  }, 60_000);

  it('TEAM-01 the add member request adds a teamless organization member', async () => {
    const teamId = await seedTeam('fabrikam-accept', fabrikamOrgId);
    const teamlessId = userIds.get('fabrikam-teamless')!;
    const res = await addMember(owner, teamId, teamlessId, true);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(`id="member-row-${teamlessId}"`);
    expect(res.body).toContain('fabrikam-teamless');
    expect(await memberIdsOf(teamId)).toContain(teamlessId);
  }, 60_000);

  it('TEAM-01 the add member request refuses a user who is already a member', async () => {
    const teamId = await seedTeam('fabrikam-already', fabrikamOrgId);
    const reviewerId = userIds.get('fabrikam-reviewer')!;
    await h.seed.teams.addTeamMember(teamId, reviewerId);
    const options = await addMemberOptions(owner, teamId);
    expect(options).not.toContain('fabrikam-reviewer');
    const res = await addMember(owner, teamId, reviewerId, false);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'This user cannot be added to this team' });
    expect(await memberIdsOf(teamId)).toEqual([reviewerId]);
  }, 60_000);

  it('TEAM-01 a global administrator Add Member still offers every active user', async () => {
    const teamId = await seedTeam('fabrikam-list-admin', fabrikamOrgId);
    const options = await addMemberOptions(globalAdmin, teamId);
    for (const username of ['fabrikam-teamless', 'fabrikam-reviewer', 'shared-teamless', 'northwind-member']) {
      expect(options, username).toContain(username);
    }
    // The global administrator may bind the shared user (nothing in the list is withheld).
    const res = await addMember(globalAdmin, teamId, userIds.get('shared-teamless')!, true);
    expect(res.statusCode).toBe(200);
  }, 60_000);
});

describe('team page: the empty members row', () => {
  it('TEAM-03 adding the first member removes the empty members row', async () => {
    const teamId = await seedTeam('fabrikam-first', fabrikamOrgId);
    // The team page (team-detail.hbs) renders the empty row the out-of-band delete targets.
    const pageRes = await h.app.inject({ method: 'GET', url: `/admin/teams/${teamId}`, cookies: { session: owner.cookie } });
    expect(pageRes.statusCode).toBe(200);
    const emptyRow = new JSDOM(pageRes.body).window.document.querySelector('#members-empty-row');
    expect(emptyRow, 'the team page renders id="members-empty-row"').not.toBeNull();
    expect(emptyRow!.tagName).toBe('TR');

    const reviewerId = userIds.get('fabrikam-reviewer')!;
    const res = await addMember(owner, teamId, reviewerId, true);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(`<tr id="member-row-${reviewerId}">`);
    expect(res.body).toContain('<template><tr id="members-empty-row" hx-swap-oob="delete"></tr></template>');
    // The delete names the element the page rendered.
    const fragment = new JSDOM(`<table><tbody>${res.body}</tbody></table>`).window.document;
    const oobIds = [...fragment.querySelectorAll('template')]
      .flatMap((tpl) => [...(tpl as HTMLTemplateElement).content.querySelectorAll('[hx-swap-oob="delete"]')])
      .map((el) => el.id);
    expect(oobIds).toEqual([emptyRow!.id]);
  }, 60_000);

  it('TEAM-03 adding a further member sends no empty row removal', async () => {
    const teamId = await seedTeam('fabrikam-second', fabrikamOrgId);
    await h.seed.teams.addTeamMember(teamId, userIds.get('fabrikam-owner')!);
    const res = await addMember(owner, teamId, userIds.get('fabrikam-reviewer')!, true);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(`id="member-row-${userIds.get('fabrikam-reviewer')!}"`);
    expect(res.body).not.toContain('members-empty-row');
  }, 60_000);
});

describe('team page: the organization option', () => {
  it('TEAM-04 the team form empty organization option names the current organization', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/admin/teams', cookies: { session: owner.cookie } });
    expect(res.statusCode).toBe(200);
    const doc = new JSDOM(res.body).window.document;
    const option = doc.querySelector('select[name="organizationId"] option[value=""]');
    expect(option, 'the create form has an empty organization option').not.toBeNull();
    expect((option!.textContent ?? '').trim()).toBe(t('admin.teams.currentOrgOption', 'en', { name: FABRIKAM_NAME }));
    expect((option!.textContent ?? '').trim()).toBe(`Current organization (${FABRIKAM_NAME})`);
  }, 60_000);

  it('TEAM-04 the team page organization form keeps None global for an empty value', async () => {
    const teamId = await seedTeam('fabrikam-org-form', fabrikamOrgId);
    const res = await h.app.inject({ method: 'GET', url: `/admin/teams/${teamId}`, cookies: { session: owner.cookie } });
    expect(res.statusCode).toBe(200);
    const doc = new JSDOM(res.body).window.document;
    const option = doc.querySelector('select[name="organizationId"] option[value=""]');
    expect(option, 'the organization form has an empty option').not.toBeNull();
    expect((option!.textContent ?? '').trim()).toBe(t('admin.teams.noneGlobal', 'en'));
  }, 60_000);

  it('TEAM-04 the current organization option exists in every locale and differs from English', () => {
    const english = getLocaleData('en')['admin.teams.currentOrgOption'];
    expect(typeof english).toBe('string');
    expect(english).toContain('{{name}}');
    const problems: string[] = [];
    for (const locale of SUPPORTED_LOCALES.filter((l) => l !== 'en')) {
      const value = getLocaleData(locale)['admin.teams.currentOrgOption'];
      if (typeof value !== 'string' || value.trim() === '') problems.push(`${locale}: missing`);
      else if (!value.includes('{{name}}')) problems.push(`${locale}: no name placeholder`);
      else if (value === english) problems.push(`${locale}: is the English text`);
    }
    expect(problems).toEqual([]);
    // Positive control: the loop met five other locales.
    expect(SUPPORTED_LOCALES.length).toBe(6);
  });
});
