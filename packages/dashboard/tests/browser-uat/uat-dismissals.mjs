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
//
// Usage:
//   npm run build   (this script runs dist/, so build first)
//   node tests/browser-uat/uat-dismissals.mjs [--mode local|remote|remote-selftest]
//        [--expect dark|granted] [--scenario <name>|all] [--leave-active]
//
// Output: one `PASS <scenario>: <check>` or `FAIL <scenario>: <check> :: <detail>` line per check; exit
// non-zero on the first FAIL (1), or 2 for bad arguments / missing remote environment.
// Browser launches and waits use 90s+ timeouts.
import {
  check, killAll, log, checkCount, discoverChromium, resolvePuppeteer, newPersonaPage, WAIT, DESKTOP, setWithholdDetail,
  sleep,
} from './dismissals/lib.mjs';
import { bootLocal, envFromWorld, resetShots } from './dismissals/world.mjs';
import { coreScenarios } from './dismissals/scenarios-core.mjs';
import { flowScenarios } from './dismissals/scenarios-flow.mjs';
import { viewScenarios } from './dismissals/scenarios-view.mjs';
import { runRemote, missingVars, REMOTE_VARS } from './dismissals/remote.mjs';

const SCENARIOS = { ...coreScenarios, ...flowScenarios, ...viewScenarios };
// Order matters only for readability: each scenario gets its own world.
const ORDER = ['tracer', 'permissions', 'dialog', 'refused', 'mark', 'surfaces', 'revoke', 'conflict', 'public', 'mobile', 'longtext', 'locales', 'theme', 'keyboard', 'overflow'];

function parseArgs(argv) {
  const out = { mode: 'local', expect: 'dark', scenario: 'all', leaveActive: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--mode') out.mode = argv[++i];
    else if (a === '--expect') out.expect = argv[++i];
    else if (a === '--scenario') out.scenario = argv[++i];
    else if (a === '--leave-active') out.leaveActive = true;
    else { console.error(`unknown argument ${a}`); process.exit(2); }
  }
  if (!['local', 'remote', 'remote-selftest'].includes(out.mode)) { console.error('--mode must be local, remote or remote-selftest'); process.exit(2); }
  if (!['dark', 'granted'].includes(out.expect)) { console.error('--expect must be dark or granted'); process.exit(2); }
  if (out.scenario !== 'all' && !SCENARIOS[out.scenario]) { console.error(`unknown scenario ${out.scenario}; known: ${ORDER.join(', ')}`); process.exit(2); }
  return out;
}
const args = parseArgs(process.argv.slice(2));

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
  resetShots();
  for (const n of names) {
    const world = await bootLocal();
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

async function runSelftest(browser) {
  resetShots();
  const world = await bootLocal();
  const env = envFromWorld(world);
  const guard = installOutputGuard(Object.entries(env).filter(([k]) => k !== 'LUQEN_UAT_BASE_URL').map(([, v]) => v));
  try {
    await runRemote({ browser, env, expect: args.expect, leaveActive: args.leaveActive });
  } finally {
    setWithholdDetail(false);
    killAll();
  }
  check('remote-selftest', 'no credential value appeared in the run output', guard.leaked === false);
}

async function runRemoteMode(browser) {
  const guard = installOutputGuard(REMOTE_VARS.map((k) => process.env[k]));
  await runRemote({ browser, env: process.env, expect: args.expect, leaveActive: args.leaveActive });
  check('remote', 'no credential value appeared in the run output', guard.leaked === false);
}

async function main() {
  if (args.mode === 'remote') {
    const missing = missingVars(process.env);
    if (missing.length > 0) {
      console.error(`remote mode needs these environment variables (values are never printed): ${missing.join(', ')}`);
      process.exit(2);
    }
  }
  const browser = await launch();
  try {
    if (args.mode === 'local') await runLocal(browser);
    else if (args.mode === 'remote-selftest') await runSelftest(browser);
    else await runRemoteMode(browser);
    console.log(`UAT GREEN: ${checkCount()} checks`);
  } finally {
    await browser.close();
  }
}

main().then(() => { killAll(); setTimeout(() => process.exit(0), 500); })
  .catch((err) => {
    // Remote mode withholds the message: a driver error can quote a URL.
    console.error('[uat] ERROR', args.mode === 'remote' ? '(message withheld in remote mode)' : err.message);
    log('failed');
    killAll();
    setTimeout(() => process.exit(1), 500);
  });
