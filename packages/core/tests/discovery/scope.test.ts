import { describe, it, expect } from 'vitest';
import { computeDiscoveryScope, isInDiscoveryScope } from '../../src/discovery/scope.js';

describe('discovery scope (DISCOVERY-SCOPE-3)', () => {
  it('trailing-slash start admits only its section', () => {
    const scope = computeDiscoveryScope('https://ex.test/dev/en-us/');

    expect(isInDiscoveryScope('https://ex.test/dev/en-us/', scope)).toBe(true);
    expect(isInDiscoveryScope('https://ex.test/dev/en-us/about', scope)).toBe(true);
    expect(isInDiscoveryScope('https://ex.test/dev/en-us/a/b?x=1', scope)).toBe(true);
    expect(isInDiscoveryScope('https://EX.TEST/dev/en-us/x', scope)).toBe(true);

    expect(isInDiscoveryScope('https://ex.test/dev/fr-fr/', scope)).toBe(false);
    expect(isInDiscoveryScope('https://ex.test/dev/', scope)).toBe(false);
    expect(isInDiscoveryScope('https://ex.test/', scope)).toBe(false);
    expect(isInDiscoveryScope('https://ex.test/dev/en-us-old/', scope)).toBe(false);
    expect(isInDiscoveryScope('https://ex.test/DEV/EN-US/x', scope)).toBe(false);
  });

  it('foreign origins are out of scope', () => {
    const scope = computeDiscoveryScope('https://ex.test/dev/en-us/');

    expect(isInDiscoveryScope('http://ex.test/dev/en-us/x', scope)).toBe(false);
    expect(isInDiscoveryScope('https://ex.test:8443/dev/en-us/x', scope)).toBe(false);
    expect(isInDiscoveryScope('https://ex.test.evil.test/dev/en-us/', scope)).toBe(false);
    expect(isInDiscoveryScope('https://ex.test@127.0.0.1/dev/en-us/', scope)).toBe(false);
    expect(isInDiscoveryScope('not a url', scope)).toBe(false);
  });

  it('document start uses its directory', () => {
    const scope = computeDiscoveryScope('https://ex.test/dev/en-us/index.html');

    expect(scope.pathPrefix).toBe('/dev/en-us/');
    expect(isInDiscoveryScope('https://ex.test/dev/en-us/index.html', scope)).toBe(true);
    expect(isInDiscoveryScope('https://ex.test/dev/en-us/about', scope)).toBe(true);
    expect(isInDiscoveryScope('https://ex.test/dev/fr-fr/', scope)).toBe(false);
  });

  it('start without trailing slash uses its parent directory', () => {
    const scope = computeDiscoveryScope('https://ex.test/dev/en-us');

    expect(scope.pathPrefix).toBe('/dev/');
    expect(isInDiscoveryScope('https://ex.test/dev/en-us', scope)).toBe(true);
    expect(isInDiscoveryScope('https://ex.test/dev/en-us/about', scope)).toBe(true);
    expect(isInDiscoveryScope('https://ex.test/dev/fr-fr/', scope)).toBe(true);
    expect(isInDiscoveryScope('https://ex.test/other/', scope)).toBe(false);
  });

  it('root start admits the whole origin', () => {
    for (const start of ['https://ex.test', 'https://ex.test/']) {
      const scope = computeDiscoveryScope(start);
      expect(scope.pathPrefix).toBe('/');
      expect(isInDiscoveryScope('https://ex.test/anything/at/all', scope)).toBe(true);
      expect(isInDiscoveryScope('https://ex.test/', scope)).toBe(true);
    }
  });

  it('start URL with a query or fragment stays in scope', () => {
    const scope = computeDiscoveryScope('https://ex.test/dev/en-us/?lang=en#main');

    expect(scope.pathPrefix).toBe('/dev/en-us/');
    expect(isInDiscoveryScope('https://ex.test/dev/en-us/?lang=en#main', scope)).toBe(true);
  });
});
