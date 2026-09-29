import { describe, it, expect, vi } from 'vitest';
import { buildLaunchOptions, runLighthouseChecks } from '../../src/lighthouse/index.js';
import * as profileDir from '../../src/browser/profile-dir.js';

const PROXY_FLAGS = ['--proxy-server=http://127.0.0.1:5555', '--proxy-bypass-list=<-loopback>'];

describe('Lighthouse chrome-launcher options (SCAN-EGRESS-PROXY-1)', () => {
  it('default chromeFlags end with the egress-proxy flags', () => {
    const options = buildLaunchOptions({}, '/chrome', { port: 5555 });
    expect(options['chromePath']).toBe('/chrome');
    expect(options['chromeFlags']).toEqual([
      '--headless=new', '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', ...PROXY_FLAGS,
    ]);
  });

  it('a chromeFlags override cannot drop, replace or disable the proxy', () => {
    const options = buildLaunchOptions(
      { chromeLaunchConfig: { chromeFlags: ['--headless=new', '--no-proxy-server', '--proxy-server=direct://', '--x'] } },
      '/chrome',
      { port: 5555 },
    );
    expect(options['chromeFlags']).toEqual(['--headless=new', '--x', ...PROXY_FLAGS]);
  });
});

describe('Lighthouse profile dir (PROFILE-CLEANUP-1)', () => {
  it('LP1: the luqen-owned profile dir is handed to chrome-launcher', () => {
    const options = buildLaunchOptions({}, '/chrome', { port: 5555 }, '/tmp/luqen-chrome/profile-x');
    expect(options['userDataDir']).toBe('/tmp/luqen-chrome/profile-x');
  });

  it('LP2: a caller-configured userDataDir wins', () => {
    const options = buildLaunchOptions({ chromeLaunchConfig: { userDataDir: '/own' } }, '/chrome', { port: 5555 }, '/tmp/luqen-chrome/profile-x');
    expect(options['userDataDir']).toBe('/own');
  });

  it('LP3: a run whose Chrome never starts still removes the profile dir it created', async () => {
    const created = vi.spyOn(profileDir, 'createProfileDir');
    const removed = vi.spyOn(profileDir, 'removeProfileDir');
    const result = await runLighthouseChecks('https://example.invalid/', {
      // A binary that exits at once: chrome-launcher gives up after one poll.
      chromeLaunchConfig: { chromePath: '/bin/false', maxConnectionRetries: 1, connectionPollInterval: 50 },
    });
    expect(result.pagesChecked).toBe(0);
    expect(created).toHaveBeenCalledTimes(1);
    const dir = await created.mock.results[0].value as string;
    expect(removed).toHaveBeenCalledWith(dir, null);
    const { existsSync } = await import('node:fs');
    expect(existsSync(dir)).toBe(false);
    created.mockRestore();
    removed.mockRestore();
  }, 90_000);
});
