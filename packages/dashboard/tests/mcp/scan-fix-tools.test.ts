/**
 * scan-fix-tools.test.ts — Module-level tests for dashboard_scan_page
 * and dashboard_generate_fix MCP tools.
 *
 * Both tools are exercised directly via registerScanTools/registerFixTools
 * on a fresh McpServer instance (InMemoryTransport + Client). No
 * registerMcpRoutes wiring is used here — that integration belongs to Plan 03.
 *
 * Test groups:
 *   "dashboard_scan_page"  — findings shape, SSRF block, error paths
 *   "dashboard_generate_fix" — enriched fix payload, legalContext degrade,
 *                              platform forwarding, disclaimer, LLM error
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerScanTools } from '../../src/mcp/tools/scan.js';
import { registerFixTools, DRAFT_DISCLAIMER } from '../../src/mcp/tools/fix.js';
import type { DirectScanner } from '@luqen/core';

// ---------------------------------------------------------------------------
// Shared stub factories (copied verbatim from compliance-tools.test.ts pattern)
// ---------------------------------------------------------------------------

// (These are kept for parity with the compliance test pattern; not all are
// used directly here since we bypass registerMcpRoutes.)

// ---------------------------------------------------------------------------
// McpServer helpers
// ---------------------------------------------------------------------------

async function makeServerAndClient(
  configure: (server: McpServer) => void,
): Promise<{ client: Client; closeAll: () => Promise<void> }> {
  const server = new McpServer(
    { name: 'test', version: '0.0.0' },
    { capabilities: { tools: {} } },
  );
  configure(server);

  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return {
    client,
    closeAll: async () => {
      await client.close();
    },
  };
}

function parseToolText(result: Awaited<ReturnType<Client['callTool']>>): Record<string, unknown> {
  const text = (result.content[0] as { text: string }).text;
  return JSON.parse(text) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Stub scanner
// ---------------------------------------------------------------------------

const FAKE_ISSUE = {
  code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
  type: 'error',
  message: 'img element missing non-empty alt attribute',
  selector: '#main img',
  context: '<img src="logo.png">',
  runner: 'htmlcs',
};

function makeStubScanner(
  issues: DirectScanResult['issues'] = [FAKE_ISSUE],
  throws?: Error,
): DirectScanner {
  return {
    scan: throws !== undefined
      ? async () => { throw throws; }
      : async () => ({ url: 'http://example.com', issues }),
  } as unknown as DirectScanner;
}

// ---------------------------------------------------------------------------
// Stub LLM access and fetch
// ---------------------------------------------------------------------------

const FAKE_FIX_RESPONSE = {
  fixedHtml: '<img src="logo.png" alt="Company logo">',
  explanation: 'Added descriptive alt text.',
  effort: 'low',
  wcagCriterion: '1.1.1',
  diff: '- <img src="logo.png">\n+ <img src="logo.png" alt="Company logo">',
};

// ============================================================================
// TEST SUITE: dashboard_scan_page
// ============================================================================

describe('dashboard_scan_page', () => {
  let client: Client;
  let closeAll: () => Promise<void>;

  afterEach(async () => {
    if (closeAll !== undefined) await closeAll();
    vi.restoreAllMocks();
  });

  it('returns structured findings array with expected shape from html input', async () => {
    const scanner = makeStubScanner([FAKE_ISSUE]);
    ({ client, closeAll } = await makeServerAndClient((server) => {
      registerScanTools(server, { scanner });
    }));

    const result = await client.callTool({
      name: 'dashboard_scan_page',
      arguments: { html: '<img src="logo.png">' },
    });

    expect(result.isError).toBeFalsy();
    const body = parseToolText(result);
    const findings = body['findings'] as Array<Record<string, unknown>>;
    expect(Array.isArray(findings)).toBe(true);
    expect(findings.length).toBeGreaterThan(0);

    const finding = findings[0];
    expect(typeof finding['code']).toBe('string');
    expect(typeof finding['type']).toBe('string');
    expect(typeof finding['message']).toBe('string');
    expect(typeof finding['selector']).toBe('string');
    expect(typeof finding['context']).toBe('string');
    expect(typeof finding['runner']).toBe('string');

    // meta block
    const meta = body['meta'] as Record<string, unknown>;
    expect(typeof meta['count']).toBe('number');
    expect(typeof meta['standard']).toBe('string');
  });

  it('returns isError:true for a private/internal url (SSRF blocked)', async () => {
    const scanner = makeStubScanner();
    const scanSpy = vi.spyOn(scanner, 'scan');

    ({ client, closeAll } = await makeServerAndClient((server) => {
      registerScanTools(server, { scanner });
    }));

    const result = await client.callTool({
      name: 'dashboard_scan_page',
      arguments: { url: 'http://127.0.0.1/admin' },
    });

    expect(result.isError).toBe(true);
    const body = parseToolText(result);
    expect(typeof body['error']).toBe('string');
    // The scanner must NOT have been invoked (SSRF guard fires first)
    expect(scanSpy).not.toHaveBeenCalled();
  });

  it('returns isError:true for localhost url (SSRF blocked)', async () => {
    const scanner = makeStubScanner();
    const scanSpy = vi.spyOn(scanner, 'scan');

    ({ client, closeAll } = await makeServerAndClient((server) => {
      registerScanTools(server, { scanner });
    }));

    const result = await client.callTool({
      name: 'dashboard_scan_page',
      arguments: { url: 'http://localhost:8080/private' },
    });

    expect(result.isError).toBe(true);
    expect(scanSpy).not.toHaveBeenCalled();
  });

  it('returns isError:true when neither url nor html is supplied', async () => {
    const scanner = makeStubScanner();

    ({ client, closeAll } = await makeServerAndClient((server) => {
      registerScanTools(server, { scanner });
    }));

    const result = await client.callTool({
      name: 'dashboard_scan_page',
      arguments: {},
    });

    expect(result.isError).toBe(true);
    const body = parseToolText(result);
    expect(typeof body['error']).toBe('string');
  });

  it('returns isError:true (graceful) when the scanner throws', async () => {
    const scanner = makeStubScanner([], new Error('Chromium unavailable'));

    ({ client, closeAll } = await makeServerAndClient((server) => {
      registerScanTools(server, { scanner });
    }));

    const result = await client.callTool({
      name: 'dashboard_scan_page',
      arguments: { html: '<div>test</div>' },
    });

    expect(result.isError).toBe(true);
    const body = parseToolText(result);
    expect(typeof body['error']).toBe('string');
  });
});

// ============================================================================
// TEST SUITE: dashboard_generate_fix
// ============================================================================

describe('dashboard_generate_fix', () => {
  let client: Client;
  let closeAll: () => Promise<void>;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    if (closeAll !== undefined) await closeAll();
    vi.restoreAllMocks();
  });

  function makeLlmAccess(
    response: Record<string, unknown> | null = FAKE_FIX_RESPONSE,
    shouldFail = false,
  ): () => Promise<{ baseUrl: string; token: string } | null> {
    return async () => {
      if (response === null) return null;
      return { baseUrl: 'http://llm-service', token: 'test-token' };
    };
  }

  function makeComplianceAccess(
    result: Record<string, unknown> | null = { matrix: {}, issueAnnotations: new Map(), summary: {} },
  ): () => Promise<{ baseUrl: string; token: string } | null> {
    return async () => {
      if (result === null) return null;
      return { baseUrl: 'http://compliance-service', token: 'compliance-token' };
    };
  }

  it('happy path: returns wcagCriterion (echoed), diff, fixedHtml, explanation, effort, legalContext, disclaimer', async () => {
    // Stub global fetch for the LLM call
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('generate-fix')) {
        return {
          ok: true,
          json: async () => FAKE_FIX_RESPONSE,
        };
      }
      // compliance fetch
      return {
        ok: true,
        json: async () => ({
          matrix: {},
          annotatedIssues: [],
          summary: { totalJurisdictions: 0, passing: 0, failing: 0, totalMandatoryViolations: 0, totalOptionalViolations: 0 },
        }),
      };
    }));

    ({ client, closeAll } = await makeServerAndClient((server) => {
      registerFixTools(server, {
        llmAccess: makeLlmAccess(),
        complianceAccess: makeComplianceAccess(),
      });
    }));

    const result = await client.callTool({
      name: 'dashboard_generate_fix',
      arguments: {
        wcagCriterion: '1.1.1',
        issueMessage: 'img element missing alt',
        htmlContext: '<img src="logo.png">',
      },
    });

    expect(result.isError).toBeFalsy();
    const body = parseToolText(result);
    expect(body['wcagCriterion']).toBe('1.1.1');
    expect(typeof body['diff']).toBe('string');
    expect(typeof body['fixedHtml']).toBe('string');
    expect(typeof body['explanation']).toBe('string');
    expect(typeof body['effort']).toBe('string');
    expect('legalContext' in body).toBe(true);
    expect(typeof body['disclaimer']).toBe('string');
  });

  it('gracefully degrades legalContext to null when compliance unavailable (no isError)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('generate-fix')) {
        return {
          ok: true,
          json: async () => FAKE_FIX_RESPONSE,
        };
      }
      throw new Error('compliance unreachable');
    }));

    ({ client, closeAll } = await makeServerAndClient((server) => {
      registerFixTools(server, {
        llmAccess: makeLlmAccess(),
        complianceAccess: makeComplianceAccess(null),
      });
    }));

    const result = await client.callTool({
      name: 'dashboard_generate_fix',
      arguments: {
        wcagCriterion: '1.1.1',
        issueMessage: 'img element missing alt',
        htmlContext: '<img src="logo.png">',
      },
    });

    // Must NOT be an error
    expect(result.isError).toBeFalsy();
    const body = parseToolText(result);
    expect(body['legalContext']).toBeNull();
    // disclaimer still present
    expect(typeof body['disclaimer']).toBe('string');
  });

  it('forwards platform to the LLM request body', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('generate-fix')) {
        capturedBody = JSON.parse((init?.body as string) ?? '{}') as Record<string, unknown>;
        return {
          ok: true,
          json: async () => FAKE_FIX_RESPONSE,
        };
      }
      return {
        ok: true,
        json: async () => ({
          matrix: {},
          annotatedIssues: [],
          summary: { totalJurisdictions: 0, passing: 0, failing: 0, totalMandatoryViolations: 0, totalOptionalViolations: 0 },
        }),
      };
    }));

    ({ client, closeAll } = await makeServerAndClient((server) => {
      registerFixTools(server, {
        llmAccess: makeLlmAccess(),
        complianceAccess: makeComplianceAccess(),
      });
    }));

    await client.callTool({
      name: 'dashboard_generate_fix',
      arguments: {
        wcagCriterion: '1.1.1',
        issueMessage: 'img element missing alt',
        htmlContext: '<img src="logo.png">',
        platform: 'wordpress-gutenberg',
      },
    });

    expect(capturedBody).not.toBeNull();
    expect(capturedBody!['platform']).toBe('wordpress-gutenberg');
  });

  it('returns isError:true when LLM is unavailable', async () => {
    ({ client, closeAll } = await makeServerAndClient((server) => {
      registerFixTools(server, {
        llmAccess: async () => null,
        complianceAccess: makeComplianceAccess(),
      });
    }));

    const result = await client.callTool({
      name: 'dashboard_generate_fix',
      arguments: {
        wcagCriterion: '1.1.1',
        issueMessage: 'img element missing alt',
        htmlContext: '<img src="logo.png">',
      },
    });

    expect(result.isError).toBe(true);
    const body = parseToolText(result);
    expect(typeof body['error']).toBe('string');
  });

  it('(D-10) disclaimer does not contain forbidden asserting language', () => {
    expect(DRAFT_DISCLAIMER).toBeDefined();
    // Must not contain asserting/overclaiming language
    expect(DRAFT_DISCLAIMER.toLowerCase()).not.toMatch(/\bcompliant\b/);
    expect(DRAFT_DISCLAIMER).not.toContain('100%');
    expect(DRAFT_DISCLAIMER).not.toContain('lawsuit-proof');
    // Must frame output as a draft for human review
    expect(DRAFT_DISCLAIMER.toLowerCase()).toContain('draft');
    expect(DRAFT_DISCLAIMER.toLowerCase()).toContain('human review');
  });
});
