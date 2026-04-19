import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getToken } from '../compliance-client.js';
import type { DashboardConfig } from '../config.js';
import type { AuthService } from '../auth/auth-service.js';
import type { StorageAdapter } from '../db/index.js';
import { decodeJwt } from 'jose';
import { validatePassword } from '../validation.js';
import { SUPPORTED_LOCALES, type Locale } from '../i18n/index.js';

interface LoginBody {
  username?: string;
  password?: string;
  apiKey?: string;
  returnTo?: string;
}

/**
 * Resolve a login returnTo input to a safe post-login redirect target.
 * Only same-origin absolute paths (starting with "/" but NOT "//") are
 * honored — protects against open-redirect abuse via returnTo=https://evil.
 * Fallback is "/". Smoke-surfaced gap 2026-04-19.
 */
function safeReturnTo(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0) return '/';
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/';
  return raw;
}

interface SsoParams {
  pluginId: string;
}

export async function authRoutes(
  server: FastifyInstance,
  config: DashboardConfig,
  authService: AuthService,
  storage?: StorageAdapter,
): Promise<void> {
  // GET /login — render login page with mode-aware UI
  server.get('/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = request.session as { get(key: string): unknown };
    const query = request.query as Record<string, string | undefined>;
    const returnTo = safeReturnTo(query['returnTo']);

    // If already authenticated, honor returnTo (so /oauth/authorize?...
    // survives the "am I logged in?" shortcut — the user pasted an OAuth
    // consent URL while already signed in on the dashboard).
    if (typeof session.get === 'function') {
      const userId = session.get('userId') as string | undefined;
      if (userId !== undefined) {
        await reply.redirect(returnTo);
        return;
      }
    }

    const mode = authService.getAuthMode();
    const loginMethods = authService.getLoginMethods();

    // Show session expired message if redirected from expiry hook
    const sessionExpired = query['expired'] === '1';

    return reply.view('login.hbs', {
      mode,
      loginMethods,
      returnTo,
      ...(sessionExpired ? { error: 'Your session has expired. Please log in again.' } : {}),
    });
  });

  // POST /login — authenticate based on auth mode
  server.post(
    '/login',
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as LoginBody;
      const mode = authService.getAuthMode();

      // ── API key login (available in all modes) ─────────────────────────
      if (typeof body.apiKey === 'string' && body.apiKey.trim() !== '') {
        const valid = authService.validateApiKey(body.apiKey.trim());

        if (!valid) {
          void storage?.audit.log({ actor: 'unknown', action: 'login.failure', resourceType: 'session', details: 'Invalid API key', ipAddress: request.ip });
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

        void storage?.audit.log({ actor: 'admin', actorId: 'api-key', action: 'login.success', resourceType: 'session', details: 'API key login', ipAddress: request.ip });
        await reply.redirect(safeReturnTo(body.returnTo));
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

          void storage?.audit.log({ actor: displayUsername, actorId: userId, action: 'login.success', resourceType: 'session', details: 'OAuth login', ipAddress: request.ip });
          await reply.redirect(safeReturnTo(body.returnTo));
          return;
        } catch {
          // Fall through to local password login
        }
      }

      // Local password login
      const result = await authService.loginWithPassword(username.trim(), password);

      if (!result.authenticated) {
        void storage?.audit.log({ actor: username.trim(), action: 'login.failure', resourceType: 'session', details: result.error ?? 'Invalid credentials', ipAddress: request.ip });
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

      void storage?.audit.log({ actor: result.user!.username, actorId: result.user!.id, action: 'login.success', resourceType: 'session', details: 'Password login', ipAddress: request.ip });
      await reply.redirect(safeReturnTo(body.returnTo));
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

      // Match by plugin name or fall back to first available
      const plugin = authPlugins.find((p) => p.manifest.name === pluginId) ?? authPlugins[0];

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

    if (storage === undefined || !canChangePassword) {
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

    const valid = await storage.users.verifyPassword(username, body.currentPassword);
    if (!valid) {
      return reply.view('account/profile.hbs', { ...viewData, pwError: 'Current password is incorrect.' });
    }

    try {
      await storage.users.updatePassword(userId, body.newPassword);
      return reply.view('account/profile.hbs', { ...viewData, pwSuccess: 'Password changed successfully.' });
    } catch (err) {
      request.log.error(err, 'Password change failed');
      return reply.view('account/profile.hbs', { ...viewData, pwError: 'Failed to change password. Please try again.' });
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
    // Validate referer to prevent open redirect — only allow same-origin paths
    const referer = request.headers.referer ?? '/';
    let redirectTo = '/';
    try {
      const url = new URL(referer);
      const host = request.headers.host ?? '';
      if (url.host === host) {
        redirectTo = url.pathname + url.search;
      }
    } catch {
      // Invalid URL — use root
    }
    await reply.redirect(redirectTo);
  });

  // POST /logout — clear session and redirect
  server.post('/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    request.session.delete();
    await reply.redirect('/login');
  });

  // ── POST /session/switch-org ────────────────────────────────────────────
  // Phase 31.2 D-05 — switch active org for the OAuth consent flow and
  // redirect to the original /oauth/authorize?... URL.
  //
  // Semantically equivalent to POST /orgs/switch (routes/orgs.ts) but accepts
  // the returnTo target in the POST body (open-redirect-safe via
  // safeReturnTo) rather than sniffing the referer header, because the OAuth
  // consent view supplies the exact `/oauth/authorize?...` URL it wants to
  // resume. The two routes coexist by design:
  //   - /orgs/switch        — nav-dropdown flow (referer-based redirect).
  //   - /session/switch-org — OAuth consent flow (body-based returnTo).
  //
  // CSRF is enforced by the dashboard-wide @fastify/csrf-protection
  // preHandler bound globally in server.ts (line 797-808) — missing or
  // invalid tokens are rejected with 403 BEFORE this handler runs.
  server.post('/session/switch-org', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user;
    if (user === undefined) {
      await reply.code(401).send({ error: 'Authentication required' });
      return;
    }
    if (storage === undefined) {
      await reply.code(503).send({ error: 'Storage adapter not available' });
      return;
    }

    const body = (request.body ?? {}) as { orgId?: string; returnTo?: string };
    const orgId = typeof body.orgId === 'string' ? body.orgId.trim() : '';
    if (orgId === '') {
      // D-05 always carries an orgId from the consent form; empty body is
      // either a bug or an attempted direct-API call. Either way, 400.
      await reply
        .code(400)
        .send({ error: 'invalid_request', error_description: 'orgId is required' });
      return;
    }

    // T-31.2-02-04: membership validation BEFORE any session mutation.
    // Mirrors POST /orgs/switch (orgs.ts line 39).
    const userOrgs = await storage.organizations.getUserOrgs(user.id);
    const belongsToOrg = userOrgs.some((org) => org.id === orgId);
    if (!belongsToOrg) {
      await reply
        .code(403)
        .send({ error: 'You do not have access to this organization' });
      return;
    }

    // Membership valid → mutate session and redirect.
    const session = request.session as { set(key: string, value: unknown): void };
    session.set('currentOrgId', orgId);

    // T-31.2-02-09: open-redirect-safe — safeReturnTo rejects cross-origin
    // and protocol-relative targets, falling back to '/'.
    await reply.redirect(safeReturnTo(body.returnTo));
  });
}
