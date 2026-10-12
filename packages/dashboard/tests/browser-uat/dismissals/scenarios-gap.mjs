// Scenarios added by the 89-11 gap closure (the owner's D-15 Q1 review items):
//   attribution  item 2: an API-key actor reads "API key: <label>" only for the scan org's own key,
//                and the stored `api-key:<id>` identifier never reaches the page.
import { check, login, openReport, openDismissedSection, localeString, shot, scrollToInstant } from './lib.mjs';

/** Per-scenario world options for bootLocal (the default world is unchanged). */
export const GAP_WORLD = {
  attribution: { apiKeyActors: true },
};

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
    check(S, 'the org-key dismissal reads API key: Fabrikam CI', by[keyActors.fabrikamCode].text === 'API key: Fabrikam CI', JSON.stringify(by[keyActors.fabrikamCode]));
    check(S, 'the system-key dismissal reads API key', by[keyActors.systemCode].text === 'API key', JSON.stringify(by[keyActors.systemCode]));
    const html = await page.$eval('#rpt-dismissed', (d) => d.outerHTML);
    check(S, 'the section HTML contains no api-key: identifier and no key id',
      !html.includes('api-key:') && !html.includes(keyActors.fabrikamKeyId) && !html.includes(keyActors.systemKeyId));
    await scrollToInstant(page, '#rpt-dismissed');
    await shot(page, 'gap-attribution-1280');
  },
};
