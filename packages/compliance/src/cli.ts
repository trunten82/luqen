#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SqliteAdapter } from './db/sqlite-adapter.js';
import { seedBaseline } from './seed/loader.js';
import { loadConfig } from './config.js';
import { createComplianceMcpServer } from './mcp/server.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { VERSION } from './version.js';

// ---- Utility: load DB adapter ----

function createDbAdapter(dbPath?: string): SqliteAdapter {
  const config = loadConfig();
  const resolvedPath = dbPath ?? process.env.COMPLIANCE_DB_PATH ?? config.dbPath ?? './compliance.db';
  return new SqliteAdapter(resolvedPath);
}

// ---- createProgram: exported for testing ----

export function createProgram(): Command {
  const program = new Command();

  program
    .name('luqen-compliance')
    .description('Luqen Compliance Service CLI')
    .version(VERSION);

  // ---- serve ----
  program
    .command('serve')
    .description('Start the Fastify REST + MCP + A2A server')
    .option('--port <number>', 'Port to listen on', '4000')
    .action(async (opts: { port: string }) => {
      const port = parseInt(opts.port, 10);
      const config = loadConfig();
      const db = createDbAdapter();
      await db.initialize();

      const {
        createServer,
      } = await import('./api/server.js');
      const {
        registerAgentCardPlugin,
      } = await import('./a2a/agent-card.js');
      const {
        registerA2aTasksPlugin,
      } = await import('./a2a/tasks.js');

      // Load JWT keys
      let signToken: import('./auth/oauth.js').TokenSigner;
      let verifyToken: import('./auth/oauth.js').TokenVerifier;
      try {
        const { createTokenSigner, createTokenVerifier } = await import('./auth/oauth.js');
        const privateKeyPem = readFileSync(resolve(config.jwtKeyPair.privateKeyPath), 'utf-8');
        const publicKeyPem = readFileSync(resolve(config.jwtKeyPair.publicKeyPath), 'utf-8');
        signToken = await createTokenSigner(privateKeyPem);
        verifyToken = await createTokenVerifier(publicKeyPem);
      } catch {
        console.error(
          'Warning: JWT key files not found. Run "luqen-compliance keys generate" first.',
        );
        process.exit(1);
      }

      // Optional Redis cache — only constructed when COMPLIANCE_REDIS_URL is set
      let cache: import('./cache/redis.js').ComplianceCache | undefined;
      if (config.redisUrl) {
        const { createRedisClient, ComplianceCache } = await import('./cache/redis.js');
        const redisClient = createRedisClient(config.redisUrl);
        if (redisClient !== null) {
          cache = new ComplianceCache(redisClient);
          console.log('Compliance Redis cache enabled.');
        }
      }

      const app = await createServer({
        db,
        signToken,
        verifyToken,
        tokenExpiry: config.tokenExpiry,
        corsOrigins: config.cors.origin,
        rateLimitRead: config.rateLimit.read,
        rateLimitWrite: config.rateLimit.write,
        rateLimitWindowMs: config.rateLimit.windowMs,
        logger: true,
        cache,
        reseedInterval: config.reseedInterval,
        llmUrl: config.llmUrl,
        llmApiKey: config.llmApiKey,
      });

      await app.register(registerAgentCardPlugin);
      await app.register(registerA2aTasksPlugin, { db });

      await app.listen({ port, host: config.host });
      console.log(`Compliance service running on port ${port}`);
    });

  // ---- seed ----
  program
    .command('seed')
    .description('Load the baseline compliance dataset')
    .option('--force', 'Delete all system records and re-seed from scratch')
    .action(async (opts: { force?: boolean }) => {
      const db = createDbAdapter();
      await db.initialize();
      const result = await seedBaseline(db, { force: opts.force });
      console.log('Seed complete:');
      console.log(`  WCAG Criteria: ${result.wcagCriteria}`);
      console.log(`  Jurisdictions: ${result.jurisdictions}`);
      console.log(`  Regulations:   ${result.regulations}`);
      console.log(`  Requirements:  ${result.requirements}`);
      await db.close();
    });

  // ---- clients ----
  const clientsCmd = program
    .command('clients')
    .description('Manage OAuth2 clients');

  clientsCmd
    .command('create')
    .description('Create a new OAuth2 client')
    .requiredOption('--name <name>', 'Client name')
    .option('--scope <scopes>', 'Space-separated scopes', 'read')
    .option('--grant <grantType>', 'Grant type', 'client_credentials')
    .action(async (opts: { name: string; scope: string; grant: string }) => {
      const db = createDbAdapter();
      await db.initialize();
      const client = await db.createClient({
        name: opts.name,
        scopes: opts.scope.split(/\s+/),
        grantTypes: [opts.grant as 'client_credentials' | 'authorization_code'],
      });
      console.log('Client created:');
      console.log(`  client_id:     ${client.id}`);
      console.log(`  client_secret: ${client.secret}`);
      console.log(`  name:          ${client.name}`);
      console.log(`  scopes:        ${client.scopes.join(', ')}`);
      await db.close();
    });

  clientsCmd
    .command('list')
    .description('List all OAuth2 clients')
    .action(async () => {
      const db = createDbAdapter();
      await db.initialize();
      const clients = await db.listClients();
      if (clients.length === 0) {
        console.log('No clients found.');
      } else {
        for (const client of clients) {
          console.log(`${client.id}  ${client.name}  [${client.scopes.join(', ')}]`);
        }
      }
      await db.close();
    });

  clientsCmd
    .command('revoke <id>')
    .description('Delete an OAuth2 client')
    .action(async (id: string) => {
      const db = createDbAdapter();
      await db.initialize();
      await db.deleteClient(id);
      console.log(`Client ${id} revoked.`);
      await db.close();
    });

  // ---- users ----
  const usersCmd = program
    .command('users')
    .description('Manage users');

  usersCmd
    .command('create')
    .description('Create a new user')
    .requiredOption('--username <username>', 'Username')
    .option('--role <role>', 'User role (admin|editor|viewer)', 'viewer')
    .option('--password <password>', 'Password (prompted if not provided)')
    .action(async (opts: { username: string; role: string; password?: string }) => {
      const db = createDbAdapter();
      await db.initialize();

      let password = opts.password;
      if (password == null || password === '') {
        // In a real CLI we'd prompt; for now use a placeholder
        console.error('Error: --password is required');
        process.exit(1);
      }

      const user = await db.createUser({
        username: opts.username,
        password,
        role: opts.role as 'admin' | 'editor' | 'viewer',
      });

      console.log('User created:');
      console.log(`  id:       ${user.id}`);
      console.log(`  username: ${user.username}`);
      console.log(`  role:     ${user.role}`);
      await db.close();
    });

  // ---- keys ----
  const keysCmd = program
    .command('keys')
    .description('Manage JWT key pairs');

  keysCmd
    .command('generate')
    .description('Generate RS256 key pair, saves to ./keys/')
    .action(async () => {
      const { generateKeyPair, exportPKCS8, exportSPKI } = await import('jose');
      const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
      const privateKeyPem = await exportPKCS8(privateKey);
      const publicKeyPem = await exportSPKI(publicKey);

      mkdirSync('./keys', { recursive: true });
      writeFileSync('./keys/private.pem', privateKeyPem, { mode: 0o600 });
      writeFileSync('./keys/public.pem', publicKeyPem);

      console.log('Key pair generated:');
      console.log('  ./keys/private.pem');
      console.log('  ./keys/public.pem');
    });

  // ---- mcp ----
  program
    .command('mcp')
    .description('Start MCP server on stdio')
    .action(async () => {
      const { server } = await createComplianceMcpServer();
      const transport = new StdioServerTransport();
      await server.connect(transport);
    });

  return program;
}

// ---- Entry point (only when run directly) ----

// Guard: do not auto-parse when imported as a module during testing
const isMain =
  process.argv[1] != null &&
  (process.argv[1].endsWith('cli.js') ||
    process.argv[1].endsWith('cli.ts') ||
    process.argv[1].includes('luqen-compliance'));

if (isMain) {
  const program = createProgram();
  program.parseAsync(process.argv).catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
