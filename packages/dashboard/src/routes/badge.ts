import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { StorageAdapter } from '../db/index.js';

// Verdict badge — public, paste-on-customer-site embeddable.
// Customers paste:
//
//   <a href="https://<host>/reports/<id>" rel="noopener">
//     <img src="https://<host>/api/v1/badge/<id>.svg"
//          alt="Verified by Luqen" width="180" height="32">
//   </a>
//
// The SVG is generated server-side from the scan's compliance status and
// completion date. AAA contrast pair on both light and dark backgrounds.
// No JS in the served artifact — keeps the badge AA on a host site that
// disables third-party scripts.
//
// Authorisation: badges are public. The disclosed information is one
// status word plus the scan date, which a regulator could derive
// anyway from the customer's own published statement.

const OXBLOOD = '#5a2a26';
const CITRON = '#d6c43c';
const STATUS_PASS = '#206a44';
const STATUS_WARN = '#7c5612';
const STATUS_FAIL = '#a52822';

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c] ?? c));
}

function statusFor(scan: { errors?: number | null; confirmedViolations?: number | null }): { label: string; colour: string } {
  const errors = scan.errors ?? 0;
  const violations = scan.confirmedViolations ?? 0;
  if (violations > 0) return { label: 'NON-COMPLIANT', colour: STATUS_FAIL };
  if (errors > 0) return { label: 'PARTIAL', colour: STATUS_WARN };
  return { label: 'VERIFIED', colour: STATUS_PASS };
}

function renderSvg(host: string, scanId: string, label: string, statusColour: string, dateIso: string): string {
  // 180 x 32 viewBox. Left half: oxblood block with the u-mark + "LUQEN".
  // Right half: status word in colour-coded text, date in mono underneath.
  // Inter / IBM Plex Mono families are listed in font-family stacks but fall
  // back to system-ui — embedding fonts in an SVG would bloat the badge.
  const safeHost = escapeXml(host);
  const safeId = escapeXml(scanId);
  const titleText = `Verified by Luqen — ${label} on ${dateIso}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="180" height="32" viewBox="0 0 180 32" role="img" aria-label="${escapeXml(titleText)}">
  <title>${escapeXml(titleText)}</title>
  <rect x="0" y="0" width="72" height="32" fill="${OXBLOOD}"/>
  <g fill="#ffffff" stroke="#ffffff">
    <path d="M10 8 V18 a5 5 0 0 0 5 5 h4 a5 5 0 0 0 5 -5 V8" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="square"/>
    <rect x="21" y="8" width="2" height="2" fill="${CITRON}" stroke="none"/>
  </g>
  <text x="32" y="20" font-family="'Inter', system-ui, sans-serif" font-size="11" font-weight="700" fill="#ffffff" letter-spacing="0.06em">LUQEN</text>
  <rect x="72" y="0" width="108" height="32" fill="#ffffff"/>
  <rect x="72" y="0" width="108" height="32" fill="none" stroke="${OXBLOOD}" stroke-width="0.5" opacity="0.4"/>
  <text x="78" y="14" font-family="'Inter', system-ui, sans-serif" font-size="9" font-weight="700" letter-spacing="0.04em" fill="${statusColour}">${escapeXml(label)}</text>
  <text x="78" y="26" font-family="'IBM Plex Mono', Menlo, monospace" font-size="8" fill="${OXBLOOD}">${escapeXml(dateIso)} · ${safeHost}</text>
  <metadata>scan-id:${safeId}</metadata>
</svg>`;
}

export async function badgeRoutes(server: FastifyInstance, storage: StorageAdapter): Promise<void> {
  // SVG endpoint — primary embed surface.
  server.get(
    '/api/v1/badge/:scanId.svg',
    {
      schema: { tags: ['badge'], params: { type: 'object', properties: { scanId: { type: 'string' } }, required: ['scanId'] } },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { scanId } = request.params as { scanId: string };
      const scan = await storage.scans.getScan(scanId);
      if (!scan) {
        reply.code(404);
        return reply.send({ error: 'scan not found' });
      }
      const completed = scan.completedAt ?? scan.createdAt;
      const dateIso = completed ? new Date(completed).toISOString().slice(0, 10) : '';
      const { label, colour } = statusFor(scan);
      // Host from request — supports multi-tenant deployments.
      const host = request.headers.host ?? 'luqen';
      const svg = renderSvg(host, scanId, label, colour, dateIso);
      reply.header('Content-Type', 'image/svg+xml; charset=utf-8');
      reply.header('Cache-Control', 'public, max-age=300');
      reply.header('Access-Control-Allow-Origin', '*');
      // Override the dashboard's same-origin CORP — the badge is
      // designed to be embedded as an <img> on third-party sites.
      reply.header('Cross-Origin-Resource-Policy', 'cross-origin');
      reply.header('Cross-Origin-Embedder-Policy', 'unsafe-none');
      return reply.send(svg);
    },
  );

  // JSON probe — for customer-side validation that the badge is "live".
  server.get(
    '/api/v1/badge/:scanId.json',
    {
      schema: { tags: ['badge'], params: { type: 'object', properties: { scanId: { type: 'string' } }, required: ['scanId'] } },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { scanId } = request.params as { scanId: string };
      const scan = await storage.scans.getScan(scanId);
      if (!scan) {
        reply.code(404);
        return reply.send({ error: 'scan not found' });
      }
      const completed = scan.completedAt ?? scan.createdAt;
      const { label } = statusFor(scan);
      reply.header('Cache-Control', 'public, max-age=300');
      reply.header('Access-Control-Allow-Origin', '*');
      reply.header('Cross-Origin-Resource-Policy', 'cross-origin');
      return reply.send({
        scanId,
        siteUrl: scan.siteUrl,
        status: label,
        verifiedAt: completed ? new Date(completed).toISOString() : null,
        standard: scan.standard,
      });
    },
  );
}
