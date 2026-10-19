// Real-browser UAT for the false-positive dismissal UI (Phase 89, FP-14 / FP-15 / FP-16).
//
// Modes
//   local            boots a fresh-DB dashboard from the BUILT dist/ per scenario, seeds a Fabrikam test
//                    org, five personas, a four-page scan and a 150-dismissal site, then drives Chromium.
//   remote           drives an already-running dashboard from environment variables ONLY (names listed
//                    in README.md). Never seeds; never prints a value; writes one mark, one revoke and,
//                    with --leave-active, one re-mark.
//   remote-selftest  boots and seeds exactly like local, then runs the remote code path against it with
//                    an in-process env object. This is how the remote path is proven without prod.
//                    LUQEN_UAT_SELFTEST_EXPECT_ORG / LUQEN_UAT_SELFTEST_EXPECT_SITE_HOST, when set, replace
//                    the seeded world's expected org / site host (to watch the target rule refuse).
//
// Usage:
//   npm run build   (this script runs dist/, so build first)
//   node tests/browser-uat/uat-dismissals.mjs [--mode local|remote|remote-selftest]
//        [--expect dark|granted] [--scenario <name>|all] [--leave-active] [--keep-going]
//        [--check-target-only]
//
// --check-target-only (remote and remote-selftest): log in as the admin, check that the target scan is in
// the dedicated UAT org and site, print the PASS or REFUSED line and stop: no persona login, no write.
// Exit 0 when the target matches, 2 when it is refused.
//
// --keep-going (local mode only, for break-tests): every FAIL is reported instead of stopping at the
// first, so a mutation's whole red set is observable; the run still exits 1 and never prints GREEN.
//
// Output: one `PASS <scenario>: <check>` or `FAIL <scenario>: <check> :: <detail>` line per check; exit
// non-zero on the first FAIL (1), or 2 for bad arguments / missing remote environment / a target that is
// not the dedicated UAT org and site.
// Browser launches and waits use 90s+ timeouts.
import {
  check, killAll, log, checkCount, discoverChromium, resolvePuppeteer, newPersonaPage, WAIT, DESKTOP, setWithholdDetail,
  sleep, setKeepGoing, failureCount,
} from './dismissals/lib.mjs';
import { bootLocal, envFromWorld, resetShots } from './dismissals/world.mjs';
import { coreScenarios, CORE_WORLD } from './dismissals/scenarios-core.mjs';
import { flowScenarios } from './dismissals/scenarios-flow.mjs';
import { viewScenarios } from './dismissals/scenarios-view.mjs';
import { gapScenarios, GAP_WORLD } from './dismissals/scenarios-gap.mjs';
import { runRemote, missingVars, REMOTE_VARS } from './dismissals/remote.mjs';
import { EXPECT_ORG_VAR, EXPECT_SITE_HOST_VAR } from './dismissals/target-guard.mjs';

const SCENARIOS = { ...coreScenarios, ...flowScenarios, ...viewScenarios, ...gapScenarios };
// Order matters only for readability: each scenario gets its own world.
const ORDER = ['tracer', 'permissions', 'dialog', 'refused', 'mark', 'surfaces', 'revoke', 'conflict', 'public', 'mobile', 'longtext', 'locales', 'theme', 'keyboard', 'overflow', 'attribution', 'twins', 'layout'];

function parseArgs(argv) {
  const out = { mode: 'local', expect: 'dark', scenario: 'all', leaveActive: false, keepGoing: false, checkTargetOnly: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--mode') out.mode = argv[++i];
    else if (a === '--expect') out.expect = argv[++i];
    else if (a === '--scenario') out.scenario = argv[++i];
    else if (a === '--leave-active') out.leaveActive = true;
    else if (a === '--keep-going') out.keepGoing = true;
    else if (a === '--check-target-only') out.checkTargetOnly = true;
    else { console.error(`unknown argument ${a}`); process.exit(2); }
  }
  if (!['local', 'remote', 'remote-selftest'].includes(out.mode)) { console.error('--mode must be local, remote or remote-selftest'); process.exit(2); }
  if (!['dark', 'granted'].includes(out.expect)) { console.error('--expect must be dark or granted'); process.exit(2); }
  if (out.keepGoing && out.mode !== 'local') { console.error('--keep-going is for local mode only'); process.exit(2); }
  if (out.checkTargetOnly && out.mode === 'local') { console.error('--check-target-only is for remote and remote-selftest modes'); process.exit(2); }
  if (out.checkTargetOnly && out.leaveActive) { console.error('--check-target-only writes nothing, so it cannot be combined with --leave-active'); process.exit(2); }
  if (out.scenario !== 'all' && !SCENARIOS[out.scenario]) { console.error(`unknown scenario ${out.scenario}; known: ${ORDER.join(', ')}`); process.exit(2); }
  return out;
}
const args = parseArgs(process.argv.slice(2));
setKeepGoing(args.keepGoing);

process.on('exit', killAll);
process.on('SIGINT', () => { killAll(); process.exit(130); });

/**
 * Redact every secret value from anything this process writes, and remember that it had to.
 * A leak turns a green run into a failure: a UAT that prints a credential must not pass.
 */
function installOutputGuard(values) {
  const secrets = values.filter((v) => typeof v === 'string' && v.length >= 4);
  const state = { leaked: false };
  for (const stream of [process.stdout, process.stderr]) {
    const write = stream.write.bind(stream);
    stream.write = (chunk, ...rest) => {
      let text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
      for (const s of secrets) {
        if (text.includes(s)) { state.leaked = true; text = text.split(s).join('[REDACTED]'); }
      }
      return write(text, ...rest);
    };
  }
  return state;
}

async function launch() {
  const puppeteer = resolvePuppeteer();
  return puppeteer.launch({ executablePath: discoverChromium(), headless: 'new', protocolTimeout: WAIT, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
}

async function runLocal(browser) {
  const names = args.scenario === 'all' ? ORDER : [args.scenario];
  // Only a full run clears the screenshots; a single scenario adds to (and overwrites) its own files.
  if (args.scenario === 'all') resetShots();
  for (const n of names) {
    const world = await bootLocal({ ...(CORE_WORLD[n] ?? {}), ...(GAP_WORLD[n] ?? {}) });
    const { context, page } = await newPersonaPage(browser, world.base, null);
    try {
      await SCENARIOS[n]({ page, browser, world, expect: args.expect });
    } finally {
      await context.close();
      killAll();
      await sleep(2000);
    }
  }
}

/** Selftest-only overrides of the world's expected target (names in the header comment). */
function selftestTargetOverrides(source) {
  const pairs = [['LUQEN_UAT_SELFTEST_EXPECT_ORG', EXPECT_ORG_VAR], ['LUQEN_UAT_SELFTEST_EXPECT_SITE_HOST', EXPECT_SITE_HOST_VAR]];
  return Object.fromEntries(pairs
    .filter(([from]) => typeof source[from] === 'string' && source[from] !== '')
    .map(([from, to]) => [to, source[from]]));
}

async function runSelftest(browser) {
  const world = await bootLocal();
  const env = { ...envFromWorld(world), ...selftestTargetOverrides(process.env) };
  const guard = installOutputGuard(Object.entries(env).filter(([k]) => k !== 'LUQEN_UAT_BASE_URL').map(([, v]) => v));
  let outcome;
  try {
    outcome = await runRemote({ browser, env, expect: args.expect, leaveActive: args.leaveActive, checkTargetOnly: args.checkTargetOnly });
  } finally {
    setWithholdDetail(false);
    killAll();
  }
  check('remote-selftest', 'no credential value appeared in the run output', guard.leaked === false);
  return outcome;
}

async function runRemoteMode(browser) {
  const guard = installOutputGuard(REMOTE_VARS.map((k) => process.env[k]));
  const outcome = await runRemote({ browser, env: process.env, expect: args.expect, leaveActive: args.leaveActive, checkTargetOnly: args.checkTargetOnly });
  check('remote', 'no credential value appeared in the run output', guard.leaked === false);
  return outcome;
}

async function main() {
  if (args.mode === 'remote') {
    const missing = missingVars(process.env, { checkTargetOnly: args.checkTargetOnly });
    if (missing.length > 0) {
      console.error(`remote mode needs these environment variables (values are never printed): ${missing.join(', ')}`);
      process.exit(2);
    }
  }
  const browser = await launch();
  try {
    let outcome = 'done';
    if (args.mode === 'local') await runLocal(browser);
    else if (args.mode === 'remote-selftest') outcome = await runSelftest(browser);
    else outcome = await runRemoteMode(browser);
    if (failureCount() > 0) throw new Error(`UAT RED: ${failureCount()} of ${checkCount()} checks failed`);
    // The target was not the dedicated UAT org and site: nothing was written; the REFUSED line names
    // the variables. Exit 2, never GREEN.
    if (outcome === 'refused') return 2;
    if (outcome === 'target-ok') {
      console.log(`TARGET CHECK GREEN: ${checkCount()} checks; nothing was written`);
      return 0;
    }
    console.log(`UAT GREEN: ${checkCount()} checks`);
    return 0;
  } finally {
    await browser.close();
  }
}

main().then((code) => { killAll(); setTimeout(() => process.exit(code), 500); })
  .catch((err) => {
    // Remote mode withholds the message: a driver error can quote a URL.
    console.error('[uat] ERROR', args.mode === 'remote' ? '(message withheld in remote mode)' : err.message);
    log('failed');
    killAll();
    setTimeout(() => process.exit(1), 500);
  });
