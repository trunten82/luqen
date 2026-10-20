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
 * HARD-21: consent acts in the organization the request acts in
 * (request.user.currentOrgId, resolved for every request by the org-context
 * preHandler from the user's own organizations; 'system' when there is none):
 * the mcp.use check, the organization the page names and the organization the
 * code (and so the token) carries are that one. The switch offer lists only
 * organizations the user belongs to (getUserOrgs, the predicate of the
 * org-switch routes). Only a stored dashboard user can consent: a session
 * principal without a dashboard_users row is answered 403 access_denied
 * (dashboard_user_required) before anything is rendered or written.
 *
 * The consent page binds the approval to the organization it names: it carries a hidden
 * `consent_binding`, an HMAC (per-process random key) over the signed-in user's id and the named
 * organization. The approval recomputes it from the request's own user and organization and compares
 * it; a missing or different value (the organization changed in another tab, the user left the named
 * organization, an altered field) is answered 400 invalid_request / organization_changed before
 * anything is written. The posted value is only compared; the organization is never read from the form.
 * The key lives in this process only, so a restart invalidates open consent pages.
 *
 * Invariant: NEVER insert into `oauth_authorization_codes` without having
 * passed every check first. The Allow branch is the only code path that
 * writes to that table — the Deny, CSRF-fail, scope-fail, redirect-uri-fail,
 * and admin.system-gate paths all return before any write.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Type } from '@sinclair/typebox';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ErrorEnvelope } from '../../api/schemas/envelope.js';
import type { StorageAdapter } from '../../db/adapter.js';
import { resolveEffectivePermissions } from '../../permissions.js';

// GET /oauth/authorize querystring (OAuth 2.1 / RFC 6749 §4.1.1 + PKCE).
// additionalProperties:true keeps the schema tolerant of extension parameters
// that some MCP clients pass through (e.g. `prompt`, `nonce`).
const AuthorizeQuerySchema = Type.Object(
  {
    response_type: Type.Optional(Type.String()),
    client_id: Type.Optional(Type.String()),
    redirect_uri: Type.Optional(Type.String()),
    scope: Type.Optional(Type.String()),
    resource: Type.Optional(Type.String()),
    code_challenge: Type.Optional(Type.String()),
    code_challenge_method: Type.Optional(Type.String()),
    state: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

// POST /oauth/authorize/consent body. Matches the hidden-form-input contract
// rendered by the consent template plus the CSRF token field. Loose because
// the form is also re-used by the switch-org / deny submit paths.
const ConsentBodySchema = Type.Object(
  {
    _csrf: Type.Optional(Type.String()),
    client_id: Type.Optional(Type.String()),
    redirect_uri: Type.Optional(Type.String()),
    scope: Type.Optional(Type.String()),
    resource: Type.Optional(Type.String()),
    state: Type.Optional(Type.String()),
    code_challenge: Type.Optional(Type.String()),
    code_challenge_method: Type.Optional(Type.String()),
    approved: Type.Optional(Type.String()),
    consent_binding: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

// Phase 31.2 D-10: admin.* scopes retired from OAuth. Admin tool visibility
// now comes exclusively from the user's real RBAC via filterToolsByRbac
// (Plan 03), not from a broad scope bundle. Clients requesting admin.*
// scopes receive invalid_scope 400. Existing tokens carrying admin.*
// scopes continue to verify (no forced re-auth) — RS verifier unchanged,
// scope-filter admin.* rule becomes a no-op (Plan 03 D-14).
const VALID_SCOPES = new Set(['read', 'write']);

const SCOPE_DESCRIPTIONS: Record<string, string> = {
  read: 'Read scan reports, brand scores, and similar view-only data',
  write: 'Trigger scans and make writes such as creating guidelines or running rescans',
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
  readonly consent_binding?: string;
}

function splitSpace(value: string | undefined): readonly string[] {
  if (value === undefined || value.length === 0) return [];
  return value.split(/\s+/).filter((s) => s.length > 0);
}

function validScopes(scopes: readonly string[]): boolean {
  return scopes.every((s) => VALID_SCOPES.has(s));
}

/**
 * Phase 31.2 D-12: post-admin.* retirement, every valid scope is grantable
 * to any mcp.use-holding user. partitionScopes is retained only so the
 * existing call sites stay simple; `skipped` is always empty. The gate that
 * blocks unauthorised MCP connections now lives above this function — in
 * the mcp.use check (D-06) — rather than inside scope partitioning.
 */
function partitionScopes(
  requested: readonly string[],
): { granted: readonly string[]; skipped: readonly string[] } {
  return { granted: requested, skipped: [] };
}

/** The organization the request acts in (the org-context preHandler's resolution), or 'system'. */
function requestOrgId(request: FastifyRequest): string {
  const orgId = request.user?.currentOrgId;
  return typeof orgId === 'string' && orgId.length > 0 ? orgId : 'system';
}

/** The binding of (user, named organization) under `key`, base64url. */
function consentBinding(key: Buffer, userId: string, orgId: string): string {
  return createHmac('sha256', key).update(`${userId}\0${orgId}`).digest('base64url');
}

/** True when `posted` is the binding of (user, organization) under `key` (constant-time comparison). */
function bindingMatches(key: Buffer, userId: string, orgId: string, posted: string | undefined): boolean {
  if (typeof posted !== 'string' || posted.length === 0) return false;
  const expected = Buffer.from(consentBinding(key, userId, orgId));
  const received = Buffer.from(posted);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

const ORGANIZATION_CHANGED = { error: 'invalid_request', error_description: 'organization_changed' } as const;

/** The name the consent page shows for `orgId` ('system' as itself). */
async function orgDisplayName(storage: StorageAdapter, orgId: string): Promise<string> {
  if (orgId === 'system') return orgId;
  const org = await storage.organizations.getOrg(orgId);
  return org?.name ?? orgId;
}

/** True when the request's principal is a stored dashboard user (an API-key session is not). */
async function isStoredDashboardUser(storage: StorageAdapter, userId: string): Promise<boolean> {
  return (await storage.users.getUserById(userId)) !== null;
}

const DASHBOARD_USER_REQUIRED = { error: 'access_denied', error_description: 'dashboard_user_required' } as const;

export async function registerAuthorizeRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
): Promise<void> {
  const bindingKey = randomBytes(32);

  // ── GET /oauth/authorize ──────────────────────────────────────────────────
  server.get('/oauth/authorize', {
    schema: {
      tags: ['oauth'],
      querystring: AuthorizeQuerySchema,
      response: {
        // 200 = consent screen (HTML). 302 = redirect (login OR client redirect_uri).
        // 4xx = JSON error envelope (RFC 6749 §4.1.2.1 — invalid_request etc.).
        200: Type.String(),
        302: Type.Null(),
        400: ErrorEnvelope,
        401: ErrorEnvelope,
        403: ErrorEnvelope,
      },
      produces: ['text/html', 'application/json'],
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    // 1. Session-auth gate. The global auth guard in server.ts already redirects
    //    unauthenticated requests to /login, but this route may be registered
    //    in isolated test harnesses so we also check here.
    if (request.user === undefined) {
      const originalUrl = request.url;
      return reply.redirect(`/login?redirect=${encodeURIComponent(originalUrl)}`, 302);
    }
    if (!(await isStoredDashboardUser(storage, request.user.id))) {
      return reply.status(403).send(DASHBOARD_USER_REQUIRED);
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

    // 8. Phase 31.2 D-06: mcp.use gate — opening an MCP connection requires
    // mcp.use in the active org, with admin.system (user.role === 'admin')
    // as a global bypass (D-02). The gate lands immediately after the session
    // + scope validation checks and BEFORE any consent-screen rendering, so
    // a user without mcp.use NEVER sees a live consent form for an MCP client.
    const user = request.user;
    const orgId = requestOrgId(request);
    const perms = await resolveEffectivePermissions(storage.roles, user.id, user.role, orgId);

    const isSystemAdmin = user.role === 'admin';
    if (!isSystemAdmin && !perms.has('mcp.use')) {
      // D-05: if the user has mcp.use in SOME other org, offer a Switch CTA.
      // Empty array → the hbs template renders the "ask your admin" card.
      const switchableOrgs = await listOrgsWithMcpUse(storage, user.id, user.role, orgId);
      return reply.view('oauth-consent', {
        noMcpUse: true,
        switchableOrgs,
        activeOrgId: orgId,
        activeOrgName: await orgDisplayName(storage, orgId),
        client,
        user,
        // Preserve the original URL so the switch-org POST can redirect back.
        returnTo: request.url,
        // Carry a CSRF token so the Switch form can POST to /session/switch-org.
        csrfToken: reply.generateCsrf(),
      });
    }

    // 9. Phase 31.2 D-12: with admin.* retired, partitionScopes just forwards
    // the requested scopes. Retained for symmetry with the POST handler and
    // so the view contract (scopeDescriptions/skippedScopeDescriptions) is
    // preserved byte-identically for the mcp.use-holding path.
    const { granted: grantedScopes, skipped: skippedScopes } = partitionScopes(requestedScopes);

    // 10. Consent coverage (D-20) — auto-approve if already consented.
    const coverage = await storage.oauthConsents.checkCoverage({
      userId: user.id,
      clientId: client.clientId,
      orgId,
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

    // 11. Render consent screen.
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
      orgName: await orgDisplayName(storage, orgId),
      clientId: client.clientId,
      redirectUri: q.redirect_uri,
      // Phase 31.2 D-12: grantedScopes === requestedScopes (partitionScopes
      // is a pass-through after admin.* retirement). Field name retained so
      // the hidden form input contract with POST /consent stays byte-stable.
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
      consentBinding: consentBinding(bindingKey, user.id, orgId),
    });
  });

  // ── POST /oauth/authorize/consent ─────────────────────────────────────────
  // Order of checks (see plan Task 2 Step 2):
  //   1. CSRF token (@fastify/csrf-protection)
  //   2. redirect_uri re-validation  ← T-31.1-02-03 defense-in-depth
  //   3. scope whitelist re-validation
  //   4. PKCE re-validation
  //   5. mcp.use gate re-apply, then the consent binding (organization named by the page)
  //   6. approved branching
  server.post('/oauth/authorize/consent', {
    schema: {
      tags: ['oauth'],
      body: ConsentBodySchema,
      response: {
        // 302 = redirect to client redirect_uri (allow OR deny). 4xx = JSON error.
        302: Type.Null(),
        400: ErrorEnvelope,
        401: ErrorEnvelope,
        403: ErrorEnvelope,
      },
    },
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
    if (!(await isStoredDashboardUser(storage, request.user.id))) {
      return reply.status(403).send(DASHBOARD_USER_REQUIRED);
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

    // 5. Phase 31.2 D-06 defense-in-depth: re-enforce the mcp.use gate server-
    //    side on POST (T-31.1-02-04). Even if a tampered form bypassed the
    //    GET-time check, the server re-resolves perms for the user's active
    //    org and rejects with 403 if mcp.use is missing (admin.system bypass
    //    preserved via user.role === 'admin'). No code row is written.
    const user = request.user;
    const orgId = requestOrgId(request);
    const perms = await resolveEffectivePermissions(storage.roles, user.id, user.role, orgId);
    if (user.role !== 'admin' && !perms.has('mcp.use')) {
      return reply.status(403).send({
        error: 'access_denied',
        error_description: 'mcp.use permission required in active org',
      });
    }

    // 5a. The approval acts in the organization its page named: the page's binding of (user,
    //     organization) is recomputed from this request and compared before anything is written.
    if (!bindingMatches(bindingKey, user.id, orgId, body.consent_binding)) {
      return reply.status(400).send(ORGANIZATION_CHANGED);
    }

    // 6. Phase 31.2 D-12: partitionScopes is now a no-op forwarder — every
    //    whitelisted scope is grantable to any mcp.use holder. Kept so the
    //    call site's `grantedScopes` variable still tracks what is about to
    //    be written to the consent + code rows.
    const { granted: grantedScopes } = partitionScopes(requestedScopes);

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
      orgId,
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

/**
 * Phase 31.2 D-05 helper: list the organizations (excluding the active one and
 * 'system') the user can switch to AND holds `mcp.use` in. Used to render the
 * switch-org CTA on the consent screen. Empty array → render "ask your
 * admin" card with no switch button.
 *
 * The candidates are getUserOrgs (org_members plus the organizations of the
 * user's teams), the predicate POST /session/switch-org and POST /orgs/switch
 * accept, so every offer can be taken; the permission check resolves the
 * user's stored role in each one (resolveEffectivePermissions). No other
 * organization's name or id is projected (T-31.2-02-02).
 */
async function listOrgsWithMcpUse(
  storage: StorageAdapter,
  userId: string,
  userRole: string,
  activeOrgId: string,
): Promise<ReadonlyArray<{ readonly id: string; readonly name: string }>> {
  const orgs = await storage.organizations.getUserOrgs(userId);
  const matches: Array<{ id: string; name: string }> = [];
  for (const org of orgs) {
    if (org.id === activeOrgId || org.id === 'system') continue;
    const perms = await resolveEffectivePermissions(storage.roles, userId, userRole, org.id);
    if (perms.has('mcp.use')) matches.push({ id: org.id, name: org.name });
  }
  return matches;
}
