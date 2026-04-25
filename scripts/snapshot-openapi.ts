#!/usr/bin/env tsx
/**
 * snapshot-openapi.ts — Phase 40-01 DOC-02
 *
 * Boots each Fastify service in-process with a minimal in-memory bootstrap
 * (RSA keypair + SQLite `:memory:`), calls `app.swagger()`, and writes a
 * pretty-printed, deterministic JSON snapshot under
 * `docs/reference/openapi/{service}.json`.
 *
 * Why deterministic: snapshot files are committed to the repo and gated by
 * the `openapi-drift` CI workflow. Re-running this script on a clean checkout
 * MUST produce zero diff. We achieve that by:
 *   1. Sorting `paths` keys alphabetically.
 *   2. Sorting top-level `tags` array (if present) alphabetically by name.
 *   3. Sorting `components.schemas` keys alphabetically.
 *   4. Stripping any `servers[*].url` so the snapshot is host-independent
 *      (the live `/docs/json` per service still surfaces the actual URL).
 *
 * MCP filtering: the dashboard service hosts both the HTML/admin surface
 * AND the MCP Streamable HTTP endpoint. We boot the dashboard once, take
 * the full spec, then split into:
 *   - dashboard.json — paths NOT starting with `/api/v1/mcp`
 *   - mcp.json       — paths starting with `/api/v1/mcp`
 *
 * Usage:
 *   npm run docs:openapi
 *
 * Output:
 *   docs/reference/openapi/compliance.json
 *   docs/reference/openapi/branding.json
 *   docs/reference/openapi/llm.json
 *   docs/reference/openapi/dashboard.json
 *   docs/reference/openapi/mcp.json
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPair, exportSPKI, exportPKCS8 } from 'jose';
import type { FastifyInstance } from 'fastify';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const OUT_DIR = resolve(REPO_ROOT, 'docs/reference/openapi');

interface OpenApiDoc {
  openapi?: string;
  info?: Record<string, unknown>;
  servers?: ReadonlyArray<{ url?: string }>;
  paths?: Record<string, unknown>;
  components?: { schemas?: Record<string, unknown>; [k: string]: unknown };
  tags?: ReadonlyArray<{ name: string; [k: string]: unknown }>;
  [k: string]: unknown;
}

function sortObjectKeys<T extends Record<string, unknown>>(obj: T | undefined): T | undefined {
  if (obj === undefined) return undefined;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) {
    out[k] = obj[k];
  }
  return out as T;
}

function normaliseSpec(spec: OpenApiDoc): OpenApiDoc {
  const next: OpenApiDoc = { ...spec };
  if (next.paths) next.paths = sortObjectKeys(next.paths);
  if (next.components?.schemas) {
    next.components = {
      ...next.components,
      schemas: sortObjectKeys(next.components.schemas),
    };
  }
  if (Array.isArray(next.tags)) {
    next.tags = [...next.tags].sort((a, b) => a.name.localeCompare(b.name));
  }
  if (Array.isArray(next.servers)) {
    // Drop server URLs so snapshots are host-independent.
    next.servers = next.servers.map(() => ({ url: '<replaced-at-runtime>' }));
  }
  return next;
}

function writeSnapshot(name: string, spec: OpenApiDoc): void {
  mkdirSync(OUT_DIR, { recursive: true });
  const target = resolve(OUT_DIR, `${name}.json`);
  const json = JSON.stringify(normaliseSpec(spec), null, 2) + '\n';
  writeFileSync(target, json, 'utf8');
  const pathCount = spec.paths ? Object.keys(spec.paths).length : 0;
  // eslint-disable-next-line no-console
  console.log(`wrote ${name}.json — ${pathCount} paths`);
}

async function buildKeys(): Promise<{ privateKeyPem: string; publicKeyPem: string }> {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  return {
    privateKeyPem: await exportPKCS8(privateKey),
    publicKeyPem: await exportSPKI(publicKey),
  };
}

async function snapshotCompliance(): Promise<void> {
  const { privateKeyPem, publicKeyPem } = await buildKeys();
  const { SqliteAdapter } = await import('../packages/compliance/src/db/sqlite-adapter.js');
  const { createTokenSigner, createTokenVerifier } = await import('../packages/compliance/src/auth/oauth.js');
  const { createServer } = await import('../packages/compliance/src/api/server.js');

  process.env['DASHBOARD_JWKS_URL'] = '';
  const db = new SqliteAdapter(':memory:');
  const app: FastifyInstance = await createServer({
    db,
    signToken: await createTokenSigner(privateKeyPem),
    verifyToken: await createTokenVerifier(publicKeyPem),
    tokenExpiry: '1h',
    corsOrigins: ['*'],
    logger: false,
    skipSeed: true,
  });
  await app.ready();
  // @ts-expect-error fastify-swagger augments instance type via module declaration
  const spec = app.swagger() as OpenApiDoc;
  writeSnapshot('compliance', spec);
  await app.close();
}

async function snapshotBranding(): Promise<void> {
  const { privateKeyPem, publicKeyPem } = await buildKeys();
  const { SqliteAdapter } = await import('../packages/branding/src/db/sqlite-adapter.js');
  const { createTokenSigner, createTokenVerifier } = await import('../packages/branding/src/auth/oauth.js');
  const { createServer } = await import('../packages/branding/src/api/server.js');

  const db = new SqliteAdapter(':memory:');
  const app: FastifyInstance = await createServer({
    db,
    signToken: await createTokenSigner(privateKeyPem),
    verifyToken: await createTokenVerifier(publicKeyPem),
    tokenExpiry: '1h',
    corsOrigins: ['*'],
    logger: false,
  });
  await app.ready();
  // @ts-expect-error fastify-swagger augments instance type via module declaration
  const spec = app.swagger() as OpenApiDoc;
  writeSnapshot('branding', spec);
  await app.close();
}

async function snapshotLlm(): Promise<void> {
  const { privateKeyPem, publicKeyPem } = await buildKeys();
  const { SqliteAdapter } = await import('../packages/llm/src/db/sqlite-adapter.js');
  const { createTokenSigner, createTokenVerifier } = await import('../packages/llm/src/auth/oauth.js');
  const { createServer } = await import('../packages/llm/src/api/server.js');

  process.env['DASHBOARD_JWKS_URL'] = '';
  const db = new SqliteAdapter(':memory:');
  const app: FastifyInstance = await createServer({
    db,
    signToken: await createTokenSigner(privateKeyPem),
    verifyToken: await createTokenVerifier(publicKeyPem),
    tokenExpiry: '1h',
    corsOrigins: ['*'],
    logger: false,
  });
  await app.ready();
  // @ts-expect-error fastify-swagger augments instance type via module declaration
  const spec = app.swagger() as OpenApiDoc;
  writeSnapshot('llm', spec);
  await app.close();
}

async function snapshotDashboardAndMcp(): Promise<void> {
  // The dashboard server requires significant config (sessionSecret, dbPath,
  // catalogue URL, etc). We import its DashboardConfig defaults via the
  // exported helper if present, otherwise fall back to a minimal hand-rolled
  // config. The dashboard hosts BOTH the admin/UI Fastify routes and the
  // MCP Streamable HTTP endpoint at /api/v1/mcp, so we boot once and split.
  const { createServer } = await import('../packages/dashboard/src/server.js');
  const { tmpdir } = await import('node:os');
  const { mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const tmpRoot = mkdtempSync(join(tmpdir(), 'luqen-openapi-snapshot-'));

  const minimalConfig = {
    dbPath: join(tmpRoot, 'dashboard.db'),
    reportsDir: join(tmpRoot, 'reports'),
    sessionSecret: 'a'.repeat(32),
    catalogueUrl: '',
    catalogueCacheTtl: 0,
    redisUrl: '',
    maxConcurrentScans: 1,
  } as unknown as Parameters<typeof createServer>[0];

  const app = await createServer(minimalConfig);
  await app.ready();
  // @ts-expect-error fastify-swagger augments instance type via module declaration
  const spec = app.swagger() as OpenApiDoc;

  // Split paths: MCP (anything under /api/v1/mcp) → mcp.json; rest → dashboard.json.
  const allPaths = spec.paths ?? {};
  const mcpPaths: Record<string, unknown> = {};
  const dashPaths: Record<string, unknown> = {};
  for (const [pathKey, pathItem] of Object.entries(allPaths)) {
    if (pathKey === '/api/v1/mcp' || pathKey.startsWith('/api/v1/mcp/')) {
      mcpPaths[pathKey] = pathItem;
    } else {
      dashPaths[pathKey] = pathItem;
    }
  }

  writeSnapshot('dashboard', { ...spec, paths: dashPaths });
  writeSnapshot('mcp', {
    ...spec,
    info: {
      ...(spec.info ?? {}),
      title: 'Luqen MCP (Streamable HTTP)',
      description: 'Model Context Protocol Streamable HTTP endpoint hosted on the dashboard service',
    },
    paths: mcpPaths,
  });
  await app.close();
}

async function main(): Promise<void> {
  // Each surface is wrapped individually so a single failure surfaces with
  // a clear name rather than collapsing the run.
  const surfaces: ReadonlyArray<readonly [string, () => Promise<void>]> = [
    ['compliance', snapshotCompliance],
    ['branding', snapshotBranding],
    ['llm', snapshotLlm],
    ['dashboard+mcp', snapshotDashboardAndMcp],
  ];

  for (const [name, fn] of surfaces) {
    try {
      await fn();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`failed to snapshot ${name}:`, err);
      process.exitCode = 1;
    }
  }
}

void main();
