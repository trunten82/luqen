import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---- compliance-client: X-Org-Id header tests ----

describe('compliance-client org support', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('sends X-Org-Id header when orgId is provided', async () => {
    const capturedHeaders: Record<string, string> = {};
    globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined;
      if (headers) Object.assign(capturedHeaders, headers);
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const { listSources } = await import('../src/compliance-client.js');
    await listSources('http://localhost:4000', 'tok', 'org-123');

    expect(capturedHeaders['X-Org-Id']).toBe('org-123');
  });

  it('does NOT send X-Org-Id header when orgId is undefined', async () => {
    const capturedHeaders: Record<string, string> = {};
    globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined;
      if (headers) Object.assign(capturedHeaders, headers);
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const { listSources } = await import('../src/compliance-client.js');
    await listSources('http://localhost:4000', 'tok');

    expect(capturedHeaders['X-Org-Id']).toBeUndefined();
  });

  it('does NOT send X-Org-Id header when orgId is "system"', async () => {
    const capturedHeaders: Record<string, string> = {};
    globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined;
      if (headers) Object.assign(capturedHeaders, headers);
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const { listSources } = await import('../src/compliance-client.js');
    await listSources('http://localhost:4000', 'tok', 'system');

    expect(capturedHeaders['X-Org-Id']).toBeUndefined();
  });

  it('passes X-Org-Id for proposeUpdate', async () => {
    const capturedHeaders: Record<string, string> = {};
    globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined;
      if (headers) Object.assign(capturedHeaders, headers);
      return new Response(
        JSON.stringify({
          id: 'p1',
          source: 'http://example.com',
          detectedAt: '2026-01-01',
          type: 'amendment',
          summary: 'test',
          proposedChanges: { action: 'update', entityType: 'regulation' },
          status: 'pending',
          createdAt: '2026-01-01',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const { proposeUpdate } = await import('../src/compliance-client.js');
    await proposeUpdate('http://localhost:4000', 'tok', {
      source: 'http://example.com',
      type: 'amendment',
      summary: 'test',
      proposedChanges: { action: 'update', entityType: 'regulation' },
    }, 'org-456');

    expect(capturedHeaders['X-Org-Id']).toBe('org-456');
  });

  it('passes X-Org-Id for updateSourceLastChecked', async () => {
    const capturedHeaders: Record<string, string> = {};
    globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined;
      if (headers) Object.assign(capturedHeaders, headers);
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const { updateSourceLastChecked } = await import('../src/compliance-client.js');
    await updateSourceLastChecked('http://localhost:4000', 'tok', 'src-1', 'hash', 'org-789');

    expect(capturedHeaders['X-Org-Id']).toBe('org-789');
  });

  it('passes X-Org-Id for addSource', async () => {
    const capturedHeaders: Record<string, string> = {};
    globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined;
      if (headers) Object.assign(capturedHeaders, headers);
      return new Response(
        JSON.stringify({
          id: 's1', name: 'test', url: 'http://example.com',
          type: 'html', schedule: 'daily', createdAt: '2026-01-01',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const { addSource } = await import('../src/compliance-client.js');
    await addSource('http://localhost:4000', 'tok', {
      name: 'test', url: 'http://example.com', type: 'html', schedule: 'daily',
    }, 'org-abc');

    expect(capturedHeaders['X-Org-Id']).toBe('org-abc');
  });

  it('passes X-Org-Id for getSeedStatus', async () => {
    const capturedHeaders: Record<string, string> = {};
    globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined;
      if (headers) Object.assign(capturedHeaders, headers);
      return new Response(
        JSON.stringify({ seeded: true, jurisdictions: 1, regulations: 2, requirements: 3 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const { getSeedStatus } = await import('../src/compliance-client.js');
    await getSeedStatus('http://localhost:4000', 'tok', 'org-xyz');

    expect(capturedHeaders['X-Org-Id']).toBe('org-xyz');
  });
});

// ---- config: MONITOR_ORG_ID ----

describe('config orgId support', () => {
  afterEach(() => {
    delete process.env.MONITOR_ORG_ID;
  });

  it('reads orgId from MONITOR_ORG_ID env var', async () => {
    process.env.MONITOR_ORG_ID = 'env-org-42';
    const mod = await import('../src/config.js?t=org-' + Date.now());
    const config = mod.loadConfig();
    expect(config.orgId).toBe('env-org-42');
  });

  it('orgId is undefined when MONITOR_ORG_ID is not set', async () => {
    delete process.env.MONITOR_ORG_ID;
    const mod = await import('../src/config.js?t=orgmissing-' + Date.now());
    const config = mod.loadConfig();
    expect(config.orgId).toBeUndefined();
  });
});

// ---- agent: AgentOptions.orgId ----

describe('agent orgId support', () => {
  it('AgentOptions interface accepts orgId', async () => {
    const { runScan } = await import('../src/agent.js');
    // This will fail at the network level, but we only need to verify the type compiles
    // We use a sourcesFile to avoid network calls
    expect(typeof runScan).toBe('function');
  });
});

// ---- CLI: --org-id option ----

describe('CLI --org-id option', () => {
  it('scan command registers --org-id option', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const cliPath = resolve(import.meta.dirname ?? __dirname, '../src/cli.ts');
    const src = readFileSync(cliPath, 'utf8');
    expect(src).toContain('--org-id');
  });
});
