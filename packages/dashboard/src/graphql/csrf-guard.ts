/**
 * CSRF guard for POST /graphql.
 *
 * /graphql is exempt from the dashboard's CSRF-token check (server.ts
 * isCsrfExempt) and browsers authenticate to it with the session cookie
 * (SameSite=Lax). @fastify/formbody is registered globally, so a plain HTML
 * form POST of `query=mutation{...}` parses into a valid GraphQL body and
 * executes. SameSite=Lax keeps the cookie off cross-SITE POSTs, but any
 * same-site origin (e.g. a sibling subdomain) still sends it.
 *
 * A browser can only send a cross-origin request without a CORS preflight if
 * its content type is a "simple" one (form-urlencoded, multipart/form-data,
 * text/plain). So a cookie-authenticated POST must carry a non-simple type —
 * application/json or application/graphql — which a foreign origin cannot send
 * without the server's CORS consent. Callers whose `Authorization: Bearer` /
 * `X-API-Key` credential actually VALIDATES are not cookie-authenticated and
 * are left alone; a bogus header does not exempt a request, because auth then
 * falls through to the session cookie.
 * GET mutations are already refused by mercurius itself.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

const GRAPHQL_PATH = '/graphql';
const ALLOWED_CONTENT_TYPES: ReadonlySet<string> = new Set(['application/json', 'application/graphql']);

function mediaType(header: string | undefined): string {
  return (header ?? '').split(';')[0]!.trim().toLowerCase();
}

/** True when the request presents an API credential that actually validates. */
export type ApiCredentialValidator = (request: FastifyRequest) => boolean;

/** Is this request one the guard lets through? */
export function isGraphqlRequestCsrfSafe(
  request: FastifyRequest,
  hasValidApiCredential: ApiCredentialValidator,
): boolean {
  if (request.method !== 'POST') return true;
  if (request.url.split('?')[0] !== GRAPHQL_PATH) return true;
  if (ALLOWED_CONTENT_TYPES.has(mediaType(request.headers['content-type']))) return true;
  return hasValidApiCredential(request);
}

export function registerGraphqlCsrfGuard(
  server: FastifyInstance,
  hasValidApiCredential: ApiCredentialValidator,
): void {
  server.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (isGraphqlRequestCsrfSafe(request, hasValidApiCredential)) return;
    await reply.code(403).send({
      error: 'Forbidden: cookie-authenticated GraphQL requests must use Content-Type application/json',
    });
  });
}
