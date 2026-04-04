#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SqliteAdapter } from './db/sqlite-adapter.js';
import { loadConfig } from './config.js';
import { VERSION } from './version.js';

function createDbAdapter(dbPath?: string): SqliteAdapter {
  const config = loadConfig();
  const resolvedPath = dbPath ?? process.env.LLM_DB_PATH ?? config.dbPath ?? './llm.db';
  return new SqliteAdapter(resolvedPath);
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name('luqen-llm')
    .description('Luqen LLM Service CLI')
    .version(VERSION);

  // ---- serve ----
  program
    .command('serve')
    .description('Start the LLM provider management service')
    .option('--port <number>', 'Port to listen on', '4200')
    .action(async (opts: { port: string }) => {
      const port = parseInt(opts.port, 10);
      const config = loadConfig();
      const db = createDbAdapter();
      await db.initialize();

      const { createServer } = await import('./api/server.js');
      const { createTokenSigner, createTokenVerifier } = await import('./auth/oauth.js');

      let signToken: import('./auth/oauth.js').TokenSigner;
      let verifyToken: import('./auth/oauth.js').TokenVerifier;
      try {
        const privateKeyPem = readFileSync(resolve(config.jwtKeyPair.privateKeyPath), 'utf-8');
        const publicKeyPem = readFileSync(resolve(config.jwtKeyPair.publicKeyPath), 'utf-8');
        signToken = await createTokenSigner(privateKeyPem);
        verifyToken = await createTokenVerifier(publicKeyPem);
      } catch {
        console.error('Warning: JWT key files not found. Run "luqen-llm keys generate" first.');
        process.exit(1);
      }

      const app = await createServer({
        db,
        signToken,
        verifyToken,
        tokenExpiry: config.tokenExpiry,
        corsOrigins: config.cors.origin,
        rateLimitRead: config.rateLimit.read,
        rateLimitWindowMs: config.rateLimit.windowMs,
        logger: true,
      });

      await app.listen({ port, host: config.host });
      console.log(`LLM service running on port ${port}`);
    });

  // ---- clients create ----
  const clients = program.command('clients').description('Manage OAuth2 clients');

  clients
    .command('create')
    .description('Create a new OAuth2 client')
    .requiredOption('--name <name>', 'Client display name')
    .option('--scopes <scopes>', 'Comma-separated scopes', 'read')
    .option('--org <orgId>', 'Organization ID', 'system')
    .action(async (opts: { name: string; scopes: string; org: string }) => {
      const db = createDbAdapter();
      await db.initialize();
      const { hashClientSecret, generateClientCredentials } = await import('./auth/oauth.js');
      const { clientId, clientSecret } = generateClientCredentials();
      const secretHash = await hashClientSecret(clientSecret);
      const scopes = opts.scopes.split(',').map((s) => s.trim());
      const client = await db.createClient({
        name: opts.name,
        secretHash,
        scopes,
        grantTypes: ['client_credentials'],
        orgId: opts.org,
      });
      console.log('Client created:');
      console.log(`  ID:     ${client.id}`);
      console.log(`  Secret: ${clientSecret}`);
      console.log(`  Scopes: ${scopes.join(', ')}`);
      await db.close();
    });

  clients
    .command('list')
    .description('List all OAuth2 clients')
    .action(async () => {
      const db = createDbAdapter();
      await db.initialize();
      const list = await db.listClients();
      if (list.length === 0) {
        console.log('No clients configured.');
      } else {
        for (const c of list) {
          console.log(`  ${c.id} -- ${c.name} [${c.scopes.join(', ')}] org:${c.orgId}`);
        }
      }
      await db.close();
    });

  // ---- users create ----
  const users = program.command('users').description('Manage users');

  users
    .command('create')
    .description('Create a new user')
    .requiredOption('--username <username>', 'Username')
    .requiredOption('--password <password>', 'Password')
    .option('--role <role>', 'Role (viewer|editor|admin)', 'admin')
    .action(async (opts: { username: string; password: string; role: string }) => {
      const db = createDbAdapter();
      await db.initialize();
      const { hashPassword } = await import('./auth/oauth.js');
      const passwordHash = await hashPassword(opts.password);
      const user = await db.createUser({
        username: opts.username,
        passwordHash,
        role: opts.role,
      });
      console.log(`User created: ${user.username} (${user.role})`);
      await db.close();
    });

  // ---- keys generate ----
  program
    .command('keys')
    .command('generate')
    .description('Generate RS256 key pair for JWT')
    .option('--dir <dir>', 'Output directory', './keys')
    .action(async (opts: { dir: string }) => {
      const { generateKeyPair, exportPKCS8, exportSPKI } = await import('jose');
      const { privateKey, publicKey } = await generateKeyPair('RS256');
      const privatePem = await exportPKCS8(privateKey);
      const publicPem = await exportSPKI(publicKey);
      mkdirSync(opts.dir, { recursive: true });
      writeFileSync(resolve(opts.dir, 'private.pem'), privatePem);
      writeFileSync(resolve(opts.dir, 'public.pem'), publicPem);
      console.log(`Keys written to ${opts.dir}/`);
    });

  return program;
}

// Auto-run when invoked directly
const isMain = process.argv[1] && (
  process.argv[1].endsWith('/cli.js') || process.argv[1].endsWith('/cli.ts')
);

if (isMain) {
  const program = createProgram();
  program.parseAsync(process.argv).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
