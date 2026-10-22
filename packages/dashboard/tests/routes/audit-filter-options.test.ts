/**
 * AUD-02 (D-04): the Audit Log Action filter lists every dismissal audit action, derived from the one
 * declared constant the dismissal store also writes with, and shows the active filter as selected.
 *
 * Two kinds of guard live here. The static scan fails when a dismissal action literal is written in
 * src outside the declared constant (a new action cannot be written without being declared, and so
 * listed). The builder tests pin the selected-value rule, including a value the list does not name.
 *
 * Public repo: Fabrikam placeholders only.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import {
  ISSUE_DISMISSAL_AUDIT_ACTIONS,
  ISSUE_DISMISSAL_AUDIT_RESOURCE_TYPE,
} from '../../src/db/interfaces/issue-dismissal-repository.js';
import { actionOptions, resourceTypeOptions } from '../../src/routes/admin/audit-filter-options.js';

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../src');
const DECLARED: readonly string[] = Object.values(ISSUE_DISMISSAL_AUDIT_ACTIONS);

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFiles(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

let tmpRoot: string;
let storage: SqliteStorageAdapter;

beforeAll(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'luqen-audit-filter-'));
  storage = new SqliteStorageAdapter(join(tmpRoot, 'dashboard.db'));
  await storage.migrate();
});

afterAll(async () => {
  if (storage !== undefined) await storage.disconnect();
  if (tmpRoot !== undefined) rmSync(tmpRoot, { recursive: true, force: true });
});

describe('the dismissal audit actions are declared once', () => {
  it('AUD-02 every dismissal audit action written in src is a declared constant', () => {
    const found = new Set<string>();
    for (const file of tsFiles(SRC_DIR)) {
      const source = readFileSync(file, 'utf-8');
      for (const m of source.matchAll(/['"`](issue_dismissal\.[a-z_]+)['"`]/g)) found.add(m[1] as string);
    }
    // Positive control: the scan matched both declared values, so a scan that matches nothing cannot pass.
    expect([...found].sort()).toEqual(expect.arrayContaining([...DECLARED].sort()));
    expect(found.size).toBeGreaterThanOrEqual(2);
    const undeclared = [...found].filter((value) => !DECLARED.includes(value));
    expect(undeclared).toEqual([]);
  });

  it('AUD-02 the dismissal store writes its audit rows with the declared actions', async () => {
    const org = await storage.organizations.createOrg({ name: 'Fabrikam', slug: 'fabrikam-audit-filter' });
    const marked = await storage.issueDismissals!.mark({
      orgId: org.id, siteUrl: 'https://fabrikam.example/', siteKey: 'fabrikam.example',
      code: 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail', selector: '#fabrikam-note',
      reason: 'Fabrikam reason', actor: 'fabrikam-audit-filter-user', actorId: 'fabrikam-audit-filter-user-id',
    });
    if (marked.kind !== 'created') throw new Error('mark: already active');
    await storage.issueDismissals!.revoke({
      id: marked.dismissal.id, orgId: org.id, actor: 'fabrikam-audit-filter-user',
      actorId: 'fabrikam-audit-filter-user-id', comment: null,
    });
    const rows = await storage.audit.query({ resourceType: ISSUE_DISMISSAL_AUDIT_RESOURCE_TYPE, orgId: org.id });
    expect(rows.entries.map((e) => e.action).sort()).toEqual([...DECLARED].sort());
  });
});

describe('the Action filter options', () => {
  it('AUD-02 the Action filter lists every dismissal audit action', () => {
    const options = actionOptions('');
    for (const action of DECLARED) {
      const option = options.find((o) => o.value === action);
      expect(option, `option for ${action}`).toBeDefined();
      expect(typeof option?.labelKey, `label key for ${action}`).toBe('string');
    }
    expect(options.some((o) => o.selected)).toBe(false);
  });

  it('AUD-02 the Action filter selects the action given in the address', () => {
    const options = actionOptions(ISSUE_DISMISSAL_AUDIT_ACTIONS.mark);
    expect(options.filter((o) => o.selected).map((o) => o.value)).toEqual([ISSUE_DISMISSAL_AUDIT_ACTIONS.mark]);
    // A listed value that is not dismissal-related selects too.
    expect(actionOptions('login.success').filter((o) => o.selected).map((o) => o.value)).toEqual(['login.success']);
  });

  it('AUD-02 an action filter the list does not name is shown as selected', () => {
    const options = actionOptions('scan.create');
    const selected = options.filter((o) => o.selected);
    expect(selected).toEqual([{ value: 'scan.create', label: 'scan.create', selected: true }]);
    // The list itself is unchanged: the same options plus the one extra.
    expect(options.length).toBe(actionOptions('').length + 1);
  });

  it('AUD-02 All actions is selected only when no action filter is applied', () => {
    // The empty option is the template's; the builder selects nothing when nothing is applied and
    // exactly one option when something is, so the template's All is selected by `unless filters.action`.
    expect(actionOptions('').filter((o) => o.selected)).toEqual([]);
    for (const active of ['login.success', ISSUE_DISMISSAL_AUDIT_ACTIONS.revoke, 'scan.create']) {
      expect(actionOptions(active).filter((o) => o.selected).length, active).toBe(1);
    }
  });

  it('AUD-02 the Resource Type filter lists the dismissal resource type and selects an unlisted value', () => {
    const listed = resourceTypeOptions('');
    expect(listed.some((o) => o.value === ISSUE_DISMISSAL_AUDIT_RESOURCE_TYPE)).toBe(true);
    expect(listed.some((o) => o.selected)).toBe(false);
    expect(resourceTypeOptions(ISSUE_DISMISSAL_AUDIT_RESOURCE_TYPE).filter((o) => o.selected).map((o) => o.value))
      .toEqual([ISSUE_DISMISSAL_AUDIT_RESOURCE_TYPE]);
    expect(resourceTypeOptions('scan').filter((o) => o.selected))
      .toEqual([{ value: 'scan', label: 'scan', selected: true }]);
  });
});
