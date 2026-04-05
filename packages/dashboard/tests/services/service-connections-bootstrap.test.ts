import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { SqliteServiceConnectionsRepository } from '../../src/db/sqlite/service-connections-sqlite.js';
import { setEncryptionSalt } from '../../src/plugins/crypto.js';
import { importFromConfigIfEmpty } from '../../src/services/service-connections-bootstrap.js';
import type { DashboardConfig } from '../../src/config.js';

const SESSION_SECRET = 'test-session-secret-long-enough-for-bootstrap';
setEncryptionSalt('test-salt-for-service-bootstrap');

function makeConfig(overrides: Partial<DashboardConfig> = {}): DashboardConfig {
  return {
    port: 5000,
    complianceUrl: 'http://localhost:4000',
    reportsDir: './reports',
    dbPath: ':memory:',
    sessionSecret: SESSION_SECRET,
    maxConcurrentScans: 2,
    complianceClientId: 'compliance-client',
    complianceClientSecret: 'compliance-secret',
    brandingUrl: 'http://localhost:4100',
    brandingClientId: 'branding-client',
    brandingClientSecret: 'branding-secret',
    llmUrl: 'http://localhost:4200',
    llmClientId: 'llm-client',
    llmClientSecret: 'llm-secret',
    pluginsDir: './plugins',
    catalogueCacheTtl: 3600,
    maxPages: 50,
    ...overrides,
  };
}

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  };
}

let storage: SqliteStorageAdapter;
let dbPath: string;
let repo: SqliteServiceConnectionsRepository;

beforeEach(async () => {
  dbPath = join(tmpdir(), `test-bootstrap-${randomUUID()}.db`);
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

describe('importFromConfigIfEmpty', () => {
  it('imports all three services when repo is empty and config has URLs', async () => {
    const logger = makeLogger();
    await importFromConfigIfEmpty(repo, makeConfig(), logger as never);

    const all = await repo.list();
    expect(all).toHaveLength(3);

    const compliance = all.find((r) => r.serviceId === 'compliance')!;
    expect(compliance.url).toBe('http://localhost:4000');
    expect(compliance.clientId).toBe('compliance-client');
    expect(compliance.clientSecret).toBe('compliance-secret');
    expect(compliance.updatedBy).toBe('bootstrap-from-config');
    expect(compliance.source).toBe('db');

    const branding = all.find((r) => r.serviceId === 'branding')!;
    expect(branding.clientSecret).toBe('branding-secret');
    expect(branding.updatedBy).toBe('bootstrap-from-config');

    const llm = all.find((r) => r.serviceId === 'llm')!;
    expect(llm.url).toBe('http://localhost:4200');
    expect(llm.clientSecret).toBe('llm-secret');

    expect(logger.info).toHaveBeenCalledTimes(3);
  });

  it('is a no-op when the repo already has rows', async () => {
    await repo.upsert({
      serviceId: 'compliance',
      url: 'http://existing:9000',
      clientId: 'existing',
      clientSecret: 'existing-secret',
      updatedBy: 'previous-operator',
    });

    const upsertSpy = vi.spyOn(repo, 'upsert');
    const logger = makeLogger();
    await importFromConfigIfEmpty(repo, makeConfig(), logger as never);

    expect(upsertSpy).not.toHaveBeenCalled();
    const all = await repo.list();
    expect(all).toHaveLength(1);
    expect(all[0].url).toBe('http://existing:9000');
    expect(all[0].updatedBy).toBe('previous-operator');
    upsertSpy.mockRestore();
  });

  it('partial config: only imports services whose URL is set', async () => {
    const logger = makeLogger();
    const config = makeConfig({
      // branding URL still present (it has a default); clear llm
      llmUrl: undefined,
      // simulate branding not configured by clearing its URL to empty string
      brandingUrl: '',
    });

    await importFromConfigIfEmpty(repo, config, logger as never);

    const all = await repo.list();
    const ids = all.map((r) => r.serviceId).sort();
    expect(ids).toEqual(['compliance']);
  });

  it('encrypts secrets at rest (ciphertext in DB, plaintext decrypted on read)', async () => {
    const logger = makeLogger();
    await importFromConfigIfEmpty(repo, makeConfig(), logger as never);

    const db = storage.getRawDatabase();
    const row = db
      .prepare('SELECT client_secret_encrypted FROM service_connections WHERE service_id = ?')
      .get('compliance') as { client_secret_encrypted: string };

    expect(row.client_secret_encrypted).not.toBe('');
    expect(row.client_secret_encrypted).not.toContain('compliance-secret');

    const fetched = await repo.get('compliance');
    expect(fetched!.clientSecret).toBe('compliance-secret');
  });
});
