import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync, mkdirSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { reportPageRoutes } from '../../src/routes/report-page.js';
import { loadTranslations } from '../../src/i18n/index.js';

/**
 * The per-site "Snapshot" report page: stable badge-handle URL → latest ACR
 * + a revisions timeline, with a stale-version disclaimer on older revisions.
 */

interface Ctx { server: FastifyInstance; storage: SqliteStorageAdapter; cleanup: () => void; }
let ctx: Ctx;

const SITE = 'https://timemachine.example.com';

// Seed a completed scan for the site, dated `daysAgo` ago (so revisions sort).
async function seedScan(storage: SqliteStorageAdapter, daysAgo: number): Promise<string> {
  const id = randomUUID();
  const when = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  await storage.scans.createScan({ id, siteUrl: SITE, standard: 'WCAG2AA', jurisdictions: [], createdBy: 'tester', createdAt: when, orgId: 'system' });
  const report = { summary: { pagesScanned: 1, totalIssues: 1, byLevel: { error: 1, warning: 0, notice: 0 } }, pages: [{ url: SITE, issueCount: 1, issues: [{ type: 'error', code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37', message: 'a', selector: 'img', context: '<img>' }] }] };
  await storage.scans.updateScan(id, { status: 'completed', completedAt: when, totalIssues: 1, pagesScanned: 1, jsonReport: JSON.stringify(report) });
  return id;
}

beforeAll(async () => {
  await loadTranslations();
  const dbPath = join(tmpdir(), `test-reportpage-${randomUUID()}.db`);
  const uploadsDir = join(tmpdir(), `test-reportpage-uploads-${randomUUID()}`);
  mkdirSync(uploadsDir, { recursive: true });
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  const server = Fastify({ logger: false });
  await reportPageRoutes(server, storage, uploadsDir);
  await server.ready();
  ctx = { server, storage, cleanup: () => { void storage.disconnect(); if (existsSync(dbPath)) rmSync(dbPath); if (existsSync(uploadsDir)) rmSync(uploadsDir, { recursive: true }); void server.close(); } };
});

afterAll(() => ctx.cleanup());

describe('GET /reports/live/:badgeId (Snapshot)', () => {
  it('404s for an unknown badge', async () => {
    const res = await ctx.server.inject({ method: 'GET', url: `/reports/live/${randomUUID()}` });
    expect(res.statusCode).toBe(404);
  });

  it('404s for a disabled badge', async () => {
    const badge = await ctx.storage.siteBadges.enable('system', SITE, 'tester');
    await ctx.storage.siteBadges.setEnabled(badge.id, 'system', false);
    const res = await ctx.server.inject({ method: 'GET', url: `/reports/live/${badge.id}` });
    expect(res.statusCode).toBe(404);
    await ctx.storage.siteBadges.setEnabled(badge.id, 'system', true);
  });

  it('renders the latest ACR + a revisions timeline marking the current revision', async () => {
    const older = await seedScan(ctx.storage, 10);
    const latest = await seedScan(ctx.storage, 1);
    const badge = await ctx.storage.siteBadges.enable('system', SITE, 'tester');

    const res = await ctx.server.inject({ method: 'GET', url: `/reports/live/${badge.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    const html = res.body.replace(/&#x2F;/g, '/');
    // Shared ACR document body.
    expect(html).toContain('timemachine.example.com');
    // Revisions timeline present, marking the current (latest) revision.
    expect(html).toContain('Report history');
    expect(html).toContain('Current');
    expect(html).toContain('aria-current="true"');
    // The older revision is a timeline link; the latest is the current span.
    expect(html).toContain(`<a href="/reports/live/${badge.id}/r/${older}">`);
    expect(html).not.toContain(`<a href="/reports/live/${badge.id}/r/${latest}">`);
    // The latest page carries NO stale-version disclaimer.
    expect(html).not.toContain('class="acr__stale"');
  });

  it('shows the stale-version disclaimer on a non-latest revision, linking to latest', async () => {
    const older = await seedScan(ctx.storage, 20);
    await seedScan(ctx.storage, 1); // a newer revision exists
    const badge = await ctx.storage.siteBadges.getForSite('system', SITE);
    expect(badge).not.toBeNull();

    const res = await ctx.server.inject({ method: 'GET', url: `/reports/live/${badge!.id}/r/${older}` });
    expect(res.statusCode).toBe(200);
    const html = res.body.replace(/&#x2F;/g, '/');
    expect(html).toContain('acr__stale');
    expect(html).toContain('A newer version of this report is available.');
    expect(html).toContain(`href="/reports/live/${badge!.id}"`);
  });

  it('404s a revision scan that does not belong to the badge site', async () => {
    const badge = await ctx.storage.siteBadges.getForSite('system', SITE);
    // A scan for a different site must not resolve under this badge.
    const otherId = randomUUID();
    await ctx.storage.scans.createScan({ id: otherId, siteUrl: 'https://other.example.com', standard: 'WCAG2AA', jurisdictions: [], createdBy: 't', createdAt: new Date().toISOString(), orgId: 'system' });
    await ctx.storage.scans.updateScan(otherId, { status: 'completed', completedAt: new Date().toISOString(), jsonReport: '{}' });
    const res = await ctx.server.inject({ method: 'GET', url: `/reports/live/${badge!.id}/r/${otherId}` });
    expect(res.statusCode).toBe(404);
  });
});
