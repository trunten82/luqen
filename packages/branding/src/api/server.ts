import Fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { SqliteAdapter } from '../db/sqlite-adapter.js';
import type { TokenSigner, TokenVerifier } from '../auth/oauth.js';
import { createAuthMiddleware, requireScope } from '../auth/middleware.js';
import { createJwksTokenVerifier, verifyClientSecret } from '../auth/oauth.js';
import { BrandingMatcher } from '../matcher/index.js';
import { GuidelineParser } from '../parser/index.js';
import { VERSION } from '../version.js';
import type { MatchableIssue, BrandColor, BrandFont, BrandSelector } from '../types.js';
import { registerMcpRoutes } from './routes/mcp.js';
import { registerBrandingProtectedResourceMetadata } from './routes/well-known.js';

export interface ServerOptions {
  readonly db: SqliteAdapter;
  readonly signToken: TokenSigner;
  readonly verifyToken: TokenVerifier;
  readonly tokenExpiry: string;
  readonly corsOrigins?: readonly string[];
  readonly rateLimitRead?: number;
  readonly rateLimitWrite?: number;
  readonly rateLimitWindowMs?: number;
  readonly logger?: boolean;
}

export async function createServer(options: ServerOptions): Promise<FastifyInstance> {
  const {
    db,
    signToken,
    verifyToken,
    tokenExpiry,
    corsOrigins = ['*'],
    rateLimitRead = 100,
    rateLimitWindowMs = 60000,
    logger = false,
  } = options;

  const app = Fastify({ logger, bodyLimit: 5 * 1024 * 1024 });

  // CORS
  await app.register(cors, {
    origin: corsOrigins.length === 1 && corsOrigins[0] === '*' ? true : [...corsOrigins],
    credentials: true,
  });

  // Rate limiting
  await app.register(rateLimit, {
    max: rateLimitRead,
    timeWindow: rateLimitWindowMs,
    errorResponseBuilder: (_request, context) => ({
      error: 'Too Many Requests',
      statusCode: 429,
      message: `Rate limit exceeded. Try again in ${Math.ceil(context.ttl / 1000)} seconds.`,
    }),
  });

  // Swagger / OpenAPI
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Luqen Branding Service',
        description: 'Brand guideline matching for accessibility findings — map colors, fonts and selectors to your organisation guidelines',
        version: VERSION,
      },
      servers: [{ url: 'http://localhost:4100' }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/api/v1/docs',
    uiConfig: { docExpansion: 'list' },
  });

  // Auth middleware
  const authMiddleware = createAuthMiddleware(verifyToken);
  app.addHook('preHandler', authMiddleware);

  // Decorate request with orgId + authType
  app.decorateRequest('orgId', 'system');
  app.decorateRequest('authType', '');
  app.addHook('preHandler', async (request) => {
    const authType = (request as unknown as { authType: string }).authType;
    if (authType !== 'apikey') return;
    const headerVal = request.headers['x-org-id'];
    if (typeof headerVal === 'string' && headerVal.length > 0) {
      (request as unknown as { orgId: string }).orgId = headerVal;
    }
  });

  // Initialize DB
  await db.initialize();

  // OpenAPI JSON alias
  app.get('/api/v1/openapi.json', async (_request, reply) => {
    await reply.redirect('/api/v1/docs/json');
  });

  // ---------------------------------------------------------------------------
  // Health
  // ---------------------------------------------------------------------------

  app.get('/api/v1/health', {
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            version: { type: 'string' },
            timestamp: { type: 'string' },
          },
        },
      },
    },
  }, async (_request, reply) => {
    await reply.status(200).send({
      status: 'ok',
      version: VERSION,
      timestamp: new Date().toISOString(),
    });
  });

  // Phase 31.1 Plan 03 Task 3: RFC 9728 Resource Server metadata (public).
  await registerBrandingProtectedResourceMetadata(app);

  // ---------------------------------------------------------------------------
  // OAuth token endpoint
  // ---------------------------------------------------------------------------

  app.post('/api/v1/oauth/token', async (request, reply) => {
    try {
      const body = request.body as Record<string, unknown>;

      let clientId: string | undefined;
      let clientSecret: string | undefined;
      let grantType: string | undefined;
      let requestedScopes: string[] = [];

      // Check Basic auth header
      const authHeader = request.headers.authorization;
      if (authHeader != null && authHeader.startsWith('Basic ')) {
        const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8');
        const colonIdx = decoded.indexOf(':');
        if (colonIdx !== -1) {
          clientId = decoded.slice(0, colonIdx);
          clientSecret = decoded.slice(colonIdx + 1);
        }
      }

      // Body params override Basic auth
      if (body.client_id != null) clientId = String(body.client_id);
      if (body.client_secret != null) clientSecret = String(body.client_secret);
      if (body.grant_type != null) grantType = String(body.grant_type);
      if (body.scope != null) {
        requestedScopes = String(body.scope).split(' ').filter(Boolean);
      }

      if (grantType !== 'client_credentials') {
        await reply.status(400).send({
          error: 'unsupported_grant_type',
          statusCode: 400,
        });
        return;
      }

      if (clientId == null || clientSecret == null) {
        await reply.status(400).send({
          error: 'invalid_request: client_id and client_secret are required',
          statusCode: 400,
        });
        return;
      }

      const client = await db.getClientById(clientId);
      if (client == null) {
        await reply.status(401).send({ error: 'invalid_client', statusCode: 401 });
        return;
      }

      const valid = await verifyClientSecret(clientSecret, client.secretHash);
      if (!valid) {
        await reply.status(401).send({ error: 'invalid_client', statusCode: 401 });
        return;
      }

      // Intersect requested scopes with client scopes
      let grantedScopes: string[];
      if (requestedScopes.length > 0) {
        grantedScopes = requestedScopes.filter(s => client.scopes.includes(s));
        if (grantedScopes.length === 0) {
          await reply.status(400).send({ error: 'invalid_scope', statusCode: 400 });
          return;
        }
      } else {
        grantedScopes = [...client.scopes];
      }

      const accessToken = await signToken({
        sub: clientId,
        scopes: grantedScopes,
        expiresIn: tokenExpiry,
        ...(client.orgId !== 'system' ? { orgId: client.orgId } : {}),
      });

      const expiresIn = tokenExpiry.endsWith('h')
        ? parseInt(tokenExpiry) * 3600
        : tokenExpiry.endsWith('m')
        ? parseInt(tokenExpiry) * 60
        : parseInt(tokenExpiry);

      await reply.status(200).send({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: expiresIn,
        scope: grantedScopes.join(' '),
      });
    } catch {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });

  // ---------------------------------------------------------------------------
  // Templates
  // ---------------------------------------------------------------------------

  app.get('/api/v1/templates/csv', async (_request, reply) => {
    const csv = GuidelineParser.generateCSVTemplate();
    await reply
      .header('Content-Type', 'text/csv')
      .header('Content-Disposition', 'attachment; filename="brand-guideline-template.csv"')
      .send(csv);
  });

  app.get('/api/v1/templates/json', async (_request, reply) => {
    const json = GuidelineParser.generateJSONTemplate();
    await reply
      .header('Content-Type', 'application/json')
      .header('Content-Disposition', 'attachment; filename="brand-guideline-template.json"')
      .send(json);
  });

  // ---------------------------------------------------------------------------
  // Guidelines CRUD
  // ---------------------------------------------------------------------------

  const writeScope = requireScope('write');

  app.get('/api/v1/guidelines', async (request, reply) => {
    const orgId = (request as FastifyRequest & { orgId: string }).orgId;
    const guidelines = db.listGuidelines(orgId);
    await reply.status(200).send({ data: guidelines });
  });

  app.get<{ Params: { id: string } }>('/api/v1/guidelines/:id', async (request, reply) => {
    const guideline = db.getGuideline(request.params.id);
    if (guideline == null) {
      await reply.status(404).send({ error: 'Guideline not found', statusCode: 404 });
      return;
    }
    await reply.status(200).send({ data: guideline });
  });

  app.post('/api/v1/guidelines', { preHandler: [writeScope] }, async (request, reply) => {
    const orgId = (request as FastifyRequest & { orgId: string }).orgId;
    const body = request.body as Record<string, unknown>;
    const name = String(body.name ?? '');
    if (name.length === 0) {
      await reply.status(400).send({ error: 'name is required', statusCode: 400 });
      return;
    }
    const guideline = db.createGuideline({
      name,
      orgId,
      description: body.description != null ? String(body.description) : undefined,
      createdBy: body.createdBy != null ? String(body.createdBy) : undefined,
    });
    await reply.status(201).send({ data: guideline });
  });

  app.put<{ Params: { id: string } }>('/api/v1/guidelines/:id', { preHandler: [writeScope] }, async (request, reply) => {
    const existing = db.getGuideline(request.params.id);
    if (existing == null) {
      await reply.status(404).send({ error: 'Guideline not found', statusCode: 404 });
      return;
    }
    const body = request.body as Record<string, unknown>;
    const updates: Record<string, unknown> = {};
    if (body.name != null) updates.name = String(body.name);
    if (body.description !== undefined) updates.description = body.description != null ? String(body.description) : undefined;
    if (body.active != null) updates.active = Boolean(body.active);
    db.updateGuideline(request.params.id, updates);
    const updated = db.getGuideline(request.params.id);
    await reply.status(200).send({ data: updated });
  });

  app.delete<{ Params: { id: string } }>('/api/v1/guidelines/:id', { preHandler: [writeScope] }, async (request, reply) => {
    const existing = db.getGuideline(request.params.id);
    if (existing == null) {
      await reply.status(404).send({ error: 'Guideline not found', statusCode: 404 });
      return;
    }
    db.removeGuideline(request.params.id);
    await reply.status(204).send();
  });

  // ---------------------------------------------------------------------------
  // Colors
  // ---------------------------------------------------------------------------

  app.post<{ Params: { id: string } }>('/api/v1/guidelines/:id/colors', { preHandler: [writeScope] }, async (request, reply) => {
    const guideline = db.getGuideline(request.params.id);
    if (guideline == null) {
      await reply.status(404).send({ error: 'Guideline not found', statusCode: 404 });
      return;
    }
    const body = request.body as Record<string, unknown>;
    const color = db.addColor(request.params.id, {
      name: String(body.name ?? ''),
      hexValue: String(body.hexValue ?? ''),
      usage: body.usage != null ? String(body.usage) as BrandColor['usage'] : undefined,
      context: body.context != null ? String(body.context) : undefined,
    });
    await reply.status(201).send({ data: color });
  });

  app.delete<{ Params: { id: string; colorId: string } }>('/api/v1/guidelines/:id/colors/:colorId', { preHandler: [writeScope] }, async (request, reply) => {
    db.removeColor(request.params.colorId);
    await reply.status(204).send();
  });

  // ---------------------------------------------------------------------------
  // Fonts
  // ---------------------------------------------------------------------------

  app.post<{ Params: { id: string } }>('/api/v1/guidelines/:id/fonts', { preHandler: [writeScope] }, async (request, reply) => {
    const guideline = db.getGuideline(request.params.id);
    if (guideline == null) {
      await reply.status(404).send({ error: 'Guideline not found', statusCode: 404 });
      return;
    }
    const body = request.body as Record<string, unknown>;
    const font = db.addFont(request.params.id, {
      family: String(body.family ?? ''),
      weights: Array.isArray(body.weights) ? body.weights.map(String) : undefined,
      usage: body.usage != null ? String(body.usage) as BrandFont['usage'] : undefined,
      context: body.context != null ? String(body.context) : undefined,
    });
    await reply.status(201).send({ data: font });
  });

  app.delete<{ Params: { id: string; fontId: string } }>('/api/v1/guidelines/:id/fonts/:fontId', { preHandler: [writeScope] }, async (request, reply) => {
    db.removeFont(request.params.fontId);
    await reply.status(204).send();
  });

  // ---------------------------------------------------------------------------
  // Selectors
  // ---------------------------------------------------------------------------

  app.post<{ Params: { id: string } }>('/api/v1/guidelines/:id/selectors', { preHandler: [writeScope] }, async (request, reply) => {
    const guideline = db.getGuideline(request.params.id);
    if (guideline == null) {
      await reply.status(404).send({ error: 'Guideline not found', statusCode: 404 });
      return;
    }
    const body = request.body as Record<string, unknown>;
    const selector = db.addSelector(request.params.id, {
      pattern: String(body.pattern ?? ''),
      description: body.description != null ? String(body.description) : undefined,
    });
    await reply.status(201).send({ data: selector });
  });

  app.delete<{ Params: { id: string; selectorId: string } }>('/api/v1/guidelines/:id/selectors/:selectorId', { preHandler: [writeScope] }, async (request, reply) => {
    db.removeSelector(request.params.selectorId);
    await reply.status(204).send();
  });

  // ---------------------------------------------------------------------------
  // Site assignments
  // ---------------------------------------------------------------------------

  app.post<{ Params: { id: string } }>('/api/v1/guidelines/:id/sites', { preHandler: [writeScope] }, async (request, reply) => {
    const guideline = db.getGuideline(request.params.id);
    if (guideline == null) {
      await reply.status(404).send({ error: 'Guideline not found', statusCode: 404 });
      return;
    }
    const orgId = (request as FastifyRequest & { orgId: string }).orgId;
    const body = request.body as Record<string, unknown>;
    const siteUrl = String(body.siteUrl ?? '');
    if (siteUrl.length === 0) {
      await reply.status(400).send({ error: 'siteUrl is required', statusCode: 400 });
      return;
    }
    db.assignToSite(request.params.id, siteUrl, orgId);
    await reply.status(201).send({ data: { guidelineId: request.params.id, siteUrl, orgId } });
  });

  app.delete<{ Params: { id: string } }>('/api/v1/guidelines/:id/sites', { preHandler: [writeScope] }, async (request, reply) => {
    const orgId = (request as FastifyRequest & { orgId: string }).orgId;
    const body = request.body as Record<string, unknown>;
    const siteUrl = String(body.siteUrl ?? '');
    if (siteUrl.length === 0) {
      await reply.status(400).send({ error: 'siteUrl is required', statusCode: 400 });
      return;
    }
    db.unassignFromSite(siteUrl, orgId);
    await reply.status(204).send();
  });

  app.get<{ Params: { id: string } }>('/api/v1/guidelines/:id/sites', async (request, reply) => {
    const guideline = db.getGuideline(request.params.id);
    if (guideline == null) {
      await reply.status(404).send({ error: 'Guideline not found', statusCode: 404 });
      return;
    }
    const sites = db.getSiteAssignments(request.params.id);
    await reply.status(200).send({ data: sites });
  });

  // ---------------------------------------------------------------------------
  // OAuth client management
  // ---------------------------------------------------------------------------

  const adminScope = requireScope('admin');

  app.get('/api/v1/clients', { preHandler: [adminScope] }, async (request, reply) => {
    try {
      const orgId = (request as FastifyRequest & { orgId: string }).orgId;
      const clients = await db.listClients(orgId === 'system' ? undefined : orgId);
      const safeClients = clients.map(({ secretHash: _sh, ...rest }) => rest);
      await reply.send(safeClients);
    } catch {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });

  app.post('/api/v1/clients', { preHandler: [adminScope] }, async (request, reply) => {
    try {
      const body = request.body as Record<string, unknown>;
      if (!body.name || !Array.isArray(body.scopes) || !Array.isArray(body.grantTypes)) {
        await reply.status(400).send({
          error: 'name, scopes, and grantTypes are required',
          statusCode: 400,
        });
        return;
      }
      const client = await db.createClient({
        name: body.name as string,
        scopes: body.scopes as string[],
        grantTypes: body.grantTypes as string[],
        orgId: typeof body.orgId === 'string' ? body.orgId : 'system',
      });
      const { secretHash: _sh, ...safeClient } = client;
      await reply.status(201).send({ data: safeClient });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bad request';
      await reply.status(400).send({ error: message, statusCode: 400 });
    }
  });

  app.post<{ Params: { id: string } }>('/api/v1/clients/:id/revoke', { preHandler: [adminScope] }, async (request, reply) => {
    try {
      const { id } = request.params;
      const requestOrgId = (request as FastifyRequest & { orgId: string }).orgId;
      const recordOrgId = await db.getClientOrgId(id);

      if (recordOrgId == null) {
        await reply.status(404).send({ error: 'Client not found', statusCode: 404 });
        return;
      }

      if (recordOrgId === 'system' && requestOrgId !== 'system') {
        await reply.status(403).send({ error: 'Cannot revoke system client', statusCode: 403 });
        return;
      }

      if (requestOrgId !== 'system' && recordOrgId !== 'system' && recordOrgId !== requestOrgId) {
        await reply.status(403).send({ error: 'Cannot revoke client belonging to another organisation', statusCode: 403 });
        return;
      }

      await db.deleteClient(id);
      await reply.status(204).send();
    } catch {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });

  // ---------------------------------------------------------------------------
  // Match endpoint
  // ---------------------------------------------------------------------------

  app.post('/api/v1/match', async (request, reply) => {
    const orgId = (request as FastifyRequest & { orgId: string }).orgId;
    const body = request.body as Record<string, unknown>;

    const issues = body.issues as MatchableIssue[] | undefined;
    if (!Array.isArray(issues) || issues.length === 0) {
      await reply.status(400).send({ error: 'issues array is required', statusCode: 400 });
      return;
    }

    const siteUrl = body.siteUrl != null ? String(body.siteUrl) : undefined;
    const guidelineId = body.guidelineId != null ? String(body.guidelineId) : undefined;
    const requestOrgId = body.orgId != null ? String(body.orgId) : orgId;

    const matcher = new BrandingMatcher();

    // Resolve guideline: explicit guidelineId > site assignment lookup
    let guideline = guidelineId != null ? db.getGuideline(guidelineId) : null;
    if (guideline == null && siteUrl != null) {
      guideline = db.getGuidelineForSite(siteUrl, requestOrgId);
    }

    if (guideline == null || !guideline.active) {
      await reply.status(200).send({
        data: issues.map(issue => ({ issue, brandMatch: { matched: false } })),
        meta: { matched: 0, total: issues.length, guidelineId: null },
      });
      return;
    }

    const branded = matcher.match(issues, guideline);
    const matchedCount = branded.filter(b => b.brandMatch.matched).length;

    await reply.status(200).send({
      data: branded,
      meta: {
        matched: matchedCount,
        total: issues.length,
        guidelineId: guideline.id,
        guidelineName: guideline.name,
      },
    });
  });

  // Phase 31.1 Plan 03 (D-33/D-04): MCP-facing JWKS verifier with audience
  // enforcement. See compliance/src/api/server.ts for the same pattern.
  //
  // If DASHBOARD_JWKS_URL is explicitly '' (empty) we skip the JWKS verifier
  // and reuse the existing local-signed `verifyToken` for the MCP scoped
  // preHandler — preserves the test harness path where tokens are minted by
  // the same in-memory keypair that validates them. The scoped preHandler is
  // STILL installed; /api/v1/mcp remains in PUBLIC_PATHS of the global
  // middleware and the scoped handler is the sole auth gate either way.
  const dashboardJwksUrl =
    process.env['DASHBOARD_JWKS_URL'] ?? 'http://dashboard.luqen.local/oauth/jwks.json';
  const brandingMcpUrl = `${process.env['BRANDING_PUBLIC_URL'] ?? 'http://localhost:4100'}/api/v1/mcp`;
  const verifyMcpToken: TokenVerifier =
    dashboardJwksUrl.trim().length > 0
      ? await createJwksTokenVerifier(dashboardJwksUrl, brandingMcpUrl)
      : verifyToken;
  await registerMcpRoutes(app, { db, verifyMcpToken });

  return app;
}
