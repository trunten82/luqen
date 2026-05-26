import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Type } from '@sinclair/typebox';
import type { StorageAdapter } from '../db/index.js';
import type { ScanRecord } from '../db/types.js';

/**
 * Public-share gate (shared by the badge SVG/JSON and the
 * /reports/:id/public viewer in routes/reports.ts).
 *
 * Allow if:
 *   - the scan's owner opted in (publicShareEnabled === true), OR
 *   - the scan is the dashboard's configured dogfood self-scan
 *     (back-compat for the login badge), OR
 *   - the scan's siteUrl host matches the request host (the original
 *     "Luqen-of-Luqen" allow path from Phase 58 R5).
 */
export function isScanPublicShareable(
  scan: ScanRecord,
  selfScanId: string | undefined,
  requestHost: string,
): boolean {
  if (scan.publicShareEnabled === true) return true;
  if (selfScanId !== undefined && selfScanId === scan.id) return true;
  try {
    const u = new URL(scan.siteUrl);
    if (u.host === requestHost && requestHost !== '') return true;
  } catch {
    /* fall through */
  }
  return false;
}

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

/**
 * Render a WCAG standard code as a spaced label.
 *   WCAG21AA  → 'WCAG 2.1 AA'
 *   WCAG22AAA → 'WCAG 2.2 AAA'
 *   WCAG2A    → 'WCAG 2.0 A'
 * Unknown / empty input falls back to the raw string.
 */
function formatStandard(standard: string): string {
  if (!standard) return '';
  const m = standard.match(/^WCAG\s*(\d)(\d?)\s*(A{1,3})$/i);
  if (m === null) return standard;
  const major = m[1];
  const minor = m[2] === '' ? '0' : m[2];
  const level = m[3]!.toUpperCase();
  return `WCAG ${major}.${minor} ${level}`;
}

export type BadgeSize = 'small' | 'large';

interface RenderSvgInput {
  readonly idForMetadata: string;
  readonly label: string;
  readonly statusColour: string;
  readonly dateIso: string;
  readonly standard: string;
  readonly size: BadgeSize;
}

/**
 * Two sizes, identical content:
 *   small  180 × 32  — inline footer use (default)
 *   large  260 × 60  — press kits, evidence packs
 *
 * Right column carries STATUS + (standard · date) — host is dropped because
 * the badge is embedded ON the verified site, and the link wrapping the
 * <img> already takes you to the full report URL.
 *
 * Inter / IBM Plex stacks fall back to system-ui — no embedded fonts.
 */
function renderSvg(input: RenderSvgInput): string {
  const safeId = escapeXml(input.idForMetadata);
  const standardLabel = formatStandard(input.standard);
  const provenance = [standardLabel, input.dateIso].filter(Boolean).join(' · ');
  const titleText = `Luqen verdict: ${input.label} — ${provenance || input.dateIso}`;
  const safeTitle = escapeXml(titleText);
  const safeLabel = escapeXml(input.label);
  const safeProv = escapeXml(provenance || input.dateIso);

  if (input.size === 'large') {
    // 260 × 60 — same composition, larger type, more breathing room.
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="260" height="60" viewBox="0 0 260 60" role="img" aria-label="${safeTitle}">
  <title>${safeTitle}</title>
  <rect x="0" y="0" width="104" height="60" fill="${OXBLOOD}"/>
  <g fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="square">
    <path d="M16 16 V34 a8 8 0 0 0 8 8 h6 a8 8 0 0 0 8 -8 V16"/>
  </g>
  <rect x="32" y="16" width="3" height="9" fill="${CITRON}"/>
  <text x="46" y="35" font-family="'Inter Display','Inter',system-ui,sans-serif" font-size="18" font-weight="800" fill="#ffffff" letter-spacing="-0.01em">LUQEN</text>
  <rect x="104" y="0" width="156" height="60" fill="#ffffff"/>
  <text x="116" y="28" font-family="'Inter',system-ui,sans-serif" font-size="16" font-weight="700" letter-spacing="0.02em" fill="${input.statusColour}">${safeLabel}</text>
  <text x="116" y="46" font-family="'Inter',system-ui,sans-serif" font-size="11" font-weight="500" fill="${OXBLOOD}" opacity="0.8">${safeProv}</text>
  <metadata>luqen-badge:${safeId}</metadata>
</svg>`;
  }

  // small — 180 × 32 default
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="180" height="32" viewBox="0 0 180 32" role="img" aria-label="${safeTitle}">
  <title>${safeTitle}</title>
  <rect x="0" y="0" width="72" height="32" fill="${OXBLOOD}"/>
  <g fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="square">
    <path d="M10 8 V18 a5 5 0 0 0 5 5 h4 a5 5 0 0 0 5 -5 V8"/>
  </g>
  <rect x="21" y="8" width="2" height="6" fill="${CITRON}"/>
  <text x="32" y="21" font-family="'Inter',system-ui,sans-serif" font-size="12" font-weight="700" fill="#ffffff" letter-spacing="0.04em">LUQEN</text>
  <rect x="72" y="0" width="108" height="32" fill="#ffffff"/>
  <text x="78" y="14" font-family="'Inter',system-ui,sans-serif" font-size="10" font-weight="700" letter-spacing="0.02em" fill="${input.statusColour}">${safeLabel}</text>
  <text x="78" y="26" font-family="'Inter',system-ui,sans-serif" font-size="8" font-weight="500" fill="${OXBLOOD}" opacity="0.78">${safeProv}</text>
  <metadata>luqen-badge:${safeId}</metadata>
</svg>`;
}

function parseSize(raw: unknown): BadgeSize {
  return raw === 'large' ? 'large' : 'small';
}

export async function badgeRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
  selfScanId?: string,
): Promise<void> {
  // SVG endpoint — primary embed surface.
  server.get(
    '/api/v1/badge/:scanId.svg',
    {
      schema: {
        tags: ['badge'],
        params: Type.Object({ scanId: Type.String() }),
        querystring: Type.Object({
          size: Type.Optional(Type.Union([Type.Literal('small'), Type.Literal('large')])),
        }),
        response: {
          200: Type.String({ description: 'SVG markup' }),
          404: Type.Object({ error: Type.String() }),
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { scanId } = request.params as { scanId: string };
      const scan = await storage.scans.getScan(scanId);
      if (!scan) {
        reply.code(404);
        return reply.send({ error: 'scan not found' });
      }
      const host = request.headers.host ?? 'luqen';
      if (!isScanPublicShareable(scan, selfScanId, host)) {
        reply.code(404);
        return reply.send({ error: 'scan not public' });
      }
      const completed = scan.completedAt ?? scan.createdAt;
      const dateIso = completed ? new Date(completed).toISOString().slice(0, 10) : '';
      const { label, colour } = statusFor(scan);
      const svg = renderSvg({
        idForMetadata: scanId,
        label,
        statusColour: colour,
        dateIso,
        standard: scan.standard,
        size: parseSize((request.query as { size?: string }).size),
      });
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
      schema: {
        tags: ['badge'],
        params: Type.Object({ scanId: Type.String() }),
        response: {
          200: Type.Object({
            scanId:     Type.String(),
            siteUrl:    Type.String(),
            status:     Type.String(),
            verifiedAt: Type.Union([Type.String(), Type.Null()]),
            standard:   Type.String(),
          }),
          404: Type.Object({ error: Type.String() }),
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { scanId } = request.params as { scanId: string };
      const scan = await storage.scans.getScan(scanId);
      if (!scan) {
        reply.code(404);
        return reply.send({ error: 'scan not found' });
      }
      const host = request.headers.host ?? '';
      if (!isScanPublicShareable(scan, selfScanId, host)) {
        reply.code(404);
        return reply.send({ error: 'scan not public' });
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

  // ── Live (dynamic) badge — resolves the latest completed scan for
  //    (org_id, site_url) on every request. Useful for scheduled scans:
  //    the embed never goes stale, the verdict tracks the latest run.
  //    The site_badges row is the public-facing handle; the URL never
  //    leaks org_id or scan ids.
  server.get(
    '/api/v1/badge/live/:badgeId.svg',
    {
      schema: {
        tags: ['badge'],
        params: Type.Object({ badgeId: Type.String() }),
        querystring: Type.Object({
          size: Type.Optional(Type.Union([Type.Literal('small'), Type.Literal('large')])),
        }),
        response: {
          200: Type.String({ description: 'SVG markup' }),
          404: Type.Object({ error: Type.String() }),
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { badgeId } = request.params as { badgeId: string };
      const badge = await storage.siteBadges.get(badgeId);
      if (badge === null || !badge.enabled) {
        reply.code(404);
        return reply.send({ error: 'badge not found' });
      }
      const scan = await storage.scans.getLatestCompletedForSite(
        badge.orgId,
        badge.siteUrl,
      );
      if (scan === null) {
        reply.code(404);
        return reply.send({ error: 'no completed scan yet' });
      }
      const completed = scan.completedAt ?? scan.createdAt;
      const dateIso = completed ? new Date(completed).toISOString().slice(0, 10) : '';
      const { label, colour } = statusFor(scan);
      const svg = renderSvg({
        idForMetadata: badgeId,
        label,
        statusColour: colour,
        dateIso,
        standard: scan.standard,
        size: parseSize((request.query as { size?: string }).size),
      });
      reply.header('Content-Type', 'image/svg+xml; charset=utf-8');
      // Shorter TTL than the static badge — the verdict actually moves.
      reply.header('Cache-Control', 'public, max-age=60');
      reply.header('Access-Control-Allow-Origin', '*');
      reply.header('Cross-Origin-Resource-Policy', 'cross-origin');
      reply.header('Cross-Origin-Embedder-Policy', 'unsafe-none');
      return reply.send(svg);
    },
  );

  server.get(
    '/api/v1/badge/live/:badgeId.json',
    {
      schema: {
        tags: ['badge'],
        params: Type.Object({ badgeId: Type.String() }),
        response: {
          200: Type.Object({
            badgeId:    Type.String(),
            siteUrl:    Type.String(),
            scanId:     Type.String(),
            status:     Type.String(),
            verifiedAt: Type.Union([Type.String(), Type.Null()]),
            standard:   Type.String(),
          }),
          404: Type.Object({ error: Type.String() }),
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { badgeId } = request.params as { badgeId: string };
      const badge = await storage.siteBadges.get(badgeId);
      if (badge === null || !badge.enabled) {
        reply.code(404);
        return reply.send({ error: 'badge not found' });
      }
      const scan = await storage.scans.getLatestCompletedForSite(
        badge.orgId,
        badge.siteUrl,
      );
      if (scan === null) {
        reply.code(404);
        return reply.send({ error: 'no completed scan yet' });
      }
      const completed = scan.completedAt ?? scan.createdAt;
      const { label } = statusFor(scan);
      reply.header('Cache-Control', 'public, max-age=60');
      reply.header('Access-Control-Allow-Origin', '*');
      reply.header('Cross-Origin-Resource-Policy', 'cross-origin');
      return reply.send({
        badgeId,
        siteUrl: badge.siteUrl,
        scanId: scan.id,
        status: label,
        verifiedAt: completed ? new Date(completed).toISOString() : null,
        standard: scan.standard,
      });
    },
  );
}
