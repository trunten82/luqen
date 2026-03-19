import Fastify, { FastifyInstance } from 'fastify';
import { DashboardConfig } from './config.js';

/**
 * Creates and configures the Fastify application instance.
 * Plugins, routes, and views are registered here.
 */
export async function createServer(config: DashboardConfig): Promise<FastifyInstance> {
  const server = Fastify({
    logger: {
      level: process.env['NODE_ENV'] === 'production' ? 'warn' : 'info',
    },
  });

  // Plugins, routes, and views will be registered in subsequent implementation steps.
  // For now, register a health endpoint so the server is functional.
  server.get('/health', async (_request, _reply) => {
    return { status: 'ok', version: '0.1.0' };
  });

  return server;
}
