import type { FastifyRequest, FastifyReply } from 'fastify';
import { decodeJwt } from 'jose';

export interface AuthUser {
  readonly id: string;
  readonly username: string;
  readonly role: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

function isTokenExpired(token: string): boolean {
  try {
    const payload = decodeJwt(token);
    if (payload.exp === undefined) return false;
    return Date.now() >= payload.exp * 1000;
  } catch {
    return true;
  }
}

function extractUserFromToken(token: string): AuthUser | null {
  try {
    const payload = decodeJwt(token);
    const sub = payload.sub;
    const username = payload.username ?? payload.sub ?? '';
    const role = payload.role ?? 'viewer';
    if (typeof sub !== 'string' || sub === '') return null;
    return {
      id: sub,
      username: typeof username === 'string' ? username : String(username),
      role: typeof role === 'string' ? role : 'viewer',
    };
  } catch {
    return null;
  }
}

export async function authGuard(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const session = request.session as { token?: string };
  const token = session.token;

  if (token === undefined || token === '') {
    await reply.redirect('/login');
    return;
  }

  if (isTokenExpired(token)) {
    request.session.delete();
    await reply.redirect('/login');
    return;
  }

  const user = extractUserFromToken(token);
  if (user === null) {
    request.session.delete();
    await reply.redirect('/login');
    return;
  }

  request.user = user;
}

export async function adminGuard(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (request.user?.role !== 'admin') {
    await reply.code(403).send({ error: 'Forbidden: admin role required' });
  }
}

export function requireRole(role: 'viewer' | 'user' | 'admin') {
  const roleOrder: Record<string, number> = { viewer: 0, user: 1, admin: 2 };

  return async function roleGuard(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const userRole = request.user?.role ?? 'viewer';
    const requiredLevel = roleOrder[role] ?? 0;
    const userLevel = roleOrder[userRole] ?? 0;

    if (userLevel < requiredLevel) {
      await reply.code(403).send({ error: `Forbidden: ${role} role required` });
    }
  };
}
