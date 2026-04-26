import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Type } from '@sinclair/typebox';
import type { StorageAdapter } from '../../db/index.js';
import { retagScansForSite } from '../../services/branding-retag.js';
import { ErrorEnvelope } from '../../api/schemas/envelope.js';

// Branding API endpoints respond with bare JSON envelopes (data/total/success)
// rather than the dashboard's LuqenResponse — replies use `.send({ data, ... })`
// directly. Schemas mirror that bare-JSON shape.
const GuidelineShape = Type.Object({}, { additionalProperties: true });
const ColorShape = Type.Object({}, { additionalProperties: true });
const FontShape = Type.Object({}, { additionalProperties: true });
const SelectorShape = Type.Object({}, { additionalProperties: true });
const RetagResultShape = Type.Object({}, { additionalProperties: true });

const ListEnvelope = <T extends ReturnType<typeof Type.Object>>(item: T) =>
  Type.Object({ data: Type.Array(item) }, { additionalProperties: true });
const ItemEnvelope = <T extends ReturnType<typeof Type.Object>>(item: T) =>
  Type.Object({ data: item }, { additionalProperties: true });
const SuccessEnvelope = Type.Object({ success: Type.Boolean() }, { additionalProperties: true });

const GuidelineParamsSchema = Type.Object(
  { id: Type.String() },
  { additionalProperties: true },
);
const GuidelineColorParamsSchema = Type.Object(
  { id: Type.String(), colorId: Type.String() },
  { additionalProperties: true },
);
const GuidelineFontParamsSchema = Type.Object(
  { id: Type.String(), fontId: Type.String() },
  { additionalProperties: true },
);
const GuidelineSelectorParamsSchema = Type.Object(
  { id: Type.String(), selectorId: Type.String() },
  { additionalProperties: true },
);

// Bodies are fully optional at schema level — handlers do their own validation
// and return specific error messages that tests assert against. Keeping the
// schema permissive avoids Fastify's generic "Bad Request" pre-handler reply.
const CreateGuidelineBodySchema = Type.Object(
  { name: Type.Optional(Type.String()), description: Type.Optional(Type.String()) },
  { additionalProperties: true },
);

const AddColorBodySchema = Type.Object(
  {
    name: Type.Optional(Type.String()),
    hexValue: Type.Optional(Type.String()),
    usage: Type.Optional(Type.String()),
    context: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

const AddFontBodySchema = Type.Object(
  {
    family: Type.Optional(Type.String()),
    weights: Type.Optional(Type.Array(Type.String())),
    usage: Type.Optional(Type.String()),
    context: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

const AddSelectorBodySchema = Type.Object(
  { pattern: Type.Optional(Type.String()), description: Type.Optional(Type.String()) },
  { additionalProperties: true },
);

const SiteBodySchema = Type.Object(
  { siteUrl: Type.Optional(Type.String()) },
  { additionalProperties: true },
);

const SiteQuerystringSchema = Type.Object(
  { siteUrl: Type.Optional(Type.String()) },
  { additionalProperties: true },
);

const RetagBodySchema = Type.Object(
  { siteUrl: Type.Optional(Type.String()) },
  { additionalProperties: true },
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GuidelineParams {
  readonly id: string;
}

interface GuidelineColorParams {
  readonly id: string;
  readonly colorId: string;
}

interface GuidelineFontParams {
  readonly id: string;
  readonly fontId: string;
}

interface GuidelineSelectorParams {
  readonly id: string;
  readonly selectorId: string;
}

interface CreateGuidelineBody {
  readonly name: string;
  readonly description?: string;
}

interface AddColorBody {
  readonly name: string;
  readonly hexValue: string;
  readonly usage?: string;
  readonly context?: string;
}

interface AddFontBody {
  readonly family: string;
  readonly weights?: readonly string[];
  readonly usage?: string;
  readonly context?: string;
}

interface AddSelectorBody {
  readonly pattern: string;
  readonly description?: string;
}

interface AssignSiteBody {
  readonly siteUrl: string;
}

interface SiteQuery {
  readonly siteUrl?: string;
}

interface RetagBody {
  readonly siteUrl: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getOrgId(request: FastifyRequest): string {
  return request.user?.currentOrgId ?? 'system';
}

// ---------------------------------------------------------------------------
// Rate-limit config shared by all branding API endpoints
// ---------------------------------------------------------------------------

const rateLimitConfig = {
  rateLimit: {
    max: 60,
    timeWindow: '1 minute',
  },
};

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function brandingApiRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
): Promise<void> {

  // ── GET /api/v1/branding/guidelines ───────────────────────────────────────
  server.get(
    '/api/v1/branding/guidelines',
    {
      config: rateLimitConfig,
      schema: {
        tags: ['branding'],
        response: { 200: ListEnvelope(GuidelineShape), 401: ErrorEnvelope },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const orgId = getOrgId(request);
      const guidelines = await storage.branding.listGuidelines(orgId);
      return reply.header('content-type', 'application/json').send({ data: guidelines });
    },
  );

  // ── GET /api/v1/branding/guidelines/:id ───────────────────────────────────
  server.get<{ Params: GuidelineParams }>(
    '/api/v1/branding/guidelines/:id',
    {
      config: rateLimitConfig,
      schema: {
        tags: ['branding'],
        params: GuidelineParamsSchema,
        response: {
          200: ItemEnvelope(GuidelineShape),
          401: ErrorEnvelope,
          404: ErrorEnvelope,
        },
      },
    },
    async (request: FastifyRequest<{ Params: GuidelineParams }>, reply: FastifyReply) => {
      const orgId = getOrgId(request);
      const guideline = await storage.branding.getGuideline(request.params.id);

      if (guideline === null || guideline.orgId !== orgId) {
        return reply.code(404).send({ error: 'Guideline not found' });
      }

      const [colors, fonts, selectors] = await Promise.all([
        storage.branding.listColors(guideline.id),
        storage.branding.listFonts(guideline.id),
        storage.branding.listSelectors(guideline.id),
      ]);

      return reply.header('content-type', 'application/json').send({
        data: { ...guideline, colors, fonts, selectors },
      });
    },
  );

  // ── POST /api/v1/branding/guidelines ──────────────────────────────────────
  server.post<{ Body: CreateGuidelineBody }>(
    '/api/v1/branding/guidelines',
    {
      config: rateLimitConfig,
      schema: {
        tags: ['branding'],
        body: CreateGuidelineBodySchema,
        response: {
          201: ItemEnvelope(GuidelineShape),
          400: ErrorEnvelope,
          401: ErrorEnvelope,
        },
      },
    },
    async (request: FastifyRequest<{ Body: CreateGuidelineBody }>, reply: FastifyReply) => {
      const orgId = getOrgId(request);
      const { name, description } = request.body ?? {};

      if (typeof name !== 'string' || name.trim() === '') {
        return reply.code(400).send({ error: 'name is required' });
      }

      const guideline = await storage.branding.createGuideline({
        id: randomUUID(),
        orgId,
        name: name.trim(),
        ...(description !== undefined ? { description } : {}),
        createdBy: request.user?.id,
      });

      return reply.code(201).header('content-type', 'application/json').send({ data: guideline });
    },
  );

  // ── DELETE /api/v1/branding/guidelines/:id ────────────────────────────────
  server.delete<{ Params: GuidelineParams }>(
    '/api/v1/branding/guidelines/:id',
    {
      config: rateLimitConfig,
      schema: {
        tags: ['branding'],
        params: GuidelineParamsSchema,
        response: {
          200: SuccessEnvelope,
          401: ErrorEnvelope,
          404: ErrorEnvelope,
        },
      },
    },
    async (request: FastifyRequest<{ Params: GuidelineParams }>, reply: FastifyReply) => {
      const orgId = getOrgId(request);
      const guideline = await storage.branding.getGuideline(request.params.id);

      if (guideline === null || guideline.orgId !== orgId) {
        return reply.code(404).send({ error: 'Guideline not found' });
      }

      await storage.branding.deleteGuideline(request.params.id);
      return reply.code(200).header('content-type', 'application/json').send({ success: true });
    },
  );

  // ── POST /api/v1/branding/guidelines/:id/colors ───────────────────────────
  server.post<{ Params: GuidelineParams; Body: AddColorBody }>(
    '/api/v1/branding/guidelines/:id/colors',
    {
      config: rateLimitConfig,
      schema: {
        tags: ['branding'],
        params: GuidelineParamsSchema,
        body: AddColorBodySchema,
        response: {
          201: ItemEnvelope(ColorShape),
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          404: ErrorEnvelope,
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: GuidelineParams; Body: AddColorBody }>,
      reply: FastifyReply,
    ) => {
      const orgId = getOrgId(request);
      const guideline = await storage.branding.getGuideline(request.params.id);

      if (guideline === null || guideline.orgId !== orgId) {
        return reply.code(404).send({ error: 'Guideline not found' });
      }

      const { name, hexValue, usage, context } = request.body ?? {};

      if (typeof name !== 'string' || name.trim() === '') {
        return reply.code(400).send({ error: 'name is required' });
      }
      if (typeof hexValue !== 'string' || hexValue.trim() === '') {
        return reply.code(400).send({ error: 'hexValue is required' });
      }

      const color = await storage.branding.addColor(guideline.id, {
        id: randomUUID(),
        name: name.trim(),
        hexValue: hexValue.trim(),
        ...(usage !== undefined ? { usage } : {}),
        ...(context !== undefined ? { context } : {}),
      });

      return reply.code(201).header('content-type', 'application/json').send({ data: color });
    },
  );

  // ── DELETE /api/v1/branding/guidelines/:id/colors/:colorId ───────────────
  server.delete<{ Params: GuidelineColorParams }>(
    '/api/v1/branding/guidelines/:id/colors/:colorId',
    {
      config: rateLimitConfig,
      schema: {
        tags: ['branding'],
        params: GuidelineColorParamsSchema,
        response: {
          200: SuccessEnvelope,
          401: ErrorEnvelope,
          404: ErrorEnvelope,
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: GuidelineColorParams }>,
      reply: FastifyReply,
    ) => {
      const orgId = getOrgId(request);
      const guideline = await storage.branding.getGuideline(request.params.id);

      if (guideline === null || guideline.orgId !== orgId) {
        return reply.code(404).send({ error: 'Guideline not found' });
      }

      await storage.branding.removeColor(request.params.colorId);
      return reply.code(200).header('content-type', 'application/json').send({ success: true });
    },
  );

  // ── POST /api/v1/branding/guidelines/:id/fonts ────────────────────────────
  server.post<{ Params: GuidelineParams; Body: AddFontBody }>(
    '/api/v1/branding/guidelines/:id/fonts',
    {
      config: rateLimitConfig,
      schema: {
        tags: ['branding'],
        params: GuidelineParamsSchema,
        body: AddFontBodySchema,
        response: {
          201: ItemEnvelope(FontShape),
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          404: ErrorEnvelope,
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: GuidelineParams; Body: AddFontBody }>,
      reply: FastifyReply,
    ) => {
      const orgId = getOrgId(request);
      const guideline = await storage.branding.getGuideline(request.params.id);

      if (guideline === null || guideline.orgId !== orgId) {
        return reply.code(404).send({ error: 'Guideline not found' });
      }

      const { family, weights, usage, context } = request.body ?? {};

      if (typeof family !== 'string' || family.trim() === '') {
        return reply.code(400).send({ error: 'family is required' });
      }

      const font = await storage.branding.addFont(guideline.id, {
        id: randomUUID(),
        family: family.trim(),
        ...(weights !== undefined ? { weights } : {}),
        ...(usage !== undefined ? { usage } : {}),
        ...(context !== undefined ? { context } : {}),
      });

      return reply.code(201).header('content-type', 'application/json').send({ data: font });
    },
  );

  // ── DELETE /api/v1/branding/guidelines/:id/fonts/:fontId ─────────────────
  server.delete<{ Params: GuidelineFontParams }>(
    '/api/v1/branding/guidelines/:id/fonts/:fontId',
    {
      config: rateLimitConfig,
      schema: {
        tags: ['branding'],
        params: GuidelineFontParamsSchema,
        response: {
          200: SuccessEnvelope,
          401: ErrorEnvelope,
          404: ErrorEnvelope,
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: GuidelineFontParams }>,
      reply: FastifyReply,
    ) => {
      const orgId = getOrgId(request);
      const guideline = await storage.branding.getGuideline(request.params.id);

      if (guideline === null || guideline.orgId !== orgId) {
        return reply.code(404).send({ error: 'Guideline not found' });
      }

      await storage.branding.removeFont(request.params.fontId);
      return reply.code(200).header('content-type', 'application/json').send({ success: true });
    },
  );

  // ── POST /api/v1/branding/guidelines/:id/selectors ───────────────────────
  server.post<{ Params: GuidelineParams; Body: AddSelectorBody }>(
    '/api/v1/branding/guidelines/:id/selectors',
    {
      config: rateLimitConfig,
      schema: {
        tags: ['branding'],
        params: GuidelineParamsSchema,
        body: AddSelectorBodySchema,
        response: {
          201: ItemEnvelope(SelectorShape),
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          404: ErrorEnvelope,
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: GuidelineParams; Body: AddSelectorBody }>,
      reply: FastifyReply,
    ) => {
      const orgId = getOrgId(request);
      const guideline = await storage.branding.getGuideline(request.params.id);

      if (guideline === null || guideline.orgId !== orgId) {
        return reply.code(404).send({ error: 'Guideline not found' });
      }

      const { pattern, description } = request.body ?? {};

      if (typeof pattern !== 'string' || pattern.trim() === '') {
        return reply.code(400).send({ error: 'pattern is required' });
      }

      const selector = await storage.branding.addSelector(guideline.id, {
        id: randomUUID(),
        pattern: pattern.trim(),
        ...(description !== undefined ? { description } : {}),
      });

      return reply.code(201).header('content-type', 'application/json').send({ data: selector });
    },
  );

  // ── DELETE /api/v1/branding/guidelines/:id/selectors/:selectorId ─────────
  server.delete<{ Params: GuidelineSelectorParams }>(
    '/api/v1/branding/guidelines/:id/selectors/:selectorId',
    {
      config: rateLimitConfig,
      schema: {
        tags: ['branding'],
        params: GuidelineSelectorParamsSchema,
        response: {
          200: SuccessEnvelope,
          401: ErrorEnvelope,
          404: ErrorEnvelope,
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: GuidelineSelectorParams }>,
      reply: FastifyReply,
    ) => {
      const orgId = getOrgId(request);
      const guideline = await storage.branding.getGuideline(request.params.id);

      if (guideline === null || guideline.orgId !== orgId) {
        return reply.code(404).send({ error: 'Guideline not found' });
      }

      await storage.branding.removeSelector(request.params.selectorId);
      return reply.code(200).header('content-type', 'application/json').send({ success: true });
    },
  );

  // ── POST /api/v1/branding/guidelines/:id/sites ───────────────────────────
  server.post<{ Params: GuidelineParams; Body: AssignSiteBody }>(
    '/api/v1/branding/guidelines/:id/sites',
    {
      config: rateLimitConfig,
      schema: {
        tags: ['branding'],
        params: GuidelineParamsSchema,
        body: SiteBodySchema,
        response: {
          200: SuccessEnvelope,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          404: ErrorEnvelope,
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: GuidelineParams; Body: AssignSiteBody }>,
      reply: FastifyReply,
    ) => {
      const orgId = getOrgId(request);
      const guideline = await storage.branding.getGuideline(request.params.id);

      if (guideline === null || guideline.orgId !== orgId) {
        return reply.code(404).send({ error: 'Guideline not found' });
      }

      const { siteUrl } = request.body ?? {};

      if (typeof siteUrl !== 'string' || siteUrl.trim() === '') {
        return reply.code(400).send({ error: 'siteUrl is required' });
      }

      await storage.branding.assignToSite(guideline.id, siteUrl.trim(), orgId);
      return reply.code(200).header('content-type', 'application/json').send({ success: true });
    },
  );

  // ── DELETE /api/v1/branding/guidelines/:id/sites ─────────────────────────
  server.delete<{ Params: GuidelineParams; Body: AssignSiteBody }>(
    '/api/v1/branding/guidelines/:id/sites',
    {
      config: rateLimitConfig,
      schema: {
        tags: ['branding'],
        params: GuidelineParamsSchema,
        body: SiteBodySchema,
        response: {
          200: SuccessEnvelope,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          404: ErrorEnvelope,
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: GuidelineParams; Body: AssignSiteBody }>,
      reply: FastifyReply,
    ) => {
      const orgId = getOrgId(request);
      const guideline = await storage.branding.getGuideline(request.params.id);

      if (guideline === null || guideline.orgId !== orgId) {
        return reply.code(404).send({ error: 'Guideline not found' });
      }

      const { siteUrl } = request.body ?? {};

      if (typeof siteUrl !== 'string' || siteUrl.trim() === '') {
        return reply.code(400).send({ error: 'siteUrl is required' });
      }

      await storage.branding.unassignFromSite(siteUrl.trim(), orgId);
      return reply.code(200).header('content-type', 'application/json').send({ success: true });
    },
  );

  // ── GET /api/v1/branding/sites ────────────────────────────────────────────
  server.get<{ Querystring: SiteQuery }>(
    '/api/v1/branding/sites',
    {
      config: rateLimitConfig,
      schema: {
        tags: ['branding'],
        querystring: SiteQuerystringSchema,
        response: {
          200: ItemEnvelope(GuidelineShape),
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          404: ErrorEnvelope,
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: SiteQuery }>, reply: FastifyReply) => {
      const orgId = getOrgId(request);
      const { siteUrl } = request.query;

      if (siteUrl === undefined || siteUrl.trim() === '') {
        return reply.code(400).send({ error: 'siteUrl query parameter is required' });
      }

      const guideline = await storage.branding.getGuidelineForSite(siteUrl.trim(), orgId);

      if (guideline === null) {
        return reply.code(404).send({ error: 'No guideline assigned to this site' });
      }

      const [colors, fonts, selectors] = await Promise.all([
        storage.branding.listColors(guideline.id),
        storage.branding.listFonts(guideline.id),
        storage.branding.listSelectors(guideline.id),
      ]);

      return reply.header('content-type', 'application/json').send({
        data: { ...guideline, colors, fonts, selectors },
      });
    },
  );

  // ── POST /api/v1/branding/retag ───────────────────────────────────────────
  server.post<{ Body: RetagBody }>(
    '/api/v1/branding/retag',
    {
      config: rateLimitConfig,
      schema: {
        tags: ['branding'],
        body: RetagBodySchema,
        response: {
          200: ItemEnvelope(RetagResultShape),
          400: ErrorEnvelope,
          401: ErrorEnvelope,
        },
      },
    },
    async (request: FastifyRequest<{ Body: RetagBody }>, reply: FastifyReply) => {
      const orgId = getOrgId(request);
      const { siteUrl } = request.body ?? {};

      if (typeof siteUrl !== 'string' || siteUrl.trim() === '') {
        return reply.code(400).send({ error: 'siteUrl is required' });
      }

      const result = await retagScansForSite(
        storage,
        siteUrl.trim(),
        orgId,
        server.brandingOrchestrator,
        storage.brandScores,
      );
      return reply.header('content-type', 'application/json').send({ data: result });
    },
  );
}
