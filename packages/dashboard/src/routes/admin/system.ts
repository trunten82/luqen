import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { safeGetSystemHealth, getSeedStatus } from '../../compliance-client.js';
import { safeGetHealth as safeGetBrandingHealth } from '../../branding-client.js';
import { requirePermission } from '../../auth/middleware.js';
import { statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getToken, toastHtml, escapeHtml } from './helpers.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

async function getPackageVersion(): Promise<string> {
  try {
    const pkgPath = resolve(join(__dirname, '..', '..', '..', 'package.json'));
    const raw = await readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function systemRoutes(
  server: FastifyInstance,
  config: { complianceUrl: string; brandingUrl?: string; webserviceUrl?: string; dbPath: string },
): Promise<void> {
  // GET /admin/system — service health, DB stats, seed status
  server.get(
    '/admin/system',
    { preHandler: requirePermission('admin.system') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const token = getToken(request);

      const [complianceHealth, , seedStatus, packageVersion, brandingHealth] =
        await Promise.allSettled([
          safeGetSystemHealth(config.complianceUrl, config.webserviceUrl),
          Promise.resolve(undefined), // pa11y health is part of getSystemHealth
          getSeedStatus(config.complianceUrl, token),
          getPackageVersion(),
          config.brandingUrl != null ? safeGetBrandingHealth(config.brandingUrl) : Promise.resolve(null),
        ]);

      const complianceStatus =
        complianceHealth.status === 'fulfilled'
          ? complianceHealth.value.compliance.status
          : 'error';

      // Pa11y scanner: if no webserviceUrl, scanner is built-in and always available
      let pa11yStatus: string;
      let pa11yLabel: string;
      if (!config.webserviceUrl) {
        pa11yStatus = 'ok';
        pa11yLabel = 'Scanner (built-in pa11y)';
      } else if (complianceHealth.status === 'fulfilled' && complianceHealth.value.pa11y !== undefined) {
        pa11yStatus = complianceHealth.value.pa11y.status;
        pa11yLabel = 'Pa11y Webservice';
      } else {
        pa11yStatus = 'unknown';
        pa11yLabel = 'Pa11y Webservice';
      }

      // Branding service status
      let brandingStatus: string;
      if (config.brandingUrl == null) {
        brandingStatus = 'unknown';
      } else if (brandingHealth.status === 'fulfilled' && brandingHealth.value != null) {
        brandingStatus = brandingHealth.value.status === 'ok' ? 'ok' : 'error';
      } else {
        brandingStatus = 'error';
      }

      // Database stats
      let dbSizeBytes = 0;
      try {
        dbSizeBytes = statSync(config.dbPath).size;
      } catch {
        // file may not exist yet
      }

      const dbSizeKb = (dbSizeBytes / 1024).toFixed(1);

      const version =
        packageVersion.status === 'fulfilled' ? (packageVersion.value as string) : 'unknown';

      const seed =
        seedStatus.status === 'fulfilled'
          ? seedStatus.value
          : { seeded: false, jurisdictions: 0, regulations: 0, requirements: 0 };

      const uptimeSeconds = Math.floor(process.uptime());
      const uptimeDisplay = formatUptime(uptimeSeconds);

      return reply.view('admin/system.hbs', {
        pageTitle: 'System Health',
        currentPath: '/admin/system',
        user: request.user,
        services: {
          dashboard: { status: 'ok', label: 'Dashboard' },
          compliance: { status: complianceStatus, label: 'Compliance Service' },
          pa11y: { status: pa11yStatus, label: pa11yLabel },
          branding: { status: brandingStatus, label: 'Branding Service' },
        },
        db: {
          sizeKb: dbSizeKb,
        },
        seed,
        version,
        nodeVersion: process.version,
        uptime: uptimeDisplay,
      });
    },
  );
  // POST /admin/system/reseed — trigger compliance data reseed
  server.post(
    '/admin/system/reseed',
    { preHandler: requirePermission('admin.system') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const token = getToken(request);
      try {
        const response = await fetch(`${config.complianceUrl}/api/v1/admin/reseed`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: '{}',
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = await response.json() as Record<string, unknown>;
        const timestamp = new Date().toLocaleString();
        const statusUpdate = `<span id="reseed-status" hx-swap-oob="innerHTML" class="text-sm text-muted">Last reseeded: ${escapeHtml(timestamp)}</span>`;
        return reply
          .header('content-type', 'text/html')
          .send(toastHtml(`Compliance data reseeded: ${result.requirements} requirements across ${result.regulations} regulations.`) + statusUpdate);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Reseed failed';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}
