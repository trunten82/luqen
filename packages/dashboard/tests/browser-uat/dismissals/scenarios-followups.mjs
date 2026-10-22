// Scenario added by Phase 95 (dismissal audit and team follow-ups): the visible changes of the phase,
// looked at in a real browser at phone width and by keyboard, with screenshots under .tmp/shots/.
//
//   a  A11Y-01  the greyed Dismiss button's reason at 375px (a box on screen, not screen-reader-only text,
//               right under the button, no sideways scroll, still there after a tap)
//   b  A11Y-01  the same by real key presses (Tab reaches the button, the reason is visible while it has
//               focus, Enter and Space open nothing)
//   c  COPY-01  the dismiss dialog's scope sentence
//   d  AUD-01   an org Owner finds the Audit Log in the menu
//   e  AUD-02, ACT-02, TEAM-02  the Action filter shows the dismissal action, the Actor column names API
//               keys like the report page, Load More carries the page size
//   f  AUD-03   a viewer without the permission gets the dashboard's error page
//   g  TEAM-01, TEAM-03, TEAM-04  the team form's organization option, Add Member offering a teamless
//               member, the empty row going after the first add
// Persona logins: admin, owner, viewer (three; the login limit is 10 per 15 minutes per IP).
import {
  check, login, WAIT, PHONE, DESKTOP, newPersonaPage, openReport, openMarkDialog, expandGroupOf, shot,
  localeString, horizontalOverflow, sleep,
} from './lib.mjs';
import { HERO } from './fixture.mjs';
import { KEY_TIMES } from './world.mjs';

/** Per-scenario world options for bootLocal. */
export const FOLLOWUPS_WORLD = {
  followups: { apiKeyActors: true, unteamed: true },
};

/** The greyed (aria-disabled) Dismiss button of the whole-page finding, or null. */
async function refusedButton(page) {
  const handle = await page.evaluateHandle(() => [...document.querySelectorAll('#panel-issues .rpt-dismiss-btn')]
    .find((b) => b.getAttribute('aria-disabled') === 'true') || null);
  return handle.asElement();
}

/** Where the reason named by aria-describedby is, and whether it is on screen as ordinary text. */
function reasonState(page, button) {
  return page.evaluate((b) => {
    const r = document.getElementById(b.getAttribute('aria-describedby') || '__none__');
    if (!r) return null;
    const rb = r.getBoundingClientRect();
    const bb = b.getBoundingClientRect();
    const cs = getComputedStyle(r);
    return {
      text: (r.textContent || '').trim(),
      width: Math.round(rb.width), height: Math.round(rb.height),
      onScreen: rb.width > 1 && rb.height > 1 && cs.display !== 'none' && cs.visibility === 'visible'
        && rb.left >= 0 && rb.right <= window.innerWidth,
      inView: rb.top >= 0 && rb.bottom <= window.innerHeight,
      srOnly: r.closest('.sr-only') !== null,
      below: Math.round(rb.top - bb.bottom),
      innerW: window.innerWidth,
    };
  }, button);
}

/** Wait until the page stops scrolling (the page scrolls smoothly, so a read right after a key press races it). */
async function settleScroll(page) {
  let last = -1;
  for (let i = 0; i < 40; i += 1) {
    const y = await page.evaluate(() => Math.round(window.scrollY));
    if (y === last) return;
    last = y;
    await sleep(150);
  }
}

const dialogOpen = (page) => page.evaluate(() => document.querySelector('dialog[open]') !== null);

/** The Actor cell texts and the Load More link of the Audit Log page now open. */
function auditSurvey(page) {
  return page.evaluate(() => ({
    actors: [...document.querySelectorAll('td[data-label="Actor"]')].map((td) => (td.textContent || '').trim()),
    filter: (document.getElementById('filter-action') || { value: null }).value,
    loadMore: (document.querySelector('.load-more a') || { getAttribute: () => null }).getAttribute('href'),
    html: document.documentElement.outerHTML,
  }));
}

async function stepRefusedPhone(S, page, world) {
  const { base, scanId, personas } = world;
  await page.setViewport(PHONE);
  check(S, 'login as global admin on a 375px phone', await login(page, base, personas.admin), page.url());
  await openReport(page, base, scanId, 'issues');
  const button = await refusedButton(page);
  check(S, '375px: a greyed Dismiss exists for the whole-page finding', button !== null);
  await expandGroupOf(page, button);
  await page.evaluate((b) => { b.scrollIntoView({ block: 'center', behavior: 'instant' }); }, button);
  const want = localeString('en', 'issueDismissals.action.refusedTitle');
  const r = await reasonState(page, button);
  const detail = JSON.stringify(r);
  check(S, '375px: the greyed Dismiss reason has a box on screen, inside the viewport', r !== null && r.onScreen, detail);
  check(S, '375px: the reason is ordinary text, not screen-reader-only text', r !== null && r.srOnly === false, detail);
  check(S, '375px: the reason reads the refused text', r !== null && typeof want === 'string' && r.text === want, detail);
  check(S, '375px: the reason sits right under the button (at most 48px below its bottom)', r !== null && r.below >= -2 && r.below <= 48, detail);
  const overflow = await horizontalOverflow(page);
  check(S, '375px: the page has no sideways scroll', overflow.scrollW <= overflow.innerW + 2, JSON.stringify(overflow));
  await shot(page, 'followups-refused-375');
  const box = await button.boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await sleep(600);
  check(S, '375px: tapping the greyed button opens no dialog', (await dialogOpen(page)) === false);
  const after = await reasonState(page, button);
  check(S, '375px: after the tap the reason is still on screen', after !== null && after.onScreen && after.srOnly === false, JSON.stringify(after));
}

async function stepRefusedKeyboard(S, page, world) {
  const { base, scanId } = world;
  await page.setViewport(DESKTOP);
  await openReport(page, base, scanId, 'issues');
  const button = await refusedButton(page);
  check(S, 'keyboard: a greyed Dismiss exists on the desktop page', button !== null);
  await expandGroupOf(page, button);
  // Setup only: put focus on the group header, then use real key presses from there.
  await page.evaluate((b) => b.closest('.rpt-group').querySelector('.rpt-group__header').focus(), button);
  let presses = 0;
  let reached = false;
  while (presses < 40 && !reached) {
    await page.keyboard.press('Tab');
    presses += 1;
    reached = await page.evaluate((b) => document.activeElement === b, button);
  }
  check(S, `keyboard: Tab from the group header reaches the greyed Dismiss (${presses} presses)`, reached, String(presses));
  await settleScroll(page);
  const r = await reasonState(page, button);
  check(S, 'keyboard: while the greyed button has focus its reason is on screen as ordinary text', r !== null && r.onScreen && r.srOnly === false, JSON.stringify(r));
  check(S, 'keyboard: while the greyed button has focus its reason is inside the visible window (no scroll needed)', r !== null && r.inView, JSON.stringify(r));
  const hit = await page.evaluate((b) => {
    const rect = b.getBoundingClientRect();
    const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return { covered: !(top === b || b.contains(top)), by: top ? (top.id || top.className || top.tagName) : null };
  }, button);
  check(S, 'keyboard: while the greyed button has focus nothing (the assistant launcher) covers it', hit.covered === false, JSON.stringify(hit));
  const ring = await page.evaluate(() => {
    const cs = getComputedStyle(document.activeElement);
    return { outline: `${cs.outlineStyle} ${cs.outlineWidth}`, shadow: cs.boxShadow };
  });
  const hasRing = (ring.outline !== 'none 0px' && !ring.outline.startsWith('none')) || ring.shadow !== 'none';
  check(S, 'keyboard: the focused greyed button has an outline or ring (computed style)', hasRing, JSON.stringify(ring));
  await shot(page, 'followups-refused-keyboard');
  await page.keyboard.press('Enter');
  await sleep(400);
  const afterEnter = await dialogOpen(page);
  await page.keyboard.press('Space');
  await sleep(400);
  const afterSpace = await dialogOpen(page);
  check(S, 'keyboard: Enter and Space on the greyed button open no dialog', afterEnter === false && afterSpace === false, JSON.stringify({ afterEnter, afterSpace }));
}

async function stepDialogScope(S, page, world) {
  // The followups world marks every finding of the main scan (through API keys), so the dialog is
  // opened on the finding of the second site, which has no dismissal for its selector.
  const { base, bigScanId } = world;
  await openReport(page, base, bigScanId, 'issues');
  await openMarkDialog(page, 'panel-issues', '#row-1', HERO.code);
  const scope = await page.$eval('#issue-dismiss-dialog .alert__body', (e) => (e.textContent || '').trim());
  const want = localeString('en', 'issueDismissals.dialog.mark.scope');
  check(S, 'the dismiss dialog scope sentence is the shipped text', typeof want === 'string' && scope === want, scope);
  check(S, 'the scope sentence names earlier completed scans', scope.includes('earlier completed scans'), scope);
  await shot(page, 'followups-dialog-scope');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.getElementById('issue-dismiss-dialog').open, { timeout: WAIT });
}

async function stepOwnerMenu(S, page, world) {
  const { base } = world;
  await page.goto(`${base}/home`, { waitUntil: 'domcontentloaded', timeout: WAIT });
  // The menu is a drawer on every screen size: open it with the burger button, as a user does.
  await page.click('#mobile-menu-btn');
  await page.waitForFunction(() => document.querySelector('.sidebar').classList.contains('is-open'), { timeout: WAIT });
  // Wait for the slide-in to finish (the drawer starts 260px off screen).
  await page.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().left >= 0, { timeout: WAIT });
  const open = await page.$eval('details.sidebar__more', (d) => d.open);
  if (!open) {
    await page.click('details.sidebar__more > summary');
    await page.waitForFunction(() => document.querySelector('details.sidebar__more').open, { timeout: WAIT });
  }
  const link = await page.$('a[href="/admin/audit-log"]');
  // The drawer scrolls on its own: bring the entry into the visible part before measuring and shooting.
  if (link) await page.evaluate((a) => a.scrollIntoView({ block: 'center', behavior: 'instant' }), link);
  const box = link ? await link.boundingBox() : null;
  const inWindow = box !== null && box.width > 0 && box.height > 0 && box.y >= 0 && box.y + box.height <= DESKTOP.height && box.x >= 0;
  check(S, 'an org Owner sees the Audit Log entry under More in the menu', inWindow, JSON.stringify(box));
  await shot(page, 'followups-owner-menu');
  if (link) {
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: WAIT }), link.click()]);
  }
  check(S, 'clicking the menu entry opens the Audit Log page', /\/admin\/audit-log/.test(page.url()) && (await page.$eval('h1', (h) => (h.textContent || '').trim())) === 'Audit Log', page.url());
}

async function stepAuditLog(S, page, world) {
  const { base, keyActors } = world;
  await page.goto(`${base}/admin/audit-log?action=issue_dismissal.mark`, { waitUntil: 'domcontentloaded', timeout: WAIT });
  const a = await auditSurvey(page);
  check(S, 'the Action filter shows the dismissal action while it is applied', a.filter === 'issue_dismissal.mark', String(a.filter));
  const stamp = (iso) => new Date(iso).toLocaleString('en');
  const ciRows = a.actors.filter((t) => t.startsWith('API key: Fabrikam CI (Created '));
  check(S, 'the Audit Log names the two same-label keys with their own creation times',
    ciRows.length >= 2 && new Set(ciRows).size >= 2 && ciRows.includes(`API key: Fabrikam CI (Created ${stamp(KEY_TIMES.twin)})`), JSON.stringify(ciRows));
  const deletedWant = `API key: Fabrikam Deploy (Created ${stamp(KEY_TIMES.deleted)})`;
  check(S, 'the Audit Log still names the key that was deleted, from the dismissal snapshot', a.actors.includes(deletedWant), JSON.stringify(a.actors.filter((t) => t.startsWith('API key'))));
  check(S, 'the Audit Log reads API key for a key that is not the organization own key', a.actors.includes('API key'), JSON.stringify(a.actors.filter((t) => t.startsWith('API key'))));
  const ids = Object.values(keyActors.keyIds);
  check(S, 'the Audit Log page holds no api-key identifier and no key id', !a.html.includes('api-key:') && ids.every((id) => !a.html.includes(id)));
  check(S, 'the Load More link carries the page size', typeof a.loadMore === 'string' && a.loadMore.includes('limit=50'), String(a.loadMore));
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await shot(page, 'followups-audit-filter');
  await page.setViewport(PHONE);
  await page.goto(`${base}/admin/audit-log?action=issue_dismissal.mark`, { waitUntil: 'domcontentloaded', timeout: WAIT });
  const ov = await horizontalOverflow(page);
  check(S, '375px: the Audit Log page has no sideways scroll of the page itself', ov.scrollW <= ov.innerW + 2, JSON.stringify(ov));
  await shot(page, 'followups-audit-375');
  await page.setViewport(DESKTOP);
}

async function stepViewerForbidden(S, browser, world) {
  const { base, personas } = world;
  const v = await newPersonaPage(browser, base, personas.viewer, DESKTOP);
  try {
    check(S, 'login as viewer', v.ok);
    const resp = await v.page.goto(`${base}/admin/audit-log`, { waitUntil: 'domcontentloaded', timeout: WAIT });
    const type = String(resp.headers()['content-type'] ?? '');
    check(S, 'a viewer opening the Audit Log gets a 403 HTML page', resp.status() === 403 && type.includes('text/html'), `${resp.status()} ${type}`);
    const title = await v.page.$eval('h1', (h) => (h.textContent || '').trim()).catch(() => '');
    check(S, 'the page is the dashboard error page headed Access Denied', title === 'Access Denied', title);
    await shot(v.page, 'followups-audit-forbidden');
  } finally {
    await v.context.close();
  }
}

async function stepTeamPage(S, page, world) {
  const { base } = world;
  check(S, 'fixture: a teamless organization member was seeded', world.unteamedSeeded === true);
  await page.goto(`${base}/admin/teams`, { waitUntil: 'domcontentloaded', timeout: WAIT });
  const label = await page.$eval('select[name="organizationId"] option[value=""]', (o) => (o.textContent || '').trim());
  check(S, 'the team form empty organization option reads Current organization (Fabrikam)', label === 'Current organization (Fabrikam)', label);
  await shot(page, 'followups-team-form');
  await page.type('form[hx-post="/admin/teams"] input[name="name"]', 'uat-followups-team');
  await page.click('form[hx-post="/admin/teams"] button[type="submit"]');
  await page.waitForFunction(() => [...document.querySelectorAll('#teams-table-body a')].some((a) => (a.textContent || '').trim() === 'uat-followups-team'), { timeout: WAIT });
  const href = await page.evaluate(() => [...document.querySelectorAll('#teams-table-body a')].find((a) => (a.textContent || '').trim() === 'uat-followups-team').getAttribute('href'));
  await page.goto(`${base}${href}`, { waitUntil: 'domcontentloaded', timeout: WAIT });
  const empty = await page.$eval('#members-empty-row', (r) => (r.textContent || '').trim()).catch(() => null);
  check(S, 'the new team shows the No members yet row', typeof empty === 'string' && empty.startsWith('No members yet.'), String(empty));
  const options = await page.$$eval('select[name="userId"] option', (os) => os.map((o) => ({ value: o.value, text: (o.textContent || '').trim() })));
  const unteamed = options.find((o) => o.text.startsWith('uat-unteamed'));
  check(S, 'Add Member offers the teamless organization member', unteamed !== undefined, JSON.stringify(options.map((o) => o.text)));
  if (unteamed) {
    await page.select('select[name="userId"]', unteamed.value);
    await page.click('form[hx-post$="/members"] button[type="submit"]');
    await page.waitForSelector('#members-table-body tr[id^="member-row-"]', { timeout: WAIT });
  }
  const rows = await page.$$eval('#members-table-body tr', (trs) => trs.map((tr) => ({ id: tr.id, text: (tr.textContent || '').replace(/\s+/g, ' ').trim() })));
  check(S, 'the added member row is listed and the No members yet row is gone',
    rows.some((r) => r.id.startsWith('member-row-') && r.text.includes('uat-unteamed')) && !rows.some((r) => r.id === 'members-empty-row'), JSON.stringify(rows));
  await shot(page, 'followups-team-added');
  await page.setViewport(PHONE);
  await page.goto(`${base}${href}`, { waitUntil: 'domcontentloaded', timeout: WAIT });
  const ov = await horizontalOverflow(page);
  check(S, '375px: the team page has no sideways scroll', ov.scrollW <= ov.innerW + 2, JSON.stringify(ov));
  await shot(page, 'followups-team-375');
  await page.setViewport(DESKTOP);
}

export const followupsScenarios = {
  async followups({ page, browser, world }) {
    const S = 'followups';
    await stepRefusedPhone(S, page, world);
    await stepRefusedKeyboard(S, page, world);
    await stepDialogScope(S, page, world);
    const owner = await newPersonaPage(browser, world.base, world.personas.owner, DESKTOP);
    try {
      check(S, 'login as org Owner', owner.ok);
      await stepOwnerMenu(S, owner.page, world);
      await stepAuditLog(S, owner.page, world);
      await stepViewerForbidden(S, browser, world);
      await stepTeamPage(S, owner.page, world);
    } finally {
      await owner.context.close();
    }
  },
};
