import { describe, it, expect } from 'vitest';
import {
  SCOPES,
  hasScope,
  scopeCoversEndpoint,
  validateScopes,
} from '../../src/auth/scopes.js';

describe('Scopes', () => {
  it('defines read, write, admin scopes', () => {
    expect(SCOPES).toContain('read');
    expect(SCOPES).toContain('write');
    expect(SCOPES).toContain('admin');
  });

  it('hasScope returns true when scope is present', () => {
    expect(hasScope(['read', 'write'], 'read')).toBe(true);
  });

  it('hasScope returns false when scope is missing', () => {
    expect(hasScope(['read'], 'admin')).toBe(false);
  });

  it('admin scope grants access to read/write/admin endpoints', () => {
    expect(scopeCoversEndpoint(['admin'], 'read')).toBe(true);
    expect(scopeCoversEndpoint(['admin'], 'write')).toBe(true);
    expect(scopeCoversEndpoint(['admin'], 'admin')).toBe(true);
  });

  it('write scope grants access to read and write but not admin', () => {
    expect(scopeCoversEndpoint(['write'], 'read')).toBe(true);
    expect(scopeCoversEndpoint(['write'], 'write')).toBe(true);
    expect(scopeCoversEndpoint(['write'], 'admin')).toBe(false);
  });

  it('read scope grants access to read only', () => {
    expect(scopeCoversEndpoint(['read'], 'read')).toBe(true);
    expect(scopeCoversEndpoint(['read'], 'write')).toBe(false);
    expect(scopeCoversEndpoint(['read'], 'admin')).toBe(false);
  });

  it('validateScopes returns true for all valid scopes', () => {
    expect(validateScopes(['read'])).toBe(true);
    expect(validateScopes(['write'])).toBe(true);
    expect(validateScopes(['admin'])).toBe(true);
    expect(validateScopes(['read', 'write', 'admin'])).toBe(true);
  });

  it('validateScopes returns false when any scope is invalid', () => {
    expect(validateScopes(['unknown'])).toBe(false);
    expect(validateScopes(['read', 'invalid'])).toBe(false);
    expect(validateScopes([])).toBe(false);
  });
});
