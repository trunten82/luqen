import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import type { DashboardConfig } from '../../src/config.js';
import type {
  ServiceConnection,
  ServiceConnectionsRepository,
  ServiceId,
  ServiceConnectionUpsertInput,
} from '../../src/db/service-connections-repository.js';

// ---------------------------------------------------------------------------
// Mocks for ServiceTokenManager and createLLMClient
// ---------------------------------------------------------------------------

const tokenManagerInstances: Array<{
  url: string;
  clientId: string;
  clientSecret: string;
  destroyed: boolean;
  destroy: () => void;
}> = [];

const llmClientInstances: Array<{
  url: string;
  clientId: string;
  clientSecret: string;
  destroyed: boolean;
  destroy: () => void;
}> = [];

vi.mock('../../src/auth/service-token.js', () => {
  return {
    ServiceTokenManager: class {
      public destroyed = false;
      constructor(
        public readonly url: string,
        public readonly clientId: string,
        public readonly clientSecret: string,
      ) {
        const self = this;
        tokenManagerInstances.push({
          url,
          clientId,
          clientSecret,
          destroyed: false,
          destroy: () => {
            self.destroyed = true;
          },
        });
      }
      destroy(): void {
        this.destroyed = true;
        const rec = tokenManagerInstances.find((i) => i.url === this.url && i.clientId === this.clientId && !i.destroyed);
        if (rec) rec.destroyed = true;
      }
    },
  };
});

vi.mock('../../src/llm-client.js', () => {
  class FakeLLMClient {
    public destroyed = false;
    constructor(
      public readonly url: string,
      public readonly clientId: string,
      public readonly clientSecret: string,
    ) {
      const self = this;
      llmClientInstances.push({
        url,
        clientId,
        clientSecret,
        destroyed: false,
        destroy: () => {
          self.destroyed = true;
        },
      });
    }
    destroy(): void {
      this.destroyed = true;
      const rec = llmClientInstances.find((i) => i.url === this.url && i.clientId === this.clientId && !i.destroyed);
      if (rec) rec.destroyed = true;
    }
  }
  return {
    LLMClient: FakeLLMClient,
    createLLMClient: (url: string | undefined, clientId: string, clientSecret: string) => {
      if (!url) return null;
      return new FakeLLMClient(url, clientId, clientSecret);
    },
  };
});

// Import AFTER mocks are set up
const { ServiceClientRegistry } = await import('../../src/services/service-client-registry.js');

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

class InMemoryRepo implements ServiceConnectionsRepository {
  private readonly rows = new Map<ServiceId, ServiceConnection>();

  setRow(row: ServiceConnection): void {
    this.rows.set(row.serviceId, row);
  }

  clearRow(serviceId: ServiceId): void {
    this.rows.delete(serviceId);
  }

  async list(): Promise<ServiceConnection[]> {
    return Array.from(this.rows.values());
  }

  async get(serviceId: ServiceId): Promise<ServiceConnection | null> {
    return this.rows.get(serviceId) ?? null;
  }

  async upsert(input: ServiceConnectionUpsertInput): Promise<ServiceConnection> {
    const row: ServiceConnection = {
      serviceId: input.serviceId,
      url: input.url,
      clientId: input.clientId,
      clientSecret: input.clientSecret ?? '',
      hasSecret: (input.clientSecret ?? '') !== '',
      updatedAt: new Date().toISOString(),
      updatedBy: input.updatedBy,
      source: 'db',
    };
    this.rows.set(input.serviceId, row);
    return row;
  }

  async clearSecret(serviceId: ServiceId, updatedBy: string | null): Promise<void> {
    const existing = this.rows.get(serviceId);
    if (!existing) return;
    this.rows.set(serviceId, { ...existing, clientSecret: '', hasSecret: false, updatedBy, updatedAt: new Date().toISOString() });
  }
}

function makeConfig(overrides: Partial<DashboardConfig> = {}): DashboardConfig {
  return {
    port: 5000,
    complianceUrl: 'http://config-compliance:4000',
    reportsDir: './reports',
    dbPath: ':memory:',
    sessionSecret: 'test-session-secret-long-enough-for-encryption',
    maxConcurrentScans: 2,
    complianceClientId: 'cfg-compliance-id',
    complianceClientSecret: 'cfg-compliance-secret',
    brandingUrl: 'http://config-branding:4100',
    brandingClientId: 'cfg-branding-id',
    brandingClientSecret: 'cfg-branding-secret',
    llmUrl: 'http://config-llm:4200',
    llmClientId: 'cfg-llm-id',
    llmClientSecret: 'cfg-llm-secret',
    pluginsDir: './plugins',
    catalogueCacheTtl: 3600,
    maxPages: 50,
    ...overrides,
  };
}

function makeLogger(): FastifyBaseLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => makeLogger()),
    level: 'info',
    silent: vi.fn(),
  } as unknown as FastifyBaseLogger;
}

function dbRow(serviceId: ServiceId, url: string, clientId: string, clientSecret: string): ServiceConnection {
  return {
    serviceId,
    url,
    clientId,
    clientSecret,
    hasSecret: clientSecret !== '',
    updatedAt: new Date().toISOString(),
    updatedBy: 'test',
    source: 'db',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ServiceClientRegistry', () => {
  beforeEach(() => {
    tokenManagerInstances.length = 0;
    llmClientInstances.length = 0;
  });

  it('create() builds all three clients from DB rows when available', async () => {
    const repo = new InMemoryRepo();
    repo.setRow(dbRow('compliance', 'http://db-compliance:4000', 'db-comp-id', 'db-comp-secret'));
    repo.setRow(dbRow('branding', 'http://db-branding:4100', 'db-brand-id', 'db-brand-secret'));
    repo.setRow(dbRow('llm', 'http://db-llm:4200', 'db-llm-id', 'db-llm-secret'));

    const reg = await ServiceClientRegistry.create(repo, makeConfig(), makeLogger());

    const compliance = reg.getComplianceTokenManager() as unknown as { url: string; clientId: string; clientSecret: string };
    const branding = reg.getBrandingTokenManager() as unknown as { url: string; clientId: string; clientSecret: string };
    const llm = reg.getLLMClient() as unknown as { url: string; clientId: string; clientSecret: string };

    expect(compliance.url).toBe('http://db-compliance:4000');
    expect(compliance.clientId).toBe('db-comp-id');
    expect(compliance.clientSecret).toBe('db-comp-secret');

    expect(branding.url).toBe('http://db-branding:4100');
    expect(branding.clientId).toBe('db-brand-id');

    expect(llm).not.toBeNull();
    expect(llm.url).toBe('http://db-llm:4200');
    expect(llm.clientId).toBe('db-llm-id');
  });

  it('create() falls back to config per-service when DB row is missing (LLM only)', async () => {
    const repo = new InMemoryRepo();
    // Only compliance + branding in DB; LLM missing
    repo.setRow(dbRow('compliance', 'http://db-compliance:4000', 'db-comp-id', 'db-comp-secret'));
    repo.setRow(dbRow('branding', 'http://db-branding:4100', 'db-brand-id', 'db-brand-secret'));

    const reg = await ServiceClientRegistry.create(repo, makeConfig(), makeLogger());

    const compliance = reg.getComplianceTokenManager() as unknown as { url: string };
    const llm = reg.getLLMClient() as unknown as { url: string; clientId: string } | null;

    expect(compliance.url).toBe('http://db-compliance:4000'); // from DB
    expect(llm).not.toBeNull();
    expect(llm!.url).toBe('http://config-llm:4200'); // per-service config fallback (D-14)
    expect(llm!.clientId).toBe('cfg-llm-id');
  });

  it('getLLMClient() returns null when neither DB nor config has LLM URL', async () => {
    const repo = new InMemoryRepo();
    const cfg = makeConfig({ llmUrl: undefined });
    const reg = await ServiceClientRegistry.create(repo, cfg, makeLogger());
    expect(reg.getLLMClient()).toBeNull();
  });

  it('reload(compliance) swaps to new instance and destroys old', async () => {
    const repo = new InMemoryRepo();
    repo.setRow(dbRow('compliance', 'http://old:4000', 'old-id', 'old-secret'));
    repo.setRow(dbRow('branding', 'http://db-branding:4100', 'b', 'b'));
    const reg = await ServiceClientRegistry.create(repo, makeConfig(), makeLogger());

    const original = reg.getComplianceTokenManager();
    const originalUrl = (original as unknown as { url: string }).url;
    expect(originalUrl).toBe('http://old:4000');

    // Simulate admin UI save
    repo.setRow(dbRow('compliance', 'http://new:4000', 'new-id', 'new-secret'));
    await reg.reload('compliance');

    const next = reg.getComplianceTokenManager();
    expect(next).not.toBe(original);
    expect((next as unknown as { url: string }).url).toBe('http://new:4000');
    expect((original as unknown as { destroyed: boolean }).destroyed).toBe(true);
  });

  it('reload failure preserves old client and propagates the error', async () => {
    const repo = new InMemoryRepo();
    repo.setRow(dbRow('compliance', 'http://old:4000', 'old-id', 'old-secret'));
    repo.setRow(dbRow('branding', 'http://db-branding:4100', 'b', 'b'));
    const reg = await ServiceClientRegistry.create(repo, makeConfig(), makeLogger());

    const original = reg.getComplianceTokenManager();

    // Make the repo throw on next get
    const boom = new Error('db blew up');
    repo.get = async () => {
      throw boom;
    };

    await expect(reg.reload('compliance')).rejects.toThrow('db blew up');

    // Old client still active, NOT destroyed
    expect(reg.getComplianceTokenManager()).toBe(original);
    expect((original as unknown as { destroyed: boolean }).destroyed).toBe(false);
  });

  it('destroyAll() destroys all three clients', async () => {
    const repo = new InMemoryRepo();
    repo.setRow(dbRow('compliance', 'http://c:4000', 'c', 'c'));
    repo.setRow(dbRow('branding', 'http://b:4100', 'b', 'b'));
    repo.setRow(dbRow('llm', 'http://l:4200', 'l', 'l'));
    const reg = await ServiceClientRegistry.create(repo, makeConfig(), makeLogger());

    const compliance = reg.getComplianceTokenManager() as unknown as { destroyed: boolean };
    const branding = reg.getBrandingTokenManager() as unknown as { destroyed: boolean };
    const llm = reg.getLLMClient() as unknown as { destroyed: boolean };

    await reg.destroyAll();

    expect(compliance.destroyed).toBe(true);
    expect(branding.destroyed).toBe(true);
    expect(llm.destroyed).toBe(true);
  });

  it('reload(llm) from null to configured builds a new LLM client', async () => {
    const repo = new InMemoryRepo();
    // Start with no LLM config anywhere
    const reg = await ServiceClientRegistry.create(repo, makeConfig({ llmUrl: undefined }), makeLogger());
    expect(reg.getLLMClient()).toBeNull();

    // Admin adds an LLM row via DB
    repo.setRow(dbRow('llm', 'http://db-llm:4200', 'id', 'secret'));
    await reg.reload('llm');

    const llm = reg.getLLMClient();
    expect(llm).not.toBeNull();
    expect((llm as unknown as { url: string }).url).toBe('http://db-llm:4200');
  });
});
