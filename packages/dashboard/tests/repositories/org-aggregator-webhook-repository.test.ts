/**
 * Phase 63.1 — Org aggregator webhook repository CRUD + active filter.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';

let storage: SqliteStorageAdapter;
let dbPath: string;
let orgId: string;

beforeEach(async () => {
  dbPath = join(tmpdir(), `test-oaw-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  const org = await storage.organizations.createOrg({ name: 'org_a', slug: 'org_a' });
  orgId = org.id;
});

afterEach(async () => {
  await storage.disconnect();
  if (existsSync(dbPath)) rmSync(dbPath);
});

describe('SqliteOrgAggregatorWebhookRepository', () => {
  it('creates a webhook and reads it back via listAll', async () => {
    const created = await storage.orgAggregatorWebhooks.create({
      orgId,
      url: 'https://example.com/hook',
      secret: 'topsecret',
      createdBy: 'tester',
    });
    expect(created.orgId).toBe(orgId);
    expect(created.url).toBe('https://example.com/hook');
    expect(created.secret).toBe('topsecret');
    expect(created.active).toBe(true);

    const all = await storage.orgAggregatorWebhooks.listAll(orgId);
    expect(all.length).toBe(1);
    expect(all[0].id).toBe(created.id);
  });

  it('listActive omits soft-deleted (active=0) rows; listAll keeps them', async () => {
    const a = await storage.orgAggregatorWebhooks.create({
      orgId,
      url: 'https://example.com/a',
    });
    await storage.orgAggregatorWebhooks.create({
      orgId,
      url: 'https://example.com/b',
    });
    const okDelete = await storage.orgAggregatorWebhooks.delete(a.id);
    expect(okDelete).toBe(true);

    const active = await storage.orgAggregatorWebhooks.listActive(orgId);
    expect(active.length).toBe(1);
    expect(active[0].url).toBe('https://example.com/b');

    const all = await storage.orgAggregatorWebhooks.listAll(orgId);
    expect(all.length).toBe(2);
  });

  it('listActive scoped per org', async () => {
    const otherOrg = await storage.organizations.createOrg({
      name: 'org_b',
      slug: 'org_b',
    });
    await storage.orgAggregatorWebhooks.create({
      orgId,
      url: 'https://example.com/a',
    });
    await storage.orgAggregatorWebhooks.create({
      orgId: otherOrg.id,
      url: 'https://example.com/b',
    });

    const aRows = await storage.orgAggregatorWebhooks.listActive(orgId);
    const bRows = await storage.orgAggregatorWebhooks.listActive(otherOrg.id);
    expect(aRows.length).toBe(1);
    expect(bRows.length).toBe(1);
    expect(aRows[0].url).toBe('https://example.com/a');
    expect(bRows[0].url).toBe('https://example.com/b');
  });

  it('delete returns false for nonexistent id', async () => {
    const ok = await storage.orgAggregatorWebhooks.delete('does-not-exist');
    expect(ok).toBe(false);
  });

  it('allows null secret', async () => {
    const created = await storage.orgAggregatorWebhooks.create({
      orgId,
      url: 'https://example.com/no-secret',
    });
    expect(created.secret).toBeNull();
  });
});
