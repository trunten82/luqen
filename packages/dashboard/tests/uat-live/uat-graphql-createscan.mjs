#!/usr/bin/env node
// Read-back of GraphQL createScan on a RUNNING dashboard, configured ONLY by environment variables.
//
//   node uat-graphql-createscan.mjs              full: create one scan in the UAT org, watch it, delete it
//   node uat-graphql-createscan.mjs --preflight  session checks only (login, org found, switch, org asserted); no /graphql call
//   node uat-graphql-createscan.mjs --selftest   drive the SAME run function against an in-process fake server
//
// Environment (names only; values are never printed):
//   LUQEN_UAT_BASE_URL, LUQEN_UAT_ADMIN_USER, LUQEN_UAT_ADMIN_PASS      required (exit 2 naming the missing ones)
//   LUQEN_UAT_BASE_URL must be https:// (exit 2 otherwise), except http://127.0.0.1:<port> / http://localhost:<port> for a local rehearsal
//   LUQEN_UAT_ORG_NAME            default 'Fabrikam UAT'
//   LUQEN_UAT_SCAN_TARGET         default 'https://example.com'
//   LUQEN_UAT_PRIVATE_PROBE       'on' (default) | 'off'
//   LUQEN_UAT_SCHEDULE_PROBE      'on' (default) | 'off'  (the schedule-create start-validation check; full mode only)
//   LUQEN_UAT_CSRF_PROBE          'on' (default) | 'off'  (the cookie-session API delete check on this run's own scan; full mode only)
//   LUQEN_UAT_LEAVE_QUEUED_S (120), LUQEN_UAT_TERMINAL_S (600), LUQEN_UAT_POLL_MS (5000)
//
// Hard rules, pinned by --selftest:
//   - nothing is written (no /graphql call at all) unless the current org was asserted by NAME and id after
//     the switch; the script never falls through to the system org;
//   - output carries check names, status words and elapsed seconds only: never a URL, username, password,
//     org name or id, scan id, or server error text (a sentinel grep runs over every selftest world's output);
//   - every scan this run created is deleted in a finally block and read back as null;
//   - a schedule the server accepted for the loopback probe is deleted and read back as absent (--preflight never posts one);
//   - the CSRF probe sends one token-less DELETE through /api, only for this run's own scan once it is completed or
//     failed; if the server accepted it, the scan is already gone and cleanup still reads it back as null.
import { pathToFileURL } from 'node:url';

export const REQUIRED_VARS = ['LUQEN_UAT_BASE_URL', 'LUQEN_UAT_ADMIN_USER', 'LUQEN_UAT_ADMIN_PASS'];
export const PRIVATE_TARGET_ERROR = 'Scanning internal or private addresses is not allowed.';
const LOOPBACK_TARGET = 'http://127.0.0.1/';
const SCHEDULE_CHECK = 'a loopback target is refused for a new schedule';
const SCHEDULE_CLEANUP = 'cleanup removed the probe schedule';
const CSRF_CHECK = 'a cookie session without the csrf token cannot delete through the api';
const KNOWN_STATUS = ['queued', 'running', 'completed', 'failed'];

/** Names (never values) of the required variables that are absent or empty. */
export function missingVars(env) {
  return REQUIRED_VARS.filter((name) => typeof env[name] !== 'string' || env[name].trim() === '');
}

/**
 * The admin password and session cookie travel to this URL, so it must be https://. Plain http is
 * accepted only for the local rehearsal: exactly http://127.0.0.1:<port> or http://localhost:<port>.
 * Returns true when the value is acceptable; never echoes it.
 */
export function baseUrlAllowed(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (/^http:\/\/(127\.0\.0\.1|localhost):[0-9]{1,5}\/?$/i.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname !== '' && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}

const positive = (raw, fallback) => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

function readConfig(env) {
  return {
    user: env.LUQEN_UAT_ADMIN_USER,
    pass: env.LUQEN_UAT_ADMIN_PASS,
    orgName: env.LUQEN_UAT_ORG_NAME?.trim() || 'Fabrikam UAT',
    target: env.LUQEN_UAT_SCAN_TARGET?.trim() || 'https://example.com',
    probe: (env.LUQEN_UAT_PRIVATE_PROBE ?? 'on').trim().toLowerCase() !== 'off',
    scheduleProbe: (env.LUQEN_UAT_SCHEDULE_PROBE ?? 'on').trim().toLowerCase() !== 'off',
    csrfProbe: (env.LUQEN_UAT_CSRF_PROBE ?? 'on').trim().toLowerCase() !== 'off',
    leaveS: positive(env.LUQEN_UAT_LEAVE_QUEUED_S, 120),
    terminalS: positive(env.LUQEN_UAT_TERMINAL_S, 600),
    pollMs: positive(env.LUQEN_UAT_POLL_MS, 5000),
  };
}

/**
 * Ids of the schedules whose listed start URL equals `target`, read from the /schedules HTML listing:
 * a row carries its start URL in the cell--url cell and its id in the hx-delete path.
 */
export function parseScheduleIds(html, target) {
  const ids = [];
  for (const row of String(html).split('<tr>').slice(1)) {
    const cell = /<td[^>]*class="cell--url"[^>]*>([^<]*)<\/td>/.exec(row);
    const del = /hx-delete="\/schedules\/([^"]+)"/.exec(row);
    if (cell !== null && del !== null && cell[1].trim() === target) ids.push(del[1]);
  }
  return ids;
}

const Q_CREATE = 'mutation($input: CreateScanInput!) { createScan(input: $input) { id status } }';
const Q_SCAN = 'query($id: ID!) { scan(id: $id) { status } }';
const Q_DELETE = 'mutation($id: ID!) { deleteScan(id: $id) }';

/**
 * The whole read-back. transport({ method, path, form?, json?, csrf? }) -> { status, text, location }.
 * Returns the exit code: 0 all checks passed, 1 a check failed, 2 configuration missing.
 */
export async function run({ env, mode, transport, sleep, now, log }) {
  const missing = missingVars(env);
  if (missing.length > 0) {
    log(`MISSING ${missing.join(', ')} (set them in the environment; values are never printed)`);
    return 2;
  }
  if (!baseUrlAllowed(env.LUQEN_UAT_BASE_URL)) {
    log('REFUSED LUQEN_UAT_BASE_URL must be https:// (plain http only for a loopback host with an explicit port); value never printed');
    return 2;
  }
  const cfg = readConfig(env);
  const session = { loggedIn: false, csrf: '', orgId: null };
  const cleanupIds = [];
  let fails = 0;

  const check = async (name, fn) => {
    let ok = false;
    try { ok = (await fn()) === true; } catch { ok = false; }
    if (ok) log(`PASS ${name}`);
    else { fails += 1; log(`FAIL ${name} (details withheld)`); }
    return ok;
  };

  const gql = async (query, variables) => {
    const res = await transport({ method: 'POST', path: '/graphql', json: { query, variables } });
    if (res.status !== 200) throw new Error('graphql transport status');
    const body = JSON.parse(res.text);
    return { data: body.data ?? null, errors: Array.isArray(body.errors) ? body.errors : [] };
  };

  const pageCsrf = async () => {
    const res = await transport({ method: 'GET', path: '/reports' });
    const m = /name="csrf-token" content="([^"]*)"/.exec(res.text);
    if (res.status !== 200 || m === null) throw new Error('no csrf token');
    return m[1];
  };

  const currentOrg = async () => {
    const res = await transport({ method: 'GET', path: '/orgs/current' });
    if (res.status !== 200) throw new Error('orgs/current status');
    return JSON.parse(res.text);
  };

  const logout = async () => {
    if (!session.loggedIn) return;
    try {
      const csrf = session.csrf !== '' ? session.csrf : await pageCsrf();
      await transport({ method: 'POST', path: '/logout', form: {}, csrf });
    } catch { /* best effort */ }
  };

  // Schedule probe state: the ids that already listed the loopback target before the probe POST (never touched),
  // and whether the POST was sent (so the sweep below runs even when the verdict check threw).
  const sched = { before: null, sent: false };
  const scheduleIdsNow = async () => {
    const res = await transport({ method: 'GET', path: '/schedules' });
    if (res.status !== 200) throw new Error('schedules listing status');
    return parseScheduleIds(res.text, LOOPBACK_TARGET);
  };
  const newScheduleIds = async () => (await scheduleIdsNow()).filter((id) => !sched.before.has(id));

  // ── session preconditions (checks 1-4) ───────────────────────────────────
  const preconditionsOk =
    (await check('login as the admin persona', async () => {
      const page = await transport({ method: 'GET', path: '/login' });
      const m = /name="_csrf" value="([^"]*)"/.exec(page.text);
      if (page.status !== 200 || m === null) return false;
      const res = await transport({ method: 'POST', path: '/login', form: { username: cfg.user, password: cfg.pass, _csrf: m[1] } });
      session.loggedIn = res.status === 302;
      return session.loggedIn;
    })) &&
    (await check("the UAT org is found by name among the admin's orgs", async () => {
      const info = await currentOrg();
      const hits = (Array.isArray(info.userOrgs) ? info.userOrgs : []).filter((o) => o?.name === cfg.orgName);
      if (hits.length !== 1 || typeof hits[0].id !== 'string' || hits[0].id === '') return false;
      session.orgId = hits[0].id;
      return true;
    })) &&
    (await check('switch to the UAT org', async () => {
      session.csrf = await pageCsrf();
      const res = await transport({ method: 'POST', path: '/orgs/switch', form: { orgId: session.orgId, _csrf: session.csrf }, csrf: session.csrf });
      return res.status === 302;
    })) &&
    (await check('the current org is the UAT org by name and id before any write', async () => {
      const info = await currentOrg();
      return info.currentOrgId === session.orgId && info.currentOrg?.name === cfg.orgName;
    }));

  if (!preconditionsOk) {
    await logout();
    return 1;
  }
  if (mode === 'preflight') {
    await logout();
    return fails === 0 ? 0 : 1;
  }

  // ── the read-back proper (checks 5-8), cleanup always ────────────────────
  const readBack = async () => {
    if (cfg.probe) {
      const probeOk = await check('a loopback target is refused through GraphQL', async () => {
        const r = await gql(Q_CREATE, { input: { siteUrl: LOOPBACK_TARGET, standard: 'WCAG2AA' } });
        const made = r.data?.createScan;
        if (typeof made?.id === 'string') { cleanupIds.push(made.id); return false; }
        return r.errors[0]?.message === PRIVATE_TARGET_ERROR;
      });
      if (!probeOk) return;
    } else {
      log('SKIP a loopback target is refused through GraphQL (LUQEN_UAT_PRIVATE_PROBE=off)');
    }

    if (cfg.scheduleProbe) {
      const scheduleOk = await check(SCHEDULE_CHECK, async () => {
        sched.before = new Set(await scheduleIdsNow());
        sched.sent = true;
        const res = await transport({
          method: 'POST',
          path: '/schedules',
          form: { siteUrl: LOOPBACK_TARGET, standard: 'WCAG2AA', frequency: 'weekly', _csrf: session.csrf },
          csrf: session.csrf,
          htmx: true,
        });
        const made = await newScheduleIds();
        return res.status === 400 && res.text.includes(PRIVATE_TARGET_ERROR) && made.length === 0;
      });
      if (!scheduleOk) return;
    } else {
      log(`SKIP ${SCHEDULE_CHECK} (disabled by LUQEN_UAT_SCHEDULE_PROBE)`);
    }

    let scanId = null;
    const created = await check('graphql createScan returned a queued scan', async () => {
      const r = await gql(Q_CREATE, { input: { siteUrl: cfg.target, standard: 'WCAG2AA' } });
      const made = r.data?.createScan;
      if (typeof made?.id !== 'string' || made.id === '') return false;
      scanId = made.id;
      cleanupIds.push(scanId);
      return made.status === 'queued';
    });
    if (!created) return;

    const t0 = now();
    let lastWord = null;
    const observe = async () => {
      const r = await gql(Q_SCAN, { id: scanId });
      const status = r.data?.scan?.status;
      if (typeof status !== 'string') throw new Error('no status');
      const word = KNOWN_STATUS.includes(status) ? status : 'unrecognised';
      if (word !== lastWord) {
        lastWord = word;
        log(`INFO ${word} after ${Math.round(now() - t0)} s`);
      }
      return status;
    };

    const left = await check(`the scan left queued within ${cfg.leaveS} s`, async () => {
      for (;;) {
        if ((await observe()) !== 'queued') return true;
        if (now() - t0 >= cfg.leaveS) return false;
        await sleep(cfg.pollMs);
      }
    });
    if (!left) return;

    let terminal = null;
    await check(`the scan reached completed or failed within ${cfg.terminalS} s`, async () => {
      for (;;) {
        const status = await observe();
        if (status === 'completed' || status === 'failed') { terminal = status; return true; }
        if (now() - t0 >= cfg.terminalS) return false;
        await sleep(cfg.pollMs);
      }
    });
    if (terminal === 'failed') log('WARN the scan ended failed - inspect it on the server by hand (details withheld)');
    if (terminal === null) return;

    // A cookie session that sends no CSRF token must be refused on an /api write. The target is this run's
    // own scan; the refusal must name the token (a 403 for another reason proves nothing) and the scan must
    // still exist afterwards. The response body is read, never printed.
    if (!cfg.csrfProbe) {
      log(`SKIP ${CSRF_CHECK} (disabled by LUQEN_UAT_CSRF_PROBE)`);
      return;
    }
    await check(CSRF_CHECK, async () => {
      const res = await transport({ method: 'DELETE', path: `/api/v1/scans/${encodeURIComponent(scanId)}` });
      const refused = res.status === 403 && /csrf/i.test(res.text);
      const still = await gql(Q_SCAN, { id: scanId });
      return refused && typeof still.data?.scan?.status === 'string';
    });
  };

  const sweepSchedules = async () => {
    if (!sched.sent) return;
    let ids = null;
    try { ids = await newScheduleIds(); } catch { ids = null; }
    if (ids !== null && ids.length === 0) return;
    await check(SCHEDULE_CLEANUP, async () => {
      if (ids === null) return false;
      for (const id of ids) await transport({ method: 'DELETE', path: `/schedules/${id}`, csrf: session.csrf, htmx: true });
      return (await newScheduleIds()).length === 0;
    });
  };

  try {
    await readBack();
  } finally {
    await sweepSchedules();
    if (cleanupIds.length > 0) {
      await check('cleanup left no UAT scan behind', async () => {
        let clean = true;
        for (const id of cleanupIds) {
          try {
            // A scan the server already deleted (an accepted CSRF probe) needs no delete; it must still read back null.
            const before = await gql(Q_SCAN, { id });
            if (before.data?.scan !== null) {
              const del = await gql(Q_DELETE, { id });
              if (del.data?.deleteScan !== true) clean = false;
            }
            const gone = await gql(Q_SCAN, { id });
            if (gone.data?.scan !== null) clean = false;
          } catch { clean = false; }
        }
        return clean;
      });
    }
    await logout();
  }
  return fails === 0 ? 0 : 1;
}

// ── real transport: fetch + an in-memory cookie jar ────────────────────────────

export function createFetchTransport(baseUrl) {
  const jar = new Map();
  const absorb = (res) => {
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const [pair, ...attrs] = line.split(';');
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const expired = attrs.some((a) => /^\s*max-age\s*=\s*0\s*$/i.test(a));
      if (value === '' || expired) jar.delete(name);
      else jar.set(name, value);
    }
  };
  return async ({ method, path, form, json, csrf, htmx }) => {
    const headers = {};
    if (htmx === true) headers['hx-request'] = 'true';
    if (jar.size > 0) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    if (csrf) headers['x-csrf-token'] = csrf;
    let body;
    if (form !== undefined) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(form).toString();
    } else if (json !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(json);
    }
    const res = await fetch(new URL(path, baseUrl), { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(30000) });
    absorb(res);
    return { status: res.status, text: await res.text(), location: res.headers.get('location') ?? '' };
  };
}

// ── selftest: the SAME run function against an in-process fake server ────────────

const SENT = {
  base: 'https://base-url-sentinel.invalid',
  user: 'user-sentinel',
  pass: 'pass-sentinel',
  orgName: 'Org Name Sentinel UAT',
  target: 'https://target-sentinel.invalid/page',
  uatId: 'org-id-sentinel-uat',
  otherId: 'org-id-sentinel-other',
  dupId: 'org-id-sentinel-dup',
  scanId: 'scan-id-sentinel-1',
  privateScanId: 'scan-id-sentinel-private',
  scheduleId: 'schedule-id-sentinel-1',
};

/** One fake dashboard. `world` picks the behaviour under test; the fake records what the script did to it. */
function makeFake(world) {
  const uat = { id: SENT.uatId, name: SENT.orgName };
  const other = { id: SENT.otherId, name: 'Org Name Sentinel Other' };
  const dup = { id: SENT.dupId, name: SENT.orgName };
  const allOrgs = [uat, other, dup];
  const userOrgs = world === 'wrong-org' ? [other] : [uat, other];
  const schedules = new Map();
  const rec = { gqlCalls: 0, calls: 0, creates: [], deleted: [], apiDeletes: 0, apiDeleted: [], schedulePosts: 0, scheduleDeletes: [], get scheduleStored() { return schedules.size; } };
  const state = { loggedIn: false, currentOrgId: world === 'switch-ignored' ? dup.id : '' };
  const scans = new Map();
  const reply = (status, text = '', location = '') => ({ status, text, location });
  const json = (obj) => reply(200, JSON.stringify(obj));

  const graphql = (req) => {
    rec.gqlCalls += 1;
    const { query: q, variables: v = {} } = req.json;
    if (q.includes('deleteScan(')) {
      const had = scans.delete(v.id);
      if (had) rec.deleted.push(v.id);
      return json({ data: { deleteScan: had } });
    }
    if (q.includes('createScan(')) {
      rec.creates.push(v.input);
      if (String(v.input.siteUrl).includes('127.0.0.1')) {
        if (world !== 'private-accepted') return json({ data: null, errors: [{ message: PRIVATE_TARGET_ERROR }] });
        scans.set(SENT.privateScanId, { polls: 0 });
        return json({ data: { createScan: { id: SENT.privateScanId, status: 'queued' } } });
      }
      scans.set(SENT.scanId, { polls: 0 });
      return json({ data: { createScan: { id: SENT.scanId, status: 'queued' } } });
    }
    const rec1 = scans.get(v.id);
    if (rec1 === undefined) return json({ data: { scan: null } });
    rec1.polls += 1;
    const status = world === 'stuck' ? 'queued' : ['queued', 'running', 'completed'][Math.min(rec1.polls - 1, 2)];
    return json({ data: { scan: { status } } });
  };

  const transport = async (req) => {
    rec.calls += 1;
    const authed = state.loggedIn;
    if (req.method === 'GET' && req.path === '/login') return reply(200, '<input type="hidden" name="_csrf" value="csrf-login">');
    if (req.method === 'POST' && req.path === '/login') {
      const f = req.form ?? {};
      if (f._csrf !== 'csrf-login' || f.username !== SENT.user || f.password !== SENT.pass) return reply(200, 'login page again');
      state.loggedIn = true;
      return reply(302, '', '/');
    }
    if (!authed) return reply(401, 'Authentication required');
    if (req.method === 'GET' && req.path === '/reports') return reply(200, '<meta name="csrf-token" content="csrf-page">');
    if (req.method === 'GET' && req.path === '/orgs/current') {
      const cur = allOrgs.find((o) => o.id === state.currentOrgId) ?? null;
      return json({ currentOrgId: cur === null ? null : cur.id, currentOrg: cur, userOrgs });
    }
    if (req.method === 'POST' && req.path === '/orgs/switch') {
      if (req.csrf !== 'csrf-page') return reply(403, 'csrf');
      const target = userOrgs.find((o) => o.id === req.form?.orgId);
      if (target === undefined) return reply(403, 'no access');
      if (world !== 'switch-ignored') state.currentOrgId = target.id;
      return reply(302, '', '/');
    }
    if (req.method === 'POST' && req.path === '/graphql') return graphql(req);
    if (req.method === 'POST' && req.path === '/schedules') {
      if (req.csrf !== 'csrf-page' || req.form?._csrf !== 'csrf-page' || req.htmx !== true) return reply(403, 'csrf');
      rec.schedulePosts += 1;
      const url = String(req.form.siteUrl);
      if (world === 'schedule-accepted') {
        schedules.set(SENT.scheduleId, url);
        return reply(200, '<div class="toast">Schedule created</div>');
      }
      if (world === 'schedule-wrong-text') return reply(400, '<div class="toast">Site URL must be a valid URL</div>');
      return reply(400, `<div class="toast">${PRIVATE_TARGET_ERROR}</div>`);
    }
    if (req.method === 'GET' && req.path === '/schedules') {
      const rows = [...schedules].map(([id, url]) => `<tr><td data-label="Site URL" class="cell--url">${url}</td><td><button hx-delete="/schedules/${id}">x</button></td></tr>`);
      return reply(200, `<table><thead><tr><th>Site URL</th></tr></thead><tbody>${rows.join('')}</tbody></table>`);
    }
    if (req.method === 'DELETE' && req.path.startsWith('/schedules/')) {
      if (req.csrf !== 'csrf-page') return reply(403, 'csrf');
      const id = req.path.slice('/schedules/'.length);
      if (schedules.delete(id)) rec.scheduleDeletes.push(id);
      return reply(200, '<div class="toast">Schedule deleted</div>');
    }
    if (req.method === 'DELETE' && req.path.startsWith('/api/v1/scans/')) {
      // The real server: a cookie session without the token -> 403 naming the csrf token; with it -> a real delete.
      // api-delete-accepted: the server deletes without a token. api-delete-refused-other: 403 for another reason.
      rec.apiDeletes += 1;
      if (world === 'api-delete-refused-other') return reply(403, '{"error":"Forbidden"}');
      if (req.csrf !== 'csrf-page' && world !== 'api-delete-accepted') return reply(403, '{"error":"Invalid csrf token"}');
      const id = decodeURIComponent(req.path.slice('/api/v1/scans/'.length));
      if (!scans.delete(id)) return reply(404, '{"error":"Scan not found"}');
      rec.apiDeleted.push(id);
      return reply(200, '{"success":true}');
    }
    if (req.method === 'POST' && req.path === '/logout') { state.loggedIn = false; return reply(302, '', '/login'); }
    return reply(404, 'not found');
  };
  return { transport, rec };
}

const hasLine = (lines, text) => lines.includes(text);
const startsWith = (lines, prefix) => lines.some((l) => l.startsWith(prefix));
const SENTINELS = [...Object.values(SENT), '127.0.0.1'];
const ALL_PASS_FULL = [
  'PASS login as the admin persona',
  "PASS the UAT org is found by name among the admin's orgs",
  'PASS switch to the UAT org',
  'PASS the current org is the UAT org by name and id before any write',
  'PASS a loopback target is refused through GraphQL',
  `PASS ${SCHEDULE_CHECK}`,
  'PASS graphql createScan returned a queued scan',
  'PASS the scan left queued within 3 s',
  'PASS the scan reached completed or failed within 6 s',
  `PASS ${CSRF_CHECK}`,
  'PASS cleanup left no UAT scan behind',
];

/** Each world: how to start it, and what it must have done (unmet expectations are returned as text). */
const WORLDS = [
  {
    name: 'completes',
    expect: ({ code, lines, rec }) => {
      const un = [];
      if (code !== 0) un.push(`exit ${code} instead of 0`);
      for (const l of ALL_PASS_FULL) if (!hasLine(lines, l)) un.push(`missing line: ${l}`);
      if (startsWith(lines, 'FAIL')) un.push('a FAIL line was printed');
      if (rec.deleted.join() !== SENT.scanId) un.push('deleteScan was not called for exactly the created scan');
      const real = rec.creates.filter((c) => c.siteUrl === SENT.target);
      if (real.length !== 1 || real[0].standard !== 'WCAG2AA') un.push('the target scan was not created once with WCAG2AA');
      if (!startsWith(lines, 'INFO running after')) un.push('no INFO line for the running status');
      if (rec.schedulePosts !== 1) un.push(`${rec.schedulePosts} schedule POST(s) instead of exactly 1`);
      if (rec.scheduleStored !== 0) un.push('a schedule is still stored');
      if (startsWith(lines, `PASS ${SCHEDULE_CLEANUP}`)) un.push('a schedule cleanup ran although nothing was stored');
      if (rec.apiDeletes !== 1) un.push(`${rec.apiDeletes} API delete(s) instead of exactly 1`);
      if (rec.apiDeleted.length !== 0) un.push('the token-less API delete removed a scan');
      return un;
    },
  },
  {
    name: 'api-delete-accepted',
    expect: ({ code, lines, rec }) => {
      const un = [];
      if (code !== 1) un.push(`exit ${code} instead of 1`);
      if (!hasLine(lines, `FAIL ${CSRF_CHECK} (details withheld)`)) un.push('the csrf check did not fail');
      if (rec.apiDeletes !== 1) un.push(`${rec.apiDeletes} API delete(s) instead of exactly 1`);
      if (rec.apiDeleted.join() !== SENT.scanId) un.push('the accepted API delete did not remove exactly the run\'s own scan');
      if (!hasLine(lines, 'PASS cleanup left no UAT scan behind')) un.push('cleanup did not pass its null read-back');
      if (rec.deleted.length !== 0) un.push('cleanup called deleteScan for a scan that was already gone');
      return un;
    },
  },
  {
    name: 'api-delete-refused-other',
    expect: ({ code, lines, rec }) => {
      const un = [];
      if (code !== 1) un.push(`exit ${code} instead of 1`);
      if (!hasLine(lines, `FAIL ${CSRF_CHECK} (details withheld)`)) un.push('a 403 that does not name the csrf token passed the csrf check');
      if (rec.apiDeleted.length !== 0) un.push('the fake removed a scan');
      if (rec.deleted.join() !== SENT.scanId) un.push('cleanup did not delete the run\'s own scan');
      if (!hasLine(lines, 'PASS cleanup left no UAT scan behind')) un.push('cleanup did not pass');
      return un;
    },
  },
  {
    name: 'csrf-probe-off',
    fake: 'completes',
    env: { LUQEN_UAT_CSRF_PROBE: 'off' },
    expect: ({ code, lines, rec }) => {
      const un = [];
      if (code !== 0) un.push(`exit ${code} instead of 0`);
      if (!hasLine(lines, `SKIP ${CSRF_CHECK} (disabled by LUQEN_UAT_CSRF_PROBE)`)) un.push('no SKIP line for the disabled csrf check');
      if (rec.apiDeletes !== 0) un.push(`${rec.apiDeletes} API delete(s) with the probe disabled`);
      for (const l of ALL_PASS_FULL) if (l !== `PASS ${CSRF_CHECK}` && !hasLine(lines, l)) un.push(`missing line: ${l}`);
      if (startsWith(lines, 'FAIL')) un.push('a FAIL line was printed');
      return un;
    },
  },
  {
    name: 'schedule-accepted',
    expect: ({ code, lines, rec }) => {
      const un = [];
      if (code !== 1) un.push(`exit ${code} instead of 1`);
      if (!hasLine(lines, `FAIL ${SCHEDULE_CHECK} (details withheld)`)) un.push('the schedule check did not fail');
      if (rec.schedulePosts !== 1) un.push(`${rec.schedulePosts} schedule POST(s) instead of exactly 1`);
      if (rec.scheduleDeletes.join() !== SENT.scheduleId) un.push('the stored schedule was not deleted exactly once');
      if (rec.scheduleStored !== 0) un.push('the probe schedule is still stored after cleanup');
      if (!hasLine(lines, `PASS ${SCHEDULE_CLEANUP}`)) un.push('the schedule cleanup did not pass');
      if (rec.creates.some((c) => c.siteUrl === SENT.target)) un.push('a createScan ran after the schedule check failed');
      if (startsWith(lines, 'PASS graphql createScan')) un.push('a createScan passed after the schedule check failed');
      return un;
    },
  },
  {
    name: 'schedule-wrong-text',
    expect: ({ code, lines, rec }) => {
      const un = [];
      if (code !== 1) un.push(`exit ${code} instead of 1`);
      if (!hasLine(lines, `FAIL ${SCHEDULE_CHECK} (details withheld)`)) un.push('the schedule check did not fail');
      if (rec.schedulePosts !== 1) un.push(`${rec.schedulePosts} schedule POST(s) instead of exactly 1`);
      if (rec.scheduleDeletes.length !== 0) un.push('a schedule delete was sent although nothing was stored');
      if (rec.creates.some((c) => c.siteUrl === SENT.target)) un.push('a createScan ran after the schedule check failed');
      return un;
    },
  },
  {
    name: 'schedule-probe-off',
    fake: 'completes',
    env: { LUQEN_UAT_SCHEDULE_PROBE: 'off' },
    expect: ({ code, lines, rec }) => {
      const un = [];
      if (code !== 0) un.push(`exit ${code} instead of 0`);
      if (!hasLine(lines, `SKIP ${SCHEDULE_CHECK} (disabled by LUQEN_UAT_SCHEDULE_PROBE)`)) un.push('no SKIP line for the disabled schedule check');
      if (rec.schedulePosts !== 0) un.push(`${rec.schedulePosts} schedule POST(s) with the probe disabled`);
      for (const l of ALL_PASS_FULL) if (l !== `PASS ${SCHEDULE_CHECK}` && !hasLine(lines, l)) un.push(`missing line: ${l}`);
      if (startsWith(lines, 'FAIL')) un.push('a FAIL line was printed');
      return un;
    },
  },
  {
    name: 'stuck',
    expect: ({ code, lines, rec }) => {
      const un = [];
      if (code !== 1) un.push(`exit ${code} instead of 1`);
      if (!hasLine(lines, 'FAIL the scan left queued within 3 s (details withheld)')) un.push('the left-queued check did not fail');
      if (startsWith(lines, 'PASS the scan left queued')) un.push('the left-queued check passed');
      if (rec.deleted.join() !== SENT.scanId) un.push('deleteScan was not called for the stuck scan');
      if (rec.apiDeletes !== 0) un.push('the csrf probe ran on a scan that never reached a terminal state');
      if (!hasLine(lines, 'PASS cleanup left no UAT scan behind')) un.push('cleanup did not pass');
      return un;
    },
  },
  {
    name: 'wrong-org',
    expect: ({ code, lines, rec }) => {
      const un = [];
      if (code !== 1) un.push(`exit ${code} instead of 1`);
      if (rec.gqlCalls !== 0) un.push(`${rec.gqlCalls} GraphQL call(s) made without the org asserted`);
      if (!hasLine(lines, "FAIL the UAT org is found by name among the admin's orgs (details withheld)")) un.push('the org-found check did not fail');
      return un;
    },
  },
  {
    name: 'switch-ignored',
    expect: ({ code, lines, rec }) => {
      const un = [];
      if (code !== 1) un.push(`exit ${code} instead of 1`);
      if (rec.gqlCalls !== 0) un.push(`${rec.gqlCalls} GraphQL call(s) made without the org asserted`);
      if (!hasLine(lines, 'FAIL the current org is the UAT org by name and id before any write (details withheld)')) un.push('the org assertion did not fail');
      return un;
    },
  },
  {
    name: 'private-accepted',
    expect: ({ code, lines, rec }) => {
      const un = [];
      if (code !== 1) un.push(`exit ${code} instead of 1`);
      if (!hasLine(lines, 'FAIL a loopback target is refused through GraphQL (details withheld)')) un.push('the loopback check did not fail');
      if (rec.creates.length !== 1) un.push(`${rec.creates.length} createScan call(s) instead of exactly 1`);
      if (rec.deleted.join() !== SENT.privateScanId) un.push('the wrongly accepted scan was not deleted');
      if (startsWith(lines, 'PASS graphql createScan')) un.push('a second createScan ran after the loopback failure');
      return un;
    },
  },
  ...[
    ['plain-http-refused', 'http://base-url-sentinel.invalid'],
    ['loopback-lookalike-refused', 'http://127.0.0.1.base-url-sentinel.invalid:80'],
    ['userinfo-loopback-refused', 'http://127.0.0.1:80@base-url-sentinel.invalid'],
    ['non-http-scheme-refused', 'ftp://base-url-sentinel.invalid'],
  ].map(([name, base]) => ({
    name,
    base,
    expect: ({ code, lines, rec }) => {
      const un = [];
      if (code !== 2) un.push(`exit ${code} instead of 2`);
      if (rec.calls !== 0) un.push(`${rec.calls} request(s) sent to a refused base url`);
      if (lines.length !== 1 || !lines[0].startsWith('REFUSED LUQEN_UAT_BASE_URL ')) un.push('no single REFUSED line naming LUQEN_UAT_BASE_URL');
      return un;
    },
  })),
  ...[
    ['loopback-ip-http-allowed', 'http://127.0.0.1:8080'],
    ['localhost-http-allowed', 'http://localhost:8080/'],
  ].map(([name, base]) => ({
    name,
    base,
    fake: 'completes',
    expect: ({ code, lines }) => {
      const un = [];
      if (code !== 0) un.push(`exit ${code} instead of 0`);
      if (startsWith(lines, 'REFUSED')) un.push('a loopback http base url was refused');
      for (const l of ALL_PASS_FULL) if (!hasLine(lines, l)) un.push(`missing line: ${l}`);
      return un;
    },
  })),
  {
    name: 'preflight',
    mode: 'preflight',
    expect: ({ code, lines, rec }) => {
      const un = [];
      if (code !== 0) un.push(`exit ${code} instead of 0`);
      if (rec.gqlCalls !== 0) un.push(`${rec.gqlCalls} GraphQL call(s) in preflight mode`);
      if (rec.schedulePosts !== 0) un.push(`${rec.schedulePosts} schedule POST(s) in preflight mode`);
      if (rec.apiDeletes !== 0) un.push(`${rec.apiDeletes} API delete(s) in preflight mode`);
      for (const l of ALL_PASS_FULL.slice(0, 4)) if (!hasLine(lines, l)) un.push(`missing line: ${l}`);
      if (lines.length !== 4) un.push(`${lines.length} output lines instead of 4`);
      return un;
    },
  },
];

async function runWorld(world) {
  const { transport, rec } = makeFake(world.fake ?? world.name);
  const lines = [];
  let clock = 0;
  const env = {
    LUQEN_UAT_BASE_URL: world.base ?? SENT.base,
    LUQEN_UAT_ADMIN_USER: SENT.user,
    LUQEN_UAT_ADMIN_PASS: SENT.pass,
    LUQEN_UAT_ORG_NAME: SENT.orgName,
    LUQEN_UAT_SCAN_TARGET: SENT.target,
    LUQEN_UAT_LEAVE_QUEUED_S: '3',
    LUQEN_UAT_TERMINAL_S: '6',
    LUQEN_UAT_POLL_MS: '1000',
    ...(world.env ?? {}),
  };
  const code = await run({
    env,
    mode: world.mode ?? 'full',
    transport,
    sleep: async (ms) => { clock += ms / 1000; },
    now: () => clock,
    log: (l) => lines.push(l),
  });
  return { code, lines, rec };
}

/** Run every world; print SELFTEST PASS/FAIL per world. Returns 0 only when every world met its expectations. */
export async function selftest(log) {
  let bad = 0;
  for (const world of WORLDS) {
    let unmet;
    try {
      const out = await runWorld(world);
      unmet = world.expect(out);
      const text = out.lines.join('\n');
      if (SENTINELS.some((s) => text.includes(s))) unmet.push('output contains a sentinel value (url, user, password, org name/id, scan id or target)');
      if (out.lines.some((l) => !/^(PASS|FAIL|INFO|WARN|SKIP|REFUSED) /.test(l))) unmet.push('an output line has no PASS/FAIL/INFO/WARN/SKIP prefix');
    } catch {
      unmet = ['the world crashed'];
    }
    if (unmet.length === 0) log(`SELFTEST PASS ${world.name}`);
    else { bad += 1; log(`SELFTEST FAIL ${world.name}: ${unmet.join('; ')}`); }
  }
  return bad === 0 ? 0 : 1;
}

// ── entry point ──────────────────────────────────────────────────────────────

async function main(argv) {
  if (argv.includes('--selftest')) {
    return selftest((l) => console.log(l));
  }
  const mode = argv.includes('--preflight') ? 'preflight' : 'full';
  let real = null;
  const transport = (req) => {
    real ??= createFetchTransport(process.env.LUQEN_UAT_BASE_URL);
    return real(req);
  };
  return run({
    env: process.env,
    mode,
    transport,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now() / 1000,
    log: (l) => console.log(l),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, () => {
    console.log('FAIL the read-back crashed (details withheld)');
    process.exitCode = 1;
  });
}
