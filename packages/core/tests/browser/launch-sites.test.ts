import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// packages/core/tests/browser -> repo root
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const PACKAGES_DIR = join(REPO_ROOT, 'packages');
const BROWSER_MODULE_PREFIX = join('packages', 'core', 'src', 'browser') + '/';

interface WalkResult {
  readonly perPackage: Record<string, string[]>;
  readonly allFiles: string[];
}

/** Walks every packages/NAME/src tree for .ts source files (never tests, .d.ts, node_modules, dist). */
function walkSourceFiles(): WalkResult {
  const perPackage: Record<string, string[]> = {};
  const allFiles: string[] = [];
  const packageNames = readdirSync(PACKAGES_DIR).filter((name) => {
    try {
      return statSync(join(PACKAGES_DIR, name)).isDirectory();
    } catch {
      return false;
    }
  });

  for (const pkg of packageNames) {
    const srcDir = join(PACKAGES_DIR, pkg, 'src');
    let exists = true;
    try {
      statSync(srcDir);
    } catch {
      exists = false;
    }
    if (!exists) continue;

    const files: string[] = [];
    const walk = (dir: string): void => {
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = join(dir, entry);
        let stat;
        try {
          stat = statSync(full);
        } catch {
          continue;
        }
        if (stat.isDirectory()) {
          if (entry === '__tests__' || entry === 'node_modules' || entry === 'dist') continue;
          walk(full);
        } else if (stat.isFile()) {
          if (!entry.endsWith('.ts')) continue;
          if (entry.endsWith('.test.ts') || entry.endsWith('.d.ts')) continue;
          files.push(full);
        }
      }
    };
    walk(srcDir);
    perPackage[pkg] = files.map((f) => relative(REPO_ROOT, f));
    allFiles.push(...perPackage[pkg]);
  }

  return { perPackage, allFiles };
}

/** Strips comment-only lines (trimmed start //, *, or /*) before matching. */
function stripComments(source: string): string {
  return source
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return !(trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*'));
    })
    .join('\n');
}

const LAUNCH_SITE_PATTERN = /\.launch\(|\bexecutablePath\b|\bchromePath\b/;

/**
 * Files that legitimately mention `executablePath`/`chromePath` as a plain
 * word (tripping the crude word-match heuristic above) WITHOUT being a
 * launch site: they only read an already-resolved {@link ChromiumProbe}
 * value passed in via dependency injection (e.g. for logging), never launch
 * a browser or call the resolver themselves. Keep this list short and each
 * entry justified — anything launching a browser must NOT be exempted here.
 */
const KNOWN_NON_LAUNCH_FILES: readonly string[] = [
  // logBrowserResolution logs probe.executablePath for observability; the
  // probe itself was already resolved elsewhere (server.ts's startup call).
  join('packages', 'dashboard', 'src', 'routes', 'health.ts'),
];

function isLaunchSite(relPath: string): boolean {
  if (relPath.startsWith(BROWSER_MODULE_PREFIX)) return false;
  if (KNOWN_NON_LAUNCH_FILES.includes(relPath)) return false;
  const source = readFileSync(join(REPO_ROOT, relPath), 'utf8');
  const code = stripComments(source);
  return LAUNCH_SITE_PATTERN.test(code);
}

const { perPackage, allFiles } = walkSourceFiles();
const launchSites = allFiles.filter(isLaunchSite).sort();

// Diagnostic evidence — read, not just asserted on.
for (const [pkg, files] of Object.entries(perPackage)) {
  // eslint-disable-next-line no-console
  console.log(`[launch-sites invariant] ${pkg}: ${files.length} source file(s) inspected`);
}
// eslint-disable-next-line no-console
console.log('[launch-sites invariant] launch sites:', launchSites);

const PUPPETEER_IMPORT_PATTERN = /(?<!type\s)(?:from\s+['"]puppeteer['"]|import\(\s*['"]puppeteer['"]\s*\)|require\(\s*['"]puppeteer['"]\s*\)|require\.resolve\(\s*['"]puppeteer['"]\s*\))/;
const SYSTEM_PATH_PATTERN = /\/usr\/bin\/chromium|\/usr\/bin\/google-chrome/;
const RESOLVER_COPY_NAMES = [
  'loadPuppeteer',
  'findChromeInCache',
  'findPlaywrightChromium',
  'findChromiumExecutable',
  'resolveExecutablePath',
  'findSystemChromium',
  'chromiumExecutable',
];

describe('launch-sites invariant (CHROMIUM-RESOLVE-1)', () => {
  it('L6: the source walk inspected files in every package', () => {
    for (const [pkg, files] of Object.entries(perPackage)) {
      expect(files.length, `package ${pkg} had no .ts files inspected`).toBeGreaterThan(0);
    }
    expect(allFiles).toContain(join('packages', 'dashboard', 'src', 'services', 'acr-render.ts'));
    expect(allFiles).toContain(join('packages', 'core', 'src', 'ibm', 'index.ts'));
  });

  it('L2: the launch site list is exactly lighthouse and the direct scanner', () => {
    expect(launchSites).toEqual([
      join('packages', 'core', 'src', 'lighthouse', 'index.ts'),
      join('packages', 'core', 'src', 'scanner', 'direct-scanner.ts'),
    ].sort());
  });

  it('L1: every launch site outside the shared browser module imports the resolver', () => {
    for (const relPath of launchSites) {
      const source = readFileSync(join(REPO_ROOT, relPath), 'utf8');
      const isCore = relPath.startsWith(join('packages', 'core') + '/');
      if (isCore) {
        expect(source, `${relPath} should import resolveChromium from a relative browser/resolve.js path`)
          .toMatch(/from\s+['"][^'"]*browser\/resolve\.js['"]/);
      } else {
        expect(source, `${relPath} should import resolveChromium from '@luqen/core'`)
          .toMatch(/from\s+['"]@luqen\/core['"]/);
      }
      expect(source).toMatch(/resolveChromium/);
    }
  });

  it('L3: system chromium paths are named only in the shared resolver', () => {
    const offenders = allFiles.filter((relPath) => {
      if (relPath.startsWith(BROWSER_MODULE_PREFIX)) return false;
      const code = stripComments(readFileSync(join(REPO_ROOT, relPath), 'utf8'));
      return SYSTEM_PATH_PATTERN.test(code);
    });
    expect(offenders).toEqual([]);
  });

  it('L4: no module outside the shared browser module imports puppeteer at runtime', () => {
    const offenders = allFiles.filter((relPath) => {
      if (relPath.startsWith(BROWSER_MODULE_PREFIX)) return false;
      const code = stripComments(readFileSync(join(REPO_ROOT, relPath), 'utf8'));
      // Exclude `import type { ... } from 'puppeteer'` lines explicitly.
      const nonTypeLines = code
        .split('\n')
        .filter((line) => !/^\s*import\s+type\b.*from\s+['"]puppeteer['"]/.test(line))
        .join('\n');
      return PUPPETEER_IMPORT_PATTERN.test(nonTypeLines);
    });
    expect(offenders).toEqual([]);
  });

  it('L5: no resolver copy is defined outside the shared browser module', () => {
    const offenders: string[] = [];
    for (const relPath of allFiles) {
      if (relPath.startsWith(BROWSER_MODULE_PREFIX)) continue;
      const code = stripComments(readFileSync(join(REPO_ROOT, relPath), 'utf8'));
      for (const name of RESOLVER_COPY_NAMES) {
        const fnPattern = new RegExp(`function\\s+${name}\\s*\\(`);
        const constPattern = new RegExp(`const\\s+${name}\\s*=`);
        if (fnPattern.test(code) || constPattern.test(code)) {
          offenders.push(`${relPath}: ${name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
