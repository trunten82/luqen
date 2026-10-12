// Scenarios: mark, surfaces, conflict, public (UI-SPEC Browser UAT Contract items 4, 5, 7, 8).
import {
  check, login, WAIT, newPersonaPage, openReport, showTab, pageFetch, jsonOf, shot, openMarkDialog,
  confirmMark, openDismissedSection, issueListText, requireFromRepo, sleep, scrollToInstant,
} from './lib.mjs';
import { HERO, NAV, PROMO, SITE, REASON } from './fixture.mjs';

const MARK_PATH = (scanId) => `/api/v1/scans/${scanId}/dismissals`;
const statText = (page, id) => page.$eval(`#${id}`, (e) => (e.textContent || '').trim());

async function markViaApi(page, scanId, f, reason = REASON) {
  const res = await pageFetch(page, 'POST', MARK_PATH(scanId), { code: f.code, selector: f.selector, reason });
  return { res, body: jsonOf(res) };
}

export const flowScenarios = {
  /** Item 4: mark from both tabs; same-tab reload, toast with the count, exclusion everywhere, section row. */
  async mark({ page, world }) {
    const S = 'mark';
    const { base, scanId, personas } = world;
    check(S, 'login as global admin', await login(page, base, personas.admin), page.url());
    await openReport(page, base, scanId, 'issues');
    const before = { issues: await statText(page, 'rpt-stat-issues'), errors: await statText(page, 'rpt-stat-errors') };
    check(S, 'before: the page counts all 9 occurrences', /9/.test(before.issues) && /9/.test(before.errors), JSON.stringify(before));

    await openMarkDialog(page, 'panel-issues', HERO.selector);
    await confirmMark(page, REASON);
    check(S, 'the reload returns to the same report page', page.url().includes(`/reports/${scanId}`), page.url());
    check(S, 'the Issues tab is the active tab after the reload', await page.$eval('#panel-issues', (p) => !p.classList.contains('rpt-tab-panel--hidden')));
    const toast = await page.$eval('#toast-container .toast', (t) => t.textContent || '');
    check(S, 'the success toast states the recomputed scan count', /Finding dismissed\. Scans of this site updated: 1\./.test(toast), toast);
    check(S, 'the dismissed page issue is gone from the Issues list', !(await issueListText(page)).includes(HERO.selector));
    const afterHero = { issues: await statText(page, 'rpt-stat-issues'), errors: await statText(page, 'rpt-stat-errors') };
    check(S, 'the page counts fell by the 2 dismissed occurrences (9 -> 7)', /7/.test(afterHero.issues) && /7/.test(afterHero.errors), JSON.stringify(afterHero));

    // Template item, marked from the Templates tab (the only action in that head).
    await openMarkDialog(page, 'panel-templates', NAV.selector);
    await confirmMark(page, 'The logo link text is provided by an aria-label the scanner cannot see.');
    const gone = await page.evaluate((sel) => ({
      list: (document.getElementById('rpt-issue-list') || { textContent: '' }).textContent.includes(sel),
      templatesTab: document.getElementById('tab-templates') !== null,
      templatesPanel: (document.getElementById('panel-templates') || { textContent: '' }).textContent.includes(sel),
    }), NAV.selector);
    check(S, 'the dismissed template item is gone from the Issues tab and the Templates tab', gone.list === false && gone.templatesPanel === false, JSON.stringify(gone));
    const afterNav = { issues: await statText(page, 'rpt-stat-issues'), errors: await statText(page, 'rpt-stat-errors') };
    check(S, 'the page counts fell by the 4 template occurrences too (7 -> 3)', /3/.test(afterNav.issues) && /3/.test(afterNav.errors), JSON.stringify(afterNav));
    const scanApi = jsonOf(await pageFetch(page, 'GET', `/api/v1/scans/${scanId}`));
    const total = scanApi && scanApi.data ? scanApi.data.totalIssues : undefined;
    check(S, 'the stored scan row was recomputed to the same total (3)', total === 3, String(total));

    await openDismissedSection(page);
    const rows = await page.evaluate(() => [...document.querySelectorAll('#rpt-dismissed table')][0]
      ? [...[...document.querySelectorAll('#rpt-dismissed table')][0].querySelectorAll('tbody tr')].map((r) => ({
        text: r.textContent || '', iso: (r.querySelector('time') || {}).getAttribute ? r.querySelector('time').getAttribute('datetime') : null,
      })) : []);
    check(S, 'the Dismissed section lists both findings', rows.length === 2, String(rows.length));
    const hero = rows.find((r) => r.text.includes(HERO.code)) || { text: '' };
    check(S, 'a row shows the rule, reason, actor and an ISO date', hero.text.includes(REASON) && hero.text.includes(personas.admin.user) && !Number.isNaN(Date.parse(hero.iso || '')), JSON.stringify(hero).slice(0, 240));
    await scrollToInstant(page, '#rpt-dismissed');
    await shot(page, 'mark-section-desktop');
  },

  /** Item 5: the dismissed finding is absent from print and the issues workbook's main sheet, present on its Dismissed sheet. */
  async surfaces({ page, world }) {
    const S = 'surfaces';
    const { base, scanId, personas } = world;
    check(S, 'login as global admin', await login(page, base, personas.admin), page.url());
    await openReport(page, base, scanId);
    const m = await markViaApi(page, scanId, HERO);
    check(S, 'the finding is marked (201)', m.res.status === 201, String(m.res.status));

    const printRes = await pageFetch(page, 'GET', `/reports/${scanId}/print`);
    check(S, 'print: the page loads', printRes.status === 200, String(printRes.status));
    // The print view lists WCAG criterion titles and counts (no selectors or messages), so the
    // dismissed finding (1.1.1, 2 pages) is looked for by its criterion title and by the total.
    const printText = printRes.text.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    check(S, 'print: a finding that is NOT dismissed is present (the check can match)', printText.includes('Contrast (Minimum)'));
    check(S, 'print: the dismissed finding is absent and the total fell from 9 to 7', !printText.includes('Non-text Content') && printText.includes('7 Total Issues') && !printText.includes('9 Total Issues'), printText.slice(300, 700));

    const b64 = await page.evaluate(async (id) => {
      const r = await fetch(`/api/v1/export/scans/${id}/issues.xlsx`, { credentials: 'include' });
      const buf = new Uint8Array(await r.arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      return { status: r.status, b64: btoa(s) };
    }, scanId);
    check(S, 'xlsx: the export downloads', b64.status === 200, String(b64.status));
    const ExcelJS = requireFromRepo('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(b64.b64, 'base64'));
    const names = wb.worksheets.map((w) => w.name);
    check(S, 'xlsx: there is a Dismissed sheet', names.includes('Dismissed'), JSON.stringify(names));
    const cells = (ws) => { const out = []; ws.eachRow((row) => row.eachCell((c) => out.push(String(c.value ?? '')))); return out; };
    const dismissedCells = cells(wb.getWorksheet('Dismissed'));
    check(S, 'xlsx: the Dismissed sheet lists the finding with its reason', dismissedCells.some((c) => c === HERO.selector) && dismissedCells.some((c) => c.includes(REASON)), dismissedCells.slice(0, 12).join(' | '));
    const mainCells = wb.worksheets.filter((w) => w.name !== 'Dismissed').flatMap(cells);
    check(S, 'xlsx: the other sheets carry the surviving findings (the check can match)', mainCells.some((c) => c.includes(PROMO.selector) || c.includes(PROMO.message)));
    check(S, 'xlsx: the other sheets do not carry the dismissed finding', !mainCells.some((c) => c === HERO.selector || c.includes(HERO.message)));
  },

  /** Item 7: a second tab marks/revokes first; the first tab's confirm shows the 409 text and stays open. */
  async conflict({ page, browser, world }) {
    const S = 'conflict';
    const { base, scanId, personas } = world;
    check(S, 'login as global admin', await login(page, base, personas.admin), page.url());
    const second = await page.browserContext().newPage();
    second.setDefaultTimeout(WAIT);
    await second.setViewport({ width: 1280, height: 1600 });

    // Mark conflict. waitForFunction polls on requestAnimationFrame, which a background tab never
    // runs, so each tab is brought to the front before it is driven.
    await page.bringToFront();
    await openReport(page, base, scanId, 'issues');
    await openMarkDialog(page, 'panel-issues', HERO.selector);
    await page.type('#issue-dismiss-reason', 'First tab reason, typed before the second tab acts.');
    await second.bringToFront();
    await openReport(second, base, scanId, 'issues');
    await openMarkDialog(second, 'panel-issues', HERO.selector);
    await confirmMark(second, 'Second tab marks the same finding first.');
    await openDismissedSection(second);
    check(S, 'the second tab marked the finding (its Dismissed section lists it)', (await second.$eval('#rpt-dismissed', (d) => d.textContent || '')).includes(HERO.code));

    await page.bringToFront();
    await page.waitForFunction(() => !document.querySelector('[data-action="rptDismissConfirm"]').disabled, { timeout: WAIT });
    await page.click('[data-action="rptDismissConfirm"]');
    await page.waitForFunction(() => (document.getElementById('issue-dismiss-error').textContent || '').trim() !== '', { timeout: WAIT });
    const expected = await page.$eval('#issue-dismiss-dialog', (d) => d.getAttribute('data-err-conflict'));
    const got = await page.evaluate(() => ({
      error: document.getElementById('issue-dismiss-error').textContent.trim(),
      open: document.getElementById('issue-dismiss-dialog').open,
      reason: document.getElementById('issue-dismiss-reason').value,
      cancelEnabled: !document.querySelector('[data-action="rptDismissCancel"]').disabled,
    }));
    check(S, 'the first tab shows the 409 mark text', got.error === expected && expected.length > 10, got.error);
    check(S, 'the dialog stays open with the typed reason kept and Cancel usable', got.open && got.reason.startsWith('First tab reason') && got.cancelEnabled, JSON.stringify(got));
    await shot(page, 'conflict-mark-409');
    await page.click('[data-action="rptDismissCancel"]');

    // Revoke conflict: both tabs show the active row; the second revokes first.
    await page.reload({ waitUntil: 'networkidle0' });
    await openDismissedSection(page);
    await second.bringToFront();
    await second.reload({ waitUntil: 'networkidle0' });
    await openDismissedSection(second);
    await page.bringToFront();
    await page.click('#rpt-dismissed [data-action="rptRevokeIssue"]');
    await page.waitForSelector('#issue-revoke-dialog[open]', { timeout: WAIT });
    await second.bringToFront();
    await second.click('#rpt-dismissed [data-action="rptRevokeIssue"]');
    await second.waitForSelector('#issue-revoke-dialog[open]', { timeout: WAIT });
    await Promise.all([
      second.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: WAIT }),
      second.click('[data-action="rptRevokeConfirm"]'),
    ]);
    await page.bringToFront();
    await page.click('[data-action="rptRevokeConfirm"]');
    await page.waitForFunction(() => (document.getElementById('issue-revoke-error').textContent || '').trim() !== '', { timeout: WAIT });
    const revokeExpected = await page.$eval('#issue-revoke-dialog', (d) => d.getAttribute('data-err-conflict'));
    const revokeGot = await page.evaluate(() => ({ error: document.getElementById('issue-revoke-error').textContent.trim(), open: document.getElementById('issue-revoke-dialog').open }));
    check(S, 'the first tab shows the revoke-specific 409 text', revokeGot.error === revokeExpected && revokeExpected.length > 10 && revokeExpected !== expected, revokeGot.error);
    check(S, 'the revoke dialog stays open', revokeGot.open === true);
    await shot(page, 'conflict-revoke-409');
  },

  /** Item 8: with a dismissal present, the public report and the token share carry no dismissed-section marker. */
  async public({ page, browser, world }) {
    const S = 'public';
    const { base, scanId, personas } = world;
    check(S, 'login as global admin', await login(page, base, personas.admin), page.url());
    await openReport(page, base, scanId);
    const m = await markViaApi(page, scanId, HERO);
    check(S, 'the finding is marked (201)', m.res.status === 201, String(m.res.status));

    const own = await pageFetch(page, 'GET', `/reports/${scanId}`);
    check(S, 'the authenticated report carries the marker (so its absence elsewhere is meaningful)', own.text.includes('rpt-dismissed') && own.text.includes(REASON));
    const pub = await pageFetch(page, 'POST', `/api/v1/reports/${scanId}/public-share`, { enabled: true });
    check(S, 'the public-share switch is on', pub.status === 200, String(pub.status));
    const share = await pageFetch(page, 'POST', `/api/v1/reports/${scanId}/shares`, {});
    const token = jsonOf(share)?.token;
    check(S, 'a token share was created', share.status === 200 && typeof token === 'string', String(share.status));

    const anon = await newPersonaPage(browser, base, null);
    for (const [label, url, needsSite] of [['public report', `${base}/reports/${scanId}/public`, true], ['token share', `${base}/share/${token}`, false]]) {
      const res = await anon.page.goto(url, { waitUntil: 'networkidle0', timeout: WAIT });
      const html = await anon.page.content();
      check(S, `${label}: loads for an anonymous visitor (200)`, res.status() === 200, String(res.status()));
      check(S, `${label}: is a real page, not the unavailable notice`, html.length > 3000 && !/no longer available/i.test(html) && (!needsSite || html.includes(new URL(SITE).host)), String(html.length));
      check(S, `${label}: has no rpt-dismissed marker`, !html.includes('rpt-dismissed'));
      check(S, `${label}: shows neither the reason nor the dismissed element`, !html.includes(REASON) && !html.includes(HERO.selector));
      await shot(anon.page, `public-${label.replace(' ', '-')}`);
    }
    await anon.context.close();
    await sleep(50);
  },
};
