import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

export async function toolRoutes(server: FastifyInstance): Promise<void> {
  server.get(
    '/tools/bookmarklet',
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
