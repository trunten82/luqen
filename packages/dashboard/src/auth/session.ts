import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
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

/** Default session expiry: 60 minutes. */
const DEFAULT_EXPIRY_MINUTES = 60;

/**
 * Read session expiry from environment variable.
 * Returns the expiry duration in milliseconds.
 */
export function getSessionExpiryMs(): number {
  const envValue = process.env['SESSION_EXPIRY_MINUTES'];
  if (envValue !== undefined) {
    const parsed = parseInt(envValue, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed * 60 * 1000;
    }
  }
  return DEFAULT_EXPIRY_MINUTES * 60 * 1000;
}

/**
 * Retrieve or generate a persistent session salt from the dashboard_settings table.
 * The salt is derived from 16 random bytes (base64-encoded, truncated to 16 chars for sodium).
 * Requires the dashboard_settings table to already exist (created by AuthService).
 */
function getOrCreateSessionSalt(db: Database.Database): string {
  const row = db.prepare('SELECT value FROM dashboard_settings WHERE key = ?').get('session_salt') as { value: string } | undefined;
  if (row != null) {
    return row.value;
  }
  const salt = randomBytes(16).toString('base64').slice(0, 16); // 16 random bytes, truncated to 16 ASCII chars for sodium
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
    : randomBytes(16).toString('base64').slice(0, 16);

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

/**
 * Check if the current session has expired based on lastActivity timestamp.
 * Returns true if the session is expired and should be invalidated.
 */
export function isSessionExpired(
  session: { get(key: string): unknown } | undefined,
  expiryMs: number,
): boolean {
  if (session === undefined || typeof session.get !== 'function') {
    return false;
  }

  const lastActivity = session.get('lastActivity') as number | undefined;
  if (lastActivity === undefined) {
    // No lastActivity set means the session predates this feature — not expired
    return false;
  }

  return Date.now() - lastActivity > expiryMs;
}

/**
 * Create a preHandler hook that:
 * 1. Checks session expiry and invalidates expired sessions
 * 2. Updates lastActivity timestamp on each request
 */
export function createSessionExpiryHook(expiryMs: number) {
  return async function sessionExpiryHook(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const session = request.session as {
      get(key: string): unknown;
      set(key: string, value: unknown): void;
      regenerate?: (keep?: string[]) => void;
    } | undefined;

    if (session === undefined || typeof session.get !== 'function') {
      return;
    }

    // Only check expiry for authenticated sessions
    const userId = session.get('userId');
    if (userId === undefined) {
      return;
    }

    // Check if session has expired
    if (isSessionExpired(session, expiryMs)) {
      // Invalidate the session
      if (typeof session.regenerate === 'function') {
        session.regenerate();
      }

      const isApiRequest = request.url.startsWith('/api/');
      if (isApiRequest) {
        await reply.code(401).send({ error: 'Session expired' });
        return;
      }

      await reply.redirect('/login?expired=1');
      return;
    }

    // Update last activity timestamp
    if (typeof session.set === 'function') {
      session.set('lastActivity', Date.now());
    }
  };
}
