/**
 * Accessibility Statement routes.
 *
 *  - GET  /admin/accessibility-statement   admin config + live preview (auth)
 *  - POST /admin/accessibility-statement   save config (auth, CSRF)
 *  - GET  /accessibility-statement/:slug    public, hostable statement (anon)
 *
 * The public statement is a good-faith remediation artifact: it frames the
 * site as partially conformant, lists known limitations from the latest scan,
 * and routes barrier reports to the organisation. It never claims full
 * conformance. Served only when the org has explicitly enabled it.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { StorageAdapter } from '../db/adapter.js';
import { requirePermission } from '../auth/middleware.js';
import { HtmlPageSchema } from '../api/schemas/envelope.js';
import { normalizeReportData, type JsonReportFile } from '../services/report-service.js';
import { buildVpat, type VpatReport } from '../services/vpat-service.js';
import { buildAccessibilityStatement } from '../services/accessibility-statement-service.js';
import type {
  AccessibilityStatementRecord,
  AccessibilityStatementInput,
} from '../db/interfaces/accessibility-statement-repository.js';

const __dirname = resolve(fileURLToPath(new URL('.', import.meta.url)));

const WCAG_VERSIONS = new Set(['2.1', '2.2']);
const WCAG_LEVELS = new Set(['A', 'AA', 'AAA']);

/** Map a stored WCAG version+level to the scanner's `standard` string for buildVpat. */
function toStandard(level: string): string {
  const lvl = WCAG_LEVELS.has(level) ? level : 'AA';
  return `WCAG2${lvl}`;
}

/** Load the latest completed scan for the site and derive its VPAT, if any. */
async function loadVpatForSite(
  storage: StorageAdapter,
  orgId: string,
  siteUrl: string | undefined,
  wcagLevel: string,
): Promise<{ vpat: VpatReport; assessmentDate?: string } | null> {
  if (siteUrl === undefined || siteUrl.trim() === '') return null;
  const scan = await storage.scans.getLatestCompletedForSite(orgId, siteUrl.trim());
  if (scan === null) return null;

  let reportData: ReturnType<typeof normalizeReportData> | null = null;
  try {
    const dbReport = await storage.scans.getReport(scan.id);
    if (dbReport !== null) {
      reportData = normalizeReportData(dbReport as JsonReportFile, scan);
    } else if (scan.jsonReportPath !== undefined && existsSync(scan.jsonReportPath)) {
      const raw = JSON.parse(await readFile(scan.jsonReportPath, 'utf-8')) as JsonReportFile;
      reportData = normalizeReportData(raw, scan);
    }
  } catch {
    return null;
  }
  if (reportData === null) return null;

  const manualResults = storage.manualTests
    ? await storage.manualTests.getManualTests(scan.id)
    : [];
  // Honour the configured target level rather than the scan's own standard.
  const vpat = buildVpat(
    reportData,
    { siteUrl: scan.siteUrl, standard: toStandard(wcagLevel) },
    manualResults,
    { behaviorallyEvaluatedCriteria: new Set(reportData.behaviorallyEvaluatedCriteria ?? []) },
  );
  const assessmentDate = scan.completedAt
    ? scan.completedAt.slice(0, 10)
    : scan.createdAt.slice(0, 10);
  return { vpat, assessmentDate };
}

function localeOf(request: FastifyRequest): string {
  const session = request.session as { get?(key: string): unknown } | undefined;
  return (
    (typeof session?.get === 'function'
      ? (session.get('locale') as string | undefined)
      : undefined) ?? 'en'
  );
}

export async function accessibilityStatementRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
): Promise<void> {
  // ── Admin: view config + live preview ──────────────────────────────────
  server.get(
    '/admin/accessibility-statement',
    { preHandler: requirePermission('admin.system', 'admin.org'), schema: { ...HtmlPageSchema } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const orgId = (request.user as { currentOrgId?: string } | undefined)?.currentOrgId ?? 'system';
      const saved = (request.query as { saved?: string } | undefined)?.saved === '1';

      const existing = await storage.accessibilityStatements.get(orgId);
      const org = await storage.organizations.getOrg(orgId);

      const config: AccessibilityStatementRecord = existing ?? {
        orgId,
        enabled: false,
        wcagVersion: '2.1',
        wcagLevel: 'AA',
        updatedAt: '',
        ...(org?.name !== undefined ? { entityName: org.name } : {}),
      };

      const loaded = await loadVpatForSite(storage, orgId, config.siteUrl, config.wcagLevel);
      const preview = buildAccessibilityStatement(
        { ...config, entityName: (config.entityName ?? '').trim() || org?.name || orgId },
        loaded?.vpat ?? null,
        loaded?.assessmentDate !== undefined ? { assessmentDate: loaded.assessmentDate } : {},
      );

      const publicUrl = org?.slug !== undefined ? `/accessibility-statement/${org.slug}` : null;

      return reply.view('admin/accessibility-statement.hbs', {
        user: request.user,
        currentPath: '/admin/accessibility-statement',
        config,
        preview,
        publicUrl,
        publicEnabled: config.enabled,
        saved,
        csrfToken: (request as unknown as { csrfToken?: () => string }).csrfToken?.() ?? '',
      });
    },
  );

  // ── Admin: save config ─────────────────────────────────────────────────
  server.post(
    '/admin/accessibility-statement',
    { preHandler: requirePermission('admin.system', 'admin.org'), schema: { ...HtmlPageSchema } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const orgId = (request.user as { currentOrgId?: string } | undefined)?.currentOrgId ?? 'system';
      const userId = (request.user as { id?: string } | undefined)?.id;
      const body = (request.body ?? {}) as Record<string, string | undefined>;

      const wcagVersion = WCAG_VERSIONS.has(body.wcagVersion ?? '') ? (body.wcagVersion as string) : '2.1';
      const wcagLevel = WCAG_LEVELS.has(body.wcagLevel ?? '') ? (body.wcagLevel as string) : 'AA';

      const input: AccessibilityStatementInput = {
        enabled: body.enabled === 'on' || body.enabled === 'true' || body.enabled === '1',
        wcagVersion,
        wcagLevel,
        ...(body.entityName?.trim() ? { entityName: body.entityName.trim() } : {}),
        ...(body.siteUrl?.trim() ? { siteUrl: body.siteUrl.trim() } : {}),
        ...(body.contactEmail?.trim() ? { contactEmail: body.contactEmail.trim() } : {}),
        ...(body.contactUrl?.trim() ? { contactUrl: body.contactUrl.trim() } : {}),
        ...(body.commitment?.trim() ? { commitment: body.commitment.trim() } : {}),
        ...(body.acrUrl?.trim() ? { acrUrl: body.acrUrl.trim() } : {}),
      };

      await storage.accessibilityStatements.upsert(orgId, input, userId);
      return reply.redirect('/admin/accessibility-statement?saved=1');
    },
  );

  // ── Public: hostable statement ─────────────────────────────────────────
  server.get(
    '/accessibility-statement/:slug',
    { schema: { ...HtmlPageSchema } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { slug } = request.params as { slug: string };
      const found = await storage.accessibilityStatements.getEnabledByOrgSlug(slug);
      if (found === null) {
        return reply.code(404).type('text/html').send('<h1>404 — Accessibility statement not found</h1>');
      }

      const loaded = await loadVpatForSite(
        storage,
        found.orgId,
        found.record.siteUrl,
        found.record.wcagLevel,
      );
      const statement = buildAccessibilityStatement(
        { ...found.record, entityName: (found.record.entityName ?? '').trim() || found.orgName },
        loaded?.vpat ?? null,
        loaded?.assessmentDate !== undefined ? { assessmentDate: loaded.assessmentDate } : {},
      );

      const handlebars = (await import('handlebars')).default;
      const viewsDir = resolve(join(__dirname, '..', 'views'));
      const template = handlebars.compile(
        await readFile(join(viewsDir, 'accessibility-statement-public.hbs'), 'utf-8'),
      );
      const html = template(
        { statement },
        { data: { root: { locale: localeOf(request) } } },
      );
      return reply.type('text/html').send(html);
    },
  );
}
