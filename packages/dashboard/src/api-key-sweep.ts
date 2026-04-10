/**
 * api-key-sweep.ts
 *
 * Standalone helper that revokes expired API keys and writes a single
 * summary audit entry when any keys are affected. Extracted from server.ts
 * for testability (no Fastify instance required).
 *
 * Phase 14-02 — APIKEY-04
 */

import type { StorageAdapter } from './db/index.js';
import type { FastifyBaseLogger } from 'fastify';

export async function runApiKeySweep(
  storage: StorageAdapter,
  log: FastifyBaseLogger,
  trigger: 'startup' | 'interval',
): Promise<number> {
  try {
    const count = await storage.apiKeys.revokeExpiredKeys();
    if (count > 0) {
      const at = new Date().toISOString();
      log.info(
        { event: 'api_key.auto_revoke', count, at, trigger },
        `Auto-revoked ${count} expired API keys (${trigger})`,
      );
      void storage.audit.log({
        actor: 'system',
        action: 'api_key.auto_revoke',
        resourceType: 'api_key',
        resourceId: 'sweep',
        details: { count, trigger },
      });
    }
    return count;
  } catch (err) {
    log.warn({ err }, `api_key sweep failed (${trigger})`);
    return 0;
  }
}
