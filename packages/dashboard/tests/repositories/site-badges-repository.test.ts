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

describe('SqliteSiteBadgesRepository', () => {
  it('enable creates a new badge', async () => {
    const b = await storage.siteBadges.enable('org_a', 'https://shop.example', 'u-test');
    expect(b.id).toMatch(/^sbdg_/);
    expect(b.enabled).toBe(true);
    expect(b.siteUrl).toBe('https://shop.example');
  });

  it('enable is idempotent on (orgId, siteUrl)', async () => {
    const a = await storage.siteBadges.enable('org_a', 'https://shop.example', 'u-test');
    const b = await storage.siteBadges.enable('org_a', 'https://shop.example', 'u-test');
    expect(b.id).toBe(a.id);
  });

  it('enable re-flips a disabled badge', async () => {
    const a = await storage.siteBadges.enable('org_a', 'https://shop.example', 'u-test');
    await storage.siteBadges.setEnabled(a.id, 'org_a', false);
    const reenabled = await storage.siteBadges.enable('org_a', 'https://shop.example', 'u-test');
    expect(reenabled.id).toBe(a.id);
    expect(reenabled.enabled).toBe(true);
  });

  it('setEnabled is org-scoped', async () => {
    const a = await storage.siteBadges.enable('org_a', 'https://shop.example', 'u-test');
    const okWrongOrg = await storage.siteBadges.setEnabled(a.id, 'org_b', false);
    expect(okWrongOrg).toBe(false);
    const okRightOrg = await storage.siteBadges.setEnabled(a.id, 'org_a', false);
    expect(okRightOrg).toBe(true);
  });

  it('get returns null for unknown id', async () => {
    expect(await storage.siteBadges.get('sbdg_missing')).toBeNull();
  });

  it('getForSite returns null when no row exists', async () => {
    expect(await storage.siteBadges.getForSite('org_x', 'https://none')).toBeNull();
  });

  it('records createdBy on first enable (audit trail)', async () => {
    const b = await storage.siteBadges.enable('org_a', 'https://shop.example', 'usr-42');
    expect(b.createdBy).toBe('usr-42');
  });

  it('list returns rows newest-first, scoped by org', async () => {
    await storage.siteBadges.enable('org_a', 'https://a.example', 'u1');
    await new Promise((r) => setTimeout(r, 5));
    await storage.siteBadges.enable('org_a', 'https://b.example', 'u2');
    await new Promise((r) => setTimeout(r, 5));
    await storage.siteBadges.enable('org_b', 'https://c.example', 'u3');

    const orgA = await storage.siteBadges.list('org_a');
    expect(orgA.map((b) => b.siteUrl)).toEqual(['https://b.example', 'https://a.example']);
    const all = await storage.siteBadges.list();
    expect(all).toHaveLength(3);
  });
});

describe('SqliteScanRepository public-share audit trail', () => {
  it('records enabledAt + enabledBy on setPublicShare(true)', async () => {
    await storage.scans.createScan({
      id: 's1', siteUrl: 'https://x.example', standard: 'WCAG21AA',
      jurisdictions: [], createdBy: 'u', orgId: 'org_a', createdAt: '2025-12-01T00:00:00Z',
    });
    await storage.scans.setPublicShare('s1', 'org_a', true, 'usr-42');
    const fresh = await storage.scans.getScan('s1');
    expect(fresh?.publicShareEnabled).toBe(true);
    expect(fresh?.publicShareEnabledBy).toBe('usr-42');
    expect(fresh?.publicShareEnabledAt).toBeTruthy();
  });

  it('clears enabledAt + enabledBy on setPublicShare(false)', async () => {
    await storage.scans.createScan({
      id: 's2', siteUrl: 'https://x.example', standard: 'WCAG21AA',
      jurisdictions: [], createdBy: 'u', orgId: 'org_a', createdAt: '2025-12-01T00:00:00Z',
    });
    await storage.scans.setPublicShare('s2', 'org_a', true, 'usr-42');
    await storage.scans.setPublicShare('s2', 'org_a', false, 'admin-1');
    const fresh = await storage.scans.getScan('s2');
    expect(fresh?.publicShareEnabled).toBe(false);
    expect(fresh?.publicShareEnabledBy).toBeNull();
    expect(fresh?.publicShareEnabledAt).toBeNull();
  });

  it('listPubliclyShared returns only enabled, scoped by org, newest-first', async () => {
    await storage.scans.createScan({ id: 's1', siteUrl: 'https://a', standard: 'X', jurisdictions: [], createdBy: 'u', orgId: 'org_a', createdAt: '2025-12-01T00:00:00Z' });
    await storage.scans.createScan({ id: 's2', siteUrl: 'https://b', standard: 'X', jurisdictions: [], createdBy: 'u', orgId: 'org_a', createdAt: '2025-12-02T00:00:00Z' });
    await storage.scans.createScan({ id: 's3', siteUrl: 'https://c', standard: 'X', jurisdictions: [], createdBy: 'u', orgId: 'org_b', createdAt: '2025-12-03T00:00:00Z' });
    await storage.scans.setPublicShare('s1', 'org_a', true, 'u1');
    await new Promise((r) => setTimeout(r, 10));
    await storage.scans.setPublicShare('s2', 'org_a', true, 'u2');
    await storage.scans.setPublicShare('s3', 'org_b', true, 'u3');

    const orgA = await storage.scans.listPubliclyShared('org_a');
    expect(orgA.map((s) => s.id)).toEqual(['s2', 's1']);
    const all = await storage.scans.listPubliclyShared();
    expect(all).toHaveLength(3);
  });
});

describe('SqliteScanRepository.getLatestCompletedForSite', () => {
  it('returns null when no completed scan exists', async () => {
    const r = await storage.scans.getLatestCompletedForSite('org_a', 'https://nope');
    expect(r).toBeNull();
  });

  it('returns the most recent completed scan, scoped by org', async () => {
    await storage.scans.createScan({
      id: 's1', siteUrl: 'https://x.example', standard: 'WCAG21AA',
      jurisdictions: [], createdBy: 'u1', orgId: 'org_a', createdAt: '2025-12-01T00:00:00Z',
    });
    await storage.scans.createScan({
      id: 's2', siteUrl: 'https://x.example', standard: 'WCAG21AA',
      jurisdictions: [], createdBy: 'u1', orgId: 'org_a', createdAt: '2025-12-02T00:00:00Z',
    });
    await storage.scans.createScan({
      id: 's3', siteUrl: 'https://x.example', standard: 'WCAG21AA',
      jurisdictions: [], createdBy: 'u1', orgId: 'org_b', createdAt: '2025-12-03T00:00:00Z',
    });
    // mark s1 and s3 completed at different times
    await storage.scans.updateScan('s1', { status: 'completed', completedAt: '2026-01-01T00:00:00Z' });
    await storage.scans.updateScan('s2', { status: 'completed', completedAt: '2026-02-01T00:00:00Z' });
    await storage.scans.updateScan('s3', { status: 'completed', completedAt: '2026-03-01T00:00:00Z' });

    const latestA = await storage.scans.getLatestCompletedForSite('org_a', 'https://x.example');
    expect(latestA?.id).toBe('s2');               // org_a: pick s2 (newest in org)
    const latestB = await storage.scans.getLatestCompletedForSite('org_b', 'https://x.example');
    expect(latestB?.id).toBe('s3');
  });

  it('ignores non-completed scans', async () => {
    await storage.scans.createScan({
      id: 's-queued', siteUrl: 'https://y.example', standard: 'WCAG21AA',
      jurisdictions: [], createdBy: 'u', orgId: 'org_a', createdAt: '2025-12-01T00:00:00Z',
    });
    // default status is 'queued' per createScan
    const r = await storage.scans.getLatestCompletedForSite('org_a', 'https://y.example');
    expect(r).toBeNull();
  });
});
