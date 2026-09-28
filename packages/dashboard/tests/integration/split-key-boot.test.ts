/**
 * PBH-A Task 1 — split-key-boot.test.ts
 *
 * Real `createServer` boots proving the at-rest encryption key is
 * independent of the session secret. E2E-3 is the 2026-09-28 incident,
 * inverted: rotating DASHBOARD_SESSION_SECRET while DASHBOARD_ENCRYPTION_KEY
 * stays fixed must no longer crash-loop the dashboard.
 *
 * Harness follows tests/openapi/route-coverage.test.ts. Each test gets its
 * own mkdtempSync root. app.close() is called before every reboot within a
 * test. To read the signing key back out-of-band we open a fresh
 * better-sqlite3 connection, read dashboard_settings.encryption_salt, call
 * setEncryptionSalt() with it (module global, shared in-worker), then call
 * decryptSecret().
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createServer } from '../../src/server.js';
import { setEncryptionSalt, decryptSecret } from '../../src/plugins/crypto.js';
import type { FastifyInstance } from 'fastify';

interface BuildConfigInput {
  readonly dbPath: string;
  readonly reportsDir: string;
  readonly sessionSecret: string;
  readonly encryptionKey?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildConfig(input: BuildConfigInput): any {
  return {
    dbPath: input.dbPath,
    reportsDir: input.reportsDir,
    sessionSecret: input.sessionSecret,
    ...(input.encryptionKey !== undefined ? { encryptionKey: input.encryptionKey } : {}),
    catalogueUrl: '',
    catalogueCacheTtl: 0,
    redisUrl: '',
    maxConcurrentScans: 1,
  };
}

function readActiveSigningKeyCiphertext(dbPath: string): { readonly salt: string; readonly ciphertext: string } {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const saltRow = db
      .prepare(`SELECT value FROM dashboard_settings WHERE key = 'encryption_salt'`)
      .get() as { value: string } | undefined;
    const keyRow = db
      .prepare(`SELECT encrypted_private_key_pem FROM oauth_signing_keys WHERE retired_at IS NULL ORDER BY created_at DESC LIMIT 1`)
      .get() as { encrypted_private_key_pem: string } | undefined;
    if (saltRow === undefined || keyRow === undefined) {
      throw new Error('split-key-boot test harness: expected dashboard_settings.encryption_salt and an active oauth_signing_keys row');
    }
    return { salt: saltRow.value, ciphertext: keyRow.encrypted_private_key_pem };
  } finally {
    db.close();
  }
}

async function bootAndClose(config: unknown): Promise<void> {
  const app = (await createServer(config as never)) as FastifyInstance;
  await app.ready();
  await app.close();
}

describe('split-key boot (PBH-A, E2E)', () => {
  it('E2E-1 (control): fresh DB with no encryptionKey -> boots; signing key decrypts with sessionSecret', async () => {
    const root = mkdtempSync(join(tmpdir(), 'luqen-e2e1-'));
    const dbPath = join(root, 'dashboard.db');
    const reportsDir = join(root, 'reports');
    const sessionSecret = 'a'.repeat(32);

    await bootAndClose(buildConfig({ dbPath, reportsDir, sessionSecret }));

    const { salt, ciphertext } = readActiveSigningKeyCiphertext(dbPath);
    setEncryptionSalt(salt);
    expect(() => decryptSecret(ciphertext, sessionSecret)).not.toThrow();
  }, 120_000);

  it('E2E-2: sessionSecret=A, encryptionKey=B -> boots; bootstrapped key decrypts with B and throws with A', async () => {
    const root = mkdtempSync(join(tmpdir(), 'luqen-e2e2-'));
    const dbPath = join(root, 'dashboard.db');
    const reportsDir = join(root, 'reports');
    const A = 'a'.repeat(32);
    const B = 'b'.repeat(32);

    await bootAndClose(buildConfig({ dbPath, reportsDir, sessionSecret: A, encryptionKey: B }));

    const { salt, ciphertext } = readActiveSigningKeyCiphertext(dbPath);
    setEncryptionSalt(salt);
    expect(() => decryptSecret(ciphertext, B)).not.toThrow();
    setEncryptionSalt(salt);
    expect(() => decryptSecret(ciphertext, A)).toThrow();
  }, 120_000);

  it('E2E-3 (the 2026-09-28 incident, inverted): reboot with new sessionSecret=C, same encryptionKey=B -> createServer resolves', async () => {
    const root = mkdtempSync(join(tmpdir(), 'luqen-e2e3-'));
    const dbPath = join(root, 'dashboard.db');
    const reportsDir = join(root, 'reports');
    const A = 'a'.repeat(32);
    const B = 'b'.repeat(32);
    const C = 'c'.repeat(32);

    await bootAndClose(buildConfig({ dbPath, reportsDir, sessionSecret: A, encryptionKey: B }));

    // Reboot with a NEW session secret (C) and the SAME encryption key (B) —
    // this is the exact shape of the 2026-09-28 live rotation.
    let app2: FastifyInstance | undefined;
    try {
      app2 = (await createServer(
        buildConfig({ dbPath, reportsDir, sessionSecret: C, encryptionKey: B }) as never,
      )) as FastifyInstance;
      await expect(app2.ready()).resolves.not.toThrow();
    } finally {
      if (app2 !== undefined) await app2.close();
    }
  }, 120_000);

  it('E2E-4 (control, proves E2E-3 is not vacuous): reboot with sessionSecret=A and a WRONG encryptionKey -> rejects with the live error', async () => {
    const root = mkdtempSync(join(tmpdir(), 'luqen-e2e4-'));
    const dbPath = join(root, 'dashboard.db');
    const reportsDir = join(root, 'reports');
    const A = 'a'.repeat(32);
    const B = 'b'.repeat(32);
    const WRONG = 'z'.repeat(32);

    await bootAndClose(buildConfig({ dbPath, reportsDir, sessionSecret: A, encryptionKey: B }));

    // Manual try/catch (rather than expect(...).rejects) so that, pre-fix,
    // an UNEXPECTEDLY RESOLVED boot is caught and its app closed cleanly
    // instead of leaking a live Fastify instance across test boundaries.
    let app2: FastifyInstance | undefined;
    let caught: unknown;
    try {
      app2 = (await createServer(
        buildConfig({ dbPath, reportsDir, sessionSecret: A, encryptionKey: WRONG }) as never,
      )) as FastifyInstance;
      await app2.ready();
    } catch (err) {
      caught = err;
    }
    try {
      expect(caught, 'expected createServer to reject with a wrong encryptionKey').toBeInstanceOf(Error);
      expect((caught as Error).message).toBe('Unsupported state or unable to authenticate data');
    } finally {
      if (app2 !== undefined) await app2.close();
    }
  }, 120_000);

  it('E2E-5 (PBH-D): a real boot on an existing DB with split keys -> GET /health reports checks.atRestEncryption.status === "ok"', async () => {
    const root = mkdtempSync(join(tmpdir(), 'luqen-e2e5-'));
    const dbPath = join(root, 'dashboard.db');
    const reportsDir = join(root, 'reports');
    const A = 'a'.repeat(32);
    const B = 'b'.repeat(32);

    // Bootstrap the DB with split keys, same as E2E-2.
    await bootAndClose(buildConfig({ dbPath, reportsDir, sessionSecret: A, encryptionKey: B }));

    // Reboot on the SAME (now-existing) DB with the same split keys.
    let app2: FastifyInstance | undefined;
    try {
      app2 = (await createServer(
        buildConfig({ dbPath, reportsDir, sessionSecret: A, encryptionKey: B }) as never,
      )) as FastifyInstance;
      await app2.ready();
      const response = await app2.inject({ method: 'GET', url: '/health' });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.checks.atRestEncryption.status).toBe('ok');
      expect(body.status).toBe('ok');
    } finally {
      if (app2 !== undefined) await app2.close();
    }
  }, 120_000);
});
