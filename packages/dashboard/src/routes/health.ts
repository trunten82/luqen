/**
 * GET /health — unauthenticated (PUBLIC_PATHS). Reports whether a Chromium
 * binary is resolvable, without leaking filesystem paths to a public,
 * unauthenticated reader (T-hkw-04). The tried paths and the resolved
 * executable path go to the server LOG instead — see {@link logBrowserResolution},
 * called once at startup.
 *
 * DECISION (BROWSER-HEALTH-1, reversible): HTTP 200 + 'degraded' rather than
 * 503 when no browser resolves, because non-scan dashboard features keep
 * working and a 503 would make uptime monitors / load balancers treat the
 * whole dashboard as down. This narrows the relayed recommendation ("/health
 * reports ... with the tried paths") for the disclosure reason above.
 */

import type { FastifyInstance, FastifyBaseLogger } from 'fastify';
import type { ChromiumProbe } from '@luqen/core';

export interface HealthRouteDeps {
  readonly version: string;
  readonly probe: () => Promise<ChromiumProbe>;
}

export async function registerHealthRoute(server: FastifyInstance, deps: HealthRouteDeps): Promise<void> {
  server.get('/health', async (_request, _reply) => {
    const probeResult = await deps.probe();
    return {
      status: probeResult.ok ? 'ok' : 'degraded',
      version: deps.version,
      checks: {
        browser: probeResult.ok
          ? { status: 'ok', source: probeResult.source }
          : { status: 'failed' },
      },
    };
  });
}

/**
 * Called once at startup. Logs at ERROR (never suppressed — production log
 * level is 'warn') when no browser resolves, naming every tried path and the
 * consequence (scans, browser discovery fallback, ACR PDFs will fail). Logs
 * at INFO (suppressed in production) on success.
 */
export function logBrowserResolution(log: FastifyBaseLogger, probe: ChromiumProbe): void {
  if (probe.ok) {
    log.info({ executablePath: probe.executablePath, source: probe.source }, 'Chromium resolved');
    return;
  }
  log.error(
    { tried: probe.tried },
    'No Chromium/Chrome executable could be resolved — scans, the browser discovery fallback, ' +
      'and ACR PDF rendering will fail. Set PUPPETEER_EXECUTABLE_PATH or install a system Chromium.',
  );
}
