// Target rule of the remote dismissal UAT: it may write only into the dedicated UAT org and site.
//
// Pure and dependency-free so both remote.mjs and a vitest test can import it. The caller observes the
// target scan's org name and site URL as the admin persona (after login, before any persona login or
// write) and passes them here.
//
// Rules:
//   - both expected variables are REQUIRED; there are no defaults, so a forgotten variable refuses;
//   - the org name must equal LUQEN_UAT_EXPECT_ORG exactly (an org that could not be observed refuses);
//   - the site host (hostname only: no scheme, port, path or query) must equal LUQEN_UAT_EXPECT_SITE_HOST,
//     compared case-insensitively (a site that could not be observed or parsed refuses);
//   - a refusal carries variable NAMES only, never a value, a URL, a host or an org name.

export const EXPECT_ORG_VAR = 'LUQEN_UAT_EXPECT_ORG';
export const EXPECT_SITE_HOST_VAR = 'LUQEN_UAT_EXPECT_SITE_HOST';
export const TARGET_VARS = [EXPECT_ORG_VAR, EXPECT_SITE_HOST_VAR];

export const REFUSAL_PREFIX = 'REFUSED target is not the dedicated UAT org and site: ';
export const TARGET_PASS_LINE = 'PASS the target is the dedicated UAT org and site';

const present = (v) => typeof v === 'string' && v.trim() !== '';

/** The lower-cased hostname of a URL string, or null when it is absent or unparseable. */
function hostOf(siteUrl) {
  if (typeof siteUrl !== 'string' || siteUrl.trim() === '') return null;
  try {
    const host = new URL(siteUrl.trim()).hostname.toLowerCase();
    return host === '' ? null : host;
  } catch {
    return null;
  }
}

function orgMatches(env, observed) {
  if (!present(env[EXPECT_ORG_VAR])) return false;
  return typeof observed?.orgName === 'string' && observed.orgName === env[EXPECT_ORG_VAR];
}

function hostMatches(env, observed) {
  if (!present(env[EXPECT_SITE_HOST_VAR])) return false;
  const host = hostOf(observed?.siteUrl);
  return host !== null && host === env[EXPECT_SITE_HOST_VAR].trim().toLowerCase();
}

/**
 * null when the observed target is the declared dedicated UAT org and site; otherwise
 * { variables, message } naming the variables whose expectation is unset or unmet (names only).
 * @param {Record<string, string | undefined>} env
 * @param {{ orgName?: string | null, siteUrl?: string | null } | null | undefined} observed
 */
export function uatTargetRefusal(env, observed) {
  const variables = [
    ...(orgMatches(env ?? {}, observed) ? [] : [EXPECT_ORG_VAR]),
    ...(hostMatches(env ?? {}, observed) ? [] : [EXPECT_SITE_HOST_VAR]),
  ];
  if (variables.length === 0) return null;
  const unset = (name) => (present(env?.[name]) ? name : `${name} (not set)`);
  return { variables, message: `${REFUSAL_PREFIX}${variables.map(unset).join(', ')}` };
}
