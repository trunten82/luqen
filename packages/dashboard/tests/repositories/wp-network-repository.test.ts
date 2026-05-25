/**
 * Phase 61 — WordPress network repos contract tests.
 *
 * Covers:
 *   - wp_sites idempotent register (same oauth_client_id + url ⇒ update, not insert)
 *   - org isolation on list()
 *   - markStale flips only the right rows
 *   - wp_user_links idempotent upsert on (site_url, wp_user_id)
 *   - listByDashboardUser scoping
 */
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

// ---------------------------------------------------------------------------
// wp_sites
// ---------------------------------------------------------------------------

describe('SqliteWpSitesRepository', () => {
  it('register inserts a new site and returns it', async () => {
    const site = await storage.wpSites.register({
      orgId: 'org_a',
      oauthClientId: 'cli_001',
      url: 'https://shop.example',
      wpVersion: '7.0',
      pluginVersion: '0.5.0',
    });
    expect(site.id).toMatch(/^site_/);
    expect(site.orgId).toBe('org_a');
    expect(site.url).toBe('https://shop.example');
    expect(site.status).toBe('active');
  });

  it('register is idempotent on (oauth_client_id, url) and refreshes last_seen', async () => {
    const first = await storage.wpSites.register({
      orgId: 'org_a',
      oauthClientId: 'cli_001',
      url: 'https://shop.example',
      wpVersion: '7.0',
      pluginVersion: '0.5.0',
    });
    await new Promise((r) => setTimeout(r, 10));
    const second = await storage.wpSites.register({
      orgId: 'org_a',
      oauthClientId: 'cli_001',
      url: 'https://shop.example',
      wpVersion: '7.0',
      pluginVersion: '0.5.1',
    });
    expect(second.id).toBe(first.id);
    expect(second.pluginVersion).toBe('0.5.1');
    expect(new Date(second.lastSeenAt).getTime()).toBeGreaterThanOrEqual(
      new Date(first.lastSeenAt).getTime(),
    );
  });

  it('list scopes by orgId', async () => {
    await storage.wpSites.register({
      orgId: 'org_a', oauthClientId: 'cli_001', url: 'https://a.example',
    });
    await storage.wpSites.register({
      orgId: 'org_b', oauthClientId: 'cli_002', url: 'https://b.example',
    });
    const a = await storage.wpSites.list({ orgId: 'org_a' });
    expect(a).toHaveLength(1);
    expect(a[0]!.url).toBe('https://a.example');
    const b = await storage.wpSites.list({ orgId: 'org_b' });
    expect(b).toHaveLength(1);
    expect(b[0]!.url).toBe('https://b.example');
  });

  it('list with status=all includes stale rows', async () => {
    await storage.wpSites.register({
      orgId: 'org_a', oauthClientId: 'cli_001', url: 'https://one.example',
    });
    await storage.wpSites.register({
      orgId: 'org_a', oauthClientId: 'cli_002', url: 'https://two.example',
    });
    // Wait a tick, then flip everything seen "longer ago than 1ms".
    await new Promise((r) => setTimeout(r, 5));
    await storage.wpSites.markStale(1);

    const activeOnly = await storage.wpSites.list({ orgId: 'org_a', status: 'active' });
    expect(activeOnly).toHaveLength(0);
    const all = await storage.wpSites.list({ orgId: 'org_a', status: 'all' });
    expect(all).toHaveLength(2);
    const staleOnly = await storage.wpSites.list({ orgId: 'org_a', status: 'stale' });
    expect(staleOnly).toHaveLength(2);
  });

  it('markStale only counts rows it actually flipped', async () => {
    await storage.wpSites.register({
      orgId: 'org_a', oauthClientId: 'cli_001', url: 'https://fresh.example',
    });
    expect(await storage.wpSites.markStale(60_000)).toBe(0); // fresh row, 60s cutoff
    await new Promise((r) => setTimeout(r, 5));
    expect(await storage.wpSites.markStale(1)).toBe(1);     // flip rows older than 1ms
    expect(await storage.wpSites.markStale(1)).toBe(0);     // already stale ⇒ idempotent
  });
});

// ---------------------------------------------------------------------------
// wp_user_links
// ---------------------------------------------------------------------------

describe('SqliteWpUserLinksRepository', () => {
  it('upsert inserts a new link', async () => {
    const link = await storage.wpUserLinks.upsert({
      siteUrl: 'https://shop.example',
      wpUserId: 42,
      wpLogin: 'alice',
      email: 'alice@shop.example',
      dashboardUserId: 'usr_001',
    });
    expect(link.id).toMatch(/^wpl_/);
    expect(link.dashboardUserId).toBe('usr_001');
  });

  it('upsert is idempotent on (site_url, wp_user_id)', async () => {
    const first = await storage.wpUserLinks.upsert({
      siteUrl: 'https://shop.example',
      wpUserId: 42,
      wpLogin: 'alice',
      email: 'alice@shop.example',
      dashboardUserId: null,
    });
    const second = await storage.wpUserLinks.upsert({
      siteUrl: 'https://shop.example',
      wpUserId: 42,
      wpLogin: 'alice',
      email: 'alice+v2@shop.example',
      dashboardUserId: 'usr_001',
    });
    expect(second.id).toBe(first.id);
    expect(second.email).toBe('alice+v2@shop.example');
    expect(second.dashboardUserId).toBe('usr_001');
  });

  it('get returns null for unknown (siteUrl, wpUserId)', async () => {
    expect(await storage.wpUserLinks.get('https://nope.example', 1)).toBeNull();
  });

  it('listByDashboardUser scopes correctly', async () => {
    await storage.wpUserLinks.upsert({
      siteUrl: 'https://a.example', wpUserId: 1, wpLogin: 'a', email: 'a@a',
      dashboardUserId: 'usr_001',
    });
    await storage.wpUserLinks.upsert({
      siteUrl: 'https://b.example', wpUserId: 2, wpLogin: 'b', email: 'b@b',
      dashboardUserId: 'usr_002',
    });
    await storage.wpUserLinks.upsert({
      siteUrl: 'https://c.example', wpUserId: 3, wpLogin: 'c', email: 'c@c',
      dashboardUserId: 'usr_001',
    });

    const for1 = await storage.wpUserLinks.listByDashboardUser('usr_001');
    expect(for1).toHaveLength(2);
    expect(for1.map((l) => l.siteUrl).sort()).toEqual([
      'https://a.example', 'https://c.example',
    ]);
    const for2 = await storage.wpUserLinks.listByDashboardUser('usr_002');
    expect(for2).toHaveLength(1);
    const forNobody = await storage.wpUserLinks.listByDashboardUser('usr_999');
    expect(forNobody).toHaveLength(0);
  });
});
