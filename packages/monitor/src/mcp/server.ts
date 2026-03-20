import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { loadConfig } from '../config.js';
import { runScan, getStatus } from '../agent.js';
import { addSource } from '../compliance-client.js';
import { getToken } from '../compliance-client.js';

// ---- Tool name constants ----

export const MONITOR_TOOL_NAMES = [
  'monitor_scan_sources',
  'monitor_status',
  'monitor_add_source',
] as const;

export type MonitorToolName = (typeof MONITOR_TOOL_NAMES)[number];

// ---- Factory ----

export function createMonitorMcpServer(): McpServer {
  const server = new McpServer({
    name: 'pally-monitor',
    version: '0.1.0',
  });

  // ---- monitor_scan_sources ----
  server.registerTool(
    'monitor_scan_sources',
    {
      description:
        'Run a full scan of all monitored legal sources. Fetches each source, computes a SHA-256 hash, and creates UpdateProposals for any sources whose content has changed since the last scan.',
      inputSchema: z.object({}),
    },
    async () => {
      const result = await runScan();
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );

  // ---- monitor_status ----
  server.registerTool(
    'monitor_status',
    {
      description:
        'Show the current monitor status: number of monitored sources, last scan time, and pending proposal count.',
      inputSchema: z.object({}),
    },
    async () => {
      const status = await getStatus();
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(status, null, 2),
          },
        ],
      };
    },
  );

  // ---- monitor_add_source ----
  server.registerTool(
    'monitor_add_source',
    {
      description:
        'Add a new legal source URL to the compliance service for monitoring.',
      inputSchema: z.object({
        name: z.string().describe('Human-readable name for the source (e.g. "W3C WAI Policies")'),
        url: z.string().url().describe('URL to monitor'),
        type: z
          .enum(['html', 'rss', 'api'])
          .describe('Content type of the source'),
        schedule: z
          .enum(['daily', 'weekly', 'monthly'])
          .describe('How often to check the source'),
      }),
    },
    async ({ name, url, type, schedule }) => {
      const config = loadConfig();
      const token = await getToken(
        config.complianceUrl,
        config.complianceClientId,
        config.complianceClientSecret,
      );
      const source = await addSource(config.complianceUrl, token, {
        name,
        url,
        type,
        schedule,
      });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(source, null, 2),
          },
        ],
      };
    },
  );

  return server;
}
