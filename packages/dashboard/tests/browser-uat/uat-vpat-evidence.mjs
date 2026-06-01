// Real-browser UAT for the VPAT evidence-artifacts + ZIP pack + RBAC work
// shipped 2026-06-01. Self-contained: boots a fresh-DB dashboard, seeds a
// completed scan with manual-test evidence (a PNG screenshot + a PDF doc) and
// two users (admin + a `limited` role lacking reports.vpat), then drives
// Chromium to verify:
//   A. the web VPAT renders the evidence appendix (image thumbnail + doc link)
//   B. the "Download evidence pack (.zip)" button is offered
//   C. the VPAT page does not overflow horizontally on a mobile viewport
//   D. the evidence pack downloads as a real ZIP (PK magic)
//   E. RBAC: a user without reports.vpat is denied (403); admin is allowed (200)
//
// Usage:  node packages/dashboard/tests/browser-uat/uat-vpat-evidence.mjs
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const dashboardDir = path.resolve(HERE, '..', '..');
const repoRoot = path.resolve(HERE, '..', '..', '..', '..');
const TMP = path.join(HERE, '.tmp');
const config = JSON.parse(fs.readFileSync(path.join(HERE, 'uat.config.json'), 'utf8'));
const PORT = config.port;
const BASE = `http://127.0.0.1:${PORT}`;
const require = createRequire(path.join(repoRoot, 'noop.cjs'));

const ADMIN = { user: 'admin', pass: 'UatProof2026!' };
const LIMITED = { user: 'limited-exec', pass: 'UatProof2026!' };

const children = [];
const track = (c) => { children.push(c); return c; };
const killAll = () => { for (const c of children) { try { if (!c.killed) c.kill('SIGTERM'); } catch {} } };
process.on('exit', killAll);
process.on('SIGINT', () => { killAll(); process.exit(130); });
const log = (...a) => console.log('[uat]', ...a);

// 1×1 PNG + a tiny but valid PDF, written to disk so the page can load them.
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const PDF_DOC = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n', 'latin1');

function getStatus(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => { res.resume(); resolve(res.statusCode || 0); });
    req.on('error', () => resolve(0));
    req.setTimeout(2000, () => { req.destroy(); resolve(0); });
  });
}
async function waitFor(url, tries = 90) {
  for (let i = 0; i < tries; i++) {
    const c = await getStatus(url);
    if (c >= 200 && c < 500) { log(`dashboard ready (HTTP ${c})`); return true; }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}
function discoverChromium() {
  const root = '/root/.cache/ms-playwright';
  const found = [];
  if (fs.existsSync(root)) for (const d of fs.readdirSync(root)) {
    if (!d.startsWith('chromium-')) continue;
    const cand = path.join(root, d, 'chrome-linux64', 'chrome');
    if (fs.existsSync(cand)) found.push(cand);
  }
  found.sort();
  if (!found.length) throw new Error('No ms-playwright Chromium found');
  return found[found.length - 1];
}
function resolvePuppeteer() {
  for (const c of ['puppeteer-core', path.join(repoRoot, 'node_modules', 'pa11y', 'node_modules', 'puppeteer-core'), path.join(repoRoot, 'node_modules', 'puppeteer-core')]) {
    try { return require(c); } catch {}
  }
  throw new Error('puppeteer-core not resolvable');
}

const assertions = [];
function assert(name, cond, detail) {
  assertions.push({ name, pass: !!cond, detail: detail ?? null });
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? ' :: ' + detail : ''));
  if (!cond) throw new Error('ASSERTION FAILED: ' + name + (detail ? ' :: ' + detail : ''));
}

async function login(page, creds) {
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.type('input[name="username"]', creds.user);
  await page.type('input[name="password"]', creds.pass);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }),
    page.click('button[type="submit"], input[type="submit"]'),
  ]);
  return !/\/login/.test(page.url());
}

async function main() {
  // ── Fresh workspace + config ──
  log('resetting .tmp workspace');
  for (const f of fs.readdirSync(TMP)) { if (f !== '.gitignore') fs.rmSync(path.join(TMP, f), { recursive: true, force: true }); }
  fs.mkdirSync(path.join(TMP, 'reports'), { recursive: true });
  fs.mkdirSync(path.join(TMP, 'plugins'), { recursive: true });
  const dbPath = path.join(TMP, 'uat-dashboard.db');
  const uploadsEvidence = path.join(TMP, 'uploads', 'system', 'evidence');
  fs.mkdirSync(uploadsEvidence, { recursive: true });
  fs.writeFileSync(path.join(uploadsEvidence, 'screenshot.png'), PNG_1X1);
  fs.writeFileSync(path.join(uploadsEvidence, 'sr-transcript.pdf'), PDF_DOC);
  const tmpConfig = { ...config, dbPath, reportsDir: path.join(TMP, 'reports'), pluginsDir: path.join(TMP, 'plugins') };
  fs.writeFileSync(path.join(TMP, 'dashboard.config.json'), JSON.stringify(tmpConfig, null, 2));

  const chromium = discoverChromium();

  // ── Start serve ──
  const dashLog = fs.createWriteStream(path.join(TMP, 'dashboard.log'));
  const dash = track(spawn('node', [path.join(dashboardDir, 'dist', 'cli.js'), 'serve'], {
    cwd: TMP,
    env: {
      ...process.env,
      PUPPETEER_EXECUTABLE_PATH: chromium,
      DASHBOARD_PORT: String(PORT),
      DASHBOARD_SESSION_SECRET: config.sessionSecret,
      DASHBOARD_DB_PATH: dbPath,
      DASHBOARD_REPORTS_DIR: tmpConfig.reportsDir,
      DASHBOARD_PLUGINS_DIR: tmpConfig.pluginsDir,
    },
  }));
  dash.stdout.pipe(dashLog); dash.stderr.pipe(dashLog);
  log('starting dashboard serve');
  if (!(await waitFor(BASE + '/login'))) throw new Error('dashboard did not come up');

  // ── Seed via the built storage adapter (serve already migrated the DB) ──
  log('seeding scan + evidence + users');
  const { SqliteStorageAdapter } = await import(path.join(dashboardDir, 'dist', 'db', 'sqlite', 'index.js'));
  const storage = new SqliteStorageAdapter(dbPath);
  const bcrypt = require('bcrypt');
  const Database = require('better-sqlite3');
  const raw = new Database(dbPath);
  const now = new Date().toISOString();

  // admin user
  const adminId = randomUUID();
  raw.prepare('INSERT INTO dashboard_users (id, username, password_hash, role, active, created_at, active_org_id) VALUES (?,?,?,?,1,?,?)')
    .run(adminId, ADMIN.user, bcrypt.hashSync(ADMIN.pass, 12), 'admin', now, 'system');

  // a restricted GLOBAL role lacking reports.vpat + a user holding it
  raw.prepare("INSERT OR IGNORE INTO roles (id, name, description, is_system, org_id, created_at) VALUES ('limited','limited','Limited read role',1,'system',?)").run(now);
  raw.prepare("INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('limited','reports.view')").run();
  const limitedId = randomUUID();
  raw.prepare('INSERT INTO dashboard_users (id, username, password_hash, role, active, created_at, active_org_id) VALUES (?,?,?,?,1,?,?)')
    .run(limitedId, LIMITED.user, bcrypt.hashSync(LIMITED.pass, 12), 'limited', now, 'system');
  raw.close();

  // completed scan + stored report, org 'system' so both users pass org-scope
  const scanId = randomUUID();
  await storage.scans.createScan({ id: scanId, siteUrl: 'https://uat-vpat.example.com', standard: 'WCAG2AA', jurisdictions: [], createdBy: ADMIN.user, createdAt: now, orgId: 'system' });
  const report = { summary: { pagesScanned: 1, totalIssues: 1, byLevel: { error: 1, warning: 0, notice: 0 } }, pages: [{ url: 'https://uat-vpat.example.com', issueCount: 1, issues: [{ type: 'error', code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37', message: 'img missing alt', selector: 'img', context: '<img>' }] }] };
  await storage.scans.updateScan(scanId, { status: 'completed', completedAt: now, totalIssues: 1, pagesScanned: 1, jsonReport: JSON.stringify(report) });
  await storage.manualTestEvidence.addEvidence({ scanId, criterionId: '1.1.1', filePath: '/uploads/system/evidence/screenshot.png', fileName: 'screenshot.png', mimeType: 'image/png', orgId: 'system' });
  await storage.manualTestEvidence.addEvidence({ scanId, criterionId: '1.1.1', filePath: '/uploads/system/evidence/sr-transcript.pdf', fileName: 'sr-transcript.pdf', mimeType: 'application/pdf', orgId: 'system' });
  await storage.disconnect();

  // ── Drive the browser ──
  const puppeteer = resolvePuppeteer();
  const browser = await puppeteer.launch({ executablePath: chromium, headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1600 });

    assert('login as admin', await login(page, ADMIN), page.url());

    const vpatResp = await page.goto(`${BASE}/reports/${scanId}/vpat`, { waitUntil: 'networkidle0', timeout: 30000 });
    assert('E1. admin can open VPAT (200)', vpatResp.status() === 200, String(vpatResp.status()));

    const dom = await page.evaluate(() => {
      const heading = [...document.querySelectorAll('h2')].some((h) => /Manual test evidence/i.test(h.textContent || ''));
      const img = document.querySelector('.evidence-thumb img');
      const imgSrc = img ? img.getAttribute('src') : null;
      const docLink = [...document.querySelectorAll('a.evidence-doc')].map((a) => a.getAttribute('href'));
      const packBtn = [...document.querySelectorAll('a.print-btn')].some((a) => /vpat-pack\.zip$/.test(a.getAttribute('href') || ''));
      return { heading, imgSrc, docLink, packBtn };
    });
    assert('A1. evidence appendix heading present', dom.heading);
    assert('A3. thumbnail points at served upload path', /\/uploads\/system\/evidence\/screenshot\.png$/.test(dom.imgSrc || ''), dom.imgSrc);
    // The thumbnail is loading="lazy" and below the fold (correct web behaviour),
    // so assert it is actually SERVED rather than relying on naturalWidth.
    const imgServed = await page.evaluate(async (src) => {
      const r = await fetch(src, { credentials: 'include' });
      return { status: r.status, ctype: r.headers.get('content-type') };
    }, dom.imgSrc);
    assert('A2. image thumbnail is served (200, image/*)', imgServed.status === 200 && /image\//.test(imgServed.ctype || ''), JSON.stringify(imgServed));
    assert('A4. document evidence link present', dom.docLink.some((h) => /sr-transcript\.pdf$/.test(h || '')), JSON.stringify(dom.docLink));
    assert('B1. "Download evidence pack" button offered', dom.packBtn);
    // Scroll the appendix into view so the lazy thumbnail also renders for the screenshot.
    await page.evaluate(() => { const t = document.querySelector('.evidence-thumb'); if (t) t.scrollIntoView(); });
    await new Promise((r) => setTimeout(r, 600));
    await page.screenshot({ path: path.join(TMP, 'uat-vpat-desktop.png'), fullPage: true });

    // ── Secure external sharing: create → anonymous access → revoke → gone ──
    page.on('dialog', (d) => d.accept()); // auto-accept the revoke confirm()
    const hasPanel = await page.evaluate(() => !!document.getElementById('share-panel'));
    assert('F1. share panel present for authorised viewer', hasPanel);
    await page.click('[data-action="shareCreate"]');
    await page.waitForSelector('.share-link__url', { timeout: 10000 });
    const shareUrl = await page.evaluate(() => document.querySelector('.share-link__url').value);
    assert('F2. created share link is a /share/<token> URL', /\/share\/[A-Za-z0-9_-]{20,}$/.test(shareUrl || ''), shareUrl);
    const shareToken = shareUrl.split('/share/')[1];

    // Anonymous context (no admin cookie) opens the shared VPAT.
    const anonCtx = browser.createBrowserContext ? await browser.createBrowserContext() : await browser.createIncognitoBrowserContext();
    const anon = await anonCtx.newPage();
    const anonResp = await anon.goto(`${BASE}/share/${shareToken}`, { waitUntil: 'networkidle0', timeout: 30000 });
    assert('F3. anonymous viewer can open the shared VPAT (200)', anonResp.status() === 200, String(anonResp.status()));
    const anonDom = await anon.evaluate(() => ({
      site: document.body.textContent.includes('uat-vpat.example.com'),
      tokenPdf: [...document.querySelectorAll('a.print-btn')].some((a) => /\/share\/.+\/vpat\.pdf$/.test(a.getAttribute('href') || '')),
      noInternal: !document.body.innerHTML.includes('/api/v1/export/scans/'),
      noPanel: !document.getElementById('share-panel'),
    }));
    assert('F4. shared VPAT shows the report + token download link, no internal/admin surface', anonDom.site && anonDom.tokenPdf && anonDom.noInternal && anonDom.noPanel, JSON.stringify(anonDom));
    const anonZip = await anon.evaluate(async (u) => { const r = await fetch(u); const b = new Uint8Array(await r.arrayBuffer()); return { status: r.status, magic: String.fromCharCode(b[0], b[1]) }; }, `${BASE}/share/${shareToken}/evidence-pack.zip`);
    assert('F5. anonymous viewer can download the evidence pack', anonZip.status === 200 && anonZip.magic === 'PK', JSON.stringify(anonZip));

    // Revoke from the admin panel → the link is gone.
    await page.click('[data-action="shareRevoke"]');
    await new Promise((r) => setTimeout(r, 800));
    const afterRevoke = await anon.goto(`${BASE}/share/${shareToken}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    assert('F6. revoked link is no longer available (410)', afterRevoke.status() === 410, String(afterRevoke.status()));
    assert('F7. revoked link shows the "no longer available" page', /no longer available/i.test(await anon.content()));
    await anonCtx.close();

    // ── Mobile overflow ──
    await page.setViewport({ width: 390, height: 844, isMobile: true });
    await page.reload({ waitUntil: 'networkidle0' });
    const mob = await page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth }));
    assert('C1. no horizontal overflow on mobile (390px)', mob.scrollW <= mob.innerW + 2, `scrollW=${mob.scrollW} innerW=${mob.innerW}`);
    await page.screenshot({ path: path.join(TMP, 'uat-vpat-mobile.png'), fullPage: true });

    // ── Pack download (fetch in page context, carrying the session cookie) ──
    const pack = await page.evaluate(async (url) => {
      const r = await fetch(url, { credentials: 'include' });
      const buf = new Uint8Array(await r.arrayBuffer());
      return { status: r.status, ctype: r.headers.get('content-type'), magic: String.fromCharCode(buf[0], buf[1]), len: buf.length };
    }, `${BASE}/api/v1/export/scans/${scanId}/vpat-pack.zip`);
    assert('D1. evidence pack downloads (200)', pack.status === 200, JSON.stringify(pack));
    assert('D2. pack is a ZIP (application/zip + PK magic)', /application\/zip/.test(pack.ctype || '') && pack.magic === 'PK', JSON.stringify(pack));

    // ── RBAC: a user without reports.vpat is denied ──
    // Isolated context so it does NOT inherit the admin session cookie.
    const ctx2 = browser.createBrowserContext
      ? await browser.createBrowserContext()
      : await browser.createIncognitoBrowserContext();
    const page2 = await ctx2.newPage();
    assert('login as limited user', await login(page2, LIMITED), page2.url());
    const denied = await page2.goto(`${BASE}/reports/${scanId}/vpat`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    assert('E2. user WITHOUT reports.vpat is denied VPAT (403)', denied.status() === 403, String(denied.status()));
    const deniedPdf = await page2.goto(`${BASE}/api/v1/export/scans/${scanId}/vpat.pdf`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    assert('E3. same user denied VPAT PDF export (403)', deniedPdf.status() === 403, String(deniedPdf.status()));

    console.log('\nUAT GREEN — ' + assertions.filter((a) => a.pass).length + '/' + assertions.length + ' assertions passed');
  } finally {
    await browser.close();
  }
}

main().then(() => { killAll(); setTimeout(() => process.exit(0), 500); })
  .catch((err) => { console.error('[uat] ERROR', err.message); killAll(); setTimeout(() => process.exit(1), 500); });
