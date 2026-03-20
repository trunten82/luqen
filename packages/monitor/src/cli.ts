#!/usr/bin/env node
import { Command } from 'commander';
import { runScan, getStatus } from './agent.js';
import { createMonitorMcpServer } from './mcp/server.js';
import { agentCard } from './a2a/agent-card.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { VERSION } from './version.js';

const program = new Command();

program
  .name('pally-monitor')
  .description('Regulatory monitor agent for accessibility regulation changes')
  .version(VERSION);

// ---- scan ----

program
  .command('scan')
  .description('Run one full scan cycle over all monitored legal sources')
  .option('--sources-file <path>', 'Path to a local sources JSON file (standalone mode)')
  .action(async (opts: { sourcesFile?: string }) => {
    try {
      console.error('[monitor] Starting scan…');
      const result = await runScan(
        opts.sourcesFile !== undefined ? { sourcesFile: opts.sourcesFile } : {},
      );
      console.error(
        `[monitor] Scan complete: ${result.scanned} sources, ` +
          `${result.changed} changed, ${result.unchanged} unchanged, ` +
          `${result.errors} errors.`,
      );
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.errors > 0 ? 1 : 0);
    } catch (err) {
      console.error('[monitor] Scan failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// ---- status ----

program
  .command('status')
  .description('Show current monitor status')
  .action(async () => {
    try {
      const status = await getStatus();
      console.log(JSON.stringify(status, null, 2));
      process.exit(0);
    } catch (err) {
      console.error('[monitor] Status failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// ---- mcp ----

program
  .command('mcp')
  .description('Start the MCP server on stdio (for use with Claude Code)')
  .action(async () => {
    const server = createMonitorMcpServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    // Keep process alive until transport closes
    await new Promise<void>((resolve) => {
      transport.onclose = resolve;
    });
  });

// ---- serve ----

program
  .command('serve')
  .description('Start an HTTP server with A2A endpoints')
  .option('--port <port>', 'Port to listen on', '4200')
  .action(async (opts: { port: string }) => {
    const port = parseInt(opts.port, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      console.error(`[monitor] Invalid port: ${opts.port}`);
      process.exit(1);
    }

    // Dynamically import http to keep the module tree clean
    const { createServer } = await import('node:http');

    const server = createServer((req, res) => {
      if (req.url === '/.well-known/agent.json' && req.method === 'GET') {
        const body = JSON.stringify(agentCard, null, 2);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        });
        res.end(body);
        return;
      }

      if (req.url === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });

    server.listen(port, () => {
      console.error(`[monitor] Serving on http://localhost:${port}`);
      console.error(`[monitor] Agent card: http://localhost:${port}/.well-known/agent.json`);
    });
  });

program.parse(process.argv);
