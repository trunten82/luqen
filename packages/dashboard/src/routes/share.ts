import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Type } from '@sinclair/typebox';
import type { StorageAdapter } from '../db/index.js';
import type { ScanRecord, ReportShareRecord } from '../db/types.js';
import { HtmlPageSchema } from '../api/schemas/envelope.js';
import {
  loadVpatForScan,
  buildEvidencePackZip,
  renderScanAcrHtml,
  renderScanAcrPdf,
  resolveLocale,
} from '../services/vpat-share-service.js';
import { t } from '../i18n/index.js';

/** Locale for a token surface: ?lang= (validated) → 'en' (no session). */
function shareLocale(request: FastifyRequest): string {
  return resolveLocale((request.query as { lang?: string }).lang);
}

const ShareTokenParams = Type.Object({ token: Type.String() }, { additionalProperties: true });

/**
 * Anonymous, token-authorised access to a single scan's VPAT/ACR + evidence
 * pack. The token (not the scan id) is the secret; a share is valid only while
 * it exists, is unexpired and unrevoked, and its scan is still completed.
 *
 * These routes are exempt from the global auth guard (see server.ts) — the
 * token IS the authorisation, so internal RBAC gating never applies here.
 */
export async function shareRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
  uploadsRoot: string,
): Promise<void> {
  // Resolve a token to its active share + completed scan, or a reason it is not
  // available ('gone' = expired/revoked/missing-scan; 'notfound' = bad token).
  async function resolveActiveShare(
    token: string,
  ): Promise<{ share: ReportShareRecord; scan: ScanRecord } | { reason: 'gone' | 'notfound' }> {
    // Storage backends without the optional reportShares repo cannot resolve any
    // token — treat every share link as non-existent (renders the 404 "not
    // available" page, matching the bad-token path).
    if (!storage.reportShares) return { reason: 'notfound' };
    const share = await storage.reportShares.getByToken(token);
    if (share === null) return { reason: 'notfound' };
    if (share.revokedAt !== null) return { reason: 'gone' };
    if (share.expiresAt !== null && Date.parse(share.expiresAt) <= Date.now()) return { reason: 'gone' };
    const scan = await storage.scans.getScan(share.scanId);
    if (scan === null || scan.status !== 'completed') return { reason: 'gone' };
    return { share, scan };
  }

  // A clean "no longer available" page for missing / expired / revoked links.
  function notAvailablePage(reply: FastifyReply, code: number): FastifyReply {
    const esc = (s: string): string =>
      s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">`
      + `<meta name="viewport" content="width=device-width, initial-scale=1">`
      + `<title>${esc(t('share.unavailableTitle'))}</title>`
      + `<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;background:#faf7f6;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:2rem}`
      + `.card{max-width:34rem;background:#fff;border:1px solid #d0d4de;border-top:4px solid #5a2a26;border-radius:8px;padding:2rem;text-align:center}`
      + `h1{color:#5a2a26;font-size:1.3rem;margin:0 0 .6rem}p{color:#4a4a4a;line-height:1.5;margin:0}</style></head>`
      + `<body><div class="card"><h1>${esc(t('share.unavailableTitle'))}</h1>`
      + `<p>${esc(t('share.unavailableBody'))}</p></div></body></html>`;
    return reply.code(code).type('text/html').send(html);
  }

  // ── GET /share/:token — the shared VPAT/ACR document ──────────────────────
  server.get(
    '/share/:token',
    { schema: { ...HtmlPageSchema, tags: ['share'], params: ShareTokenParams } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { token } = request.params as { token: string };
      const resolved = await resolveActiveShare(token);
      if ('reason' in resolved) {
        return notAvailablePage(reply, resolved.reason === 'notfound' ? 404 : 410);
      }
      const { scan } = resolved;

      const loaded = await loadVpatForScan(storage, scan);
      if (loaded === null) return notAvailablePage(reply, 410);

      // External viewer: download links point at the token routes (the internal
      // export routes are RBAC-gated and would 403). Renders the single-source
      // shared ACR template, same as every other surface.
      const html = await renderScanAcrHtml(storage, scan, loaded, {
        locale: shareLocale(request),
        uploadsRoot,
        links: {
          pdfUrl: `/share/${encodeURIComponent(token)}/vpat.pdf`,
          ...(loaded.evidenceGroups.length > 0
            ? { packUrl: `/share/${encodeURIComponent(token)}/evidence-pack.zip` }
            : {}),
        },
      });
      return reply.type('text/html').send(html);
    },
  );

  // ── GET /share/:token/vpat.pdf — token-authorised ACR PDF ─────────────────
  server.get(
    '/share/:token/vpat.pdf',
    {
      schema: {
        tags: ['share'],
        params: ShareTokenParams,
        response: { 200: Type.String(), 404: Type.Object({ error: Type.String() }), 410: Type.Object({ error: Type.String() }) },
        produces: ['application/pdf'],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { token } = request.params as { token: string };
      const resolved = await resolveActiveShare(token);
      if ('reason' in resolved) {
        return reply.code(resolved.reason === 'notfound' ? 404 : 410).send({ error: 'Share not available' });
      }
      const loaded = await loadVpatForScan(storage, resolved.scan);
      if (loaded === null) return reply.code(410).send({ error: 'Share not available' });
      const pdf = await renderScanAcrPdf(
        storage,
        resolved.scan,
        loaded,
        { locale: shareLocale(request), uploadsRoot },
        (err) => request.log.warn(err, 'token-share ACR HTML→PDF failed; served PDFKit fallback'),
      );
      let hostname: string;
      try { hostname = new URL(resolved.scan.siteUrl).hostname; } catch { hostname = 'report'; }
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="vpat_${hostname}.pdf"`)
        .send(pdf);
    },
  );

  // ── GET /share/:token/evidence-pack.zip — token-authorised evidence pack ──
  server.get(
    '/share/:token/evidence-pack.zip',
    {
      schema: {
        tags: ['share'],
        params: ShareTokenParams,
        response: { 200: Type.String(), 404: Type.Object({ error: Type.String() }), 410: Type.Object({ error: Type.String() }) },
        produces: ['application/zip'],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { token } = request.params as { token: string };
      const resolved = await resolveActiveShare(token);
      if ('reason' in resolved) {
        return reply.code(resolved.reason === 'notfound' ? 404 : 410).send({ error: 'Share not available' });
      }
      const zip = await buildEvidencePackZip(storage, resolved.scan, uploadsRoot, shareLocale(request));
      if (zip === null) return reply.code(410).send({ error: 'Share not available' });
      let hostname: string;
      try { hostname = new URL(resolved.scan.siteUrl).hostname; } catch { hostname = 'report'; }
      return reply
        .header('Content-Type', 'application/zip')
        .header('Content-Disposition', `attachment; filename="vpat-evidence-pack_${hostname}.zip"`)
        .send(zip);
    },
  );
}
