import { describe, it, expect } from 'vitest';
import { hasScope, scopeCoversEndpoint, validateScopes, SCOPES } from '../../src/auth/scopes.js';

describe('scopes', () => {
  it('SCOPES contains read, write, admin', () => {
    expect(SCOPES).toEqual(['read', 'write', 'admin']);
  });

  it('hasScope returns true when scope is present', () => {
    expect(hasScope(['read', 'write'], 'read')).toBe(true);
  });

  it('hasScope returns false when scope is missing', () => {
    expect(hasScope(['read'], 'admin')).toBe(false);
  });

  it('scopeCoversEndpoint: admin covers all', () => {
    expect(scopeCoversEndpoint(['admin'], 'read')).toBe(true);
    expect(scopeCoversEndpoint(['admin'], 'write')).toBe(true);
    expect(scopeCoversEndpoint(['admin'], 'admin')).toBe(true);
  });

  it('scopeCoversEndpoint: write covers read but not admin', () => {
    expect(scopeCoversEndpoint(['write'], 'read')).toBe(true);
    expect(scopeCoversEndpoint(['write'], 'admin')).toBe(false);
  });

  it('scopeCoversEndpoint: read covers only read', () => {
    expect(scopeCoversEndpoint(['read'], 'read')).toBe(true);
    expect(scopeCoversEndpoint(['read'], 'write')).toBe(false);
  });

  it('validateScopes rejects empty array', () => {
    expect(validateScopes([])).toBe(false);
  });

  it('validateScopes rejects unknown scopes', () => {
    expect(validateScopes(['read', 'superadmin'])).toBe(false);
  });

  it('validateScopes accepts valid scopes', () => {
    expect(validateScopes(['read', 'write'])).toBe(true);
  });
});
