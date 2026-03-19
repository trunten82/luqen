import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { readFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { ScanDb } from '../db/scans.js';

interface ReportsQuery {
  q?: string;
  status?: string;
  offset?: string;
  limit?: string;
}

const PAGE_SIZE = 20;

export async function reportRoutes(
  server: FastifyInstance,
  db: ScanDb,
): Promise<void> {
  // GET /reports — list with pagination and search
  server.get(
    '/reports',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as ReportsQuery;
      const offset = query.offset !== undefined ? parseInt(query.offset, 10) : 0;
      const limit = query.limit !== undefined ? parseInt(query.limit, 10) : PAGE_SIZE;
      const q = query.q?.trim();
      const status = query.status;

      const scans = db.listScans({
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

      const formatted = page.map((s) => ({
        ...s,
        jurisdictions: s.jurisdictions.join(', '),
        createdAtDisplay: new Date(s.createdAt).toLocaleString(),
        completedAtDisplay: s.completedAt
          ? new Date(s.completedAt).toLocaleString()
          : '',
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

  // GET /reports/:id — render report viewer
  server.get(
    '/reports/:id',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const scan = db.getScan(id);

      if (scan === null) {
        return reply.code(404).send({ error: 'Report not found' });
      }

      return reply.view('report-view.hbs', {
        pageTitle: `Report — ${scan.siteUrl}`,
        currentPath: `/reports/${id}`,
        user: request.user,
        scan: {
          ...scan,
          jurisdictions: scan.jurisdictions.join(', '),
          createdAtDisplay: new Date(scan.createdAt).toLocaleString(),
          completedAtDisplay: scan.completedAt
            ? new Date(scan.completedAt).toLocaleString()
            : '',
          hasHtmlReport:
            scan.htmlReportPath !== undefined &&
            existsSync(scan.htmlReportPath),
        },
      });
    },
  );

  // GET /reports/:id/raw — serve raw HTML report
  server.get(
    '/reports/:id/raw',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const scan = db.getScan(id);

      if (scan === null || scan.htmlReportPath === undefined) {
        return reply.code(404).send({ error: 'Report not found' });
      }

      if (!existsSync(scan.htmlReportPath)) {
        return reply.code(404).send({ error: 'Report file not found on disk' });
      }

      try {
        const html = await readFile(scan.htmlReportPath, 'utf-8');
        return reply.type('text/html').send(html);
      } catch {
        return reply.code(500).send({ error: 'Failed to read report file' });
      }
    },
  );

  // DELETE /reports/:id — delete scan record and files
  server.delete(
    '/reports/:id',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const scan = db.getScan(id);

      if (scan === null) {
        return reply.code(404).send({ error: 'Report not found' });
      }

      // Only the creator or admin can delete
      const user = request.user;
      if (
        user?.role !== 'admin' &&
        scan.createdBy !== user?.username
      ) {
        return reply.code(403).send({ error: 'You can only delete your own reports' });
      }

      // Delete report files
      if (scan.htmlReportPath !== undefined && existsSync(scan.htmlReportPath)) {
        await unlink(scan.htmlReportPath).catch(() => undefined);
      }
      if (scan.jsonReportPath !== undefined && existsSync(scan.jsonReportPath)) {
        await unlink(scan.jsonReportPath).catch(() => undefined);
      }

      db.deleteScan(id);

      // HTMX request — return empty fragment for swap
      if (request.headers['hx-request'] === 'true') {
        return reply.code(200).send('');
      }

      await reply.redirect('/reports');
    },
  );
}
