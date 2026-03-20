import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getToken } from '../compliance-client.js';
import type { DashboardConfig } from '../config.js';
import type { AuthService } from '../auth/auth-service.js';
import { decodeJwt } from 'jose';

interface LoginBody {
  username?: string;
  password?: string;
  apiKey?: string;
}

interface SsoParams {
  pluginId: string;
}

export async function authRoutes(
  server: FastifyInstance,
  config: DashboardConfig,
  authService: AuthService,
): Promise<void> {
  // GET /login — render login page with mode-aware UI
  server.get('/login', async (request: FastifyRequest, reply: FastifyReply) => {
    // If already authenticated, redirect home
    const session = request.session as { get(key: string): unknown };
    if (typeof session.get === 'function') {
      const userId = session.get('userId') as string | undefined;
      if (userId !== undefined) {
        await reply.redirect('/');
        return;
      }
    }

    const mode = authService.getAuthMode();
    const loginMethods = authService.getLoginMethods();

    return reply.view('login.hbs', { mode, loginMethods });
  });

  // POST /login — authenticate based on auth mode
  server.post(
    '/login',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as LoginBody;
      const mode = authService.getAuthMode();

      // ── Solo mode: validate API key ────────────────────────────────────
      if (mode === 'solo') {
        const apiKey = body.apiKey;

        if (typeof apiKey !== 'string' || apiKey.trim() === '') {
          return reply.view('login.hbs', {
            error: 'API key is required.',
            mode,
            loginMethods: authService.getLoginMethods(),
          });
        }

        const valid = authService.validateApiKey(apiKey.trim());

        if (!valid) {
          return reply.view('login.hbs', {
            error: 'Invalid API key.',
            mode,
            loginMethods: authService.getLoginMethods(),
          });
        }

        const session = request.session as { set(key: string, value: unknown): void };
        session.set('userId', 'api-key');
        session.set('username', 'admin');
        session.set('role', 'admin');
        session.set('authMethod', 'api-key');

        await reply.redirect('/');
        return;
      }

      // ── Team mode: password login ──────────────────────────────────────
      const { username, password } = body;

      if (typeof username !== 'string' || username.trim() === '') {
        return reply.view('login.hbs', {
          error: 'Username is required.',
          username: '',
          mode,
          loginMethods: authService.getLoginMethods(),
        });
      }

      if (typeof password !== 'string' || password === '') {
        return reply.view('login.hbs', {
          error: 'Password is required.',
          username,
          mode,
          loginMethods: authService.getLoginMethods(),
        });
      }

      // If compliance URL is configured in team mode, try OAuth first
      if (mode === 'team' && config.complianceUrl !== '' && config.complianceUrl !== 'http://localhost:4000') {
        try {
          const tokenResponse = await getToken(
            config.complianceUrl,
            username.trim(),
            password,
            config.complianceClientId || 'dashboard',
            config.complianceClientSecret,
          );

          const token = tokenResponse.access_token;

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

          const session = request.session as { set(key: string, value: unknown): void };
          session.set('userId', userId);
          session.set('username', displayUsername);
          session.set('role', userRole);
          session.set('authMethod', 'oauth');

          await reply.redirect('/');
          return;
        } catch {
          // Fall through to local password login
        }
      }

      // Local password login
      const result = await authService.loginWithPassword(username.trim(), password);

      if (!result.authenticated) {
        return reply.view('login.hbs', {
          error: result.error ?? 'Invalid username or password.',
          username,
          mode,
          loginMethods: authService.getLoginMethods(),
        });
      }

      const session = request.session as { set(key: string, value: unknown): void };
      session.set('userId', result.user!.id);
      session.set('username', result.user!.username);
      session.set('role', result.user!.role ?? 'user');
      session.set('authMethod', 'password');

      await reply.redirect('/');
    },
  );

  // GET /auth/sso/:pluginId — redirect to SSO provider
  server.get(
    '/auth/sso/:pluginId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { pluginId } = request.params as SsoParams;
      const authPlugins = authService.getAuthPlugins();

      if (authPlugins.length === 0) {
        await reply.code(404).send({ error: `Auth plugin "${pluginId}" not found` });
        return;
      }

      // Find the plugin; currently uses first available plugin
      const plugin = authPlugins[0];

      if (plugin.getLoginUrl === undefined) {
        await reply.code(500).send({ error: `Auth plugin "${pluginId}" does not support SSO redirect` });
        return;
      }

      const loginUrl = await plugin.getLoginUrl();
      await reply.redirect(loginUrl);
    },
  );

  // GET /auth/callback/:pluginId — handle SSO callback
  server.get(
    '/auth/callback/:pluginId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { pluginId } = request.params as SsoParams;

      const result = await authService.handleSsoCallback(pluginId, request);

      if (!result.authenticated) {
        return reply.view('login.hbs', {
          error: result.error ?? 'SSO authentication failed.',
          mode: authService.getAuthMode(),
          loginMethods: authService.getLoginMethods(),
        });
      }

      const session = request.session as { set(key: string, value: unknown): void };
      session.set('userId', result.user!.id);
      session.set('username', result.user!.username);
      session.set('role', result.user!.role ?? 'user');
      session.set('authMethod', 'sso');

      await reply.redirect('/');
    },
  );

  // POST /logout — clear session and redirect
  server.post('/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    request.session.delete();
    await reply.redirect('/login');
  });
}
