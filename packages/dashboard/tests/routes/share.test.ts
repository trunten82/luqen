import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import JSZip from 'jszip';
import Handlebars from 'handlebars';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { shareRoutes } from '../../src/routes/share.js';
import { reportRoutes } from '../../src/routes/reports.js';
import { loadTranslations, t as translate, type Locale } from '../../src/i18n/index.js';
import { ALL_PERMISSION_IDS } from '../../src/permissions.js';

function registerVpatHelpers(): void {
  loadTranslations();
  Handlebars.registerHelper('t', (key: string, options: { hash?: Record<string, string>; data?: { root?: { locale?: string } } }) =>
    translate(key, (options?.data?.root?.locale as Locale) ?? 'en', options?.hash));
  Handlebars.registerHelper('formatStandard', (code: string) => ({ WCAG2A: 'WCAG 2.1 Level A', WCAG2AA: 'WCAG 2.1 Level AA', WCAG2AAA: 'WCAG 2.1 Level AAA' }[code] ?? code));
}

const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

interface Ctx { server: FastifyInstance; storage: SqliteStorageAdapter; uploadsDir: string; cleanup: () => void; }
let ctx: Ctx;

async function seedScan(storage: SqliteStorageAdapter): Promise<string> {
  const id = randomUUID();
  await storage.scans.createScan({ id, siteUrl: 'https://share-test.example.com', standard: 'WCAG2AA', jurisdictions: [], createdBy: 'tester', createdAt: new Date().toISOString(), orgId: 'system' });
  const report = { summary: { pagesScanned: 1, totalIssues: 1, byLevel: { error: 1, warning: 0, notice: 0 } }, pages: [{ url: 'https://share-test.example.com', issueCount: 1, issues: [{ type: 'error', code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37', message: 'a', selector: 'img', context: '<img>' }] }] };
  await storage.scans.updateScan(id, { status: 'completed', completedAt: new Date().toISOString(), totalIssues: 1, pagesScanned: 1, jsonReport: JSON.stringify(report) });
  return id;
}

beforeAll(async () => {
  const dbPath = join(tmpdir(), `test-share-${randomUUID()}.db`);
  const uploadsDir = join(tmpdir(), `test-share-uploads-${randomUUID()}`);
  mkdirSync(join(uploadsDir, 'system', 'evidence'), { recursive: true });
  writeFileSync(join(uploadsDir, 'system', 'evidence', 'shot.png'), PNG_1X1);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));
  registerVpatHelpers();
  server.decorateReply('view', function (this: FastifyReply, template: string, data: unknown) {
    return this.code(200).header('content-type', 'application/json').send(JSON.stringify({ template, data }));
  });
  // Authenticated admin context for the management routes (reportRoutes).
  server.addHook('preHandler', async (request) => {
    request.user = { id: 'u1', username: 'admin', role: 'admin', currentOrgId: 'system' };
    (request as unknown as Record<string, unknown>)['permissions'] = new Set(ALL_PERMISSION_IDS);
  });
  await reportRoutes(server, storage);
  await shareRoutes(server, storage, uploadsDir);
  await server.ready();
  ctx = { server, storage, uploadsDir, cleanup: () => { void storage.disconnect(); if (existsSync(dbPath)) rmSync(dbPath); if (existsSync(uploadsDir)) rmSync(uploadsDir, { recursive: true }); void server.close(); } };
});

afterAll(() => ctx.cleanup());

describe('ReportShareRepository', () => {
  it('creates a token, defaults to a 90-day expiry, and looks up by token', async () => {
    const scanId = await seedScan(ctx.storage);
    const share = await ctx.storage.reportShares.createShare({ scanId, orgId: 'system' });
    expect(share.token).toHaveLength(43); // 32 bytes base64url
    expect(share.revokedAt).toBeNull();
    const days = (Date.parse(share.expiresAt!) - Date.now()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(89);
    expect(days).toBeLessThan(91);
    const found = await ctx.storage.reportShares.getByToken(share.token);
    expect(found?.id).toBe(share.id);
  });

  it('revoke marks the row revoked', async () => {
    const scanId = await seedScan(ctx.storage);
    const share = await ctx.storage.reportShares.createShare({ scanId, orgId: 'system' });
    expect(await ctx.storage.reportShares.revoke(share.id)).toBe(true);
    const after = await ctx.storage.reportShares.getByToken(share.token);
    expect(after?.revokedAt).not.toBeNull();
  });
});

describe('GET /share/:token', () => {
  it('renders the VPAT for a valid token', async () => {
    const scanId = await seedScan(ctx.storage);
    const share = await ctx.storage.reportShares.createShare({ scanId, orgId: 'system' });
    const res = await ctx.server.inject({ method: 'GET', url: `/share/${share.token}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('share-test.example.com');
    // External download links point at the token routes, NOT the gated internal
    // ones. Mustache escapes '/' → '&#x2F;' in attributes; normalise to assert.
    const body = res.body.replace(/&#x2F;/g, '/');
    expect(body).toContain(`/share/${share.token}/vpat.pdf`);
    expect(body).not.toContain('/api/v1/export/scans/');
  });

  it('serves a token-authorised VPAT PDF and evidence pack', async () => {
    const scanId = await seedScan(ctx.storage);
    await ctx.storage.manualTestEvidence.addEvidence({ scanId, criterionId: '1.1.1', filePath: '/uploads/system/evidence/shot.png', fileName: 'shot.png', mimeType: 'image/png', orgId: 'system' });
    const share = await ctx.storage.reportShares.createShare({ scanId, orgId: 'system' });

    const pdf = await ctx.server.inject({ method: 'GET', url: `/share/${share.token}/vpat.pdf` });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');

    const zip = await ctx.server.inject({ method: 'GET', url: `/share/${share.token}/evidence-pack.zip` });
    expect(zip.statusCode).toBe(200);
    expect(zip.headers['content-type']).toContain('application/zip');
    const loaded = await JSZip.loadAsync(zip.rawPayload);
    expect(Object.keys(loaded.files)).toContain('evidence/1.1.1/shot.png');
  });

  it('shows a "no longer available" page for a revoked link (410)', async () => {
    const scanId = await seedScan(ctx.storage);
    const share = await ctx.storage.reportShares.createShare({ scanId, orgId: 'system' });
    await ctx.storage.reportShares.revoke(share.id);
    const res = await ctx.server.inject({ method: 'GET', url: `/share/${share.token}` });
    expect(res.statusCode).toBe(410);
    expect(res.body).toMatch(/no longer available/i);
    const pdf = await ctx.server.inject({ method: 'GET', url: `/share/${share.token}/vpat.pdf` });
    expect(pdf.statusCode).toBe(410);
  });

  it('treats an expired link as gone (410)', async () => {
    const scanId = await seedScan(ctx.storage);
    const share = await ctx.storage.reportShares.createShare({ scanId, orgId: 'system', expiresInDays: -1 });
    const res = await ctx.server.inject({ method: 'GET', url: `/share/${share.token}` });
    expect(res.statusCode).toBe(410);
  });

  it('returns 404 for an unknown token', async () => {
    const res = await ctx.server.inject({ method: 'GET', url: '/share/does-not-exist-token' });
    expect(res.statusCode).toBe(404);
  });
});

describe('share management routes', () => {
  it('POST /api/v1/reports/:id/shares creates a link, and revoke disables it', async () => {
    const scanId = await seedScan(ctx.storage);
    const created = await ctx.server.inject({ method: 'POST', url: `/api/v1/reports/${scanId}/shares`, payload: {} });
    expect(created.statusCode).toBe(200);
    const body = created.json() as { shareId: string; token: string; expiresAt: string };
    expect(body.token).toBeTruthy();

    // The new link works.
    const view = await ctx.server.inject({ method: 'GET', url: `/share/${body.token}` });
    expect(view.statusCode).toBe(200);

    // Revoke it → the link is gone.
    const revoked = await ctx.server.inject({ method: 'POST', url: `/api/v1/reports/${scanId}/shares/${body.shareId}/revoke`, payload: {} });
    expect(revoked.statusCode).toBe(200);
    expect((revoked.json() as { revoked: boolean }).revoked).toBe(true);
    const gone = await ctx.server.inject({ method: 'GET', url: `/share/${body.token}` });
    expect(gone.statusCode).toBe(410);
  });
});
