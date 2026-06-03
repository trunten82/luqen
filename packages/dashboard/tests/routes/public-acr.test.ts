import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';
import Handlebars from 'handlebars';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { publicAcrRoutes } from '../../src/routes/public-acr.js';
import { loadTranslations, t as translate, type Locale } from '../../src/i18n/index.js';

function registerVpatHelpers(): void {
  loadTranslations();
  Handlebars.registerHelper('t', (key: string, options: { hash?: Record<string, string>; data?: { root?: { locale?: string } } }) =>
    translate(key, (options?.data?.root?.locale as Locale) ?? 'en', options?.hash));
  Handlebars.registerHelper('formatStandard', (code: string) => ({ WCAG2A: 'WCAG 2.1 Level A', WCAG2AA: 'WCAG 2.1 Level AA', WCAG2AAA: 'WCAG 2.1 Level AAA' }[code] ?? code));
}

let server: FastifyInstance;
let storage: SqliteStorageAdapter;
let dbPath: string;

async function seedCompletedScan(): Promise<string> {
  const id = randomUUID();
  await storage.scans.createScan({ id, siteUrl: 'https://acr-test.example.com', standard: 'WCAG2AA', jurisdictions: [], createdBy: 'tester', createdAt: new Date().toISOString(), orgId: 'system' });
  const report = { summary: { pagesScanned: 1, totalIssues: 1, byLevel: { error: 1, warning: 0, notice: 0 } }, pages: [{ url: 'https://acr-test.example.com', issueCount: 1, issues: [{ type: 'error', code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37', message: 'a', selector: 'img', context: '<img>' }] }] };
  await storage.scans.updateScan(id, { status: 'completed', completedAt: new Date().toISOString(), totalIssues: 1, pagesScanned: 1, jsonReport: JSON.stringify(report) });
  return id;
}

beforeAll(async () => {
  dbPath = join(tmpdir(), `test-acr-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  registerVpatHelpers();
  server = Fastify({ logger: false });
  await publicAcrRoutes(server, storage, undefined, join(tmpdir(), `acr-uploads-${randomUUID()}`));
  await server.ready();
});

afterAll(async () => {
  await storage.disconnect();
  await server.close();
  if (existsSync(dbPath)) rmSync(dbPath);
});

describe('public dynamic ACR (widget→VPAT)', () => {
  it('404s for a scan that has not opted into public sharing', async () => {
    const id = await seedCompletedScan();
    const res = await server.inject({ method: 'GET', url: `/reports/${id}/acr`, headers: { host: 'dashboard.example' } });
    expect(res.statusCode).toBe(404);
  });

  it('serves the live ACR (noindex) once the scan opts into public sharing', async () => {
    const id = await seedCompletedScan();
    await storage.scans.setPublicShare(id, 'system', true, 'tester');
    const res = await server.inject({ method: 'GET', url: `/reports/${id}/acr`, headers: { host: 'dashboard.example' } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-robots-tag']).toBe('noindex');
    expect(res.headers['content-type']).toContain('text/html');
    // Renders the reconciled VPAT/ACR, not a "certified" claim.
    expect(res.body).toMatch(/Accessibility Conformance Report|VPAT/i);
    expect(res.body).not.toMatch(/certified|100% compliant/i);
  });

  it('404s the ACR PDF for a non-public scan and serves it for a public one', async () => {
    const id = await seedCompletedScan();
    const denied = await server.inject({ method: 'GET', url: `/reports/${id}/acr.pdf`, headers: { host: 'dashboard.example' } });
    expect(denied.statusCode).toBe(404);
    await storage.scans.setPublicShare(id, 'system', true, 'tester');
    const ok = await server.inject({ method: 'GET', url: `/reports/${id}/acr.pdf`, headers: { host: 'dashboard.example' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toContain('application/pdf');
  }, 90000);
});
