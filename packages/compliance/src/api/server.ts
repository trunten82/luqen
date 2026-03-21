import Fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import rateLimit from '@fastify/rate-limit';
import type { DbAdapter } from '../db/adapter.js';
import type { TokenSigner, TokenVerifier } from '../auth/oauth.js';
import { createAuthMiddleware } from '../auth/middleware.js';
import type { ComplianceCache } from '../cache/redis.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerOAuthRoutes } from './routes/oauth.js';
import { registerJurisdictionRoutes } from './routes/jurisdictions.js';
import { registerRegulationRoutes } from './routes/regulations.js';
import { registerRequirementRoutes } from './routes/requirements.js';
import { registerComplianceRoutes } from './routes/compliance.js';
import { registerUpdateRoutes } from './routes/updates.js';
import { registerSourceRoutes } from './routes/sources.js';
import { registerWebhookRoutes } from './routes/webhooks.js';
import { registerUserRoutes } from './routes/users.js';
import { registerClientRoutes } from './routes/clients.js';
import { registerSeedRoutes } from './routes/seed.js';
import { registerOrgRoutes } from './routes/orgs.js';
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
  } = options;

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
  app.get('/api/v1/openapi.json', async (request, reply) => {
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
  await registerSourceRoutes(app, db);
  await registerWebhookRoutes(app, db);
  await registerUserRoutes(app, db);
  await registerClientRoutes(app, db);
  await registerSeedRoutes(app, db);
  await registerOrgRoutes(app, db);

  return app;
}
