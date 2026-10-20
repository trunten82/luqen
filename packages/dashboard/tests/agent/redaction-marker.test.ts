/**
 * HARD-21: the redaction marker is recognised in any letter case, with surrounding space and in its
 * bracket forms, wherever a secret-named argument holds it. A value that merely contains the word is
 * ordinary text.
 */
import { describe, it, expect } from 'vitest';
import { redactedArgumentPaths } from '../../src/db/agent-audit-redaction.js';

describe('HARD-21 the redaction marker forms', () => {
  it('HARD-21 the redaction marker is recognised in any case and with surrounding space', () => {
    const refused = ['[REDACTED]', ' [redacted] ', '[ Redacted ]', '<redacted>', '(REDACTED)', '{redacted}', 'Bearer <REDACTED>', 'REDACTED', '  redacted  '];
    for (const value of refused) {
      expect(redactedArgumentPaths({ clientSecret: value }), `under clientSecret: "${value}"`).toEqual(['clientSecret']);
    }

    // Not the marker: the same text under a key whose name is not secret, a real value, a word that
    // only contains the marker's letters.
    expect(redactedArgumentPaths({ title: '[REDACTED]' })).toEqual([]);
    expect(redactedArgumentPaths({ clientSecret: 'Bearer placeholder-real' })).toEqual([]);
    expect(redactedArgumentPaths({ clientSecret: 'unredacted-placeholder' })).toEqual([]);
  });
});
