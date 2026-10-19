// The Fabrikam test fixture of the dismissal UAT (placeholders only: no customer data).
//
// One completed scan over four pages:
//   NAV   same finding on all four pages with identical context -> a TEMPLATE item (Issues tab
//         "shared components" block AND the Templates tab)
//   HERO  the same finding on two pages -> a PAGE issue (2 occurrences on 2 pages)
//   PROMO a single page issue (used where a scenario needs a second, untouched finding)
//   WHOLE selector "html": refused by design (a whole-page selector cannot be dismissed)
//   LONG  a 600-character selector (long-text backstop)
export const SITE = 'https://dismiss-uat.example.test';
export const BACKFILL_SITE = 'https://backfill-uat.example.test';

export const NAV = { code: 'WCAG2AA.Principle2.Guideline2_4.2_4_4.H77', selector: '#site-nav a.logo', message: 'Link purpose is not clear' };
export const HERO = { code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37', selector: '#hero-img', message: 'Image is missing a text alternative' };
export const PROMO = { code: 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18', selector: '.promo-note', message: 'Text contrast is too low' };
export const WHOLE = { code: 'WCAG2AA.Principle3.Guideline3_1.3_1_1.H57.2', selector: 'html', message: 'Page language is not declared' };
export const LONG = {
  code: 'WCAG2AA.Principle1.Guideline1_3.1_3_1.H42',
  selector: `main > ${'section.fabrikam-card > div.northwind-row > '.repeat(14)}span.leaf`.slice(0, 600),
  message: 'Heading markup is missing',
};
export const PAGES = ['/', '/about', '/contact', '/pricing'];

export const issueOf = (f) => ({ type: 'error', code: f.code, message: f.message, selector: f.selector, context: `<span>${f.selector.slice(0, 40)}</span>` });

/** Total occurrences in the fixture: NAV x4, HERO x2, PROMO x1, WHOLE x1, LONG x1. */
export const FIXTURE_TOTAL = 9;

export function buildReport(site) {
  const at = (p) => `${site}${p}`;
  const pages = [
    { url: at('/'), issues: [issueOf(NAV), issueOf(HERO), issueOf(WHOLE)] },
    { url: at('/about'), issues: [issueOf(NAV), issueOf(HERO)] },
    { url: at('/contact'), issues: [issueOf(NAV), issueOf(LONG)] },
    { url: at('/pricing'), issues: [issueOf(NAV), issueOf(PROMO)] },
  ].map((p) => ({ ...p, issueCount: p.issues.length }));
  return {
    summary: { pagesScanned: pages.length, totalIssues: FIXTURE_TOTAL, byLevel: { error: FIXTURE_TOTAL, warning: 0, notice: 0 } },
    pages,
  };
}

/** A tiny report for the 150-row backfill site. */
export function buildSmallReport(site) {
  const issue = issueOf({ code: HERO.code, selector: '#row-1', message: HERO.message });
  return {
    summary: { pagesScanned: 1, totalIssues: 1, byLevel: { error: 1, warning: 0, notice: 0 } },
    pages: [{ url: `${site}/`, issueCount: 1, issues: [issue] }],
  };
}

export const REASON = 'The alternative text is supplied by a script after load.';

/**
 * A second scan of the refused scenario: two findings whose selector is one character over the server's
 * 4000-character dismissal limit, so their Dismiss button must render disabled at every issue site.
 * OVERLONG_TEMPLATE repeats on all four pages with identical context (a template item: the Issues tab's
 * shared-components block AND the Templates tab); OVERLONG_PAGE is a single page issue. PROMO on the
 * same report is the enabled control.
 */
export const SELECTOR_LIMIT = 4000;
const overlong = (prefix) => `${prefix}${'x'.repeat(SELECTOR_LIMIT + 1 - prefix.length)}`;
export const OVERLONG_TEMPLATE = { code: NAV.code, selector: overlong('#fabrikam-footer-'), message: NAV.message };
export const OVERLONG_PAGE = { code: HERO.code, selector: overlong('#fabrikam-hero-'), message: HERO.message };
export const OVERLONG_SITE = 'https://overlong-uat.example.test';

export function buildOverlongReport(site) {
  const pages = PAGES.map((p, i) => ({
    url: `${site}${p}`,
    issues: [issueOf(OVERLONG_TEMPLATE), ...(i === 0 ? [issueOf(OVERLONG_PAGE)] : []), ...(i === 3 ? [issueOf(PROMO)] : [])],
  })).map((p) => ({ ...p, issueCount: p.issues.length }));
  const total = pages.reduce((n, p) => n + p.issueCount, 0);
  return { summary: { pagesScanned: pages.length, totalIssues: total, byLevel: { error: total, warning: 0, notice: 0 } }, pages };
}
