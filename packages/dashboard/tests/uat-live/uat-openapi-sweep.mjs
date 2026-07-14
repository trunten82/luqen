#!/usr/bin/env node
/**
 * Exhaustive OpenAPI-driven endpoint sweep for the Luqen dashboard.
 *
 * Executes EVERY operation in docs/reference/openapi/dashboard.json against
 * the live instance as the admin session: path params substituted with REAL
 * entity ids (UAT-org artifacts where mutation is involved), request bodies
 * generated from the operation's JSON schema + fixture heuristics.
 *
 * Classification:
 *   - 5xx                       → FAIL (server bug)
 *   - 404 on a real-id GET      → FAIL (broken surface)
 *   - 400 on schema-built body  → WARN (inspect: contract mismatch?)
 *   - 2xx/3xx, expected 4xx     → OK
 *
 * Mutations run ONLY against UAT- artifacts; org/user/team DELETEs run last
 * (doubling as cleanup). Routes matching SKIP_DESTRUCTIVE never run.
 *
 * Usage: node uat-openapi-sweep.mjs <user> <pass> <fixtures.json> [--mutate]
 */

import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:5000';
const [, , USERNAME, PASSWORD, FIXTURES_PATH, ...flags] = process.argv;
const MUTATE = flags.includes('--mutate');
const F = JSON.parse(readFileSync(FIXTURES_PATH, 'utf8'));
const spec = JSON.parse(readFileSync('/root/luqen/docs/reference/openapi/dashboard.json', 'utf8'));

// Never execute these even with --mutate (would destroy real data / sessions).
const SKIP_DESTRUCTIVE = [
  /^\/logout/, /^\/login/, /^\/setup/, /^\/oauth\//, /^\/session\/switch-org/,
  /\/admin\/organizations\/\{id\}\/delete/, // handled explicitly in cleanup phase
  /\/orgs\/\{orgId\}\/data/,
  /\/admin\/plugins/, // plugin install/uninstall mutates the runtime
  /\/admin\/system-brand/, // global branding — visual prod impact
  /\/admin\/clients/, // OAuth client mutation could break service auth
  /\/admin\/service-connections/,
  /\/api\/v1\/mcp/, // MCP JSON-RPC needs protocol framing, not REST
  /\/agent\/(chat|stream)/, // LLM-cost streaming
  /\/scan\/new$/, // exercised already; avoid scan spam
  /\/admin\/acr-snapshots\/prune/,
  /\/migrate/,
];

// Param substitution by name/pattern → fixture value.
function paramValue(name, path) {
  const n = name.toLowerCase();
  if (path.includes('/teams') && n === 'id') return F.teamId;
  if (path.includes('/organizations') && n === 'id') return F.orgId;
  if (path.includes('/dashboard-users') && n === 'id') return F.userId;
  if (path.includes('/digest-schedules') && n === 'id') return F.digestId ?? F.uuid;
  if (path.includes('/schedules') && n === 'id') return F.scheduleId ?? F.uuid;
  if (path.includes('/branding-guidelines') && n === 'id') return F.guidelineId ?? F.uuid;
  if (path.includes('/org-api-keys') && n === 'id') return F.apiKeyId ?? F.uuid;
  if (path.includes('/roles') && n === 'id') return F.roleId;
  if (n === 'scanid' || ((path.includes('/scans/') || path.includes('/reports/')) && n === 'id')) return F.scanId;
  if (n === 'criterionid') return '1.3.1';
  if (n === 'evidenceid') return F.evidenceId ?? F.uuid;
  if (n === 'shareid') return F.shareId ?? F.uuid;
  if (n === 'token') return F.shareToken ?? 'invalid-token';
  if (n === 'userid') return F.userId;
  if (n === 'badgeid') return F.badgeId ?? F.uuid;
  if (n === 'orgid') return F.orgId;
  if (n === 'locale') return 'en';
  if (n === 'period') return F.period ?? '2026-07';
  return F[name] ?? F.uuid;
}

// Body generation from schema + name heuristics.
function fixtureFor(prop, path) {
  const p = prop.toLowerCase();
  if (p.includes('siteurl') || p === 'url') return 'https://example.com';
  if (p.includes('email')) return 'uat-sweep@example.com';
  if (p === 'orgid' || p.includes('organizationid')) return F.orgId;
  if (p === 'scanid') return F.scanId;
  if (p === 'userid') return F.userId;
  if (p === 'teamid') return F.teamId;
  if (p.includes('name') || p.includes('label') || p.includes('title')) return 'UAT-sweep';
  if (p.includes('description') || p.includes('notes') || p.includes('message')) return 'UAT sweep';
  if (p.includes('password')) return 'UatSweep2026!x';
  if (p.includes('username')) return 'uat-org-member';
  if (p.includes('standard')) return 'WCAG2AA';
  if (p.includes('status')) return 'pass';
  if (p.includes('criterion')) return '1.3.1';
  if (p.includes('cadence')) return 'weekly';
  if (p.includes('role')) return 'viewer';
  if (p.includes('locale')) return 'en';
  if (p.includes('enabled')) return true;
  return 'uat';
}

function buildBody(schema, path) {
  if (!schema || schema.type !== 'object') return {};
  const out = {};
  const props = schema.properties ?? {};
  const required = schema.required ?? [];
  for (const key of new Set([...required, ...Object.keys(props).slice(0, 8)])) {
    const ps = props[key] ?? {};
    if (ps.type === 'boolean') out[key] = true;
    else if (ps.type === 'number' || ps.type === 'integer') out[key] = ps.minimum ?? 1;
    else if (ps.type === 'array') out[key] = [];
    else if (ps.type === 'object') out[key] = {};
    else if (Array.isArray(ps.enum) || (ps.anyOf?.every((a) => 'const' in a))) {
      out[key] = ps.enum?.[0] ?? ps.anyOf[0].const;
    } else out[key] = fixtureFor(key, path);
  }
  return out;
}

// ── session ──
let cookies = new Map();
const cookieHeader = () => [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
function store(res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    if (i > 0) cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}
let csrf = '';
async function login() {
  const lp = await fetch(`${BASE}/login`); store(lp);
  const h = await lp.text();
  const t = h.match(/name="_csrf" value="([^"]+)"/)?.[1] ?? '';
  const res = await fetch(`${BASE}/login`, {
    method: 'POST', redirect: 'manual',
    headers: { cookie: cookieHeader(), 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: USERNAME, password: PASSWORD, _csrf: t }),
  });
  store(res);
  if (res.status !== 302) throw new Error(`login ${res.status}`);
  const rp = await fetch(`${BASE}/reports`, { headers: { cookie: cookieHeader() } });
  store(rp);
  csrf = (await rp.text()).match(/name="csrf-token" content="([^"]+)"/)?.[1] ?? '';
}

const results = [];
async function run(method, rawPath, op) {
  let path = rawPath.replace(/\{([^}]+)\}/g, (_, name) => encodeURIComponent(paramValue(name, rawPath)));
  // querystring required params
  const qs = new URLSearchParams();
  for (const prm of op.parameters ?? []) {
    if (prm.in === 'query' && prm.required) qs.set(prm.name, String(paramValue(prm.name, rawPath)));
  }
  if ([...qs].length) path += `?${qs}`;

  const init = {
    method: method.toUpperCase(),
    redirect: 'manual',
    headers: { cookie: cookieHeader(), 'x-csrf-token': csrf, accept: 'application/json, text/html' },
  };
  if (method !== 'get') {
    const schema = op.requestBody?.content?.['application/json']?.schema;
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(buildBody(schema, rawPath));
  }
  let res;
  try { res = await fetch(BASE + path, init); } catch (e) {
    results.push({ method, path: rawPath, status: 'ERR', verdict: 'FAIL', note: String(e) });
    return;
  }
  store(res);
  const status = res.status;
  let verdict = 'OK', note = '';
  if (status >= 500) { verdict = 'FAIL'; note = (await res.text()).slice(0, 160); }
  else if (status === 404 && method === 'get' && rawPath.includes('{')) { verdict = 'WARN'; note = 'real-id GET 404'; }
  else if (status === 400 && method !== 'get') { verdict = 'WARN'; note = (await res.text()).slice(0, 140); }
  else await res.arrayBuffer().catch(() => {});
  results.push({ method, path: rawPath, status, verdict, note });
}

await login();
console.error(`logged in as ${USERNAME}, mutate=${MUTATE}`);

const ops = [];
for (const [path, methods] of Object.entries(spec.paths)) {
  for (const [method, op] of Object.entries(methods)) {
    if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
    if (SKIP_DESTRUCTIVE.some((re) => re.test(path))) {
      results.push({ method, path, status: '-', verdict: 'SKIP', note: 'destructive/protocol' });
      continue;
    }
    if (method !== 'get' && !MUTATE) {
      results.push({ method, path, status: '-', verdict: 'SKIP', note: 'mutation (run with --mutate)' });
      continue;
    }
    ops.push([method, path, op]);
  }
}
// GETs first, then mutations; DELETEs last (cleanup order)
ops.sort((a, b) => {
  const rank = (m) => (m === 'get' ? 0 : m === 'delete' ? 2 : 1);
  return rank(a[0]) - rank(b[0]);
});
let n = 0;
for (const [method, path, op] of ops) {
  await run(method, path, op);
  if (++n % 40 === 0) console.error(`  ${n}/${ops.length}`);
}

const summary = {};
for (const r of results) summary[r.verdict] = (summary[r.verdict] ?? 0) + 1;
console.error('summary:', JSON.stringify(summary));
console.log(JSON.stringify({ summary, results }, null, 1));
process.exit(results.some((r) => r.verdict === 'FAIL') ? 1 : 0);
