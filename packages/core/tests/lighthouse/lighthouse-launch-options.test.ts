import { describe, it, expect } from 'vitest';
import { buildLaunchOptions } from '../../src/lighthouse/index.js';

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
