import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Type } from '@sinclair/typebox';
import type { StorageAdapter } from '../db/index.js';
import type { ScanRecord } from '../db/types.js';
import { HtmlPageSchema } from '../api/schemas/envelope.js';
import {
  loadVpatForScan,
  renderScanAcrHtml,
  renderScanAcrPdf,
  buildEvidencePackZip,
  resolveLocale,
} from '../services/vpat-share-service.js';
import type { AcrStaleNotice } from '../services/acr-view.js';
import type { AcrHtmlChrome } from '../services/acr-render.js';
import { t, type Locale } from '../i18n/index.js';

/**
 * The stable, per-site "Snapshot" report page.
 *
 * A site's public live badge (`site_badges`) doubles as the durable handle for
 * its Accessibility Conformance Report. `/reports/live/:badgeId` always shows
 * the LATEST completed scan's ACR plus a browsable timeline of every retained
 * revision (each scheduled re-scan = a dated snapshot). An older revision stays
 * viewable and downloadable at `/reports/live/:badgeId/r/:scanId`, where it
 * carries a prominent "a newer version is available" disclaimer linking back to
 * the latest. The badge being ENABLED is the public authorisation (same gate as
 * the live badge), and the URL never leaks the org id or internal scan ids of
 * the latest revision.
 *
 * Exempt from the global auth guard (see `isPublicPath` in server.ts).
 */

const BadgeParams = Type.Object({ badgeId: Type.String() }, { additionalProperties: true });
const RevisionParams = Type.Object(
  { badgeId: Type.String(), scanId: Type.String() },
  { additionalProperties: true },
);

function publicLocale(request: FastifyRequest): string {
  return resolveLocale((request.query as { lang?: string }).lang);
}

/** Completed scans for the site, newest first (each = a retained revision). */
function sortedRevisions(scans: readonly ScanRecord[]): ScanRecord[] {
  return scans
    .filter((s) => s.status === 'completed')
    .slice()
    .sort((a, b) => {
      const ad = Date.parse(a.completedAt ?? a.createdAt);
      const bd = Date.parse(b.completedAt ?? b.createdAt);
      return bd - ad;
    });
}

function revisionDate(scan: ScanRecord): string {
  return (scan.completedAt ?? scan.createdAt).slice(0, 10);
}

const REPORT_PAGE_CSS =
  `.acr-revisions{margin:0 0 1rem;padding:.8rem 1rem;border:1px solid #e3dcd9;border-radius:6px;background:#faf7f6;font-family:'Inter',system-ui,-apple-system,'Segoe UI',sans-serif}` +
  `.acr-revisions__head{font-size:.95rem;font-weight:600;color:#5a2a26;margin:0 0 .2rem}` +
  `.acr-revisions__hint{font-size:.78rem;color:#6b6b6b;margin:0 0 .6rem}` +
  `.acr-revisions__list{list-style:none;display:flex;flex-wrap:wrap;gap:.4rem;padding:0;margin:0}` +
  `.acr-revisions__item a,.acr-revisions__item span{display:inline-block;font-size:.78rem;padding:.3rem .6rem;border:1px solid #d0d4de;border-radius:4px;text-decoration:none;color:#5a2a26}` +
  `.acr-revisions__item--current span{background:#5a2a26;color:#fff;border-color:#5a2a26;font-weight:600}` +
  `@media print{.acr-revisions{display:none!important}}`;

/** A timeline header listing every retained revision, marking the one shown. */
function revisionsChrome(
  badgeId: string,
  revisions: readonly ScanRecord[],
  currentScanId: string,
  locale: string,
): AcrHtmlChrome {
  const tt = (k: string): string => t(k, locale as Locale);
  const esc = (s: string): string =>
    s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));

  const items = revisions
    .map((r, i) => {
      const label = `${esc(revisionDate(r))}${i === 0 ? ` · ${esc(tt('reportPage.latest'))}` : ''}`;
      if (r.id === currentScanId) {
        return `<li class="acr-revisions__item acr-revisions__item--current"><span aria-current="true">${label} · ${esc(tt('reportPage.current'))}</span></li>`;
      }
      return `<li class="acr-revisions__item"><a href="/reports/live/${esc(badgeId)}/r/${esc(r.id)}">${label}</a></li>`;
    })
    .join('');

  const bodyPrefix =
    `<div class="acr-revisions" role="navigation" aria-label="${esc(tt('reportPage.revisionsHeading'))}">` +
      `<p class="acr-revisions__head">${esc(tt('reportPage.revisionsHeading'))}</p>` +
      `<p class="acr-revisions__hint">${esc(tt('reportPage.revisionsIntro'))}</p>` +
      `<ul class="acr-revisions__list">${items}</ul>` +
    `</div>`;

  return { headExtra: `<style>${REPORT_PAGE_CSS}</style>`, bodyPrefix };
}

export async function reportPageRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
  uploadsRoot: string,
): Promise<void> {
  // Resolve a public badge handle to its (orgId, siteUrl) + the latest completed
  // scan. Returns null when the badge is missing/disabled or has no scan yet.
  async function resolveBadgeLatest(
    badgeId: string,
  ): Promise<{ badge: { orgId: string; siteUrl: string }; latest: ScanRecord } | null> {
    const badge = await storage.siteBadges.get(badgeId);
    if (badge === null || !badge.enabled) return null;
    const latest = await storage.scans.getLatestCompletedForSite(badge.orgId, badge.siteUrl);
    if (latest === null) return null;
    return { badge, latest };
  }

  // Resolve a specific revision, scoped to the badge's site (no cross-site read).
  async function resolveBadgeRevision(
    badgeId: string,
    scanId: string,
  ): Promise<{ badge: { orgId: string; siteUrl: string }; scan: ScanRecord; latest: ScanRecord } | null> {
    const resolved = await resolveBadgeLatest(badgeId);
    if (resolved === null) return null;
    const scan = await storage.scans.getScan(scanId);
    if (
      scan === null ||
      scan.status !== 'completed' ||
      scan.orgId !== resolved.badge.orgId ||
      scan.siteUrl !== resolved.badge.siteUrl
    ) {
      return null;
    }
    return { badge: resolved.badge, scan, latest: resolved.latest };
  }

  function notFound(reply: FastifyReply): FastifyReply {
    return reply
      .code(404)
      .type('text/html')
      .send('<!DOCTYPE html><meta charset="utf-8"><title>Not available</title><p>This report is not available.</p>');
  }

  // Render a revision (latest or older) with the revisions timeline + an
  // optional stale-version disclaimer.
  async function renderRevision(
    request: FastifyRequest,
    reply: FastifyReply,
    badgeId: string,
    scan: ScanRecord,
    latest: ScanRecord,
  ): Promise<FastifyReply> {
    const loaded = await loadVpatForScan(storage, scan);
    if (loaded === null) return notFound(reply);
    const locale = publicLocale(request);
    const revisions = sortedRevisions(
      await storage.scans.getScansForSite(scan.orgId ?? 'system', scan.siteUrl),
    );
    const isLatest = scan.id === latest.id;
    const staleNotice: AcrStaleNotice | undefined = isLatest
      ? undefined
      : {
          message: t('acr.staleNotice', locale as Locale),
          linkLabel: t('acr.staleNoticeLink', locale as Locale),
          latestUrl: `/reports/live/${encodeURIComponent(badgeId)}`,
        };
    const base = `/reports/live/${encodeURIComponent(badgeId)}/r/${encodeURIComponent(scan.id)}`;
    const html = await renderScanAcrHtml(
      storage,
      scan,
      loaded,
      {
        locale,
        uploadsRoot,
        links: {
          pdfUrl: `${base}/acr.pdf`,
          ...(loaded.evidenceGroups.length > 0 ? { packUrl: `${base}/acr-pack.zip` } : {}),
        },
        ...(staleNotice ? { staleNotice } : {}),
      },
      revisionsChrome(badgeId, revisions, scan.id, locale),
    );
    return reply.header('X-Robots-Tag', 'noindex').type('text/html').send(html);
  }

  // ── GET /reports/live/:badgeId — latest revision + timeline ───────────────
  server.get(
    '/reports/live/:badgeId',
    { schema: { ...HtmlPageSchema, tags: ['report'], params: BadgeParams } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { badgeId } = request.params as { badgeId: string };
      const resolved = await resolveBadgeLatest(badgeId);
      if (resolved === null) return notFound(reply);
      return renderRevision(request, reply, badgeId, resolved.latest, resolved.latest);
    },
  );

  // ── GET /reports/live/:badgeId/r/:scanId — a specific (possibly old) revision
  server.get(
    '/reports/live/:badgeId/r/:scanId',
    { schema: { ...HtmlPageSchema, tags: ['report'], params: RevisionParams } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { badgeId, scanId } = request.params as { badgeId: string; scanId: string };
      const resolved = await resolveBadgeRevision(badgeId, scanId);
      if (resolved === null) return notFound(reply);
      return renderRevision(request, reply, badgeId, resolved.scan, resolved.latest);
    },
  );

  // ── GET /reports/live/:badgeId/r/:scanId/acr.pdf — that revision as PDF ────
  server.get(
    '/reports/live/:badgeId/r/:scanId/acr.pdf',
    {
      schema: {
        tags: ['report'],
        params: RevisionParams,
        response: { 200: Type.String(), 404: Type.Object({ error: Type.String() }) },
        produces: ['application/pdf'],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { badgeId, scanId } = request.params as { badgeId: string; scanId: string };
      const resolved = await resolveBadgeRevision(badgeId, scanId);
      if (resolved === null) return reply.code(404).send({ error: 'Report not available' });
      const loaded = await loadVpatForScan(storage, resolved.scan);
      if (loaded === null) return reply.code(404).send({ error: 'Report not available' });
      const pdf = await renderScanAcrPdf(
        storage,
        resolved.scan,
        loaded,
        { locale: publicLocale(request), uploadsRoot },
        (err) => request.log.warn(err, 'report-page ACR HTML→PDF failed; served PDFKit fallback'),
      );
      let hostname: string;
      try { hostname = new URL(resolved.scan.siteUrl).hostname; } catch { hostname = 'report'; }
      return reply
        .header('Content-Type', 'application/pdf')
        .header('X-Robots-Tag', 'noindex')
        .header('Content-Disposition', `inline; filename="acr_${hostname}.pdf"`)
        .send(pdf);
    },
  );

  // ── GET /reports/live/:badgeId/r/:scanId/acr-pack.zip — that revision's pack
  server.get(
    '/reports/live/:badgeId/r/:scanId/acr-pack.zip',
    {
      schema: {
        tags: ['report'],
        params: RevisionParams,
        response: { 200: Type.String(), 404: Type.Object({ error: Type.String() }) },
        produces: ['application/zip'],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { badgeId, scanId } = request.params as { badgeId: string; scanId: string };
      const resolved = await resolveBadgeRevision(badgeId, scanId);
      if (resolved === null) return reply.code(404).send({ error: 'Report not available' });
      const zip = await buildEvidencePackZip(storage, resolved.scan, uploadsRoot, publicLocale(request));
      if (zip === null) return reply.code(404).send({ error: 'Report not available' });
      let hostname: string;
      try { hostname = new URL(resolved.scan.siteUrl).hostname; } catch { hostname = 'report'; }
      return reply
        .header('Content-Type', 'application/zip')
        .header('X-Robots-Tag', 'noindex')
        .header('Content-Disposition', `attachment; filename="acr-evidence-pack_${hostname}.zip"`)
        .send(zip);
    },
  );
}
