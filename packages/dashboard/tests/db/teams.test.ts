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

function makeTeamInput(overrides: Partial<{ name: string; description: string; orgId: string }> = {}) {
  return {
    name: `Team-${randomUUID().slice(0, 8)}`,
    description: 'A test team',
    orgId: 'org-1',
    ...overrides,
  };
}

describe('TeamRepository', () => {
  describe('createTeam', () => {
    it('creates with name, description, and orgId', async () => {
      const input = makeTeamInput({ name: 'Engineering', description: 'Core eng team', orgId: 'org-1' });
      const team = await storage.teams.createTeam(input);

      expect(team.id).toBeTruthy();
      expect(team.name).toBe('Engineering');
      expect(team.description).toBe('Core eng team');
      expect(team.orgId).toBe('org-1');
      expect(team.createdAt).toBeTruthy();
    });

    it('starts with memberCount of 0', async () => {
      const team = await storage.teams.createTeam(makeTeamInput());
      expect(team.memberCount).toBe(0);
    });
  });

  describe('getTeam', () => {
    it('returns team with members array', async () => {
      const team = await storage.teams.createTeam(makeTeamInput());
      const result = await storage.teams.getTeam(team.id);
      expect(result).not.toBeNull();
      expect(result?.id).toBe(team.id);
      expect(Array.isArray(result?.members)).toBe(true);
    });

    it('returns null for non-existent ID', async () => {
      const result = await storage.teams.getTeam('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('getTeamByName', () => {
    it('finds by name', async () => {
      const input = makeTeamInput({ name: 'Accessibility', orgId: 'org-1' });
      await storage.teams.createTeam(input);

      const result = await storage.teams.getTeamByName('Accessibility');
      expect(result).not.toBeNull();
      expect(result?.name).toBe('Accessibility');
    });

    it('scopes by orgId', async () => {
      await storage.teams.createTeam(makeTeamInput({ name: 'Alpha', orgId: 'org-A' }));
      await storage.teams.createTeam(makeTeamInput({ name: 'Alpha', orgId: 'org-B' }));

      const resultA = await storage.teams.getTeamByName('Alpha', 'org-A');
      expect(resultA?.orgId).toBe('org-A');

      const resultB = await storage.teams.getTeamByName('Alpha', 'org-B');
      expect(resultB?.orgId).toBe('org-B');
    });

    it('returns null when name not found', async () => {
      const result = await storage.teams.getTeamByName('no-such-team');
      expect(result).toBeNull();
    });
  });

  describe('listTeams', () => {
    it('returns empty array when no teams', async () => {
      const result = await storage.teams.listTeams();
      expect(result).toEqual([]);
    });

    it('returns teams with member counts', async () => {
      const team = await storage.teams.createTeam(makeTeamInput());
      const user = await storage.users.createUser('testuser', 'password', 'user');
      await storage.teams.addTeamMember(team.id, user.id);

      const result = await storage.teams.listTeams();
      const found = result.find((t) => t.id === team.id);
      expect(found?.memberCount).toBe(1);
    });

    it('filters by orgId (returns matching org + system)', async () => {
      await storage.teams.createTeam(makeTeamInput({ orgId: 'org-A' }));
      await storage.teams.createTeam(makeTeamInput({ orgId: 'org-B' }));

      const result = await storage.teams.listTeams('org-A');
      expect(result.every((t) => t.orgId === 'org-A' || t.orgId === 'system')).toBe(true);
    });

    it('orders by name ASC', async () => {
      await storage.teams.createTeam(makeTeamInput({ name: 'Zebra' }));
      await storage.teams.createTeam(makeTeamInput({ name: 'Alpha' }));
      await storage.teams.createTeam(makeTeamInput({ name: 'Mango' }));

      const result = await storage.teams.listTeams('org-1');
      const names = result.map((t) => t.name);
      expect(names).toEqual([...names].sort());
    });
  });

  describe('updateTeam', () => {
    it('updates name', async () => {
      const team = await storage.teams.createTeam(makeTeamInput({ name: 'OldName' }));
      await storage.teams.updateTeam(team.id, { name: 'NewName' });
      const updated = await storage.teams.getTeam(team.id);
      expect(updated?.name).toBe('NewName');
    });

    it('updates description', async () => {
      const team = await storage.teams.createTeam(makeTeamInput({ description: 'Old desc' }));
      await storage.teams.updateTeam(team.id, { description: 'New desc' });
      const updated = await storage.teams.getTeam(team.id);
      expect(updated?.description).toBe('New desc');
    });

    it('no-op when empty update object', async () => {
      const team = await storage.teams.createTeam(makeTeamInput({ name: 'Stable' }));
      await expect(storage.teams.updateTeam(team.id, {})).resolves.not.toThrow();
      const unchanged = await storage.teams.getTeam(team.id);
      expect(unchanged?.name).toBe('Stable');
    });
  });

  describe('deleteTeam', () => {
    it('removes the team', async () => {
      const team = await storage.teams.createTeam(makeTeamInput());
      await storage.teams.deleteTeam(team.id);
      expect(await storage.teams.getTeam(team.id)).toBeNull();
    });

    it('cascades to team_members', async () => {
      const team = await storage.teams.createTeam(makeTeamInput());
      const user = await storage.users.createUser('memberUser', 'password', 'user');
      await storage.teams.addTeamMember(team.id, user.id);

      await storage.teams.deleteTeam(team.id);

      // Team is gone
      expect(await storage.teams.getTeam(team.id)).toBeNull();
      // Members are also gone (listTeamMembers returns empty)
      const members = await storage.teams.listTeamMembers(team.id);
      expect(members).toHaveLength(0);
    });
  });

  describe('addTeamMember', () => {
    it('adds member with default role=member', async () => {
      const team = await storage.teams.createTeam(makeTeamInput());
      const user = await storage.users.createUser('roleTestUser', 'password', 'user');
      await storage.teams.addTeamMember(team.id, user.id);

      const members = await storage.teams.listTeamMembers(team.id);
      expect(members).toHaveLength(1);
      expect(members[0].role).toBe('member');
    });

    it('adds member with custom role', async () => {
      const team = await storage.teams.createTeam(makeTeamInput());
      const user = await storage.users.createUser('adminUser', 'password', 'admin');
      await storage.teams.addTeamMember(team.id, user.id, 'owner');

      const members = await storage.teams.listTeamMembers(team.id);
      expect(members).toHaveLength(1);
      expect(members[0].role).toBe('owner');
    });

    it('ignores duplicate member insert (INSERT OR IGNORE)', async () => {
      const team = await storage.teams.createTeam(makeTeamInput());
      const user = await storage.users.createUser('dupeUser', 'password', 'user');
      await storage.teams.addTeamMember(team.id, user.id);
      await expect(storage.teams.addTeamMember(team.id, user.id)).resolves.not.toThrow();

      const members = await storage.teams.listTeamMembers(team.id);
      expect(members).toHaveLength(1);
    });
  });

  describe('removeTeamMember', () => {
    it('removes a member from the team', async () => {
      const team = await storage.teams.createTeam(makeTeamInput());
      const user = await storage.users.createUser('removeMe', 'password', 'user');
      await storage.teams.addTeamMember(team.id, user.id);
      await storage.teams.removeTeamMember(team.id, user.id);

      const members = await storage.teams.listTeamMembers(team.id);
      expect(members).toHaveLength(0);
    });
  });

  describe('listTeamMembers', () => {
    it('returns members with usernames from join', async () => {
      const team = await storage.teams.createTeam(makeTeamInput());
      const user = await storage.users.createUser('knownUser', 'password', 'user');
      await storage.teams.addTeamMember(team.id, user.id);

      const members = await storage.teams.listTeamMembers(team.id);
      expect(members).toHaveLength(1);
      expect(members[0].username).toBe('knownUser');
      expect(members[0].userId).toBe(user.id);
    });

    it('falls back to userId when user not in dashboard_users', async () => {
      const team = await storage.teams.createTeam(makeTeamInput());
      const fakeUserId = 'external-user-' + randomUUID();

      // Insert directly without creating a dashboard user
      const db = storage.getRawDatabase();
      db.prepare('INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)').run(team.id, fakeUserId, 'member');

      const members = await storage.teams.listTeamMembers(team.id);
      expect(members).toHaveLength(1);
      expect(members[0].username).toBe(fakeUserId);
    });
  });
});
