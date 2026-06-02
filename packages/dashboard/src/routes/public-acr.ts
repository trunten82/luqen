import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Type } from '@sinclair/typebox';
import type { StorageAdapter } from '../db/index.js';
import { HtmlPageSchema } from '../api/schemas/envelope.js';
import { loadVpatForScan, renderVpatHtml } from '../services/vpat-share-service.js';
import { generateVpatPdf } from '../pdf/generator.js';
import { isScanPublicShareable } from './badge.js';

/**
 * Public, DYNAMIC Accessibility Conformance Report (the widget→VPAT surface).
 *
 * A live, always-current VPAT/ACR for a scan whose owner has opted the scan
 * into public sharing (the same `publicShareEnabled` gate the embeddable badge
 * uses). The Luqen widget / accessibility badge deep-links here so a visitor —
 * or a plaintiff's lawyer — can open a good-faith, dated, evidenced conformance
 * record instead of a fake "compliant" badge.
 *
 * STATIC / pinned snapshots remain available via the revocable report-share
 * token (`/share/:token`); this is the dynamic counterpart that regenerates
 * from the latest scan + manual verdicts on each load, like the public
 * accessibility-statement page.
 *
 * Conservative by construction: it renders the same reconciled VPAT (Supports /
 * Partially Supports / Does Not Support / Not Evaluated) the report uses — never
 * a "certified" or "100% compliant" claim — and is marked `noindex`.
 *
 * Exempt from the global auth guard (see `isPublicPath` in server.ts); the
 * per-scan public-share opt-in IS the authorisation.
 */

const AcrParams = Type.Object({ id: Type.String() }, { additionalProperties: true });

export async function publicAcrRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
  selfScanId: string | undefined,
  uploadsRoot: string,
): Promise<void> {
  // ── GET /reports/:id/acr — the live public ACR document ──────────────────
  server.get(
    '/reports/:id/acr',
    { schema: { ...HtmlPageSchema, tags: ['report'], params: AcrParams } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const scan = await storage.scans.getScan(id);
      const host = request.headers.host ?? '';
      if (scan === null || scan.status !== 'completed' || !isScanPublicShareable(scan, selfScanId, host)) {
        return reply.code(404).type('text/html').send('<!DOCTYPE html><meta charset="utf-8"><title>Not available</title><p>This report is not publicly available.</p>');
      }
      const loaded = await loadVpatForScan(storage, scan);
      if (loaded === null) {
        return reply.code(404).type('text/html').send('<!DOCTYPE html><meta charset="utf-8"><title>Not available</title><p>This report is not publicly available.</p>');
      }
      const html = await renderVpatHtml(scan, loaded, {
        pdfUrl: `/reports/${encodeURIComponent(id)}/acr.pdf`,
        packUrl: null, // evidence packs stay behind the revocable share token, not the public widget link
        isShared: true,
      });
      return reply
        .header('X-Robots-Tag', 'noindex')
        .type('text/html')
        .send(html);
    },
  );

  // ── GET /reports/:id/acr.pdf — the live public ACR as a PDF ──────────────
  server.get(
    '/reports/:id/acr.pdf',
    {
      schema: {
        tags: ['report'],
        params: AcrParams,
        response: { 200: Type.String(), 404: Type.Object({ error: Type.String() }) },
        produces: ['application/pdf'],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const scan = await storage.scans.getScan(id);
      const host = request.headers.host ?? '';
      if (scan === null || scan.status !== 'completed' || !isScanPublicShareable(scan, selfScanId, host)) {
        return reply.code(404).send({ error: 'Report not available' });
      }
      const loaded = await loadVpatForScan(storage, scan);
      if (loaded === null) return reply.code(404).send({ error: 'Report not available' });
      const pdf = await generateVpatPdf(loaded.scanMeta, loaded.vpat, { groups: loaded.evidenceGroups, uploadsRoot });
      let hostname: string;
      try { hostname = new URL(scan.siteUrl).hostname; } catch { hostname = 'report'; }
      return reply
        .header('Content-Type', 'application/pdf')
        .header('X-Robots-Tag', 'noindex')
        .header('Content-Disposition', `inline; filename="acr_${hostname}.pdf"`)
        .send(pdf);
    },
  );
}
