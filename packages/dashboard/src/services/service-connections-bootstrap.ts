import type { FastifyBaseLogger } from 'fastify';
import type { DashboardConfig } from '../config.js';
import type {
  ServiceConnectionsRepository,
  ServiceId,
} from '../db/service-connections-repository.js';

/**
 * Bootstrap helper: import service connections from the config file into the
 * DB on first boot, but only when the `service_connections` table is empty.
 *
 * Rules (phase 06 D-13..D-15):
 *   1. If `repo.list()` already has rows → no-op.
 *   2. Otherwise, for each of the three fixed services, read its URL from
 *      config. If the URL is truthy, insert a row via `repo.upsert(...)` with
 *      `updated_by = 'bootstrap-from-config'`. If the URL is missing/empty,
 *      skip that service — it falls back to config at request time via
 *      per-service fallback in the admin route handler (D-14).
 *   3. The config file itself is NEVER rewritten (D-15). This helper only
 *      reads from config and writes to the DB.
 */

interface ServiceBootstrapMapping {
  readonly serviceId: ServiceId;
  readonly url: string | undefined;
  readonly clientId: string;
  readonly clientSecret: string;
}

function mappingsFromConfig(
  config: DashboardConfig,
): readonly ServiceBootstrapMapping[] {
  return [
    {
      serviceId: 'compliance',
      url: config.complianceUrl,
      clientId: config.complianceClientId ?? '',
      clientSecret: config.complianceClientSecret ?? '',
    },
    {
      serviceId: 'branding',
      url: config.brandingUrl,
      clientId: config.brandingClientId ?? '',
      clientSecret: config.brandingClientSecret ?? '',
    },
    {
      serviceId: 'llm',
      url: config.llmUrl,
      clientId: config.llmClientId ?? '',
      clientSecret: config.llmClientSecret ?? '',
    },
  ];
}

export async function importFromConfigIfEmpty(
  repo: ServiceConnectionsRepository,
  config: DashboardConfig,
  logger: FastifyBaseLogger,
): Promise<void> {
  const existing = await repo.list();
  if (existing.length > 0) {
    return;
  }

  for (const mapping of mappingsFromConfig(config)) {
    if (mapping.url === undefined || mapping.url === '') {
      // Per D-14: skip this service. The admin route will synthesize a
      // 'config'-sourced row on demand for services that remain unconfigured.
      continue;
    }

    await repo.upsert({
      serviceId: mapping.serviceId,
      url: mapping.url,
      clientId: mapping.clientId,
      clientSecret: mapping.clientSecret,
      updatedBy: 'bootstrap-from-config',
    });

    logger.info(
      { serviceId: mapping.serviceId },
      'Imported service connection from config',
    );
  }
}
