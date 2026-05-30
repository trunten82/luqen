import { describe, it, expect, afterEach } from 'vitest';
import { loadConfig } from '../src/config.js';

const ENV_KEY = 'DASHBOARD_ALLOW_PRIVATE_SCAN_TARGETS';
const NONEXISTENT = '/nonexistent/luqen-config.json';

describe('loadConfig allowPrivateScanTargets', () => {
  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it('defaults to falsy when neither file nor env set it (secure default)', () => {
    delete process.env[ENV_KEY];
    const config = loadConfig(NONEXISTENT);
    expect(config.allowPrivateScanTargets).toBeFalsy();
  });

  it('becomes true when DASHBOARD_ALLOW_PRIVATE_SCAN_TARGETS=true', () => {
    process.env[ENV_KEY] = 'true';
    const config = loadConfig(NONEXISTENT);
    expect(config.allowPrivateScanTargets).toBe(true);
  });

  it('stays falsy when the env var is set to a non-true value', () => {
    process.env[ENV_KEY] = 'false';
    const config = loadConfig(NONEXISTENT);
    expect(config.allowPrivateScanTargets).toBeFalsy();
  });
});
