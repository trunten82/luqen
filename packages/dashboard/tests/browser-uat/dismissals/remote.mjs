// Remote mode of the dismissal UAT: drives an already-running dashboard (Plans 08 and 10 point it at
// production), configured ONLY by environment variables.
//
// Hard rules, all pinned by the remote-selftest mode and a grep over its output:
//   - never seeds or edits the database;
//   - never prints a value of any LUQEN_UAT_* variable, a URL, a scan id or a username: check()
//     output carries check NAMES only (setWithholdDetail), and no screenshot is written;
//   - writes at most ONE mark, ONE revoke, and with --leave-active ONE re-mark of the same finding;
//   - every persona write probe uses a request that cannot create a dismissal even if its permission
//     gate were broken (the whole-page selector `html` is refused by the handler with 400/422), so a
//     missing 403 shows up as a FAIL, never as a stray row;
//   - it writes only into the dedicated UAT org and site: right after the admin login, and before any
//     persona login or write, the target scan's org name and site host are read as the admin and
//     checked against LUQEN_UAT_EXPECT_ORG / LUQEN_UAT_EXPECT_SITE_HOST (target-guard.mjs, no
//     defaults); anything else prints a names-only REFUSED line and the run exits 2.
import {
  check, WAIT, newPersonaPage, openReport, showTab, pageFetch, jsonOf, openMarkDialog, confirmMark, openDismissedSection,
  setWithholdDetail,
} from './lib.mjs';
import { controlSurvey } from './scenarios-core.mjs';
import { uatTargetRefusal, TARGET_VARS, TARGET_PASS_LINE } from './target-guard.mjs';

/** What --check-target-only needs: the admin login and the two expected target values. */
export const TARGET_CHECK_VARS = [
  'LUQEN_UAT_BASE_URL', 'LUQEN_UAT_SCAN_ID',
  'LUQEN_UAT_ADMIN_USER', 'LUQEN_UAT_ADMIN_PASS',
  ...TARGET_VARS,
];

export const REMOTE_VARS = [
  ...TARGET_CHECK_VARS,
  'LUQEN_UAT_OWNER_USER', 'LUQEN_UAT_OWNER_PASS',
  'LUQEN_UAT_MEMBER_USER', 'LUQEN_UAT_MEMBER_PASS',
  'LUQEN_UAT_VIEWER_USER', 'LUQEN_UAT_VIEWER_PASS',
];

/** Names (never values) of the variables that are absent or empty. */
export function missingVars(env, { checkTargetOnly = false } = {}) {
  const names = checkTargetOnly ? TARGET_CHECK_VARS : REMOTE_VARS;
  return names.filter((name) => typeof env[name] !== 'string' || env[name].trim() === '');
}

const creds = (env, who) => ({ user: env[`LUQEN_UAT_${who}_USER`], pass: env[`LUQEN_UAT_${who}_PASS`] });
const REASON = 'Remote UAT mark, revoked again straight away.';
const COMMENT = 'Remote UAT revoke.';

/** Revoke any ACTIVE dismissal this run created (matched by its exact reason). Prints names only. */
async function cleanupUatMark(page, scanId) {
  try {
    const list = await pageFetch(page, 'GET', `/api/v1/scans/${scanId}/dismissals`);
    const rows = (jsonOf(list)?.dismissals ?? []).filter((d) => d.status === 'active' && d.reason === REASON);
    for (const d of rows) await pageFetch(page, 'POST', `/api/v1/dismissals/${d.id}/revoke`, { comment: 'Remote UAT cleanup after a failure.' });
    console.log(rows.length > 0 ? `CLEANUP remote: revoked ${rows.length} UAT mark(s) left by a failed run` : 'CLEANUP remote: no UAT mark was left active');
  } catch {
    console.log('CLEANUP remote: FAILED - revoke the UAT mark by hand (details withheld)');
  }
}

/** The first enabled page-issue Dismiss button on the Issues tab: its code and selector. */
async function pickFinding(page) {
  return page.evaluate(() => {
    const b = [...document.querySelectorAll('#panel-issues .rpt-dismiss-btn[data-action="rptDismissIssue"]')]
      .find((x) => !x.closest('.rpt-template-block'))
      || document.querySelector('#panel-issues .rpt-dismiss-btn[data-action="rptDismissIssue"]');
    return b ? { code: b.getAttribute('data-code'), selector: b.getAttribute('data-selector') } : null;
  });
}

/** Is a Dismiss button for exactly this code + selector rendered on the Issues tab? */
const hasButtonFor = (page, f) => page.evaluate((code, sel) => [...document.querySelectorAll('#panel-issues .rpt-dismiss-btn[data-action]')]
  .some((b) => b.getAttribute('data-code') === code && b.getAttribute('data-selector') === sel), f.code, f.selector);

/**
 * The target scan's org name and site URL, read as the logged-in admin. GraphQL `scan` answers only for
 * a scan of the org the session is in (null for any other org), and returns that scan's own orgId; the
 * name is then taken from the admin's org memberships (`/orgs/current` userOrgs) by that id. A scan the
 * admin cannot read in its session org, or an org it is not a member of, leaves the name null and the
 * guard refuses. (`/orgs/current`'s currentOrgId is not used: it reads the raw session key, which a fresh
 * login has not set even though the request's org is already resolved.) Read-only: one GET and one
 * GraphQL query, no session change. Nothing here is printed.
 */
async function observeTarget(page, scanId) {
  try {
    const current = jsonOf(await pageFetch(page, 'GET', '/orgs/current'));
    const res = await pageFetch(page, 'POST', '/graphql', {
      query: 'query UatTarget($id: ID!) { scan(id: $id) { orgId siteUrl } }',
      variables: { id: scanId },
    });
    const scan = res.status === 200 ? (jsonOf(res)?.data?.scan ?? null) : null;
    const orgs = Array.isArray(current?.userOrgs) ? current.userOrgs : [];
    const org = scan !== null && typeof scan.orgId === 'string' ? orgs.find((o) => o?.id === scan.orgId) : undefined;
    return {
      orgName: org !== undefined && typeof org.name === 'string' ? org.name : null,
      siteUrl: scan !== null && typeof scan.siteUrl === 'string' ? scan.siteUrl : null,
    };
  } catch {
    return { orgName: null, siteUrl: null };
  }
}

async function adminCycle({ page, base, scanId, leaveActive, whileActive }) {
  const S = 'remote-admin';
  await openReport(page, base, scanId, 'issues');
  const finding = await pickFinding(page);
  check(S, 'the scan has a finding that can be dismissed', finding !== null);
  check(S, 'before: the finding has an active Dismiss button', await hasButtonFor(page, finding));

  await openMarkDialog(page, 'panel-issues', finding.selector, finding.code);
  check(S, 'the preview shows at least one occurrence before confirm', Number(await page.$eval('[data-preview="occurrences"]', (e) => e.textContent)) >= 1);
  await confirmMark(page, REASON);
  // From here on a UAT mark exists on the target. Any failure must not leave it behind: the catch below
  // revokes it (by its exact reason, active only) before the error propagates.
  try {
    const toast = await page.$eval('#toast-container .toast', (t) => t.textContent || '');
    check(S, 'a toast confirms the mark', toast.trim().length > 0);
    await showTab(page, 'issues');
    check(S, 'after the mark: the finding is excluded from the Issues tab', !(await hasButtonFor(page, finding)));
    await openDismissedSection(page);
    const listed = await page.$eval('#rpt-dismissed', (d) => d.textContent || '');
    check(S, 'after the mark: the Dismissed section lists the finding with the reason', listed.includes(finding.code) && listed.includes(REASON));

    // The other personas look at the page WHILE the dismissal is active, so "no Revoke button" and "the
    // section is visible" are statements about a section that exists (after the revoke they would be vacuous).
    await whileActive();

    // The target may already hold other people's dismissals: revoke ONLY the row this run created.
    const revokeBtn = (await page.evaluateHandle((reason) => {
      const row = [...document.querySelectorAll('#rpt-dismissed tbody tr')].find((r) => (r.textContent || '').includes(reason));
      return row ? row.querySelector('[data-action="rptRevokeIssue"]') : null;
    }, REASON)).asElement();
    check(S, 'the UAT mark has its own Revoke button', revokeBtn !== null);
    await revokeBtn.click();
    await page.waitForSelector('#issue-revoke-dialog[open]', { timeout: WAIT });
    await page.type('#issue-revoke-comment', COMMENT);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: WAIT }),
      page.click('[data-action="rptRevokeConfirm"]'),
    ]);
    await page.waitForSelector('#toast-container .toast', { timeout: WAIT });
    await showTab(page, 'issues');
    check(S, 'after the revoke: the finding is restored to the Issues tab', await hasButtonFor(page, finding));
    await openDismissedSection(page);
    const revokedText = await page.$eval('#rpt-dismissed', (d) => d.textContent || '');
    check(S, 'after the revoke: the revoked table carries the comment', revokedText.includes(COMMENT));

  } catch (err) {
    await cleanupUatMark(page, scanId);
    throw err;
  }
  if (leaveActive) {
    await openMarkDialog(page, 'panel-issues', finding.selector, finding.code);
    await confirmMark(page, 'Left active for the owner review of the Dismissed section.');
    await showTab(page, 'issues');
    check(S, 'left active: the finding is dismissed again and stays so', !(await hasButtonFor(page, finding)));
  }
}

/** Read-only and cannot-write probes per persona. The write probe targets the refused selector `html`. */
async function personaChecks({ browser, env, base, scanId, expect }) {
  const granted = expect === 'granted';
  const probe = { code: 'WCAG2AA.Principle3.Guideline3_1.3_1_1.H57.2', selector: 'html', reason: 'Remote UAT permission probe, refused by design.' };
  const personas = [['OWNER', 'owner'], ['MEMBER', 'member'], ['VIEWER', 'viewer']];
  for (const [who, label] of personas) {
    const S = `remote-${label}`;
    const p = await newPersonaPage(browser, base, creds(env, who));
    check(S, `login as the ${label} persona`, p.ok);
    await openReport(p.page, base, scanId, 'issues');
    const survey = await controlSurvey(p.page);
    check(S, `${label}: sees the Dismissed section while a dismissal is active`, survey.section === true);
    const mayDismiss = who === 'OWNER' && granted;
    if (mayDismiss) {
      check(S, `${label} (granted): the Dismiss control, the dialog and a Revoke button are present`, survey.any > 0 && survey.markDialog && survey.revokeButtons > 0);
      const pv = await pageFetch(p.page, 'GET', `/api/v1/scans/${scanId}/dismissals/preview?code=${encodeURIComponent(probe.code)}&selector=${encodeURIComponent('#remote-uat-probe')}`);
      check(S, `${label} (granted): the preview is allowed (200)`, pv.status === 200);
    } else {
      check(S, `${label}${who === 'OWNER' ? ' (dark)' : ''}: no Dismiss control and no dialog`, survey.any === 0 && !survey.markDialog && !survey.revokeDialog);
      check(S, `${label}: the Dismissed section shows no Revoke button`, survey.revokeButtons === 0);
      const pv = await pageFetch(p.page, 'GET', `/api/v1/scans/${scanId}/dismissals/preview?code=${encodeURIComponent(probe.code)}&selector=${encodeURIComponent(probe.selector)}`);
      check(S, `${label}: the preview is 403`, pv.status === 403);
      const mk = await pageFetch(p.page, 'POST', `/api/v1/scans/${scanId}/dismissals`, probe);
      check(S, `${label}: a direct mark POST is 403 (write probe uses a refused selector)`, mk.status === 403);
    }
    await p.context.close();
  }
}

/**
 * Returns 'refused' (nothing written, no persona logged in), 'target-ok' (checkTargetOnly: the target
 * check passed, nothing written) or 'done' (the full mark / persona / revoke cycle ran).
 */
export async function runRemote({ browser, env, expect, leaveActive, checkTargetOnly = false }) {
  setWithholdDetail(true);
  const base = env.LUQEN_UAT_BASE_URL.replace(/\/+$/, '');
  const scanId = env.LUQEN_UAT_SCAN_ID;
  const admin = await newPersonaPage(browser, base, creds(env, 'ADMIN'));
  try {
    check('remote-admin', 'login as the admin persona', admin.ok);
    // The target rule runs here: after the admin login, before any persona login and before any write.
    const refusal = uatTargetRefusal(env, await observeTarget(admin.page, scanId));
    if (refusal !== null) {
      console.log(refusal.message);
      return 'refused';
    }
    console.log(TARGET_PASS_LINE);
    if (checkTargetOnly) return 'target-ok';
    await adminCycle({ page: admin.page, base, scanId, leaveActive, whileActive: () => personaChecks({ browser, env, base, scanId, expect }) });
    return 'done';
  } finally {
    await admin.context.close();
  }
}
