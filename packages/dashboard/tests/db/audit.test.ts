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

describe('AuditRepository', () => {
  describe('log', () => {
    it('creates an audit entry with auto-generated ID and timestamp', async () => {
      await storage.audit.log({
        actor: 'alice',
        action: 'login',
        resourceType: 'session',
        orgId: 'org-1',
      });

      const { entries, total } = await storage.audit.query({ orgId: 'org-1' });
      expect(total).toBe(1);
      expect(entries[0].actor).toBe('alice');
      expect(entries[0].action).toBe('login');
      expect(entries[0].resourceType).toBe('session');
      expect(typeof entries[0].id).toBe('string');
      expect(entries[0].id.length).toBeGreaterThan(0);
      expect(typeof entries[0].timestamp).toBe('string');
    });

    it('stores details as JSON string when details is an object', async () => {
      await storage.audit.log({
        actor: 'alice',
        action: 'update',
        resourceType: 'scan',
        details: { key: 'value', count: 42 },
        orgId: 'org-1',
      });

      const { entries } = await storage.audit.query({ orgId: 'org-1' });
      expect(typeof entries[0].details).toBe('string');
      const parsed = JSON.parse(entries[0].details as string);
      expect(parsed.key).toBe('value');
      expect(parsed.count).toBe(42);
    });

    it('stores details as-is when details is a string', async () => {
      await storage.audit.log({
        actor: 'alice',
        action: 'delete',
        resourceType: 'repo',
        details: 'deleted repo xyz',
        orgId: 'org-1',
      });

      const { entries } = await storage.audit.query({ orgId: 'org-1' });
      expect(entries[0].details).toBe('deleted repo xyz');
    });
  });

  describe('query', () => {
    beforeEach(async () => {
      await storage.audit.log({ actor: 'alice', action: 'login', resourceType: 'session', orgId: 'org-1' });
      await storage.audit.log({ actor: 'bob', action: 'create', resourceType: 'scan', orgId: 'org-1' });
      await storage.audit.log({ actor: 'alice', action: 'delete', resourceType: 'repo', orgId: 'org-2' });
    });

    it('matches by actor', async () => {
      const { entries, total } = await storage.audit.query({ actor: 'alice' });
      expect(total).toBe(2);
      expect(entries.every((e) => e.actor === 'alice')).toBe(true);
    });

    it('matches by action', async () => {
      const { entries, total } = await storage.audit.query({ action: 'login' });
      expect(total).toBe(1);
      expect(entries[0].action).toBe('login');
    });

    it('matches by date range', async () => {
      const past = new Date(Date.now() - 60_000).toISOString();
      const future = new Date(Date.now() + 60_000).toISOString();

      const { total: inRange } = await storage.audit.query({ from: past, to: future });
      expect(inRange).toBe(3);

      const veryOld = new Date(Date.now() - 120_000).toISOString();
      const oldCutoff = new Date(Date.now() - 60_000).toISOString();
      const { total: outOfRange } = await storage.audit.query({ from: veryOld, to: oldCutoff });
      expect(outOfRange).toBe(0);
    });

    it('matches by orgId', async () => {
      const { entries, total } = await storage.audit.query({ orgId: 'org-2' });
      expect(total).toBe(1);
      expect(entries[0].orgId).toBe('org-2');
    });

    it('paginates results', async () => {
      const { entries } = await storage.audit.query({ limit: 2, offset: 0 });
      expect(entries.length).toBe(2);

      const { entries: page2 } = await storage.audit.query({ limit: 2, offset: 2 });
      expect(page2.length).toBe(1);
    });

    it('returns total count alongside entries', async () => {
      const { entries, total } = await storage.audit.query({ orgId: 'org-1', limit: 1 });
      expect(entries.length).toBe(1);
      expect(total).toBe(2);
    });

    it('returns all entries up to default limit when no filters applied', async () => {
      const { entries, total } = await storage.audit.query({});
      expect(total).toBe(3);
      expect(entries.length).toBe(3);
    });
  });
});
