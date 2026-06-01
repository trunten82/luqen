/**
 * Phase 80 — entitlement API for connected clients (the WordPress plugin).
 *
 * GET /api/v1/entitlement — returns the caller org's commercial plan plus its
 * AI-fix credit position. The WordPress Pro gate (GATE-06) reads `plan` to
 * derive free-vs-Pro in enterprise mode; the credit fields drive the in-plugin
 * "AI fixes metered out" paywall (CREDIT-05).
 *
 * Auth: the existing dashboard auth chain (session, API key, OAuth Bearer). The
 * org is taken from `request.user.currentOrgId`; a missing org context is 401.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Type } from '@sinclair/typebox';
import type { StorageAdapter } from '../../db/index.js';
import type { LLMClient } from '../../llm-client.js';

const EntitlementResponse = Type.Object({
  plan: Type.String(),
  credits: Type.Union([
    Type.Object({
      allocated: Type.Number(),
      used: Type.Number(),
      balance: Type.Number(),
    }),
    Type.Null(),
  ]),
});

const ErrorResponse = Type.Object({ error: Type.String() });

export async function entitlementApiRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
  getLLMClient: () => LLMClient | null,
): Promise<void> {
  server.get(
    '/api/v1/entitlement',
    {
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: {
        response: { 200: EntitlementResponse, 401: ErrorResponse },
        tags: ['entitlement'],
        summary: 'Caller org commercial plan + AI-fix credit balance',
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const orgId = request.user?.currentOrgId;
      if (orgId == null || orgId === '') {
        return reply.code(401).send({ error: 'authentication required' });
      }
      const plan = storage.entitlements !== undefined
        ? (await storage.entitlements.get(orgId)).plan
        : 'free';
      const llmClient = getLLMClient();
      const credits = llmClient !== null ? await llmClient.getCredits(orgId) : null;
      return reply.send({
        plan,
        credits: credits === null
          ? null
          : { allocated: credits.allocated, used: credits.used, balance: credits.balance },
      });
    },
  );
}
