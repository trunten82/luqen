import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UserDb } from '../../src/db/users.js';
import type { DashboardUser } from '../../src/db/users.js';
import { ScanDb } from '../../src/db/scans.js';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';

function makeTempDb(): { scanDb: ScanDb; userDb: UserDb; path: string } {
  const path = join(tmpdir(), `test-users-${randomUUID()}.db`);
  const scanDb = new ScanDb(path);
  scanDb.initialize();
  const userDb = new UserDb(scanDb.getDatabase());
  return { scanDb, userDb, path };
}

describe('UserDb', () => {
  let scanDb: ScanDb;
  let userDb: UserDb;
  let dbPath: string;

  beforeEach(() => {
    const result = makeTempDb();
    scanDb = result.scanDb;
    userDb = result.userDb;
    dbPath = result.path;
  });

  afterEach(() => {
    scanDb.close();
    if (existsSync(dbPath)) rmSync(dbPath);
  });

  describe('createUser', () => {
    it('creates user and returns without password hash', async () => {
      const user = await userDb.createUser('alice', 'password123', 'admin');

      expect(user.username).toBe('alice');
      expect(user.role).toBe('admin');
      expect(user.active).toBe(true);
      expect(user.id).toBeDefined();
      expect(user.createdAt).toBeDefined();
      expect((user as Record<string, unknown>)['password_hash']).toBeUndefined();
      expect((user as Record<string, unknown>)['passwordHash']).toBeUndefined();
    });

    it('rejects duplicate username', async () => {
      await userDb.createUser('alice', 'password123', 'admin');
      await expect(userDb.createUser('alice', 'other456', 'editor')).rejects.toThrow();
    });
  });

  describe('getUserByUsername', () => {
    it('returns user when found', async () => {
      const created = await userDb.createUser('bob', 'pass123', 'viewer');
      const found = userDb.getUserByUsername('bob');

      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.username).toBe('bob');
      expect(found!.role).toBe('viewer');
    });

    it('returns null when not found', () => {
      const found = userDb.getUserByUsername('nonexistent');
      expect(found).toBeNull();
    });
  });

  describe('getUserById', () => {
    it('returns user when found', async () => {
      const created = await userDb.createUser('carol', 'pass123', 'editor');
      const found = userDb.getUserById(created.id);

      expect(found).not.toBeNull();
      expect(found!.username).toBe('carol');
    });

    it('returns null when not found', () => {
      const found = userDb.getUserById(randomUUID());
      expect(found).toBeNull();
    });
  });

  describe('verifyPassword', () => {
    it('returns true for correct password', async () => {
      await userDb.createUser('dave', 'correctpass', 'admin');
      const result = await userDb.verifyPassword('dave', 'correctpass');
      expect(result).toBe(true);
    });

    it('returns false for wrong password', async () => {
      await userDb.createUser('eve', 'correctpass', 'admin');
      const result = await userDb.verifyPassword('eve', 'wrongpass');
      expect(result).toBe(false);
    });

    it('returns false for inactive user', async () => {
      const user = await userDb.createUser('frank', 'pass123', 'admin');
      userDb.deactivateUser(user.id);
      const result = await userDb.verifyPassword('frank', 'pass123');
      expect(result).toBe(false);
    });

    it('returns false for non-existent user', async () => {
      const result = await userDb.verifyPassword('ghost', 'pass123');
      expect(result).toBe(false);
    });
  });

  describe('listUsers', () => {
    it('returns all users without hashes', async () => {
      await userDb.createUser('user1', 'pass1', 'admin');
      await userDb.createUser('user2', 'pass2', 'viewer');

      const users = userDb.listUsers();
      expect(users).toHaveLength(2);
      for (const user of users) {
        expect((user as Record<string, unknown>)['password_hash']).toBeUndefined();
        expect((user as Record<string, unknown>)['passwordHash']).toBeUndefined();
      }
    });
  });

  describe('updateUserRole', () => {
    it('changes role', async () => {
      const user = await userDb.createUser('grace', 'pass123', 'viewer');
      userDb.updateUserRole(user.id, 'admin');

      const updated = userDb.getUserById(user.id);
      expect(updated!.role).toBe('admin');
    });
  });

  describe('deactivateUser', () => {
    it('sets active to false', async () => {
      const user = await userDb.createUser('heidi', 'pass123', 'admin');
      expect(user.active).toBe(true);

      userDb.deactivateUser(user.id);

      const deactivated = userDb.getUserById(user.id);
      expect(deactivated!.active).toBe(false);
    });
  });

  describe('activateUser', () => {
    it('sets active to true (1)', async () => {
      const user = await userDb.createUser('irene', 'pass123', 'admin');
      userDb.deactivateUser(user.id);

      const deactivated = userDb.getUserById(user.id);
      expect(deactivated!.active).toBe(false);

      userDb.activateUser(user.id);

      const activated = userDb.getUserById(user.id);
      expect(activated!.active).toBe(true);
    });
  });

  describe('deleteUser', () => {
    it('removes user from database', async () => {
      const user = await userDb.createUser('jack', 'pass123', 'viewer');
      expect(userDb.getUserById(user.id)).not.toBeNull();

      const result = userDb.deleteUser(user.id);
      expect(result).toBe(true);

      const deleted = userDb.getUserById(user.id);
      expect(deleted).toBeNull();
    });

    it('returns false for non-existent user', () => {
      const result = userDb.deleteUser(randomUUID());
      expect(result).toBe(false);
    });
  });

  describe('updatePassword', () => {
    it('updates the password hash', async () => {
      await userDb.createUser('kate', 'oldpass123', 'admin');

      // Verify old password works
      const oldValid = await userDb.verifyPassword('kate', 'oldpass123');
      expect(oldValid).toBe(true);

      const user = userDb.getUserByUsername('kate')!;
      await userDb.updatePassword(user.id, 'newpass456');

      // Old password should no longer work
      const oldInvalid = await userDb.verifyPassword('kate', 'oldpass123');
      expect(oldInvalid).toBe(false);

      // New password should work
      const newValid = await userDb.verifyPassword('kate', 'newpass456');
      expect(newValid).toBe(true);
    });
  });

  describe('countUsers', () => {
    it('returns total count', async () => {
      expect(userDb.countUsers()).toBe(0);

      await userDb.createUser('user1', 'pass1', 'admin');
      expect(userDb.countUsers()).toBe(1);

      await userDb.createUser('user2', 'pass2', 'viewer');
      expect(userDb.countUsers()).toBe(2);
    });
  });
});
