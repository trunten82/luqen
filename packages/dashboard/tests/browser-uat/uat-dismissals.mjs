// Real-browser UAT for the false-positive dismissal UI (Phase 89, FP-14 / FP-16).
//
// Self-contained local mode: boots a fresh-DB dashboard from the BUILT dist/, seeds a
// Fabrikam test org, a global admin and one completed scan, then drives Chromium.
// Plan 04 implements local mode and the `tracer` scenario; later plans add scenarios.
//
// Usage:
//   npm run build   (this script runs dist/, so build first)
//   node tests/browser-uat/uat-dismissals.mjs [--mode local|remote] [--expect dark|granted]
//                                             [--scenario <name>|all]
//
// Output: one `PASS <scenario>: <check>` or `FAIL <scenario>: <check> :: <detail>` line per
// check; exit non-zero on the first FAIL. Browser launches and waits use 90s+ timeouts.
import { spawn } from 'node:child_process';
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

const WAIT = 90000;
const ADMIN = { user: 'admin', pass: 'UatProof2026!' };
const SITE = 'https://dismiss-uat.example.test';
const HERO = { code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37', selector: '#hero-img', message: 'Image is missing a text alternative' };
const NAV = { code: 'WCAG2AA.Principle2.Guideline2_4.2_4_4.H77', selector: '#nav-link', message: 'Link purpose is not clear' };

// ── Arguments ──────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { mode: 'local', expect: 'dark', scenario: 'all' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--mode') out.mode = argv[++i];
    else if (a === '--expect') out.expect = argv[++i];
    else if (a === '--scenario') out.scenario = argv[++i];
    else { console.error(`unknown argument ${a}`); process.exit(2); }
  }
  if (!['local', 'remote'].includes(out.mode)) { console.error('--mode must be local or remote'); process.exit(2); }
  if (!['dark', 'granted'].includes(out.expect)) { console.error('--expect must be dark or granted'); process.exit(2); }
  return out;
}
const args = parseArgs(process.argv.slice(2));

// ── Process plumbing ───────────────────────────────────────────────────
const children = [];
const track = (c) => { children.push(c); return c; };
const killAll = () => { for (const c of children) { try { if (!c.killed) c.kill('SIGTERM'); } catch { /* already gone */ } } };
process.on('exit', killAll);
process.on('SIGINT', () => { killAll(); process.exit(130); });
const log = (...a) => console.error('[uat]', ...a);

function getStatus(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => { res.resume(); resolve(res.statusCode || 0); });
    req.on('error', () => resolve(0));
    req.setTimeout(2000, () => { req.destroy(); resolve(0); });
  });
}
async function waitFor(url, tries = 90) {
  for (let i = 0; i < tries; i += 1) {
    const c = await getStatus(url);
    if (c >= 200 && c < 500) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}
function discoverChromium() {
  const root = '/root/.cache/ms-playwright';
  const found = [];
  if (fs.existsSync(root)) {
    for (const d of fs.readdirSync(root)) {
      if (!d.startsWith('chromium-')) continue;
      const cand = path.join(root, d, 'chrome-linux64', 'chrome');
      if (fs.existsSync(cand)) found.push(cand);
    }
  }
  found.sort();
  if (!found.length) throw new Error('No ms-playwright Chromium found');
  return found[found.length - 1];
}
function resolvePuppeteer() {
  for (const c of ['puppeteer-core', path.join(repoRoot, 'node_modules', 'pa11y', 'node_modules', 'puppeteer-core'), path.join(repoRoot, 'node_modules', 'puppeteer-core')]) {
    try { return require(c); } catch { /* try the next candidate */ }
  }
  throw new Error('puppeteer-core not resolvable');
}

// ── Check reporting: exit non-zero on the first FAIL ───────────────────
let checks = 0;
function check(scenario, name, cond, detail) {
  checks += 1;
  if (cond) { console.log(`PASS ${scenario}: ${name}`); return; }
  console.log(`FAIL ${scenario}: ${name}${detail ? ` :: ${detail}` : ''}`);
  throw new Error(`FAIL ${scenario}: ${name}`);
}

async function login(page, creds) {
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded', timeout: WAIT });
  await page.type('input[name="username"]', creds.user);
  await page.type('input[name="password"]', creds.pass);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: WAIT }),
    page.click('button[type="submit"], input[type="submit"]'),
  ]);
  return !/\/login/.test(page.url());
}

// ── Local-mode world: a fresh dashboard on dist/ ──────────────────────
async function bootLocal() {
  log('resetting .tmp workspace');
  fs.mkdirSync(TMP, { recursive: true });
  for (const f of fs.readdirSync(TMP)) { if (f !== '.gitignore') fs.rmSync(path.join(TMP, f), { recursive: true, force: true }); }
  fs.mkdirSync(path.join(TMP, 'reports'), { recursive: true });
  fs.mkdirSync(path.join(TMP, 'plugins'), { recursive: true });
  const dbPath = path.join(TMP, 'uat-dashboard.db');
  const tmpConfig = { ...config, dbPath, reportsDir: path.join(TMP, 'reports'), pluginsDir: path.join(TMP, 'plugins') };
  fs.writeFileSync(path.join(TMP, 'dashboard.config.json'), JSON.stringify(tmpConfig, null, 2));

  const chromium = discoverChromium();
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
  if (!(await waitFor(BASE + '/login'))) throw new Error('dashboard did not come up (see .tmp/dashboard.log)');

  log('seeding org, admin and one completed scan');
  const { SqliteStorageAdapter } = await import(path.join(dashboardDir, 'dist', 'db', 'sqlite', 'index.js'));
  const storage = new SqliteStorageAdapter(dbPath);
  const bcrypt = require('bcrypt');
  const Database = require('better-sqlite3');
  const raw = new Database(dbPath);
  const now = new Date().toISOString();
  const orgId = randomUUID();
  raw.prepare('INSERT INTO organizations (id, name, slug, created_at) VALUES (?,?,?,?)').run(orgId, 'Fabrikam', 'fabrikam', now);
  const adminId = randomUUID();
  raw.prepare('INSERT INTO dashboard_users (id, username, password_hash, role, active, created_at, active_org_id) VALUES (?,?,?,?,1,?,?)')
    .run(adminId, ADMIN.user, bcrypt.hashSync(ADMIN.pass, 12), 'admin', now, orgId);
  raw.prepare("INSERT INTO org_members (org_id, user_id, role, joined_at) VALUES (?, ?, 'admin', ?)").run(orgId, adminId, now);
  raw.close();

  const scanId = randomUUID();
  await storage.scans.createScan({ id: scanId, siteUrl: SITE, standard: 'WCAG2AA', jurisdictions: [], createdBy: ADMIN.user, createdAt: now, orgId });
  const issue = (i) => ({ type: 'error', code: i.code, message: i.message, selector: i.selector, context: `<span>${i.selector}</span>` });
  const report = {
    summary: { pagesScanned: 2, totalIssues: 3, byLevel: { error: 3, warning: 0, notice: 0 } },
    pages: [
      { url: `${SITE}/`, issueCount: 2, issues: [issue(HERO), issue(NAV)] },
      { url: `${SITE}/about`, issueCount: 1, issues: [issue(HERO)] },
    ],
  };
  await storage.scans.updateScan(scanId, { status: 'completed', completedAt: now, totalIssues: 3, errors: 3, pagesScanned: 2, jsonReport: JSON.stringify(report) });
  await storage.disconnect();
  return { scanId, orgId };
}

// ── Scenarios ──────────────────────────────────────────────────────────
const SCENARIOS = {
  /** One page issue, end to end: Dismiss -> dialog -> preview -> reason -> confirm -> reload -> gone. */
  async tracer({ page, scanId }) {
    const S = 'tracer';
    check(S, 'login as global admin', await login(page, ADMIN), page.url());
    await page.goto(`${BASE}/reports/${scanId}`, { waitUntil: 'networkidle0', timeout: WAIT });

    await page.click('#tab-issues');
    await page.waitForSelector('#panel-issues:not(.rpt-tab-panel--hidden)', { timeout: WAIT });
    // Expand the criterion group that holds the hero finding with a real click on its header,
    // then click the page issue's Dismiss button the way a user would.
    const findButton = () => page.evaluateHandle((sel) => [...document.querySelectorAll('#panel-issues .rpt-dismiss-btn')].find((b) => b.getAttribute('data-selector') === sel) || null, HERO.selector);
    let button = (await findButton()).asElement();
    check(S, 'a Dismiss button is rendered for the page issue', button !== null);
    const header = (await page.evaluateHandle((el) => el.closest('.rpt-group').querySelector('.rpt-group__header'), button)).asElement();
    await header.click();
    await page.waitForFunction((el) => !el.closest('.rpt-group').classList.contains('rpt-group--collapsed'), {}, button);
    button = (await findButton()).asElement();
    await button.click();
    await page.waitForSelector('#issue-dismiss-dialog[open]', { timeout: WAIT });
    check(S, 'the dialog opens', true);

    const focusId = await page.evaluate(() => document.activeElement && document.activeElement.id);
    check(S, 'focus lands in the reason textarea', focusId === 'issue-dismiss-reason', String(focusId));

    await page.waitForFunction(
      () => document.querySelector('[data-preview="occurrences"]').textContent === '2' && document.querySelector('[data-preview="pages"]').textContent === '2',
      { timeout: WAIT },
    );
    check(S, 'the preview shows 2 occurrences on 2 pages', true);

    // Evidence for a human reader: the dialog as rendered (gitignored .tmp).
    await page.screenshot({ path: path.join(TMP, 'uat-dismissals-dialog.png') });

    const disabledBefore = await page.$eval('[data-action="rptDismissConfirm"]', (b) => b.disabled);
    check(S, 'confirm is disabled before a reason is typed', disabledBefore === true);

    await page.type('#issue-dismiss-reason', 'The alternative text is supplied by a script after load.');
    await page.waitForFunction(() => !document.querySelector('[data-action="rptDismissConfirm"]').disabled, { timeout: WAIT });
    check(S, 'confirm enables once a reason is typed', true);

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: WAIT }),
      page.click('[data-action="rptDismissConfirm"]'),
    ]);
    await page.waitForSelector('#toast-container .toast', { timeout: WAIT });
    const toastText = await page.$eval('#toast-container .toast', (t) => t.textContent || '');
    check(S, 'the success toast is shown after the reload', /Finding dismissed/.test(toastText), toastText);

    const after = await page.evaluate((sels) => {
      const panel = document.getElementById('panel-issues');
      const text = panel ? panel.textContent || '' : '';
      return { hero: text.includes(sels.hero), nav: text.includes(sels.nav) };
    }, { hero: HERO.selector, nav: NAV.selector });
    check(S, 'the dismissed finding is gone after reload', after.hero === false, JSON.stringify(after));
    check(S, 'the other finding is still listed', after.nav === true, JSON.stringify(after));
  },
};

// ── Main ───────────────────────────────────────────────────────────────
async function main() {
  if (args.mode === 'remote') {
    console.error('remote mode is not implemented yet (Plans 07 and 10 add it)');
    process.exit(2);
  }
  const names = args.scenario === 'all' ? Object.keys(SCENARIOS) : [args.scenario];
  for (const n of names) if (!SCENARIOS[n]) { console.error(`unknown scenario ${n}`); process.exit(2); }

  const world = await bootLocal();
  const puppeteer = resolvePuppeteer();
  const browser = await puppeteer.launch({ executablePath: discoverChromium(), headless: 'new', protocolTimeout: WAIT, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(WAIT);
    await page.setViewport({ width: 1280, height: 1600 });
    for (const n of names) await SCENARIOS[n]({ page, browser, ...world });
    console.log(`UAT GREEN: ${checks} checks`);
  } finally {
    await browser.close();
  }
}

main().then(() => { killAll(); setTimeout(() => process.exit(0), 500); })
  .catch((err) => { console.error('[uat] ERROR', err.message); killAll(); setTimeout(() => process.exit(1), 500); });
