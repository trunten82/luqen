import Fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import rateLimit from '@fastify/rate-limit';
import type { DbAdapter } from '../db/adapter.js';
import type { TokenSigner, TokenVerifier } from '../auth/oauth.js';
import { createJwksTokenVerifier } from '../auth/oauth.js';
import { createAuthMiddleware, requireScope } from '../auth/middleware.js';
import type { ComplianceCache } from '../cache/redis.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerOAuthRoutes } from './routes/oauth.js';
import { registerJurisdictionRoutes } from './routes/jurisdictions.js';
import { registerRegulationRoutes } from './routes/regulations.js';
import { registerRequirementRoutes } from './routes/requirements.js';
import { registerComplianceRoutes } from './routes/compliance.js';
import { registerUpdateRoutes } from './routes/updates.js';
import { registerSourceRoutes } from './routes/sources.js';
import { createLLMClient } from '../llm/llm-client.js';
import { registerWebhookRoutes } from './routes/webhooks.js';
import { registerUserRoutes } from './routes/users.js';
import { registerClientRoutes } from './routes/clients.js';
import { registerSeedRoutes } from './routes/seed.js';
import { registerOrgRoutes } from './routes/orgs.js';
import { registerWcagCriteriaRoutes } from './routes/wcag-criteria.js';
import { registerMcpRoutes } from './routes/mcp.js';
import { VERSION } from '../version.js';

export interface ServerOptions {
  readonly db: DbAdapter;
  readonly signToken: TokenSigner;
  readonly verifyToken: TokenVerifier;
  readonly tokenExpiry: string;
  readonly corsOrigins?: readonly string[];
  readonly rateLimitRead?: number;
  readonly rateLimitWrite?: number;
  readonly rateLimitWindowMs?: number;
  readonly logger?: boolean;
  /** Optional Redis-backed compliance result cache. */
  readonly cache?: ComplianceCache;
  /** Scheduled reseed interval, e.g. '7d', '12h', '30m'. Default 'off'. */
  readonly reseedInterval?: string;
  /** Skip the automatic baseline seed on startup. Useful in tests. */
  readonly skipSeed?: boolean;
  /** @luqen/llm service URL (e.g. http://localhost:4200) */
  readonly llmUrl?: string;
  /** @luqen/llm service OAuth2 client ID */
  readonly llmClientId?: string;
  /** @luqen/llm service OAuth2 client secret */
  readonly llmClientSecret?: string;
}

function parseInterval(s: string): number {
  const match = s.match(/^(\d+)(m|h|d)$/);
  if (!match) return 7 * 24 * 60 * 60 * 1000;
  const n = parseInt(match[1], 10);
  const unit = match[2];
  if (unit === 'm') return n * 60 * 1000;
  if (unit === 'h') return n * 60 * 60 * 1000;
  return n * 24 * 60 * 60 * 1000;
}

export async function createServer(options: ServerOptions) {
  const {
    db,
    signToken,
    verifyToken,
    tokenExpiry,
    corsOrigins = ['*'],
    rateLimitRead = 100,
    rateLimitWindowMs = 60000,
    logger = false,
    cache,
    reseedInterval = 'off',
    skipSeed = false,
    llmUrl,
    llmClientId,
    llmClientSecret,
  } = options;

  const llmClient = createLLMClient({ llmUrl, llmClientId, llmClientSecret });

  const app = Fastify({ logger, bodyLimit: 10 * 1024 * 1024 }); // 10MB for large site scans

  // Register CORS
  await app.register(cors, {
    origin: corsOrigins.length === 1 && corsOrigins[0] === '*' ? true : [...corsOrigins],
    credentials: true,
  });

  // Register rate limiting
  await app.register(rateLimit, {
    max: rateLimitRead,
    timeWindow: rateLimitWindowMs,
    errorResponseBuilder: (_request, context) => ({
      error: 'Too Many Requests',
      statusCode: 429,
      message: `Rate limit exceeded. Try again in ${Math.ceil(context.ttl / 1000)} seconds.`,
    }),
  });

  // Register Swagger/OpenAPI
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Luqen Compliance Service',
        description: 'Accessibility compliance rule engine — check WCAG issues against 60+ country-specific legal requirements',
        version: VERSION,
      },
      servers: [{ url: 'http://localhost:4000' }],
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
    uiConfig: {
      docExpansion: 'list',
    },
  });

  // Global auth middleware — applied after each route's preHandler chain
  const authMiddleware = createAuthMiddleware(verifyToken);
  app.addHook('preHandler', authMiddleware);

  // Decorate request with orgId from X-Org-Id header and authType
  app.decorateRequest('orgId', 'system');
  app.decorateRequest('authType', '');
  app.addHook('preHandler', async (request) => {
    // Only accept X-Org-Id when authenticated via API key (service-to-service),
    // not from regular JWT tokens — prevents users from spoofing org context.
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

  // Register all route groups
  await registerHealthRoutes(app);
  await registerOAuthRoutes(app, { db, signToken, tokenExpiry });
  await registerJurisdictionRoutes(app, db);
  await registerRegulationRoutes(app, db);
  await registerRequirementRoutes(app, db);
  await registerComplianceRoutes(app, db, cache);
  await registerUpdateRoutes(app, db);
  await registerSourceRoutes(app, db, llmClient);
  await registerWebhookRoutes(app, db);
  await registerUserRoutes(app, db);
  await registerClientRoutes(app, db);
  await registerSeedRoutes(app, db);
  await registerOrgRoutes(app, db);
  await registerWcagCriteriaRoutes(app, db);

  // Phase 31.1 Plan 03 (D-33/D-04): construct the MCP-facing verifier from
  // the dashboard JWKS with audience enforcement. The env vars read here:
  //   - DASHBOARD_JWKS_URL: URL of the dashboard's /oauth/jwks.json
  //     (fallback: http://dashboard.luqen.local/oauth/jwks.json)
  //   - COMPLIANCE_PUBLIC_URL: this service's externally-reachable base URL
  //     used to derive the expectedAudience (fallback: http://localhost:4000)
  //
  // If DASHBOARD_JWKS_URL is explicitly '' (empty) we skip the JWKS
  // verifier and reuse the existing local-signed `verifyToken` for the
  // MCP scoped preHandler — preserves the test harness path where tokens
  // are minted by the same in-memory keypair that validates them. The
  // scoped preHandler is STILL installed; /api/v1/mcp remains in
  // PUBLIC_PATHS of the global middleware and the scoped handler is the
  // sole auth gate either way.
  const dashboardJwksUrl =
    process.env['DASHBOARD_JWKS_URL'] ?? 'http://dashboard.luqen.local/oauth/jwks.json';
  const complianceMcpUrl = `${process.env['COMPLIANCE_PUBLIC_URL'] ?? 'http://localhost:4000'}/api/v1/mcp`;
  const verifyMcpToken: TokenVerifier =
    dashboardJwksUrl.trim().length > 0
      ? await createJwksTokenVerifier(dashboardJwksUrl, complianceMcpUrl)
      : verifyToken;
  await registerMcpRoutes(app, { db, verifyMcpToken });

  // Startup seed: runs once after server is ready
  app.addHook('onReady', async () => {
    if (!skipSeed) {
      try {
        const { seedBaseline } = await import('../seed/loader.js');
        const result = await seedBaseline(db, { force: true });
        app.log.info(`Compliance seed complete: ${result.requirements} requirements across ${result.regulations} regulations, ${result.wcagCriteria} WCAG criteria`);
      } catch (err) {
        app.log.warn({ err }, 'Compliance seed failed on startup');
      }
    }

    // Scheduled reseed if configured
    if (reseedInterval !== 'off') {
      const intervalMs = parseInterval(reseedInterval);
      const timer = setInterval(async () => {
        try {
          const { seedBaseline } = await import('../seed/loader.js');
          const result = await seedBaseline(db, { force: true });
          app.log.info(`Scheduled reseed complete: ${result.requirements} requirements across ${result.regulations} regulations, ${result.wcagCriteria} WCAG criteria`);
        } catch (err) {
          app.log.warn({ err }, 'Scheduled reseed failed');
        }
      }, intervalMs);
      // Unref so the timer doesn't prevent clean shutdown
      timer.unref();
    }
  });

  return app;
}
