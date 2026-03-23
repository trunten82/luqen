import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { StorageAdapter } from '../../db/index.js';
import type { AuthService } from '../../auth/auth-service.js';
import { validateUsername, validatePassword } from '../../validation.js';

interface SetupBody {
  username?: string;
  password?: string;
  role?: string;
}

/**
 * POST /api/v1/setup — Create the first admin user (or recover admin access).
 *
 * Requires a valid API key via Authorization: Bearer <key> or X-API-Key header.
 * Creates a dashboard user with the specified role (defaults to "admin").
 *
 * This endpoint is always available when authenticated with a valid API key,
 * allowing admin recovery when locked out of password-based login.
 */
export async function setupRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
  authService: AuthService,
): Promise<void> {
  server.post(
    '/api/v1/setup',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Authenticate via API key (header-based, not session)
      const authHeader = request.headers.authorization;
      const xApiKey = request.headers['x-api-key'] as string | undefined;
      const apiKeyToken = authHeader !== undefined && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : xApiKey;

      if (apiKeyToken === undefined || apiKeyToken === '') {
        return reply.code(401).send({
          error: 'API key required. Use Authorization: Bearer <key> or X-API-Key header.',
        });
      }

      const valid = authService.validateApiKey(apiKeyToken);
      if (!valid) {
        return reply.code(401).send({ error: 'Invalid API key.' });
      }

      const body = request.body as SetupBody;
      const username = body.username?.trim();
      const password = body.password;
      const role = body.role?.trim() ?? 'admin';

      if (!username || !password) {
        return reply.code(400).send({
          error: 'Both "username" and "password" are required.',
        });
      }

      const usernameCheck = validateUsername(username);
      if (!usernameCheck.valid) {
        return reply.code(400).send({ error: usernameCheck.error });
      }

      const passwordCheck = validatePassword(password);
      if (!passwordCheck.valid) {
        return reply.code(400).send({ error: passwordCheck.error });
      }

      const validRoles = new Set(['viewer', 'user', 'developer', 'admin', 'executive']);
      if (!validRoles.has(role)) {
        return reply.code(400).send({
          error: `Invalid role "${role}". Must be one of: ${[...validRoles].join(', ')}`,
        });
      }

      // Check for duplicate username
      const existing = await storage.users.getUserByUsername(username);
      if (existing !== null) {
        return reply.code(409).send({
          error: `User "${username}" already exists.`,
        });
      }

      try {
        const created = await storage.users.createUser(username, password, role);
        return reply.code(201).send({
          message: `User "${created.username}" created with role "${created.role}".`,
          user: {
            id: created.id,
            username: created.username,
            role: created.role,
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create user';
        return reply.code(500).send({ error: message });
      }
    },
  );
}
