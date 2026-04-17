/**
 * extractToolContext — reads the authenticated request decorations populated
 * by each service's global auth middleware (tokenPayload, orgId, authType,
 * permissions) and returns a frozen ToolContext for the MCP plugin to thread
 * into every tool dispatch.
 *
 * DESIGN: This function NEVER re-verifies the JWT. Re-verifying would:
 *   1. Duplicate timing-attack surface
 *   2. Risk drift from the service's global middleware
 *   3. Break API-key auth (the middleware synthesises a tokenPayload for
 *      service-to-service API-key requests)
 *
 * The MCP plugin MUST be registered on a path NOT in PUBLIC_PATHS, so the
 * service-global auth middleware is guaranteed to have already populated
 * request.tokenPayload before the plugin's route handler runs. If that
 * invariant is violated (misordered preHandlers), this throws with a
 * precise, grep-able error message.
 */

import type { FastifyRequest } from 'fastify';
import type { ToolContext } from './types.js';

interface TokenPayloadLike {
  readonly sub: string;
  readonly scopes: readonly string[];
  readonly orgId?: string;
}

type RequestDecorations = FastifyRequest & {
  tokenPayload?: TokenPayloadLike;
  orgId?: string;
  authType?: string;
  permissions?: Set<string>;
};

export function extractToolContext(request: FastifyRequest): ToolContext {
  const decorated = request as RequestDecorations;
  const payload = decorated.tokenPayload;
  if (payload == null) {
    throw new Error(
      'MCP request reached tool dispatch without authenticated tokenPayload — check preHandler order',
    );
  }

  const orgId = decorated.orgId ?? 'system';
  const authType = decorated.authType === 'apikey' ? 'apikey' : 'jwt';
  const permissions = decorated.permissions ?? new Set<string>();

  // Copy scopes via spread so caller mutation of the payload's scopes array
  // cannot later leak through the context.
  return {
    orgId,
    userId: payload.sub,
    scopes: [...payload.scopes],
    permissions,
    authType,
  };
}
