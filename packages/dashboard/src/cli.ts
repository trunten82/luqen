#!/usr/bin/env node
import { Command } from 'commander';
import { loadConfig, validateConfig } from './config.js';
import { ScanDb } from './db/scans.js';

const program = new Command();

program
  .name('pally-dashboard')
  .description('Pally accessibility dashboard server')
  .version('0.1.0');

program
  .command('serve')
  .description('Start the dashboard web server')
  .option('-p, --port <number>', 'Port to listen on (overrides config)')
  .option('-c, --config <path>', 'Path to config file', 'dashboard.config.json')
  .action(async (options: { port?: string; config: string }) => {
    try {
      const config = loadConfig(options.config);
      const resolved = options.port !== undefined
        ? { ...config, port: parseInt(options.port, 10) }
        : config;

      validateConfig(resolved);

      // Dynamic import to avoid loading server dependencies during CLI parsing
      const { createServer } = await import('./server.js');
      const server = await createServer(resolved);

      await server.listen({ port: resolved.port, host: '0.0.0.0' });
      console.log(`Pally Dashboard listening on http://0.0.0.0:${resolved.port}`);
    } catch (err) {
      console.error('Failed to start server:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command('migrate')
  .description('Create or update the SQLite database schema')
  .option('-d, --db-path <path>', 'Path to SQLite database file (overrides config)')
  .option('-c, --config <path>', 'Path to config file', 'dashboard.config.json')
  .action((options: { dbPath?: string; config: string }) => {
    try {
      const config = loadConfig(options.config);
      const dbPath = options.dbPath ?? config.dbPath;
      const db = new ScanDb(dbPath);
      db.initialize();
      db.close();
      console.log(`Migration complete. Database: ${dbPath}`);
    } catch (err) {
      console.error('Migration failed:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program.parse(process.argv);
