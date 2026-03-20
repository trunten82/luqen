import { describe, it, expect } from 'vitest';
import {
  encryptSecret,
  decryptSecret,
  encryptConfig,
  decryptConfig,
  maskSecrets,
} from '../../src/plugins/crypto.js';
import type { ConfigField } from '../../src/plugins/types.js';

const TEST_KEY = 'test-encryption-key-for-plugin-secrets';

describe('encryptSecret / decryptSecret', () => {
  it('encrypt then decrypt returns original value', () => {
    const original = 'my-super-secret-api-key';
    const encrypted = encryptSecret(original, TEST_KEY);
    const decrypted = decryptSecret(encrypted, TEST_KEY);
    expect(decrypted).toBe(original);
  });

  it('decrypt with wrong key throws', () => {
    const encrypted = encryptSecret('secret-value', TEST_KEY);
    expect(() => decryptSecret(encrypted, 'wrong-key')).toThrow();
  });

  it('encrypted output differs from input', () => {
    const original = 'plaintext-value';
    const encrypted = encryptSecret(original, TEST_KEY);
    expect(encrypted).not.toBe(original);
  });

  it('encrypt produces different ciphertext each time (random IV)', () => {
    const original = 'same-value';
    const enc1 = encryptSecret(original, TEST_KEY);
    const enc2 = encryptSecret(original, TEST_KEY);
    expect(enc1).not.toBe(enc2);
  });
});

const testSchema: readonly ConfigField[] = [
  { key: 'host', label: 'Host', type: 'string', required: true },
  { key: 'apiKey', label: 'API Key', type: 'secret', required: true },
  { key: 'port', label: 'Port', type: 'number', default: 443 },
  { key: 'token', label: 'Token', type: 'secret' },
] as const;

describe('encryptConfig', () => {
  it('only encrypts secret-typed fields, leaves others unchanged', () => {
    const config: Record<string, unknown> = {
      host: 'example.com',
      apiKey: 'sk-12345',
      port: 443,
      token: 'tok-abcde',
    };

    const encrypted = encryptConfig(config, testSchema, TEST_KEY);

    // Non-secret fields unchanged
    expect(encrypted.host).toBe('example.com');
    expect(encrypted.port).toBe(443);

    // Secret fields are encrypted (different from original)
    expect(encrypted.apiKey).not.toBe('sk-12345');
    expect(encrypted.token).not.toBe('tok-abcde');

    // Secret fields are strings (base64 encoded)
    expect(typeof encrypted.apiKey).toBe('string');
    expect(typeof encrypted.token).toBe('string');
  });
});

describe('decryptConfig', () => {
  it('only decrypts secret-typed fields', () => {
    const config: Record<string, unknown> = {
      host: 'example.com',
      apiKey: 'sk-12345',
      port: 443,
      token: 'tok-abcde',
    };

    const encrypted = encryptConfig(config, testSchema, TEST_KEY);
    const decrypted = decryptConfig(encrypted, testSchema, TEST_KEY);

    expect(decrypted).toEqual(config);
  });
});

describe('maskSecrets', () => {
  it('replaces secret fields with *** and leaves others unchanged', () => {
    const config: Record<string, unknown> = {
      host: 'example.com',
      apiKey: 'sk-12345',
      port: 443,
      token: 'tok-abcde',
    };

    const masked = maskSecrets(config, testSchema);

    expect(masked.host).toBe('example.com');
    expect(masked.port).toBe(443);
    expect(masked.apiKey).toBe('***');
    expect(masked.token).toBe('***');
  });
});
