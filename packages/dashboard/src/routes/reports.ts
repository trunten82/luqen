import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { readFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StorageAdapter } from '../db/index.js';
import { extractCriterion, getWcagDescription } from './wcag-enrichment.js';
import { MANUAL_CRITERIA } from '../manual-criteria.js';
import { isPuppeteerAvailable } from '../pdf/generator.js';
import { normalizeReportData, inferComponent } from '../services/report-service.js';
import type { JsonReportFile } from '../services/report-service.js';
export { normalizeReportData, inferComponent };
export type { JsonReportFile };

const __dirname = fileURLToPath(new URL('.', import.meta.url));

interface ReportsQuery {
  q?: string;
  status?: string;
  offset?: string;
  limit?: string;
}

const PAGE_SIZE = 20;


export async function reportRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
): Promise<void> {
  // GET /reports — list with pagination and search
  server.get(
    '/reports',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as ReportsQuery;
      const offset = query.offset !== undefined ? parseInt(query.offset, 10) : 0;
      const limit = query.limit !== undefined ? Math.min(Math.max(parseInt(query.limit, 10) || PAGE_SIZE, 1), 100) : PAGE_SIZE;
      const q = query.q?.trim();
      const status = query.status;

      const scans = await storage.scans.listScans({
        ...(q !== undefined && q !== '' ? { siteUrl: q } : {}),
        ...(status !== undefined && status !== '' && status !== 'all'
          ? { status: status as 'queued' | 'running' | 'completed' | 'failed' }
          : {}),
        offset,
        limit: limit + 1, // fetch one extra to detect if there's a next page
      });

      const hasNext = scans.length > limit;
      const page = hasNext ? scans.slice(0, limit) : scans;
      const hasPrev = offset > 0;
      const currentPage = Math.floor(offset / limit) + 1;

      // For each completed scan, find the previous completed scan of the same URL
      // to enable "Compare with previous" links
      const formatted = await Promise.all(page.map(async (s) => {
        let previousScanId: string | undefined;
        if (s.status === 'completed') {
          const previousScans = await storage.scans.listScans({
            siteUrl: s.siteUrl,
            status: 'completed',
            limit: 10,
          });
          // listScans returns descending by date; find first one older than current
          const prev = previousScans.find(
            (ps) => ps.id !== s.id && new Date(ps.createdAt) < new Date(s.createdAt),
          );
          if (prev !== undefined) {
            previousScanId = prev.id;
          }
        }
        return {
          ...s,
          jurisdictions: s.jurisdictions.join(', '),
          createdAtDisplay: new Date(s.createdAt).toLocaleString(),
          completedAtDisplay: s.completedAt
            ? new Date(s.completedAt).toLocaleString()
            : '',
          previousScanId,
        };
      }));

      // HTMX partial request — return table fragment only
      const isHtmx = request.headers['hx-request'] === 'true';
      if (isHtmx) {
        return reply.view('partials/reports-table.hbs', {
          scans: formatted,
          user: request.user,
          hasPrev,
          hasNext,
          prevOffset: Math.max(0, offset - limit),
          nextOffset: offset + limit,
          limit,
          currentPage,
          q,
          status,
        });
      }

      return reply.view('reports-list.hbs', {
        pageTitle: 'Reports',
        currentPath: '/reports',
        user: request.user,
        scans: formatted,
        hasPrev,
        hasNext,
        prevOffset: Math.max(0, offset - limit),
        nextOffset: offset + limit,
        limit,
        currentPage,
        q,
        status,
      });
    },
  );

  // GET /reports/:id — read JSON report and render rich report-detail template
  server.get(
    '/reports/:id',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const scan = await storage.scans.getScan(id);

      if (scan === null) {
        return reply.code(404).send({ error: 'Report not found' });
      }

      const orgId = request.user?.currentOrgId ?? 'system';
      if (scan.orgId !== orgId && scan.orgId !== 'system') {
        return reply.code(404).send({ error: 'Report not found' });
      }

      const scanMeta = {
        ...scan,
        jurisdictions: scan.jurisdictions.join(', '),
        createdAtDisplay: new Date(scan.createdAt).toLocaleString(),
        completedAtDisplay: scan.completedAt
          ? new Date(scan.completedAt).toLocaleString()
          : '',
      };

      // If scan is not completed, render a status-only view
      if (scan.status !== 'completed') {
        return reply.view('report-detail.hbs', {
          pageTitle: `Report — ${scan.siteUrl}`,
          currentPath: `/reports/${id}`,
          user: request.user,
          scan: scanMeta,
          reportData: null,
          pdfAvailable: isPuppeteerAvailable(),
        });
      }

      // Load report data — try DB first, then filesystem fallback
      let reportData: ReturnType<typeof normalizeReportData> | null = null;
      try {
        const dbReport = await storage.scans.getReport(id);
        if (dbReport !== null) {
          reportData = normalizeReportData(dbReport as JsonReportFile, scan);
        } else if (scan.jsonReportPath !== undefined && existsSync(scan.jsonReportPath)) {
          const raw = JSON.parse(
            await readFile(scan.jsonReportPath, 'utf-8'),
          ) as JsonReportFile;
          reportData = normalizeReportData(raw, scan);
        }
      } catch {
        // Render without report data — template handles the missing case
      }

      if (reportData === null) {
        return reply.view('report-detail.hbs', {
          pageTitle: `Report — ${scan.siteUrl}`,
          currentPath: `/reports/${id}`,
          user: request.user,
          scan: scanMeta,
          reportData: null,
          pdfAvailable: isPuppeteerAvailable(),
        });
      }

      // Compute manual testing completion stats
      const manualResults = await storage.manualTests.getManualTests(id);
      const manualTested = manualResults.filter(
        (r) => r.status === 'pass' || r.status === 'fail' || r.status === 'na',
      ).length;
      const manualTotal = MANUAL_CRITERIA.length;
      const manualPct = manualTotal > 0 ? Math.round((manualTested / manualTotal) * 100) : 0;

      // Compute issue assignment stats + build assigned fingerprint lookup
      const assignmentStats = await storage.assignments.getAssignmentStats(id);
      const assignmentActiveCount = assignmentStats.open + assignmentStats.assigned + assignmentStats.inProgress;
      const allAssignments = await storage.assignments.listAssignments({ scanId: id });
      const assignedMap: Record<string, { id: string; status: string; assignedTo: string | null }> = {};
      for (const a of allAssignments) {
        // Store by exact fingerprint
        assignedMap[a.issueFingerprint] = { id: a.id, status: a.status, assignedTo: a.assignedTo };
        // Also store by wcag_criterion for bulk-assigned items (criterion||bulk||title format)
        if (a.wcagCriterion) {
          assignedMap[`criterion:${a.wcagCriterion}`] = { id: a.id, status: a.status, assignedTo: a.assignedTo };
        }
      }

      // Build assignees list (users + teams) for the assignment picker
      const dashboardUsers = await storage.users.listUsers();
      const teams = await storage.teams.listTeams(orgId);
      const assignees = [
        ...dashboardUsers.filter((u) => u.active).map((u) => ({ type: 'user', id: u.username, label: u.username })),
        ...teams.map((t) => ({ type: 'team', id: `team:${t.id}`, label: `Team: ${t.name}` })),
      ];

      return reply.view('report-detail.hbs', {
        pageTitle: `Report — ${scan.siteUrl}`,
        currentPath: `/reports/${id}`,
        user: request.user,
        scan: scanMeta,
        reportData,
        pdfAvailable: isPuppeteerAvailable(),
        manualTestStats: {
          tested: manualTested,
          total: manualTotal,
          percentage: manualPct,
        },
        assignmentStats,
        assignmentActiveCount,
        assignedMap,
        assignees,
      });
    },
  );

  // GET /reports/:id/print — standalone print-friendly HTML for browser print-to-PDF
  server.get(
    '/reports/:id/print',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const scan = await storage.scans.getScan(id);

      if (scan === null) {
        return reply.code(404).send({ error: 'Report not found' });
      }

      const orgId = request.user?.currentOrgId ?? 'system';
      if (scan.orgId !== orgId && scan.orgId !== 'system') {
        return reply.code(404).send({ error: 'Report not found' });
      }

      if (scan.status !== 'completed') {
        return reply.code(404).send({ error: 'Report data not available' });
      }

      let reportData: ReturnType<typeof normalizeReportData> | null = null;
      try {
        const dbReport = await storage.scans.getReport(id);
        if (dbReport !== null) {
          reportData = normalizeReportData(dbReport as JsonReportFile, scan);
        } else if (scan.jsonReportPath !== undefined && existsSync(scan.jsonReportPath)) {
          const raw = JSON.parse(
            await readFile(scan.jsonReportPath, 'utf-8'),
          ) as JsonReportFile;
          reportData = normalizeReportData(raw, scan);
        }
      } catch {
        return reply.code(500).send({ error: 'Failed to read report data' });
      }

      if (reportData === null) {
        return reply.code(404).send({ error: 'Report data not available' });
      }

      const scanMeta = {
        ...scan,
        jurisdictions: scan.jurisdictions.join(', '),
        createdAtDisplay: new Date(scan.createdAt).toLocaleString(),
        completedAtDisplay: scan.completedAt
          ? new Date(scan.completedAt).toLocaleString()
          : '',
      };

      // Compile the print template directly with Handlebars to bypass layout
      const handlebars = (await import('handlebars')).default;
      const viewsDir = resolve(join(__dirname, '..', 'views'));
      const templateSource = await readFile(
        join(viewsDir, 'report-print.hbs'),
        'utf-8',
      );
      const template = handlebars.compile(templateSource);
      const userRole = request.user?.role ?? 'user';
      const perms = (request as unknown as Record<string, unknown>)['permissions'] as Set<string> | undefined ?? new Set<string>();
      const html = template({
        scan: scanMeta,
        reportData,
        userRole,
        isExecutiveView: !perms.has('scans.create') && perms.has('trends.view'),
      });

      return reply.type('text/html').send(html);
    },
  );

  // DELETE /reports/:id — delete scan record and files
  server.delete(
    '/reports/:id',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const scan = await storage.scans.getScan(id);

      if (scan === null) {
        return reply.code(404).send({ error: 'Report not found' });
      }

      const orgId = request.user?.currentOrgId ?? 'system';
      if (scan.orgId !== orgId && scan.orgId !== 'system') {
        return reply.code(404).send({ error: 'Report not found' });
      }

      // Only users with reports.delete permission can delete (or the creator)
      const user = request.user;
      const permsSet = (request as unknown as Record<string, unknown>)['permissions'] as Set<string> | undefined;
      const canDelete = permsSet?.has('reports.delete') === true || scan.createdBy === user?.username;
      if (!canDelete) {
        return reply.code(403).send({ error: 'You can only delete your own reports' });
      }

      // Delete report files
      if (scan.jsonReportPath !== undefined && existsSync(scan.jsonReportPath)) {
        await unlink(scan.jsonReportPath).catch(() => undefined);
      }

      await storage.scans.deleteScan(id);

      // HTMX request — return empty fragment for swap
      if (request.headers['hx-request'] === 'true') {
        return reply.code(200).send('');
      }

      await reply.redirect('/reports');
    },
  );
}
