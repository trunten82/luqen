import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';

let storage: SqliteStorageAdapter;
let dbPath: string;

async function seedOrg(slug: string): Promise<string> {
  const org = await storage.organizations.createOrg({ name: slug, slug });
  return org.id;
}

async function seedTeam(homeOrgId: string, name: string): Promise<string> {
  const team = await storage.teams.createTeam({
    name,
    description: '',
    orgId: homeOrgId,
  });
  return team.id;
}

beforeEach(async () => {
  dbPath = join(tmpdir(), `test-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
});

afterEach(async () => {
  await storage.disconnect();
  if (existsSync(dbPath)) rmSync(dbPath);
});

describe('SqliteTeamOrgLinkRepository — links', () => {
  it('link is idempotent on (teamId, orgId)', async () => {
    const homeOrg = await seedOrg('home');
    const otherOrg = await seedOrg('other');
    const teamId = await seedTeam(homeOrg, 'Compliance');

    const a = await storage.teamOrgLinks.link(teamId, otherOrg, 'u-admin');
    const b = await storage.teamOrgLinks.link(teamId, otherOrg, 'u-admin');
    expect(a.teamId).toBe(b.teamId);
    expect(a.orgId).toBe(b.orgId);
    expect(a.linkedAt).toBe(b.linkedAt);
  });

  it('listLinksForTeam + listLinksForOrg surface both directions', async () => {
    const home = await seedOrg('home');
    const eu = await seedOrg('eu');
    const us = await seedOrg('us');
    const teamId = await seedTeam(home, 'Compliance');

    await storage.teamOrgLinks.link(teamId, eu, 'u');
    await storage.teamOrgLinks.link(teamId, us, 'u');

    const byTeam = await storage.teamOrgLinks.listLinksForTeam(teamId);
    expect(byTeam.map((l) => l.orgId).sort()).toEqual([eu, us].sort());

    const byOrg = await storage.teamOrgLinks.listLinksForOrg(eu);
    expect(byOrg.length).toBe(1);
    expect(byOrg[0].teamId).toBe(teamId);
  });

  it('unlink returns true once, false thereafter', async () => {
    const home = await seedOrg('home');
    const other = await seedOrg('other');
    const teamId = await seedTeam(home, 'T');
    await storage.teamOrgLinks.link(teamId, other, 'u');
    expect(await storage.teamOrgLinks.unlink(teamId, other)).toBe(true);
    expect(await storage.teamOrgLinks.unlink(teamId, other)).toBe(false);
    expect(await storage.teamOrgLinks.getLink(teamId, other)).toBeNull();
  });
});

describe('SqliteTeamOrgLinkRepository — invites', () => {
  it('inviteCreate issues a pending invite', async () => {
    const home = await seedOrg('home');
    const target = await seedOrg('target');
    const teamId = await seedTeam(home, 'T');
    const invite = await storage.teamOrgLinks.inviteCreate(teamId, target, 'u-admin');
    expect(invite).not.toBeNull();
    expect(invite!.id).toMatch(/^tinv_/);
    expect(invite!.status).toBe('pending');
    expect(invite!.invitedBy).toBe('u-admin');
  });

  it('inviteCreate rejects a duplicate pending invite for same (team, target)', async () => {
    const home = await seedOrg('home');
    const target = await seedOrg('target');
    const teamId = await seedTeam(home, 'T');
    const a = await storage.teamOrgLinks.inviteCreate(teamId, target, 'u');
    const b = await storage.teamOrgLinks.inviteCreate(teamId, target, 'u');
    expect(a).not.toBeNull();
    expect(b).toBeNull();
  });

  it('inviteAccept promotes the invite to a link and is idempotent', async () => {
    const home = await seedOrg('home');
    const target = await seedOrg('target');
    const teamId = await seedTeam(home, 'T');
    const invite = await storage.teamOrgLinks.inviteCreate(teamId, target, 'u-admin');
    const link = await storage.teamOrgLinks.inviteAccept(invite!.id, 'u-target-admin');
    expect(link).not.toBeNull();
    expect(link!.teamId).toBe(teamId);
    expect(link!.orgId).toBe(target);
    expect(link!.linkedBy).toBe('u-target-admin');

    const updated = await storage.teamOrgLinks.inviteGet(invite!.id);
    expect(updated!.status).toBe('accepted');
    expect(updated!.decidedBy).toBe('u-target-admin');

    const reAccept = await storage.teamOrgLinks.inviteAccept(invite!.id, 'u-target-admin');
    expect(reAccept).not.toBeNull();
    expect(reAccept!.orgId).toBe(target);
  });

  it('inviteAccept after decline returns null', async () => {
    const home = await seedOrg('home');
    const target = await seedOrg('target');
    const teamId = await seedTeam(home, 'T');
    const invite = await storage.teamOrgLinks.inviteCreate(teamId, target, 'u');
    await storage.teamOrgLinks.inviteDecline(invite!.id, 'u-target-admin');
    const accept = await storage.teamOrgLinks.inviteAccept(invite!.id, 'u-target-admin');
    expect(accept).toBeNull();
  });

  it('a second pending invite is allowed after the first declines', async () => {
    const home = await seedOrg('home');
    const target = await seedOrg('target');
    const teamId = await seedTeam(home, 'T');
    const a = await storage.teamOrgLinks.inviteCreate(teamId, target, 'u');
    await storage.teamOrgLinks.inviteDecline(a!.id, 'u-target');
    const b = await storage.teamOrgLinks.inviteCreate(teamId, target, 'u');
    expect(b).not.toBeNull();
    expect(b!.id).not.toBe(a!.id);
  });

  it('inviteRevoke flips status and records decider', async () => {
    const home = await seedOrg('home');
    const target = await seedOrg('target');
    const teamId = await seedTeam(home, 'T');
    const invite = await storage.teamOrgLinks.inviteCreate(teamId, target, 'u-admin');
    const revoked = await storage.teamOrgLinks.inviteRevoke(invite!.id, 'u-admin');
    expect(revoked!.status).toBe('revoked');
    expect(revoked!.decidedBy).toBe('u-admin');
  });

  it('inviteListPendingForOrg only surfaces pending invites targeting that org', async () => {
    const home = await seedOrg('home');
    const tgt1 = await seedOrg('t1');
    const tgt2 = await seedOrg('t2');
    const teamId = await seedTeam(home, 'T');
    const p1 = await storage.teamOrgLinks.inviteCreate(teamId, tgt1, 'u');
    await storage.teamOrgLinks.inviteCreate(teamId, tgt2, 'u');
    await storage.teamOrgLinks.inviteDecline(p1!.id, 'u-t1');
    const pendingForT1 = await storage.teamOrgLinks.inviteListPendingForOrg(tgt1);
    const pendingForT2 = await storage.teamOrgLinks.inviteListPendingForOrg(tgt2);
    expect(pendingForT1.length).toBe(0);
    expect(pendingForT2.length).toBe(1);
  });

  it('inviteListByTeam returns all statuses, newest first', async () => {
    const home = await seedOrg('home');
    const target = await seedOrg('target');
    const teamId = await seedTeam(home, 'T');
    const a = await storage.teamOrgLinks.inviteCreate(teamId, target, 'u');
    await storage.teamOrgLinks.inviteDecline(a!.id, 'u-target');
    // small delay to keep timestamps distinct
    await new Promise((r) => setTimeout(r, 10));
    const b = await storage.teamOrgLinks.inviteCreate(teamId, target, 'u');
    const all = await storage.teamOrgLinks.inviteListByTeam(teamId);
    expect(all.length).toBe(2);
    expect(all[0].id).toBe(b!.id);
    expect(all[1].status).toBe('declined');
  });
});
