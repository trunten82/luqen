/**
 * OAuth 2.1 Authorization Code + PKCE — Phase 31.1 Plan 02 Task 2.
 *
 * Mounts:
 *   GET  /oauth/authorize          — renders the consent screen or, when a
 *                                    prior consent already covers the request,
 *                                    fast-paths to `?code=…&state=…` redirect.
 *   POST /oauth/authorize/consent  — Allow / Deny submit handler.
 *
 * Defense-in-depth: every check enforced on GET is re-enforced on POST,
 * because `redirect_uri`, `scope`, `resource`, and `code_challenge` all
 * travel through the browser as hidden form inputs an attacker can tamper
 * with (T-31.1-02-03 / T-31.1-02-04 / T-31.1-02-05).
 *
 * Invariant: NEVER insert into `oauth_authorization_codes` without having
 * passed every check first. The Allow branch is the only code path that
 * writes to that table — the Deny, CSRF-fail, scope-fail, redirect-uri-fail,
 * and admin.system-gate paths all return before any write.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomBytes } from 'node:crypto';
import type { StorageAdapter } from '../../db/adapter.js';
import { resolveEffectivePermissions } from '../../permissions.js';

const VALID_SCOPES = new Set(['read', 'write', 'admin.system', 'admin.org', 'admin.users']);

const SCOPE_DESCRIPTIONS: Record<string, string> = {
  read: 'Read scan reports, brand scores, and similar view-only data',
  write: 'Trigger scans and make writes such as creating guidelines or running rescans',
  'admin.system': 'Administer the Luqen system globally',
  'admin.org': "Administer your active org's settings and users",
  'admin.users': 'Manage users within your active org',
};

interface AuthorizeQuery {
  readonly response_type?: string;
  readonly client_id?: string;
  readonly redirect_uri?: string;
  readonly scope?: string;
  readonly resource?: string;
  readonly code_challenge?: string;
  readonly code_challenge_method?: string;
  readonly state?: string;
}

interface ConsentBody {
  readonly _csrf?: string;
  readonly client_id?: string;
  readonly redirect_uri?: string;
  readonly scope?: string;
  readonly resource?: string;
  readonly state?: string;
  readonly code_challenge?: string;
  readonly code_challenge_method?: string;
  readonly approved?: string;
}

function splitSpace(value: string | undefined): readonly string[] {
  if (value === undefined || value.length === 0) return [];
  return value.split(/\s+/).filter((s) => s.length > 0);
}

function validScopes(scopes: readonly string[]): boolean {
  return scopes.every((s) => VALID_SCOPES.has(s));
}

/**
 * Narrow requested scopes to the subset the authenticated user has
 * permission to grant. Admin scopes (admin.system, admin.org, admin.users)
 * require matching RBAC; read/write are always grantable to any logged-in
 * user. Returns { granted, skipped } — the caller decides how to surface
 * skipped scopes (consent note) vs block (nothing left to grant).
 * Smoke-surfaced gap 2026-04-19: previous gate blocked the whole flow on
 * any admin.* scope the user lacked, which broke the Claude Desktop bundle
 * request (read+write+admin.*) for non-system-admin users.
 */
function partitionScopes(
  requested: readonly string[],
  userPermissions: Set<string>,
): { granted: readonly string[]; skipped: readonly string[] } {
  const granted: string[] = [];
  const skipped: string[] = [];
  for (const scope of requested) {
    if (scope.startsWith('admin.')) {
      if (userPermissions.has(scope)) granted.push(scope);
      else skipped.push(scope);
    } else {
      granted.push(scope);
    }
  }
  return { granted, skipped };
}

function sessionOrgId(request: FastifyRequest): string {
  const session = request.session as { get?: (k: string) => unknown } | undefined;
  if (session === undefined || typeof session.get !== 'function') return 'system';
  const orgId = session.get('orgId') ?? session.get('currentOrgId');
  return typeof orgId === 'string' && orgId.length > 0 ? orgId : 'system';
}

export async function registerAuthorizeRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
): Promise<void> {
  // ── GET /oauth/authorize ──────────────────────────────────────────────────
  server.get('/oauth/authorize', async (request: FastifyRequest, reply: FastifyReply) => {
    // 1. Session-auth gate. The global auth guard in server.ts already redirects
    //    unauthenticated requests to /login, but this route may be registered
    //    in isolated test harnesses so we also check here.
    if (request.user === undefined) {
      const originalUrl = request.url;
      return reply.redirect(`/login?redirect=${encodeURIComponent(originalUrl)}`, 302);
    }

    const q = request.query as AuthorizeQuery;

    // 2. response_type must be 'code' (OAuth 2.1 — only Authorization Code flow).
    if (q.response_type !== 'code') {
      return reply.status(400).send({ error: 'unsupported_response_type' });
    }

    // 3. PKCE S256 is REQUIRED (D-31 / D-32).
    if (q.code_challenge_method !== 'S256') {
      return reply.status(400).send({
        error: 'invalid_request',
        error_description: 'code_challenge_method must be S256',
      });
    }
    if (q.code_challenge === undefined || q.code_challenge.length < 43) {
      return reply.status(400).send({
        error: 'invalid_request',
        error_description: 'code_challenge required',
      });
    }

    // 4. Scope whitelist (D-08).
    const requestedScopes = splitSpace(q.scope ?? 'read');
    if (requestedScopes.length === 0 || !validScopes(requestedScopes)) {
      return reply.status(400).send({ error: 'invalid_scope' });
    }

    // 5. Client lookup + revocation check.
    if (q.client_id === undefined) {
      return reply.status(400).send({ error: 'invalid_request', error_description: 'client_id required' });
    }
    const client = await storage.oauthClients.findByClientId(q.client_id);
    if (client === null || client.revokedAt !== null) {
      return reply.status(400).send({ error: 'invalid_client' });
    }

    // 6. redirect_uri exact match (T-31.1-02-03).
    if (q.redirect_uri === undefined || !client.redirectUris.includes(q.redirect_uri)) {
      return reply.status(400).send({
        error: 'invalid_request',
        error_description: 'redirect_uri mismatch',
      });
    }

    // 7. resource parameter (RFC 8707, D-04) — required to bind `aud`.
    const requestedResources = splitSpace(q.resource);
    if (requestedResources.length === 0) {
      return reply.status(400).send({
        error: 'invalid_target',
        error_description: 'at least one resource parameter required',
      });
    }

    // 8. RBAC scope filter (D-09 — relaxed 2026-04-19): admin.* scopes require
    // matching permission. Scopes the user lacks are SILENTLY DROPPED from the
    // grant; only if after filtering NO scopes remain do we block the flow.
    // Previous behavior blocked on any missing admin.* scope, which prevented
    // non-system-admin users from completing consent for Claude Desktop's
    // default bundled-scope request (read+write+admin.*).
    const user = request.user;
    const orgId = sessionOrgId(request);
    const perms = await resolveEffectivePermissions(storage.roles, user.id, user.role, orgId);
    const { granted: grantedScopes, skipped: skippedScopes } = partitionScopes(requestedScopes, perms);
    if (grantedScopes.length === 0) {
      return reply.view('oauth-consent', {
        adminScopeBlocked: true,
        client,
        user,
        skippedScopes,
      });
    }

    // 9. Consent coverage (D-20) — auto-approve if already consented.
    const coverage = await storage.oauthConsents.checkCoverage({
      userId: user.id,
      clientId: client.clientId,
      requestedScopes: grantedScopes,
      requestedResources,
    });

    if (coverage.covered) {
      const code = randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + 60_000).toISOString();
      await storage.oauthCodes.createCode({
        code,
        clientId: client.clientId,
        userId: user.id,
        redirectUri: q.redirect_uri,
        scope: grantedScopes.join(' '),
        resource: requestedResources.join(' '),
        codeChallenge: q.code_challenge,
        codeChallengeMethod: 'S256',
        orgId,
        expiresAt,
      });
      const redirectUrl = new URL(q.redirect_uri);
      redirectUrl.searchParams.set('code', code);
      if (q.state !== undefined) redirectUrl.searchParams.set('state', q.state);
      return reply.redirect(redirectUrl.toString(), 302);
    }

    // 10. Render consent screen.
    // Override the global CSP's `form-action 'self'` for THIS response so the
    // browser permits the consent form POST handler's 302 redirect to the
    // client's registered redirect_uri. CSP form-action applies to the
    // redirect chain from form submissions, not just the direct target —
    // without this override, clicking Allow silently fails when the browser
    // blocks the Location header to a cross-origin URI (e.g. claude.ai).
    // Smoke-surfaced gap 2026-04-19.
    try {
      const redirectOrigin = new URL(q.redirect_uri).origin;
      const consentCsp = [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' cdn.jsdelivr.net static.cloudflareinsights.com",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "connect-src 'self'",
        "font-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        `form-action 'self' ${redirectOrigin}`,
        "frame-ancestors 'none'",
        'upgrade-insecure-requests',
      ].join(';');
      reply.header('Content-Security-Policy', consentCsp);
    } catch {
      // Invalid URL — redirect_uri validation above should have caught this,
      // but if it didn't, leave the default CSP in place.
    }

    const csrfToken = reply.generateCsrf();
    return reply.view('oauth-consent', {
      adminScopeBlocked: false,
      client,
      user,
      orgName: orgId,
      clientId: client.clientId,
      redirectUri: q.redirect_uri,
      // Form submits the NARROWED scope set (admin.* dropped where user lacks perms)
      requestedScope: grantedScopes.join(' '),
      requestedResource: requestedResources.join(' '),
      resources: requestedResources,
      scopeDescriptions: grantedScopes.map((s) => ({
        scope: s,
        description: SCOPE_DESCRIPTIONS[s] ?? s,
      })),
      skippedScopeDescriptions: skippedScopes.map((s) => ({
        scope: s,
        description: SCOPE_DESCRIPTIONS[s] ?? s,
      })),
      state: q.state ?? '',
      codeChallenge: q.code_challenge,
      csrfToken,
    });
  });

  // ── POST /oauth/authorize/consent ─────────────────────────────────────────
  // Order of checks (see plan Task 2 Step 2):
  //   1. CSRF token (@fastify/csrf-protection)
  //   2. redirect_uri re-validation  ← T-31.1-02-03 defense-in-depth
  //   3. scope whitelist re-validation
  //   4. PKCE re-validation
  //   5. admin.system gate re-apply
  //   6. approved branching
  server.post('/oauth/authorize/consent', {
    // CSRF is validated at preHandler (not onRequest) because
    // @fastify/csrf-protection reads `req.body._csrf` and the body is only
    // parsed after preValidation. Matches the dashboard-wide pattern in
    // server.ts (which also registers CSRF as a preHandler hook).
    preHandler: (server as unknown as {
      csrfProtection: (req: FastifyRequest, rep: FastifyReply, done: (err?: Error) => void) => void;
    }).csrfProtection,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.user === undefined) {
      return reply.status(401).send({ error: 'unauthorized' });
    }

    const body = request.body as ConsentBody;

    // 2a. Client lookup + revocation check (cannot redirect anywhere until we know the client).
    if (body.client_id === undefined) {
      return reply.status(400).send({ error: 'invalid_request', error_description: 'client_id required' });
    }
    const client = await storage.oauthClients.findByClientId(body.client_id);
    if (client === null || client.revokedAt !== null) {
      return reply.status(400).send({ error: 'invalid_client' });
    }

    // 2b. redirect_uri re-validation (T-31.1-02-03 — attacker may tamper hidden form input).
    if (body.redirect_uri === undefined || !client.redirectUris.includes(body.redirect_uri)) {
      return reply.status(400).send({
        error: 'invalid_request',
        error_description: 'redirect_uri mismatch',
      });
    }

    // 3. Scope re-validation.
    const requestedScopes = splitSpace(body.scope);
    if (requestedScopes.length === 0 || !validScopes(requestedScopes)) {
      return reply.status(400).send({ error: 'invalid_scope' });
    }

    // 4. PKCE re-validation.
    if (body.code_challenge_method !== 'S256') {
      return reply.status(400).send({
        error: 'invalid_request',
        error_description: 'code_challenge_method must be S256',
      });
    }
    if (body.code_challenge === undefined || body.code_challenge.length < 43) {
      return reply.status(400).send({
        error: 'invalid_request',
        error_description: 'code_challenge required',
      });
    }

    // 5. RBAC scope filter (D-09 — relaxed 2026-04-19) re-enforced on POST
    //    (T-31.1-02-04): server-side drop of admin.* scopes the user lacks.
    //    If GET-time validation was bypassed by tampering with the scope
    //    hidden input, server still refuses to grant a scope the user does
    //    not have. If after filtering NO scopes remain, respond 403.
    const user = request.user;
    const orgId = sessionOrgId(request);
    const perms = await resolveEffectivePermissions(storage.roles, user.id, user.role, orgId);
    const { granted: grantedScopes } = partitionScopes(requestedScopes, perms);
    if (grantedScopes.length === 0) {
      return reply.status(403).send({ error: 'access_denied', error_description: 'no grantable scopes' });
    }

    const requestedResources = splitSpace(body.resource);
    const state = body.state ?? '';

    // 6a. Deny branch.
    if (body.approved !== 'true') {
      const redirectUrl = new URL(body.redirect_uri);
      redirectUrl.searchParams.set('error', 'access_denied');
      if (state.length > 0) redirectUrl.searchParams.set('state', state);
      return reply.redirect(redirectUrl.toString(), 302);
    }

    // 6b. Allow branch.
    if (requestedResources.length === 0) {
      return reply.status(400).send({
        error: 'invalid_target',
        error_description: 'at least one resource parameter required',
      });
    }

    // Phase 31.2 D-18 — first-consent user-link backfill. DCR registrations
    // are pre-auth per RFC 7591 §3; the first user who consents to the client
    // is recorded as the owner for /admin/clients org-scoped visibility
    // (Plan 04 D-19). Later consenting users do NOT overwrite (IS NULL guard
    // inside the repository UPDATE).
    await storage.oauthClients.recordRegistrationUser(client.clientId, user.id);

    await storage.oauthConsents.recordConsent({
      userId: user.id,
      clientId: client.clientId,
      scopes: grantedScopes,
      resources: requestedResources,
    });

    const code = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    await storage.oauthCodes.createCode({
      code,
      clientId: client.clientId,
      userId: user.id,
      redirectUri: body.redirect_uri,
      scope: grantedScopes.join(' '),
      resource: requestedResources.join(' '),
      codeChallenge: body.code_challenge,
      codeChallengeMethod: 'S256',
      orgId,
      expiresAt,
    });

    const redirectUrl = new URL(body.redirect_uri);
    redirectUrl.searchParams.set('code', code);
    if (state.length > 0) redirectUrl.searchParams.set('state', state);
    return reply.redirect(redirectUrl.toString(), 302);
  });
}
