/**
 * Regression test for Phase 81 (EXPO-05/D-06): the legal-exposure methodology
 * page MUST be public/anonymous. It is linked from every exposure indicator
 * (dashboard, fleet, and the WordPress plugin), so gating it behind the global
 * auth guard (302 → /login) is a bug. This guards the isPublicPath allowlist
 * exemption that was missing on first deploy.
 */
import { describe, it, expect } from 'vitest';
import { isPublicPath } from '../../src/server.js';

describe('methodology page is public (EXPO-05/D-06)', () => {
  it('exempts /methodology/legal-exposure from the auth guard', () => {
    expect(isPublicPath('/methodology/legal-exposure')).toBe(true);
  });

  it('exempts any /methodology/* documentation path', () => {
    expect(isPublicPath('/methodology/legal-exposure')).toBe(true);
    expect(isPublicPath('/methodology/anything')).toBe(true);
  });

  it('still gates a normal authenticated route (sanity — guard not disabled)', () => {
    expect(isPublicPath('/')).toBe(false);
    expect(isPublicPath('/fleet')).toBe(false);
    expect(isPublicPath('/admin/clients')).toBe(false);
  });
});
