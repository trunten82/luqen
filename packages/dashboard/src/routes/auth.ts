import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getToken } from '../compliance-client.js';
import type { DashboardConfig } from '../config.js';
import { decodeJwt } from 'jose';

interface LoginBody {
  username: string;
  password: string;
}

export async function authRoutes(
  server: FastifyInstance,
  config: DashboardConfig,
): Promise<void> {
  // GET /login — render login page
  server.get('/login', async (request: FastifyRequest, reply: FastifyReply) => {
    // If already authenticated, redirect home
    const session = request.session as { token?: string };
    if (session.token !== undefined && session.token !== '') {
      await reply.redirect('/');
      return;
    }
    return reply.view('login.hbs', {});
  });

  // POST /login — authenticate via compliance service
  server.post(
    '/login',
    { config: { skipAuth: true } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { username, password } = request.body as LoginBody;

      if (typeof username !== 'string' || username.trim() === '') {
        return reply.view('login.hbs', {
          error: 'Username is required.',
          username: '',
        });
      }

      if (typeof password !== 'string' || password === '') {
        return reply.view('login.hbs', {
          error: 'Password is required.',
          username,
        });
      }

      try {
        const tokenResponse = await getToken(
          config.complianceUrl,
          username.trim(),
          password,
          config.complianceClientId || 'dashboard',
          config.complianceClientSecret,
        );

        const token = tokenResponse.access_token;

        // Decode JWT to extract user info
        let userId = username;
        let userRole = 'viewer';
        let displayUsername = username;

        try {
          const payload = decodeJwt(token);
          userId = typeof payload.sub === 'string' ? payload.sub : username;
          userRole = typeof payload.role === 'string' ? payload.role : 'viewer';
          displayUsername =
            typeof payload.username === 'string' ? payload.username : username;
        } catch {
          // Use defaults if JWT decode fails
        }

        const session = request.session as {
          token?: string;
          user?: { id: string; username: string; role: string };
        };
        session.token = token;
        session.user = { id: userId, username: displayUsername, role: userRole };

        await reply.redirect('/');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const isAuthError =
          message.includes('401') ||
          message.includes('Authentication failed') ||
          message.includes('invalid_grant') ||
          message.includes('Unauthorized');

        return reply.view('login.hbs', {
          error: isAuthError
            ? 'Invalid username or password.'
            : 'Login failed. Please try again later.',
          username,
        });
      }
    },
  );

  // POST /logout — clear session and redirect
  server.post('/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    request.session.delete();
    await reply.redirect('/login');
  });

  // GET /logout — removed; use POST /logout to avoid CSRF risk
  // (sameSite:strict mitigates cross-site CSRF, but GET logout remains a
  // best-practice anti-pattern per OWASP A01 session management guidelines)
}
