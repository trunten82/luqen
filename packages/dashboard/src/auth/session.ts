import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import secureSession from '@fastify/secure-session';
import type Database from 'better-sqlite3';

export interface SessionUser {
  readonly id: string;
  readonly username: string;
  readonly role: string;
}

export interface SessionData {
  token?: string;
  user?: SessionUser;
}

/**
 * Retrieve or generate a persistent session salt from the dashboard_settings table.
 * The salt is 16 bytes hex-encoded, stored under key 'session_salt'.
 * Requires the dashboard_settings table to already exist (created by AuthService).
 */
function getOrCreateSessionSalt(db: Database.Database): string {
  const row = db.prepare('SELECT value FROM dashboard_settings WHERE key = ?').get('session_salt') as { value: string } | undefined;
  if (row != null) {
    return row.value;
  }
  const salt = randomBytes(8).toString('hex'); // 8 bytes → 16 hex chars (required by @fastify/secure-session)
  db.prepare('INSERT INTO dashboard_settings (key, value) VALUES (?, ?)').run('session_salt', salt);
  return salt;
}

export async function registerSession(
  server: FastifyInstance,
  sessionSecret: string,
  db?: Database.Database,
): Promise<void> {
  // Use DB-persisted salt if a database handle is provided, otherwise fall back
  // to a randomly generated salt (e.g. in tests without a DB).
  const salt = db !== undefined
    ? getOrCreateSessionSalt(db)
    : randomBytes(8).toString('hex');

  await server.register(secureSession, {
    secret: sessionSecret,
    salt,
    cookie: {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env['NODE_ENV'] === 'production',
    },
    sessionName: 'session',
  });
}
