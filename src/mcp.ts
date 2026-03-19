import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { loadConfig } from './config.js';
import { discoverUrls } from './discovery/discover.js';
import { WebserviceClient } from './scanner/webservice-client.js';
import { scanUrls } from './scanner/scanner.js';
import { generateJsonReport } from './reporter/json-reporter.js';
import { proposeFixesFromReport } from './fixer/fix-proposer.js';
import { applyFix } from './fixer/fix-applier.js';
import type { ScanReport, FixProposal, PageResult } from './types.js';

export interface PallyMcpServer {
  readonly mcpServer: McpServer;
  readonly toolNames: readonly string[];
  connect(transport: StdioServerTransport): Promise<void>;
}

export function createServer(): PallyMcpServer {
  const mcpServer = new McpServer({
    name: 'pally-agent',
    version: '0.1.0',
  });

  const toolNames: string[] = [];

  // Tool: pally_scan
  mcpServer.tool(
    'pally_scan',
    'Scan a website for accessibility issues using pa11y webservice',
    {
      url: z.string().url().describe('The URL to scan'),
      standard: z.enum(['WCAG2A', 'WCAG2AA', 'WCAG2AAA']).optional().describe('WCAG standard to use'),
      concurrency: z.number().int().positive().optional().describe('Number of concurrent scans'),
      maxPages: z.number().int().positive().optional().describe('Maximum number of pages to scan'),
      alsoCrawl: z.boolean().optional().describe('Also crawl the site in addition to sitemap'),
      ignore: z.array(z.string()).optional().describe('Issue codes to ignore'),
      headers: z.record(z.string(), z.string()).optional().describe('Additional HTTP headers'),
      wait: z.number().int().nonnegative().optional().describe('Milliseconds to wait after page load'),
    },
    async (args) => {
      try {
        const config = await loadConfig();

        const mergedConfig = {
          ...config,
          ...(args.standard !== undefined ? { standard: args.standard } : {}),
          ...(args.concurrency !== undefined ? { concurrency: args.concurrency } : {}),
          ...(args.maxPages !== undefined ? { maxPages: args.maxPages } : {}),
          ...(args.alsoCrawl !== undefined ? { alsoCrawl: args.alsoCrawl } : {}),
          ...(args.ignore !== undefined ? { ignore: args.ignore } : {}),
          ...(args.headers !== undefined ? { headers: { ...config.headers, ...args.headers } } : {}),
          ...(args.wait !== undefined ? { wait: args.wait } : {}),
        };

        const urls = await discoverUrls(args.url, {
          maxPages: mergedConfig.maxPages,
          crawlDepth: mergedConfig.crawlDepth,
          alsoCrawl: mergedConfig.alsoCrawl,
        });

        const client = new WebserviceClient(mergedConfig.webserviceUrl, mergedConfig.webserviceHeaders);

        const scanResults = await scanUrls(urls, client, {
          standard: mergedConfig.standard,
          concurrency: mergedConfig.concurrency,
          timeout: mergedConfig.timeout,
          pollTimeout: mergedConfig.pollTimeout,
          ignore: mergedConfig.ignore,
          hideElements: mergedConfig.hideElements,
          headers: mergedConfig.headers,
          wait: mergedConfig.wait,
        });

        const report = await generateJsonReport({
          siteUrl: args.url,
          pages: scanResults.pages,
          errors: scanResults.errors,
          outputDir: mergedConfig.outputDir,
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(report, null, 2),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: message }),
            },
          ],
          isError: true,
        };
      }
    },
  );
  toolNames.push('pally_scan');

  // Tool: pally_get_issues
  mcpServer.tool(
    'pally_get_issues',
    'Read and filter issues from a JSON scan report',
    {
      reportPath: z.string().describe('Path to the JSON scan report'),
      urlPattern: z.string().optional().describe('Filter pages by URL pattern (substring match)'),
      severity: z.enum(['error', 'warning', 'notice']).optional().describe('Filter issues by severity'),
      ruleCode: z.string().optional().describe('Filter issues by rule code'),
    },
    async (args) => {
      try {
        const content = await readFile(args.reportPath, 'utf-8');
        const report = JSON.parse(content) as ScanReport;

        let pages = report.pages as PageResult[];

        if (args.urlPattern !== undefined) {
          pages = pages.filter((page) => page.url.includes(args.urlPattern as string));
        }

        if (args.severity !== undefined || args.ruleCode !== undefined) {
          pages = pages.map((page) => {
            const filteredIssues = page.issues.filter((issue) => {
              const matchesSeverity = args.severity === undefined || issue.type === args.severity;
              const matchesCode = args.ruleCode === undefined || issue.code.includes(args.ruleCode as string);
              return matchesSeverity && matchesCode;
            });
            return {
              ...page,
              issues: filteredIssues,
              issueCount: filteredIssues.length,
            };
          });
        }

        const result = {
          summary: report.summary,
          filteredPages: pages,
          totalFilteredIssues: pages.reduce((sum, p) => sum + p.issueCount, 0),
        };

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: message }),
            },
          ],
          isError: true,
        };
      }
    },
  );
  toolNames.push('pally_get_issues');

  // Tool: pally_propose_fixes
  mcpServer.tool(
    'pally_propose_fixes',
    'Propose code fixes for accessibility issues found in a scan report',
    {
      reportPath: z.string().describe('Path to the JSON scan report'),
      repoPath: z.string().describe('Path to the repository source code'),
    },
    async (args) => {
      try {
        const content = await readFile(args.reportPath, 'utf-8');
        const report = JSON.parse(content) as ScanReport;

        const config = await loadConfig({ repoPath: args.repoPath });
        const proposals = await proposeFixesFromReport(report, args.repoPath, config.sourceMap);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(proposals, null, 2),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: message }),
            },
          ],
          isError: true,
        };
      }
    },
  );
  toolNames.push('pally_propose_fixes');

  // Tool: pally_apply_fix
  mcpServer.tool(
    'pally_apply_fix',
    'Apply a proposed fix to a source file',
    {
      file: z.string().describe('Path to the file to modify'),
      line: z.number().int().nonnegative().describe('Line number of the fix'),
      oldText: z.string().describe('The existing text to replace'),
      newText: z.string().describe('The new text to insert'),
    },
    async (args) => {
      try {
        const fixProposal: FixProposal = {
          file: args.file,
          line: args.line,
          issue: '',
          description: 'Applied via MCP tool',
          oldText: args.oldText,
          newText: args.newText,
          confidence: 'high',
        };

        const result = await applyFix(fixProposal);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: message }),
            },
          ],
          isError: true,
        };
      }
    },
  );
  toolNames.push('pally_apply_fix');

  return {
    mcpServer,
    toolNames: toolNames as readonly string[],
    async connect(transport: StdioServerTransport): Promise<void> {
      await mcpServer.connect(transport);
    },
  };
}

// Run as main module
const isMain = process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/')) ||
  import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  const server = createServer();
  const transport = new StdioServerTransport();
  server.connect(transport).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`MCP server error: ${message}\n`);
    process.exit(1);
  });
}
