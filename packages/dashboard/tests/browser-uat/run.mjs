// Orchestrator for the browser UAT of the "Deep behavioral scan (beta)" flow.
//
// Responsibilities:
//   1. Build the dashboard (unless UAT_SKIP_BUILD=1).
//   2. Prepare an isolated, fresh .tmp/ workspace (DB, reports, plugins).
//   3. Start the dashboard `serve` process with an isolated config + the
//      Chromium executable path exported so its scan engine can launch a
//      browser, and allowPrivateScanTargets=true so the loopback fixture is
//      reachable.
//   4. Wait until the dashboard answers GET /login (auth-free).
//   5. Seed a fresh admin user + org into the migrated DB.
//   6. Start the loopback behavioral fixture server.
//   7. Run the puppeteer-core driver, which asserts the full flow.
//   8. Tear everything down and propagate the driver's exit code.
//
// Usage:  node packages/dashboard/tests/browser-uat/run.mjs
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const dashboardDir = path.resolve(HERE, '..', '..'); // packages/dashboard
const repoRoot = path.resolve(HERE, '..', '..', '..', '..');
const TMP = path.join(HERE, '.tmp');
const CONFIG_SRC = path.join(HERE, 'uat.config.json');

const config = JSON.parse(fs.readFileSync(CONFIG_SRC, 'utf8'));
const PORT = config.port;
const BASE = `http://127.0.0.1:${PORT}`;
const USER = 'admin';
const PASS = 'UatProof2026!';

const children = [];
function track(child, name) {
  child._uatName = name;
  children.push(child);
  return child;
}
function killAll() {
  for (const c of children) {
    try {
      if (!c.killed) c.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
}
process.on('exit', killAll);
process.on('SIGINT', () => {
  killAll();
  process.exit(130);
});

function log(...a) {
  console.log('[run]', ...a);
}

function discoverChromium() {
  const root = '/root/.cache/ms-playwright';
  const found = [];
  if (fs.existsSync(root)) {
    for (const dir of fs.readdirSync(root)) {
      if (!dir.startsWith('chromium-')) continue;
      const candidate = path.join(root, dir, 'chrome-linux64', 'chrome');
      if (fs.existsSync(candidate)) found.push(candidate);
    }
  }
  found.sort();
  if (!found.length) throw new Error('No ms-playwright Chromium found');
  return found[found.length - 1];
}

function get(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode || 0);
    });
    req.on('error', () => resolve(0));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(0);
    });
  });
}

async function waitFor(url, label, tries = 60, delayMs = 1000) {
  for (let i = 0; i < tries; i++) {
    const code = await get(url);
    if (code >= 200 && code < 500) {
      log(`${label} ready (HTTP ${code}) after ${i + 1} tries`);
      return true;
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}

function waitForFile(file, label, tries = 30, delayMs = 500) {
  return new Promise((resolve) => {
    let i = 0;
    const t = setInterval(() => {
      if (fs.existsSync(file)) {
        clearInterval(t);
        log(`${label} produced ${path.basename(file)}`);
        resolve(true);
      } else if (++i >= tries) {
        clearInterval(t);
        resolve(false);
      }
    }, delayMs);
  });
}

async function main() {
  // 1. Build (unless skipped).
  if (process.env.UAT_SKIP_BUILD !== '1') {
    log('building @luqen/dashboard …');
    const b = spawnSync('npm', ['run', 'build', '-w', 'packages/dashboard'], {
      cwd: repoRoot,
      stdio: 'inherit',
    });
    if (b.status !== 0) throw new Error('dashboard build failed');
  } else {
    log('UAT_SKIP_BUILD=1 — assuming dist/ is current');
  }

  // 2. Fresh workspace.
  log('resetting isolated .tmp workspace …');
  for (const f of fs.readdirSync(TMP)) {
    if (f === '.gitignore') continue;
    fs.rmSync(path.join(TMP, f), { recursive: true, force: true });
  }
  fs.mkdirSync(path.join(TMP, 'reports'), { recursive: true });
  fs.mkdirSync(path.join(TMP, 'plugins'), { recursive: true });
  // Place the config under .tmp so loadConfig()'s default-path lookup AND the
  // explicit --config both resolve relative paths to this isolated workspace.
  const tmpConfig = {
    ...config,
    dbPath: path.join(TMP, 'uat-dashboard.db'),
    reportsDir: path.join(TMP, 'reports'),
    pluginsDir: path.join(TMP, 'plugins'),
  };
  const tmpConfigPath = path.join(TMP, 'dashboard.config.json');
  fs.writeFileSync(tmpConfigPath, JSON.stringify(tmpConfig, null, 2));

  const chromium = discoverChromium();
  log('chromium:', chromium);

  // 3. Start the dashboard. Drive config by BOTH the file and env overrides so
  //    the run is robust regardless of how `serve` resolves its config path.
  const dashEnv = {
    ...process.env,
    PUPPETEER_EXECUTABLE_PATH: chromium,
    DASHBOARD_PORT: String(PORT),
    DASHBOARD_SESSION_SECRET: config.sessionSecret,
    DASHBOARD_DB_PATH: tmpConfig.dbPath,
    DASHBOARD_REPORTS_DIR: tmpConfig.reportsDir,
    DASHBOARD_PLUGINS_DIR: tmpConfig.pluginsDir,
    DASHBOARD_MAX_PAGES: String(config.maxPages ?? 200),
    DASHBOARD_ALLOW_PRIVATE_SCAN_TARGETS: 'true',
  };
  const dashLog = fs.createWriteStream(path.join(TMP, 'dashboard.log'));
  log('starting dashboard `serve` …');
  // Config is supplied two ways for robustness: (a) env overrides cover every
  // field the UAT needs, and (b) cwd=.tmp means loadConfig()'s default
  // `dashboard.config.json` lookup resolves to the isolated workspace config.
  // We deliberately do NOT pass an unknown `--config` flag to `serve`.
  void tmpConfigPath;
  const dash = track(
    spawn('node', [path.join(dashboardDir, 'dist', 'cli.js'), 'serve'], {
      cwd: TMP,
      env: dashEnv,
    }),
    'dashboard'
  );
  dash.stdout.pipe(dashLog);
  dash.stderr.pipe(dashLog);
  dash.on('exit', (code) => log(`dashboard exited (${code})`));

  const up = await waitFor(BASE + '/login', 'dashboard', 90, 1000);
  if (!up) throw new Error('dashboard did not become ready on ' + BASE + '/login');

  // 4. Seed admin into the migrated DB.
  log('seeding admin user …');
  const seed = spawnSync('node', [path.join(HERE, 'seed.mjs')], {
    cwd: HERE,
    env: { ...process.env, UAT_DB_PATH: tmpConfig.dbPath, UAT_USER: USER, UAT_PASS: PASS },
    stdio: 'inherit',
  });
  if (seed.status !== 0) throw new Error('seed failed');

  // 5. Start the loopback fixture.
  log('starting behavioral fixture …');
  const fixLog = fs.createWriteStream(path.join(TMP, 'fixture.log'));
  const fix = track(
    spawn('node', [path.join(HERE, 'fixture-server.mjs')], {
      cwd: HERE,
      env: { ...process.env, UAT_FIXTURE_HOST: '127.0.0.1', UAT_FIXTURE_PORT: '0' },
    }),
    'fixture'
  );
  fix.stdout.pipe(fixLog);
  fix.stderr.pipe(fixLog);
  const fixtureUp = await waitForFile(path.join(TMP, 'fixture-url.txt'), 'fixture', 30, 500);
  if (!fixtureUp) throw new Error('fixture did not write fixture-url.txt');

  // 6. Run the driver (it asserts and sets its own exit code).
  log('running driver …');
  const driver = spawnSync('node', [path.join(HERE, 'driver.mjs')], {
    cwd: HERE,
    env: {
      ...process.env,
      UAT_BASE_URL: BASE,
      UAT_USER: USER,
      UAT_PASS: PASS,
      PUPPETEER_EXECUTABLE_PATH: chromium,
    },
    stdio: 'inherit',
  });

  const code = driver.status === 0 ? 0 : 1;
  log(code === 0 ? 'UAT GREEN' : 'UAT RED');
  return code;
}

main()
  .then((code) => {
    killAll();
    // Give children a moment to die before exiting.
    setTimeout(() => process.exit(code), 500);
  })
  .catch((err) => {
    console.error('[run] ERROR', err.message);
    killAll();
    setTimeout(() => process.exit(1), 500);
  });
