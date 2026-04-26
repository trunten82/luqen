import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Type } from '@sinclair/typebox';
import { scanSources, uploadSource } from '../../compliance-client.js';
import type { PluginManager } from '../../plugins/manager.js';
import { LuqenResponse, ErrorEnvelope } from '../../api/schemas/envelope.js';

const ScanSourcesQuerystring = Type.Object(
  { force: Type.Optional(Type.String()) },
  { additionalProperties: true },
);

const ScanSourcesResponseSchema = Type.Object(
  {
    status: Type.String(),
    message: Type.String(),
  },
  { additionalProperties: true },
);

// Body fields kept Optional — handler validates and returns specific errors.
const UploadSourceBodySchema = Type.Object(
  {
    content: Type.Optional(Type.String()),
    name: Type.Optional(Type.String()),
    regulationId: Type.Optional(Type.String()),
    regulationName: Type.Optional(Type.String()),
    jurisdictionId: Type.Optional(Type.String()),
    pluginId: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

const UploadSourceResultSchema = Type.Object({}, { additionalProperties: true });

/**
 * Source intelligence API routes.
 * Accessible via API key (Bearer) for automation and inter-service calls.
 */
export async function sourceApiRoutes(
  server: FastifyInstance,
  complianceUrl: string,
  pluginManager: PluginManager,
  /**
   * Getter for the current global compliance token manager. Called inside
   * each handler so that a runtime reload of the compliance client is picked
   * up immediately (no captured stale reference).
   */
  getServiceTokenManager: () => { getToken(): Promise<string> } | null,
): Promise<void> {
  // POST /api/v1/sources/scan — trigger async source scan
  server.post(
    '/api/v1/sources/scan',
    {
      schema: {
        tags: ['sources'],
        querystring: ScanSourcesQuerystring,
        response: {
          200: ScanSourcesResponseSchema,
          401: ErrorEnvelope,
          500: ErrorEnvelope,
          503: ErrorEnvelope,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.user) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const query = request.query as { force?: string };
      const force = query.force !== 'false';

      try {
        const serviceTokenManager = getServiceTokenManager();
        if (serviceTokenManager === null) {
          return reply.code(503).send({ error: 'Compliance service not configured' });
        }
        const token = await serviceTokenManager.getToken();

        // Fire-and-forget — return immediately
        const scanPromise = scanSources(complianceUrl, token, force)
          .then((result) => {
            request.log.info(
              { scanned: result.scanned, changed: result.changed, proposals: result.proposalsCreated },
              'API source scan completed',
            );
          })
          .catch((err) => {
            request.log.error({ err }, 'API source scan failed');
          });
        void scanPromise;

        return reply.send({ status: 'started', message: 'Source scan started in background' });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(500).send({ error: message });
      }
    },
  );

  // POST /api/v1/sources/upload — upload document for LLM parsing
  server.post(
    '/api/v1/sources/upload',
    {
      schema: {
        tags: ['sources'],
        body: UploadSourceBodySchema,
        response: {
          201: UploadSourceResultSchema,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          500: ErrorEnvelope,
          503: ErrorEnvelope,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.user) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const body = request.body as {
        content?: string;
        name?: string;
        regulationId?: string;
        regulationName?: string;
        jurisdictionId?: string;
        pluginId?: string;
      } | undefined;

      if (!body?.content?.trim() || !body?.name?.trim()) {
        return reply.code(400).send({ error: 'name and content are required' });
      }

      try {
        const serviceTokenManager = getServiceTokenManager();
        if (serviceTokenManager === null) {
          return reply.code(503).send({ error: 'Compliance service not configured' });
        }
        const token = await serviceTokenManager.getToken();
        const result = await uploadSource(complianceUrl, token, {
          content: body.content.trim(),
          name: body.name.trim(),
          regulationId: body.regulationId,
          regulationName: body.regulationName ?? body.name.trim(),
          jurisdictionId: body.jurisdictionId,
          pluginId: body.pluginId,
        });
        return reply.code(201).send(result);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(500).send({ error: message });
      }
    },
  );
}
