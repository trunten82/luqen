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
import { getCurrentToolContext } from '@luqen/core/mcp';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DirectScanner } from '@luqen/core';
import { isPrivateHostname } from '../../services/scan-service.js';

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

      // SSRF protection (T-80-05): reject private/internal/loopback hosts
      if (url !== undefined) {
        let parsedUrl: URL;
        try {
          parsedUrl = new URL(url);
        } catch {
          return errorEnvelope('Invalid URL format. Must be a valid http/https URL.');
        }
        if (isPrivateHostname(parsedUrl.hostname)) {
          return errorEnvelope(
            'Scanning internal or private addresses is not allowed. ' +
            'Provide a publicly accessible URL.',
          );
        }
      }

      // Determine the scan target: live URL or data-URL for inline HTML
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
