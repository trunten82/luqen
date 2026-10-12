// Shared plumbing for the false-positive dismissal UAT (Phase 89, FP-14..16).
//
// Everything here is mode-agnostic: it takes a base URL and credentials as arguments, so the
// same scenario code drives a locally booted dashboard (local, remote-selftest) and, for the
// remote path, a deployed one. Nothing in this file prints a URL, credential or id: check()
// output carries scenario and check NAMES, and its detail text is withheld in remote mode.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BROWSER_UAT_DIR = path.resolve(HERE, '..');
export const DASHBOARD_DIR = path.resolve(HERE, '..', '..', '..');
export const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..', '..');
export const TMP = path.join(BROWSER_UAT_DIR, '.tmp');
export const SHOTS = path.join(TMP, 'shots');
export const WAIT = 90000;
export const DESKTOP = { width: 1280, height: 800 };
export const PHONE = { width: 375, height: 812, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

const require = createRequire(path.join(REPO_ROOT, 'noop.cjs'));
export const requireFromRepo = (name) => require(name);

// ── Child processes ────────────────────────────────────────────────────
const children = [];
export const track = (c) => { children.push(c); return c; };
export function killAll() {
  for (const c of children) { try { if (!c.killed) c.kill('SIGTERM'); } catch { /* already gone */ } }
  children.length = 0;
}
export const log = (...a) => console.error('[uat]', ...a);

// ── Check reporting: exit non-zero on the first FAIL ───────────────────
const state = { checks: 0, withholdDetail: false, keepGoing: false, failures: 0 };
export function setWithholdDetail(on) { state.withholdDetail = on; }
export function checkCount() { return state.checks; }
/** Local break-tests only: report every FAIL instead of stopping at the first (the run still exits 1). */
export function setKeepGoing(on) { state.keepGoing = on; }
export function failureCount() { return state.failures; }

export function check(scenario, name, cond, detail) {
  state.checks += 1;
  if (cond) { console.log(`PASS ${scenario}: ${name}`); return; }
  const shown = detail && !state.withholdDetail ? ` :: ${detail}` : '';
  console.log(`FAIL ${scenario}: ${name}${shown}`);
  state.failures += 1;
  if (state.keepGoing) return;
  throw new Error(`FAIL ${scenario}: ${name}`);
}

// ── HTTP + browser discovery ───────────────────────────────────────────
function getStatus(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => { res.resume(); resolve(res.statusCode || 0); });
    req.on('error', () => resolve(0));
    req.setTimeout(2000, () => { req.destroy(); resolve(0); });
  });
}
export async function waitFor(url, tries = 90) {
  for (let i = 0; i < tries; i += 1) {
    const c = await getStatus(url);
    if (c >= 200 && c < 500) return true;
    await sleep(1000);
  }
  return false;
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function discoverChromium() {
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
export function resolvePuppeteer() {
  for (const c of ['puppeteer-core', path.join(REPO_ROOT, 'node_modules', 'pa11y', 'node_modules', 'puppeteer-core'), path.join(REPO_ROOT, 'node_modules', 'puppeteer-core')]) {
    try { return require(c); } catch { /* try the next candidate */ }
  }
  throw new Error('puppeteer-core not resolvable');
}

// ── Browser helpers ────────────────────────────────────────────────────
export async function login(page, base, creds) {
  await page.goto(base + '/login', { waitUntil: 'domcontentloaded', timeout: WAIT });
  await page.type('input[name="username"]', creds.user);
  await page.type('input[name="password"]', creds.pass);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: WAIT }),
    page.click('button[type="submit"], input[type="submit"]'),
  ]);
  return !/\/login/.test(page.url());
}

/** A fresh isolated browser context, a page in it, and (optionally) a logged-in session. */
export async function newPersonaPage(browser, base, creds, viewport = DESKTOP) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.setDefaultTimeout(WAIT);
  await page.setViewport(viewport);
  const ok = creds ? await login(page, base, creds) : true;
  return { context, page, ok };
}

export async function openReport(page, base, scanId, tab) {
  await page.goto(`${base}/reports/${scanId}`, { waitUntil: 'networkidle0', timeout: WAIT });
  if (tab) await showTab(page, tab);
}

export async function showTab(page, tab) {
  await page.click(`#tab-${tab}`);
  await page.waitForSelector(`#panel-${tab}:not(.rpt-tab-panel--hidden)`, { timeout: WAIT });
}

/** Fetch from inside the page so the session cookie rides along. Returns {status, text}. */
export async function pageFetch(page, method, url, body) {
  return page.evaluate(async (m, u, b) => {
    const meta = document.querySelector('meta[name="csrf-token"]');
    const res = await fetch(u, {
      method: m,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': meta ? meta.getAttribute('content') || '' : '' },
      ...(b === undefined ? {} : { body: JSON.stringify(b) }),
    });
    return { status: res.status, text: await res.text() };
  }, method, url, body);
}

export function jsonOf(res) {
  try { return JSON.parse(res.text); } catch { return null; }
}

export async function shot(page, name) {
  if (state.withholdDetail) return null; // remote mode writes no screenshots (customer content)
  fs.mkdirSync(SHOTS, { recursive: true });
  const file = path.join(SHOTS, `${name}.png`);
  await sleep(350); // let 0.15s transitions (marker rotation, toast fade) finish before the picture
  await page.screenshot({ path: file });
  return file;
}

/** No horizontal page scroll (a 2px tolerance for sub-pixel rounding). */
export async function horizontalOverflow(page) {
  return page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth }));
}

/** The Dismiss button of a finding, by selector text, on a given panel. null when absent. */
export async function dismissButton(page, panel, selector, code) {
  const handle = await page.evaluateHandle((p, sel, c) => {
    const all = [...document.querySelectorAll(`#${p} .rpt-dismiss-btn`)];
    return all.find((b) => b.getAttribute('data-selector') === sel && (c === undefined || b.getAttribute('data-code') === c)) || null;
  }, panel, selector, code);
  return handle.asElement();
}

/** Expand the group around a button with a real click on its header, as a user would. */
export async function expandGroupOf(page, button) {
  const header = (await page.evaluateHandle((el) => el.closest('.rpt-group').querySelector('.rpt-group__header'), button)).asElement();
  const collapsed = await page.evaluate((el) => el.closest('.rpt-group').classList.contains('rpt-group--collapsed'), button);
  if (collapsed) {
    await header.click();
    await page.waitForFunction((el) => !el.closest('.rpt-group').classList.contains('rpt-group--collapsed'), {}, button);
  }
}

/** Open the mark dialog for the finding with this selector. Returns after the preview settled. */
export async function openMarkDialog(page, panel, selector, code) {
  await showTab(page, panel === 'panel-templates' ? 'templates' : 'issues');
  await clearToasts(page);
  const button = await dismissButton(page, panel, selector, code);
  if (!button) throw new Error(`no Dismiss button for the requested finding in ${panel}`);
  await expandGroupOf(page, button);
  await button.click();
  await page.waitForSelector('#issue-dismiss-dialog[open]', { timeout: WAIT });
  await page.waitForFunction(() => {
    const s = document.querySelector('[data-preview="status"]');
    return s && !/Checking/.test(s.textContent || '') && document.querySelector('[data-preview="occurrences"]').textContent !== '—';
  }, { timeout: WAIT });
}

/** Type a reason and confirm; waits for the reload and the toast. */
export async function confirmMark(page, reason, { long = false } = {}) {
  if (long) { await page.focus('#issue-dismiss-reason'); await page.keyboard.sendCharacter(reason); } else await page.type('#issue-dismiss-reason', reason);
  await page.waitForFunction(() => !document.querySelector('[data-action="rptDismissConfirm"]').disabled, { timeout: WAIT });
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: WAIT }),
    page.click('[data-action="rptDismissConfirm"]'),
  ]);
  await page.waitForSelector('#toast-container .toast', { timeout: WAIT });
}

/**
 * Let the flash toast go before clicking something it may cover (on a phone the toast is a fixed
 * full-width bar at the bottom of the viewport for about five seconds). A persistent warning toast
 * is closed with its own close button, as a user would.
 */
export async function clearToasts(page) {
  const gone = () => page.waitForFunction(() => !document.querySelector('#toast-container .toast'), { timeout: 9000 }).then(() => true, () => false);
  if (await gone()) return;
  await page.evaluate(() => document.querySelectorAll('#toast-container .toast__close').forEach((b) => b.click()));
  await gone();
}

/** Scroll with no animation (the page may use smooth scrolling, which makes a read-back race). */
export const scrollToInstant = (page, selector) => page.evaluate((sel) => document.querySelector(sel).scrollIntoView({ block: 'start', behavior: 'instant' }), selector);

/** Open the Dismissed section with a real click on its summary. */
export async function openDismissedSection(page) {
  await showTab(page, 'issues');
  await clearToasts(page);
  const isOpen = await page.$eval('#rpt-dismissed', (d) => d.open);
  if (!isOpen) {
    await page.click('#rpt-dismissed > summary');
    await page.waitForFunction(() => document.getElementById('rpt-dismissed').open, { timeout: WAIT });
  }
}

export const issueListText = (page) => page.evaluate(() => (document.getElementById('rpt-issue-list') || { textContent: '' }).textContent || '');

/** Read one translated string from the BUILT locale file (dist), so a check compares to the real copy. */
export function localeString(locale, dotted) {
  const file = path.join(DASHBOARD_DIR, 'dist', 'i18n', 'locales', `${locale}.json`);
  let node = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const part of dotted.split('.')) node = node?.[part];
  return typeof node === 'string' ? node : null;
}

/** WCAG contrast of an element's text colour against the first opaque ancestor background. */
export async function contrastOf(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    // A 1x1 canvas resolves ANY computed CSS colour (rgb, color(srgb), oklch, color-mix) to bytes.
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    const parse = (c) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); const d = ctx.getImageData(0, 0, 1, 1).data; return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 }; };
    const lum = ({ r, g, b }) => { const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    let bg = null;
    for (let n = el; n && !bg; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c.a >= 0.99) bg = c; }
    bg = bg || { r: 255, g: 255, b: 255 };
    const fg = parse(getComputedStyle(el).color);
    const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
    return { ratio: Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100, fg: getComputedStyle(el).color, bg: `rgb(${bg.r},${bg.g},${bg.b})` };
  }, selector);
}
