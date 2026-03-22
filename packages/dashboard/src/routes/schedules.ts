import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { StorageAdapter } from '../db/index.js';
import { toastHtml, escapeHtml } from './admin/helpers.js';
import { hasPermission } from '../permissions.js';

interface CreateScheduleBody {
  readonly siteUrl: string;
  readonly standard: string;
  readonly scanMode?: string;
  readonly frequency: string;
  readonly runner?: string;
  readonly incremental?: string;
}

const VALID_STANDARDS = ['WCAG2A', 'WCAG2AA', 'WCAG2AAA'];
const VALID_FREQUENCIES = ['daily', 'weekly', 'monthly'];
const VALID_RUNNERS = ['htmlcs', 'axe'];

function computeNextRunAt(frequency: string, fromDate: Date = new Date()): string {
  const next = new Date(fromDate.getTime());
  switch (frequency) {
    case 'daily':
      next.setTime(next.getTime() + 24 * 60 * 60 * 1000);
      break;
    case 'weekly':
      next.setTime(next.getTime() + 7 * 24 * 60 * 60 * 1000);
      break;
    case 'monthly':
      next.setTime(next.getTime() + 30 * 24 * 60 * 60 * 1000);
      break;
    default:
      next.setTime(next.getTime() + 7 * 24 * 60 * 60 * 1000);
  }
  return next.toISOString();
}

export { computeNextRunAt };

export async function scheduleRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
): Promise<void> {
  // GET /schedules — list all schedules (admin and user roles only)
  server.get(
    '/schedules',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!hasPermission(request, 'scans.schedule')) {
        return reply.code(403).send({ error: 'Insufficient permissions' });
      }

      const orgId = request.user?.currentOrgId;
      const schedules = await storage.schedules.listSchedules(orgId);

      const formatted = schedules.map((s) => ({
        ...s,
        nextRunAtDisplay: new Date(s.nextRunAt).toLocaleString(),
        lastRunAtDisplay: s.lastRunAt !== null ? new Date(s.lastRunAt).toLocaleString() : 'Never',
        enabledLabel: s.enabled ? 'Active' : 'Paused',
        enabledClass: s.enabled ? 'text--success' : 'text--muted',
        toggleLabel: s.enabled ? 'Pause' : 'Resume',
        toggleClass: s.enabled ? 'btn--ghost' : 'btn--primary',
      }));

      return reply.view('schedules.hbs', {
        pageTitle: 'Scan Schedules',
        currentPath: '/schedules',
        user: request.user,
        schedules: formatted,
        hasSchedules: schedules.length > 0,
        standards: VALID_STANDARDS,
        frequencies: VALID_FREQUENCIES,
      });
    },
  );

  // POST /schedules — create new schedule (admin and user roles only)
  server.post(
    '/schedules',
    { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!hasPermission(request, 'scans.schedule')) {
        return reply.code(403).send({ error: 'Insufficient permissions' });
      }

      const body = request.body as CreateScheduleBody;

      // Validate siteUrl
      if (typeof body.siteUrl !== 'string' || body.siteUrl.trim() === '') {
        return reply.code(400).send(toastHtml('Site URL is required', 'error'));
      }

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(body.siteUrl.trim());
      } catch {
        return reply.code(400).send(toastHtml('Site URL must be a valid URL', 'error'));
      }

      if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
        return reply.code(400).send(toastHtml('URL must use http or https', 'error'));
      }

      const standard = body.standard ?? 'WCAG2AA';
      if (!VALID_STANDARDS.includes(standard)) {
        return reply.code(400).send(toastHtml(`Standard must be one of: ${VALID_STANDARDS.join(', ')}`, 'error'));
      }

      const frequency = body.frequency ?? 'weekly';
      if (!VALID_FREQUENCIES.includes(frequency)) {
        return reply.code(400).send(toastHtml(`Frequency must be one of: ${VALID_FREQUENCIES.join(', ')}`, 'error'));
      }

      const scanMode = body.scanMode === 'single' ? 'single' : 'site';
      const runner = body.runner !== undefined && VALID_RUNNERS.includes(body.runner) ? body.runner : 'htmlcs';
      const incremental = body.incremental === 'true';

      await storage.schedules.createSchedule({
        id: randomUUID(),
        siteUrl: parsedUrl.toString(),
        standard,
        scanMode,
        jurisdictions: [],
        frequency,
        nextRunAt: computeNextRunAt(frequency),
        createdBy: request.user?.username ?? 'unknown',
        orgId: request.user?.currentOrgId ?? 'system',
        runner,
        incremental,
      });

      reply.header('HX-Redirect', '/schedules');
      return reply.send(toastHtml(`Schedule created for ${escapeHtml(parsedUrl.toString())}`, 'success'));
    },
  );

  // DELETE /schedules/:id — delete schedule (admin and user roles only)
  server.delete(
    '/schedules/:id',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!hasPermission(request, 'scans.schedule')) {
        return reply.code(403).send({ error: 'Insufficient permissions' });
      }

      const { id } = request.params as { id: string };

      const schedule = await storage.schedules.getSchedule(id);
      if (schedule === null) {
        return reply.code(404).send(toastHtml('Schedule not found', 'error'));
      }

      const orgId = request.user?.currentOrgId ?? 'system';
      if (schedule.orgId !== orgId && schedule.orgId !== 'system') {
        return reply.code(404).send(toastHtml('Schedule not found', 'error'));
      }

      await storage.schedules.deleteSchedule(id);

      reply.header('HX-Redirect', '/schedules');
      return reply.send(toastHtml('Schedule deleted', 'success'));
    },
  );

  // PATCH /schedules/:id/toggle — enable/disable schedule (admin and user roles only)
  server.patch(
    '/schedules/:id/toggle',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!hasPermission(request, 'scans.schedule')) {
        return reply.code(403).send({ error: 'Insufficient permissions' });
      }

      const { id } = request.params as { id: string };

      const schedule = await storage.schedules.getSchedule(id);
      if (schedule === null) {
        return reply.code(404).send(toastHtml('Schedule not found', 'error'));
      }

      const orgId = request.user?.currentOrgId ?? 'system';
      if (schedule.orgId !== orgId && schedule.orgId !== 'system') {
        return reply.code(404).send(toastHtml('Schedule not found', 'error'));
      }

      await storage.schedules.updateSchedule(id, { enabled: !schedule.enabled });

      reply.header('HX-Redirect', '/schedules');
      const action = schedule.enabled ? 'paused' : 'resumed';
      return reply.send(toastHtml(`Schedule ${action}`, 'success'));
    },
  );
}
