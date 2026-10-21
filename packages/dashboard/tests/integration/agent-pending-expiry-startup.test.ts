/**
 * HARD-21: the server declines paused assistant actions older than 24 hours when it starts. The real
 * createServer is booted over a database that was migrated and seeded through SqliteStorageAdapter;
 * DNS and the scan orchestrator are stubbed as the startup readiness test does.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';

vi.mock('../../src/services/host-resolver.js', () => ({
  systemHostResolver: async (): Promise<readonly string[]> => ['93.184.215.14'],
}));

import { createServer } from '../../src/server.js';
import { ScanOrchestrator } from '../../src/scanner/orchestrator.js';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';

let app: FastifyInstance | undefined;
let tmpRoot: string | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  if (app !== undefined) await app.close();
  if (tmpRoot !== undefined) rmSync(tmpRoot, { recursive: true, force: true });
  app = undefined;
  tmpRoot = undefined;
});

describe('HARD-21 paused actions at server start', () => {
  it('HARD-21 the server declines paused actions older than 24 hours when it starts', async () => {
    vi.spyOn(ScanOrchestrator.prototype, 'startScan').mockImplementation(() => undefined as never);
    tmpRoot = mkdtempSync(join(tmpdir(), 'luqen-pending-expiry-'));
    const dbPath = join(tmpRoot, 'dashboard.db');

    const seed = new SqliteStorageAdapter(dbPath);
    await seed.migrate();
    const org = await seed.organizations.createOrg({ name: 'Fabrikam Startup', slug: 'fabrikam-startup' });
    const user = await seed.users.createUser('fabrikam-member', 'Pass-word-123!', 'viewer');
    const make = async (hoursAgo: number): Promise<string> => {
      const conv = await seed.conversations.createConversation({ userId: user.id, orgId: org.id });
      const row = await seed.conversations.appendMessage({
        conversationId: conv.id,
        role: 'tool',
        status: 'pending_confirmation',
        toolCallJson: JSON.stringify({ id: 'p1', name: 'dashboard_scan_site', args: { siteUrl: 'https://fabrikam.example/' } }),
      });
      seed.getRawDatabase().prepare('UPDATE agent_messages SET created_at = ? WHERE id = ?')
        .run(new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString(), row.id);
      return row.id;
    };
    const oldId = await make(25);
    await seed.disconnect();

    app = (await createServer({
      dbPath,
      reportsDir: join(tmpRoot, 'reports'),
      sessionSecret: 'f'.repeat(32),
      catalogueUrl: '',
      catalogueCacheTtl: 0,
      redisUrl: '',
      maxConcurrentScans: 1,
    } as never)) as FastifyInstance;
    await app.ready();

    const check = new Database(dbPath, { readonly: true });
    const statusOf = (id: string): string =>
      (check.prepare('SELECT status FROM agent_messages WHERE id = ?').get(id) as { status: string }).status;
    try {
      expect(statusOf(oldId)).toBe('denied');
    } finally {
      check.close();
    }
  }, 120_000);
});
