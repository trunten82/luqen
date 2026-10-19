/**
 * The remote dismissal UAT writes one mark and one revoke into whatever scan it is pointed at, so it
 * must refuse every target that is not the declared dedicated UAT org and site. The decision is a pure
 * function (no browser, no network) so it is pinned here; remote.mjs calls it after the admin login and
 * before any persona login or write.
 */
import { describe, expect, it } from 'vitest';
import { uatTargetRefusal } from '../browser-uat/dismissals/target-guard.mjs';

interface Refusal {
  readonly variables: readonly string[];
  readonly message: string;
}

const ORG_VAR = 'LUQEN_UAT_EXPECT_ORG';
const HOST_VAR = 'LUQEN_UAT_EXPECT_SITE_HOST';
const PREFIX = 'REFUSED target is not the dedicated UAT org and site: ';

const ENV = { [ORG_VAR]: 'Fabrikam UAT', [HOST_VAR]: 'demo.example' } as const;
const MATCHING = { orgName: 'Fabrikam UAT', siteUrl: 'https://demo.example/' } as const;

const refusal = (env: Record<string, string | undefined>, observed: Record<string, unknown>): Refusal | null =>
  uatTargetRefusal(env, observed) as Refusal | null;

const without = (name: string): Record<string, string> => {
  const { [name]: _drop, ...rest } = ENV as Record<string, string>;
  return rest;
};

/** Every refusal case: env, observed, and the variable names the refusal must carry (in order). */
const REFUSAL_CASES: ReadonlyArray<{
  readonly label: string;
  readonly env: Record<string, string | undefined>;
  readonly observed: Record<string, unknown>;
  readonly variables: readonly string[];
}> = [
  { label: 'org variable missing', env: without(ORG_VAR), observed: MATCHING, variables: [ORG_VAR] },
  { label: 'org variable empty', env: { ...ENV, [ORG_VAR]: '   ' }, observed: MATCHING, variables: [ORG_VAR] },
  { label: 'host variable missing', env: without(HOST_VAR), observed: MATCHING, variables: [HOST_VAR] },
  { label: 'both variables missing', env: {}, observed: MATCHING, variables: [ORG_VAR, HOST_VAR] },
  { label: 'org name differs', env: ENV, observed: { ...MATCHING, orgName: 'Northwind' }, variables: [ORG_VAR] },
  { label: 'org name differs only by case', env: ENV, observed: { ...MATCHING, orgName: 'fabrikam uat' }, variables: [ORG_VAR] },
  { label: 'org not observed', env: ENV, observed: { ...MATCHING, orgName: null }, variables: [ORG_VAR] },
  { label: 'site host differs', env: ENV, observed: { ...MATCHING, siteUrl: 'https://www.example.com/' }, variables: [HOST_VAR] },
  { label: 'site host is a subdomain of the expected one', env: ENV, observed: { ...MATCHING, siteUrl: 'https://shop.demo.example/' }, variables: [HOST_VAR] },
  { label: 'site not observed', env: ENV, observed: { ...MATCHING, siteUrl: null }, variables: [HOST_VAR] },
  { label: 'site URL unparseable', env: ENV, observed: { ...MATCHING, siteUrl: 'not a url' }, variables: [HOST_VAR] },
  { label: 'both differ', env: ENV, observed: { orgName: 'Northwind', siteUrl: 'https://www.example.com/' }, variables: [ORG_VAR, HOST_VAR] },
];

describe('HARD-07 dismissal UAT target guard', () => {
  it('HARD-07 refuses when the expected org variable is missing', () => {
    for (const env of [without(ORG_VAR), { ...ENV, [ORG_VAR]: '' }, { ...ENV, [ORG_VAR]: '  ' }]) {
      const r = refusal(env, MATCHING);
      expect(r).not.toBeNull();
      expect(r?.variables).toEqual([ORG_VAR]);
      expect(r?.message).toContain(ORG_VAR);
    }
    // No default: the host variable is required in the same way.
    expect(refusal(without(HOST_VAR), MATCHING)?.variables).toEqual([HOST_VAR]);
  });

  it('HARD-07 refuses when the scan org name differs', () => {
    for (const orgName of ['Northwind', 'fabrikam uat', 'Fabrikam UAT ', null, undefined]) {
      const r = refusal(ENV, { ...MATCHING, orgName });
      expect(r, `orgName=${String(orgName)}`).not.toBeNull();
      expect(r?.variables).toEqual([ORG_VAR]);
    }
  });

  it('HARD-07 refuses when the site host differs', () => {
    for (const siteUrl of ['https://www.example.com/', 'https://shop.demo.example/', 'https://demo.example.other.test/', null, 'not a url']) {
      const r = refusal(ENV, { ...MATCHING, siteUrl });
      expect(r, `siteUrl=${String(siteUrl)}`).not.toBeNull();
      expect(r?.variables).toEqual([HOST_VAR]);
    }
  });

  it('HARD-07 accepts a matching dedicated target', () => {
    expect(refusal(ENV, MATCHING)).toBeNull();
    // The host is compared case-insensitively and without port, path or query.
    expect(refusal(ENV, { orgName: 'Fabrikam UAT', siteUrl: 'https://DEMO.Example:8443/some/path?q=1' })).toBeNull();
    expect(refusal({ ...ENV, [HOST_VAR]: ' Demo.EXAMPLE ' }, MATCHING)).toBeNull();
  });

  it('HARD-07 refusal output carries variable names only', () => {
    for (const c of REFUSAL_CASES) {
      const r = refusal(c.env, c.observed);
      expect(r, c.label).not.toBeNull();
      expect(r?.variables, c.label).toEqual(c.variables);
      expect(r?.message.startsWith(PREFIX), c.label).toBe(true);
      for (const name of c.variables) expect(r?.message, c.label).toContain(name);
      const values = [
        ...Object.values(c.env), ...Object.values(ENV),
        ...Object.values(c.observed), 'demo.example', 'www.example.com', 'shop.demo.example', 'Northwind', 'Fabrikam',
      ].filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
      for (const v of values) expect(r?.message.includes(v.trim()), `${c.label}: message holds a value`).toBe(false);
    }
  });
});
