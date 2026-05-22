#!/usr/bin/env node
/**
 * Phase 60 sub-phase 60.00 — Shared-asset pipeline.
 *
 * Exports plugin-loadable assets from the main Luqen repo into the WordPress
 * plugin's `assets/` directory. The plugin reads from these JSON files in
 * Solo mode (no Luqen modules reachable); the Fastify modules continue to
 * read from their canonical sources. One source of truth, two consumers.
 *
 * Outputs:
 *   - assets/baseline.json       jurisdictions + regulations + requirements
 *                                from the compliance store
 *   - assets/source-feeds.json   upstream regulation source URLs + pinned keys
 *   - assets/prompts/manifest.json  LLM prompt inventory + input shapes
 *                                (template extraction is a follow-on)
 *   - assets/schema/*.json       compliance entity JSON Schemas
 *   - assets/manifest.json       top-level build manifest with checksums
 *
 * Usage:
 *   node bin/export-plugin-assets.mjs [--db PATH] [--out PATH] [--commit SHA]
 */

import { argv, exit } from 'node:process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

function parseArgs() {
  const args = { db: null, out: null, commit: null };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--db') args.db = argv[++i];
    else if (arg === '--out') args.out = argv[++i];
    else if (arg === '--commit') args.commit = argv[++i];
    else if (arg === '-h' || arg === '--help') {
      console.log('Usage: node bin/export-plugin-assets.mjs [--db PATH] [--out PATH] [--commit SHA]');
      exit(0);
    } else {
      console.error(`unknown arg: ${arg}`);
      exit(2);
    }
  }
  args.db = args.db || resolve(REPO_ROOT, 'packages/compliance/compliance.db');
  args.out = args.out || resolve(REPO_ROOT, '../luqen-wordpress/assets');
  if (!args.commit) {
    try {
      args.commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf-8' }).trim();
    } catch {
      args.commit = 'unknown';
    }
  }
  return args;
}

function ensureDir(p) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function writeJsonAsset(outDir, relPath, data) {
  const fullPath = join(outDir, relPath);
  ensureDir(dirname(fullPath));
  const json = JSON.stringify(data, null, 2) + '\n';
  writeFileSync(fullPath, json);
  return { path: relPath, bytes: Buffer.byteLength(json), sha256: sha256(json) };
}

function exportBaseline(dbPath, outDir) {
  if (!existsSync(dbPath)) {
    console.warn(`baseline: compliance db not found at ${dbPath}; writing empty baseline`);
    return writeJsonAsset(outDir, 'baseline.json', {
      generatedAt: new Date().toISOString(),
      jurisdictions: [],
      regulations: [],
      requirements: [],
      note: 'Compliance store was unavailable at export time.',
    });
  }
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const jurisdictions = db.prepare('SELECT * FROM jurisdictions ORDER BY id').all();
    const regulations = db.prepare('SELECT * FROM regulations ORDER BY id').all();
    const requirements = db.prepare('SELECT * FROM requirements ORDER BY id').all();
    return writeJsonAsset(outDir, 'baseline.json', {
      generatedAt: new Date().toISOString(),
      counts: {
        jurisdictions: jurisdictions.length,
        regulations: regulations.length,
        requirements: requirements.length,
      },
      jurisdictions,
      regulations,
      requirements,
    });
  } finally {
    db.close();
  }
}

function exportSourceFeeds(dbPath, outDir) {
  const defaults = [
    { id: 'wcag-w3c', name: 'W3C WCAG Specification', url: 'https://www.w3.org/TR/WCAG22/', type: 'spec', schedule: 'weekly', publicKey: null, verifySignature: false },
    { id: 'eu-eaa', name: 'European Accessibility Act', url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32019L0882', type: 'regulation', schedule: 'monthly', publicKey: null, verifySignature: false },
    { id: 'us-ada', name: 'ADA.gov Web Accessibility', url: 'https://www.ada.gov/resources/web-guidance/', type: 'regulation', schedule: 'monthly', publicKey: null, verifySignature: false },
    { id: 'en-301-549', name: 'EN 301 549 - Accessibility Requirements for ICT', url: 'https://www.etsi.org/deliver/etsi_en/301500_301599/301549/', type: 'spec', schedule: 'monthly', publicKey: null, verifySignature: false },
    { id: 'aoda', name: 'AODA - Ontario Accessibility Act', url: 'https://www.ontario.ca/laws/statute/05a11', type: 'regulation', schedule: 'monthly', publicKey: null, verifySignature: false },
    { id: 'section-508', name: 'US Section 508', url: 'https://www.access-board.gov/ict/', type: 'regulation', schedule: 'monthly', publicKey: null, verifySignature: false },
  ];
  let live = [];
  if (existsSync(dbPath)) {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      live = db.prepare('SELECT id, name, url, type, schedule FROM monitored_sources').all();
    } finally {
      db.close();
    }
  }
  const byId = new Map(defaults.map((d) => [d.id, d]));
  for (const l of live) {
    const existing = byId.get(l.id) || {};
    byId.set(l.id, { ...existing, ...l });
  }
  return writeJsonAsset(outDir, 'source-feeds.json', {
    generatedAt: new Date().toISOString(),
    schemaVersion: 1,
    feeds: Array.from(byId.values()),
    signatureScheme: 'ed25519',
    notes: 'Ed25519 public-key pinning is scaffolded but not yet enforced. When Luqen ships signed feeds, plugin will refuse unsigned updates.',
  });
}

function exportPromptsManifest(outDir) {
  const promptsDir = resolve(REPO_ROOT, 'packages/llm/src/prompts');
  if (!existsSync(promptsDir)) {
    return writeJsonAsset(outDir, 'prompts/manifest.json', { generatedAt: new Date().toISOString(), prompts: [] });
  }
  const entries = readdirSync(promptsDir)
    .filter((f) => f.endsWith('.ts') && !['helpers.ts', 'segments.ts'].includes(f))
    .map((f) => {
      const name = f.replace(/\.ts$/, '');
      const src = readFileSync(join(promptsDir, f), 'utf-8');
      // Match both inline object input `(input: { ... })` and named type
      // `(input: SomeName)` or `(options?: SomeName)`.
      const builderRe = /export function (build[A-Za-z0-9_]+)\s*\(\s*(?:input|options)\??:\s*([^)]+?)\)/s;
      const buildFn = src.match(builderRe);
      let inputs = [];
      let inputTypeName = null;
      if (buildFn) {
        const inputDecl = buildFn[2].trim();
        if (inputDecl.startsWith('{')) {
          const fieldRegex = /readonly\s+(\w+)(\??):\s*([^;]+);/g;
          let m;
          while ((m = fieldRegex.exec(inputDecl)) !== null) {
            inputs.push({ name: m[1], type: m[3].trim(), required: m[2] !== '?' });
          }
        } else {
          inputTypeName = inputDecl;
          const ifaceRe = new RegExp(`(?:interface|type)\\s+${inputTypeName}\\s*(?:=\\s*)?\\{([^}]+)\\}`, 's');
          const iface = src.match(ifaceRe);
          if (iface) {
            const block = iface[1];
            const fieldRegex = /(?:readonly\s+)?(\w+)(\??):\s*([^;]+);/g;
            let m;
            while ((m = fieldRegex.exec(block)) !== null) {
              if (['extends', 'implements'].includes(m[1])) continue;
              inputs.push({ name: m[1], type: m[3].trim(), required: m[2] !== '?' });
            }
          }
        }
      }
      return {
        name,
        sourcePath: `packages/llm/src/prompts/${f}`,
        builderFunction: buildFn ? buildFn[1] : null,
        inputTypeName,
        inputs,
        sha256: sha256(src),
        bytes: Buffer.byteLength(src),
      };
    });
  return writeJsonAsset(outDir, 'prompts/manifest.json', {
    generatedAt: new Date().toISOString(),
    schemaVersion: 1,
    extractionStatus: 'scaffold',
    extractionNote: 'Prompt templates are TS functions today. Plugin cannot consume them directly. Refactoring to a portable template+inputs format is tracked as a follow-on.',
    prompts: entries,
  });
}

function exportSchemas(outDir) {
  const schemas = {
    jurisdiction: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      title: 'Jurisdiction',
      type: 'object',
      required: ['id', 'name', 'type', 'createdAt', 'updatedAt'],
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        type: { type: 'string', enum: ['country', 'state', 'province', 'region', 'international', 'organization'] },
        parentId: { type: ['string', 'null'] },
        iso3166: { type: ['string', 'null'] },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
        org_id: { type: 'string' },
      },
    },
    regulation: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      title: 'Regulation',
      type: 'object',
      required: ['id', 'jurisdictionId', 'name', 'shortName', 'reference', 'url', 'enforcementDate', 'status', 'scope', 'description', 'createdAt', 'updatedAt'],
      properties: {
        id: { type: 'string' },
        jurisdictionId: { type: 'string' },
        name: { type: 'string' },
        shortName: { type: 'string' },
        reference: { type: 'string' },
        url: { type: 'string', format: 'uri' },
        enforcementDate: { type: 'string', format: 'date-time' },
        status: { type: 'string' },
        scope: { type: 'string' },
        sectors: { type: 'array', items: { type: 'string' } },
        description: { type: 'string' },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
        org_id: { type: 'string' },
      },
    },
    requirement: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      title: 'Requirement',
      type: 'object',
      required: ['id', 'regulationId', 'wcagVersion', 'wcagLevel', 'wcagCriterion', 'obligation', 'createdAt', 'updatedAt'],
      properties: {
        id: { type: 'string' },
        regulationId: { type: 'string' },
        wcagVersion: { type: 'string' },
        wcagLevel: { type: 'string', enum: ['A', 'AA', 'AAA'] },
        wcagCriterion: { type: 'string' },
        obligation: { type: 'string' },
        notes: { type: ['string', 'null'] },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
        org_id: { type: 'string' },
      },
    },
    monitored_source: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      title: 'MonitoredSource',
      type: 'object',
      required: ['id', 'name', 'url', 'type', 'schedule', 'createdAt'],
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        url: { type: 'string', format: 'uri' },
        type: { type: 'string', enum: ['regulation', 'spec', 'guidance'] },
        schedule: { type: 'string', enum: ['hourly', 'daily', 'weekly', 'monthly'] },
        lastCheckedAt: { type: ['string', 'null'], format: 'date-time' },
        lastContentHash: { type: ['string', 'null'] },
        createdAt: { type: 'string', format: 'date-time' },
        org_id: { type: 'string' },
      },
    },
  };
  const written = [];
  for (const [name, schema] of Object.entries(schemas)) {
    written.push(writeJsonAsset(outDir, `schema/${name}.json`, schema));
  }
  return written;
}

function writeTopLevelManifest(outDir, assets, args) {
  return writeJsonAsset(outDir, 'manifest.json', {
    generatedAt: new Date().toISOString(),
    schemaVersion: 1,
    sourceCommit: args.commit,
    sourceRepo: 'luqen',
    exporter: 'bin/export-plugin-assets.mjs',
    assets,
  });
}

function main() {
  const args = parseArgs();
  console.log('export-plugin-assets:');
  console.log(`  source db:     ${args.db}`);
  console.log(`  output:        ${args.out}`);
  console.log(`  source commit: ${args.commit}`);
  console.log('');
  ensureDir(args.out);
  const assets = [];
  console.log('exporting baseline.json...');
  assets.push(exportBaseline(args.db, args.out));
  console.log('exporting source-feeds.json...');
  assets.push(exportSourceFeeds(args.db, args.out));
  console.log('exporting prompts/manifest.json...');
  assets.push(exportPromptsManifest(args.out));
  console.log('exporting schema/*.json...');
  for (const a of exportSchemas(args.out)) assets.push(a);
  console.log('writing manifest.json...');
  const top = writeTopLevelManifest(args.out, assets, args);
  console.log('');
  console.log(`wrote ${assets.length + 1} files to ${args.out}:`);
  for (const a of [...assets, top]) {
    console.log(`  ${a.path.padEnd(32)} ${String(a.bytes).padStart(8)} bytes  sha256=${a.sha256.slice(0, 12)}...`);
  }
}

main();
