import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import {
  resolveChromium,
  probeChromium,
  ChromiumNotFoundError,
  type ResolveChromiumDeps,
} from '../../src/browser/resolve.js';

const HOME = '/home/svc';
const PUPPETEER_CHROME_DIR = join(HOME, '.cache', 'puppeteer', 'chrome');
const PLAYWRIGHT_DIR = join(HOME, '.cache', 'ms-playwright');

function baseDeps(overrides: Partial<ResolveChromiumDeps> = {}): ResolveChromiumDeps {
  return {
    env: {},
    homeDir: HOME,
    fileExists: () => false,
    listDir: () => [],
    puppeteerExecutablePath: async () => '/nonexistent/puppeteer/chrome',
    ...overrides,
  };
}

describe('resolveChromium', () => {
  it('R1: env PUPPETEER_EXECUTABLE_PATH wins when its file exists', async () => {
    const deps = baseDeps({
      env: { PUPPETEER_EXECUTABLE_PATH: '/opt/custom/chrome' },
      fileExists: (p) => p === '/opt/custom/chrome',
    });
    const result = await resolveChromium(deps);
    expect(result.source).toBe('env');
    expect(result.executablePath).toBe('/opt/custom/chrome');
  });

  it('R2: a system binary is used when no env override is set', async () => {
    const deps = baseDeps({
      fileExists: (p) => p === '/usr/bin/chromium',
    });
    const result = await resolveChromium(deps);
    expect(result.source).toBe('system');
    expect(result.executablePath).toBe('/usr/bin/chromium');
  });

  it('R3: system binaries are tried in the documented order', async () => {
    const deps = baseDeps({
      fileExists: (p) => p === '/usr/bin/google-chrome-stable',
    });
    const result = await resolveChromium(deps);
    expect(result.executablePath).toBe('/usr/bin/google-chrome-stable');
    const idx = result.tried.indexOf('/usr/bin/google-chrome-stable');
    expect(result.tried.indexOf('/usr/bin/chromium')).toBeLessThan(idx);
    expect(result.tried.indexOf('/usr/bin/chromium-browser')).toBeLessThan(idx);
    expect(result.tried.indexOf('/usr/bin/google-chrome')).toBeLessThan(idx);
  });

  it('R4: an empty puppeteer cache version dir is skipped', async () => {
    const goodCandidate = join(PUPPETEER_CHROME_DIR, 'linux-146.0.7680.153', 'chrome-linux64', 'chrome');
    const emptyCandidate = join(PUPPETEER_CHROME_DIR, 'linux-149.0.7827.22', 'chrome-linux64', 'chrome');
    const deps = baseDeps({
      listDir: (dir) => (dir === PUPPETEER_CHROME_DIR ? ['linux-149.0.7827.22', 'linux-146.0.7680.153'] : []),
      fileExists: (p) => p === goodCandidate,
    });
    const result = await resolveChromium(deps);
    expect(result.source).toBe('puppeteer-cache');
    expect(result.executablePath).toBe(goodCandidate);
    expect(result.tried).toContain(emptyCandidate);
  });

  it('R5: the newest puppeteer cache binary wins whatever the directory order', async () => {
    const newest = join(PUPPETEER_CHROME_DIR, 'linux-146.0.7680.153', 'chrome-linux64', 'chrome');
    const older = join(PUPPETEER_CHROME_DIR, 'linux-131.0.6778.0', 'chrome-linux64', 'chrome');
    const fileExists = (p: string): boolean => p === newest || p === older;

    const forward = baseDeps({
      listDir: (dir) => (dir === PUPPETEER_CHROME_DIR ? ['linux-131.0.6778.0', 'linux-146.0.7680.153'] : []),
      fileExists,
    });
    const reverse = baseDeps({
      listDir: (dir) => (dir === PUPPETEER_CHROME_DIR ? ['linux-146.0.7680.153', 'linux-131.0.6778.0'] : []),
      fileExists,
    });

    const r1 = await resolveChromium(forward);
    const r2 = await resolveChromium(reverse);
    expect(r1.executablePath).toBe(newest);
    expect(r2.executablePath).toBe(newest);
  });

  it('R6: PUPPETEER_CACHE_DIR overrides the puppeteer cache root', async () => {
    const customRoot = '/custom/cache';
    const customChromeDir = join(customRoot, 'chrome');
    const candidate = join(customChromeDir, 'linux-146.0.7680.153', 'chrome-linux64', 'chrome');
    const deps = baseDeps({
      env: { PUPPETEER_CACHE_DIR: customRoot },
      listDir: (dir) => (dir === customChromeDir ? ['linux-146.0.7680.153'] : []),
      fileExists: (p) => p === candidate,
    });
    const result = await resolveChromium(deps);
    expect(result.source).toBe('puppeteer-cache');
    expect(result.executablePath).toBe(candidate);
  });

  it('R7: a playwright chromium is used when no puppeteer cache exists', async () => {
    const chosen = join(PLAYWRIGHT_DIR, 'chromium-1223', 'chrome-linux64', 'chrome');
    const older = join(PLAYWRIGHT_DIR, 'chromium-1217', 'chrome-linux64', 'chrome');
    const headlessShell = join(PLAYWRIGHT_DIR, 'chromium_headless_shell-1217', 'chrome-linux64', 'chrome');
    const deps = baseDeps({
      listDir: (dir) => {
        if (dir === PUPPETEER_CHROME_DIR) return [];
        if (dir === PLAYWRIGHT_DIR) return ['chromium-1217', 'chromium-1223', 'chromium_headless_shell-1217'];
        return [];
      },
      fileExists: (p) => p === chosen || p === older || p === headlessShell,
    });
    const result = await resolveChromium(deps);
    expect(result.source).toBe('playwright');
    expect(result.executablePath).toBe(chosen);
    expect(result.tried.some((p) => p.includes('chromium_headless_shell'))).toBe(false);
  });

  it('R8a: puppeteer executablePath is used when its file exists', async () => {
    const ownPath = '/opt/pptr-own/chrome';
    const deps = baseDeps({
      puppeteerExecutablePath: async () => ownPath,
      fileExists: (p) => p === ownPath,
    });
    const result = await resolveChromium(deps);
    expect(result.source).toBe('puppeteer');
    expect(result.executablePath).toBe(ownPath);
  });

  it('R8b: a puppeteer executablePath whose file is missing is not used', async () => {
    const deps = baseDeps({
      puppeteerExecutablePath: async () => '/opt/pptr-own/chrome',
      fileExists: () => false,
    });
    await expect(resolveChromium(deps)).rejects.toBeInstanceOf(ChromiumNotFoundError);
  });

  it('R9: nothing resolved throws ChromiumNotFoundError naming every path tried', async () => {
    const envPath = '/opt/missing/chrome';
    const puppeteerPath = '/opt/pptr-own/missing-chrome';
    const deps = baseDeps({
      env: { PUPPETEER_EXECUTABLE_PATH: envPath },
      puppeteerExecutablePath: async () => puppeteerPath,
      fileExists: () => false,
      listDir: () => [],
    });

    let caught: unknown;
    try {
      await resolveChromium(deps);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ChromiumNotFoundError);
    const error = caught as InstanceType<typeof ChromiumNotFoundError>;
    expect(error.code).toBe('CHROMIUM_NOT_FOUND');
    expect(error.tried).toContain(envPath);
    expect(error.tried).toContain('/usr/bin/chromium');
    expect(error.tried).toContain('/usr/bin/chromium-browser');
    expect(error.tried).toContain('/usr/bin/google-chrome');
    expect(error.tried).toContain('/usr/bin/google-chrome-stable');
    expect(error.tried).toContain(PUPPETEER_CHROME_DIR);
    expect(error.tried).toContain(PLAYWRIGHT_DIR);
    expect(error.tried).toContain(puppeteerPath);
    for (const p of error.tried) {
      expect(error.message).toContain(p);
    }
  });

  it('R10: a throwing puppeteer resolver is recorded and never escapes', async () => {
    const deps = baseDeps({
      puppeteerExecutablePath: async () => {
        throw new Error('no browser configured');
      },
    });
    await expect(resolveChromium(deps)).rejects.toBeInstanceOf(ChromiumNotFoundError);
  });
});

describe('probeChromium', () => {
  it('R11: probe never throws and reports the tried paths when nothing resolves', async () => {
    const deps = baseDeps({
      puppeteerExecutablePath: async () => undefined as unknown as string,
    });
    const probe = await probeChromium(deps);
    expect(probe.ok).toBe(false);
    if (!probe.ok) {
      expect(Array.isArray(probe.tried)).toBe(true);
      expect(probe.tried.length).toBeGreaterThan(0);
    }
  });

  it('R12: probe reports the resolved path and source', async () => {
    const deps = baseDeps({
      fileExists: (p) => p === '/usr/bin/chromium',
    });
    const probe = await probeChromium(deps);
    expect(probe.ok).toBe(true);
    if (probe.ok) {
      expect(probe.executablePath).toBe('/usr/bin/chromium');
      expect(probe.source).toBe('system');
    }
  });
});
