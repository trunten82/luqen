// Scenarios: mobile, longtext, locales, theme, keyboard, overflow
// (UI-SPEC Browser UAT Contract items 9-12 and the long-text / overflow / theme backstops).
import {
  check, login, WAIT, PHONE, DESKTOP, openReport, showTab, pageFetch, jsonOf, shot, dismissButton, expandGroupOf,
  openMarkDialog, confirmMark, openDismissedSection, horizontalOverflow, localeString, sleep, log, scrollToInstant, contrastOf,
} from './lib.mjs';
import { HERO, NAV, PROMO, LONG, REASON } from './fixture.mjs';

const MARK_PATH = (scanId) => `/api/v1/scans/${scanId}/dismissals`;

async function markApi(page, scanId, f, reason = REASON) {
  const res = await pageFetch(page, 'POST', MARK_PATH(scanId), { code: f.code, selector: f.selector, reason });
  return jsonOf(res);
}
async function revokeApi(page, id, comment) {
  return pageFetch(page, 'POST', `/api/v1/dismissals/${id}/revoke`, comment === undefined ? {} : { comment });
}

/** Every visible button of the open dialog sits inside the viewport and is not covered. */
async function dialogButtonsReachable(page, dialogId) {
  return page.evaluate((id) => {
    const d = document.getElementById(id);
    const out = [];
    for (const b of d.querySelectorAll('.modal__footer button')) {
      b.scrollIntoView({ block: 'nearest' });
      const r = b.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      out.push({
        label: (b.textContent || '').trim().slice(0, 24),
        inside: r.left >= 0 && r.right <= window.innerWidth && r.top >= 0 && r.bottom <= window.innerHeight,
        uncovered: top === b || b.contains(top),
      });
    }
    const dr = d.getBoundingClientRect();
    return { buttons: out, dialogInside: dr.left >= 0 && dr.right <= window.innerWidth && dr.height <= window.innerHeight + 1, overflowY: getComputedStyle(d).overflowY };
  }, dialogId);
}

/**
 * 89-11 item 1: with the revoke dialog OPEN, its 400 slot carries the revoke wording of this locale
 * (not the mark sentence), and a revoke answered 400 by request interception (the POST never reaches
 * the server) shows that text while the dialog stays open with the comment kept.
 */
async function revokeInvalidCopy(page, S, locale) {
  const want = localeString(locale, 'issueDismissals.error.invalidRevoke');
  const markText = localeString(locale, 'issueDismissals.error.invalid');
  const attr = await page.$eval('#issue-revoke-dialog', (d) => d.getAttribute('data-err-invalid'));
  check(S, `${locale}: the revoke dialog's 400 text is the revoke wording, not the mark one`, typeof want === 'string' && attr === want && attr !== markText, String(attr).slice(0, 120));
  const comment = `Kept after a 400 (${locale}).`;
  const seen = { revokePosts: 0 };
  const onRequest = (req) => {
    if (req.method() === 'POST' && /\/api\/v1\/dismissals\/[^/]+\/revoke$/.test(new URL(req.url()).pathname)) {
      seen.revokePosts += 1;
      req.respond({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'SERVER-DETAIL-NOT-SHOWN' }) });
    } else req.continue();
  };
  await page.setRequestInterception(true);
  page.on('request', onRequest);
  try {
    await page.$eval('#issue-revoke-comment', (t) => { t.value = ''; });
    await page.type('#issue-revoke-comment', comment);
    await page.click('[data-action="rptRevokeConfirm"]');
    await page.waitForFunction(() => (document.getElementById('issue-revoke-error').textContent || '').trim() !== '', { timeout: WAIT });
  } finally {
    page.off('request', onRequest);
    await page.setRequestInterception(false);
  }
  const after = await page.evaluate(() => ({
    error: document.getElementById('issue-revoke-error').textContent.trim(),
    open: document.getElementById('issue-revoke-dialog').open,
    comment: document.getElementById('issue-revoke-comment').value,
  }));
  check(S, `${locale}: an intercepted 400 on revoke shows the revoke wording, keeps the dialog open and the comment`,
    seen.revokePosts === 1 && after.error === want && after.open && after.comment === comment, JSON.stringify({ ...after, posts: seen.revokePosts }).slice(0, 240));
}

/**
 * HARD-05: every date in the Dismissed section (the <time> elements) in the session locale, compared
 * with this process's own formatting of the same ISO value (the local dashboard runs on this machine,
 * with the same time zone and ICU data).
 */
async function sectionDates(page, S, locale) {
  const dates = await page.$$eval('#rpt-dismissed time[datetime]', (ts) => ts.map((t) => ({ iso: t.getAttribute('datetime'), text: (t.textContent || '').trim() })));
  const ok = dates.length >= 2 && dates.every((d) => d.text === new Date(d.iso).toLocaleString(locale));
  const differs = locale === 'en' || dates.every((d) => d.text !== new Date(d.iso).toLocaleString('en'));
  check(S, `${locale}: the Dismissed section's dates are formatted in ${locale}${locale === 'en' ? ' (control)' : ', not in English'}`, ok && differs, JSON.stringify(dates));
}

async function setPhone(page) { await page.setViewport(PHONE); }
async function setDesktop(page) { await page.setViewport(DESKTOP); }

export async function setLocale(page, locale) {
  await page.evaluate(async (l) => {
    const meta = document.querySelector('meta[name="csrf-token"]');
    await fetch('/account/locale', { method: 'POST', credentials: 'include', redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-CSRF-Token': meta ? meta.getAttribute('content') || '' : '' },
      body: `locale=${l}&_csrf=${encodeURIComponent(meta ? meta.getAttribute('content') || '' : '')}` });
  }, locale);
}

export const viewScenarios = {
  /** Item 9: 375x812 — dialog fits and scrolls, tables become cards, no page overflow, toast fits. */
  async mobile({ page, world }) {
    const S = 'mobile';
    const { base, scanId, personas } = world;
    await setPhone(page);
    check(S, 'login as global admin', await login(page, base, personas.admin), page.url());
    await openReport(page, base, scanId, 'issues');
    const ov0 = await horizontalOverflow(page);
    check(S, 'the Issues tab has no horizontal page scroll at 375px', ov0.scrollW <= ov0.innerW + 2, JSON.stringify(ov0));
    const btn = await dismissButton(page, 'panel-issues', HERO.selector);
    await expandGroupOf(page, btn);
    const box = await btn.boundingBox();
    check(S, 'the Dismiss button sits inside the viewport', box !== null && box.x >= 0 && box.x + box.width <= PHONE.width, JSON.stringify(box));
    await btn.click();
    await page.waitForSelector('#issue-dismiss-dialog[open]', { timeout: WAIT });
    await page.waitForFunction(() => document.querySelector('[data-preview="occurrences"]').textContent === '2', { timeout: WAIT });
    const fit = await dialogButtonsReachable(page, 'issue-dismiss-dialog');
    check(S, 'the dialog fits the phone viewport and scrolls internally', fit.dialogInside && ['auto', 'scroll'].includes(fit.overflowY), JSON.stringify(fit));
    check(S, 'Cancel and Confirm are inside the viewport and uncovered', fit.buttons.length === 2 && fit.buttons.every((b) => b.inside && b.uncovered), JSON.stringify(fit.buttons));
    const fontPx = await page.$eval('#issue-dismiss-reason', (t) => parseFloat(getComputedStyle(t).fontSize));
    check(S, 'the textarea is at least 16px (no iOS zoom)', fontPx >= 16, String(fontPx));
    const ovDlg = await horizontalOverflow(page);
    check(S, 'no horizontal page scroll with the dialog open', ovDlg.scrollW <= ovDlg.innerW + 2, JSON.stringify(ovDlg));
    await shot(page, 'mobile-dialog-375');
    await confirmMark(page, REASON);
    const toastBox = await page.$eval('#toast-container .toast', (t) => { const r = t.getBoundingClientRect(); return { l: r.left, r: r.right, w: window.innerWidth }; });
    check(S, 'the toast fits inside the phone viewport', toastBox.l >= 0 && toastBox.r <= toastBox.w + 1, JSON.stringify(toastBox));
    await shot(page, 'mobile-toast-375');

    // A second dismissal, revoked with a comment, so the section holds an active AND a revoked table.
    const promo = await markApi(page, scanId, PROMO, 'Second finding, revoked below.');
    await revokeApi(page, promo.id, 'Revoked for the phone layout check.');
    await markApi(page, scanId, LONG, 'Long selector, still active.');
    await page.reload({ waitUntil: 'networkidle0' });
    await openDismissedSection(page);
    const cards = await page.evaluate(() => {
      const t = document.querySelector('#rpt-dismissed table');
      const head = getComputedStyle(t.querySelector('thead'));
      const tr = getComputedStyle(t.querySelector('tbody tr'));
      const td = t.querySelector('tbody td');
      return { theadPosition: head.position, trDisplay: tr.display, tdDisplay: getComputedStyle(td).display, label: getComputedStyle(td, '::before').content, tables: document.querySelectorAll('#rpt-dismissed table').length };
    });
    check(S, 'the tables become cards (header clipped, rows blocks, cells labelled)', cards.theadPosition === 'absolute' && cards.trDisplay === 'block' && cards.tdDisplay === 'flex' && cards.label !== 'none' && cards.label !== 'normal' && cards.tables === 2, JSON.stringify(cards));
    const ovSec = await horizontalOverflow(page);
    check(S, 'no horizontal page scroll with the Dismissed section open (8-column revoked table)', ovSec.scrollW <= ovSec.innerW + 2, JSON.stringify(ovSec));
    await scrollToInstant(page, '#rpt-dismissed');
    await shot(page, 'mobile-section-375');
  },

  /** Backstop: 1000-char reason, 600-char selector and a long revoke comment at 375px and 1280px. */
  async longtext({ page, world }) {
    const S = 'longtext';
    const { base, scanId, personas } = world;
    const reason = `${'Long reason words '.repeat(60).slice(0, 860)}${'x'.repeat(140)}`.slice(0, 1000);
    const comment = `${'Long comment words '.repeat(60).slice(0, 860)}${'y'.repeat(140)}`.slice(0, 1000);
    check(S, 'fixture: the reason is 1000 chars, the selector 600, the comment 1000', reason.length === 1000 && LONG.selector.length === 600 && comment.length === 1000);
    check(S, 'login as global admin', await login(page, base, personas.admin), page.url());
    await openReport(page, base, scanId, 'issues');
    await openMarkDialog(page, 'panel-issues', LONG.selector);
    const dlgDesktop = await dialogButtonsReachable(page, 'issue-dismiss-dialog');
    const ov1 = await horizontalOverflow(page);
    check(S, '1280px: the dialog with a 600-char selector fits, buttons reachable, no page scroll', dlgDesktop.dialogInside && dlgDesktop.buttons.every((b) => b.inside && b.uncovered) && ov1.scrollW <= ov1.innerW + 2, JSON.stringify({ dlgDesktop, ov1 }));
    await page.focus('#issue-dismiss-reason');
    await page.keyboard.sendCharacter(reason);
    check(S, 'the counter reads 1000', (await page.$eval('[data-reason-count]', (e) => e.textContent)) === '1000');
    await shot(page, 'longtext-dialog-1280');
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: WAIT }), page.click('[data-action="rptDismissConfirm"]')]);
    await openDismissedSection(page);
    const ov2 = await horizontalOverflow(page);
    check(S, '1280px: the section with the 1000-char reason has no page scroll', ov2.scrollW <= ov2.innerW + 2, JSON.stringify(ov2));

    await setPhone(page);
    await page.reload({ waitUntil: 'networkidle0' });
    await openDismissedSection(page);
    const ov3 = await horizontalOverflow(page);
    check(S, '375px: the section with the long reason and selector has no page scroll', ov3.scrollW <= ov3.innerW + 2, JSON.stringify(ov3));
    await page.click('#rpt-dismissed [data-action="rptRevokeIssue"]');
    await page.waitForSelector('#issue-revoke-dialog[open]', { timeout: WAIT });
    await page.focus('#issue-revoke-comment');
    await page.keyboard.sendCharacter(comment);
    const dlgPhone = await dialogButtonsReachable(page, 'issue-revoke-dialog');
    const ov4 = await horizontalOverflow(page);
    check(S, '375px: the revoke dialog with a 1000-char comment fits, buttons reachable, no page scroll', dlgPhone.dialogInside && dlgPhone.buttons.every((b) => b.inside && b.uncovered) && ov4.scrollW <= ov4.innerW + 2, JSON.stringify({ dlgPhone, ov4 }));
    await shot(page, 'longtext-revoke-375');
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: WAIT }), page.click('[data-action="rptRevokeConfirm"]')]);
    await openDismissedSection(page);
    const ov5 = await horizontalOverflow(page);
    check(S, '375px: the revoked card with the long comment has no page scroll', ov5.scrollW <= ov5.innerW + 2, JSON.stringify(ov5));
    await setDesktop(page);
    await page.reload({ waitUntil: 'networkidle0' });
    await openDismissedSection(page);
    const ov6 = await horizontalOverflow(page);
    check(S, '1280px: the revoked table with the long comment has no page scroll', ov6.scrollW <= ov6.innerW + 2, JSON.stringify(ov6));
    await scrollToInstant(page, '#rpt-dismissed');
    await shot(page, 'longtext-revoked-1280');
  },

  /** Item 10: de and it render the dialog and section with the real translations and no raw key; HARD-05: dates. */
  async locales({ page, world }) {
    const S = 'locales';
    const { base, scanId, personas } = world;
    check(S, 'login as global admin', await login(page, base, personas.admin), page.url());
    await openReport(page, base, scanId);
    const m = await markApi(page, scanId, PROMO, 'Reason kept in the original language.');
    await markApi(page, scanId, HERO, 'Second dismissal for the revoke dialog.');
    // 89-11 item 1 in English first (the session starts in en).
    await openReport(page, base, scanId, 'issues');
    await openDismissedSection(page);
    await sectionDates(page, S, 'en');
    await page.click('#rpt-dismissed [data-action="rptRevokeIssue"]');
    await page.waitForSelector('#issue-revoke-dialog[open]', { timeout: WAIT });
    await revokeInvalidCopy(page, S, 'en');
    await page.click('[data-action="rptRevokeCancel"]');
    for (const locale of ['de', 'it']) {
      await setLocale(page, locale);
      await openReport(page, base, scanId, 'issues');
      const lang = await page.evaluate(() => document.documentElement.lang);
      check(S, `${locale}: the page is served in ${locale}`, lang === locale, lang);
      const want = {
        dismiss: localeString(locale, 'issueDismissals.action.dismiss'),
        title: localeString(locale, 'issueDismissals.dialog.mark.title'),
        confirm: localeString(locale, 'issueDismissals.dialog.mark.confirm'),
        revokeTitle: localeString(locale, 'issueDismissals.dialog.revoke.title'),
        summary: localeString(locale, 'issueDismissals.section.summary').replace('{{active}}', '2').replace('{{revoked}}', '0'),
      };
      check(S, `${locale}: the locale file has the strings and they differ from English`, Object.values(want).every((v) => typeof v === 'string') && want.title !== localeString('en', 'issueDismissals.dialog.mark.title'));
      const seen = await page.evaluate(() => ({
        key: /issueDismissals\.|common\.revoke/.test(document.body.innerText) || /issueDismissals\.[a-zA-Z]+\.[a-zA-Z]/.test([...document.querySelectorAll('dialog')].map((d) => d.outerHTML).join('')),
        summary: (document.querySelector('#rpt-dismissed > summary') || { textContent: '' }).textContent.trim(),
        button: (document.querySelector('#panel-issues .rpt-dismiss-btn[data-action]') || { textContent: '' }).textContent.trim(),
      }));
      check(S, `${locale}: no raw issueDismissals key is visible or in a dialog`, seen.key === false);
      check(S, `${locale}: the section summary is the translation`, seen.summary === want.summary, seen.summary);
      check(S, `${locale}: the Dismiss button label is the translation`, seen.button === want.dismiss, seen.button);
      await sectionDates(page, S, locale);
      await openMarkDialog(page, 'panel-issues', NAV.selector);
      const dlg = await page.evaluate(() => ({ title: document.querySelector('#issue-dismiss-dialog .modal__title').textContent.trim(), confirm: document.querySelector('[data-action="rptDismissConfirm"]').textContent.trim(), body: document.getElementById('issue-dismiss-dialog').innerText }));
      check(S, `${locale}: the mark dialog title and Confirm label are the translations`, dlg.title === want.title && dlg.confirm === want.confirm, JSON.stringify(dlg).slice(0, 200));
      check(S, `${locale}: the open dialog shows no raw key`, !/issueDismissals\./.test(dlg.body));
      await shot(page, `locale-${locale}-dialog`);
      await page.click('[data-action="rptDismissCancel"]');
      await openDismissedSection(page);
      await page.click('#rpt-dismissed [data-action="rptRevokeIssue"]');
      await page.waitForSelector('#issue-revoke-dialog[open]', { timeout: WAIT });
      const rv = await page.evaluate(() => ({ title: document.querySelector('#issue-revoke-dialog .modal__title').textContent.trim(), body: document.getElementById('issue-revoke-dialog').innerText }));
      check(S, `${locale}: the revoke dialog title is the translation, no raw key`, rv.title === want.revokeTitle && !/issueDismissals\.|common\./.test(rv.body), JSON.stringify(rv).slice(0, 200));
      await shot(page, `locale-${locale}-revoke`);
      await revokeInvalidCopy(page, S, locale);
      await page.click('[data-action="rptRevokeCancel"]');
      await scrollToInstant(page, '#rpt-dismissed');
      await shot(page, `locale-${locale}-section`);
    }
    void m;
  },

  /** Item 11: dark theme — both dialogs and the section, legible by computed contrast and by eye. */
  async theme({ page, world }) {
    const S = 'theme';
    const { base, scanId, personas } = world;
    await page.evaluateOnNewDocument(() => { try { localStorage.setItem('luqen-theme', 'dark'); } catch (_e) { /* storage unavailable */ } });
    check(S, 'login as global admin', await login(page, base, personas.admin), page.url());
    await openReport(page, base, scanId);
    await markApi(page, scanId, HERO, 'Active dismissal for the dark section.');
    const promo = await markApi(page, scanId, PROMO, 'A dismissal that is revoked, for the muted rows.');
    await revokeApi(page, promo.id, 'Revoked so the muted revoked table is visible.');
    await openReport(page, base, scanId, 'issues');
    const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    check(S, 'the page is in the dark theme', theme === 'dark', String(theme));
    const ratios = {};
    await openMarkDialog(page, 'panel-issues', NAV.selector);
    await page.type('#issue-dismiss-reason', 'Typed text must be legible in the dark theme.');
    for (const [name, sel] of [['dialog title', '#issue-dismiss-dialog .modal__title'], ['dialog hint', '#issue-dismiss-dialog .form-hint'], ['preview value', '[data-preview="occurrences"]'], ['textarea text', '#issue-dismiss-reason'], ['cancel button', '[data-action="rptDismissCancel"]'], ['confirm button', '[data-action="rptDismissConfirm"]']]) {
      ratios[name] = await contrastOf(page, sel);
    }
    await shot(page, 'theme-dark-mark-dialog');
    await page.click('[data-action="rptDismissCancel"]');
    await openDismissedSection(page);
    for (const [name, sel] of [['section summary', '#rpt-dismissed > summary'], ['table header', '#rpt-dismissed thead th'], ['active cell', '#rpt-dismissed tbody td.cell--wrap'], ['revoked muted cell', '#rpt-dismissed div.table-responsive:last-of-type td.rpt-text--muted']]) {
      ratios[name] = await contrastOf(page, sel);
    }
    await scrollToInstant(page, '#rpt-dismissed');
    await shot(page, 'theme-dark-section');
    await page.click('#rpt-dismissed [data-action="rptRevokeIssue"]');
    await page.waitForSelector('#issue-revoke-dialog[open]', { timeout: WAIT });
    ratios['revoke dialog title'] = await contrastOf(page, '#issue-revoke-dialog .modal__title');
    ratios['revoke dialog hint'] = await contrastOf(page, '#issue-revoke-dialog .form-hint');
    await shot(page, 'theme-dark-revoke-dialog');
    const tone = await page.evaluate(() => {
      const active = document.querySelector('#rpt-dismissed div.table-responsive:first-of-type td.cell--wrap');
      const revoked = document.querySelector('#rpt-dismissed div.table-responsive:last-of-type td.rpt-text--muted');
      return { active: active ? getComputedStyle(active).color : null, revoked: revoked ? getComputedStyle(revoked).color : null };
    });
    check(S, 'revoked rows are visibly muted against active rows in the dark theme', tone.active !== null && tone.revoked !== null && tone.active !== tone.revoked, JSON.stringify(tone));
    log('dark contrast ratios:', JSON.stringify(ratios));
    const low = Object.entries(ratios).filter(([, v]) => v === null || v.ratio < 4.5).map(([k, v]) => `${k}=${v ? v.ratio : 'missing'}`);
    check(S, 'every measured text element reaches contrast 4.5:1 in the dark theme', low.length === 0, low.join(', '));
  },

  /** Item 12: keyboard only — open, type, confirm; then open and Escape, focus returns to the opener. */
  async keyboard({ page, world }) {
    const S = 'keyboard';
    const { base, scanId, personas } = world;
    check(S, 'login as global admin', await login(page, base, personas.admin), page.url());
    await openReport(page, base, scanId, 'issues');
    const opener = async (sel) => {
      const b = await dismissButton(page, 'panel-issues', sel);
      await expandGroupOf(page, b);
      await page.evaluate((el) => el.focus(), b);
      return b;
    };
    await opener(HERO.selector);
    await page.keyboard.press('Enter');
    await page.waitForSelector('#issue-dismiss-dialog[open]', { timeout: WAIT });
    check(S, 'Enter on the focused Dismiss button opens the dialog', true);
    check(S, 'focus is in the textarea', (await page.evaluate(() => document.activeElement.id)) === 'issue-dismiss-reason');
    await page.waitForFunction(() => document.querySelector('[data-preview="occurrences"]').textContent === '2', { timeout: WAIT });
    await page.keyboard.type('Typed with the keyboard only.');
    await page.waitForFunction(() => !document.querySelector('[data-action="rptDismissConfirm"]').disabled, { timeout: WAIT });
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const onConfirm = await page.evaluate(() => document.activeElement.getAttribute('data-action'));
    check(S, 'two Tabs from the textarea reach Confirm (Cancel is between)', onConfirm === 'rptDismissConfirm', String(onConfirm));
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: WAIT }), page.keyboard.press('Enter')]);
    await page.waitForSelector('#toast-container .toast', { timeout: WAIT });
    check(S, 'Enter on Confirm marks the finding (toast after reload)', /Finding dismissed/.test(await page.$eval('#toast-container .toast', (t) => t.textContent || '')));

    await showTab(page, 'issues');
    const second = await opener(PROMO.selector);
    void second;
    await page.keyboard.press('Enter');
    await page.waitForSelector('#issue-dismiss-dialog[open]', { timeout: WAIT });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('issue-dismiss-dialog').open, { timeout: WAIT });
    const back = await page.evaluate(() => ({ sel: document.activeElement.getAttribute('data-selector'), action: document.activeElement.getAttribute('data-action') }));
    check(S, 'Escape closes the mark dialog and focus returns to the opener', back.sel === PROMO.selector && back.action === 'rptDismissIssue', JSON.stringify(back));

    await openDismissedSection(page);
    await page.evaluate(() => document.querySelector('#rpt-dismissed [data-action="rptRevokeIssue"]').focus());
    await page.keyboard.press('Enter');
    await page.waitForSelector('#issue-revoke-dialog[open]', { timeout: WAIT });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('issue-revoke-dialog').open, { timeout: WAIT });
    const rb = await page.evaluate(() => ({ action: document.activeElement.getAttribute('data-action'), id: document.activeElement.getAttribute('data-id') !== null }));
    check(S, 'Escape closes the revoke dialog and focus returns to its Revoke button', rb.action === 'rptRevokeIssue' && rb.id, JSON.stringify(rb));
  },

  /** Backstop: 150 dismissals on a site — the page stays responsive and the tables scroll inside .table-responsive. */
  async overflow({ page, world }) {
    const S = 'overflow';
    const { base, bigScanId, personas } = world;
    check(S, 'login as global admin', await login(page, base, personas.admin), page.url());
    const t0 = Date.now();
    await page.goto(`${base}/reports/${bigScanId}`, { waitUntil: 'networkidle0', timeout: WAIT });
    const loadMs = Date.now() - t0;
    log(`150-row report page loaded in ${loadMs} ms`);
    check(S, 'the report page with 150 dismissals loads in under 15 seconds', loadMs < 15000, `${loadMs} ms`);
    await showTab(page, 'issues');
    const summary = await page.$eval('#rpt-dismissed > summary', (s) => s.textContent.trim());
    check(S, 'the section is collapsed and its summary counts 150 active', /150/.test(summary) && (await page.$eval('#rpt-dismissed', (d) => !d.open)), summary);
    const t1 = Date.now();
    await page.click('#rpt-dismissed > summary');
    await page.waitForFunction(() => document.getElementById('rpt-dismissed').open, { timeout: WAIT });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const toggleMs = Date.now() - t1;
    log(`opening the 150-row section took ${toggleMs} ms`);
    check(S, 'opening the section with 150 rows responds within 2 seconds', toggleMs < 2000, `${toggleMs} ms`);
    const info = await page.evaluate(() => {
      const wrap = document.querySelector('#rpt-dismissed .table-responsive');
      return { rows: document.querySelectorAll('#rpt-dismissed table tbody tr').length, inWrap: wrap !== null && wrap.querySelector('table') !== null, region: wrap ? wrap.getAttribute('role') : null };
    });
    check(S, 'all 150 rows are rendered inside a .table-responsive region', info.rows === 150 && info.inWrap && info.region === 'region', JSON.stringify(info));
    const ov = await horizontalOverflow(page);
    check(S, '1280px: no horizontal page scroll with 150 rows', ov.scrollW <= ov.innerW + 2, JSON.stringify(ov));
    await scrollToInstant(page, '#rpt-dismissed');
    await shot(page, 'overflow-150-desktop');
    await setPhone(page);
    await page.reload({ waitUntil: 'networkidle0' });
    await openDismissedSection(page);
    const ovp = await horizontalOverflow(page);
    check(S, '375px: no horizontal page scroll with 150 rows as cards', ovp.scrollW <= ovp.innerW + 2, JSON.stringify(ovp));
    await sleep(100);
  },
};
