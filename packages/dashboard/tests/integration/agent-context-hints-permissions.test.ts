/**
 * HARD-21: the assistant's context hints (recent scans, brand guideline names, the active
 * organization) are read with the stored user's permissions in the conversation's organization.
 *
 *   - a user the stored-caller rule refuses (deactivated, not a member) gets no hints at all
 *   - recent scans need reports.view; brand guideline names need branding.view
 *
 * Every test drives the real in-process chain (tests/helpers/agent-chain.ts); the scripted model
 * records the hints block it receives on each call. Scans and guidelines are seeded with placeholder
 * site URLs and names.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildAgentChain, type AgentChain } from '../helpers/agent-chain.js';

const FIRST_SITE = 'https://fabrikam.example/';
const SECOND_SITE = 'https://northwind.example/';
const GUIDELINE = 'Fabrikam House Style';

interface Member {
  readonly userId: string;
  readonly teamId: string;
}

describe('HARD-21 the assistant context hints follow the stored user', () => {
  let chain: AgentChain;
  let orgId: string;

  /** A member with global role 'viewer' (no global permission) whose org role holds exactly `permissions`. */
  async function addMember(username: string, permissions: readonly string[]): Promise<Member> {
    const role = await chain.storage.roles.createRole({
      name: `${username}-role`, description: '', permissions, orgId,
    });
    const userId = await chain.addUser(username, 'viewer');
    const team = await chain.storage.teams.createTeam({ name: `${username}-team`, description: '', orgId, roleId: role.id });
    await chain.storage.teams.addTeamMember(team.id, userId);
    await chain.storage.organizations.addMember(orgId, userId, 'member');
    return { userId, teamId: team.id };
  }

  async function hintsOfTurn(userId: string): Promise<string> {
    const before = chain.hints.length;
    chain.script([{ text: 'Hello.', toolCalls: [] }]);
    await chain.runTurn(userId, orgId, 'hello');
    return chain.hints.slice(before).join('\n');
  }

  beforeEach(async () => {
    chain = await buildAgentChain();
    orgId = await chain.createOrg('Fabrikam Hints');
    for (const siteUrl of [FIRST_SITE, SECOND_SITE]) {
      await chain.storage.scans.createScan({
        id: randomUUID(), siteUrl, standard: 'WCAG2AA', jurisdictions: [],
        createdBy: 'fabrikam-seed', createdAt: new Date().toISOString(), orgId,
      });
    }
    await chain.storage.branding.createGuideline({ id: randomUUID(), orgId, name: GUIDELINE });
  });
  afterEach(async () => {
    await chain.cleanup();
  });

  it('HARD-21 the assistant hints name no scan for a user without the reports view permission', async () => {
    const member = await addMember('fabrikam-brand-reader', ['branding.view']);

    const hints = await hintsOfTurn(member.userId);

    expect(hints).toContain('Fabrikam Hints'); // the organization line stays
    expect(hints).toContain(GUIDELINE); // positive control: branding.view lists the guideline names
    expect(hints).not.toContain(FIRST_SITE);
    expect(hints).not.toContain(SECOND_SITE);
  });

  it('HARD-21 the assistant gives no hints to a deactivated user', async () => {
    const member = await addMember('fabrikam-former', ['reports.view', 'branding.view']);
    expect(await hintsOfTurn(member.userId)).toContain(FIRST_SITE); // positive control while active

    await chain.storage.users.deactivateUser(member.userId);
    const before = chain.hints.length;
    chain.script([{ text: 'Hello.', toolCalls: [] }]);
    await chain.runTurn(member.userId, orgId, 'hello again');

    expect(chain.hints.length).toBeGreaterThan(before);
    for (const block of chain.hints.slice(before)) expect(block).toBe('');
  });

  it('HARD-21 the assistant gives no hints in an organization the user left', async () => {
    const member = await addMember('fabrikam-leaver', ['reports.view', 'branding.view']);
    expect(await hintsOfTurn(member.userId)).toContain(FIRST_SITE); // positive control while a member

    await chain.storage.teams.removeTeamMember(member.teamId, member.userId);
    await chain.storage.organizations.removeMember(orgId, member.userId);
    const before = chain.hints.length;
    chain.script([{ text: 'Hello.', toolCalls: [] }]);
    await chain.runTurn(member.userId, orgId, 'hello again');

    expect(chain.hints.length).toBeGreaterThan(before);
    for (const block of chain.hints.slice(before)) expect(block).toBe('');
  });

  it('HARD-21 the assistant hints list recent scans for a user with the reports view permission', async () => {
    const member = await addMember('fabrikam-report-reader', ['reports.view']);

    const hints = await hintsOfTurn(member.userId);

    expect(hints).toContain('Fabrikam Hints');
    expect(hints).toContain(FIRST_SITE);
    expect(hints).toContain(SECOND_SITE);
  });

  it('HARD-21 the assistant hints name no brand guideline for a user without the branding view permission', async () => {
    const member = await addMember('fabrikam-scan-reader', ['reports.view']);

    const hints = await hintsOfTurn(member.userId);

    expect(hints).toContain(FIRST_SITE); // positive control: reports.view lists the scans
    expect(hints).not.toContain(GUIDELINE);
  });
});
