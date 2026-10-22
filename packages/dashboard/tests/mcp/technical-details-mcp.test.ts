/**
 * D-08 (Phase 93): the MCP surfaces follow the report page. A stored user without
 * reports.view_technical receives no element selector and no element markup from
 * dashboard_get_report, dashboard_query_issues, dashboard_scan_page or the scan://report/{id}
 * resource, and an MCP handler that runs without a tool context is treated as not entitled.
 *
 * The HTTP tests go through registerMcpRoutes over a REAL SqliteStorageAdapter: the bearer
 * preHandler resolves the stored user's permission set (resolveMcpCaller), the shared plugin builds
 * the ToolContext, and the handlers read it. Only the token verifier and the scanner are stubs.
 * Canaries sit in the selector, the markup and the message; the message canary is the control that
 * shows the matcher can match.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DirectScanner } from '@luqen/core';
import { registerMcpRoutes } from '../../src/routes/api/mcp.js';
import { registerDataTools } from '../../src/mcp/tools/data.js';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { ScanService } from '../../src/services/scan-service.js';
import type { DashboardConfig } from '../../src/config.js';
import type { ScanOrchestrator } from '../../src/scanner/orchestrator.js';
import type { McpTokenPayload } from '../../src/mcp/middleware.js';
import { seedSurfaceScan } from '../helpers/dismissal-surface-fixture.js';

const CODE = 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail';
const HEX = randomUUID().replace(/-/g, '').slice(0, 16);
const SELECTOR = `#selcanary${HEX}`;
const SELECTOR_ID = `selcanary${HEX}`;
const CONTEXT_ID = `ctxcanary${HEX}`;
const MESSAGE = `msgcanary${HEX}`;
const SCAN_SELECTOR_ID = `scancanary${HEX}`;
const SCAN_CONTEXT_ID = `scanctx${HEX}`;
/** Canaries inside a NESTED copy of an issue (IN-03): a raw row whose child object carries the fields. */
const NESTED_SELECTOR_ID = `nestsel${HEX}`;
const NESTED_CONTEXT_ID = `nestctx${HEX}`;
const OWNER_TOKEN = 'owner-token';
const ANALYST_TOKEN = 'analyst-token';

const MCP_HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
} as const;

function issue(): Record<string, unknown> {
  return { type: 'error', code: CODE, message: MESSAGE, selector: SELECTOR, context: `<p id="${CONTEXT_ID}">x</p>` };
}

function pagesReport(siteUrl: string): Record<string, unknown> {
  return {
    summary: { pagesScanned: 1, totalIssues: 1, byLevel: { error: 1, warning: 0, notice: 0 } },
    pages: [{ url: siteUrl, issueCount: 1, issues: [issue()] }],
    templateIssues: [issue()],
    compliance: { annotatedIssues: [{ code: CODE, wcagCriterion: '1.4.3', originalIssue: issue(), regulations: [] }] },
  };
}

/** The flat shape dashboard_query_issues reads (it returns an empty list for a pages-shaped report). */
function flatReport(): Record<string, unknown> {
  return { issues: [issue()] };
}

function nestedCopy(): Record<string, unknown> {
  return { note: 'a nested copy', selector: `#${NESTED_SELECTOR_ID}`, context: `<p id="${NESTED_CONTEXT_ID}">x</p>` };
}

/** The flat shape with a nested copy inside the issue row (IN-03). */
function nestedFlatReport(): Record<string, unknown> {
  return { issues: [{ ...issue(), related: [nestedCopy()] }] };
}

const scanner = {
  // A scan target whose HTML says "nested" returns a finding with a nested copy (IN-03).
  scan: async (target: string) => ({
    url: 'data:text/html,x',
    issues: [{
      code: CODE, type: 'error', message: MESSAGE, runner: 'htmlcs',
      selector: `#${SCAN_SELECTOR_ID}`, context: `<p id="${SCAN_CONTEXT_ID}">x</p>`,
      ...(target.includes('nested') ? { related: { copy: nestedCopy() } } : {}),
    }],
  }),
} as unknown as DirectScanner;

let tmpRoot: string;
let app: FastifyInstance;
let storage: SqliteStorageAdapter;
let scanService: ScanService;
let pagesScanId: string;
let flatScanId: string;
let nestedFlatScanId: string;
let systemScanId: string;
let ownerId: string;
let analystId: string;
let orgId: string;

async function rpc(token: string, method: string, params: unknown): Promise<Record<string, unknown>> {
  const res = await app.inject({
    method: 'POST', url: '/api/v1/mcp',
    headers: { ...MCP_HEADERS, authorization: `Bearer ${token}` },
    payload: { jsonrpc: '2.0', id: 1, method, params },
  });
  const trimmed = res.body.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed) as Record<string, unknown>;
  const dataLine = trimmed.split('\n').map((l) => l.trim()).find((l) => l.startsWith('data:'));
  if (dataLine === undefined) throw new Error(`No data line in MCP response (status ${res.statusCode}): ${res.body.slice(0, 200)}`);
  return JSON.parse(dataLine.slice('data:'.length).trim()) as Record<string, unknown>;
}

async function callTool(token: string, name: string, args: Record<string, unknown>): Promise<string> {
  const msg = await rpc(token, 'tools/call', { name, arguments: args });
  const result = msg['result'] as { isError?: boolean; content?: Array<{ text?: string }> } | undefined;
  if (result === undefined) throw new Error(`MCP ${name}: no result: ${JSON.stringify(msg).slice(0, 300)}`);
  if (result.isError === true) throw new Error(`MCP ${name}: tool error: ${result.content?.[0]?.text ?? ''}`);
  return result.content?.[0]?.text ?? '';
}

async function readResource(token: string, uri: string): Promise<string> {
  const msg = await rpc(token, 'resources/read', { uri });
  const result = msg['result'] as { contents?: Array<{ text?: string }> } | undefined;
  if (result === undefined) throw new Error(`MCP resource ${uri}: no result: ${JSON.stringify(msg).slice(0, 300)}`);
  return result.contents?.[0]?.text ?? '';
}

beforeAll(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'luqen-technical-details-mcp-'));
  const reportsDir = join(tmpRoot, 'reports');
  mkdirSync(reportsDir, { recursive: true });
  storage = new SqliteStorageAdapter(join(tmpRoot, 'dashboard.db'));
  await storage.migrate();
  orgId = (await storage.organizations.createOrg({ name: 'Fabrikam', slug: `fabrikam-${HEX.slice(0, 8)}` })).id;

  const owner = await storage.users.createUser('fabrikam-owner', 'Technical-Pass-123!', 'user');
  ownerId = owner.id;
  const ownerRole = await storage.roles.getRoleByNameAndOrg('Owner', orgId);
  const owners = await storage.teams.createTeam({ name: 'owners', description: '', orgId, roleId: ownerRole!.id });
  await storage.teams.addTeamMember(owners.id, owner.id);
  await storage.organizations.addMember(orgId, owner.id, 'owner');

  // The Owner's non-technical permissions, minus reports.view_technical, so that is the only variable.
  const analyst = await storage.users.createUser('fabrikam-analyst', 'Technical-Pass-123!', 'user');
  analystId = analyst.id;
  const analystRole = await storage.roles.createRole({
    name: 'Analyst', description: 'All report work without technical details',
    permissions: ['reports.view', 'reports.export', 'scans.create', 'mcp.use', 'issues.fix', 'issues.assign', 'issues.dismiss', 'llm.view'],
    orgId,
  });
  const analysts = await storage.teams.createTeam({ name: 'analysts', description: '', orgId, roleId: analystRole.id });
  await storage.teams.addTeamMember(analysts.id, analyst.id);
  await storage.organizations.addMember(orgId, analyst.id, 'member');

  const siteUrl = `https://fabrikam.example/${HEX.slice(0, 8)}/`;
  pagesScanId = await seedSurfaceScan(storage, { orgId, siteUrl, report: pagesReport(siteUrl), location: 'both', reportsDir });
  flatScanId = await seedSurfaceScan(storage, { orgId, siteUrl: `${siteUrl}flat/`, report: flatReport(), location: 'both', reportsDir });
  nestedFlatScanId = await seedSurfaceScan(storage, { orgId, siteUrl: `${siteUrl}nested/`, report: nestedFlatReport(), location: 'both', reportsDir });
  systemScanId = await seedSurfaceScan(storage, { orgId: 'system', siteUrl: `${siteUrl}system/`, report: pagesReport(siteUrl), location: 'both', reportsDir });

  scanService = new ScanService(storage, {} as ScanOrchestrator, {} as DashboardConfig);
  app = Fastify({ logger: false });
  await registerMcpRoutes(app, {
    verifyToken: async (token: string): Promise<McpTokenPayload> => {
      if (token === OWNER_TOKEN) return { sub: ownerId, scopes: ['read', 'write'], orgId, role: 'user' };
      if (token === ANALYST_TOKEN) return { sub: analystId, scopes: ['read', 'write'], orgId, role: 'user' };
      throw new Error('Invalid token');
    },
    storage,
    scanService,
    serviceConnections: {} as never,
    scanner,
    resourceMetadataUrl: 'https://dashboard.fabrikam.example/.well-known/oauth-protected-resource',
  });
  await app.ready();
}, 120_000);

afterAll(async () => {
  if (app !== undefined) await app.close();
  if (storage !== undefined) await storage.disconnect();
  if (tmpRoot !== undefined) rmSync(tmpRoot, { recursive: true, force: true });
});

function expectNoTechnical(text: string): void {
  expect(text).not.toContain(SELECTOR_ID);
  expect(text).not.toContain(CONTEXT_ID);
  expect(text).toContain(MESSAGE);
}

describe('dashboard_get_report', () => {
  it('D-08 an Analyst stored user gets no selector or context canary anywhere, scan.jsonReport included', async () => {
    const text = await callTool(ANALYST_TOKEN, 'dashboard_get_report', { scanId: pagesScanId });
    expectNoTechnical(text);
    const body = JSON.parse(text) as { scan: { jsonReport: string } };
    expect(typeof body.scan.jsonReport).toBe('string');
    expect(body.scan.jsonReport).toContain(MESSAGE);
  }, 60_000);

  it('D-08 an Owner stored user gets the canaries in the report and in scan.jsonReport', async () => {
    const text = await callTool(OWNER_TOKEN, 'dashboard_get_report', { scanId: pagesScanId });
    const body = JSON.parse(text) as { scan: { jsonReport: string }; report: unknown };
    expect(JSON.stringify(body.report)).toContain(SELECTOR_ID);
    expect(JSON.stringify(body.report)).toContain(CONTEXT_ID);
    expect(body.scan.jsonReport).toContain(SELECTOR_ID);
    expect(body.scan.jsonReport).toContain(CONTEXT_ID);
  }, 60_000);

  it('D-08 a get_report call with no tool context gets the redacted answer', async () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
    registerDataTools(server, { storage, scanService });
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      // No runInToolContext: resolveOrgId falls back to the system org, which holds the system scan.
      const result = await client.callTool({ name: 'dashboard_get_report', arguments: { scanId: systemScanId } });
      expect(result.isError).toBeFalsy();
      expectNoTechnical((result.content as Array<{ text: string }>)[0]!.text);
    } finally {
      await client.close();
    }
  }, 60_000);
});

describe('scan://report/{id}', () => {
  it('D-08 an Analyst reading the resource gets no canary and an Owner gets them', async () => {
    const uri = `scan://report/${pagesScanId}`;
    expectNoTechnical(await readResource(ANALYST_TOKEN, uri));
    const owner = await readResource(OWNER_TOKEN, uri);
    expect(owner).toContain(SELECTOR_ID);
    expect(owner).toContain(CONTEXT_ID);
  }, 60_000);
});

describe('dashboard_query_issues', () => {
  it('D-08 an Analyst gets rows without selector and context keys and an Owner gets them', async () => {
    const analyst = await callTool(ANALYST_TOKEN, 'dashboard_query_issues', { scanId: flatScanId });
    const rows = (JSON.parse(analyst) as { data: Array<Record<string, unknown>> }).data;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect('selector' in row, 'selector key present').toBe(false);
      expect('context' in row, 'context key present').toBe(false);
    }
    expectNoTechnical(analyst);

    const owner = await callTool(OWNER_TOKEN, 'dashboard_query_issues', { scanId: flatScanId });
    const ownerRows = (JSON.parse(owner) as { data: Array<Record<string, unknown>> }).data;
    expect(ownerRows.length).toBeGreaterThan(0);
    for (const row of ownerRows) expect(row['selector']).toBe(SELECTOR);
  }, 60_000);

  it('IN-03 an Analyst gets no selector or context from a copy nested inside a row, and an Owner gets them', async () => {
    const analyst = await callTool(ANALYST_TOKEN, 'dashboard_query_issues', { scanId: nestedFlatScanId });
    const rows = (JSON.parse(analyst) as { data: Array<Record<string, unknown>> }).data;
    expect(rows.length).toBeGreaterThan(0);
    const nested = (rows[0]!['related'] as Array<Record<string, unknown>>)[0]!;
    expect(nested['note']).toBe('a nested copy');
    expect('selector' in nested, 'nested selector key present').toBe(false);
    expect('context' in nested, 'nested context key present').toBe(false);
    expect(analyst).not.toContain(NESTED_SELECTOR_ID);
    expect(analyst).not.toContain(NESTED_CONTEXT_ID);
    expectNoTechnical(analyst);

    const owner = await callTool(OWNER_TOKEN, 'dashboard_query_issues', { scanId: nestedFlatScanId });
    expect(owner).toContain(NESTED_SELECTOR_ID);
    expect(owner).toContain(NESTED_CONTEXT_ID);
  }, 60_000);
});

describe('dashboard_scan_page', () => {
  it('D-08 an Analyst gets findings without selector and context keys and an Owner gets them', async () => {
    const analyst = await callTool(ANALYST_TOKEN, 'dashboard_scan_page', { html: '<p>x</p>' });
    const findings = (JSON.parse(analyst) as { findings: Array<Record<string, unknown>> }).findings;
    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) {
      expect('selector' in finding, 'selector key present').toBe(false);
      expect('context' in finding, 'context key present').toBe(false);
    }
    expect(analyst).not.toContain(SCAN_SELECTOR_ID);
    expect(analyst).not.toContain(SCAN_CONTEXT_ID);
    expect(analyst).toContain(MESSAGE);

    const owner = await callTool(OWNER_TOKEN, 'dashboard_scan_page', { html: '<p>x</p>' });
    const ownerFindings = (JSON.parse(owner) as { findings: Array<Record<string, unknown>> }).findings;
    expect(ownerFindings.length).toBeGreaterThan(0);
    for (const finding of ownerFindings) {
      expect(finding['selector']).toBe(`#${SCAN_SELECTOR_ID}`);
      expect(String(finding['context'])).toContain(SCAN_CONTEXT_ID);
    }
  }, 60_000);

  it('IN-03 an Analyst gets no selector or context from a copy nested inside a finding, and an Owner gets them', async () => {
    const analyst = await callTool(ANALYST_TOKEN, 'dashboard_scan_page', { html: '<p>nested</p>' });
    const findings = (JSON.parse(analyst) as { findings: Array<Record<string, unknown>> }).findings;
    expect(findings.length).toBeGreaterThan(0);
    const nested = (findings[0]!['related'] as { copy: Record<string, unknown> }).copy;
    expect(nested['note']).toBe('a nested copy');
    expect('selector' in nested, 'nested selector key present').toBe(false);
    expect('context' in nested, 'nested context key present').toBe(false);
    expect(analyst).not.toContain(NESTED_SELECTOR_ID);
    expect(analyst).not.toContain(NESTED_CONTEXT_ID);
    expect(analyst).toContain(MESSAGE);

    const owner = await callTool(OWNER_TOKEN, 'dashboard_scan_page', { html: '<p>nested</p>' });
    expect(owner).toContain(NESTED_SELECTOR_ID);
    expect(owner).toContain(NESTED_CONTEXT_ID);
  }, 60_000);

  it('D-08 the published dashboard_scan_page description says selector and context need reports.view_technical', async () => {
    const msg = await rpc(OWNER_TOKEN, 'tools/list', {});
    const tools = (msg['result'] as { tools: Array<{ name: string; description?: string }> }).tools;
    const tool = tools.find((t) => t.name === 'dashboard_scan_page');
    expect(tool, 'dashboard_scan_page listed').toBeDefined();
    expect(tool!.description ?? '').toContain('reports.view_technical');
  }, 60_000);
});
