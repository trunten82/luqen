import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getToken } from '../compliance-client.js';
import type { DashboardConfig } from '../config.js';
import type { AuthService } from '../auth/auth-service.js';
import type { UserDb } from '../db/users.js';
import type { AuditLogger } from '../audit/logger.js';
import { decodeJwt } from 'jose';
import { validatePassword } from '../validation.js';
import { SUPPORTED_LOCALES, type Locale } from '../i18n/index.js';

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
  userDb?: UserDb,
  auditLogger?: AuditLogger,
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

      // ── API key login (available in all modes) ─────────────────────────
      if (typeof body.apiKey === 'string' && body.apiKey.trim() !== '') {
        const valid = authService.validateApiKey(body.apiKey.trim());

        if (!valid) {
          auditLogger?.log({ actor: 'unknown', action: 'login.failure', resourceType: 'session', details: 'Invalid API key', ipAddress: request.ip });
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
        session.set('bootId', authService.getBootId());

        auditLogger?.log({ actor: 'admin', actorId: 'api-key', action: 'login.success', resourceType: 'session', details: 'API key login', ipAddress: request.ip });
        await reply.redirect('/');
        return;
      }

      // ── Solo mode: API key is the only option ──────────────────────────
      if (mode === 'solo') {
        return reply.view('login.hbs', {
          error: 'API key is required.',
          mode,
          loginMethods: authService.getLoginMethods(),
        });
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
          session.set('bootId', authService.getBootId());

          auditLogger?.log({ actor: displayUsername, actorId: userId, action: 'login.success', resourceType: 'session', details: 'OAuth login', ipAddress: request.ip });
          await reply.redirect('/');
          return;
        } catch {
          // Fall through to local password login
        }
      }

      // Local password login
      const result = await authService.loginWithPassword(username.trim(), password);

      if (!result.authenticated) {
        auditLogger?.log({ actor: username.trim(), action: 'login.failure', resourceType: 'session', details: result.error ?? 'Invalid credentials', ipAddress: request.ip });
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
      session.set('bootId', authService.getBootId());

      auditLogger?.log({ actor: result.user!.username, actorId: result.user!.id, action: 'login.success', resourceType: 'session', details: 'Password login', ipAddress: request.ip });
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
      session.set('bootId', authService.getBootId());

      // Store IdP groups and resolved team names in the session
      if (result.groups) {
        session.set('groups', result.groups);
      }
      if (result.teams) {
        session.set('teams', result.teams);
      }

      await reply.redirect('/');
    },
  );

  // GET /account — profile page
  server.get('/account', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = request.session as { get(key: string): unknown };
    const authMethod = session.get('authMethod') as string | undefined;
    const canChangePassword = authMethod === 'password';
    const { localeSaved } = request.query as { localeSaved?: string };

    return reply.view('account/profile.hbs', {
      pageTitle: 'My Profile',
      currentPath: '/account',
      user: request.user,
      authMethod: authMethod ?? 'api-key',
      canChangePassword,
      localeSaved: localeSaved === '1',
    });
  });

  // POST /account/change-password — update own password
  server.post('/account/change-password', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (request: FastifyRequest, reply: FastifyReply) => {
    const session = request.session as { get(key: string): unknown };
    const authMethod = session.get('authMethod') as string | undefined;
    const canChangePassword = authMethod === 'password';

    const viewData = {
      pageTitle: 'My Profile',
      currentPath: '/account',
      user: request.user,
      authMethod: authMethod ?? 'api-key',
      canChangePassword,
    };

    if (userDb === undefined || !canChangePassword) {
      return reply.view('account/profile.hbs', {
        ...viewData,
        pwError: 'Password change is not available for your authentication method.',
      });
    }

    const body = request.body as {
      currentPassword?: string;
      newPassword?: string;
      confirmPassword?: string;
    };

    const userId = request.user?.id;
    const username = request.user?.username;

    if (!userId || !username) {
      await reply.redirect('/login');
      return;
    }

    if (!body.currentPassword) {
      return reply.view('account/profile.hbs', { ...viewData, pwError: 'Current password is required.' });
    }

    if (!body.newPassword) {
      return reply.view('account/profile.hbs', { ...viewData, pwError: 'New password is required.' });
    }

    const pwCheck = validatePassword(body.newPassword);
    if (!pwCheck.valid) {
      return reply.view('account/profile.hbs', { ...viewData, pwError: pwCheck.error ?? 'Invalid password.' });
    }

    if (body.newPassword !== body.confirmPassword) {
      return reply.view('account/profile.hbs', { ...viewData, pwError: 'New passwords do not match.' });
    }

    const valid = await userDb.verifyPassword(username, body.currentPassword);
    if (!valid) {
      return reply.view('account/profile.hbs', { ...viewData, pwError: 'Current password is incorrect.' });
    }

    try {
      await userDb.updatePassword(userId, body.newPassword);
      return reply.view('account/profile.hbs', { ...viewData, pwSuccess: 'Password changed successfully.' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to change password';
      return reply.view('account/profile.hbs', { ...viewData, pwError: message });
    }
  });

  // POST /account/locale — switch UI language
  server.post('/account/locale', async (request: FastifyRequest, reply: FastifyReply) => {
    const { locale, _from } = request.body as { locale?: string; _from?: string };
    if (locale && SUPPORTED_LOCALES.includes(locale as Locale)) {
      const session = request.session as { set(k: string, v: unknown): void };
      session.set('locale', locale);
    }
    if (_from === 'profile') {
      await reply.redirect('/account?localeSaved=1');
      return;
    }
    const referer = request.headers.referer ?? '/';
    await reply.redirect(referer);
  });

  // POST /logout — clear session and redirect
  server.post('/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    request.session.delete();
    await reply.redirect('/login');
  });
}
