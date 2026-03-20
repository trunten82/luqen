import type { FastifyRequest, FastifyReply } from 'fastify';
import type { AuthService } from './auth-service.js';

export interface AuthUser {
  readonly id: string;
  readonly username: string;
  readonly role: string;
  readonly currentOrgId?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

export function createAuthGuard(authService: AuthService) {
  return async function authGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const isApiRequest = request.url.startsWith('/api/');
    const result = await authService.authenticateRequest(request);

    if (!result.authenticated) {
      if (isApiRequest) {
        await reply.code(401).send({ error: result.error ?? 'Authentication required' });
        return;
      }
      await reply.redirect('/login');
      return;
    }

    request.user = {
      id: result.user!.id,
      username: result.user!.username,
      role: result.user!.role ?? 'viewer',
    };
  };
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
