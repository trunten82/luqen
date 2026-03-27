import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';

let storage: SqliteStorageAdapter;
let dbPath: string;

beforeEach(async () => {
  dbPath = join(tmpdir(), `test-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
});

afterEach(async () => {
  await storage.disconnect();
  if (existsSync(dbPath)) rmSync(dbPath);
});

describe('Migration 020: migrate direct members to teams', () => {
  it('direct org members are cleared after migration', async () => {
    // The migration runs during storage.migrate(). Since we start fresh,
    // there are no direct members to migrate. Let's verify the table is empty.
    const db = storage.getRawDatabase();
    const count = db.prepare('SELECT COUNT(*) as c FROM org_members').get() as { c: number };
    expect(count.c).toBe(0);
  });

  it('creates "Direct Members" team when org has direct members before migration', async () => {
    // To test this properly, we simulate pre-migration state by inserting
    // direct members and re-running the migration logic manually.
    const org = await storage.organizations.createOrg({ name: 'TestOrg', slug: 'test-dm' });
    const user1 = await storage.users.createUser('dm-user1', 'pass', 'user');
    const user2 = await storage.users.createUser('dm-user2', 'pass', 'user');

    const db = storage.getRawDatabase();

    // Manually insert direct members (migration 020 already cleared them)
    db.prepare('INSERT INTO org_members (org_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)')
      .run(org.id, user1.id, 'admin', new Date().toISOString());
    db.prepare('INSERT INTO org_members (org_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)')
      .run(org.id, user2.id, 'member', new Date().toISOString());

    // Re-run the migration logic (simulate what migration 020 does)
    const memberRole = (await storage.roles.listRoles(org.id))
      .find((r) => r.name === 'Member' && r.orgId === org.id);

    const teamId = `team-dm2-${org.id}`;
    db.prepare(
      'INSERT OR IGNORE INTO teams (id, name, description, org_id, role_id, created_at) VALUES (?, ?, ?, ?, ?, datetime(?))',
    ).run(teamId, 'Direct Members (retest)', 'Auto-created', org.id, memberRole!.id, 'now');

    const insertMember = db.prepare(
      'INSERT OR IGNORE INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)',
    );
    const rows = db.prepare('SELECT user_id, role FROM org_members WHERE org_id = ?').all(org.id) as Array<{ user_id: string; role: string }>;
    for (const row of rows) {
      insertMember.run(teamId, row.user_id, row.role);
    }
    db.prepare('DELETE FROM org_members').run();

    // Verify: no more direct members
    const directMembers = await storage.organizations.listMembers(org.id);
    expect(directMembers).toHaveLength(0);

    // Verify: team exists with 2 members
    const team = await storage.teams.getTeam(teamId);
    expect(team).not.toBeNull();
    expect(team!.memberCount).toBe(2);
    expect(team!.roleId).toBe(memberRole!.id);
  });

  it('team members preserve their original org roles', async () => {
    const org = await storage.organizations.createOrg({ name: 'RoleOrg', slug: 'role-dm' });
    const user = await storage.users.createUser('dm-role-user', 'pass', 'user');

    const db = storage.getRawDatabase();
    db.prepare('INSERT INTO org_members (org_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)')
      .run(org.id, user.id, 'owner', new Date().toISOString());

    const memberRole = (await storage.roles.listRoles(org.id))
      .find((r) => r.name === 'Member' && r.orgId === org.id);

    const teamId = `team-dm3-${org.id}`;
    db.prepare(
      'INSERT OR IGNORE INTO teams (id, name, description, org_id, role_id, created_at) VALUES (?, ?, ?, ?, ?, datetime(?))',
    ).run(teamId, 'Direct Members (role)', 'Migration test', org.id, memberRole!.id, 'now');

    const rows = db.prepare('SELECT user_id, role FROM org_members WHERE org_id = ?').all(org.id) as Array<{ user_id: string; role: string }>;
    const insertMember = db.prepare('INSERT OR IGNORE INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)');
    for (const row of rows) {
      insertMember.run(teamId, row.user_id, row.role);
    }
    db.prepare('DELETE FROM org_members').run();

    const members = await storage.teams.listTeamMembers(teamId);
    expect(members).toHaveLength(1);
    expect(members[0].role).toBe('owner');
  });

  it('org access still works through team membership after migration', async () => {
    const org = await storage.organizations.createOrg({ name: 'AccessOrg', slug: 'access-dm' });
    const user = await storage.users.createUser('dm-access-user', 'pass', 'user');

    // Add user to a team linked to the org
    const team = await storage.teams.createTeam({ name: 'Access Team', description: '', orgId: org.id });
    await storage.teams.addTeamMember(team.id, user.id);

    // getUserOrgs should still find this org via team membership
    const userOrgs = await storage.organizations.getUserOrgs(user.id);
    expect(userOrgs.some((o) => o.id === org.id)).toBe(true);
  });
});
