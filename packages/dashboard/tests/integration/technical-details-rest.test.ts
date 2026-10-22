/**
 * API-01..API-04 (Phase 93, owner ruling 2): the REST data API follows the report page. A caller
 * without reports.view_technical receives no element selector and no element markup.
 *
 * Boots the REAL createServer, so the auth guard, the permission resolution in the preHandler, the
 * API-key role guard and the routes are the production ones. Sessions (Owner, Analyst) log in
 * through /login; API keys authenticate with X-API-Key. The stored report carries unique canary
 * strings in the selector, the markup and the message of every issue copy the routes can serve; the
 * assertions are over the WHOLE response body, and the message canary is the control that shows the
 * matcher can match.
 *
 * D-09: the permission set each API key role resolves to is pinned in ONE table (KEY_ROLES). If the
 * owner later rules that read-only keys keep selectors, the change is the permission set and the
 * selector flag of one row, not the helper.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../src/server.js';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { generateApiKey } from '../../src/auth/api-key.js';
import {
  ALL_PERMISSION_IDS,
  ORG_OWNER_PERMISSIONS,
  resolveEffectivePermissions,
} from '../../src/permissions.js';
import type { ApiKeyRole } from '../../src/db/types.js';
import { seedSurfaceDismissal, seedSurfaceScan } from '../helpers/dismissal-surface-fixture.js';
import * as technicalDetails from '../../src/services/technical-details.js';

// Pass-through wrappers, so a test can see whether a route ran the blob redaction at all.
vi.mock('../../src/services/technical-details.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/technical-details.js')>();
  return {
    ...actual,
    reportBlobForViewer: vi.fn(actual.reportBlobForViewer),
    reportForViewer: vi.fn(actual.reportForViewer),
  };
});

const PASSWORD = 'Technical-Pass-123!';
const CODE = 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail';
const HEX = randomUUID().replace(/-/g, '').slice(0, 16);
const SELECTOR = `#selcanary${HEX}`;
const SELECTOR_ID = `selcanary${HEX}`;
const CONTEXT_ID = `ctxcanary${HEX}`;
const MESSAGE = `msgcanary${HEX}`;

/** One expectation table for the API-key pin (D-09). The permission set is what the key resolves to. */
interface KeyRole {
  readonly label: string;
  readonly role: ApiKeyRole;
  readonly orgScoped: boolean;
  readonly resolves: () => ReadonlySet<string>;
  /** Does a key of this kind receive element selectors? Flip with `resolves`, never in the helper. */
  readonly seesSelectors: boolean;
}
const KEY_ROLES: readonly KeyRole[] = [
  { label: 'org admin', role: 'admin', orgScoped: true, resolves: () => new Set(ORG_OWNER_PERMISSIONS), seesSelectors: true },
  { label: 'org read-only', role: 'read-only', orgScoped: true, resolves: () => new Set<string>(), seesSelectors: false },
  { label: 'org scan-only', role: 'scan-only', orgScoped: true, resolves: () => new Set<string>(), seesSelectors: false },
  { label: 'system admin', role: 'admin', orgScoped: false, resolves: () => new Set(ALL_PERMISSION_IDS), seesSelectors: true },
  { label: 'system read-only', role: 'read-only', orgScoped: false, resolves: () => new Set<string>(), seesSelectors: false },
];

function issue(): Record<string, unknown> {
  return { type: 'error', code: CODE, message: MESSAGE, selector: SELECTOR, context: `<p id="${CONTEXT_ID}">x</p>` };
}

/** A stored report with the canaries in every location an issue copy can sit. */
function canaryReport(siteUrl: string): Record<string, unknown> {
  return {
    summary: { pagesScanned: 1, totalIssues: 1, byLevel: { error: 1, warning: 0, notice: 0 } },
    pages: [{ url: siteUrl, issueCount: 1, issues: [issue()] }],
    templateIssues: [issue()],
    compliance: {
      annotatedIssues: [{ code: CODE, wcagCriterion: '1.4.3', originalIssue: issue(), regulations: [] }],
    },
  };
}

let tmpRoot: string;
let app: FastifyInstance;
let seed: SqliteStorageAdapter;
let orgId: string;
let scanId: string;
/** The same report stored in the 'system' org: a system key without an org header acts there. */
let systemScanId: string;
let storedBlob: string;
/** A scan whose findings the fix-suggestion engine recognises, so /fixes has rows. */
let fixScanId: string;
/** A scan with one active dismissal: the dismissal branch of the list and detail routes. */
let dismissedScanId: string;
const keys = new Map<string, string>();

const tokenOf = (html: string): string | undefined =>
  /name="csrf-token" content="([^"]+)"/.exec(html)?.[1] ?? /name="_csrf" value="([^"]+)"/.exec(html)?.[1];

/** One login per user: the login route is rate limited, and a session cookie serves every request. */
const cookies = new Map<string, string>();

async function login(username: string): Promise<string> {
  const cached = cookies.get(username);
  if (cached !== undefined) return cached;
  const loginPage = await app.inject({ method: 'GET', url: '/login' });
  const loginCookie = loginPage.cookies.find((c) => c.name === 'session')!.value;
  const res = await app.inject({
    method: 'POST', url: '/login', cookies: { session: loginCookie },
    headers: { 'x-csrf-token': tokenOf(loginPage.body)! },
    payload: { username, password: PASSWORD },
  });
  expect(res.statusCode).toBe(302);
  const cookie = res.cookies.find((c) => c.name === 'session')!.value;
  cookies.set(username, cookie);
  return cookie;
}

async function asSession(username: string, url: string): Promise<{ status: number; body: string }> {
  const cookie = await login(username);
  const res = await app.inject({ method: 'GET', url, cookies: { session: cookie } });
  return { status: res.statusCode, body: res.body };
}

/** `path` is the route below /api/v1/scans/:id; an org key reads the org scan, a system key the system-org scan. */
async function asKey(kr: KeyRole, path: string): Promise<{ status: number; body: string }> {
  const id = kr.orgScoped ? scanId : systemScanId;
  const res = await app.inject({
    method: 'GET', url: `/api/v1/scans/${id}${path}`, headers: { 'x-api-key': keys.get(kr.label)! },
  });
  return { status: res.statusCode, body: res.body };
}

function rowsOf(body: string): Array<Record<string, unknown>> {
  return (JSON.parse(body) as { data: Array<Record<string, unknown>> }).data;
}

/**
 * The context canary check here is a redaction check only on a route that serves `context` to an
 * entitled caller. /issues and /fixes project explicit fields and never serve it to anyone; the
 * test 'IN-09 /issues and /fixes never serve context' pins that, so the check is not read as one.
 */
function expectNoTechnical(res: { status: number; body: string }): void {
  expect(res.status).toBe(200);
  const rows = rowsOf(res.body);
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) expect('selector' in row, 'selector key present').toBe(false);
  expect(res.body).not.toContain(SELECTOR_ID);
  expect(res.body).not.toContain(CONTEXT_ID);
  expect(res.body).toContain(MESSAGE);
}

function expectSelector(res: { status: number; body: string }): void {
  expect(res.status).toBe(200);
  const rows = rowsOf(res.body);
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) expect(row['selector']).toBe(SELECTOR);
  expect(res.body).toContain(MESSAGE);
}

beforeAll(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'luqen-technical-details-rest-'));
  const dbPath = join(tmpRoot, 'dashboard.db');
  const reportsDir = join(tmpRoot, 'reports');
  mkdirSync(reportsDir, { recursive: true });
  app = (await createServer({
    dbPath, reportsDir, sessionSecret: 't'.repeat(32),
    catalogueUrl: '', catalogueCacheTtl: 0, redisUrl: '', maxConcurrentScans: 1,
  } as never)) as FastifyInstance;
  await app.ready();
  seed = new SqliteStorageAdapter(dbPath);
  await seed.migrate();
  orgId = (await seed.organizations.createOrg({ name: 'Fabrikam', slug: `fabrikam-${HEX.slice(0, 8)}` })).id;

  const owner = await seed.users.createUser('fabrikam-owner', PASSWORD, 'user');
  const ownerRole = await seed.roles.getRoleByNameAndOrg('Owner', orgId);
  const owners = await seed.teams.createTeam({ name: 'owners', description: '', orgId, roleId: ownerRole!.id });
  await seed.teams.addTeamMember(owners.id, owner.id);
  await seed.organizations.addMember(orgId, owner.id, 'owner');

  // Everything an analyst does except see technical details, so the missing permission is the only variable.
  const analyst = await seed.users.createUser('fabrikam-analyst', PASSWORD, 'user');
  const analystRole = await seed.roles.createRole({
    name: 'Analyst', description: 'All report work without technical details',
    permissions: ['reports.view', 'reports.export', 'issues.fix', 'issues.assign', 'issues.dismiss', 'llm.view'], orgId,
  });
  const analysts = await seed.teams.createTeam({ name: 'analysts', description: '', orgId, roleId: analystRole.id });
  await seed.teams.addTeamMember(analysts.id, analyst.id);
  await seed.organizations.addMember(orgId, analyst.id, 'member');

  for (const kr of KEY_ROLES) {
    const key = generateApiKey();
    await seed.apiKeys.storeKey(key, `technical-${kr.label}`, kr.orgScoped ? orgId : 'system', kr.role);
    keys.set(kr.label, key);
  }

  const siteUrl = `https://fabrikam.example/${HEX.slice(0, 8)}/`;
  const report = canaryReport(siteUrl);
  scanId = await seedSurfaceScan(seed, { orgId, siteUrl, report, location: 'both', reportsDir });
  storedBlob = JSON.stringify(report);
  const dismissedSite = `https://fabrikam.example/dismissed-${HEX.slice(0, 8)}/`;
  const dismissedReport = canaryReport(dismissedSite);
  (dismissedReport['pages'] as Array<{ issues: unknown[] }>)[0]!.issues.push({
    type: 'error', code: CODE, message: 'a finding that gets dismissed', selector: '#dismissed-one', context: '<p>d</p>',
  });
  dismissedScanId = await seedSurfaceScan(seed, { orgId, siteUrl: dismissedSite, report: dismissedReport, location: 'both', reportsDir });
  await seedSurfaceDismissal(seed, { orgId, siteUrl: dismissedSite, match: { code: CODE, selector: '#dismissed-one' } });

  const fixSite = `https://fabrikam.example/fix-${HEX.slice(0, 8)}/`;
  fixScanId = await seedSurfaceScan(seed, {
    orgId, siteUrl: fixSite, location: 'both', reportsDir,
    report: {
      summary: { pagesScanned: 1, totalIssues: 1, byLevel: { error: 1, warning: 0, notice: 0 } },
      pages: [{
        url: fixSite, issueCount: 1,
        issues: [{
          type: 'error', code: CODE, wcagCriterion: '1.4.3',
          message: 'Insufficient contrast: the contrast ratio on the note is less than 4.5:1',
          selector: SELECTOR, context: `<p id="${CONTEXT_ID}">x</p>`,
        }],
      }],
    },
  });
  systemScanId = await seedSurfaceScan(seed, { orgId: 'system', siteUrl, report, location: 'both', reportsDir });
}, 120_000);

afterAll(async () => {
  if (seed !== undefined) await seed.disconnect();
  if (app !== undefined) await app.close();
  if (tmpRoot !== undefined) rmSync(tmpRoot, { recursive: true, force: true });
});

describe('GET /api/v1/scans/:id/issues for sessions', () => {
  it('API-01 an Analyst session gets issue rows with no selector key and no selector canary', async () => {
    const effective = await seed.roles.getEffectivePermissions((await seed.users.getUserByUsername('fabrikam-analyst'))!.id, orgId);
    expect(effective.has('reports.view')).toBe(true);
    expect(effective.has('reports.view_technical')).toBe(false);
    expectNoTechnical(await asSession('fabrikam-analyst', `/api/v1/scans/${scanId}/issues`));
  }, 60_000);

  it('API-01 an Owner session gets issue rows whose selector is the canary', async () => {
    expectSelector(await asSession('fabrikam-owner', `/api/v1/scans/${scanId}/issues`));
  }, 60_000);
});

describe('IN-09 the context canary', () => {
  it('IN-09 the stored fixture carries the context canary and an entitled caller is served it', async () => {
    expect(storedBlob).toContain(CONTEXT_ID);
    const res = await asSession('fabrikam-owner', `/api/v1/scans/${scanId}`);
    expect(res.status).toBe(200);
    expect(res.body).toContain(CONTEXT_ID);
  }, 60_000);

  it('IN-09 /issues and /fixes never serve context, for an entitled caller either (their contract has no context field)', async () => {
    for (const url of [`/api/v1/scans/${scanId}/issues`, `/api/v1/scans/${fixScanId}/fixes`]) {
      const res = await asSession('fabrikam-owner', url);
      expect(res.status).toBe(200);
      const rows = rowsOf(res.body);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row['selector']).toBe(SELECTOR);
        expect('context' in row, `context key present in ${url}`).toBe(false);
      }
      expect(res.body).not.toContain(CONTEXT_ID);
    }
  }, 60_000);
});

describe('GET /api/v1/scans/:id/issues for API keys', () => {
  for (const kr of KEY_ROLES) {
    const verb = kr.seesSelectors ? 'gets the selector' : 'gets no selector key';
    it(`API-04 a ${kr.label} API key ${verb}`, async () => {
      const res = await asKey(kr, '/issues');
      if (kr.seesSelectors) expectSelector(res);
      else expectNoTechnical(res);
    }, 60_000);
  }
});

describe('what an API key resolves to (D-09 pin)', () => {
  for (const kr of KEY_ROLES) {
    it(`API-04 a ${kr.label} key resolves to exactly the expected permission set`, async () => {
      // The arguments the server.ts preHandler passes: user id api-key, the key's role, the key's org.
      const resolved = await resolveEffectivePermissions(
        seed.roles, 'api-key', kr.role, kr.orgScoped ? orgId : undefined, { orgScopedApiKey: kr.orgScoped },
      );
      expect([...resolved].sort()).toEqual([...kr.resolves()].sort());
      expect(resolved.has('reports.view_technical')).toBe(kr.seesSelectors);
    });
  }
});

describe('GET /api/v1/scans/:id serves the embedded raw report', () => {
  it('API-02 an Analyst gets no selector or context canary anywhere and the message canary inside data.jsonReport', async () => {
    const res = await asSession('fabrikam-analyst', `/api/v1/scans/${scanId}`);
    expect(res.status).toBe(200);
    expect(res.body).not.toContain(SELECTOR_ID);
    expect(res.body).not.toContain(CONTEXT_ID);
    const blob = (JSON.parse(res.body) as { data: { jsonReport: string } }).data.jsonReport;
    expect(typeof blob).toBe('string');
    expect(blob).toContain(MESSAGE);
    expect(() => JSON.parse(blob)).not.toThrow();
  }, 60_000);

  it('API-02 an Owner gets data.jsonReport byte-identical to the stored row blob', async () => {
    const res = await asSession('fabrikam-owner', `/api/v1/scans/${scanId}`);
    expect(res.status).toBe(200);
    expect((JSON.parse(res.body) as { data: { jsonReport: string } }).data.jsonReport).toBe(storedBlob);
  }, 60_000);

  it('API-02 an API key without the permission gets no canary from the detail route', async () => {
    const kr = KEY_ROLES.find((k) => k.label === 'org read-only')!;
    const res = await asKey(kr, '');
    expect(res.status).toBe(200);
    expect(res.body).not.toContain(SELECTOR_ID);
    expect(res.body).not.toContain(CONTEXT_ID);
    expect(res.body).toContain(MESSAGE);
  }, 60_000);
});

describe('GET /api/v1/scans lists rows with their raw report', () => {
  const rowFor = (body: string): Record<string, unknown> =>
    rowsOf(body).find((r) => r['id'] === scanId)!;

  it('D-10 an Analyst gets list rows with no jsonReport key, and the blob is never redacted for them', async () => {
    await login('fabrikam-analyst');
    vi.mocked(technicalDetails.reportBlobForViewer).mockClear();
    vi.mocked(technicalDetails.reportForViewer).mockClear();
    const res = await asSession('fabrikam-analyst', '/api/v1/scans');
    expect(res.status).toBe(200);
    // The rows themselves are served: the plain scan row and the row of a site with a dismissal.
    for (const id of [scanId, dismissedScanId]) {
      const row = rowsOf(res.body).find((r) => r['id'] === id);
      expect(row, `row ${id} listed`).toBeDefined();
      expect('jsonReport' in row!, 'jsonReport key present').toBe(false);
    }
    expect(res.body).not.toContain(MESSAGE);
    expect(res.body).not.toContain(SELECTOR_ID);
    expect(res.body).not.toContain(CONTEXT_ID);
    expect(technicalDetails.reportBlobForViewer).not.toHaveBeenCalled();
    expect(technicalDetails.reportForViewer).not.toHaveBeenCalled();
  }, 60_000);

  it('D-08 an Owner gets the stored blob in the list row', async () => {
    const res = await asSession('fabrikam-owner', '/api/v1/scans');
    expect(res.status).toBe(200);
    expect(rowFor(res.body)['jsonReport']).toBe(storedBlob);
  }, 60_000);
});

describe('GET /api/v1/scans/:id/fixes', () => {
  it('D-08 an Analyst gets fix rows with no selector key', async () => {
    const res = await asSession('fabrikam-analyst', `/api/v1/scans/${fixScanId}/fixes`);
    expect(res.status).toBe(200);
    const rows = rowsOf(res.body);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect('selector' in row, 'selector key present').toBe(false);
    expect(res.body).not.toContain(SELECTOR_ID);
    expect(res.body).toContain('Insufficient contrast');
  }, 60_000);

  it('D-08 an Owner gets fix rows with the selector', async () => {
    const res = await asSession('fabrikam-owner', `/api/v1/scans/${fixScanId}/fixes`);
    expect(res.status).toBe(200);
    const rows = rowsOf(res.body);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row['selector']).toBe(SELECTOR);
  }, 60_000);
});

describe('the published OpenAPI document', () => {
  type Schema = { description?: string; anyOf?: Schema[]; properties?: Record<string, Schema> };
  type Spec = { paths: Record<string, { get?: { responses: Record<string, { content: Record<string, { schema: Schema }> }> } }> };

  function responseSchema(spec: Spec, path: string): Schema {
    return spec.paths[path]!.get!.responses['200']!.content['application/json']!.schema;
  }
  /** The row schema: data is an array of rows, or (scan detail) an object. */
  function rowSchema(root: Schema): Schema {
    const data = root.properties!['data']! as Schema & { items?: Schema };
    return data.items ?? data;
  }
  const describes = (schema: Schema | undefined): boolean =>
    schema?.description !== undefined && schema.description.includes('reports.view_technical');

  it('D-10 the swagger document describes selector and jsonReport as present only with reports.view_technical', () => {
    const spec = app.swagger() as unknown as Spec;
    const issues = rowSchema(responseSchema(spec, '/api/v1/scans/{id}/issues'));
    const fixes = rowSchema(responseSchema(spec, '/api/v1/scans/{id}/fixes'));
    const list = rowSchema(responseSchema(spec, '/api/v1/scans'));
    const detail = rowSchema(responseSchema(spec, '/api/v1/scans/{id}'));
    expect(describes(issues.properties?.['selector'])).toBe(true);
    expect(describes(fixes.properties?.['selector'])).toBe(true);
    expect(describes(list.properties?.['jsonReport'])).toBe(true);
    expect(list.properties?.['jsonReport']?.description).toContain('GET /api/v1/scans/{id}');
    expect(describes(detail.properties?.['jsonReport'])).toBe(true);
  });
});

describe('rows whose site has an active dismissal', () => {
  it('API-02 an Analyst gets no selector or context canary from the detail of a scan with a dismissal', async () => {
    const res = await asSession('fabrikam-analyst', `/api/v1/scans/${dismissedScanId}`);
    expect(res.status).toBe(200);
    expect(res.body).toContain(MESSAGE);
    expect(res.body).not.toContain('dismissed-one');
    expect(res.body).not.toContain(SELECTOR_ID);
    expect(res.body).not.toContain(CONTEXT_ID);
  }, 60_000);

  it('D-08 an Owner keeps the surviving selector in the list row of a site with a dismissal', async () => {
    const res = await asSession('fabrikam-owner', '/api/v1/scans');
    const row = rowsOf(res.body).find((r) => r['id'] === dismissedScanId)!;
    expect(String(row['jsonReport'])).toContain(SELECTOR_ID);
    expect(String(row['jsonReport'])).not.toContain('dismissed-one');
  }, 60_000);
});
