/**
 * API / agent / bypass-surface drivers (Phase 88, Plan 03).
 *
 * One driver per surface, each entering through the REAL production entry
 * point (the registered MCP tools over the MCP HTTP route, the registered
 * Fastify routes, the GraphQL resolver, the services) with the REAL
 * SqliteStorageAdapter. Drivers return plain JSON-serialisable values and
 * never assert. The zero-dismissal goldens call them with only foreign
 * dismissals seeded; Plans 08, 09 and 17 call the same drivers with
 * dismissals seeded for the dismissing org.
 *
 * The scans these drivers read carry the ANNOTATED issue shape (wcagCriterion,
 * wcagTitle and messages the fix engine recognises): the criterion-keyed
 * surfaces (fleet counts, bulk-fix candidates, REST criterion handling, the
 * fix-suggestion engines) match nothing on issues without it, so a golden over
 * un-annotated issues would be empty and unable to react to a dismissal.
 */
import Fastify from 'fastify';
import type { DashboardConfig } from '../../../src/config.js';
import type { SurfaceContext } from './render-drivers.js';
import type { ScanOrchestrator } from '../../../src/scanner/orchestrator.js';
import { registerMcpRoutes } from '../../../src/routes/api/mcp.js';
import { ScanService } from '../../../src/services/scan-service.js';
import type { McpTokenPayload } from '../../../src/mcp/middleware.js';
import {
  CODE_ALT,
  CODE_CONTRAST,
  CODE_LINK,
  FABRIKAM_SITE,
  FIXED_COMPLETED_AT,
  FIXED_CREATED_AT,
  FIXED_SCAN_ID,
  SEL_ALT,
  SEL_DISMISSED,
  SEL_LINK,
  SEL_SIBLING,
  openSurfaceStore,
  seedForeignDismissals,
  seedSurfaceOrgs,
  seedSurfaceScan,
  surfaceReport,
} from '../../helpers/dismissal-surface-fixture.js';
import type { Literals } from '../golden-io.js';


// ── Scan ids / dates used by drivers that need more than the main scan ───────
/** The earlier completed Fabrikam scan of the same site (compare side A). */
export const API_PRIOR_SCAN_ID = 'scan-fabrikam-golden-0000';
export const API_PRIOR_CREATED_AT = '2026-09-01T10:00:00.000Z';
export const API_PRIOR_COMPLETED_AT = '2026-09-01T10:05:00.000Z';
/** The `results`-shape scan dashboard_query_issues is able to read. */
export const API_RESULTS_SCAN_ID = 'scan-fabrikam-golden-results';
export const API_RESULTS_CREATED_AT = '2026-08-01T10:00:00.000Z';
export const API_RESULTS_COMPLETED_AT = '2026-08-01T10:05:00.000Z';
export const FLEET_SINCE = '2026-01-01T00:00:00.000Z';

/** Every permission the API/agent drivers' Fabrikam admin identity holds. */
export const API_ADMIN_PERMISSIONS = [
  'reports.view',
  'reports.export',
  'reports.compare',
  'repos.credentials',
  'issues.fix',
] as const;

// ── Annotated report shape ───────────────────────────────────────────────────
const CRITERION_BY_CODE: Readonly<Record<string, { criterion: string; title: string }>> = {
  [CODE_CONTRAST]: { criterion: '1.4.3', title: 'Contrast (Minimum)' },
  [CODE_ALT]: { criterion: '1.1.1', title: 'Non-text Content' },
  [CODE_LINK]: { criterion: '2.4.4', title: 'Link Purpose (In Context)' },
};

/** Messages the fix-suggestion engine recognises, keyed by the finding's selector. */
const MESSAGE_BY_SELECTOR: Readonly<Record<string, string>> = {
  [SEL_DISMISSED]: 'Insufficient contrast: the contrast ratio on the promo note is less than 4.5:1',
  [SEL_SIBLING]: 'Insufficient contrast: the contrast ratio on the footer note is less than 4.5:1',
  [SEL_ALT]: 'Img element missing an alt attribute on the hero image',
  [SEL_LINK]: 'Link purpose is unclear from the link text alone',
};

interface AnnotatableIssue {
  readonly code: string;
  readonly selector: string;
  readonly message: string;
  readonly [key: string]: unknown;
}

interface AnnotatablePage {
  readonly url: string;
  readonly issues: readonly AnnotatableIssue[];
  readonly [key: string]: unknown;
}

function annotateIssue(issue: AnnotatableIssue): Record<string, unknown> {
  const wcag = CRITERION_BY_CODE[issue.code];
  return {
    ...issue,
    message: MESSAGE_BY_SELECTOR[issue.selector] ?? issue.message,
    ...(wcag !== undefined ? { wcagCriterion: wcag.criterion, wcagTitle: wcag.title } : {}),
  };
}

/**
 * The Plan-01 fixture report with the same findings (codes, selectors,
 * contexts and counts unchanged) in the annotated shape the API surfaces read.
 */
export function apiShapedReport(
  siteUrl: string = FABRIKAM_SITE,
  opts: { readonly withSibling?: boolean } = {},
): Record<string, unknown> {
  const base = surfaceReport(siteUrl, opts);
  const pages = (base['pages'] as readonly AnnotatablePage[]).map((page) => ({
    ...page,
    issues: page.issues.map(annotateIssue),
  }));
  return { ...base, pages };
}

/**
 * The `results` shape dashboard_query_issues reads ({ results: [{ url, issues }] }).
 * NOT the shape the dashboard writes (pages[]): a pre-existing mismatch, so on a
 * pages-shape report that tool returns an empty list. Same findings as apiShapedReport.
 */
export function resultsShapedReport(siteUrl: string = FABRIKAM_SITE): Record<string, unknown> {
  const { pages, ...rest } = apiShapedReport(siteUrl);
  return {
    ...rest,
    results: (pages as readonly AnnotatablePage[]).map((p) => ({ url: p.url, issues: p.issues })),
  };
}

// ── Context ──────────────────────────────────────────────────────────────────
/** Store + two orgs + the main annotated scan + the foreign dismissals that must never apply. */
export async function createApiContext(): Promise<SurfaceContext> {
  const store = await openSurfaceStore();
  const orgs = await seedSurfaceOrgs(store.storage);
  const scanId = await seedSurfaceScan(store.storage, {
    orgId: orgs.fabrikamOrgId,
    location: 'both',
    reportsDir: store.reportsDir,
    id: FIXED_SCAN_ID,
    report: apiShapedReport(),
  });
  await seedForeignDismissals(store.storage, orgs);
  return {
    store,
    storage: store.storage,
    orgs,
    scanId,
    literals(extra: Literals = {}): Literals {
      return {
        [orgs.fabrikamOrgId]: '<org:fabrikam>',
        [orgs.northwindOrgId]: '<org:northwind>',
        [store.reportsDir]: '<reportsDir>',
        [new Date(FIXED_CREATED_AT).toLocaleString()]: '<volatile:createdAtDisplay>',
        [new Date(FIXED_COMPLETED_AT).toLocaleString()]: '<volatile:completedAtDisplay>',
        ...extra,
      };
    },
    cleanup: () => store.cleanup(),
  };
}

async function parseJson(text: string): Promise<unknown> {
  return JSON.parse(text) as unknown;
}

// ── MCP ──────────────────────────────────────────────────────────────────────
const MCP_HEADERS = {
  authorization: 'Bearer valid-jwt',
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
} as const;

function parseSseOrJson(body: string): Record<string, unknown> {
  const trimmed = body.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed) as Record<string, unknown>;
  const dataLine = trimmed
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('data:'));
  if (dataLine === undefined) throw new Error(`No SSE data line in MCP response: ${body.slice(0, 200)}`);
  return JSON.parse(dataLine.slice('data:'.length).trim()) as Record<string, unknown>;
}

export interface McpHarness {
  /** tools/call -> the tool's parsed JSON text payload (throws on a JSON-RPC or tool error). */
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  /** resources/read -> the first content's parsed JSON text. */
  readResource(uri: string): Promise<unknown>;
  close(): Promise<void>;
}

/**
 * The REAL MCP route (registerMcpRoutes) over the REAL store, called as a
 * Fabrikam org admin. Only the token verifier is injected; the ScanService is
 * the real class (getScanForOrg reads storage only).
 */
export async function openMcp(ctx: SurfaceContext): Promise<McpHarness> {
  const payload: McpTokenPayload = {
    sub: 'user-fabrikam-admin',
    scopes: ['read', 'write'],
    orgId: ctx.orgs.fabrikamOrgId,
    role: 'admin',
  };
  const app = Fastify({ logger: false });
  const scanService = new ScanService(ctx.storage, {} as ScanOrchestrator, {} as DashboardConfig);
  await registerMcpRoutes(app, {
    verifyToken: async (token: string) => {
      if (token === 'valid-jwt') return payload;
      throw new Error('Invalid token');
    },
    storage: ctx.storage,
    scanService,
    serviceConnections: {} as never,
    resourceMetadataUrl: 'https://dashboard.fabrikam.example/.well-known/oauth-protected-resource',
  });
  await app.ready();

  async function rpc(method: string, params: unknown): Promise<Record<string, unknown>> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: MCP_HEADERS,
      payload: { jsonrpc: '2.0', id: 1, method, params },
    });
    return parseSseOrJson(response.body);
  }

  return {
    async callTool(name, args) {
      const msg = await rpc('tools/call', { name, arguments: args });
      const result = msg['result'] as { isError?: boolean; content?: Array<{ text?: string }> } | undefined;
      if (result === undefined) throw new Error(`MCP ${name}: no result: ${JSON.stringify(msg).slice(0, 300)}`);
      if (result.isError === true) throw new Error(`MCP ${name}: tool error: ${result.content?.[0]?.text ?? ''}`);
      return parseJson(result.content?.[0]?.text ?? '{}');
    },
    async readResource(uri) {
      const msg = await rpc('resources/read', { uri });
      const result = msg['result'] as { contents?: Array<{ text?: string }> } | undefined;
      if (result === undefined) throw new Error(`MCP resource ${uri}: no result: ${JSON.stringify(msg).slice(0, 300)}`);
      return parseJson(result.contents?.[0]?.text ?? '{}');
    },
    close: () => app.close(),
  };
}

async function withMcp<T>(ctx: SurfaceContext, run: (mcp: McpHarness) => Promise<T>): Promise<T> {
  const mcp = await openMcp(ctx);
  try {
    return await run(mcp);
  } finally {
    await mcp.close();
  }
}

/** dashboard_get_report over the main scan: the whole raw report + the scan row. */
export function driveMcpGetReport(ctx: SurfaceContext, scanId: string = ctx.scanId): Promise<unknown> {
  return withMcp(ctx, (mcp) => mcp.callTool('dashboard_get_report', { scanId }));
}
