/**
 * registerScanTools — MCP scan tool for analysing a URL or HTML snippet.
 *
 * Provides the `dashboard_scan_page` tool: a synchronous, non-destructive
 * scan that returns structured WCAG findings from a URL or raw HTML without
 * creating a scan record or triggering any background job.
 *
 * Security:
 *   T-80-05: SSRF protection — agent-supplied URLs are validated with
 *   `isPrivateHostname` before the scanner is invoked. Private/loopback
 *   hosts are rejected with errorEnvelope (isError:true).
 *
 * Non-destructive (D-09): no write path, no scan record created.
 * Tool is annotated read-only.
 */

import { z } from 'zod';
import net from 'node:net';
import { promises as dns } from 'node:dns';
import { getCurrentToolContext } from '@luqen/core/mcp';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DirectScanner } from '@luqen/core';
import { validateScanUrl } from '../../services/scan-service.js';

/**
 * SSRF egress block-list (T-80-05). Built from `node:net` BlockList — no new
 * dependency. Covers IPv4 + IPv6 loopback, private, link-local, CGNAT,
 * multicast, and reserved ranges. The agent scan tool accepts an arbitrary
 * caller-supplied URL, so the string-only `isPrivateHostname` check is not
 * enough — we DNS-resolve the host and reject if ANY resolved address falls in
 * a blocked range. Resolution also normalises IPv4 alternate encodings
 * (decimal/octal/hex hostnames resolve to their dotted form) and rejects
 * check-time DNS-rebinding to a private IP.
 */
const SSRF_BLOCK = new net.BlockList();
SSRF_BLOCK.addSubnet('0.0.0.0', 8);
SSRF_BLOCK.addSubnet('10.0.0.0', 8);
SSRF_BLOCK.addSubnet('100.64.0.0', 10); // CGNAT
SSRF_BLOCK.addSubnet('127.0.0.0', 8);
SSRF_BLOCK.addSubnet('169.254.0.0', 16); // link-local incl. cloud metadata 169.254.169.254
SSRF_BLOCK.addSubnet('172.16.0.0', 12);
SSRF_BLOCK.addSubnet('192.0.0.0', 24);
SSRF_BLOCK.addSubnet('192.168.0.0', 16);
SSRF_BLOCK.addSubnet('198.18.0.0', 15);
SSRF_BLOCK.addSubnet('224.0.0.0', 4); // multicast
SSRF_BLOCK.addSubnet('240.0.0.0', 4); // reserved
SSRF_BLOCK.addSubnet('::1', 128, 'ipv6');
SSRF_BLOCK.addSubnet('::', 128, 'ipv6');
SSRF_BLOCK.addSubnet('fc00::', 7, 'ipv6'); // unique-local
SSRF_BLOCK.addSubnet('fe80::', 10, 'ipv6'); // link-local
SSRF_BLOCK.addSubnet('ff00::', 8, 'ipv6'); // multicast

/**
 * Resolve `hostname` and return true only if EVERY resolved address is public.
 * Rejects on resolution failure (can't prove it's public → don't scan).
 */
async function resolvesToPublicOnly(hostname: string): Promise<boolean> {
  let addrs: Array<{ address: string; family: number }>;
  try {
    addrs = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    return false;
  }
  if (addrs.length === 0) {
    return false;
  }
  for (const a of addrs) {
    let addr = a.address;
    let fam: 'ipv4' | 'ipv6' = a.family === 6 ? 'ipv6' : 'ipv4';
    // Unwrap IPv4-mapped IPv6 (::ffff:a.b.c.d) so it's range-checked as IPv4.
    if (fam === 'ipv6' && addr.toLowerCase().startsWith('::ffff:') && net.isIPv4(addr.slice(7))) {
      addr = addr.slice(7);
      fam = 'ipv4';
    }
    if (!net.isIP(addr) || SSRF_BLOCK.check(addr, fam)) {
      return false;
    }
  }
  return true;
}

export const SCAN_TOOL_NAMES = ['dashboard_scan_page'] as const;

export interface RegisterScanToolsOptions {
  /** DirectScanner instance (or stub in tests) injected at registration time. */
  readonly scanner: DirectScanner;
}

// ── Shared helpers (copied verbatim from compliance.ts lines 62-83) ──────────

function resolveOrgId(): string {
  const ctx = getCurrentToolContext();
  return ctx?.orgId ?? 'system';
}

function errorEnvelope(msg: string): {
  content: Array<{ type: 'text'; text: string }>;
  isError: true;
} {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: msg }) }],
    isError: true,
  };
}

function okEnvelope(payload: unknown): {
  content: Array<{ type: 'text'; text: string }>;
} {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
}

// ── Tool registration ─────────────────────────────────────────────────────────

export function registerScanTools(
  server: McpServer,
  opts: RegisterScanToolsOptions,
): void {
  const { scanner } = opts;

  // ---- dashboard_scan_page ----
  server.registerTool(
    'dashboard_scan_page',
    {
      description:
        [
          'Analyse a URL or raw HTML snippet for WCAG accessibility issues.',
          'Accepts either `url` (fetches and scans the live page) or `html` (scans the raw markup without a network request).',
          'Returns a `findings` array with the same shape as the dashboard scan report: code, type, message, selector, context, runner.',
          'Non-destructive — does NOT create a scan record or trigger any background scan job.',
          'SSRF protection: private/internal/loopback URLs (127.x, 10.x, 192.168.x, localhost, .local) are rejected.',
        ].join(' '),
      inputSchema: z.object({
        url: z
          .string()
          .optional()
          .describe('URL of the page to scan (must be a public http/https URL).'),
        html: z
          .string()
          .optional()
          .describe('Raw HTML markup to scan (used when the page is not publicly accessible).'),
        standard: z
          .enum(['WCAG2A', 'WCAG2AA', 'WCAG2AAA'])
          .optional()
          .describe('WCAG conformance level (default: WCAG2AA).'),
        deep: z
          .boolean()
          .optional()
          .describe('Run multi-engine deep scan (htmlcs + axe). Default: false (htmlcs only).'),
      }),
      annotations: { destructiveHint: false, readOnlyHint: true },
    },
    // orgId: ctx.orgId (org-scoped only insofar as the scan runs under the caller's org context;
    // the tool reads no org-scoped tables and never writes)
    async (args) => {
      const _orgId = resolveOrgId();
      const { url, html, standard = 'WCAG2AA', deep = false } = args;

      // Require exactly one of url or html
      if (url === undefined && html === undefined) {
        return errorEnvelope('Either "url" or "html" must be supplied.');
      }

      // SSRF protection (T-80-05). Layered:
      //  1. validateScanUrl — protocol allowlist (http/https only) + the
      //     platform's string-based private-host check (fast reject).
      //  2. resolvesToPublicOnly — DNS-resolve and reject if any resolved IP is
      //     private/reserved (catches IPv4 alt-encodings, IPv6 ranges, and
      //     check-time DNS rebinding that the string check misses).
      if (url !== undefined) {
        const validated = validateScanUrl(url, false);
        if ('error' in validated) {
          return errorEnvelope(
            `${validated.error} Provide a publicly accessible http(s) URL.`,
          );
        }
        if (!(await resolvesToPublicOnly(validated.url.hostname))) {
          return errorEnvelope(
            'Scanning internal, private, or unresolvable addresses is not allowed. ' +
            'Provide a publicly accessible URL.',
          );
        }
      }

      // Determine the scan target: live URL or data-URL for inline HTML.
      // RESIDUAL SSRF (html path, T-80-05 follow-up): attacker-supplied HTML
      // rendered in Chromium can request internal subresources (img/src,
      // link/href, style url(), etc.). Fully closing this needs request
      // interception INSIDE the shared @luqen/core scanner (re-validate every
      // navigation/subresource host against SSRF_BLOCK, or launch with network
      // egress disabled) — a scanner-level change tracked separately. The tool
      // is gated by mcp.use + scans.create (authenticated org members only),
      // which bounds exposure until that lands.
      const scanTarget =
        url !== undefined
          ? url
          : `data:text/html,${encodeURIComponent(html!)}`;

      // Runner selection: deep=true enables multi-engine; default is htmlcs only
      const runners: string[] = deep ? ['htmlcs', 'axe'] : [];
      const runner: 'htmlcs' | undefined = deep ? undefined : 'htmlcs';

      try {
        const result = await scanner.scan(scanTarget, {
          standard,
          ...(deep ? { runners } : { runner }),
          includeWarnings: true,
          includeNotices: false,
        });

        return okEnvelope({
          findings: result.issues,
          meta: {
            count: result.issues.length,
            standard,
            runner: deep ? 'htmlcs+axe' : 'htmlcs',
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Scanner unavailable';
        return errorEnvelope(`Scan failed: ${msg}`);
      }
    },
  );
}
