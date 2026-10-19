// Scenarios added by the 89-11 gap closure (the owner's D-15 Q1 review items):
//   attribution  item 2: an API-key actor reads "API key: <label>" only for the scan org's own key,
//                and the stored `api-key:<id>` identifier never reaches the page.
//   twins        item 6: two page issues with the same rule and selector are one dismissal, and the
//                dialog says so before Confirm.
//   layout       items 3-5: both dialogs show Cancel and Confirm at open with NO scroll call; the
//                Dismissed tables fit 1280px; the assistant launcher covers nothing at the page bottom.
// Every "at open" measurement reads geometry only. The older dialogButtonsReachable checks in
// scenarios-view.mjs scroll each button into view first, so they measure reachability, not this.
import {
  check, login, WAIT, PHONE, DESKTOP, openReport, showTab, pageFetch, jsonOf, shot, openMarkDialog, confirmMark,
  openDismissedSection, horizontalOverflow, localeString, scrollToInstant, expandGroupOf, clearToasts,
} from './lib.mjs';
import { HERO, NAV, PROMO, LONG } from './fixture.mjs';
import { setLocale } from './scenarios-view.mjs';

/** Per-scenario world options for bootLocal (the default world is unchanged). */
export const GAP_WORLD = {
  attribution: { apiKeyActors: true },
};

const markApi = async (page, scanId, f, reason) =>
  jsonOf(await pageFetch(page, 'POST', `/api/v1/scans/${scanId}/dismissals`, { code: f.code, selector: f.selector, reason }));
const revokeApi = (page, id, comment) => pageFetch(page, 'POST', `/api/v1/dismissals/${id}/revoke`, { comment });

/** Dismissed-by text per rule code in the active table (cells found by their translated data-label). */
async function dismissedByTexts(page, locale = 'en') {
  const label = localeString(locale, 'issueDismissals.col.dismissedBy');
  return page.evaluate((l) => {
    const out = {};
    const table = document.querySelector('#rpt-dismissed .table-responsive table');
    for (const tr of table ? table.querySelectorAll('tbody tr') : []) {
      const code = (tr.querySelector('td').textContent || '').trim();
      const cell = tr.querySelector(`td[data-label="${l}"]`);
      out[code] = cell ? { text: (cell.textContent || '').trim(), title: cell.getAttribute('title') } : null;
    }
    return out;
  }, label);
}

/** Geometry of an open dialog as it is on screen. Reads only: no scrollIntoView, no scrollTo. */
function atOpen(page, dialogId) {
  return page.evaluate((id) => {
    const d = document.getElementById(id);
    const dr = d.getBoundingClientRect();
    const footer = d.querySelector('.modal__footer');
    const fr = footer.getBoundingClientRect();
    const inView = (r) => r.left >= 0 && r.right <= window.innerWidth && r.top >= 0 && r.bottom <= window.innerHeight;
    const inDialog = (r) => r.left >= dr.left && r.right <= dr.right && r.top >= dr.top && r.bottom <= dr.bottom;
    const buttons = [...footer.querySelectorAll('button')].map((b) => {
      const r = b.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { label: (b.textContent || '').trim().slice(0, 24), inView: inView(r), inDialog: inDialog(r), uncovered: hit === b || b.contains(hit) };
    });
    const ta = d.querySelector('textarea');
    const tr = ta.getBoundingClientRect();
    const taHit = document.elementFromPoint(tr.left + tr.width / 2, tr.top + tr.height / 2);
    const bg = (el) => getComputedStyle(el).backgroundColor;
    return {
      buttons,
      ok: buttons.length === 2 && buttons.every((b) => b.inView && b.inDialog && b.uncovered),
      textarea: { focused: document.activeElement === ta, inView: inView(tr), inDialog: inDialog(tr), aboveFooter: tr.bottom <= fr.top + 1, uncovered: taHit === ta },
      footerBg: bg(footer), dialogBg: bg(d),
      dialogH: Math.round(dr.height), scrollTop: Math.round(d.scrollTop), pageScrollY: Math.round(window.scrollY), vh: window.innerHeight,
    };
  }, dialogId);
}

const opaqueSame = (m) => m.footerBg === m.dialogBg && !/rgba\([^)]*,\s*0\)|transparent/.test(m.footerBg);

/** Dismissed tables at desktop width: inner scroll, header containment, rule-code lines, comment widths. */
function tableGeometry(page) {
  return page.evaluate(() => [...document.querySelectorAll('#rpt-dismissed .table-responsive')].map((region) => {
    const rr = region.getBoundingClientRect();
    const heads = [...region.querySelectorAll('thead th')];
    const ruleLines = [...region.querySelectorAll('tbody tr')].map((tr) => tr.querySelector('td:first-child .rpt-code').getClientRects().length);
    const commentHead = heads.length ? heads[heads.length - 1] : null;
    const comments = [...region.querySelectorAll('tbody tr td.cell--wrap:last-child')].map((td) => Math.round(td.getBoundingClientRect().width));
    return {
      scrollW: region.scrollWidth, clientW: region.clientWidth,
      headsInside: heads.every((th) => th.getBoundingClientRect().right <= rr.right + 1),
      maxRuleLines: Math.max(...ruleLines), commentWidths: comments,
      commentHeadInside: commentHead ? commentHead.getBoundingClientRect().right <= rr.right + 1 : null,
    };
  }));
}

/**
 * Scroll the page to its very bottom (instant), then the launcher against the targets of `mode`:
 *   'revoke'  the last Revoke button and every cell of the last revoked row;
 *   'dismiss' the last visible Dismiss button on the Issues tab.
 */
async function launcherAtBottom(page, mode) {
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  return page.evaluate((m) => {
    const l = document.getElementById('agent-launch');
    const lr = l ? l.getBoundingClientRect() : null;
    const cs = l ? getComputedStyle(l) : null;
    const visible = Boolean(l && cs.display !== 'none' && cs.visibility !== 'hidden' && lr.width > 0 && lr.bottom <= window.innerHeight && lr.right <= window.innerWidth);
    let targets = [];
    if (m === 'revoke') {
      const revokes = [...document.querySelectorAll('#rpt-dismissed [data-action="rptRevokeIssue"]')];
      const regions = document.querySelectorAll('#rpt-dismissed .table-responsive');
      const rows = regions.length > 1 ? regions[regions.length - 1].querySelectorAll('tbody tr') : [];
      const lastRow = rows.length ? rows[rows.length - 1] : null;
      targets = [...(revokes.length ? [revokes[revokes.length - 1]] : []), ...(lastRow ? [...lastRow.querySelectorAll('td')] : [])];
    } else {
      const all = [...document.querySelectorAll('#panel-issues .rpt-dismiss-btn')].filter((b) => b.getClientRects().length > 0);
      targets = all.length ? [all[all.length - 1]] : [];
    }
    const hits = targets.filter((el) => { const r = el.getBoundingClientRect(); return lr && r.left < lr.right && lr.left < r.right && r.top < lr.bottom && lr.top < r.bottom; });
    return { visible, targets: targets.length, covered: hits.map((el) => (el.getAttribute('data-label') || el.textContent || '').trim().slice(0, 20)) };
  }, mode);
}

async function expandLastIssueGroup(page) {
  const btn = (await page.evaluateHandle(() => {
    const groups = document.querySelectorAll('#panel-issues .rpt-group');
    const last = groups[groups.length - 1];
    return last ? last.querySelector('.rpt-dismiss-btn') : null;
  })).asElement();
  if (btn) await expandGroupOf(page, btn);
}

async function clearance(S, page, base, scanId, width, { withDismissals }) {
  await openReport(page, base, scanId, 'issues');
  await clearToasts(page);
  if (withDismissals) await openDismissedSection(page); else await expandLastIssueGroup(page);
  const m = await launcherAtBottom(page, withDismissals ? 'revoke' : 'dismiss');
  check(S, `${width}px: positive control: the assistant launcher is present and visible`, m.visible, JSON.stringify(m));
  if (withDismissals) {
    check(S, `${width}px: at the page bottom it covers neither the last Revoke button nor any cell of the last revoked row`, m.targets >= 2 && m.covered.length === 0, JSON.stringify(m));
    await shot(page, `gap-bottom-${width}`);
  } else {
    check(S, `${width}px: with zero dismissals, at the page bottom it does not cover the last Dismiss button on the Issues tab`, m.targets === 1 && m.covered.length === 0, JSON.stringify(m));
  }
}

export const gapScenarios = {
  /** Item 2 (D-12; D-15 Q1 reverses the UD-16 title clause). */
  async attribution({ page, world }) {
    const S = 'attribution';
    const { base, scanId, personas, keyActors } = world;
    check(S, 'fixture: the world seeded an org key and a system key as dismissal actors', Boolean(keyActors && keyActors.fabrikamKeyId && keyActors.systemKeyId));
    check(S, 'login as global admin', await login(page, base, personas.admin), page.url());
    await openReport(page, base, scanId, 'issues');
    await openDismissedSection(page);
    const by = await dismissedByTexts(page);
    check(S, 'positive control: both API-key dismissals are listed', Boolean(by[keyActors.fabrikamCode] && by[keyActors.systemCode]), JSON.stringify(by));
    // HARD-08: a named key carries its creation time as a tag, "API key: <label> (Created <time>)".
    check(S, 'the org-key dismissal reads API key: Fabrikam CI with its creation-time tag',
      /^API key: Fabrikam CI \(Created \S.*\)$/.test(by[keyActors.fabrikamCode].text), JSON.stringify(by[keyActors.fabrikamCode]));
    check(S, 'the system-key dismissal reads API key', by[keyActors.systemCode].text === 'API key', JSON.stringify(by[keyActors.systemCode]));
    const html = await page.$eval('#rpt-dismissed', (d) => d.outerHTML);
    check(S, 'the section HTML contains no api-key: identifier and no key id',
      !html.includes('api-key:') && !html.includes(keyActors.fabrikamKeyId) && !html.includes(keyActors.systemKeyId));
    await scrollToInstant(page, '#rpt-dismissed');
    await shot(page, 'gap-attribution-1280');
  },

  /** Item 6 (D-04, D-10, UD-05): one key, several occurrences, one dismissal; the dialog says so. */
  async twins({ page, world }) {
    const S = 'twins';
    const { base, scanId, personas } = world;
    const together = localeString('en', 'issueDismissals.dialog.preview.together');
    const twinButtons = () => page.$$eval('#panel-issues .rpt-dismiss-btn[data-action="rptDismissIssue"]', (bs, c, s) =>
      bs.filter((b) => b.getAttribute('data-code') === c && b.getAttribute('data-selector') === s).length, HERO.code, HERO.selector);
    const dialogState = () => page.evaluate(() => ({
      occ: document.querySelector('[data-preview="occurrences"]').textContent.trim(),
      status: document.querySelector('[data-preview="status"]').textContent.trim(),
    }));
    check(S, 'login as global admin', await login(page, base, personas.admin), page.url());
    await openReport(page, base, scanId, 'issues');
    check(S, 'positive control: the twin finding has two Dismiss buttons', (await twinButtons()) === 2, String(await twinButtons()));

    await openMarkDialog(page, 'panel-issues', HERO.selector, HERO.code);
    const twin = await dialogState();
    check(S, "the twin's dialog shows 2 occurrences and the together text", twin.occ === '2' && twin.status === together, JSON.stringify(twin));
    await shot(page, 'gap-twins-dialog-1280');
    await page.click('[data-action="rptDismissCancel"]');

    await openMarkDialog(page, 'panel-templates', NAV.selector, NAV.code);
    const tpl = await dialogState();
    check(S, "the template item's dialog (4 occurrences) shows the together text", tpl.occ === '4' && tpl.status === together, JSON.stringify(tpl));
    await page.click('[data-action="rptDismissCancel"]');

    await openMarkDialog(page, 'panel-issues', PROMO.selector, PROMO.code);
    const single = await dialogState();
    check(S, "a single-occurrence finding's dialog shows no together text", single.occ === '1' && single.status === '', JSON.stringify(single));
    await page.click('[data-action="rptDismissCancel"]');

    await openMarkDialog(page, 'panel-issues', HERO.selector, HERO.code);
    await confirmMark(page, 'Both occurrences are the same decorative image.');
    await showTab(page, 'issues');
    const left = await twinButtons();
    await openDismissedSection(page);
    const rows = await page.$$eval('#rpt-dismissed .table-responsive:first-of-type tbody tr', (trs, c) =>
      trs.filter((tr) => (tr.querySelector('td').textContent || '').trim() === c).length, HERO.code);
    check(S, 'after confirming from one twin neither twin keeps a Dismiss button and one active row lists the key', left === 0 && rows === 1, JSON.stringify({ left, rows }));
  },

  /** Items 3, 4, 5 (D-02, D-07, D-11). */
  async layout({ page, world }) {
    const S = 'layout';
    const { base, scanId, personas } = world;
    check(S, 'login as global admin', await login(page, base, personas.admin), page.url());

    // Item 5 with zero dismissals (the world has none on this site yet).
    await clearance(S, page, base, scanId, 1280, { withDismissals: false });

    // Item 3: the mark dialog at open, 1280x800, en/de/it.
    for (const locale of ['en', 'de', 'it']) {
      await setLocale(page, locale);
      await openReport(page, base, scanId, 'issues');
      await openMarkDialog(page, 'panel-issues', HERO.selector, HERO.code);
      const m = await atOpen(page, 'issue-dismiss-dialog');
      check(S, `1280x800 ${locale}: the mark dialog's Cancel and Confirm are inside the viewport and the dialog box and uncovered at open`, m.ok, JSON.stringify(m));
      if (locale === 'en') {
        check(S, '1280x800: the focused textarea is uncovered at open', Object.values(m.textarea).every(Boolean), JSON.stringify(m.textarea));
        check(S, '1280x800 light: the footer background equals the dialog background', opaqueSame(m), JSON.stringify({ f: m.footerBg, d: m.dialogBg }));
      }
      await shot(page, locale === 'en' ? 'gap-mark-open-1280' : `gap-mark-open-1280-${locale}`);
      await page.click('[data-action="rptDismissCancel"]');
    }
    await setLocale(page, 'en');
    await openReport(page, base, scanId, 'issues');
    await openMarkDialog(page, 'panel-issues', LONG.selector, LONG.code);
    const long = await atOpen(page, 'issue-dismiss-dialog');
    check(S, '1280x800: with the 600-char selector the mark dialog shows Cancel and Confirm at open', long.ok, JSON.stringify(long));
    await shot(page, 'gap-mark-open-1280-long');
    await page.click('[data-action="rptDismissCancel"]');

    // Dark theme: the footer is as opaque as the dialog.
    await page.evaluate(() => localStorage.setItem('luqen-theme', 'dark'));
    await openReport(page, base, scanId, 'issues');
    await openMarkDialog(page, 'panel-issues', HERO.selector, HERO.code);
    const dark = await atOpen(page, 'issue-dismiss-dialog');
    const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    check(S, '1280x800 dark: the footer background equals the dialog background', theme === 'dark' && opaqueSame(dark), JSON.stringify({ theme, f: dark.footerBg, d: dark.dialogBg }));
    await shot(page, 'gap-mark-open-dark-1280');
    await page.click('[data-action="rptDismissCancel"]');
    await page.evaluate(() => localStorage.setItem('luqen-theme', 'light'));

    // 375x812: the mark dialog at open.
    await page.setViewport(PHONE);
    await openReport(page, base, scanId, 'issues');
    await openMarkDialog(page, 'panel-issues', HERO.selector, HERO.code);
    const phone = await atOpen(page, 'issue-dismiss-dialog');
    check(S, "375x812: the mark dialog's Cancel and Confirm are inside the viewport and the dialog box and uncovered at open", phone.ok, JSON.stringify(phone));
    await shot(page, 'gap-mark-open-375');
    await page.click('[data-action="rptDismissCancel"]');
    await clearance(S, page, base, scanId, 375, { withDismissals: false });
    await page.setViewport(DESKTOP);

    // Prod-shaped rows: a 41-char rule code, a ~60-char reason, a short comment.
    const hero = await markApi(page, scanId, HERO, 'Decorative image; the alternative text is set by a script.');
    const promo = await markApi(page, scanId, PROMO, 'Contrast measured on the hover state, not the resting one.');
    await revokeApi(page, promo.id, 'Measured again.');
    check(S, 'fixture: one active and one revoked prod-shaped row', Boolean(hero && hero.id && promo && promo.id), JSON.stringify({ hero: Boolean(hero), promo: Boolean(promo) }));
    await openReport(page, base, scanId, 'issues');
    await openDismissedSection(page);
    const t = await tableGeometry(page);
    check(S, '1280x800 prod-shaped rows: both regions have no inner horizontal scroll and every header is inside its region', t.length === 2 && t.every((r) => r.scrollW <= r.clientW + 1 && r.headsInside), JSON.stringify(t));
    check(S, '1280x800: the rule code renders on at most 2 lines in both tables', t.length === 2 && t.every((r) => r.maxRuleLines <= 2), JSON.stringify(t.map((r) => r.maxRuleLines)));
    await scrollToInstant(page, '#rpt-dismissed');
    await shot(page, 'gap-tables-1280');

    // Item 3: the revoke dialog at open, 1280 and 375.
    await page.click('#rpt-dismissed [data-action="rptRevokeIssue"]');
    await page.waitForSelector('#issue-revoke-dialog[open]', { timeout: WAIT });
    const rv = await atOpen(page, 'issue-revoke-dialog');
    check(S, '1280x800: the revoke dialog shows Cancel and Confirm at open', rv.ok, JSON.stringify(rv));
    await shot(page, 'gap-revoke-open-1280');
    await page.click('[data-action="rptRevokeCancel"]');

    // Item 5 with dismissals.
    await clearance(S, page, base, scanId, 1280, { withDismissals: true });
    await page.setViewport(PHONE);
    await openReport(page, base, scanId, 'issues');
    await openDismissedSection(page);
    await page.click('#rpt-dismissed [data-action="rptRevokeIssue"]');
    await page.waitForSelector('#issue-revoke-dialog[open]', { timeout: WAIT });
    const rvp = await atOpen(page, 'issue-revoke-dialog');
    check(S, '375x812: the revoke dialog shows Cancel and Confirm at open', rvp.ok, JSON.stringify(rvp));
    await page.click('[data-action="rptRevokeCancel"]');
    await clearance(S, page, base, scanId, 375, { withDismissals: true });
    await page.setViewport(DESKTOP);

    // Item 4 long text: 1000-char reason and comment on the 600-char selector's finding.
    const reason = `${'Long reason words '.repeat(60).slice(0, 860)}${'x'.repeat(140)}`.slice(0, 1000);
    const comment = `${'Long comment words '.repeat(60).slice(0, 860)}${'y'.repeat(140)}`.slice(0, 1000);
    const lng = await markApi(page, scanId, LONG, reason);
    await revokeApi(page, lng.id, comment);
    await openReport(page, base, scanId, 'issues');
    await openDismissedSection(page);
    const tl = await tableGeometry(page);
    const ov = await horizontalOverflow(page);
    const minComment = Math.min(...tl[tl.length - 1].commentWidths);
    check(S, '1280x800 long text: rule code at most 2 lines, Comment cell at least 120px wide, no page scroll',
      tl.every((r) => r.maxRuleLines <= 2) && minComment >= 120 && ov.scrollW <= ov.innerW + 2, JSON.stringify({ tl, ov, minComment }));
    // The long row is tall and its cells are vertically centred: frame the rule code of that row.
    await page.evaluate((code) => {
      const cell = [...document.querySelectorAll('#rpt-dismissed td:first-child .rpt-code')].find((e) => (e.textContent || '').trim() === code);
      if (cell) cell.scrollIntoView({ block: 'center', behavior: 'instant' });
    }, LONG.code);
    await shot(page, 'gap-tables-long-1280');
  },
};
