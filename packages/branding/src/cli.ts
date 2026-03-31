#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SqliteAdapter } from './db/sqlite-adapter.js';
import { loadConfig } from './config.js';
import { VERSION } from './version.js';

// ---- Utility: load DB adapter ----

function createDbAdapter(dbPath?: string): SqliteAdapter {
  const config = loadConfig();
  const resolvedPath = dbPath ?? process.env.BRANDING_DB_PATH ?? config.dbPath ?? './branding.db';
  return new SqliteAdapter(resolvedPath);
}

// ---- createProgram: exported for testing ----

export function createProgram(): Command {
  const program = new Command();

  program
    .name('luqen-branding')
    .description('Luqen Branding Service CLI')
    .version(VERSION);

  // ---- serve ----
  program
    .command('serve')
    .description('Start the Fastify REST server')
    .option('--port <number>', 'Port to listen on', '4100')
    .action(async (opts: { port: string }) => {
      const port = parseInt(opts.port, 10);
      const config = loadConfig();
      const db = createDbAdapter();
      await db.initialize();

      const { createServer } = await import('./api/server.js');

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
          'Warning: JWT key files not found. Run "luqen-branding keys generate" first.',
        );
        process.exit(1);
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
      });

      await app.listen({ port, host: config.host });
      console.log(`Branding service running on port ${port}`);
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
        grantTypes: [opts.grant as 'client_credentials'],
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

  return program;
}

// ---- Entry point (only when run directly) ----

const isMain =
  process.argv[1] != null &&
  (process.argv[1].endsWith('cli.js') ||
    process.argv[1].endsWith('cli.ts') ||
    process.argv[1].includes('luqen-branding'));

if (isMain) {
  const program = createProgram();
  program.parseAsync(process.argv).catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
