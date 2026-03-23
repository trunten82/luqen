import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { loadRegistrySync, filterByType, getByName } from '../../src/plugins/registry.js';

const REGISTRY_PATH = join(__dirname, '..', '..', 'plugin-registry.json');

describe('Plugin Registry', () => {
  describe('loadRegistry', () => {
    it('returns an array of RegistryEntry objects', () => {
      const entries = loadRegistrySync(REGISTRY_PATH);

      expect(Array.isArray(entries)).toBe(true);
      expect(entries.length).toBeGreaterThan(0);

      const entry = entries[0];
      expect(entry).toHaveProperty('name');
      expect(entry).toHaveProperty('displayName');
      expect(entry).toHaveProperty('type');
      expect(entry).toHaveProperty('version');
      expect(entry).toHaveProperty('description');
      expect(entry).toHaveProperty('packageName');
      expect(entry).toHaveProperty('icon');
    });

    it('loads from custom path', () => {
      const tmpDir = join(tmpdir(), `registry-test-${Date.now()}`);
      mkdirSync(tmpDir, { recursive: true });
      const customPath = join(tmpDir, 'custom-registry.json');

      const customData = {
        plugins: [
          {
            name: 'test-plugin',
            displayName: 'Test Plugin',
            type: 'auth',
            version: '0.1.0',
            description: 'A test plugin',
            packageName: '@test/plugin',
            icon: 'test',
          },
        ],
      };

      writeFileSync(customPath, JSON.stringify(customData));

      const entries = loadRegistrySync(customPath);
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('test-plugin');

      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns empty array for registry with no plugins', () => {
      const tmpDir = join(tmpdir(), `registry-test-empty-${Date.now()}`);
      mkdirSync(tmpDir, { recursive: true });
      const emptyPath = join(tmpDir, 'empty-registry.json');

      writeFileSync(emptyPath, JSON.stringify({ plugins: [] }));

      const entries = loadRegistrySync(emptyPath);
      expect(entries).toEqual([]);

      rmSync(tmpDir, { recursive: true, force: true });
    });
  });

  describe('filterByType', () => {
    it('returns only auth entries when filtering by auth', () => {
      const entries = loadRegistrySync(REGISTRY_PATH);
      const authEntries = filterByType(entries, 'auth');

      expect(authEntries.length).toBeGreaterThan(0);
      for (const entry of authEntries) {
        expect(entry.type).toBe('auth');
      }
    });

    it('returns only notification entries when filtering by notification', () => {
      const entries = loadRegistrySync(REGISTRY_PATH);
      const notifyEntries = filterByType(entries, 'notification');

      expect(notifyEntries.length).toBeGreaterThan(0);
      for (const entry of notifyEntries) {
        expect(entry.type).toBe('notification');
      }
    });

    it('returns empty array for type with no matches', () => {
      const entries = loadRegistrySync(REGISTRY_PATH);
      const result = filterByType(entries, 'nonexistent' as any);

      expect(result).toEqual([]);
    });
  });

  describe('getByName', () => {
    it('returns the Entra entry for auth-entra', () => {
      const entries = loadRegistrySync(REGISTRY_PATH);
      const entry = getByName(entries, 'auth-entra');

      expect(entry).not.toBeNull();
      expect(entry!.name).toBe('auth-entra');
      expect(entry!.displayName).toBe('Azure Entra ID');
      expect(entry!.type).toBe('auth');
    });

    it('returns null for nonexistent name', () => {
      const entries = loadRegistrySync(REGISTRY_PATH);
      const entry = getByName(entries, 'nonexistent');

      expect(entry).toBeNull();
    });
  });
});
