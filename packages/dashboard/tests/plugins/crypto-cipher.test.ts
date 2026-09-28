/**
 * PBH-B Task 2 — createAtRestCipher + isEncryptedShape.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createAtRestCipher,
  encryptSecret,
  decryptSecret,
  setEncryptionSalt,
  isEncryptedShape,
} from '../../src/plugins/crypto.js';

const SALT = 'crypto-cipher-test-salt';
const KEY = 'crypto-cipher-test-key-32-chars!';
const WRONG_KEY = 'crypto-cipher-wrong-key-32-chars';

describe('createAtRestCipher (PBH-B)', () => {
  beforeEach(() => {
    setEncryptionSalt(SALT);
  });

  it('CIP-1: format is identical to encryptSecret/decryptSecret in both directions', () => {
    const cipher = createAtRestCipher({ key: KEY, salt: SALT });

    // cipher.encrypt output decrypts with decryptSecret (after setEncryptionSalt)
    const fromCipher = cipher.encrypt('hello-from-cipher');
    setEncryptionSalt(SALT);
    expect(decryptSecret(fromCipher, KEY)).toBe('hello-from-cipher');

    // encryptSecret output decrypts with the cipher
    setEncryptionSalt(SALT);
    const fromLegacy = encryptSecret('hello-from-legacy', KEY);
    expect(cipher.decrypt(fromLegacy)).toBe('hello-from-legacy');
  });

  it('CIP-2: wrong key -> decrypt throws', () => {
    const cipher = createAtRestCipher({ key: KEY, salt: SALT });
    const ciphertext = cipher.encrypt('secret-value');
    const wrongCipher = createAtRestCipher({ key: WRONG_KEY, salt: SALT });
    expect(() => wrongCipher.decrypt(ciphertext)).toThrow();
  });

  it('CIP-3: wrong salt -> decrypt throws', () => {
    const cipher = createAtRestCipher({ key: KEY, salt: SALT });
    const ciphertext = cipher.encrypt('secret-value');
    const wrongSaltCipher = createAtRestCipher({ key: KEY, salt: 'a-different-salt' });
    expect(() => wrongSaltCipher.decrypt(ciphertext)).toThrow();
  });

  it('CIP-4: isEncryptedShape', () => {
    const cipher = createAtRestCipher({ key: KEY, salt: SALT });
    const real = cipher.encrypt('some plaintext');
    const emptyPlaintext = cipher.encrypt('');

    expect(isEncryptedShape(real)).toBe(true);
    expect(isEncryptedShape(emptyPlaintext)).toBe(true); // iv::tag — empty ciphertext segment

    expect(isEncryptedShape('a plain string')).toBe(false);
    expect(isEncryptedShape('two:parts')).toBe(false);

    // iv that does not decode to 12 bytes: replace iv segment with a short base64 value
    const parts = real.split(':');
    const badIv = ['YQ==', parts[1], parts[2]].join(':'); // "a" -> 1 byte, not 12
    expect(isEncryptedShape(badIv)).toBe(false);

    // tag that does not decode to 16 bytes
    const badTag = [parts[0], parts[1], 'YQ=='].join(':'); // 1 byte, not 16
    expect(isEncryptedShape(badTag)).toBe(false);
  });
});
