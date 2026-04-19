import Fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import rateLimit from '@fastify/rate-limit';
import type { DbAdapter } from '../db/adapter.js';
import type { TokenSigner, TokenVerifier } from '../auth/oauth.js';
import { createJwksTokenVerifier } from '../auth/oauth.js';
import { createAuthMiddleware } from '../auth/middleware.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerOAuthRoutes } from './routes/oauth.js';
import { registerClientRoutes } from './routes/clients.js';
import { registerProviderRoutes } from './routes/providers.js';
import { registerModelRoutes } from './routes/models.js';
import { registerCapabilityRoutes } from './routes/capabilities.js';
import { registerCapabilityExecRoutes } from './routes/capabilities-exec.js';
import { registerPromptRoutes } from './routes/prompts.js';
import { registerMcpRoutes } from './routes/mcp.js';
import { registerLlmProtectedResourceMetadata } from './routes/well-known.js';
import { VERSION } from '../version.js';

export interface ServerOptions {
  readonly db: DbAdapter;
  readonly signToken: TokenSigner;
  readonly verifyToken: TokenVerifier;
  readonly tokenExpiry: string;
  readonly corsOrigins?: readonly string[];
  readonly rateLimitRead?: number;
  readonly rateLimitWindowMs?: number;
  readonly logger?: boolean;
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
  } = options;

  const app = Fastify({ logger, bodyLimit: 10 * 1024 * 1024 }); // 10MB

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
        title: 'Luqen LLM Service',
        description: 'LLM provider management and AI capabilities service',
        version: VERSION,
      },
      servers: [{ url: 'http://localhost:5100' }],
      components: {
        schemas: {
          ErrorResponse: {
            type: 'object' as const,
            properties: {
              error: { type: 'string' as const },
              statusCode: { type: 'number' as const },
            },
          },
        },
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

  // Global auth middleware
  const authMiddleware = createAuthMiddleware(verifyToken);
  app.addHook('preHandler', authMiddleware);

  // Decorate request with orgId and authType defaults
  app.decorateRequest('orgId', 'system');
  app.decorateRequest('authType', '');

  // Second preHandler: apply X-Org-Id only for API key auth
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

  // Register all route groups
  await registerHealthRoutes(app);
  // Phase 31.1 Plan 03 Task 3: RFC 9728 Resource Server metadata (public).
  await registerLlmProtectedResourceMetadata(app);
  await registerOAuthRoutes(app, { db, signToken, tokenExpiry });
  await registerClientRoutes(app, db);
  await registerProviderRoutes(app, db);
  await registerModelRoutes(app, db);
  await registerCapabilityRoutes(app, db);
  await registerCapabilityExecRoutes(app, db);
  await registerPromptRoutes(app, db);

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
  const llmMcpUrl = `${process.env['LLM_PUBLIC_URL'] ?? 'http://localhost:5100'}/api/v1/mcp`;
  const verifyMcpToken: TokenVerifier =
    dashboardJwksUrl.trim().length > 0
      ? await createJwksTokenVerifier(dashboardJwksUrl, llmMcpUrl)
      : verifyToken;
  await registerMcpRoutes(app, { db, verifyMcpToken });

  return app;
}
