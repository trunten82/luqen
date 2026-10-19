/**
 * Phase 89 Plan 01 — GET /api/v1/scans/:scanId/dismissals/preview (FP-14, D-04).
 *
 * The read-only coverage preview behind the mark dialog: "N occurrences on M pages of
 * THIS scan". Plain Fastify + real SQLite; identity and permissions are injected so each
 * test states exactly who is calling. Every test seeds its own orgs and scans.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import {
  CODE,
  SELECTOR,
  SITE_URL,
  openStore,
  buildRouteServer,
  seedOrg,
  seedScan,
  seedDismissal,
  type Store,
  type HarnessUser,
} from '../helpers/issue-dismissal-route-harness.js';

let store: Store;
let server: FastifyInstance | undefined;
let logLines: string[];

beforeEach(async () => {
  store = await openStore();
  logLines = [];
});

afterEach(async () => {
  if (server !== undefined) {
    await server.close();
    server = undefined;
  }
  await store.cleanup();
});

const DISMISS = ['issues.dismiss', 'reports.view'];
const SITE_KEY = 'https://example.test/dev/en-us';

async function as(user: HarnessUser, permissions: readonly string[] = DISMISS) {
  server = await buildRouteServer(
    store.storage,
    { user, permissions },
    { logStream: { write: (chunk: string) => void logLines.push(chunk) } },
  );
  return server;
}

function preview(srv: FastifyInstance, scanId: string, code: string = CODE, selector: string = SELECTOR) {
  return srv.inject({
    method: 'GET',
    url: `/api/v1/scans/${scanId}/dismissals/preview`,
    query: { code, selector },
  });
}

/** Template finding on three pages, core's lifted shape: no page carries it, templateIssues lists the pages. */
function templateReport(siteUrl: string): Record<string, unknown> {
  const pageUrls = [`${siteUrl}a`, `${siteUrl}b`, `${siteUrl}c`, `${siteUrl}d`];
  return {
    pages: pageUrls.map((url) => ({ url, issues: [] })),
    templateIssues: [
      {
        type: 'error',
        code: CODE,
        message: 'contrast',
        selector: '.nav a',
        context: '<a class="nav">x</a>',
        affectedPages: pageUrls.slice(0, 3),
      },
    ],
    summary: { pagesScanned: 4, totalIssues: 3, byLevel: { error: 3, warning: 0, notice: 0 } },
  };
}

describe('GET .../dismissals/preview — counts', () => {
  it('preview counts occurrences and pages of this scan for the rule and element', async () => {
    const org = await seedOrg(store.storage, 'org_a');
    const scan = await seedScan(store.storage, { orgId: org });
    const srv = await as({ role: 'user', currentOrgId: org });
    const res = await preview(srv, scan);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ occurrences: 2, pages: 2 });
  });

  it('preview counts a template finding once per affected page', async () => {
    const org = await seedOrg(store.storage, 'org_a');
    const scan = await seedScan(store.storage, { orgId: org, report: templateReport(SITE_URL) });
    const srv = await as({ role: 'user', currentOrgId: org });
    const res = await preview(srv, scan, CODE, '.nav a');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ occurrences: 3, pages: 3 });
  });

  it('preview returns zero counts when nothing in this scan matches', async () => {
    const org = await seedOrg(store.storage, 'org_a');
    const scan = await seedScan(store.storage, { orgId: org });
    const srv = await as({ role: 'user', currentOrgId: org });
    const res = await preview(srv, scan, CODE, '#not-there');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ occurrences: 0, pages: 0 });
  });

  it.each(['', 'html', 'body', ':root', 'html > body', '/html/body'])(
    'preview refuses the whole-page selector %j without loading the report',
    async (selector) => {
      const org = await seedOrg(store.storage, 'org_a');
      const scan = await seedScan(store.storage, { orgId: org });
      const spy = vi.spyOn(store.storage.scans, 'getReport');
      const srv = await as({ role: 'user', currentOrgId: org });
      const res = await preview(srv, scan, CODE, selector);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ occurrences: 0, pages: 0, refused: true, reason: 'selector' });
      expect(spy).not.toHaveBeenCalled();
      expect(res.body).not.toContain('cannot identify');
    },
  );
});

describe('GET .../dismissals/preview — permission and access', () => {
  it('preview returns 403 without issues.dismiss', async () => {
    const org = await seedOrg(store.storage, 'org_a');
    const scan = await seedScan(store.storage, { orgId: org });
    const srv = await as({ role: 'user', currentOrgId: org }, ['reports.view']);
    expect((await preview(srv, scan)).statusCode).toBe(403);
  });

  it('HARD-03 preview returns 403 for a role holding only issues dismiss', async () => {
    const org = await seedOrg(store.storage, 'org_a');
    const scan = await seedScan(store.storage, { orgId: org });
    const srv = await as({ role: 'user', currentOrgId: org }, ['issues.dismiss']);
    const res = await preview(srv, scan);
    expect(res.statusCode).toBe(403);
    expect(res.json()).not.toHaveProperty('occurrences');
  });

  it('a global admin previews on any org scan', async () => {
    const orgB = await seedOrg(store.storage, 'org_b');
    const scan = await seedScan(store.storage, { orgId: orgB });
    const srv = await as({ role: 'admin' });
    const res = await preview(srv, scan);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ occurrences: 2, pages: 2 });
  });

  it('preview returns 404 for another org scan, a system scan, an unknown scan, a user with no org and an org-scoped key on another org', async () => {
    const orgA = await seedOrg(store.storage, 'org_a');
    const orgB = await seedOrg(store.storage, 'org_b');
    const scanB = await seedScan(store.storage, { orgId: orgB });
    const scanSystem = await seedScan(store.storage, { orgId: 'system' });

    const orgUser = await as({ role: 'user', currentOrgId: orgA });
    const foreign = await preview(orgUser, scanB);
    const system = await preview(orgUser, scanSystem);
    const unknown = await preview(orgUser, 'scan_does_not_exist');
    expect([foreign.statusCode, system.statusCode, unknown.statusCode]).toEqual([404, 404, 404]);
    // Identical body: the caller cannot tell "not yours" from "not there".
    expect(foreign.body).toBe(unknown.body);
    expect(system.body).toBe(unknown.body);
    await server?.close();

    const noOrg = await as({ role: 'user' });
    expect((await preview(noOrg, scanB)).statusCode).toBe(404);
    await server?.close();

    const scopedKey = await as({ role: 'admin', currentOrgId: orgA, orgScopedApiKey: true });
    expect((await preview(scopedKey, scanB)).statusCode).toBe(404);
  });
});

describe('GET .../dismissals/preview — input and report errors', () => {
  it('preview returns 400 for an invalid code', async () => {
    const org = await seedOrg(store.storage, 'org_a');
    const scan = await seedScan(store.storage, { orgId: org });
    const srv = await as({ role: 'user', currentOrgId: org });
    expect((await preview(srv, scan, '   ')).statusCode).toBe(400);
    expect((await preview(srv, scan, 'x'.repeat(301))).statusCode).toBe(400);
  });

  it('preview returns 422 for a scan that is not completed', async () => {
    const org = await seedOrg(store.storage, 'org_a');
    const scan = await seedScan(store.storage, { orgId: org, status: 'queued' });
    const srv = await as({ role: 'user', currentOrgId: org });
    const res = await preview(srv, scan);
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('Scan has no completed report');
  });

  it('preview returns 422 and logs only the error name for an unreadable report', async () => {
    const org = await seedOrg(store.storage, 'org_a');
    const scan = await seedScan(store.storage, { orgId: org, status: 'queued' });
    const reportFile = join(mkdtempSync(join(tmpdir(), 'luqen-preview-')), 'report.json');
    writeFileSync(reportFile, '{"pages": UNIQUE-TOKEN-7d21', 'utf-8');
    await store.storage.scans.updateScan(scan, { status: 'completed', jsonReportPath: reportFile });
    const srv = await as({ role: 'user', currentOrgId: org });
    const res = await preview(srv, scan);
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('Report data not available');
    const warn = logLines.map((l) => JSON.parse(l) as Record<string, unknown>).filter((l) => l['level'] === 40);
    expect(warn).toHaveLength(1);
    expect(warn[0]).toMatchObject({ scanId: scan, errorName: 'SyntaxError' });
    expect(logLines.join('')).not.toContain('UNIQUE-TOKEN');
  });

  it('preview returns 503 when the storage has no dismissal repository', async () => {
    const org = await seedOrg(store.storage, 'org_a');
    const scan = await seedScan(store.storage, { orgId: org });
    const bare = Object.create(store.storage, { issueDismissals: { value: undefined } });
    server = await buildRouteServer(bare, { user: { role: 'user', currentOrgId: org }, permissions: DISMISS });
    expect((await preview(server, scan)).statusCode).toBe(503);
  });
});

describe('GET .../dismissals/preview — read-only', () => {
  it('preview writes nothing', async () => {
    const org = await seedOrg(store.storage, 'org_a');
    const scan = await seedScan(store.storage, { orgId: org });
    const existing = await seedDismissal(store.storage, { orgId: org, selector: '#nav a', code: 'WCAG2AA.Principle2.Other' });
    await store.storage.scans.updateScan(scan, { errors: 7, warnings: 5, notices: 3, totalIssues: 15 });

    const snapshot = async () => {
      const dismissals = await store.storage.issueDismissals!.listForSite(org, SITE_KEY);
      const events = await store.storage.issueDismissals!.listEvents(existing.id);
      const audit = await store.storage.audit.query({ resourceType: 'issue_dismissal' });
      const row = await store.storage.scans.getScan(scan);
      return {
        dismissals: dismissals.length,
        events: events.length,
        audit: audit.entries.length,
        counts: [row?.errors, row?.warnings, row?.notices, row?.totalIssues],
      };
    };
    const before = await snapshot();

    const srv = await as({ role: 'user', currentOrgId: org });
    for (let i = 0; i < 3; i += 1) {
      expect((await preview(srv, scan)).statusCode).toBe(200);
    }
    // Also the already-dismissed key: preview reads the RAW report, so it is non-zero (and flagged) and still writes nothing.
    const dismissedKey = await preview(srv, scan, 'WCAG2AA.Principle2.Other', '#nav a');
    expect(dismissedKey.json()).toEqual({ occurrences: 2, pages: 2, alreadyDismissed: true });

    expect(await snapshot()).toEqual(before);
    expect(before.counts).toEqual([7, 5, 3, 15]);
  });
});

describe('GET .../dismissals/preview — already dismissed (89-04)', () => {
  const OTHER = { code: 'WCAG2AA.Principle2.Other', selector: '#nav a' };

  it('preview flags a rule and element that is already actively dismissed for the site', async () => {
    const org = await seedOrg(store.storage, 'org_a');
    const scan = await seedScan(store.storage, { orgId: org });
    await seedDismissal(store.storage, { orgId: org, ...OTHER });
    const srv = await as({ role: 'user', currentOrgId: org });
    const res = await preview(srv, scan, OTHER.code, OTHER.selector);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ occurrences: 2, pages: 2, alreadyDismissed: true });
  });

  it('preview does not flag a key that is not dismissed (the key is absent, not false)', async () => {
    const org = await seedOrg(store.storage, 'org_a');
    const scan = await seedScan(store.storage, { orgId: org });
    await seedDismissal(store.storage, { orgId: org, ...OTHER });
    const srv = await as({ role: 'user', currentOrgId: org });
    const res = await preview(srv, scan);
    expect(res.json()).toEqual({ occurrences: 2, pages: 2 });
    expect('alreadyDismissed' in (res.json() as object)).toBe(false);
  });

  it('preview does not flag a dismissal that was revoked', async () => {
    const org = await seedOrg(store.storage, 'org_a');
    const scan = await seedScan(store.storage, { orgId: org });
    const d = await seedDismissal(store.storage, { orgId: org, ...OTHER });
    await store.storage.issueDismissals!.revoke({ id: d.id, orgId: org, actor: 'seed', comment: null });
    const srv = await as({ role: 'user', currentOrgId: org });
    const res = await preview(srv, scan, OTHER.code, OTHER.selector);
    expect(res.json()).toEqual({ occurrences: 2, pages: 2 });
  });

  it('preview does not flag a dismissal that belongs to another org', async () => {
    const org = await seedOrg(store.storage, 'org_a');
    const other = await seedOrg(store.storage, 'org_b');
    const scan = await seedScan(store.storage, { orgId: org });
    await seedDismissal(store.storage, { orgId: other, ...OTHER });
    const srv = await as({ role: 'user', currentOrgId: org });
    const res = await preview(srv, scan, OTHER.code, OTHER.selector);
    expect(res.json()).toEqual({ occurrences: 2, pages: 2 });
  });
});
