import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { StorageAdapter } from '../../db/index.js';
import { retagScansForSite } from '../../services/branding-retag.js';

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
    { config: rateLimitConfig },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const orgId = getOrgId(request);
      const guidelines = await storage.branding.listGuidelines(orgId);
      return reply.header('content-type', 'application/json').send({ data: guidelines });
    },
  );

  // ── GET /api/v1/branding/guidelines/:id ───────────────────────────────────
  server.get<{ Params: GuidelineParams }>(
    '/api/v1/branding/guidelines/:id',
    { config: rateLimitConfig },
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
    { config: rateLimitConfig },
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
    { config: rateLimitConfig },
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
    { config: rateLimitConfig },
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
    { config: rateLimitConfig },
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
    { config: rateLimitConfig },
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
    { config: rateLimitConfig },
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
    { config: rateLimitConfig },
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
    { config: rateLimitConfig },
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
    { config: rateLimitConfig },
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
    { config: rateLimitConfig },
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
    { config: rateLimitConfig },
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
    { config: rateLimitConfig },
    async (request: FastifyRequest<{ Body: RetagBody }>, reply: FastifyReply) => {
      const orgId = getOrgId(request);
      const { siteUrl } = request.body ?? {};

      if (typeof siteUrl !== 'string' || siteUrl.trim() === '') {
        return reply.code(400).send({ error: 'siteUrl is required' });
      }

      const result = await retagScansForSite(storage, siteUrl.trim(), orgId);
      return reply.header('content-type', 'application/json').send({ data: result });
    },
  );
}
