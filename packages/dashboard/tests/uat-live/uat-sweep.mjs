#!/usr/bin/env node
/**
 * Live full-surface UAT sweep for the Luqen dashboard.
 *
 * Logs in as a persona, BFS-crawls every internal link reachable from the
 * home page + sidebar, and additionally exercises every per-scan surface
 * (report page, print, vpat, PDF/xlsx/zip exports, badges) for a sample of
 * real scans across ALL orgs. Flags:
 *   - any HTTP 5xx
 *   - 404/403 on pages that were LINKED from a rendered page (broken link /
 *     permission mismatch — the "sidebar shows it but route denies it" class)
 *   - error signatures in 200 HTML (Missing helper, raw i18n key ids,
 *     stack traces)
 *
 * Read-only: GET requests only. Run ON the live box against localhost.
 * Usage: node uat-sweep.mjs <username> <password> [label]
 */

const BASE = 'http://localhost:5000';
const [, , USERNAME, PASSWORD, LABEL = 'persona'] = process.argv;
if (!USERNAME || !PASSWORD) {
  console.error('usage: node uat-sweep.mjs <username> <password> [label]');
  process.exit(2);
}

const MAX_PAGES = 400;
const results = { label: LABEL, visited: 0, failures: [], warnings: [] };

// ── cookie jar ──────────────────────────────────────────────────────────────
let cookies = new Map();
function cookieHeader() {
  return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}
function storeCookies(res) {
  const set = res.headers.getSetCookie?.() ?? [];
  for (const c of set) {
    const [pair] = c.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

async function get(path, redirect = 'manual') {
  const res = await fetch(BASE + path, {
    redirect,
    headers: { cookie: cookieHeader(), accept: '*/*' },
  });
  storeCookies(res);
  return res;
}

// ── login ───────────────────────────────────────────────────────────────────
async function login() {
  const page = await get('/login', 'follow');
  const html = await page.text();
  const csrf = html.match(/name="_csrf" value="([^"]+)"/)?.[1] ?? '';
  const res = await fetch(BASE + '/login', {
    method: 'POST',
    redirect: 'manual',
    headers: {
      cookie: cookieHeader(),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ username: USERNAME, password: PASSWORD, _csrf: csrf }),
  });
  storeCookies(res);
  if (res.status !== 302) throw new Error(`login failed: HTTP ${res.status}`);
  const home = await get('/', 'manual');
  if (home.status >= 300 && (home.headers.get('location') ?? '').includes('/login')) {
    throw new Error('login did not stick (redirected back to /login)');
  }
}

// ── error signatures in rendered HTML ───────────────────────────────────────
const HTML_ERROR_SIGNATURES = [
  /Missing helper/i,
  /helperMissing/,
  /<pre>[^<]*\bat\s+\S+\.js:\d+/, // leaked stack trace
  // raw i18n key ids leaking into visible text, e.g. >admin.org.brandingMode.title<
  />\s*(?:admin|common|nav|reportDetail|exposure|share|vpat|trends|reportCompare|agent|rescore|brandOverview)\.[a-zA-Z][\w.]+\s*</,
];

function scanHtml(path, html) {
  for (const sig of HTML_ERROR_SIGNATURES) {
    const m = html.match(sig);
    if (m) {
      results.failures.push({ path, status: 200, problem: `error signature in HTML: ${String(m[0]).slice(0, 80)}` });
      return;
    }
  }
}

// ── link extraction ─────────────────────────────────────────────────────────
const SKIP_LINK = [
  /^\/logout/, /^\/login/, /^https?:\/\//, /^mailto:/, /^#/, /^javascript:/,
  /\/delete\b/, /\/revoke\b/, // never follow destructive hrefs even if GET
];
function extractLinks(html) {
  const out = new Set();
  for (const m of html.matchAll(/href="([^"#?]+[^"]*)"/g)) {
    const href = m[1];
    if (SKIP_LINK.some((re) => re.test(href))) continue;
    if (!href.startsWith('/')) continue;
    out.add(href);
  }
  return out;
}

// ── BFS crawl ───────────────────────────────────────────────────────────────
async function crawl(seeds) {
  const queue = [...seeds.map((s) => ({ path: s, linkedFrom: '(seed)' }))];
  const seen = new Set(seeds);
  while (queue.length > 0 && results.visited < MAX_PAGES) {
    const { path, linkedFrom } = queue.shift();
    let res;
    try {
      res = await get(path);
    } catch (err) {
      results.failures.push({ path, status: 'ERR', problem: String(err), linkedFrom });
      continue;
    }
    results.visited++;
    const ct = res.headers.get('content-type') ?? '';
    if (res.status >= 500) {
      results.failures.push({ path, status: res.status, problem: '5xx', linkedFrom });
    } else if ((res.status === 404 || res.status === 403) && linkedFrom !== '(seed)') {
      results.failures.push({ path, status: res.status, problem: 'linked page denied/missing', linkedFrom });
    } else if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location') ?? '';
      if (loc.includes('/login')) {
        results.failures.push({ path, status: res.status, problem: 'bounced to login (session/permission gap)', linkedFrom });
      }
    } else if (res.status === 200 && ct.includes('text/html')) {
      const html = await res.text();
      scanHtml(path, html);
      for (const link of extractLinks(html)) {
        if (!seen.has(link)) {
          seen.add(link);
          queue.push({ path: link, linkedFrom: path });
        }
      }
      continue; // body consumed
    }
    // drain body so keep-alive sockets recycle
    await res.arrayBuffer().catch(() => {});
  }
}

// ── per-scan surfaces ───────────────────────────────────────────────────────
async function scanSurfaces(scanIds) {
  const surfaces = (id) => [
    `/reports/${id}`,
    `/reports/${id}/print`,
    `/reports/${id}/vpat`,
    `/api/v1/export/scans/${id}/issues.xlsx`,
    `/api/v1/export/scans/${id}/report.pdf`,
    `/api/v1/export/scans/${id}/vpat.pdf`,
    `/api/v1/export/scans/${id}/vpat-pack.zip`,
    `/api/v1/badge/${id}.svg`,
  ];
  for (const id of scanIds) {
    for (const path of surfaces(id)) {
      let res;
      try {
        res = await get(path);
      } catch (err) {
        results.failures.push({ path, status: 'ERR', problem: String(err) });
        continue;
      }
      results.visited++;
      const ct = res.headers.get('content-type') ?? '';
      if (res.status >= 500) {
        results.failures.push({ path, status: res.status, problem: '5xx on scan surface' });
      } else if (res.status === 404 && !path.includes('badge')) {
        // These scans are COMPLETED with report data — 404 means a broken surface.
        results.failures.push({ path, status: 404, problem: 'export/report surface 404 for a completed scan' });
      } else if (res.status === 200 && ct.includes('text/html')) {
        scanHtml(path, await res.text());
        continue;
      }
      await res.arrayBuffer().catch(() => {});
    }
  }
}

// ── main ────────────────────────────────────────────────────────────────────
await login();
console.error(`[${LABEL}] logged in as ${USERNAME}`);

await crawl(['/', '/reports', '/trends', '/fleet', '/scan/new', '/compare']);
console.error(`[${LABEL}] crawl done: ${results.visited} URLs`);

// completed scans with report data, newest per org (up to 12 total)
const scanIdsRaw = process.env.SCAN_IDS ?? '';
const scanIds = scanIdsRaw.split(',').map((s) => s.trim()).filter(Boolean);
if (scanIds.length > 0) {
  await scanSurfaces(scanIds);
  console.error(`[${LABEL}] scan surfaces done (${scanIds.length} scans)`);
}

console.log(JSON.stringify(results, null, 1));
process.exit(results.failures.length > 0 ? 1 : 0);
