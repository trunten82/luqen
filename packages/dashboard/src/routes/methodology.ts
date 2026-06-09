/**
 * Phase 81 — Public methodology documentation routes.
 *
 * All routes here are intentionally unauthenticated — they document the
 * model and are linked from every exposure indicator surface including the
 * WordPress plugin. No per-org or per-scan data is ever passed to the view.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { HtmlPageSchema } from '../api/schemas/envelope.js';

export async function methodologyRoutes(server: FastifyInstance): Promise<void> {
  server.get(
    '/methodology/legal-exposure',
    { schema: { ...HtmlPageSchema, tags: ['methodology'] } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      return reply.view('methodology-legal-exposure.hbs', {
        pageTitle: 'Legal Exposure Indicator — Methodology',
        currentPath: '/methodology/legal-exposure',
        user: request.user,
      });
    },
  );
}
