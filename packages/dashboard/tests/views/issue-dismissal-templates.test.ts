/**
 * Phase 89 Plan 04 — rendered-markup tests for the mark control and dialog (FP-14, FP-16).
 *
 * report-detail.hbs is compiled in an isolated Handlebars instance with ALL real partials
 * (collectPartials), the real `t` and the real `dismissalRefused` predicate from server.ts.
 * Helpers the sections under test do not use fall through to a no-op helperMissing.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Handlebars from 'handlebars';
import { collectPartials, dismissalRefused } from '../../src/server.js';
import { loadTranslations, t, type Locale } from '../../src/i18n/index.js';
import {
  DISMISSAL_CODE_MAX_LENGTH,
  DISMISSAL_REASON_MAX_LENGTH,
  DISMISSAL_SELECTOR_MAX_LENGTH,
} from '../../src/services/issue-dismissals/validate-input.js';
import { DISMISSAL_REFUSAL_CASES } from '../fixtures/dismissal-refusal-cases.js';
import { buildDismissalsView } from '../../src/services/issue-dismissals/dismissals-view.js';
import type { IssueDismissal } from '../../src/db/interfaces/issue-dismissal-repository.js';

process.env['TZ'] ??= 'UTC';

const HERE = dirname(fileURLToPath(import.meta.url));
const VIEWS_DIR = join(HERE, '..', '..', 'src', 'views');
const STATIC_DIR = join(HERE, '..', '..', 'src', 'static');

const SEL_TEMPLATE = '.site-nav a.fabrikam-link';
const SEL_PAGE = '#fabrikam-hero-img';
const SEL_TAB = '.site-footer .fabrikam-note';
const CODE = 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37';

let hb: typeof Handlebars;
let reportSource: string;

beforeAll(() => {
  loadTranslations();
  hb = Handlebars.create();
  hb.registerHelper('helperMissing', () => '');
  hb.registerHelper('eq', (a: unknown, b: unknown) => a === b);
  hb.registerHelper('issueAssignStatus', () => '');
  hb.registerHelper('fixSuggestion', () => '');
  hb.registerHelper('dismissalRefused', dismissalRefused);
  hb.registerHelper(
    't',
    function (key: string, options: { hash?: Record<string, unknown>; data?: { root?: { locale?: string } } }) {
      const locale = (options?.data?.root?.locale as Locale) ?? 'en';
      const params =
        options?.hash != null
          ? Object.fromEntries(Object.entries(options.hash).map(([k, v]) => [k, String(v ?? '')]))
          : undefined;
      return t(key, locale, params);
    },
  );
  for (const [name, rel] of Object.entries(collectPartials(VIEWS_DIR))) {
    hb.registerPartial(name, readFileSync(join(VIEWS_DIR, rel), 'utf8'));
  }
  reportSource = readFileSync(join(VIEWS_DIR, 'report-detail.hbs'), 'utf8');
});

function issue(selector: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'error',
    code: CODE,
    message: `Finding on ${String(selector)}`,
    selector,
    context: '<img>',
    wcagCriterion: '1.1.1',
    ...extra,
  };
}

function reportData(
  pageSelectors: readonly unknown[],
  templateSelector: unknown = SEL_TEMPLATE,
  tabSelector: unknown = SEL_TAB,
): Record<string, unknown> {
  const templateItem = {
    ...issue(templateSelector),
    componentName: 'Navigation',
    affectedCount: 4,
    affectedPages: ['https://fabrikam.example/a'],
  };
  return {
    complianceMatrix: [],
    pages: [],
    summary: { totalIssues: 3 },
    allIssueGroups: [
      {
        criterion: '1.1.1',
        title: 'Non-text Content',
        errorCount: 3,
        warningCount: 0,
        noticeCount: 0,
        pageCount: 2,
        totalCount: 3,
        templateItems: [templateItem],
        issues: pageSelectors.map((s) => issue(s)),
        regulations: [],
        components: [],
      },
    ],
    templateComponents: [
      {
        componentName: 'Footer',
        issueCount: 1,
        maxAffectedPages: 3,
        issues: [{ ...issue(tabSelector), affectedCount: 3, affectedPages: ['https://fabrikam.example/a'] }],
      },
    ],
  };
}

interface RenderOptions {
  readonly controls?: { reasonMax: number; commentMax: number } | null;
  readonly technical?: boolean;
  readonly assign?: boolean;
  readonly selectors?: readonly unknown[];
  readonly templateSelector?: unknown;
  readonly tabSelector?: unknown;
  readonly locale?: string;
  readonly dismissals?: Record<string, unknown>;
}

function dismissalRow(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    code: CODE,
    selector: '#fabrikam-promo-note',
    reason: 'Rendered by a script after load',
    actor: 'fabrikam-admin',
    actorIsApiKey: false,
    createdAtIso: '2026-10-01T10:00:00.000Z',
    createdAtDisplay: '10/1/2026, 10:00:00 AM',
    revokedBy: '',
    revokedByIsApiKey: false,
    revokedAtIso: '',
    revokedAtDisplay: '',
    revokeComment: '',
    ...extra,
  };
}

const TWO_ACTIVE_ONE_REVOKED = {
  activeCount: 2,
  revokedCount: 1,
  active: [dismissalRow('dis-active-1'), dismissalRow('dis-active-2', { code: 'OTHER.code' })],
  revoked: [
    dismissalRow('dis-revoked-1', {
      revokedBy: 'northwind-owner',
      revokedAtIso: '2026-10-02T10:00:00.000Z',
      revokedAtDisplay: '10/2/2026, 10:00:00 AM',
      revokeComment: 'Selector was too broad',
    }),
  ],
};

function render(opts: RenderOptions = {}): string {
  const controls = opts.controls === undefined ? { reasonMax: DISMISSAL_REASON_MAX_LENGTH, commentMax: 1000 } : opts.controls;
  const template = hb.compile(reportSource);
  return template({
    scan: { id: 'scan-fabrikam-1', siteUrl: 'https://fabrikam.example', status: 'completed' },
    reportData: reportData(
      opts.selectors ?? [SEL_PAGE],
      opts.templateSelector ?? SEL_TEMPLATE,
      opts.tabSelector ?? SEL_TAB,
    ),
    locale: opts.locale ?? 'en',
    perm: { reportsViewTechnical: opts.technical ?? true, issuesAssign: opts.assign ?? false },
    brandingGuidelineActive: false,
    llmEnabled: false,
    assignedMap: {},
    ...(controls !== null ? { dismissalControls: controls } : {}),
    ...(opts.dismissals !== undefined ? { dismissals: opts.dismissals } : {}),
  });
}

function dismissButtons(html: string): string[] {
  return [...html.matchAll(/<button[^>]*rpt-dismiss-btn[^>]*>/g)].map((m) => m[0]);
}

describe('mark control — gating and sites', () => {
  it('a permitted viewer gets a Dismiss button on template items, page issues and Templates-tab items', () => {
    const buttons = dismissButtons(render());
    expect(buttons).toHaveLength(3);
    for (const selector of [SEL_TEMPLATE, SEL_PAGE, SEL_TAB]) {
      const own = buttons.filter((b) => b.includes(`data-selector="${selector}"`));
      expect(own, selector).toHaveLength(1);
      expect(own[0]).toContain(`data-code="${CODE}"`);
      expect(own[0]).toContain('data-action="rptDismissIssue"');
      expect(own[0]).not.toContain('aria-disabled');
    }
  });

  it('the page issue and template item carry their group criterion for return-to-place', () => {
    const buttons = dismissButtons(render());
    expect(buttons.find((b) => b.includes(SEL_PAGE))).toContain('data-criterion="1.1.1"');
    expect(buttons.find((b) => b.includes(SEL_TEMPLATE))).toContain('data-criterion="1.1.1"');
  });

  it.each([
    ['html', 'html'],
    ['body', 'body'],
    [':root', ':root'],
    ['empty', ''],
    ['non-string', undefined],
  ])('a whole-page selector (%s) renders the disabled variant with its reason', (_label, selector) => {
    const html = render({ selectors: [selector] });
    // Enabled buttons for the OTHER two sites stay; the page issue's is the disabled one.
    const disabled = dismissButtons(html).filter((b) => b.includes('aria-disabled="true"'));
    expect(disabled).toHaveLength(1);
    expect(disabled[0]).not.toContain('data-action');
    expect(disabled[0]).toContain('title="This finding has no specific element and cannot be dismissed."');
    const describedBy = /aria-describedby="([^"]+)"/.exec(disabled[0]);
    expect(describedBy).not.toBeNull();
    const target = new RegExp(`<span class="sr-only" id="${describedBy![1]}">This finding has no specific element`);
    expect(html).toMatch(target);
    expect(dismissButtons(html).filter((b) => !b.includes('aria-disabled'))).toHaveLength(2);
  });

  it('the disabled variants of several refused findings get distinct description ids', () => {
    const html = render({ selectors: ['html', 'body', ':root'] });
    const ids = [...html.matchAll(/aria-describedby="(dismiss-refused-[^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });

  it('without dismissal controls the page has no dismiss button, no dialog and no dismissal text', () => {
    const html = render({ controls: null });
    expect(html).not.toContain('rpt-dismiss');
    expect(html).not.toContain('issue-dismiss-dialog');
    expect(html).not.toContain('rptDismiss');
    expect(html).not.toContain('Dismiss');
    expect(html).not.toContain('false positive');
    // Positive control: the same findings ARE on the page, so the absence is the gate.
    expect(html).toContain(SEL_PAGE);
    expect(html).toContain('data-issue-group');
  });
});

describe('per-issue assign button', () => {
  const assignButtons = (html: string): string[] =>
    [...html.matchAll(/<button[^>]*data-action="rptAssignIssue"[^>]*>/g)].map((m) => m[0]);

  it('HARD-02 assign button needs technical details permission', () => {
    // The per-issue Assign button carries the raw selector, so it needs technical-details access.
    const plain = render({ technical: false, assign: true });
    expect(assignButtons(plain)).toHaveLength(0);
    // Control: with both permissions the template item and the page issue each have one.
    const technical = render({ technical: true, assign: true });
    const buttons = assignButtons(technical);
    expect(buttons).toHaveLength(2);
    expect(buttons.filter((b) => b.includes(`data-selector="${SEL_PAGE}"`))).toHaveLength(1);
    expect(buttons.filter((b) => b.includes(`data-selector="${SEL_TEMPLATE}"`))).toHaveLength(1);
  });
});

describe('mark dialog', () => {
  it("the dialog's element line needs the technical permission", () => {
    const technical = render({ technical: true });
    const plain = render({ technical: false });
    expect(technical).toContain('data-field="selector"');
    expect(plain).not.toContain('data-field="selector"');
    // The rule and finding lines stay for both.
    expect(plain).toContain('data-field="code"');
    expect(plain).toContain('data-field="message"');
  });

  it('the reason limit comes from the view data', () => {
    const html = render({ controls: { reasonMax: 777, commentMax: 555 } });
    expect(html).toContain('maxlength="777"');
    expect(html).toContain('data-reason-max="777"');
    expect(html).toContain('<span data-reason-count>0</span> / 777');
    expect(html).not.toContain('1000');

    const limit = String(DISMISSAL_REASON_MAX_LENGTH);
    const literal = new RegExp(`(^|[^0-9])${limit}([^0-9]|$)`);
    expect(readFileSync(join(VIEWS_DIR, 'partials', 'issue-dismiss-dialog.hbs'), 'utf8')).not.toMatch(literal);
    expect(readFileSync(join(STATIC_DIR, 'issue-dismissals.js'), 'utf8')).not.toMatch(literal);
  });

  it('the dialog is outside every table and carries every translated string as data', () => {
    const html = render();
    const dialog = /<dialog id="issue-dismiss-dialog"[\s\S]*?<\/dialog>/.exec(html);
    expect(dialog).not.toBeNull();
    const open = dialog![0].slice(0, dialog![0].indexOf('>') + 1);
    for (const attr of [
      'data-scan-id="scan-fabrikam-1"',
      'data-msg-marked="Finding dismissed. Scans of this site updated: __COUNT__."',
      'data-msg-recompute-failed=',
      'data-msg-recompute-incomplete=',
      'data-msg-saving="Saving…"',
      'data-preview-already=',
      'data-err-invalid=',
      'data-err-session=',
      'data-err-forbidden=',
      'data-err-not-found=',
      'data-err-conflict="This finding is already dismissed.',
      'data-err-no-match=',
      'data-err-rate-limited=',
      'data-err-unavailable=',
      'data-err-generic=',
    ]) {
      expect(open, attr).toContain(attr);
    }
    expect(open).not.toMatch(/data-err-[a-z-]+=""/);
    // Not inside a <table>: the opening tag count before the dialog equals the closing count.
    const before = html.slice(0, html.indexOf('<dialog id="issue-dismiss-dialog"'));
    expect((before.match(/<table/g) ?? []).length).toBe((before.match(/<\/table>/g) ?? []).length);
    expect(dialog![0]).toContain('<form method="dialog"');
  });

  it('every locale renders the dialog attributes translated, with no raw key visible', () => {
    for (const locale of ['de', 'es', 'fr', 'it', 'pt']) {
      const html = render({ locale });
      expect(html, locale).not.toContain('issueDismissals.');
      expect(html, locale).not.toContain('{{');
    }
  });
});

describe('source discipline', () => {
  const PARTIAL = readFileSync(join(VIEWS_DIR, 'partials', 'issue-dismiss-dialog.hbs'), 'utf8');
  const CLIENT = readFileSync(join(STATIC_DIR, 'issue-dismissals.js'), 'utf8');

  it('new markup has no inline script and no inline event handler', () => {
    const handler = /\son[a-z]+\s*=/i;
    expect(PARTIAL).not.toMatch(/<script/i);
    expect(PARTIAL).not.toMatch(handler);
    const buttonLines = reportSource.split('\n').filter((l) => l.includes('rpt-dismiss-btn'));
    expect(buttonLines.length).toBeGreaterThanOrEqual(3);
    for (const line of buttonLines) expect(line).not.toMatch(handler);
    // And in the rendered output, from the dialog's opening tag to its close.
    const html = render();
    const dialog = /<dialog id="issue-dismiss-dialog"[\s\S]*?<\/dialog>/.exec(html)![0];
    expect(dialog).not.toMatch(/<script/i);
    expect(dialog).not.toMatch(handler);
    for (const button of dismissButtons(html)) expect(button).not.toMatch(handler);
  });

  it('the client script uses no HTML-parsing sinks', () => {
    for (const sink of [
      /\.innerHTML/,
      /\.outerHTML/,
      /insertAdjacentHTML/,
      /document\.write/,
      /DOMParser/,
      /createContextualFragment/,
      /\beval\s*\(/,
      /new\s+Function\s*\(/,
    ]) {
      expect(CLIENT, String(sink)).not.toMatch(sink);
    }
  });
});

describe('dismissalRefused', () => {
  // Always TWO explicit arguments: in a template a missing second argument becomes Handlebars'
  // options object, which is not a rule code.
  it.each(['html', 'HTML', ' body ', ':root', '', '   ', 'html > body', '/html/body'])(
    'refuses the whole-page selector %j',
    (selector) => {
      expect(dismissalRefused(selector, CODE)).toBe(true);
    },
  );

  it.each([undefined, null, 5, {}])('refuses a non-string selector %j', (selector) => {
    expect(dismissalRefused(selector, CODE)).toBe(true);
  });

  it.each(['#hero > p', '.site-nav a', 'body > div', 'body *'])('allows the specific selector %j', (selector) => {
    expect(dismissalRefused(selector, CODE)).toBe(false);
  });
});

describe('the Dismiss button refuses what the server validator refuses', () => {
  const LONG_SELECTOR = `#${'a'.repeat(DISMISSAL_SELECTOR_MAX_LENGTH)}`;

  it('HARD-01 helper and validator agree on every shared refusal case', () => {
    const disagree = DISMISSAL_REFUSAL_CASES.filter((c) => dismissalRefused(c.selector, c.code) !== c.refused).map(
      (c) => c.why,
    );
    expect(disagree).toEqual([]);
  });

  it('HARD-01 helper refuses a selector over the length limit', () => {
    expect(LONG_SELECTOR).toHaveLength(DISMISSAL_SELECTOR_MAX_LENGTH + 1);
    expect(dismissalRefused(LONG_SELECTOR, CODE)).toBe(true);
    // Control: the same selector shape at the limit is allowed.
    expect(dismissalRefused(LONG_SELECTOR.slice(0, DISMISSAL_SELECTOR_MAX_LENGTH), CODE)).toBe(false);
  });

  it('HARD-01 helper refuses a rule code over the length limit', () => {
    const longCode = `R.${'x'.repeat(DISMISSAL_CODE_MAX_LENGTH - 1)}`;
    expect(longCode).toHaveLength(DISMISSAL_CODE_MAX_LENGTH + 1);
    expect(dismissalRefused(SEL_PAGE, longCode)).toBe(true);
    expect(dismissalRefused(SEL_PAGE, longCode.slice(0, DISMISSAL_CODE_MAX_LENGTH))).toBe(false);
  });

  it('HARD-01 report page renders a disabled Dismiss button for an over long selector at every issue site', () => {
    const html = render({ selectors: [LONG_SELECTOR], templateSelector: LONG_SELECTOR, tabSelector: LONG_SELECTOR });
    const buttons = dismissButtons(html);
    // Page issue, template item and Templates-tab item: three buttons, every one disabled.
    expect(buttons).toHaveLength(3);
    for (const button of buttons) {
      expect(button).toContain('aria-disabled="true"');
      expect(button).not.toContain('data-action');
      expect(button).not.toContain('data-selector');
    }
  });

  it('HARD-01 report page renders an enabled Dismiss button for a valid finding at every issue site', () => {
    // Each site must hand the helper its rule code: a site that does not would disable its button.
    const buttons = dismissButtons(render());
    expect(buttons).toHaveLength(3);
    for (const selector of [SEL_TEMPLATE, SEL_PAGE, SEL_TAB]) {
      const own = buttons.filter((b) => b.includes(`data-selector="${selector}"`));
      expect(own, selector).toHaveLength(1);
      expect(own[0]).toContain('data-action="rptDismissIssue"');
      expect(own[0]).not.toContain('aria-disabled');
    }
  });
});

describe('rendered sample (read by eye once; printed for the SUMMARY)', () => {
  it('prints the English dialog head so a person can read the final strings', () => {
    const html = render();
    const dialog = /<dialog id="issue-dismiss-dialog"[\s\S]*?<\/dialog>/.exec(html)![0];
    const visible = dialog
      .replace(/<dialog[^>]*>/, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&#x27;/g, "'")
      .replace(/&mdash;/g, '\u2014')
      .replace(/\s+/g, ' ')
      .trim();
    // eslint-disable-next-line no-console
    console.info(`DIALOG_VISIBLE_TEXT: ${visible}`);
    expect(visible).toContain('Dismiss as false positive');
    expect(visible).toContain('this rule on this exact element');
  });
});


// ── Plan 05: the revoke dialog and the Revoke button (FP-15, D-08) ───────────────────────────
// Revoke is the SIBLING of mark: each invariant the mark controls prove (gating, limits from the
// view data, translated strings as data, outside every table, no inline script, no raw key in
// any locale) is proven again here against revoke's own markup.
function revokeButtons(html: string): string[] {
  return [...html.matchAll(/<button[^>]*data-action="rptRevokeIssue"[^>]*>/g)].map((m) => m[0]);
}
function revokeDialogOf(html: string): string {
  const m = /<dialog id="issue-revoke-dialog"[\s\S]*?<\/dialog>/.exec(html);
  expect(m, 'revoke dialog rendered').not.toBeNull();
  return m![0];
}

describe('mark dialog — together text (89-11 item 6)', () => {
  it('the mark dialog carries the together text as data in every locale, with no raw key', () => {
    for (const locale of ['en', 'de', 'es', 'fr', 'it', 'pt'] as const) {
      const html = render({ locale });
      const m = /<dialog id="issue-dismiss-dialog"[\s\S]*?<\/dialog>/.exec(html);
      expect(m, `${locale}: mark dialog rendered`).not.toBeNull();
      const open = m![0].slice(0, m![0].indexOf('>') + 1);
      const want = t('issueDismissals.dialog.preview.together', locale);
      expect(want, locale).not.toBe('issueDismissals.dialog.preview.together');
      expect(open, locale).toContain(`data-preview-together="${Handlebars.Utils.escapeExpression(want)}"`);
      expect(open, locale).not.toContain('issueDismissals.');
    }
  });
});

describe('revoke dialog', () => {
  it('a permitted viewer gets the revoke dialog with every translated string as data', () => {
    const dialog = revokeDialogOf(render({ dismissals: TWO_ACTIVE_ONE_REVOKED }));
    const open = dialog.slice(0, dialog.indexOf('>') + 1);
    for (const attr of [
      'data-msg-revoked="Dismissal revoked. Scans of this site updated: __COUNT__."',
      'data-msg-recompute-failed=',
      'data-msg-recompute-incomplete=',
      'data-msg-saving="Revoking…"',
      'data-msg-confirm="Revoke dismissal"',
      'data-err-invalid=',
      'data-err-session=',
      'data-err-forbidden=',
      'data-err-not-found=',
      'data-err-conflict="This dismissal was already revoked.',
      'data-err-no-match=',
      'data-err-rate-limited=',
      'data-err-unavailable=',
      'data-err-generic=',
    ]) {
      expect(open, attr).toContain(attr);
    }
    expect(open).not.toMatch(/data-err-[a-z-]+=""/);
    // Mark's 409 text is about marking; revoke's is its own sentence.
    expect(open).not.toContain('already dismissed');
  });

  it('every error attribute the shared client map reads exists on BOTH dialogs and is never empty', () => {
    const html = render({ dismissals: TWO_ACTIVE_ONE_REVOKED });
    const client = readFileSync(join(STATIC_DIR, 'issue-dismissals.js'), 'utf8');
    const attrs = [...new Set([...client.matchAll(/'(data-err-[a-z-]+)'/g)].map((m) => m[1]!))];
    expect(attrs.length).toBeGreaterThanOrEqual(9);
    for (const dialog of [revokeDialogOf(html), /<dialog id="issue-dismiss-dialog"[\s\S]*?<\/dialog>/.exec(html)![0]]) {
      const open = dialog.slice(0, dialog.indexOf('>') + 1);
      for (const attr of attrs) expect(open, attr).toMatch(new RegExp(`${attr}="[^"]+"`));
    }
  });

  it('the comment is optional, the limit comes from the view data and confirm is enabled at once', () => {
    const html = render({ controls: { reasonMax: 777, commentMax: 555 }, dismissals: TWO_ACTIVE_ONE_REVOKED });
    const dialog = revokeDialogOf(html);
    const textarea = /<textarea[^>]*id="issue-revoke-comment"[^>]*>/.exec(dialog)![0];
    expect(textarea).toContain('maxlength="555"');
    expect(textarea).toContain('data-action-input="rptRevokeCommentInput"');
    expect(textarea).not.toMatch(/\srequired/);
    expect(textarea).not.toContain('aria-required');
    expect(dialog).toContain('<span data-comment-count>0</span> / 555');
    const confirm = /<button[^>]*data-action="rptRevokeConfirm"[^>]*>/.exec(dialog)![0];
    expect(confirm).not.toContain('disabled');
    expect(dialog).toContain('Comment (optional)');
    expect(dialog).toContain('id="issue-revoke-error"');
    expect(dialog).toContain('role="alert"');

    const limit = String(DISMISSAL_REASON_MAX_LENGTH);
    const literal = new RegExp(`(^|[^0-9])${limit}([^0-9]|$)`);
    expect(readFileSync(join(VIEWS_DIR, 'partials', 'issue-revoke-dialog.hbs'), 'utf8')).not.toMatch(literal);
  });

  it('the dialog is outside every table, has no inline script or handler, and is a native form dialog', () => {
    const html = render({ dismissals: TWO_ACTIVE_ONE_REVOKED });
    const dialog = revokeDialogOf(html);
    const before = html.slice(0, html.indexOf('<dialog id="issue-revoke-dialog"'));
    expect((before.match(/<table/g) ?? []).length).toBe((before.match(/<\/table>/g) ?? []).length);
    expect(dialog).toContain('<form method="dialog"');
    expect(dialog).not.toMatch(/<script/i);
    expect(dialog).not.toMatch(/\son[a-z]+\s*=/i);
    expect(dialog).toContain('rpt-dismiss-dialog');
  });

  it('without dismissal controls there is no revoke dialog and no Revoke button, though the rows are listed', () => {
    const html = render({ controls: null, dismissals: TWO_ACTIVE_ONE_REVOKED });
    expect(html).not.toContain('issue-revoke-dialog');
    expect(html).not.toContain('rptRevoke');
    expect(revokeButtons(html)).toHaveLength(0);
    // The button's own label, as a whole word: "Revoked by" / "Revoked on" column heads stay.
    expect(html).not.toMatch(/>\s*Revoke\s*</);
    // Positive control: the section IS on the page with its rows (active AND revoked, whose
    // heads say "Revoked ..."), so the absence above is the gate and not a missing section.
    expect(html).toContain('id="rpt-dismissed"');
    expect(html).toContain('Rendered by a script after load');
    expect(html).toContain('Revoked by');
  });

  // 89-11 item 1 (D-15 Q1, second-path rule): revoke shares the client's status map with mark,
  // so a mark-worded VALUE in any revoke data-err-* slot is shown to someone revoking.
  it('the revoke dialog carries no mark-only error text', () => {
    const MARK_ONLY = ['issueDismissals.error.invalid', 'issueDismissals.error.conflictMark', 'issueDismissals.error.noMatch'];
    for (const locale of ['en', 'de', 'es', 'fr', 'it', 'pt'] as const) {
      const dialog = revokeDialogOf(render({ locale, dismissals: TWO_ACTIVE_ONE_REVOKED }));
      const open = dialog.slice(0, dialog.indexOf('>') + 1);
      const values = [...open.matchAll(/data-err-[a-z-]+="([^"]*)"/g)].map((m) => m[1]!);
      expect(values.length, locale).toBeGreaterThanOrEqual(9); // positive control: the slots were read
      const forbidden = new Set<string>();
      for (const key of MARK_ONLY) {
        forbidden.add(Handlebars.Utils.escapeExpression(t(key, locale)));
        forbidden.add(Handlebars.Utils.escapeExpression(t(key, 'en')));
      }
      for (const v of values) expect(forbidden.has(v), `${locale}: mark-only text in the revoke dialog: ${v}`).toBe(false);
      expect(open, locale).toContain(`data-err-invalid="${Handlebars.Utils.escapeExpression(t('issueDismissals.error.invalidRevoke', locale))}"`);
    }
  });

  it('every locale renders the revoke dialog with no raw key visible', () => {
    for (const locale of ['de', 'es', 'fr', 'it', 'pt']) {
      const html = render({ locale, dismissals: TWO_ACTIVE_ONE_REVOKED });
      revokeDialogOf(html);
      expect(html, locale).not.toContain('issueDismissals.');
      expect(html, locale).not.toContain('common.revoke');
      expect(html, locale).not.toContain('{{');
    }
  });
});

describe('Revoke button', () => {
  it('renders on active rows only, with the dismissal id, the rule and its accessible names', () => {
    const buttons = revokeButtons(render({ dismissals: TWO_ACTIVE_ONE_REVOKED }));
    expect(buttons).toHaveLength(2);
    expect(buttons.filter((b) => b.includes('data-id="dis-revoked-1"'))).toHaveLength(0);
    const first = buttons.find((b) => b.includes('data-id="dis-active-1"'))!;
    expect(first).toContain('class="btn btn--ghost btn--sm"');
    expect(first).toContain(`data-code="${CODE}"`);
    expect(first).toContain(`aria-label="Revoke dismissal of rule ${CODE}"`);
    expect(first).toContain('title="Revoke dismissal"');
    expect(first).not.toMatch(/\son[a-z]+\s*=/i);
  });

  it('is a plain button in a table cell, never a form', () => {
    const html = render({ dismissals: TWO_ACTIVE_ONE_REVOKED });
    const section = /<details class="rpt-dismissed"[\s\S]*?<\/details>/.exec(html)![0];
    expect(section).not.toContain('<form');
  });

  it('the visible label is the translated word in every locale', () => {
    const expected: Record<string, string> = { de: 'Widerrufen', es: 'Revocar', fr: 'Révoquer', it: 'Revoca', pt: 'Revogar', en: 'Revoke' };
    for (const [locale, word] of Object.entries(expected)) {
      const html = render({ locale, dismissals: TWO_ACTIVE_ONE_REVOKED });
      const m = /<button[^>]*data-action="rptRevokeIssue"[^>]*>([^<]*)<\/button>/.exec(html)!;
      expect(m[1]!.trim(), locale).toBe(word);
    }
  });
});

describe('HARD-08 the key tag in the Dismissed section', () => {
  it('HARD-08 the dismissed section renders the key label with its creation time', () => {
    const keyCreatedAt = '2026-03-01T10:00:00.000Z';
    const stored: IssueDismissal = {
      id: 'd-key-1', orgId: 'org-fabrikam', siteUrl: 'https://fabrikam.example', siteKey: 'https://fabrikam.example',
      code: CODE, selector: SEL_PAGE, reason: 'Decorative', status: 'active',
      createdBy: 'api-key:k-fabrikam-ci', createdById: 'api-key:k-fabrikam-ci', createdAt: '2026-10-01T08:00:00.000Z',
      revokedBy: null, revokedById: null, revokedAt: null, revokeComment: null,
      createdByKeySnapshot: { label: 'CI deploy', keyCreatedAt },
    };
    const dismissals = buildDismissalsView([stored], { showKeyNames: true });
    const html = render({ dismissals: dismissals as unknown as Record<string, unknown> });
    const start = html.indexOf('id="rpt-dismissed"');
    expect(start).toBeGreaterThan(-1); // positive control: the section rendered
    const section = html.slice(start, html.indexOf('</details>', start));
    const text = section.replace(/<[^>]+>/g, '');
    expect(text).toContain(`API key: CI deploy (Created ${new Date(keyCreatedAt).toLocaleString()})`);
    expect(section).toContain(`<time datetime="${keyCreatedAt}">`);
    expect(section).not.toContain('api-key:');
    expect(section).not.toContain('k-fabrikam-ci');
  });
});
