import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { registerSession } from '../../src/auth/session.js';
import { repoRoutes } from '../../src/routes/repos.js';

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';

interface TestContext {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  reportsDir: string;
  cleanup: () => void;
}

async function createTestServer(permissions: string[] = ['repos.manage', 'issues.fix']): Promise<TestContext> {
  const dbPath = join(tmpdir(), `test-repos-${randomUUID()}.db`);
  const reportsDir = join(tmpdir(), `test-repos-reports-${randomUUID()}`);
  mkdirSync(reportsDir, { recursive: true });
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();

  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));
  await registerSession(server, TEST_SESSION_SECRET);

  server.decorateReply(
    'view',
    function (this: FastifyReply, template: string, data: unknown) {
      return this.code(200).header('content-type', 'application/json').send(
        JSON.stringify({ template, data }),
      );
    },
  );

  server.addHook('preHandler', async (request) => {
    request.user = { id: 'user-1', username: 'alice', role: 'admin', currentOrgId: 'system' };
    (request as unknown as Record<string, unknown>)['permissions'] = new Set(permissions);
  });

  await repoRoutes(server, storage);
  await server.ready();

  const cleanup = (): void => {
    void storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
    if (existsSync(reportsDir)) rmSync(reportsDir, { recursive: true });
    void server.close();
  };

  return { server, storage, reportsDir, cleanup };
}

async function makeRepo(ctx: TestContext, siteUrlPattern = 'https://example.com', repoUrl = 'https://github.com/org/repo') {
  return ctx.storage.repos.createRepo({
    id: randomUUID(),
    siteUrlPattern,
    repoUrl,
    repoPath: undefined,
    branch: 'main',
    createdBy: 'alice',
    orgId: 'system',
  });
}

async function makeScan(
  ctx: TestContext,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const id = randomUUID();
  await ctx.storage.scans.createScan({
    id,
    siteUrl: 'https://example.com',
    standard: 'WCAG2AA',
    jurisdictions: ['uk'],
    createdBy: 'alice',
    createdAt: new Date().toISOString(),
    orgId: 'system',
    ...overrides,
  });
  return id;
}

describe('Repo routes', () => {
  describe('GET /admin/repos', () => {
    it('returns 403 without repos.manage permission', async () => {
      const ctx = await createTestServer([]);
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/repos' });
      ctx.cleanup();
      expect(response.statusCode).toBe(403);
    });

    it('returns 200 with repos template when authorized', async () => {
      const ctx = await createTestServer();
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/repos' });
      ctx.cleanup();
      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string };
      expect(body.template).toBe('repos.hbs');
    });

    it('lists connected repos in template data', async () => {
      const ctx = await createTestServer();
      await makeRepo(ctx, 'https://site1.com', 'https://github.com/org/repo1');
      await makeRepo(ctx, 'https://site2.com', 'https://github.com/org/repo2');
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/repos' });
      ctx.cleanup();
      const body = response.json() as { data: { repos: unknown[] } };
      expect(body.data.repos).toHaveLength(2);
    });
  });

  describe('POST /admin/repos', () => {
    let ctx: TestContext;
    beforeEach(async () => { ctx = await createTestServer(); });
    afterEach(() => { ctx.cleanup(); });

    it('returns 403 without repos.manage permission', async () => {
      const noPerm = await createTestServer([]);
      const response = await noPerm.server.inject({
        method: 'POST',
        url: '/admin/repos',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrlPattern=https%3A%2F%2Fexample.com&repoUrl=https%3A%2F%2Fgithub.com%2Forg%2Frepo',
      });
      noPerm.cleanup();
      expect(response.statusCode).toBe(403);
    });

    it('returns 422 when siteUrlPattern is invalid', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/repos',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrlPattern=not-a-url&repoUrl=https%3A%2F%2Fgithub.com%2Forg%2Frepo',
      });
      expect(response.statusCode).toBe(422);
    });

    it('returns 422 with toast HTML when siteUrlPattern is invalid via HTMX', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/repos',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'hx-request': 'true',
        },
        payload: 'siteUrlPattern=not-a-url&repoUrl=https%3A%2F%2Fgithub.com%2Forg%2Frepo',
      });
      expect(response.statusCode).toBe(422);
      expect(response.body).toContain('Invalid site URL pattern');
    });

    it('returns 422 when repoUrl is invalid', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/repos',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrlPattern=https%3A%2F%2Fexample.com&repoUrl=ftp%3A%2F%2Finvalid',
      });
      expect(response.statusCode).toBe(422);
    });

    it('returns 422 with toast HTML when repoUrl is invalid via HTMX', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/repos',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'hx-request': 'true',
        },
        payload: 'siteUrlPattern=https%3A%2F%2Fexample.com&repoUrl=ftp%3A%2F%2Finvalid',
      });
      expect(response.statusCode).toBe(422);
      expect(response.body).toContain('Invalid repository URL');
    });

    it('connects a new repo and redirects', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/repos',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrlPattern=https%3A%2F%2Fexample.com&repoUrl=https%3A%2F%2Fgithub.com%2Forg%2Frepo&branch=main',
      });
      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toBe('/admin/repos');
      const repos = await ctx.storage.repos.listRepos('system');
      expect(repos).toHaveLength(1);
      expect(repos[0].repoUrl).toBe('https://github.com/org/repo');
    });

    it('creates a repo and returns view for HTMX', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/repos',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'hx-request': 'true',
        },
        payload: 'siteUrlPattern=https%3A%2F%2Fhtmx-site.com&repoUrl=https%3A%2F%2Fgithub.com%2Forg%2Frepo',
      });
      // HTMX path calls reply.view — stubbed as JSON
      expect(response.statusCode).toBe(200);
    });

    it('accepts git@ URLs for repoUrl', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/repos',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrlPattern=https%3A%2F%2Fexample.com&repoUrl=git%40github.com%3Aorg%2Frepo.git',
      });
      expect(response.statusCode).toBe(302);
    });

    it('accepts ssh:// URLs for repoUrl', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/repos',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrlPattern=https%3A%2F%2Fexample.com&repoUrl=ssh%3A%2F%2Fgit%40github.com%2Forg%2Frepo.git',
      });
      expect(response.statusCode).toBe(302);
    });

    it('accepts LIKE pattern for siteUrlPattern', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/repos',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrlPattern=%25example.com%25&repoUrl=https%3A%2F%2Fgithub.com%2Forg%2Frepo',
      });
      expect(response.statusCode).toBe(302);
    });

    it('uses default branch "main" when branch is empty', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/repos',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrlPattern=https%3A%2F%2Fexample.com&repoUrl=https%3A%2F%2Fgithub.com%2Forg%2Frepo&branch=',
      });
      expect(response.statusCode).toBe(302);
      const repos = await ctx.storage.repos.listRepos('system');
      expect(repos[0].branch).toBe('main');
    });

    it('uses default branch "main" when branch contains invalid characters', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/repos',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrlPattern=https%3A%2F%2Fexample.com&repoUrl=https%3A%2F%2Fgithub.com%2Forg%2Frepo&branch=%3B+rm+-rf+%2F',
      });
      expect(response.statusCode).toBe(302);
      const repos = await ctx.storage.repos.listRepos('system');
      expect(repos[0].branch).toBe('main');
    });

    it('strips path traversal from repoPath', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/repos',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrlPattern=https%3A%2F%2Fexample.com&repoUrl=https%3A%2F%2Fgithub.com%2Forg%2Frepo&repoPath=..%2F..%2Fetc%2Fpasswd',
      });
      expect(response.statusCode).toBe(302);
      const repos = await ctx.storage.repos.listRepos('system');
      // Path traversal should be sanitized (stored as null in SQLite)
      expect(repos[0].repoPath).toBeFalsy();
    });

    it('accepts valid repoPath', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/repos',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrlPattern=https%3A%2F%2Fexample.com&repoUrl=https%3A%2F%2Fgithub.com%2Forg%2Frepo&repoPath=src%2Fapp',
      });
      expect(response.statusCode).toBe(302);
      const repos = await ctx.storage.repos.listRepos('system');
      expect(repos[0].repoPath).toBe('src/app');
    });

    it('returns 422 when siteUrlPattern is empty string', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/repos',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrlPattern=&repoUrl=https%3A%2F%2Fgithub.com%2Forg%2Frepo',
      });
      expect(response.statusCode).toBe(422);
    });

    it('returns 422 when repoUrl is empty string', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/repos',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrlPattern=https%3A%2F%2Fexample.com&repoUrl=',
      });
      expect(response.statusCode).toBe(422);
    });
  });

  describe('DELETE /admin/repos/:id', () => {
    let ctx: TestContext;
    beforeEach(async () => { ctx = await createTestServer(); });
    afterEach(() => { ctx.cleanup(); });

    it('returns 403 without repos.manage permission', async () => {
      const noPerm = await createTestServer([]);
      const response = await noPerm.server.inject({ method: 'DELETE', url: '/admin/repos/some-id' });
      noPerm.cleanup();
      expect(response.statusCode).toBe(403);
    });

    it('returns 404 for non-existent repo', async () => {
      const response = await ctx.server.inject({ method: 'DELETE', url: '/admin/repos/non-existent-id' });
      expect(response.statusCode).toBe(404);
    });

    it('disconnects a repo and redirects', async () => {
      const repo = await makeRepo(ctx);
      const response = await ctx.server.inject({ method: 'DELETE', url: `/admin/repos/${repo.id}` });
      expect(response.statusCode).toBe(302);
      const deleted = await ctx.storage.repos.getRepo(repo.id);
      expect(deleted).toBeNull();
    });

    it('disconnects a repo and returns toast for HTMX', async () => {
      const repo = await makeRepo(ctx);
      const response = await ctx.server.inject({
        method: 'DELETE',
        url: `/admin/repos/${repo.id}`,
        headers: { 'hx-request': 'true' },
      });
      expect(response.statusCode).toBe(200);
    });
  });

  describe('GET /reports/:id/fixes', () => {
    let ctx: TestContext;
    beforeEach(async () => { ctx = await createTestServer(); });
    afterEach(() => { ctx.cleanup(); });

    it('returns 403 without issues.fix permission', async () => {
      const noPerm = await createTestServer(['repos.manage']);
      const scanId = await makeScan(noPerm);
      const response = await noPerm.server.inject({
        method: 'GET',
        url: `/reports/${scanId}/fixes`,
      });
      noPerm.cleanup();
      expect(response.statusCode).toBe(403);
      const body = response.json() as { error: string };
      expect(body.error).toBe('Insufficient permissions');
    });

    it('returns 404 when scan does not exist', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/reports/non-existent-id/fixes',
      });
      expect(response.statusCode).toBe(404);
      const body = response.json() as { error: string };
      expect(body.error).toBe('Report not found');
    });

    it('returns 404 when scan belongs to a different org', async () => {
      const scanId = await makeScan(ctx, { orgId: 'other-org' });
      const response = await ctx.server.inject({
        method: 'GET',
        url: `/reports/${scanId}/fixes`,
      });
      expect(response.statusCode).toBe(404);
    });

    it('renders fixes.hbs with noReport=true when scan is not completed', async () => {
      const scanId = await makeScan(ctx);
      // Scan is in 'queued' status by default
      const response = await ctx.server.inject({
        method: 'GET',
        url: `/reports/${scanId}/fixes`,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string; data: { noReport: boolean; fixCount: number } };
      expect(body.template).toBe('fixes.hbs');
      expect(body.data.noReport).toBe(true);
      expect(body.data.fixCount).toBe(0);
    });

    it('renders fixes.hbs with noReport=true when jsonReportPath is missing', async () => {
      const scanId = await makeScan(ctx);
      // Update scan to completed but without jsonReportPath
      await ctx.storage.scans.updateScan(scanId, {
        status: 'completed',
        completedAt: new Date().toISOString(),
      });
      const response = await ctx.server.inject({
        method: 'GET',
        url: `/reports/${scanId}/fixes`,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string; data: { noReport: boolean } };
      expect(body.template).toBe('fixes.hbs');
      expect(body.data.noReport).toBe(true);
    });

    it('renders fixes.hbs with noReport=true when jsonReportPath file does not exist', async () => {
      const scanId = await makeScan(ctx);
      await ctx.storage.scans.updateScan(scanId, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        jsonReportPath: '/tmp/does-not-exist-report.json',
      });
      const response = await ctx.server.inject({
        method: 'GET',
        url: `/reports/${scanId}/fixes`,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string; data: { noReport: boolean } };
      expect(body.data.noReport).toBe(true);
    });

    it('renders fixes.hbs with noReport=true when JSON report is invalid', async () => {
      const reportPath = join(ctx.reportsDir, `${randomUUID()}.json`);
      writeFileSync(reportPath, 'not valid json {{{');

      const scanId = await makeScan(ctx);
      await ctx.storage.scans.updateScan(scanId, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        jsonReportPath: reportPath,
      });
      const response = await ctx.server.inject({
        method: 'GET',
        url: `/reports/${scanId}/fixes`,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string; data: { noReport: boolean } };
      expect(body.data.noReport).toBe(true);
    });

    it('renders fixes with empty array when report has no matching issues', async () => {
      const reportPath = join(ctx.reportsDir, `${randomUUID()}.json`);
      writeFileSync(reportPath, JSON.stringify({
        pages: [{
          url: 'https://example.com',
          issues: [{
            type: 'error',
            code: 'CUSTOM-UNKNOWN',
            message: 'Some totally unknown issue that matches nothing',
            selector: 'div',
            context: '<div>test</div>',
          }],
        }],
      }));

      const scanId = await makeScan(ctx);
      await ctx.storage.scans.updateScan(scanId, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        jsonReportPath: reportPath,
      });
      const response = await ctx.server.inject({
        method: 'GET',
        url: `/reports/${scanId}/fixes`,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        template: string;
        data: { noReport: boolean; fixCount: number; fixes: unknown[] };
      };
      expect(body.data.noReport).toBe(false);
      expect(body.data.fixCount).toBe(0);
      expect(body.data.fixes).toHaveLength(0);
    });

    it('generates fix proposals from page issues with wcagCriterion', async () => {
      const reportPath = join(ctx.reportsDir, `${randomUUID()}.json`);
      writeFileSync(reportPath, JSON.stringify({
        pages: [{
          url: 'https://example.com/page1',
          issues: [{
            type: 'error',
            code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1',
            message: 'Img element missing an alt attribute',
            selector: 'img.logo',
            context: '<img src="logo.png">',
            wcagCriterion: '1.1.1',
            wcagTitle: 'Non-text Content',
          }],
        }],
      }));

      const scanId = await makeScan(ctx);
      await ctx.storage.scans.updateScan(scanId, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        jsonReportPath: reportPath,
      });
      const response = await ctx.server.inject({
        method: 'GET',
        url: `/reports/${scanId}/fixes`,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        template: string;
        data: {
          fixCount: number;
          fixes: Array<{ criterion: string; title: string; severity: string; pageUrl: string; confidence: string }>;
          fixGroups: Array<{ criterion: string; fixes: unknown[] }>;
          noReport: boolean;
          connectedRepo: unknown;
        };
      };
      expect(body.data.noReport).toBe(false);
      expect(body.data.fixCount).toBeGreaterThan(0);
      expect(body.data.fixes[0].criterion).toBe('1.1.1');
      expect(body.data.fixes[0].severity).toBe('error');
      expect(body.data.fixes[0].pageUrl).toBe('https://example.com/page1');
      // No connected repo so confidence is 'suggestion'
      expect(body.data.fixes[0].confidence).toBe('suggestion');
      // fixGroups should be populated
      expect(body.data.fixGroups.length).toBeGreaterThan(0);
    });

    it('collects issues from flat issues array when pages is absent', async () => {
      const reportPath = join(ctx.reportsDir, `${randomUUID()}.json`);
      writeFileSync(reportPath, JSON.stringify({
        siteUrl: 'https://example.com',
        issues: [{
          type: 'warning',
          code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1',
          message: 'Img element missing an alt attribute',
          selector: 'img.hero',
          context: '<img src="hero.png">',
          wcagCriterion: '1.1.1',
          wcagTitle: 'Non-text Content',
        }],
      }));

      const scanId = await makeScan(ctx);
      await ctx.storage.scans.updateScan(scanId, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        jsonReportPath: reportPath,
      });
      const response = await ctx.server.inject({
        method: 'GET',
        url: `/reports/${scanId}/fixes`,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        data: { fixCount: number; fixes: Array<{ pageUrl: string; severity: string }> };
      };
      expect(body.data.fixCount).toBeGreaterThan(0);
      // Should use siteUrl as pageUrl when using flat issues
      expect(body.data.fixes[0].pageUrl).toBe('https://example.com');
      expect(body.data.fixes[0].severity).toBe('warning');
    });

    it('collects issues from templateIssues', async () => {
      const reportPath = join(ctx.reportsDir, `${randomUUID()}.json`);
      writeFileSync(reportPath, JSON.stringify({
        siteUrl: 'https://example.com',
        templateIssues: [{
          type: 'error',
          code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1',
          message: 'Img element missing an alt attribute',
          selector: 'img.template',
          context: '<img src="tmpl.png">',
          wcagCriterion: '1.1.1',
          wcagTitle: 'Non-text Content',
          affectedPages: ['https://example.com/page1', 'https://example.com/page2'],
          affectedCount: 2,
        }],
      }));

      const scanId = await makeScan(ctx);
      await ctx.storage.scans.updateScan(scanId, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        jsonReportPath: reportPath,
      });
      const response = await ctx.server.inject({
        method: 'GET',
        url: `/reports/${scanId}/fixes`,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        data: { fixCount: number; fixes: Array<{ pageUrl: string }> };
      };
      expect(body.data.fixCount).toBeGreaterThan(0);
      // Should use first affected page URL
      expect(body.data.fixes[0].pageUrl).toBe('https://example.com/page1');
    });

    it('deduplicates fixes with the same fingerprint', async () => {
      const reportPath = join(ctx.reportsDir, `${randomUUID()}.json`);
      writeFileSync(reportPath, JSON.stringify({
        pages: [
          {
            url: 'https://example.com/page1',
            issues: [{
              type: 'error',
              code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1',
              message: 'Img element missing an alt attribute',
              selector: 'img.logo',
              context: '<img src="logo.png">',
              wcagCriterion: '1.1.1',
            }],
          },
          {
            url: 'https://example.com/page2',
            issues: [{
              type: 'error',
              code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1',
              message: 'Img element missing an alt attribute',
              selector: 'img.logo',
              context: '<img src="logo.png">',
              wcagCriterion: '1.1.1',
            }],
          },
        ],
      }));

      const scanId = await makeScan(ctx);
      await ctx.storage.scans.updateScan(scanId, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        jsonReportPath: reportPath,
      });
      const response = await ctx.server.inject({
        method: 'GET',
        url: `/reports/${scanId}/fixes`,
      });
      const body = response.json() as { data: { fixCount: number } };
      // Same criterion + issuePattern + selector should be deduped to 1
      expect(body.data.fixCount).toBe(1);
    });

    it('sorts fixes by severity (errors first, then warnings, then notices)', async () => {
      const reportPath = join(ctx.reportsDir, `${randomUUID()}.json`);
      writeFileSync(reportPath, JSON.stringify({
        pages: [{
          url: 'https://example.com',
          issues: [
            {
              type: 'notice',
              code: 'WCAG2AA',
              message: 'Img element missing an alt attribute',
              selector: 'img.notice',
              context: '<img>',
              wcagCriterion: '1.1.1',
            },
            {
              type: 'error',
              code: 'WCAG2AA',
              message: 'Img element missing an alt attribute',
              selector: 'img.error',
              context: '<img>',
              wcagCriterion: '1.1.1',
            },
            {
              type: 'warning',
              code: 'WCAG2AA',
              message: 'Img element missing an alt attribute',
              selector: 'img.warning',
              context: '<img>',
              wcagCriterion: '1.1.1',
            },
          ],
        }],
      }));

      const scanId = await makeScan(ctx);
      await ctx.storage.scans.updateScan(scanId, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        jsonReportPath: reportPath,
      });
      const response = await ctx.server.inject({
        method: 'GET',
        url: `/reports/${scanId}/fixes`,
      });
      const body = response.json() as {
        data: { fixes: Array<{ severity: string }> };
      };
      // errors first, then warnings, then notices
      const severities = body.data.fixes.map((f) => f.severity);
      const errorIdx = severities.indexOf('error');
      const warningIdx = severities.indexOf('warning');
      const noticeIdx = severities.indexOf('notice');
      if (errorIdx >= 0 && warningIdx >= 0) expect(errorIdx).toBeLessThan(warningIdx);
      if (warningIdx >= 0 && noticeIdx >= 0) expect(warningIdx).toBeLessThan(noticeIdx);
    });

    it('shows confidence "medium" when a connected repo exists', async () => {
      // Create a repo that matches the scan siteUrl
      await ctx.storage.repos.createRepo({
        id: randomUUID(),
        siteUrlPattern: 'https://example.com%',
        repoUrl: 'https://github.com/org/repo',
        repoPath: 'src/templates',
        branch: 'main',
        createdBy: 'alice',
        orgId: 'system',
      });

      const reportPath = join(ctx.reportsDir, `${randomUUID()}.json`);
      writeFileSync(reportPath, JSON.stringify({
        pages: [{
          url: 'https://example.com',
          issues: [{
            type: 'error',
            code: 'WCAG2AA',
            message: 'Img element missing an alt attribute',
            selector: 'img.test',
            context: '<img>',
            wcagCriterion: '1.1.1',
          }],
        }],
      }));

      const scanId = await makeScan(ctx);
      await ctx.storage.scans.updateScan(scanId, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        jsonReportPath: reportPath,
      });

      const response = await ctx.server.inject({
        method: 'GET',
        url: `/reports/${scanId}/fixes`,
      });
      const body = response.json() as {
        data: {
          fixes: Array<{ confidence: string; file: string | null }>;
          connectedRepo: { repoPath: string } | null;
        };
      };
      expect(body.data.fixes[0].confidence).toBe('medium');
      expect(body.data.fixes[0].file).toBe('src/templates');
      expect(body.data.connectedRepo).not.toBeNull();
    });

    it('includes scan jurisdictions as comma-separated string', async () => {
      const scanId = await makeScan(ctx, { jurisdictions: ['uk', 'eu'] });
      await ctx.storage.scans.updateScan(scanId, {
        status: 'completed',
        completedAt: new Date().toISOString(),
      });

      const response = await ctx.server.inject({
        method: 'GET',
        url: `/reports/${scanId}/fixes`,
      });
      const body = response.json() as {
        data: { scan: { jurisdictions: string } };
      };
      expect(body.data.scan.jurisdictions).toBe('uk, eu');
    });

    it('renders empty report when report has empty pages array', async () => {
      const reportPath = join(ctx.reportsDir, `${randomUUID()}.json`);
      writeFileSync(reportPath, JSON.stringify({ pages: [] }));

      const scanId = await makeScan(ctx);
      await ctx.storage.scans.updateScan(scanId, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        jsonReportPath: reportPath,
      });
      const response = await ctx.server.inject({
        method: 'GET',
        url: `/reports/${scanId}/fixes`,
      });
      const body = response.json() as { data: { fixCount: number; noReport: boolean } };
      expect(body.data.noReport).toBe(false);
      expect(body.data.fixCount).toBe(0);
    });

    it('uses siteUrl as fallback pageUrl for templateIssues with empty affectedPages', async () => {
      const reportPath = join(ctx.reportsDir, `${randomUUID()}.json`);
      writeFileSync(reportPath, JSON.stringify({
        siteUrl: 'https://example.com',
        templateIssues: [{
          type: 'error',
          code: 'WCAG2AA',
          message: 'Img element missing an alt attribute',
          selector: 'img.no-pages',
          context: '<img>',
          wcagCriterion: '1.1.1',
          wcagTitle: 'Non-text Content',
          affectedPages: [],
          affectedCount: 0,
        }],
      }));

      const scanId = await makeScan(ctx);
      await ctx.storage.scans.updateScan(scanId, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        jsonReportPath: reportPath,
      });
      const response = await ctx.server.inject({
        method: 'GET',
        url: `/reports/${scanId}/fixes`,
      });
      const body = response.json() as {
        data: { fixes: Array<{ pageUrl: string }> };
      };
      expect(body.data.fixes[0].pageUrl).toBe('https://example.com');
    });

    it('groups fixes by criterion', async () => {
      const reportPath = join(ctx.reportsDir, `${randomUUID()}.json`);
      writeFileSync(reportPath, JSON.stringify({
        pages: [{
          url: 'https://example.com',
          issues: [
            {
              type: 'error',
              code: 'WCAG2AA',
              message: 'Img element missing an alt attribute',
              selector: 'img.one',
              context: '<img>',
              wcagCriterion: '1.1.1',
            },
            {
              type: 'error',
              code: 'WCAG2AA',
              message: 'Img element missing an alt attribute',
              selector: 'img.two',
              context: '<img>',
              wcagCriterion: '1.1.1',
            },
            {
              type: 'error',
              code: 'WCAG2AA',
              message: 'contrast ratio for this element is less than 4.5',
              selector: 'p.low-contrast',
              context: '<p style="color: #ccc">text</p>',
              wcagCriterion: '1.4.3',
            },
          ],
        }],
      }));

      const scanId = await makeScan(ctx);
      await ctx.storage.scans.updateScan(scanId, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        jsonReportPath: reportPath,
      });
      const response = await ctx.server.inject({
        method: 'GET',
        url: `/reports/${scanId}/fixes`,
      });
      const body = response.json() as {
        data: {
          fixGroups: Array<{ criterion: string; fixes: unknown[] }>;
          fixCount: number;
        };
      };
      // Should have groups for both criteria
      const criteria = body.data.fixGroups.map((g) => g.criterion);
      expect(criteria).toContain('1.1.1');
      expect(criteria).toContain('1.4.3');
    });
  });
});
