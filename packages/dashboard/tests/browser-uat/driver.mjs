// Real-browser UAT driver for the "Deep behavioral scan (beta)" feature and
// the FIX-2 regression (behavioral checkbox surfaced outside the accordion).
//
// Drives the Luqen dashboard UI with puppeteer-core (resolved transitively via
// pa11y's nested copy) pointed at an auto-discovered ms-playwright Chromium.
// Exits non-zero on the FIRST failed assertion. Captures screenshots + JSON
// evidence under .tmp/.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(HERE, '..', '..', '..', '..');
const require = createRequire(path.join(repoRoot, 'noop.cjs'));

// puppeteer-core is not a direct dependency of @luqen/dashboard; it is bundled
// inside pa11y (which the dashboard already depends on). Resolve it from there.
function resolvePuppeteer() {
  const candidates = [
    'puppeteer-core',
    path.join(repoRoot, 'node_modules', 'pa11y', 'node_modules', 'puppeteer-core'),
    path.join(repoRoot, 'node_modules', 'puppeteer-core'),
  ];
  for (const c of candidates) {
    try {
      return require(c);
    } catch {
      /* try next */
    }
  }
  throw new Error('puppeteer-core not resolvable (expected via pa11y nested copy)');
}

function discoverChromium() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  // Glob /root/.cache/ms-playwright/chromium-*/chrome-linux64/chrome without
  // relying on Node 22's fs.glob (kept compatible with older runtimes).
  const root = '/root/.cache/ms-playwright';
  const found = [];
  if (fs.existsSync(root)) {
    for (const dir of fs.readdirSync(root)) {
      if (!dir.startsWith('chromium-')) continue;
      const candidate = path.join(root, dir, 'chrome-linux64', 'chrome');
      if (fs.existsSync(candidate)) found.push(candidate);
    }
  }
  found.sort();
  if (!found.length) throw new Error('No ms-playwright Chromium found under ' + root);
  return found[found.length - 1];
}

const puppeteer = resolvePuppeteer();

const BASE = process.env.UAT_BASE_URL || 'http://127.0.0.1:5071';
const USER = process.env.UAT_USER || 'admin';
const PASS = process.env.UAT_PASS || 'UatProof2026!';
const OUT = path.join(HERE, '.tmp');
const FIXTURE = fs.readFileSync(path.join(OUT, 'fixture-url.txt'), 'utf8').trim();

const ev = { fixtureUrl: FIXTURE, base: BASE, steps: [], assertions: [] };
function note(k, v) {
  ev[k] = v;
  ev.steps.push(k);
  console.log('STEP ' + k + ' = ' + JSON.stringify(v));
}
function assert(name, cond, detail) {
  ev.assertions.push({ name, pass: !!cond, detail: detail ?? null });
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? ' :: ' + detail : ''));
  if (!cond) {
    fs.writeFileSync(path.join(OUT, 'evidence.json'), JSON.stringify(ev, null, 2));
    throw new Error('ASSERTION FAILED: ' + name + (detail ? ' :: ' + detail : ''));
  }
}

(async () => {
  const executablePath = discoverChromium();
  note('chromium', executablePath);
  const browser = await puppeteer.launch({
    executablePath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1500 });

    // ── Assertion 1: LOGIN ────────────────────────────────────────────────
    await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.type('input[name="username"]', USER);
    await page.type('input[name="password"]', PASS);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }),
      page.click('button[type="submit"], input[type="submit"]'),
    ]);
    note('loginUrlAfter', page.url());
    const loggedIn = !/\/login/.test(page.url());
    assert('1. login works', loggedIn, page.url());

    // ── Assertion 2: behavioral checkbox visible WITHOUT opening <details> ──
    await page.goto(BASE + '/scan/new', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('input[name="siteUrl"]', { timeout: 15000 });
    await page.type('input[name="siteUrl"]', FIXTURE);

    const cbInfo = await page.evaluate(() => {
      const el = document.querySelector('#behavioral-cb');
      if (!el) return { present: false };
      // Walk up the ancestor chain: is the checkbox inside a CLOSED <details>?
      let node = el.parentElement;
      let insideClosedDetails = false;
      while (node) {
        if (node.tagName === 'DETAILS' && !node.open) {
          insideClosedDetails = true;
          break;
        }
        node = node.parentElement;
      }
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      const visible =
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden';
      return { present: true, insideClosedDetails, visible };
    });
    note('behavioralCheckbox', cbInfo);
    assert('2a. #behavioral-cb is present', cbInfo.present);
    assert(
      '2b. #behavioral-cb is NOT inside a closed <details> (FIX 2 regression)',
      cbInfo.present && cbInfo.insideClosedDetails === false,
      'insideClosedDetails=' + cbInfo.insideClosedDetails
    );
    assert(
      '2c. #behavioral-cb is visible without expanding anything',
      cbInfo.present && cbInfo.visible === true
    );

    // Tick it via a genuine click (no <details> expansion needed).
    await page.$eval('#behavioral-cb', (el) => {
      if (!el.checked) el.click();
    });
    const checked = await page.$eval('#behavioral-cb', (el) => el.checked);
    note('behavioralChecked', checked);
    assert('2d. behavioral checkbox can be ticked', checked === true);
    await page.$eval('#behavioral-cb', (el) => el.scrollIntoView({ block: 'center' }));
    await new Promise((r) => setTimeout(r, 200));
    await page.screenshot({ path: path.join(OUT, '01-newscan-ticked.png'), fullPage: true });

    // Submit the form that owns #behavioral-cb (page may have multiple forms).
    await page.evaluate(() => {
      const form = document.querySelector('#behavioral-cb').closest('form');
      const btn = form.querySelector('button[type="submit"]');
      if (btn) btn.click();
      else form.requestSubmit();
    });
    await page.waitForFunction(
      () =>
        /\/scan\/[0-9a-f-]+\/progress/.test(location.pathname) ||
        /\/reports\/[0-9a-f-]+/.test(location.pathname),
      { timeout: 30000 }
    );
    const afterUrl = page.url();
    note('afterSubmitUrl', afterUrl);
    const m =
      afterUrl.match(/\/scan\/([0-9a-f-]+)\/progress/) || afterUrl.match(/\/reports\/([0-9a-f-]+)/);
    const scanId = m ? m[1] : null;
    note('scanId', scanId);
    assert('scan was created (id in URL)', !!scanId, afterUrl);
    fs.writeFileSync(path.join(OUT, 'scan-id.txt'), scanId);

    // ── Assertion 3: scan completes with pages_scanned > 0 ────────────────
    let status = null;
    let api = null;
    for (let i = 0; i < 90; i++) {
      const r = await page.evaluate(async (id) => {
        const res = await fetch('/api/v1/scans/' + id, { headers: { accept: 'application/json' } });
        return { status: res.status, body: await res.text() };
      }, scanId);
      let parsed = null;
      try {
        parsed = JSON.parse(r.body);
      } catch {
        parsed = null;
      }
      const node = parsed && parsed.data ? parsed.data : parsed;
      status = node ? node.status : 'http' + r.status;
      if (status === 'completed' || status === 'failed') {
        api = node;
        break;
      }
      await new Promise((res) => setTimeout(res, 2000));
    }
    const pagesScanned = api ? api.pagesScanned ?? api.pages_scanned ?? 0 : 0;
    note('finalStatus', status);
    note('pagesScanned', pagesScanned);
    if (api) fs.writeFileSync(path.join(OUT, 'scan-api.json'), JSON.stringify(api, null, 2));
    assert('3a. scan completed', status === 'completed', 'status=' + status);
    assert('3b. pages_scanned > 0', pagesScanned > 0, 'pagesScanned=' + pagesScanned);

    // ── Assertion 4: report contains the behavioral keyboard-trap code ────
    await page.goto(BASE + '/reports/' + scanId, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 1500));
    const reportText = await page.evaluate(() => document.body.innerText);
    fs.writeFileSync(path.join(OUT, 'report-text.txt'), reportText);
    // Also fetch the issues API to assert on the exact machine code.
    const issues = await page.evaluate(async (id) => {
      const res = await fetch('/api/v1/scans/' + id + '/issues', {
        headers: { accept: 'application/json' },
      });
      return { status: res.status, body: await res.text() };
    }, scanId);
    fs.writeFileSync(path.join(OUT, 'issues-api.json'), issues.body);
    const behavioralCodeRe = /Luqen\.Behavioral\.[^"' <]*2_1_2[^"' <]*KeyboardTrap/;
    const codeInReport = behavioralCodeRe.test(reportText);
    const codeInIssues = behavioralCodeRe.test(issues.body);
    note('behavioralCodeInReport', codeInReport);
    note('behavioralCodeInIssues', codeInIssues);
    await page.screenshot({ path: path.join(OUT, '02-report-behavioral.png'), fullPage: true });
    assert(
      '4. report/issues contain Luqen.Behavioral.…2_1_2.KeyboardTrap',
      codeInReport || codeInIssues,
      'report=' + codeInReport + ' issues=' + codeInIssues
    );

    // ── Assertion 5: VPAT 2.1.2 = Does Not Support, 2.1.1 = Not Evaluated ──
    await page.goto(BASE + '/reports/' + scanId + '/vpat', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await new Promise((r) => setTimeout(r, 1500));
    const vpatText = await page.evaluate(() => document.body.innerText);
    fs.writeFileSync(path.join(OUT, 'vpat-text.txt'), vpatText);
    const rowFor = await page.evaluate(() => {
      function findRow(criterion) {
        for (const tr of Array.from(document.querySelectorAll('table tr'))) {
          const t = (tr.innerText || '').replace(/\s+/g, ' ').trim();
          if (t.includes(criterion)) return t;
        }
        return null;
      }
      return { row212: findRow('2.1.2'), row211: findRow('2.1.1') };
    });
    note('vpat212Row', rowFor.row212);
    note('vpat211Row', rowFor.row211);
    const row212 = rowFor.row212 || '';
    const row211 = rowFor.row211 || '';
    const v212DoesNotSupport = /Does Not Support/i.test(row212);
    const v211NotEvaluated = /Not Evaluated/i.test(row211);
    note('vpat212DoesNotSupport', v212DoesNotSupport);
    note('vpat211NotEvaluated', v211NotEvaluated);

    // Highlight the 2.1.2 row for the evidence screenshot.
    await page.evaluate(() => {
      for (const tr of Array.from(document.querySelectorAll('table tr'))) {
        if (/2\.1\.2/.test(tr.innerText || '')) {
          tr.scrollIntoView({ block: 'center' });
          tr.style.outline = '3px solid #c00';
          break;
        }
      }
    });
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({ path: path.join(OUT, '03-vpat-212.png'), fullPage: true });
    assert('5a. VPAT 2.1.2 == Does Not Support', v212DoesNotSupport, row212);
    assert('5b. VPAT 2.1.1 == Not Evaluated', v211NotEvaluated, row211);

    ev.allPassed = true;
    fs.writeFileSync(path.join(OUT, 'evidence.json'), JSON.stringify(ev, null, 2));
    fs.writeFileSync(path.join(OUT, 'driver-done.txt'), 'OK scanId=' + scanId + ' status=' + status);
    console.log('DRIVER_DONE_ALL_GREEN');
  } catch (e) {
    ev.error = e.message;
    fs.writeFileSync(path.join(OUT, 'evidence.json'), JSON.stringify(ev, null, 2));
    fs.writeFileSync(path.join(OUT, 'driver-error.txt'), (e.stack || e.message) + '');
    console.log('DRIVER_ERROR ' + e.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
