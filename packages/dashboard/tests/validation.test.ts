/**
 * Quick 261013-dr7 (WR-04): usernames starting with "api-key" (case-insensitive) are reserved, so no
 * account can be created whose display name reads like an API-key actor. (The Dismissed section no
 * longer decides the actor kind from the name at all; this is the second line.)
 */
import { describe, expect, it } from 'vitest';
import { validateUsername } from '../src/validation.js';

describe('validateUsername reserves the api-key prefix', () => {
  it('usernames starting api-key are refused case-insensitively; others are allowed', () => {
    for (const name of ['api-key', 'API-Key-ops', 'api-keyboard', 'Api-Key.deploy']) {
      const r = validateUsername(name);
      expect(r.valid, name).toBe(false);
      expect(r.error, name).toMatch(/api-key/i);
    }
    for (const name of ['apikey', 'my-api-key', 'fabrikam-admin', 'api_key']) {
      expect(validateUsername(name).valid, name).toBe(true);
    }
  });
});
