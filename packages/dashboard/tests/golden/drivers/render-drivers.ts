/**
 * Render-family drivers (Phase 88). One driver per render surface, each
 * entering through the REAL production entry point with the REAL store.
 *
 * Drivers return plain JSON-serialisable values and never assert. The zero-
 * dismissal goldens call them with only foreign dismissals seeded; later plans
 * call the same drivers with dismissals seeded for the dismissing org.
 */
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import handlebars from 'handlebars';
import type { SqliteStorageAdapter } from '../../../src/db/sqlite/index.js';
import { registerSession } from '../../../src/auth/session.js';
import { reportRoutes } from '../../../src/routes/reports.js';
import { buildDigest } from '../../../src/services/digest-service.js';
import { buildAttachments } from '../../../src/services/notification-service.js';
import type { EmailReport } from '../../../src/db/types.js';
import type { LLMClient } from '../../../src/llm-client.js';
import { loadTranslations, t } from '../../../src/i18n/index.js';
import type { Locale } from '../../../src/i18n/index.js';
import {
  FABRIKAM_SITE,
  FIXED_COMPLETED_AT,
  FIXED_CREATED_AT,
  FIXED_SCAN_ID,
  openSurfaceStore,
  seedForeignDismissals,
  seedSurfaceOrgs,
  seedSurfaceScan,
  surfaceReport,
  type SurfaceOrgs,
  type SurfaceStore,
} from '../../helpers/dismissal-surface-fixture.js';
import type { Literals } from '../golden-io.js';

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';

/** Scan id of the earlier completed scan seeded by drivers that need history. */
export const PRIOR_SCAN_ID = 'scan-fabrikam-golden-0000';
export const PRIOR_CREATED_AT = '2026-09-01T10:00:00.000Z';
export const PRIOR_COMPLETED_AT = '2026-09-01T10:05:00.000Z';

export const FABRIKAM_ADMIN_PERMISSIONS = [
  'reports.view',
  'reports.export',
  'reports.vpat',
  'llm.view',
  'scans.create',
  'trends.view',
] as const;

export interface SurfaceContext {
  readonly store: SurfaceStore;
  readonly storage: SqliteStorageAdapter;
  readonly orgs: SurfaceOrgs;
  /** The main Fabrikam scan (fixed id, report in the DB column AND on disk). */
  readonly scanId: string;
  /** Per-run literals (org ids, tmp dir, locale-formatted dates) for goldenCheck. */
  literals(extra?: Literals): Literals;
  cleanup(): Promise<void>;
}

/**
 * Register the template helpers server.ts registers in production, for the
 * three surfaces that compile a template with the global handlebars singleton
 * (print, public report, accessibility statement). `t` is the REAL translator.
 */
export function registerViewHelpers(): void {
  loadTranslations();
  handlebars.registerHelper(
    't',
    function (key: string, options: { hash?: Record<string, unknown>; data?: { root?: { locale?: string } } }) {
      const locale = (options?.data?.root?.locale as Locale) ?? 'en';
      const params =
        options?.hash != null
          ? Object.fromEntries(Object.entries(options.hash).map(([k, v]) => [k, String(v ?? '')]))
          : undefined;
      return t(key, locale, params);
    },
  );
  handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);
  handlebars.registerHelper('formatStandard', (code: string) => {
    const map: Record<string, string> = {
      WCAG2A: 'WCAG 2.1 Level A',
      WCAG2AA: 'WCAG 2.1 Level AA',
      WCAG2AAA: 'WCAG 2.1 Level AAA',
    };
    return map[code] ?? code;
  });
  handlebars.registerHelper('reviewStatusClass', (s: string) =>
    s === 'fail' ? 'fail-head' : s === 'review' ? 'review-head' : 'pass-head');
  handlebars.registerHelper('reviewStatusLabel', (s: string) =>
    s === 'fail' ? 'FAIL' : s === 'review' ? 'REVIEW NEEDED' : 'PASS');
}

/** Store + two orgs + the main scan + the foreign dismissals that must never apply. */
export async function createSurfaceContext(): Promise<SurfaceContext> {
  const store = await openSurfaceStore();
  const orgs = await seedSurfaceOrgs(store.storage);
  const scanId = await seedSurfaceScan(store.storage, {
    orgId: orgs.fabrikamOrgId,
    location: 'both',
    reportsDir: store.reportsDir,
    id: FIXED_SCAN_ID,
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

/** Seed an earlier completed scan of the same site (history for AI-summary and digest). */
export async function seedPriorScan(ctx: SurfaceContext): Promise<string> {
  return seedSurfaceScan(ctx.storage, {
    orgId: ctx.orgs.fabrikamOrgId,
    location: 'db',
    id: PRIOR_SCAN_ID,
    siteUrl: FABRIKAM_SITE,
    report: surfaceReport(FABRIKAM_SITE, { withSibling: false }),
    createdAt: PRIOR_CREATED_AT,
    completedAt: PRIOR_COMPLETED_AT,
  });
}

/**
 * Fastify with the production-shaped plumbing used by the route tests: form
 * body, session, the JSON view stub, and a Fabrikam global-admin identity.
 */
export async function makeServer(
  ctx: SurfaceContext,
  register: (server: FastifyInstance) => Promise<void>,
  extraPermissions: readonly string[] = [],
): Promise<FastifyInstance> {
  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));
  await registerSession(server, TEST_SESSION_SECRET);
  server.decorateReply('view', function (this: FastifyReply, template: string, data: unknown) {
    return this.code(200)
      .header('content-type', 'application/json')
      .send(JSON.stringify({ template, data }));
  });
  server.addHook('preHandler', async (request) => {
    request.user = {
      id: 'user-fabrikam-admin',
      username: 'fabrikam-admin',
      role: 'admin',
      currentOrgId: ctx.orgs.fabrikamOrgId,
    };
    (request as unknown as Record<string, unknown>)['permissions'] = new Set([
      ...FABRIKAM_ADMIN_PERMISSIONS,
      ...extraPermissions,
    ]);
  });
  await register(server);
  await server.ready();
  return server;
}

export interface FakeLlm {
  readonly client: LLMClient;
  readonly calls: unknown[];
}

/** A fake LLM client whose analyseReport records its argument. */
export function makeFakeLlm(): FakeLlm {
  const calls: unknown[] = [];
  const client = {
    baseUrl: 'http://llm.fabrikam.example',
    destroy: () => undefined,
    async analyseReport(input: unknown) {
      calls.push(JSON.parse(JSON.stringify(input)));
      return {
        executiveSummary: 'Fixed golden executive summary.',
        keyFindings: ['Fixed golden finding'],
        patterns: ['Fixed golden pattern'],
        priorities: ['Fixed golden priority'],
      };
    },
  } as unknown as LLMClient;
  return { client, calls };
}

async function withReportServer<T>(
  ctx: SurfaceContext,
  getLLMClient: () => LLMClient | null,
  run: (server: FastifyInstance) => Promise<T>,
  extraPermissions: readonly string[] = [],
): Promise<T> {
  const server = await makeServer(ctx, (s) => reportRoutes(s, ctx.storage, getLLMClient), extraPermissions);
  try {
    return await run(server);
  } finally {
    await server.close();
  }
}

function viewData(body: string): unknown {
  return (JSON.parse(body) as { data: unknown }).data;
}

function ok(statusCode: number, what: string): void {
  if (statusCode !== 200) throw new Error(`${what}: expected 200, got ${statusCode}`);
}

/** GET /reports/:id — the `data` object the handler passed to reply.view. */
export async function driveReportDetail(ctx: SurfaceContext, scanId: string): Promise<unknown> {
  return withReportServer(ctx, () => null, async (server) => {
    const res = await server.inject({ method: 'GET', url: `/reports/${scanId}` });
    ok(res.statusCode, 'report detail');
    return withoutScanControls(viewData(res.body));
  });
}

/**
 * This baseline compares dismissal-related output only. The retry/cancel control flag the report
 * page also carries is not dismissal output; tests/routes/scan-controls-view.test.ts pins it.
 */
function withoutScanControls(data: unknown): unknown {
  if (typeof data !== 'object' || data === null) return data;
  const { scanControls: _scanControls, ...rest } = data as Record<string, unknown>;
  return rest;
}

/** GET /reports/:id/print — the HTML string the handler sent. */
export async function drivePrint(ctx: SurfaceContext, scanId: string): Promise<string> {
  return withReportServer(ctx, () => null, async (server) => {
    const res = await server.inject({ method: 'GET', url: `/reports/${scanId}/print` });
    ok(res.statusCode, 'report print');
    return res.body;
  });
}

/** GET /reports/:id/public after the owner opts the scan into public sharing. */
export async function drivePublicReport(ctx: SurfaceContext, scanId: string): Promise<string> {
  await ctx.storage.scans.setPublicShare(scanId, ctx.orgs.fabrikamOrgId, true, 'fabrikam-admin');
  return withReportServer(ctx, () => null, async (server) => {
    const res = await server.inject({
      method: 'GET',
      url: `/reports/${scanId}/public`,
      headers: { host: 'dashboard.example' },
    });
    ok(res.statusCode, 'public report');
    return res.body;
  });
}

/** GET /reports/:id/ai-summary — the argument the handler passed to analyseReport. */
export async function driveAiSummaryInput(ctx: SurfaceContext, scanId: string): Promise<unknown> {
  await seedPriorScan(ctx);
  const llm = makeFakeLlm();
  return withReportServer(ctx, () => llm.client, async (server) => {
    const res = await server.inject({ method: 'GET', url: `/reports/${scanId}/ai-summary` });
    ok(res.statusCode, 'ai summary');
    if (llm.calls.length !== 1) throw new Error(`ai summary: expected 1 analyseReport call, got ${llm.calls.length}`);
    return llm.calls[0];
  });
}

/**
 * GET /reports/:id/brand-drilldown for the two dimensions the fixture populates. Driven as a viewer
 * holding reports.view_technical: only that viewer receives selectors (HARD-02), and the selectors are
 * what shows a dismissed finding is absent rather than merely unlabelled.
 */
export async function driveBrandDrilldown(ctx: SurfaceContext, scanId: string): Promise<unknown> {
  return withReportServer(ctx, () => null, async (server) => {
    const out: Record<string, unknown> = {};
    for (const dimension of ['color', 'components'] as const) {
      const res = await server.inject({
        method: 'GET',
        url: `/reports/${scanId}/brand-drilldown?dimension=${dimension}`,
      });
      ok(res.statusCode, `brand drilldown ${dimension}`);
      out[dimension] = withoutShowElement(viewData(res.body));
    }
    return out;
  }, ['reports.view_technical']);
}

/**
 * The baseline compares dismissal output only. The drilldown's Element-column switch is not dismissal
 * output; tests/integration/brand-drilldown-selector-visibility.test.ts pins it.
 */
function withoutShowElement(data: unknown): unknown {
  if (typeof data !== 'object' || data === null) return data;
  const { showElement: _showElement, ...rest } = data as Record<string, unknown>;
  return rest;
}

/** buildDigest over the org: a baseline scan before the period, the main scan inside it. */
export async function driveDigest(ctx: SurfaceContext): Promise<unknown> {
  await seedPriorScan(ctx);
  return buildDigest(
    ctx.storage,
    { orgId: ctx.orgs.fabrikamOrgId, siteUrl: null },
    { start: '2026-09-25T00:00:00.000Z', end: '2026-10-02T00:00:00.000Z' },
  );
}

function emailReport(ctx: SurfaceContext, format: 'pdf' | 'csv'): EmailReport {
  return {
    id: 'email-report-fabrikam',
    name: 'Fabrikam weekly',
    siteUrl: FABRIKAM_SITE,
    recipients: 'owner@fabrikam.example',
    frequency: 'weekly',
    format,
    includeCsv: false,
    nextSendAt: '2026-10-08T00:00:00.000Z',
    lastSentAt: null,
    enabled: true,
    createdBy: 'fabrikam-admin',
    orgId: ctx.orgs.fabrikamOrgId,
  };
}

async function attachmentsFor(ctx: SurfaceContext, format: 'pdf' | 'csv') {
  const scan = await ctx.storage.scans.getScan(ctx.scanId);
  if (scan === null) throw new Error('main scan missing');
  return buildAttachments(ctx.storage, scan, emailReport(ctx, format));
}

/**
 * Notification PDF data: buildAttachments(format 'pdf') with generatePdfFromData
 * captured by the test file's vi.mock. Returns the attachment envelope; the
 * captured argument is read by the caller from pdf-capture.
 */
export async function driveNotificationPdfEnvelope(ctx: SurfaceContext) {
  const attachments = await attachmentsFor(ctx, 'pdf');
  return attachments.map((a) => ({ filename: a.filename, contentType: a.contentType, content: a.content }));
}

/** Email CSV: the CSV attachment produced through buildAttachments (stable signature). */
export async function driveEmailCsv(ctx: SurfaceContext) {
  const attachments = await attachmentsFor(ctx, 'csv');
  return attachments.map((a) => ({ filename: a.filename, contentType: a.contentType, content: a.content }));
}
