/**
 * API-03 (Phase 93, owner ruling 2) and D-08: GraphQL follows the report page. A caller without
 * reports.view_technical receives no element selector and no element markup from scanIssues, and
 * no selector or selector-bearing fingerprint from any resolver that returns an Assignment.
 *
 * Boots the REAL createServer, so the mercurius context (permissions from the preHandler), the
 * CSRF guard and the resolvers are the production ones. The stored report carries unique canaries
 * in the selector, the markup and the message; assertions run over the WHOLE response body, and
 * the message canary is the control that shows the matcher can match.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../src/server.js';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { generateApiKey } from '../../src/auth/api-key.js';
import { seedSurfaceScan } from '../helpers/dismissal-surface-fixture.js';

const PASSWORD = 'Technical-Pass-123!';
const CODE = 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail';
const HEX = randomUUID().replace(/-/g, '').slice(0, 16);
const SELECTOR = `#selcanary${HEX}`;
const SELECTOR_ID = `selcanary${HEX}`;
const CONTEXT_ID = `ctxcanary${HEX}`;
const MESSAGE = `msgcanary${HEX}`;
/** Built the way report-detail.hbs builds a per-issue fingerprint: code|selector|message. */
const FINGERPRINT = `${CODE}|${SELECTOR}|${MESSAGE}`;

function canaryReport(siteUrl: string): Record<string, unknown> {
  return {
    summary: { pagesScanned: 1, totalIssues: 1, byLevel: { error: 1, warning: 0, notice: 0 } },
    pages: [{
      url: siteUrl, issueCount: 1,
      issues: [{
        type: 'error', code: CODE, wcagCriterion: '1.4.3', message: MESSAGE,
        selector: SELECTOR, context: `<p id="${CONTEXT_ID}">x</p>`,
      }],
    }],
  };
}

let tmpRoot: string;
let app: FastifyInstance;
let seed: SqliteStorageAdapter;
let orgId: string;
let scanId: string;
let systemScanId: string;
let systemReadOnlyKey: string;
let storedAssignmentId: string;
const cookies = new Map<string, string>();

const tokenOf = (html: string): string | undefined =>
  /name="csrf-token" content="([^"]+)"/.exec(html)?.[1] ?? /name="_csrf" value="([^"]+)"/.exec(html)?.[1];

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

interface GqlResult { readonly status: number; readonly body: string; readonly data: Record<string, any> | undefined; readonly errors: unknown }

async function gqlAs(username: string, query: string): Promise<GqlResult> {
  const cookie = await login(username);
  const res = await app.inject({
    method: 'POST', url: '/graphql', cookies: { session: cookie },
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ query }),
  });
  const parsed = JSON.parse(res.body) as { data?: Record<string, any>; errors?: unknown };
  return { status: res.statusCode, body: res.body, data: parsed.data, errors: parsed.errors };
}

async function gqlAsKey(key: string, query: string): Promise<GqlResult> {
  const res = await app.inject({
    method: 'POST', url: '/graphql',
    headers: { 'content-type': 'application/json', 'x-api-key': key },
    payload: JSON.stringify({ query }),
  });
  const parsed = JSON.parse(res.body) as { data?: Record<string, any>; errors?: unknown };
  return { status: res.statusCode, body: res.body, data: parsed.data, errors: parsed.errors };
}

const ISSUES_QUERY = (id: string): string =>
  `{ scanIssues(scanId: "${id}") { totalCount nodes { code message selector context pageUrl } } }`;
const ASSIGNMENTS_QUERY = (id: string): string =>
  `{ assignments(scanId: "${id}") { id selector issueFingerprint message } }`;

beforeAll(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'luqen-technical-details-graphql-'));
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

  systemReadOnlyKey = generateApiKey();
  await seed.apiKeys.storeKey(systemReadOnlyKey, 'technical-graphql-system-read-only', 'system', 'read-only');

  const siteUrl = `https://fabrikam.example/${HEX.slice(0, 8)}/`;
  scanId = await seedSurfaceScan(seed, { orgId, siteUrl, report: canaryReport(siteUrl), location: 'both', reportsDir });
  systemScanId = await seedSurfaceScan(seed, { orgId: 'system', siteUrl, report: canaryReport(siteUrl), location: 'both', reportsDir });

  storedAssignmentId = randomUUID();
  const now = new Date().toISOString();
  await seed.assignments.createAssignment({
    id: storedAssignmentId, scanId, issueFingerprint: FINGERPRINT, wcagCriterion: '1.4.3',
    severity: 'error', message: MESSAGE, selector: SELECTOR, pageUrl: siteUrl,
    createdBy: 'fabrikam-owner', createdAt: now, updatedAt: now, orgId,
  });
}, 120_000);

afterAll(async () => {
  if (seed !== undefined) await seed.disconnect();
  if (app !== undefined) await app.close();
  if (tmpRoot !== undefined) rmSync(tmpRoot, { recursive: true, force: true });
});

describe('GraphQL scanIssues', () => {
  it('API-03 an Analyst session gets every node with selector null and context null and no canary', async () => {
    const res = await gqlAs('fabrikam-analyst', ISSUES_QUERY(scanId));
    expect(res.errors).toBeUndefined();
    const nodes = res.data!['scanIssues'].nodes as Array<Record<string, unknown>>;
    expect(nodes.length).toBeGreaterThan(0);
    for (const node of nodes) {
      expect(node['selector']).toBeNull();
      expect(node['context']).toBeNull();
    }
    expect(res.body).not.toContain(SELECTOR_ID);
    expect(res.body).not.toContain(CONTEXT_ID);
    expect(res.body).toContain(MESSAGE);
  }, 60_000);

  it('API-03 an Owner session gets the selector and context canaries', async () => {
    const res = await gqlAs('fabrikam-owner', ISSUES_QUERY(scanId));
    expect(res.errors).toBeUndefined();
    const nodes = res.data!['scanIssues'].nodes as Array<Record<string, unknown>>;
    expect(nodes.length).toBeGreaterThan(0);
    for (const node of nodes) {
      expect(node['selector']).toBe(SELECTOR);
      expect(String(node['context'])).toContain(CONTEXT_ID);
    }
    expect(res.body).toContain(MESSAGE);
  }, 60_000);

  it('API-04 a system read-only API key keeps the selector and context', async () => {
    const res = await gqlAsKey(systemReadOnlyKey, ISSUES_QUERY(systemScanId));
    expect(res.errors).toBeUndefined();
    const nodes = res.data!['scanIssues'].nodes as Array<Record<string, unknown>>;
    expect(nodes.length).toBeGreaterThan(0);
    for (const node of nodes) {
      expect(node['selector']).toBe(SELECTOR);
      expect(String(node['context'])).toContain(CONTEXT_ID);
    }
    expect(res.body).toContain(MESSAGE);
  }, 60_000);
});

describe('GraphQL assignments', () => {
  it('D-08 an Analyst gets selector null and issueFingerprint null while the stored row keeps both', async () => {
    const res = await gqlAs('fabrikam-analyst', ASSIGNMENTS_QUERY(scanId));
    expect(res.errors).toBeUndefined();
    const rows = res.data!['assignments'] as Array<Record<string, unknown>>;
    expect(rows.length).toBe(1);
    expect(rows[0]!['selector']).toBeNull();
    expect(rows[0]!['issueFingerprint']).toBeNull();
    expect(res.body).not.toContain(SELECTOR_ID);
    expect(res.body).toContain(MESSAGE);
    const stored = await seed.assignments.getAssignment(storedAssignmentId);
    expect(stored!.selector).toBe(SELECTOR);
    expect(stored!.issueFingerprint).toBe(FINGERPRINT);
  }, 60_000);

  it('D-08 an Owner gets the stored selector and issueFingerprint', async () => {
    const res = await gqlAs('fabrikam-owner', ASSIGNMENTS_QUERY(scanId));
    expect(res.errors).toBeUndefined();
    const rows = res.data!['assignments'] as Array<Record<string, unknown>>;
    expect(rows.length).toBe(1);
    expect(rows[0]!['selector']).toBe(SELECTOR);
    expect(rows[0]!['issueFingerprint']).toBe(FINGERPRINT);
  }, 60_000);

  it('D-08 assignIssue called by the Analyst returns selector null and issueFingerprint null', async () => {
    const fingerprint = `${CODE}|#other${HEX}|another message`;
    const res = await gqlAs('fabrikam-analyst',
      `mutation { assignIssue(input: { scanId: "${scanId}", issueFingerprint: "${fingerprint}", severity: "error", message: "another message", selector: "#other${HEX}" }) { id selector issueFingerprint message } }`);
    expect(res.errors).toBeUndefined();
    const created = res.data!['assignIssue'] as Record<string, unknown>;
    expect(created['selector']).toBeNull();
    expect(created['issueFingerprint']).toBeNull();
    expect(created['message']).toBe('another message');
    // The store still holds what the caller supplied.
    const stored = await seed.assignments.getAssignment(String(created['id']));
    expect(stored!.selector).toBe(`#other${HEX}`);
    expect(stored!.issueFingerprint).toBe(fingerprint);
  }, 60_000);

  it('D-08 updateAssignment called by the Analyst returns selector null and issueFingerprint null', async () => {
    const res = await gqlAs('fabrikam-analyst',
      `mutation { updateAssignment(id: "${storedAssignmentId}", status: "in-progress") { id status selector issueFingerprint } }`);
    expect(res.errors).toBeUndefined();
    const updated = res.data!['updateAssignment'] as Record<string, unknown>;
    expect(updated['status']).toBe('in-progress');
    expect(updated['selector']).toBeNull();
    expect(updated['issueFingerprint']).toBeNull();
    expect(res.body).not.toContain(SELECTOR_ID);
  }, 60_000);
});

describe('the published GraphQL schema', () => {
  it('API-03 Issue.selector is nullable and its description names reports.view_technical', async () => {
    const res = await gqlAs('fabrikam-owner',
      '{ __type(name: "Issue") { fields { name description type { kind } } } }');
    expect(res.errors).toBeUndefined();
    const fields = res.data!['__type'].fields as Array<{ name: string; description: string | null; type: { kind: string } }>;
    const selector = fields.find((f) => f.name === 'selector')!;
    expect(selector.type.kind).not.toBe('NON_NULL');
    expect(selector.description ?? '').toContain('reports.view_technical');
    const context = fields.find((f) => f.name === 'context')!;
    expect(context.description ?? '').toContain('reports.view_technical');
  }, 60_000);

  it('D-08 Assignment.selector and Assignment.issueFingerprint are nullable and name reports.view_technical', async () => {
    const res = await gqlAs('fabrikam-owner',
      '{ __type(name: "Assignment") { fields { name description type { kind } } } }');
    expect(res.errors).toBeUndefined();
    const fields = res.data!['__type'].fields as Array<{ name: string; description: string | null; type: { kind: string } }>;
    for (const name of ['selector', 'issueFingerprint']) {
      const field = fields.find((f) => f.name === name)!;
      expect(field.type.kind, `${name} kind`).not.toBe('NON_NULL');
      expect(field.description ?? '', `${name} description`).toContain('reports.view_technical');
    }
  }, 60_000);
});
