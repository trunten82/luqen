import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync, mkdirSync } from 'node:fs';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { ScanOrchestrator } from '../../src/scanner/orchestrator.js';
import { AuthService } from '../../src/auth/auth-service.js';
import { PluginManager } from '../../src/plugins/manager.js';
import { loadRegistry } from '../../src/plugins/registry.js';
import { registerSession } from '../../src/auth/session.js';
import { createAuthGuard } from '../../src/auth/middleware.js';
import { scheduleRoutes, computeNextRunAt } from '../../src/routes/schedules.js';
import { storeApiKey } from '../../src/auth/api-key.js';
import { ALL_PERMISSION_IDS } from '../../src/permissions.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_KEY = process.env['TEST_API_KEY'] ?? 'test-key-' + '0'.repeat(48);
const SESSION_SECRET = 'test-session-secret-at-least-32b';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function buildServer(storage: SqliteStorageAdapter, reportsDir: string): Promise<FastifyInstance> {
  const rawDb = storage.getRawDatabase();

  const registryEntries = loadRegistry();
  const pluginsDir = join(tmpdir(), `test-plugins-${randomUUID()}`);
  mkdirSync(pluginsDir, { recursive: true });
  const pluginManager = new PluginManager({
    db: rawDb,
    pluginsDir,
    encryptionKey: SESSION_SECRET,
    registryEntries,
  });

  const authService = new AuthService(rawDb, pluginManager, storage);

  const server = Fastify({ logger: false });

  await server.register(import('@fastify/formbody'));
  await registerSession(server, SESSION_SECRET);

  // Replace reply.view with JSON stub (scheduleRoutes uses reply.view for GET /schedules)
  server.decorateReply(
    'view',
    function (this: FastifyReply, template: string, data: unknown) {
      return this.code(200).header('content-type', 'application/json').send(
        JSON.stringify({ template, data }),
      );
    },
  );

  // Auth guard
  const authGuard = createAuthGuard(authService);
  server.addHook('preHandler', async (request, reply) => {
    await authGuard(request, reply);
  });

  // Permission loading — grant all permissions to API key user (admin role)
  server.addHook('preHandler', async (request) => {
    if (request.user === undefined) return;
    const permissions = new Set<string>();
    if (request.user.role === 'admin') {
      for (const p of ALL_PERMISSION_IDS) permissions.add(p);
    }
    (request as unknown as Record<string, unknown>)['permissions'] = permissions;
  });

  // CSRF generation stub — scheduleRoutes POST checks for CSRF via @fastify/csrf-protection,
  // but API key auth bypasses session so we skip CSRF for this integration test.
  // The routes use reply.view which expects csrfToken — we inject it here.
  server.addHook('preHandler', async (_request, reply) => {
    // Provide a no-op generateCsrf for views that call it
    if (typeof (reply as Record<string, unknown>).generateCsrf !== 'function') {
      (reply as unknown as Record<string, unknown>).generateCsrf = () => 'test-csrf-token';
    }
  });

  await scheduleRoutes(server, storage);

  await server.ready();
  return server;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Scheduled scans integration', () => {
  let server: FastifyInstance;
  let storage: SqliteStorageAdapter;
  let baseUrl: string;
  let dbPath: string;
  let reportsDir: string;

  beforeAll(async () => {
    dbPath = join(tmpdir(), `test-schedules-${randomUUID()}.db`);
    reportsDir = join(tmpdir(), `test-reports-${randomUUID()}`);
    mkdirSync(reportsDir, { recursive: true });

    storage = new SqliteStorageAdapter(dbPath);
    await storage.migrate();

    // Store the API key
    const rawDb = storage.getRawDatabase();
    storeApiKey(rawDb, API_KEY, 'integration-test');

    server = await buildServer(storage, reportsDir);
    const address = await server.listen({ port: 0, host: '127.0.0.1' });
    baseUrl = address;
  }, 30_000);

  afterAll(async () => {
    await server.close();
    void storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
    if (existsSync(reportsDir)) rmSync(reportsDir, { recursive: true });
  });

  // ── 1. Create a schedule via API ───────────────────────────────────────
  let createdScheduleId: string;

  it('creates a schedule via POST /schedules', async () => {
    const res = await fetch(`${baseUrl}/schedules`, {
      method: 'POST',
      headers: {
        'X-API-Key': API_KEY,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      redirect: 'manual',
      body: new URLSearchParams({
        siteUrl: 'https://test-schedule.example.com',
        standard: 'WCAG2AA',
        frequency: 'daily',
        scanMode: 'site',
        runner: 'htmlcs',
      }).toString(),
    });

    // The route sends a toast HTML response with HX-Redirect header on success
    expect(res.status).toBe(200);

    // Verify it was actually created in the database
    const schedules = await storage.schedules.listSchedules();
    const created = schedules.find((s) => s.siteUrl === 'https://test-schedule.example.com/');
    expect(created).toBeDefined();
    expect(created!.standard).toBe('WCAG2AA');
    expect(created!.frequency).toBe('daily');
    expect(created!.scanMode).toBe('site');
    expect(created!.enabled).toBe(true);
    createdScheduleId = created!.id;
  });

  // ── 2. List schedules — verify it appears ──────────────────────────────
  it('lists schedules and the new one appears', async () => {
    const res = await fetch(`${baseUrl}/schedules`, {
      headers: { 'X-API-Key': API_KEY },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    // The GET handler uses reply.view, which our stub returns as JSON
    expect(body.template).toBe('schedules.hbs');
    expect(body.data.hasSchedules).toBe(true);
    const schedules = body.data.schedules;
    expect(Array.isArray(schedules)).toBe(true);
    const found = schedules.find((s: { id: string }) => s.id === createdScheduleId);
    expect(found).toBeDefined();
    expect(found.siteUrl).toBe('https://test-schedule.example.com/');
  });

  // ── 3. Update schedule (toggle enabled) ────────────────────────────────
  it('toggles schedule enabled state via PATCH', async () => {
    // Initially enabled
    const before = await storage.schedules.getSchedule(createdScheduleId);
    expect(before!.enabled).toBe(true);

    const res = await fetch(`${baseUrl}/schedules/${createdScheduleId}/toggle`, {
      method: 'PATCH',
      headers: { 'X-API-Key': API_KEY },
    });

    expect(res.status).toBe(200);

    // Now should be disabled
    const after = await storage.schedules.getSchedule(createdScheduleId);
    expect(after!.enabled).toBe(false);
  });

  // ── 4. Delete schedule ─────────────────────────────────────────────────
  it('deletes a schedule via DELETE /schedules/:id', async () => {
    const res = await fetch(`${baseUrl}/schedules/${createdScheduleId}`, {
      method: 'DELETE',
      headers: { 'X-API-Key': API_KEY },
    });

    expect(res.status).toBe(200);

    // Verify it is gone
    const schedule = await storage.schedules.getSchedule(createdScheduleId);
    expect(schedule).toBeNull();
  });

  // ── 5. computeNextRunAt calculation accuracy ───────────────────────────
  describe('computeNextRunAt', () => {
    const baseDate = new Date('2026-03-23T12:00:00.000Z');

    it('daily adds exactly 24 hours', () => {
      const next = computeNextRunAt('daily', baseDate);
      const diff = new Date(next).getTime() - baseDate.getTime();
      expect(diff).toBe(24 * 60 * 60 * 1000);
    });

    it('weekly adds exactly 7 days', () => {
      const next = computeNextRunAt('weekly', baseDate);
      const diff = new Date(next).getTime() - baseDate.getTime();
      expect(diff).toBe(7 * 24 * 60 * 60 * 1000);
    });

    it('monthly adds exactly 30 days', () => {
      const next = computeNextRunAt('monthly', baseDate);
      const diff = new Date(next).getTime() - baseDate.getTime();
      expect(diff).toBe(30 * 24 * 60 * 60 * 1000);
    });

    it('unknown frequency defaults to 7 days', () => {
      const next = computeNextRunAt('biweekly', baseDate);
      const diff = new Date(next).getTime() - baseDate.getTime();
      expect(diff).toBe(7 * 24 * 60 * 60 * 1000);
    });

    it('returns a valid ISO string', () => {
      const next = computeNextRunAt('daily', baseDate);
      expect(new Date(next).toISOString()).toBe(next);
    });
  });
});
