/**
 * Route-test harness for the Phase 87 issue-dismissal routes.
 *
 * Plain Fastify + a real tmp-file SqliteStorageAdapter + issueDismissalRoutes.
 * A preHandler injects request.user and request.permissions (the
 * bulk-fixes.test.ts pattern) so each test chooses its identity and permission
 * set explicitly — the real permission resolution is covered by the
 * createServer-level e2e test.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, rmSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import type { StorageAdapter } from '../../src/db/index.js';
import type { IssueDismissal } from '../../src/db/interfaces/issue-dismissal-repository.js';
import { issueDismissalRoutes } from '../../src/routes/api/issue-dismissals.js';
import { toSiteKey } from '../../src/services/issue-dismissals/site-key.js';

export const CODE = 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail';
export const SELECTOR = '#hero > p';
export const OTHER_SELECTOR = '#nav a';
export const SITE_URL = 'https://example.test/dev/en-us/';

export interface HarnessUser {
  readonly id?: string;
  readonly username?: string;
  readonly role: string;
  readonly currentOrgId?: string;
  readonly orgScopedApiKey?: boolean;
}

export interface Store {
  readonly storage: SqliteStorageAdapter;
  cleanup(): Promise<void>;
}

export async function openStore(): Promise<Store> {
  const dbPath = join(tmpdir(), `test-issue-dismissal-routes-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  return {
    storage,
    async cleanup() {
      await storage.disconnect();
      if (existsSync(dbPath)) rmSync(dbPath);
    },
  };
}

export async function buildRouteServer(
  storage: StorageAdapter,
  identity: { readonly user: HarnessUser; readonly permissions: readonly string[] },
): Promise<FastifyInstance> {
  const server = Fastify();
  server.addHook('preHandler', async (request) => {
    request.user = {
      id: identity.user.id ?? 'u-tester',
      username: identity.user.username ?? 'tester',
      role: identity.user.role,
      ...(identity.user.currentOrgId !== undefined ? { currentOrgId: identity.user.currentOrgId } : {}),
      ...(identity.user.orgScopedApiKey === true ? { orgScopedApiKey: true } : {}),
    } as never;
    (request as unknown as { permissions: Set<string> }).permissions = new Set(identity.permissions);
  });
  await issueDismissalRoutes(server, storage);
  await server.ready();
  return server;
}

/** Report with two findings on two pages plus an `html`-selector engine fallback finding. */
export function defaultReport(siteUrl: string): Record<string, unknown> {
  const pageIssues = [
    { type: 'error', code: CODE, message: 'contrast', selector: SELECTOR, context: '<p>x</p>' },
    { type: 'warning', code: 'WCAG2AA.Principle2.Other', message: 'other', selector: OTHER_SELECTOR, context: '<a>x</a>' },
    { type: 'notice', code: 'lighthouse.fallback', message: 'whole page', selector: 'html', context: '' },
  ];
  return {
    pages: [
      { url: siteUrl, issues: pageIssues },
      { url: `${siteUrl}about`, issues: pageIssues },
    ],
    summary: { pagesScanned: 2, totalIssues: 6, byLevel: { error: 2, warning: 2, notice: 2 } },
  };
}

export async function seedOrg(storage: StorageAdapter, slug: string): Promise<string> {
  const org = await storage.organizations.createOrg({ name: slug, slug });
  return org.id;
}

export async function seedScan(
  storage: StorageAdapter,
  opts: { orgId: string; siteUrl?: string; status?: 'queued' | 'completed'; report?: Record<string, unknown> },
): Promise<string> {
  const siteUrl = opts.siteUrl ?? SITE_URL;
  const id = `scan_${randomUUID().replace(/-/g, '')}`;
  await storage.scans.createScan({
    id,
    siteUrl,
    standard: 'WCAG2AA',
    jurisdictions: [],
    regulations: [],
    createdBy: 'seed',
    createdAt: new Date().toISOString(),
    orgId: opts.orgId,
  });
  if ((opts.status ?? 'completed') === 'completed') {
    await storage.scans.updateScan(id, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      jsonReport: JSON.stringify(opts.report ?? defaultReport(siteUrl)),
    });
  }
  return id;
}

/** Seed an already-active dismissal straight through the repository. */
export async function seedDismissal(
  storage: StorageAdapter,
  opts: { orgId: string; siteUrl?: string; code?: string; selector?: string; reason?: string },
): Promise<IssueDismissal> {
  const siteUrl = opts.siteUrl ?? SITE_URL;
  const result = await storage.issueDismissals!.mark({
    orgId: opts.orgId,
    siteUrl,
    siteKey: toSiteKey(siteUrl),
    code: opts.code ?? CODE,
    selector: opts.selector ?? SELECTOR,
    reason: opts.reason ?? 'seeded',
    actor: 'seed',
  });
  if (result.kind !== 'created') throw new Error('seedDismissal: key already active');
  return result.dismissal;
}

export const ADMIN_ALL = ['issues.dismiss', 'reports.view'] as const;
