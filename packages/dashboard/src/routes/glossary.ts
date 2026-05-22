import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Lazy-loaded once per process. Glossary JSON ships in src/i18n/ alongside
// the locale files; build script copies the whole i18n/locales dir but the
// glossary lives one level up so we resolve relative to dist/routes.
const GLOSSARY_PATH = resolve(fileURLToPath(import.meta.url), '..', '..', 'i18n', 'glossary.json');

let cached: Record<string, unknown> | null = null;

async function loadGlossary(): Promise<Record<string, unknown>> {
  if (cached) return cached;
  try {
    const raw = await readFile(GLOSSARY_PATH, 'utf8');
    cached = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    cached = {};
  }
  return cached;
}

export async function glossaryRoutes(server: FastifyInstance): Promise<void> {
  server.get(
    '/api/v1/glossary',
    {
      schema: {
        tags: ['glossary'],
        response: { 200: { type: 'object', additionalProperties: true } },
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const data = await loadGlossary();
      reply.header('Cache-Control', 'public, max-age=3600');
      return reply.send(data);
    },
  );
}
