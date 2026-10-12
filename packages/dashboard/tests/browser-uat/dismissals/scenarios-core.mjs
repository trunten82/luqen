// Scenarios: tracer, revoke (Plans 04-05, contract unchanged) plus permissions, dialog, refused.
// Each scenario receives { page, browser, world, expect } and uses check() from lib.mjs.
import {
  check, login, WAIT, newPersonaPage, openReport, showTab, pageFetch, jsonOf, shot, dismissButton,
  expandGroupOf, openMarkDialog, confirmMark, openDismissedSection, issueListText, sleep, contrastOf, log, scrollToInstant,
} from './lib.mjs';
import { HERO, NAV, PROMO, WHOLE, REASON } from './fixture.mjs';

const MARK_PATH = (scanId) => `/api/v1/scans/${scanId}/dismissals`;
const PREVIEW_PATH = (scanId, f) => `${MARK_PATH(scanId)}/preview?code=${encodeURIComponent(f.code)}&selector=${encodeURIComponent(f.selector)}`;

/** Counts of ENABLED Dismiss buttons per site, plus the dialogs, for the page currently open. */
export async function controlSurvey(page) {
  return page.evaluate(() => {
    const enabled = (b) => b.getAttribute('aria-disabled') !== 'true';
    const issues = [...document.querySelectorAll('#panel-issues .rpt-dismiss-btn')];
    const templates = [...document.querySelectorAll('#panel-templates .rpt-dismiss-btn')];
    return {
      templateItem: issues.filter((b) => b.closest('.rpt-template-block') && enabled(b)).length,
      pageIssue: issues.filter((b) => !b.closest('.rpt-template-block') && enabled(b)).length,
      templatesTab: templates.filter(enabled).length,
      any: document.querySelectorAll('.rpt-dismiss-btn').length,
      markDialog: document.getElementById('issue-dismiss-dialog') !== null,
      revokeDialog: document.getElementById('issue-revoke-dialog') !== null,
      revokeButtons: document.querySelectorAll('[data-action="rptRevokeIssue"]').length,
      section: document.getElementById('rpt-dismissed') !== null,
      elementHeader: [...document.querySelectorAll('#rpt-dismissed thead th')].some((th) => (th.textContent || '').trim() === 'Element'),
    };
  });
}

/** The three request probes an unpermitted identity must fail with 403 (no write can result). */
async function probe403(S, label, page, scanId, { writeBody }) {
  const mark = await pageFetch(page, 'POST', MARK_PATH(scanId), writeBody);
  check(S, `${label}: a direct mark POST is 403`, mark.status === 403, String(mark.status));
  const preview = await pageFetch(page, 'GET', PREVIEW_PATH(scanId, HERO));
  check(S, `${label}: the preview is 403`, preview.status === 403, String(preview.status));
  const revoke = await pageFetch(page, 'POST', '/api/v1/dismissals/00000000-0000-4000-8000-000000000000/revoke', {});
  check(S, `${label}: a direct revoke POST is 403`, revoke.status === 403, String(revoke.status));
}

export const coreScenarios = {
  /** One page issue, end to end: Dismiss -> dialog -> preview -> reason -> confirm -> reload -> gone. */
  async tracer({ page, world }) {
    const S = 'tracer';
    const { base, scanId, personas } = world;
    check(S, 'login as global admin', await login(page, base, personas.admin), page.url());
    await page.goto(`${base}/reports/${scanId}`, { waitUntil: 'networkidle0', timeout: WAIT });
    await page.click('#tab-issues');
    await page.waitForSelector('#panel-issues:not(.rpt-tab-panel--hidden)', { timeout: WAIT });
    let button = await dismissButton(page, 'panel-issues', HERO.selector);
    check(S, 'a Dismiss button is rendered for the page issue', button !== null);
    await expandGroupOf(page, button);
    button = await dismissButton(page, 'panel-issues', HERO.selector);
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
    await shot(page, 'tracer-dialog');
    const disabledBefore = await page.$eval('[data-action="rptDismissConfirm"]', (b) => b.disabled);
    check(S, 'confirm is disabled before a reason is typed', disabledBefore === true);
    await page.type('#issue-dismiss-reason', REASON);
    await page.waitForFunction(() => !document.querySelector('[data-action="rptDismissConfirm"]').disabled, { timeout: WAIT });
    check(S, 'confirm enables once a reason is typed', true);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: WAIT }),
      page.click('[data-action="rptDismissConfirm"]'),
    ]);
    await page.waitForSelector('#toast-container .toast', { timeout: WAIT });
    const toastText = await page.$eval('#toast-container .toast', (t) => t.textContent || '');
    check(S, 'the success toast is shown after the reload', /Finding dismissed/.test(toastText), toastText);
    // The issue LIST, not the whole panel: the panel ends with the Dismissed section, which names
    // the dismissed element on purpose (D-07).
    const text = await issueListText(page);
    check(S, 'the dismissed finding is gone after reload', !text.includes(HERO.selector), 'hero still listed');
    check(S, 'the other finding is still listed', text.includes(NAV.selector), 'nav missing');
  },

  /** Mark, open the Dismissed section, revoke WITH a comment, then mark+revoke a second one WITHOUT. */
  async revoke({ page, world }) {
    const S = 'revoke';
    const { base, scanId, personas } = world;
    const COMMENT = 'The selector turned out to be too broad.';
    check(S, 'login as global admin', await login(page, base, personas.admin), page.url());
    await openReport(page, base, scanId, 'issues');
    check(S, 'the hero finding has a Dismiss button before the mark', (await dismissButton(page, 'panel-issues', HERO.selector)) !== null);
    await openMarkDialog(page, 'panel-issues', HERO.selector);
    await confirmMark(page, REASON);

    await showTab(page, 'issues');
    check(S, 'the Dismissed section is collapsed by default', (await page.$eval('#rpt-dismissed', (d) => !d.open)) === true);
    await openDismissedSection(page);
    // getComputedStyle reports a transform even where it cannot apply, so the transform value proves
    // nothing. A transform only takes effect on a box that is not plain inline, so the measurable
    // precondition is the marker's display (confirmed by eye: an inline marker stays pointing right).
    const marker = await page.evaluate(() => { const b = getComputedStyle(document.querySelector('#rpt-dismissed > summary'), '::before'); return { display: b.display, transform: b.transform }; });
    check(S, 'the summary marker can rotate: its box is not plain inline (display), so the open-state transform applies', marker.display !== 'inline' && marker.transform !== 'none', JSON.stringify(marker));
    await sleep(350);
    const active = await page.evaluate(() => [...document.querySelectorAll('#rpt-dismissed table')][0]?.querySelector('tbody tr')?.textContent || '');
    check(S, 'the active table lists the dismissal with its reason', active.includes(HERO.code) && active.includes(REASON), active.slice(0, 200));
    await scrollToInstant(page, '#rpt-dismissed');
    await shot(page, 'revoke-section');

    await page.click('#rpt-dismissed [data-action="rptRevokeIssue"]');
    await page.waitForSelector('#issue-revoke-dialog[open]', { timeout: WAIT });
    const focusId = await page.evaluate(() => document.activeElement && document.activeElement.id);
    check(S, 'focus lands in the revoke comment', focusId === 'issue-revoke-comment', String(focusId));
    check(S, 'revoke confirm is enabled without a comment', (await page.$eval('[data-action="rptRevokeConfirm"]', (b) => !b.disabled)) === true);
    await page.type('#issue-revoke-comment', COMMENT);
    await shot(page, 'revoke-dialog');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: WAIT }),
      page.click('[data-action="rptRevokeConfirm"]'),
    ]);
    await page.waitForSelector('#toast-container .toast', { timeout: WAIT });
    const toastText = await page.$eval('#toast-container .toast', (t) => t.textContent || '');
    check(S, 'the revoked toast is shown after the reload', /Dismissal revoked/.test(toastText), toastText);
    check(S, 'finding returns after revoke', (await issueListText(page)).includes(HERO.selector));

    const withComment = await page.evaluate(() => {
      const tables = [...document.querySelectorAll('#rpt-dismissed table')];
      const row = tables.length > 0 ? (tables[tables.length - 1].querySelector('tbody tr')?.textContent || '') : '';
      return { tables: tables.length, row, buttons: document.querySelectorAll('#rpt-dismissed [data-action="rptRevokeIssue"]').length, text: document.getElementById('rpt-dismissed').textContent || '' };
    });
    check(S, 'row moved to revoked with comment', withComment.row.includes(COMMENT) && withComment.row.includes(personas.admin.user), JSON.stringify(withComment).slice(0, 300));
    check(S, 'the revoked row has no Revoke button', withComment.buttons === 0, String(withComment.buttons));
    check(S, 'the section now says there are no active dismissals', withComment.text.includes('No active dismissals.'));
    // "Muted" must be a computed colour, not just a class name: the "No active dismissals." line
    // carries the same class on a <p>, so its computed colour IS the muted token.
    const muted = await page.evaluate(() => {
      const ref = [...document.querySelectorAll('#rpt-dismissed p.rpt-text--muted')][0];
      const cell = document.querySelector('#rpt-dismissed tbody td.rpt-text--muted');
      return { ref: ref ? getComputedStyle(ref).color : null, cell: cell ? getComputedStyle(cell).color : null };
    });
    check(S, 'the revoked cells are visibly muted (computed colour equals the muted token)', muted.ref !== null && muted.cell === muted.ref, JSON.stringify(muted));
    const lightContrast = await contrastOf(page, '#rpt-dismissed tbody td.rpt-text--muted');
    check(S, 'the muted revoked text still reaches contrast 4.5:1 in the light theme', lightContrast !== null && lightContrast.ratio >= 4.5, JSON.stringify(lightContrast));

    // Item 6, second half: a revoke WITHOUT a comment (the body sent is {}), on a second finding.
    await openMarkDialog(page, 'panel-issues', PROMO.selector);
    await confirmMark(page, 'Decorative text over an image, contrast measured by hand.');
    await openDismissedSection(page);
    await page.click('#rpt-dismissed [data-action="rptRevokeIssue"]');
    await page.waitForSelector('#issue-revoke-dialog[open]', { timeout: WAIT });
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: WAIT }),
      page.click('[data-action="rptRevokeConfirm"]'),
    ]);
    await page.waitForSelector('#toast-container .toast', { timeout: WAIT });
    check(S, 'a revoke without a comment succeeds and the finding returns', (await issueListText(page)).includes(PROMO.selector));
    const bare = await page.evaluate((c) => {
      const tables = [...document.querySelectorAll('#rpt-dismissed table')];
      const rows = tables.length > 0 ? [...tables[tables.length - 1].querySelectorAll('tbody tr')].map((r) => r.textContent || '') : [];
      return { rows: rows.length, promo: rows.find((r) => r.includes('.promo-note') || r.includes('1_4_3')) || '', hasOtherComment: rows.some((r) => r.includes(c)) };
    }, COMMENT);
    check(S, 'both revoked rows are listed, the new one carries no comment text', bare.rows === 2 && bare.promo !== '' && !bare.promo.includes(COMMENT), JSON.stringify(bare).slice(0, 300));
  },

  /** Item 1 and the dark/granted persona matrix, including direct POSTs and the role form. */
  async permissions({ browser, world, expect }) {
    const S = 'permissions';
    const { base, scanId, personas } = world;
    const granted = expect === 'granted';
    const body = { code: HERO.code, selector: HERO.selector, reason: 'Probe from an unpermitted persona.' };

    const admin = await newPersonaPage(browser, base, personas.admin);
    check(S, 'login as global admin', admin.ok);
    await openReport(admin.page, base, scanId);
    await showTab(admin.page, 'issues');
    const a = await controlSurvey(admin.page);
    check(S, 'admin: Dismiss is offered on a template item', a.templateItem > 0, JSON.stringify(a));
    check(S, 'admin: Dismiss is offered on a page issue', a.pageIssue > 0, JSON.stringify(a));
    await showTab(admin.page, 'templates');
    check(S, 'admin: Dismiss is offered on a Templates-tab item', (await controlSurvey(admin.page)).templatesTab > 0);
    check(S, 'admin: both dialogs are in the page', a.markDialog && a.revokeDialog, JSON.stringify(a));
    // One existing dismissal so the non-admin personas have a Dismissed section to look at.
    const seeded = await pageFetch(admin.page, 'POST', MARK_PATH(scanId), { code: PROMO.code, selector: PROMO.selector, reason: REASON });
    check(S, 'admin: the seeding mark is accepted (201)', seeded.status === 201, String(seeded.status));
    // Positive control for the Element-column check further down: an admin DOES get that header.
    await openReport(admin.page, base, scanId, 'issues');
    const aAfter = await controlSurvey(admin.page);
    check(S, 'admin: the Dismissed section has an Element column (so its absence below is meaningful)', aAfter.section && aAfter.elementHeader === true, JSON.stringify(aAfter));
    await admin.context.close();

    const roleForm = async (label, page) => {
      const res = await page.goto(`${base}/admin/roles/new`, { waitUntil: 'domcontentloaded', timeout: WAIT });
      const html = await page.content();
      check(S, `${label}: the role form loads`, res.status() === 200 && html.includes('reports.export'), String(res.status()));
      const offers = html.includes('issues.dismiss') || html.includes('Mark findings as false positives');
      // Dark: the permission is not grantable to a custom role, asserted. Granted: whether custom roles may
      // carry it is the owner's D-15 answer (Plan 09), so the direction is reported, not asserted.
      if (granted) log(`${label}: the role form ${offers ? 'offers' : 'does not offer'} issues.dismiss (reported, not asserted)`);
      else check(S, `${label}: the role form offers no issues.dismiss`, !offers);
    };

    // The org Owner: dark -> no control and 403s; granted -> control and a successful mark.
    const owner = await newPersonaPage(browser, base, personas.owner);
    check(S, 'login as the org Owner', owner.ok);
    await openReport(owner.page, base, scanId);
    await showTab(owner.page, 'issues');
    const o = await controlSurvey(owner.page);
    if (granted) {
      check(S, 'owner (granted): Dismiss is offered on all three sites', o.templateItem > 0 && o.pageIssue > 0 && o.markDialog, JSON.stringify(o));
      const mark = await pageFetch(owner.page, 'POST', MARK_PATH(scanId), { code: HERO.code, selector: HERO.selector, reason: 'Granted Owner marks a finding.' });
      check(S, 'owner (granted): a mark succeeds (201)', mark.status === 201, String(mark.status));
      const pv = await pageFetch(owner.page, 'GET', PREVIEW_PATH(scanId, HERO));
      check(S, 'owner (granted): the preview is 200', pv.status === 200, String(pv.status));
    } else {
      check(S, 'owner (dark): no Dismiss control anywhere on the Issues tab', o.any === 0, JSON.stringify(o));
      check(S, 'owner (dark): neither dialog is in the page', !o.markDialog && !o.revokeDialog, JSON.stringify(o));
      await showTab(owner.page, 'templates').catch(() => {});
      check(S, 'owner (dark): no control on the Templates tab either', (await controlSurvey(owner.page)).any === 0);
      await probe403(S, 'owner (dark)', owner.page, scanId, { writeBody: body });
    }
    check(S, 'owner: sees the Dismissed section the admin created', o.section === true, JSON.stringify(o));
    check(S, 'owner: has no Revoke button while not permitted, or has it when granted', granted ? o.revokeButtons > 0 : o.revokeButtons === 0, String(o.revokeButtons));
    await roleForm(granted ? 'owner (granted)' : 'owner (dark)', owner.page);
    await owner.context.close();

    // A reports.view-only identity: no control, the section without Revoke and without Element.
    const ro = await newPersonaPage(browser, base, personas.reportsOnly);
    check(S, 'login as the reports.view-only user', ro.ok);
    await openReport(ro.page, base, scanId, 'issues');
    const r = await controlSurvey(ro.page);
    check(S, 'reports.view-only: no Dismiss control and no dialog', r.any === 0 && !r.markDialog && !r.revokeDialog, JSON.stringify(r));
    check(S, 'reports.view-only: the Dismissed section is visible', r.section === true, JSON.stringify(r));
    check(S, 'reports.view-only: the section has no Revoke button', r.revokeButtons === 0, String(r.revokeButtons));
    check(S, 'reports.view-only: the Element column is omitted without reports.view_technical (UD-08)', r.elementHeader === false, JSON.stringify(r));
    await probe403(S, 'reports.view-only', ro.page, scanId, { writeBody: body });
    await ro.context.close();

    if (granted) {
      for (const name of ['member', 'viewer']) {
        const m = await newPersonaPage(browser, base, personas[name]);
        check(S, `login as the org ${name}`, m.ok);
        await openReport(m.page, base, scanId, 'issues');
        const s = await controlSurvey(m.page);
        check(S, `${name} (granted): no Dismiss control, no dialog, no Revoke`, s.any === 0 && !s.markDialog && s.revokeButtons === 0, JSON.stringify(s));
        await probe403(S, `${name} (granted)`, m.page, scanId, { writeBody: body });
        await m.context.close();
      }
    }
    await sleep(100);
  },

  /** Item 2: the mark dialog's gating, counter and preview numbers. */
  async dialog({ page, world }) {
    const S = 'dialog';
    const { base, scanId, personas } = world;
    check(S, 'login as global admin', await login(page, base, personas.admin), page.url());
    await openReport(page, base, scanId, 'issues');
    await openMarkDialog(page, 'panel-issues', HERO.selector);
    const focusId = await page.evaluate(() => document.activeElement && document.activeElement.id);
    check(S, 'focus lands in the reason textarea', focusId === 'issue-dismiss-reason', String(focusId));
    const nums = await page.evaluate(() => ({ occ: document.querySelector('[data-preview="occurrences"]').textContent, pages: document.querySelector('[data-preview="pages"]').textContent }));
    check(S, 'preview numbers are shown before confirm (2 occurrences, 2 pages)', nums.occ === '2' && nums.pages === '2', JSON.stringify(nums));
    const confirmDisabled = () => page.$eval('[data-action="rptDismissConfirm"]', (b) => b.disabled);
    check(S, 'confirm is disabled with an empty reason', (await confirmDisabled()) === true);
    await page.type('#issue-dismiss-reason', '   ');
    await sleep(150);
    check(S, 'confirm stays disabled with a whitespace-only reason', (await confirmDisabled()) === true);
    check(S, 'the counter shows the raw length of the whitespace (3)', (await page.$eval('[data-reason-count]', (e) => e.textContent)) === '3');
    await page.type('#issue-dismiss-reason', 'Valid reason');
    await page.waitForFunction(() => !document.querySelector('[data-action="rptDismissConfirm"]').disabled, { timeout: WAIT });
    check(S, 'confirm enables with a valid reason', true);
    check(S, 'the counter shows the raw length (15)', (await page.$eval('[data-reason-count]', (e) => e.textContent)) === '15');
    await page.click('[data-action="rptDismissCancel"]');
    await page.waitForFunction(() => !document.getElementById('issue-dismiss-dialog').open, { timeout: WAIT });
    const list = await page.evaluate(async (id) => (await fetch(`/api/v1/scans/${id}/dismissals`, { credentials: 'include' })).json(), scanId);
    check(S, 'Cancel closes the dialog and writes nothing', Array.isArray(list.dismissals) && list.dismissals.length === 0, JSON.stringify(list).slice(0, 120));
  },

  /** Item 3: the whole-page selector's button is aria-disabled and opens nothing. */
  async refused({ page, world }) {
    const S = 'refused';
    const { base, scanId, personas } = world;
    check(S, 'login as global admin', await login(page, base, personas.admin), page.url());
    await openReport(page, base, scanId, 'issues');
    const button = await dismissButton(page, 'panel-issues', WHOLE.selector);
    // A refused button carries no data-selector, so find it by its aria-disabled flag instead.
    const refused = (await page.evaluateHandle(() => [...document.querySelectorAll('#panel-issues .rpt-dismiss-btn')].find((b) => b.getAttribute('aria-disabled') === 'true') || null)).asElement();
    check(S, 'a refused (aria-disabled) button exists for the whole-page selector', refused !== null && button === null);
    await expandGroupOf(page, refused);
    const attrs = await page.evaluate((b) => ({ title: b.getAttribute('title') || '', describedby: b.getAttribute('aria-describedby') || '', described: document.getElementById(b.getAttribute('aria-describedby') || '__none__') !== null, action: b.getAttribute('data-action') }), refused);
    check(S, 'it has a translated title and a description element, and no action', attrs.title.length > 10 && attrs.described && attrs.action === null, JSON.stringify(attrs));
    await refused.click();
    await sleep(600);
    const opened = await page.evaluate(() => document.querySelector('dialog[open]') !== null);
    check(S, 'clicking it opens nothing', opened === false);
    await shot(page, 'refused-button');
  },
};
