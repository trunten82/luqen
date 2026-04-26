import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { HtmlPageSchema } from '../api/schemas/envelope.js';

export async function toolRoutes(server: FastifyInstance): Promise<void> {
  server.get(
    '/tools/bookmarklet',
    { schema: { ...HtmlPageSchema, tags: ['tools'] } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const dashboardUrl = `${request.protocol}://${request.hostname}`;
      return reply.view('bookmarklet.hbs', {
        pageTitle: 'Bookmarklet',
        currentPath: '/tools/bookmarklet',
        user: request.user,
        dashboardUrl,
      });
    },
  );
}
