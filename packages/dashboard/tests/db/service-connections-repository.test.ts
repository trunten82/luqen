import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { setEncryptionSalt } from '../../src/plugins/crypto.js';
import { SqliteServiceConnectionsRepository } from '../../src/db/sqlite/service-connections-sqlite.js';
import type {
  ServiceConnectionsRepository,
  ServiceConnection,
  ServiceId,
} from '../../src/db/service-connections-repository.js';

const SESSION_SECRET = 'test-session-secret-long-enough-for-key-derivation';

setEncryptionSalt('test-salt-for-service-connections-repo');

let storage: SqliteStorageAdapter;
let dbPath: string;
let repo: ServiceConnectionsRepository;

beforeEach(async () => {
  dbPath = join(tmpdir(), `test-svc-conn-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  repo = new SqliteServiceConnectionsRepository(
    storage.getRawDatabase(),
    SESSION_SECRET,
  );
});

afterEach(async () => {
  await storage.disconnect();
  if (existsSync(dbPath)) rmSync(dbPath);
});

describe('SqliteServiceConnectionsRepository', () => {
  describe('migration', () => {
    it('creates the service_connections table with the expected columns', () => {
      const db = storage.getRawDatabase();
      const rows = db
        .prepare("PRAGMA table_info('service_connections')")
        .all() as Array<{ name: string; notnull: number; dflt_value: string | null }>;

      const byName = new Map(rows.map((r) => [r.name, r]));
      expect(byName.has('service_id')).toBe(true);
      expect(byName.has('url')).toBe(true);
      expect(byName.has('client_id')).toBe(true);
      expect(byName.has('client_secret_encrypted')).toBe(true);
      expect(byName.has('updated_at')).toBe(true);
      expect(byName.has('updated_by')).toBe(true);
    });
  });

  describe('list', () => {
    it('returns an empty array on a fresh database', async () => {
      const all = await repo.list();
      expect(all).toEqual([]);
    });
  });

  describe('upsert + get', () => {
    it('stores a new row and returns it decrypted with source="db"', async () => {
      const saved = await repo.upsert({
        serviceId: 'compliance' satisfies ServiceId,
        url: 'http://localhost:4000',
        clientId: 'dashboard-client',
        clientSecret: 'plain-secret-value',
        updatedBy: 'tester',
      });

      expect(saved.serviceId).toBe('compliance');
      expect(saved.url).toBe('http://localhost:4000');
      expect(saved.clientId).toBe('dashboard-client');
      expect(saved.clientSecret).toBe('plain-secret-value');
      expect(saved.hasSecret).toBe(true);
      expect(saved.updatedBy).toBe('tester');
      expect(saved.source).toBe('db');
      expect(typeof saved.updatedAt).toBe('string');

      const fetched = await repo.get('compliance');
      expect(fetched).not.toBeNull();
      expect(fetched!.clientSecret).toBe('plain-secret-value');
      expect(fetched!.source).toBe('db');
    });

    it('returns null for a missing service', async () => {
      const fetched = await repo.get('llm');
      expect(fetched).toBeNull();
    });

    it('stores ciphertext (not plaintext) in the underlying table', async () => {
      await repo.upsert({
        serviceId: 'branding',
        url: 'http://localhost:4100',
        clientId: 'b-client',
        clientSecret: 'super-secret-branding-value',
        updatedBy: null,
      });

      const db = storage.getRawDatabase();
      const row = db
        .prepare('SELECT client_secret_encrypted FROM service_connections WHERE service_id = ?')
        .get('branding') as { client_secret_encrypted: string };

      expect(row.client_secret_encrypted).not.toBe('');
      expect(row.client_secret_encrypted).not.toContain('super-secret-branding-value');
      // iv:ciphertext:tag format
      expect(row.client_secret_encrypted.split(':').length).toBe(3);
    });
  });

  describe('blank-to-keep upsert', () => {
    it('preserves the existing secret when clientSecret is null', async () => {
      await repo.upsert({
        serviceId: 'llm',
        url: 'http://localhost:4200',
        clientId: 'llm-client',
        clientSecret: 'original-llm-secret',
        updatedBy: 'first-write',
      });

      await repo.upsert({
        serviceId: 'llm',
        url: 'http://localhost:4200/v2',
        clientId: 'llm-client-v2',
        clientSecret: null,
        updatedBy: 'second-write',
      });

      const fetched = await repo.get('llm');
      expect(fetched).not.toBeNull();
      expect(fetched!.url).toBe('http://localhost:4200/v2');
      expect(fetched!.clientId).toBe('llm-client-v2');
      expect(fetched!.clientSecret).toBe('original-llm-secret');
      expect(fetched!.hasSecret).toBe(true);
      expect(fetched!.updatedBy).toBe('second-write');
    });

    it('clears the secret when clientSecret is empty string', async () => {
      await repo.upsert({
        serviceId: 'llm',
        url: 'http://localhost:4200',
        clientId: 'llm-client',
        clientSecret: 'to-be-cleared',
        updatedBy: null,
      });

      const updated = await repo.upsert({
        serviceId: 'llm',
        url: 'http://localhost:4200',
        clientId: 'llm-client',
        clientSecret: '',
        updatedBy: 'clear-me',
      });

      expect(updated.clientSecret).toBe('');
      expect(updated.hasSecret).toBe(false);
    });
  });

  describe('clearSecret', () => {
    it('sets hasSecret to false and keeps other fields intact', async () => {
      await repo.upsert({
        serviceId: 'compliance',
        url: 'http://localhost:4000',
        clientId: 'dashboard',
        clientSecret: 'some-secret',
        updatedBy: 'init',
      });

      await repo.clearSecret('compliance', 'rotator');

      const fetched = await repo.get('compliance');
      expect(fetched).not.toBeNull();
      expect(fetched!.clientSecret).toBe('');
      expect(fetched!.hasSecret).toBe(false);
      expect(fetched!.url).toBe('http://localhost:4000');
      expect(fetched!.clientId).toBe('dashboard');
      expect(fetched!.updatedBy).toBe('rotator');
    });
  });

  describe('list (populated)', () => {
    it('returns all rows decrypted, each with source="db"', async () => {
      await repo.upsert({
        serviceId: 'compliance',
        url: 'http://localhost:4000',
        clientId: 'a',
        clientSecret: 'secret-a',
        updatedBy: null,
      });
      await repo.upsert({
        serviceId: 'branding',
        url: 'http://localhost:4100',
        clientId: 'b',
        clientSecret: '',
        updatedBy: null,
      });

      const all = await repo.list();
      expect(all).toHaveLength(2);
      const compliance = all.find((r: ServiceConnection) => r.serviceId === 'compliance')!;
      const branding = all.find((r: ServiceConnection) => r.serviceId === 'branding')!;
      expect(compliance.clientSecret).toBe('secret-a');
      expect(compliance.source).toBe('db');
      expect(branding.clientSecret).toBe('');
      expect(branding.hasSecret).toBe(false);
      expect(branding.source).toBe('db');
    });
  });
});
