import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import { registerSession } from '../../src/auth/session.js';
import { ALL_PERMISSION_IDS } from '../../src/permissions.js';

// Mock the compliance + branding client modules BEFORE importing systemRoutes.
// These mocks return deterministic healthy responses so the test asserts the
// rendering path, not the health polling logic.
vi.mock('../../src/compliance-client.js', async () => {
  return {
    safeGetSystemHealth: vi.fn(async () => ({
      compliance: { status: 'ok' },
      pa11y: { status: 'ok' },
    })),
    getSeedStatus: vi.fn(async () => ({
      seeded: true,
      jurisdictions: 1,
      regulations: 1,
      requirements: 1,
    })),
  };
});

vi.mock('../../src/branding-client.js', async () => {
  return {
    safeGetHealth: vi.fn(async () => ({ status: 'ok' })),
  };
});

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';

interface TestContext {
  server: FastifyInstance;
  dbPath: string;
  cleanup: () => void;
}

async function createTestServer(): Promise<TestContext> {
  const dbPath = join(tmpdir(), `test-system-${randomUUID()}.db`);

  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));
  await registerSession(server, TEST_SESSION_SECRET);

  server.decorateReply(
    'view',
    function (this: FastifyReply, template: string, data: unknown) {
      return this.code(200)
        .header('content-type', 'application/json')
        .send(JSON.stringify({ template, data }));
    },
  );

  server.addHook('preHandler', async (request) => {
    request.user = { id: 'test-user-id', username: 'testadmin', role: 'admin' };
    const permissions = new Set(ALL_PERMISSION_IDS);
    (request as unknown as Record<string, unknown>)['permissions'] = permissions;
  });

  // Dynamic import AFTER the vi.mock calls so the mocks are in place.
  const { systemRoutes } = await import('../../src/routes/admin/system.js');
  await systemRoutes(server, {
    complianceUrl: 'http://compliance.test',
    brandingUrl: 'http://branding.test',
    dbPath,
  });
  await server.ready();

  const cleanup = (): void => {
    if (existsSync(dbPath)) rmSync(dbPath);
    void server.close();
  };

  return { server, dbPath, cleanup };
}

describe('admin system branding parity — BUI-04', () => {
  let ctx: TestContext;
  beforeEach(async () => { ctx = await createTestServer(); });
  afterEach(() => { ctx.cleanup(); });

  it('services.branding is present and healthy alongside compliance/llm/pa11y/dashboard', async () => {
    const res = await ctx.server.inject({ method: 'GET', url: '/admin/system' });
    expect(res.statusCode).toBe(200);

    const body = res.json() as {
      template: string;
      data: {
        services: Record<
          string,
          { status: string; label: string }
        >;
      };
    };

    expect(body.template).toBe('admin/system.hbs');
    expect(body.data.services).toBeDefined();

    // All five expected services present.
    expect(body.data.services).toHaveProperty('dashboard');
    expect(body.data.services).toHaveProperty('compliance');
    expect(body.data.services).toHaveProperty('pa11y');
    expect(body.data.services).toHaveProperty('branding');
    expect(body.data.services).toHaveProperty('llm');

    // Branding status is 'ok' under the healthy stub.
    expect(body.data.services.branding.status).toBe('ok');
    expect(body.data.services.branding.label).toBe('Branding Service');
  });

  it('services.branding keys are EXACTLY the same as services.compliance and services.llm keys — structural parity lock', async () => {
    const res = await ctx.server.inject({ method: 'GET', url: '/admin/system' });
    const body = res.json() as {
      data: {
        services: Record<string, Record<string, unknown>>;
      };
    };

    const brandingKeys = Object.keys(body.data.services.branding).sort();
    const complianceKeys = Object.keys(body.data.services.compliance).sort();
    const llmKeys = Object.keys(body.data.services.llm).sort();

    expect(brandingKeys).toEqual(complianceKeys);
    expect(brandingKeys).toEqual(llmKeys);
    // Belt and braces: lock the exact shape so a future field drift is caught.
    expect(brandingKeys).toEqual(['label', 'status']);
  });
});
