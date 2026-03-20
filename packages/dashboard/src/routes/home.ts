import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ScanDb } from '../db/scans.js';
import type { DashboardConfig } from '../config.js';
import { listJurisdictions, listRegulations } from '../compliance-client.js';
import { getToken, getOrgId } from './admin/helpers.js';

export async function homeRoutes(
  server: FastifyInstance,
  db: ScanDb,
  config?: DashboardConfig,
): Promise<void> {
  server.get('/', async (_request: FastifyRequest, reply: FastifyReply) => {
    await reply.redirect('/home');
  });

  server.get('/home', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = request.user?.currentOrgId;
    const recentScans = db.listScans({ limit: 10, orgId });

    const allScans = db.listScans({ orgId });
    const totalScans = allScans.length;

    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const scansThisWeek = allScans.filter(
      (s) => s.createdAt >= oneWeekAgo,
    ).length;

    const pagesScanned = allScans.reduce(
      (sum, s) => sum + (s.pagesScanned ?? 0),
      0,
    );
    const issuesFound = allScans.reduce(
      (sum, s) => sum + (s.totalIssues ?? 0),
      0,
    );

    // Load jurisdictions + regulations for quick scan form
    let jurisdictions: Array<{ id: string; name: string }> = [];
    let regulations: Array<{ id: string; name: string; shortName: string; jurisdictionId: string }> = [];
    if (config?.complianceUrl) {
      try {
        const token = getToken(request);
        const rawJ = await listJurisdictions(config.complianceUrl, token, getOrgId(request));
        jurisdictions = rawJ.map((j) => ({ id: j.id, name: j.name }));
        const rawR = await listRegulations(config.complianceUrl, token, undefined, getOrgId(request));
        regulations = rawR.map((r) => ({ id: r.id, name: r.name, shortName: r.shortName, jurisdictionId: r.jurisdictionId }));
      } catch {
        // Non-fatal
      }
    }

    return reply.view('home.hbs', {
      pageTitle: 'Home',
      currentPath: '/home',
      user: request.user,
      stats: {
        totalScans,
        scansThisWeek,
        pagesScanned,
        issuesFound,
      },
      jurisdictions,
      regulations,
      recentScans: recentScans.map((s) => ({
        ...s,
        jurisdictions: s.jurisdictions.join(', '),
        createdAtDisplay: new Date(s.createdAt).toLocaleString(),
        completedAtDisplay: s.completedAt
          ? new Date(s.completedAt).toLocaleString()
          : '',
      })),
    });
  });
}
