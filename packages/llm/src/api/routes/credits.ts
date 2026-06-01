import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Type } from '@sinclair/typebox';
import { ErrorEnvelope } from '../schemas/envelope.js';
import type { DbAdapter } from '../../db/adapter.js';
import { requireScope } from '../../auth/middleware.js';

/**
 * Phase 80 — AI-fix credit metering API.
 *
 * GET  /api/v1/credits           — the caller's (or, for a system admin, a
 *                                  requested org's) current balance.
 * GET  /api/v1/credits/ledger    — recent ledger movements.
 * POST /api/v1/credits/allocation — admin: set an org's allocation (fresh grant).
 * POST /api/v1/credits/topup      — admin: add credits without resetting usage.
 *
 * Org scoping mirrors /api/v1/usage: a non-admin token is permanently bound to
 * its own org; only a system-admin token may target another org.
 */

class ForbiddenOrgError extends Error {
  constructor(message: string) { super(message); this.name = 'ForbiddenOrgError'; }
}

interface TokenPayloadShape {
  readonly orgId?: string;
  readonly scopes?: ReadonlyArray<string>;
}

function resolveOrg(request: FastifyRequest, requestedOrgId: string | undefined): string {
  const payload = (request as FastifyRequest & { tokenPayload?: TokenPayloadShape }).tokenPayload;
  const tokenOrg = payload?.orgId;
  const tokenScopes = payload?.scopes ?? [];
  const isSystemAdmin = tokenOrg === 'system' && tokenScopes.includes('admin');

  if (isSystemAdmin) {
    // A system admin may target any org; default to 'system' if unspecified.
    return requestedOrgId !== undefined && requestedOrgId !== '' ? requestedOrgId : 'system';
  }
  if (tokenOrg === undefined || tokenOrg === '') {
    throw new ForbiddenOrgError('Token has no orgId binding');
  }
  if (requestedOrgId !== undefined && requestedOrgId !== '' && requestedOrgId !== tokenOrg) {
    throw new ForbiddenOrgError(`Cannot target orgId=${requestedOrgId} — token is bound to ${tokenOrg}`);
  }
  return tokenOrg;
}

const BalanceSchema = Type.Object(
  {
    orgId: Type.String(),
    allocated: Type.Number(),
    used: Type.Number(),
    balance: Type.Number(),
  },
  { additionalProperties: true },
);

const OrgQuery = Type.Object({ orgId: Type.Optional(Type.String()) }, { additionalProperties: true });

const SetAllocationBody = Type.Object(
  {
    orgId: Type.String(),
    allocated: Type.Number({ minimum: 0 }),
    updatedBy: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

const TopupBody = Type.Object(
  {
    orgId: Type.String(),
    delta: Type.Number(),
    updatedBy: Type.Optional(Type.String()),
    reason: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

const LedgerEntrySchema = Type.Object(
  {
    id: Type.String(),
    orgId: Type.String(),
    delta: Type.Number(),
    reason: Type.String(),
    balanceAfter: Type.Number(),
    occurredAt: Type.String(),
  },
  { additionalProperties: true },
);

export async function registerCreditsRoutes(
  app: FastifyInstance,
  db: DbAdapter,
): Promise<void> {
  app.get(
    '/api/v1/credits',
    {
      preHandler: [requireScope('read')],
      schema: {
        querystring: OrgQuery,
        response: { 200: BalanceSchema, 401: ErrorEnvelope, 403: ErrorEnvelope },
        tags: ['credits'],
        summary: 'Get an org AI-fix credit balance',
      },
    },
    async (request, reply) => {
      const q = request.query as Record<string, string | undefined>;
      let org: string;
      try {
        org = resolveOrg(request, typeof q['orgId'] === 'string' ? q['orgId'] : undefined);
      } catch (err) {
        if (err instanceof ForbiddenOrgError) return reply.code(403).send({ error: 'forbidden_org', message: err.message });
        throw err;
      }
      return db.getCreditBalance(org);
    },
  );

  app.get(
    '/api/v1/credits/ledger',
    {
      preHandler: [requireScope('read')],
      schema: {
        querystring: OrgQuery,
        response: { 200: Type.Array(LedgerEntrySchema), 401: ErrorEnvelope, 403: ErrorEnvelope },
        tags: ['credits'],
        summary: 'Recent AI-fix credit ledger movements for an org',
      },
    },
    async (request, reply) => {
      const q = request.query as Record<string, string | undefined>;
      let org: string;
      try {
        org = resolveOrg(request, typeof q['orgId'] === 'string' ? q['orgId'] : undefined);
      } catch (err) {
        if (err instanceof ForbiddenOrgError) return reply.code(403).send({ error: 'forbidden_org', message: err.message });
        throw err;
      }
      return db.listCreditLedger(org, 50);
    },
  );

  app.post(
    '/api/v1/credits/allocation',
    {
      preHandler: [requireScope('admin')],
      schema: {
        body: SetAllocationBody,
        response: { 200: BalanceSchema, 401: ErrorEnvelope, 403: ErrorEnvelope },
        tags: ['credits'],
        summary: 'Set an org AI-fix credit allocation (admin)',
      },
    },
    async (request) => {
      const b = request.body as { orgId: string; allocated: number; updatedBy?: string };
      return db.setCreditAllocation(b.orgId, b.allocated, b.updatedBy);
    },
  );

  app.post(
    '/api/v1/credits/topup',
    {
      preHandler: [requireScope('admin')],
      schema: {
        body: TopupBody,
        response: { 200: BalanceSchema, 401: ErrorEnvelope, 403: ErrorEnvelope },
        tags: ['credits'],
        summary: 'Top up an org AI-fix credit allocation (admin)',
      },
    },
    async (request) => {
      const b = request.body as { orgId: string; delta: number; updatedBy?: string; reason?: string };
      return db.addCredits(b.orgId, b.delta, b.updatedBy, b.reason ?? 'topup');
    },
  );
}
