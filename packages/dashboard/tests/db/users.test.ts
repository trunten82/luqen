import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import type { DashboardUser } from '../../src/db/types.js';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';

function makeTempDb(): { storage: SqliteStorageAdapter; path: string } {
  const path = join(tmpdir(), `test-users-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(path);
  void storage.migrate();
  return { storage, path };
}

describe('UserDb', () => {
  let storage: SqliteStorageAdapter;
  let dbPath: string;

  beforeEach(() => {
    const result = makeTempDb();
    storage = result.storage;
    dbPath = result.path;
  });

  afterEach(() => {
    void storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
  });

  describe('createUser', () => {
    it('creates user and returns without password hash', async () => {
      const user = await storage.users.createUser('alice', 'password123', 'admin');

      expect(user.username).toBe('alice');
      expect(user.role).toBe('admin');
      expect(user.active).toBe(true);
      expect(user.id).toBeDefined();
      expect(user.createdAt).toBeDefined();
      expect((user as Record<string, unknown>)['password_hash']).toBeUndefined();
      expect((user as Record<string, unknown>)['passwordHash']).toBeUndefined();
    });

    it('rejects duplicate username', async () => {
      await storage.users.createUser('alice', 'password123', 'admin');
      await expect(storage.users.createUser('alice', 'other456', 'editor')).rejects.toThrow();
    });
  });

  describe('getUserByUsername', () => {
    it('returns user when found', async () => {
      const created = await storage.users.createUser('bob', 'pass123', 'viewer');
      const found = await storage.users.getUserByUsername('bob');

      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.username).toBe('bob');
      expect(found!.role).toBe('viewer');
    });

    it('returns null when not found', async () => {
      const found = await storage.users.getUserByUsername('nonexistent');
      expect(found).toBeNull();
    });
  });

  describe('getUserById', () => {
    it('returns user when found', async () => {
      const created = await storage.users.createUser('carol', 'pass123', 'editor');
      const found = await storage.users.getUserById(created.id);

      expect(found).not.toBeNull();
      expect(found!.username).toBe('carol');
    });

    it('returns null when not found', async () => {
      const found = await storage.users.getUserById(randomUUID());
      expect(found).toBeNull();
    });
  });

  describe('verifyPassword', () => {
    it('returns true for correct password', async () => {
      await storage.users.createUser('dave', 'correctpass', 'admin');
      const result = await storage.users.verifyPassword('dave', 'correctpass');
      expect(result).toBe(true);
    });

    it('returns false for wrong password', async () => {
      await storage.users.createUser('eve', 'correctpass', 'admin');
      const result = await storage.users.verifyPassword('eve', 'wrongpass');
      expect(result).toBe(false);
    });

    it('returns false for inactive user', async () => {
      const user = await storage.users.createUser('frank', 'pass123', 'admin');
      await storage.users.deactivateUser(user.id);
      const result = await storage.users.verifyPassword('frank', 'pass123');
      expect(result).toBe(false);
    });

    it('returns false for non-existent user', async () => {
      const result = await storage.users.verifyPassword('ghost', 'pass123');
      expect(result).toBe(false);
    });
  });

  describe('listUsers', () => {
    it('returns all users without hashes', async () => {
      await storage.users.createUser('user1', 'pass1', 'admin');
      await storage.users.createUser('user2', 'pass2', 'viewer');

      const users = await storage.users.listUsers();
      expect(users).toHaveLength(2);
      for (const user of users) {
        expect((user as Record<string, unknown>)['password_hash']).toBeUndefined();
        expect((user as Record<string, unknown>)['passwordHash']).toBeUndefined();
      }
    });
  });

  describe('updateUserRole', () => {
    it('changes role', async () => {
      const user = await storage.users.createUser('grace', 'pass123', 'viewer');
      await storage.users.updateUserRole(user.id, 'admin');

      const updated = await storage.users.getUserById(user.id);
      expect(updated!.role).toBe('admin');
    });
  });

  describe('deactivateUser', () => {
    it('sets active to false', async () => {
      const user = await storage.users.createUser('heidi', 'pass123', 'admin');
      expect(user.active).toBe(true);

      await storage.users.deactivateUser(user.id);

      const deactivated = await storage.users.getUserById(user.id);
      expect(deactivated!.active).toBe(false);
    });
  });

  describe('activateUser', () => {
    it('sets active to true (1)', async () => {
      const user = await storage.users.createUser('irene', 'pass123', 'admin');
      await storage.users.deactivateUser(user.id);

      const deactivated = await storage.users.getUserById(user.id);
      expect(deactivated!.active).toBe(false);

      await storage.users.activateUser(user.id);

      const activated = await storage.users.getUserById(user.id);
      expect(activated!.active).toBe(true);
    });
  });

  describe('deleteUser', () => {
    it('removes user from database', async () => {
      const user = await storage.users.createUser('jack', 'pass123', 'viewer');
      expect(await storage.users.getUserById(user.id)).not.toBeNull();

      const result = await storage.users.deleteUser(user.id);
      expect(result).toBe(true);

      const deleted = await storage.users.getUserById(user.id);
      expect(deleted).toBeNull();
    });

    it('returns false for non-existent user', async () => {
      const result = await storage.users.deleteUser(randomUUID());
      expect(result).toBe(false);
    });
  });

  describe('updatePassword', () => {
    it('updates the password hash', async () => {
      await storage.users.createUser('kate', 'oldpass123', 'admin');

      // Verify old password works
      const oldValid = await storage.users.verifyPassword('kate', 'oldpass123');
      expect(oldValid).toBe(true);

      const user = (await storage.users.getUserByUsername('kate'))!;
      await storage.users.updatePassword(user.id, 'newpass456');

      // Old password should no longer work
      const oldInvalid = await storage.users.verifyPassword('kate', 'oldpass123');
      expect(oldInvalid).toBe(false);

      // New password should work
      const newValid = await storage.users.verifyPassword('kate', 'newpass456');
      expect(newValid).toBe(true);
    });
  });

  describe('countUsers', () => {
    it('returns total count', async () => {
      expect(await storage.users.countUsers()).toBe(0);

      await storage.users.createUser('user1', 'pass1', 'admin');
      expect(await storage.users.countUsers()).toBe(1);

      await storage.users.createUser('user2', 'pass2', 'viewer');
      expect(await storage.users.countUsers()).toBe(2);
    });
  });
});
