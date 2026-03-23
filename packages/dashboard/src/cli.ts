#!/usr/bin/env node
import { Command } from 'commander';
import { loadConfig, validateConfig } from './config.js';
import { resolveStorageAdapter } from './db/index.js';
import { SqliteStorageAdapter } from './db/sqlite/index.js';
import { VERSION } from './version.js';

const program = new Command();

program
  .name('luqen-dashboard')
  .description('Luqen accessibility dashboard server')
  .version(VERSION);

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
      console.log(`Luqen listening on http://0.0.0.0:${resolved.port}`);
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
  .action(async (options: { dbPath?: string; config: string }) => {
    try {
      const config = loadConfig(options.config);
      const dbPath = options.dbPath ?? config.dbPath;
      const storage = await resolveStorageAdapter({ type: 'sqlite', sqlite: { dbPath } });
      await storage.disconnect();
      console.log(`Migration complete. Database: ${dbPath}`);
    } catch (err) {
      console.error('Migration failed:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command('self-audit')
  .description('Scan the dashboard itself for WCAG 2.1 AA accessibility issues')
  .option('--url <url>', 'URL of a running dashboard instance to audit')
  .option('-p, --port <number>', 'Port for auto-started dashboard (default: from config)')
  .option('-c, --config <path>', 'Path to config file', 'dashboard.config.json')
  .option('--json', 'Output raw JSON instead of formatted summary')
  .action(async (options: { url?: string; port?: string; config: string; json?: boolean }) => {
    try {
      // Dynamic imports to keep CLI startup fast
      const { buildPageUrls, parseAuditResults, formatAuditSummary } = await import('./self-audit.js');
      const { runSelfAudit } = await import('./self-audit-runner.js');

      const config = loadConfig(options.config);
      const port = options.port !== undefined ? parseInt(options.port, 10) : config.port;
      const baseUrl = options.url ?? `http://localhost:${port}`;

      const pageUrls = buildPageUrls(baseUrl);
      console.log(`Auditing ${pageUrls.length} dashboard pages at ${baseUrl}...`);

      const results = await runSelfAudit(pageUrls, config.webserviceUrl);
      const summary = parseAuditResults(results);

      if (options.json) {
        console.log(JSON.stringify(summary, null, 2));
      } else {
        console.log(formatAuditSummary(summary));
      }

      process.exit(summary.totalErrors > 0 ? 1 : 0);
    } catch (err) {
      console.error('Self-audit failed:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ── Plugin management ─────────────────────────────────────────────────────

const pluginCmd = program.command('plugin').description('Manage plugins');

async function withPluginManager(
  configPath: string,
  fn: (manager: import('./plugins/manager.js').PluginManager, registryEntries: readonly import('./plugins/types.js').RegistryEntry[]) => Promise<void>,
): Promise<void> {
  const config = loadConfig(configPath);
  const storage = await resolveStorageAdapter({ type: 'sqlite', sqlite: { dbPath: config.dbPath } });
  const rawDb = (storage as SqliteStorageAdapter).getRawDatabase();

  const { PluginManager } = await import('./plugins/manager.js');
  const { loadRegistry } = await import('./plugins/registry.js');

  const registryEntries = await loadRegistry();
  const manager = new PluginManager({
    db: rawDb,
    pluginsDir: config.pluginsDir,
    encryptionKey: config.sessionSecret,
    registryEntries,
  });

  try {
    await fn(manager, registryEntries);
  } finally {
    await storage.disconnect();
  }
}

pluginCmd
  .command('list')
  .description('List installed plugins')
  .option('-c, --config <path>', 'Config file path', 'dashboard.config.json')
  .action(async (options: { config: string }) => {
    try {
      await withPluginManager(options.config, async (manager) => {
        const plugins = manager.list();
        if (plugins.length === 0) {
          console.log('No plugins installed');
          return;
        }

        // Table header
        console.log(
          'ID'.padEnd(38) +
          'Package'.padEnd(40) +
          'Type'.padEnd(15) +
          'Version'.padEnd(10) +
          'Status',
        );
        console.log('-'.repeat(113));

        for (const p of plugins) {
          console.log(
            p.id.padEnd(38) +
            p.packageName.padEnd(40) +
            p.type.padEnd(15) +
            p.version.padEnd(10) +
            p.status,
          );
        }
      });
    } catch (err) {
      console.error('Failed to list plugins:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

pluginCmd
  .command('install <name>')
  .description('Install a plugin by name from the registry')
  .option('-c, --config <path>', 'Config file path', 'dashboard.config.json')
  .action(async (name: string, options: { config: string }) => {
    try {
      await withPluginManager(options.config, async (manager) => {
        const plugin = await manager.install(name);
        console.log(`Installed ${plugin.packageName} (${plugin.type}, v${plugin.version})`);
        console.log(`Plugin ID: ${plugin.id}`);
      });
    } catch (err) {
      console.error('Install failed:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

pluginCmd
  .command('configure <id>')
  .description('Configure a plugin')
  .option('--set <pairs...>', 'key=value pairs')
  .option('-c, --config <path>', 'Config file path', 'dashboard.config.json')
  .action(async (id: string, options: { set?: string[]; config: string }) => {
    try {
      await withPluginManager(options.config, async (manager) => {
        const pairs = options.set ?? [];
        const config: Record<string, unknown> = {};

        for (const pair of pairs) {
          const eqIndex = pair.indexOf('=');
          if (eqIndex === -1) {
            console.error(`Invalid key=value pair: ${pair}`);
            process.exit(1);
          }
          const key = pair.slice(0, eqIndex);
          const value = pair.slice(eqIndex + 1);
          config[key] = value;
        }

        const plugin = await manager.configure(id, config);
        console.log(`Configured ${plugin.packageName}`);
      });
    } catch (err) {
      console.error('Configure failed:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

pluginCmd
  .command('activate <id>')
  .description('Activate an installed plugin')
  .option('-c, --config <path>', 'Config file path', 'dashboard.config.json')
  .action(async (id: string, options: { config: string }) => {
    try {
      await withPluginManager(options.config, async (manager) => {
        const plugin = await manager.activate(id);
        console.log(`Activated ${plugin.packageName} (status: ${plugin.status})`);
      });
    } catch (err) {
      console.error('Activate failed:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

pluginCmd
  .command('deactivate <id>')
  .description('Deactivate a running plugin')
  .option('-c, --config <path>', 'Config file path', 'dashboard.config.json')
  .action(async (id: string, options: { config: string }) => {
    try {
      await withPluginManager(options.config, async (manager) => {
        const plugin = await manager.deactivate(id);
        console.log(`Deactivated ${plugin.packageName} (status: ${plugin.status})`);
      });
    } catch (err) {
      console.error('Deactivate failed:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

pluginCmd
  .command('remove <id>')
  .description('Remove an installed plugin')
  .option('-c, --config <path>', 'Config file path', 'dashboard.config.json')
  .action(async (id: string, options: { config: string }) => {
    try {
      await withPluginManager(options.config, async (manager) => {
        await manager.remove(id);
        console.log(`Plugin ${id} removed`);
      });
    } catch (err) {
      console.error('Remove failed:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ── API key management ────────────────────────────────────────────────────

program
  .command('api-key')
  .description('Generate a new API key (revokes all previous keys)')
  .option('-c, --config <path>', 'Config file path', 'dashboard.config.json')
  .action(async (options: { config: string }) => {
    try {
      const config = loadConfig(options.config);
      const storage = await resolveStorageAdapter({ type: 'sqlite', sqlite: { dbPath: config.dbPath } });

      await storage.apiKeys.revokeAllKeys();
      const { key } = await storage.apiKeys.getOrCreateKey();

      console.log('New API key generated (all previous keys revoked):');
      console.log(key);

      await storage.disconnect();
    } catch (err) {
      console.error('API key generation failed:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program.parse(process.argv);
