/**
 * PBH-B Task 2 — REG-1: AT_REST_STORES completeness.
 *
 * The set of (table, column) covered by AT_REST_STORES must equal EXACTLY
 * the four known at-rest columns, and every migrations.ts column whose
 * name contains "encrypted" must be covered by SOME store's table+column —
 * so a future encrypted column fails this test until it is registered.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AT_REST_STORES } from '../../src/at-rest/stores.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_PATH = join(HERE, '..', '..', 'src', 'db', 'sqlite', 'migrations.ts');

describe('AT_REST_STORES completeness (REG-1)', () => {
  it('covers exactly the four known at-rest columns', () => {
    const covered = AT_REST_STORES.map((s) => `${s.table}.${s.column}`).sort();
    expect(covered).toEqual(
      [
        'oauth_signing_keys.encrypted_private_key_pem',
        'service_connections.client_secret_encrypted',
        'developer_credentials.encrypted_token',
        'plugins.config',
      ].sort(),
    );
  });

  it('every migrations.ts column whose name contains "encrypted" is covered by a registered table', () => {
    const source = readFileSync(MIGRATIONS_PATH, 'utf-8');
    // Matches "  column_name_containing_encrypted TYPE" inside a CREATE TABLE
    // block; good enough for this repo's consistent two-space SQL indent.
    const columnPattern = /^\s*(\w*encrypted\w*)\s+TEXT/gim;
    const foundColumns = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = columnPattern.exec(source)) !== null) {
      foundColumns.add(match[1]);
    }
    expect(foundColumns.size).toBeGreaterThan(0);

    const coveredColumns = new Set(AT_REST_STORES.map((s) => s.column));
    const missing = [...foundColumns].filter((c) => !coveredColumns.has(c));
    expect(missing, `columns named *encrypted* not covered by AT_REST_STORES: ${missing.join(', ')}`).toEqual([]);
  });
});
