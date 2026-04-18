/**
 * registerResources — Dashboard MCP Resources (Phase 30 plan 30-04, MCPI-05).
 *
 * Two URI-addressable read-only projections of dashboard-owned data:
 *   - scan://report/{id}         — last 50 completed scan reports for caller's org
 *   - brand://score/{siteUrl}    — latest brand score per assigned site (URL-encoded)
 *
 * Both families are RBAC-gated via DASHBOARD_RESOURCE_METADATA consumed by the
 * @luqen/core/mcp http-plugin override (Phase 30 plan 30-01). Callers without
 * reports.view see zero scan:// entries in resources/list AND get Forbidden on
 * direct read of scan://report/xxx. Same pattern for branding.view + brand://.
 *
 * D-11: Content type is always application/json. D-09: {siteUrl} URL-encoded.
 * D-17: no resource template variable is named orgId (verified by runtime test).
 *
 * Status-enum note (carry-over from 30-02): the plan draft used the literal
 * 'complete' for the scan list filter, but ScanRecord.status is the typed
 * union 'queued' | 'running' | 'completed' | 'failed'. The literal 'complete'
 * would be a TypeScript error and an unconditional miss against stored rows.
 * Below uses the real enum value 'completed' everywhere — same Rule 1 fix as
 * the one recorded in 30-02-SUMMARY.md.
 */

import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getCurrentToolContext } from '@luqen/core/mcp';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ResourceMetadata as LuqenResourceMetadata } from '@luqen/core/mcp';
import type { StorageAdapter } from '../db/index.js';

/**
 * Re-export of the @luqen/core/mcp ResourceMetadata interface so existing
 * callers that imported `ResourceMetadata` from this module (during the
 * Phase 30-02 stub period) keep compiling. The shape is identical: the core
 * type is now the single source of truth.
 */
export type ResourceMetadata = LuqenResourceMetadata;

export const DASHBOARD_RESOURCE_METADATA: readonly LuqenResourceMetadata[] = [
  { uriScheme: 'scan', requiredPermission: 'reports.view' },
  { uriScheme: 'brand', requiredPermission: 'branding.view' },
];

export interface RegisterResourcesOptions {
  readonly storage: StorageAdapter;
}

function resolveOrgId(): string {
  const ctx = getCurrentToolContext();
  return ctx?.orgId ?? 'system';
}

export function registerResources(server: McpServer, opts: RegisterResourcesOptions): void {
  const { storage } = opts;

  // ------------------------------------------------------------------
  // scan://report/{id}
  // ------------------------------------------------------------------

  server.registerResource(
    'scan-report',
    new ResourceTemplate('scan://report/{id}', {
      // orgId: ctx.orgId (org-scoped — list filtered to caller's org via storage.scans.listScans filter)
      list: async () => {
        const orgId = resolveOrgId();
        // D-10: last 50 completed reports for caller's org.
        // Note: repository orders by created_at DESC (see scan-repository.ts);
        // strict completed_at ordering is deferred to a later plan.
        // Status literal is 'completed' (the real ScanRecord.status enum value)
        // — see file header note explaining the deviation from plan draft.
        const scans = await storage.scans.listScans({
          orgId,
          status: 'completed',
          limit: 50,
        });
        return {
          resources: scans.map((s) => ({
            uri: `scan://report/${s.id}`,
            name: `Scan report for ${s.siteUrl}`,
            mimeType: 'application/json',
            description: `Completed accessibility scan — status: ${s.status}`,
          })),
        };
      },
    }),
    {
      title: 'Scan reports',
      description: 'Recent completed accessibility scan reports for the current org',
      mimeType: 'application/json',
    },
    // orgId: ctx.orgId (org-scoped — cross-org guard: scan.orgId must match caller)
    async (uri, variables) => {
      const orgId = resolveOrgId();
      const id = variables['id'] as string;
      const scan = await storage.scans.getScan(id);
      if (scan === null || scan.orgId !== orgId) {
        throw new Error(`Resource ${uri.toString()} not found`);
      }
      const report = await storage.scans.getReport(id);
      const payload = { scan, report };
      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: 'application/json',
            text: JSON.stringify(payload, null, 2),
          },
        ],
      };
    },
  );

  // ------------------------------------------------------------------
  // brand://score/{siteUrl}  —  siteUrl URL-encoded in URI
  // ------------------------------------------------------------------

  server.registerResource(
    'brand-score',
    new ResourceTemplate('brand://score/{siteUrl}', {
      // orgId: ctx.orgId (org-scoped — list filtered to caller's org via storage.scans.getLatestPerSite)
      list: async () => {
        const orgId = resolveOrgId();
        const latestScans = await storage.scans.getLatestPerSite(orgId);
        const entries: Array<{
          uri: string;
          name: string;
          mimeType: string;
          description: string;
        }> = [];
        for (const scan of latestScans) {
          const score = await storage.brandScores.getLatestForScan(scan.id);
          if (score === null) continue;
          // D-09: URL-encode siteUrl so '/', '?', '#' survive in the URI path segment.
          entries.push({
            uri: `brand://score/${encodeURIComponent(scan.siteUrl)}`,
            name: `Brand score for ${scan.siteUrl}`,
            mimeType: 'application/json',
            description:
              'Latest brand score for this site (color/typography/components breakdown)',
          });
        }
        return { resources: entries };
      },
    }),
    {
      title: 'Brand scores',
      description: 'Latest brand score per assigned site for the current org',
      mimeType: 'application/json',
    },
    // orgId: ctx.orgId (org-scoped — getHistoryForSite filtered by caller's orgId; cross-org rows are invisible)
    async (uri, variables) => {
      const orgId = resolveOrgId();
      const encoded = variables['siteUrl'] as string;
      const siteUrl = decodeURIComponent(encoded);
      const history = await storage.brandScores.getHistoryForSite(orgId, siteUrl, 1);
      if (history.length === 0) {
        throw new Error(`Resource ${uri.toString()} not found`);
      }
      const entry = history[0];
      const payload = { siteUrl, computedAt: entry?.computedAt, score: entry?.result };
      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: 'application/json',
            text: JSON.stringify(payload, null, 2),
          },
        ],
      };
    },
  );
}
