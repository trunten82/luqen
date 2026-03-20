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
import { VERSION } from './version.js';

export interface PallyMcpServer {
  readonly mcpServer: McpServer;
  readonly toolNames: readonly string[];
  connect(transport: StdioServerTransport): Promise<void>;
}

export function createServer(): PallyMcpServer {
  const mcpServer = new McpServer({
    name: 'pally-agent',
    version: VERSION,
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

  // Tool: pally_raw — Direct pa11y webservice passthrough for backward compatibility
  mcpServer.tool(
    'pally_raw',
    'Run a single-page pa11y scan and return raw pa11y webservice output. Use this for backward compatibility with existing pa11y automations — the response format matches pa11y-webservice exactly.',
    {
      url: z.string().url().describe('The URL to test'),
      standard: z.enum(['WCAG2A', 'WCAG2AA', 'WCAG2AAA']).optional().default('WCAG2AA').describe('WCAG standard'),
      timeout: z.number().int().positive().optional().describe('Scan timeout in ms'),
      wait: z.number().int().nonnegative().optional().describe('Wait time after page load in ms'),
      ignore: z.array(z.string()).optional().describe('Issue codes to ignore'),
      hideElements: z.string().optional().describe('CSS selector for elements to hide'),
      headers: z.record(z.string(), z.string()).optional().describe('HTTP headers sent to the target page'),
      actions: z.array(z.string()).optional().describe('Pa11y actions to run before testing (e.g. "click element #tab", "wait for element .loaded")'),
    },
    async (args) => {
      try {
        const config = await loadConfig();
        const client = new WebserviceClient(config.webserviceUrl, config.webserviceHeaders);

        // Create task
        const task = await client.createTask({
          name: `pally_raw: ${args.url}`,
          url: args.url,
          standard: args.standard ?? 'WCAG2AA',
          timeout: args.timeout,
          wait: args.wait,
          ignore: args.ignore,
          hideElements: args.hideElements,
          headers: args.headers,
        });

        // Run and poll
        await client.runTask(task.id);

        const pollTimeout = config.pollTimeout;
        const start = Date.now();
        let delay = 1000;
        let result = null;

        while (Date.now() - start < pollTimeout) {
          const results = await client.getResults(task.id);
          if (results.length > 0 && results[0].date) {
            result = results[0];
            break;
          }
          const jitter = Math.random() * 1000 - 500;
          await new Promise((resolve) => setTimeout(resolve, Math.max(100, delay + jitter)));
          delay = Math.min(delay * 2, 10000);
        }

        // Cleanup
        try { await client.deleteTask(task.id); } catch { /* best effort */ }

        if (!result) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Scan timed out', url: args.url }) }],
            isError: true,
          };
        }

        // Return raw pa11y result — identical to what pa11y-webservice returns
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
          isError: true,
        };
      }
    },
  );
  toolNames.push('pally_raw');

  // Tool: pally_raw_batch — Batch multiple URLs through pa11y with raw output
  mcpServer.tool(
    'pally_raw_batch',
    'Run pa11y scans on multiple URLs and return raw pa11y results per URL. Backward-compatible output format matching pa11y-webservice.',
    {
      urls: z.array(z.string().url()).describe('List of URLs to test'),
      standard: z.enum(['WCAG2A', 'WCAG2AA', 'WCAG2AAA']).optional().default('WCAG2AA').describe('WCAG standard'),
      concurrency: z.number().int().positive().optional().default(5).describe('Max concurrent scans'),
      timeout: z.number().int().positive().optional().describe('Scan timeout per page in ms'),
      wait: z.number().int().nonnegative().optional().describe('Wait time after page load in ms'),
      ignore: z.array(z.string()).optional().describe('Issue codes to ignore'),
      hideElements: z.string().optional().describe('CSS selector for elements to hide'),
      headers: z.record(z.string(), z.string()).optional().describe('HTTP headers sent to target pages'),
    },
    async (args) => {
      try {
        const config = await loadConfig();
        const client = new WebserviceClient(config.webserviceUrl, config.webserviceHeaders);
        const concurrency = args.concurrency ?? 5;
        const pollTimeout = config.pollTimeout;

        const results: Array<{ url: string; result: unknown; error?: string }> = [];
        const queue = [...args.urls];
        let queueIndex = 0;

        async function processUrl(url: string): Promise<{ url: string; result: unknown; error?: string }> {
          try {
            const task = await client.createTask({
              name: `pally_raw_batch: ${url}`,
              url,
              standard: args.standard ?? 'WCAG2AA',
              timeout: args.timeout,
              wait: args.wait,
              ignore: args.ignore,
              hideElements: args.hideElements,
              headers: args.headers,
            });

            await client.runTask(task.id);

            const start = Date.now();
            let delay = 1000;
            let scanResult = null;

            while (Date.now() - start < pollTimeout) {
              const taskResults = await client.getResults(task.id);
              if (taskResults.length > 0 && taskResults[0].date) {
                scanResult = taskResults[0];
                break;
              }
              const jitter = Math.random() * 1000 - 500;
              await new Promise((resolve) => setTimeout(resolve, Math.max(100, delay + jitter)));
              delay = Math.min(delay * 2, 10000);
            }

            try { await client.deleteTask(task.id); } catch { /* best effort */ }

            if (!scanResult) {
              return { url, result: null, error: 'Scan timed out' };
            }
            return { url, result: scanResult };
          } catch (err) {
            return { url, result: null, error: err instanceof Error ? err.message : String(err) };
          }
        }

        // Worker pool
        async function worker(): Promise<void> {
          while (queueIndex < queue.length) {
            const idx = queueIndex++;
            if (idx >= queue.length) break;
            const r = await processUrl(queue[idx]);
            results.push(r);
          }
        }

        const workers = Array.from(
          { length: Math.min(concurrency, queue.length) },
          () => worker(),
        );
        await Promise.all(workers);

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
          isError: true,
        };
      }
    },
  );
  toolNames.push('pally_raw_batch');

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
