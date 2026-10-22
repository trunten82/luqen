/**
 * fix-entitlement.test.ts — ENT-01 / ENT-02 / ENT-03 for MCP dashboard_generate_fix.
 *
 * Contract (owner ruling, phase 93 D-01/D-02): the tool returns LLM output
 * only to a caller whose ToolContext holds llm.view. A caller with issues.fix
 * but without llm.view keeps the tool and receives the deterministic pattern
 * hint (the same getFixSuggestion answer the report page falls back to); the
 * LLM credentials are never resolved and the LLM service is never reached.
 * A call with no tool context at all is treated as not entitled (fail closed).
 *
 * Handler-level: registerFixTools on a fresh McpServer + InMemoryTransport.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { runInToolContext, type ToolContext } from '@luqen/core/mcp';
import {
  registerFixTools,
  DRAFT_DISCLAIMER,
  PATTERN_HINT_NOTE,
  PATTERN_NO_MATCH_NOTE,
  mayReceiveAiFix,
  toDottedCriterion,
} from '../../src/mcp/tools/fix.js';
import { getFixSuggestion } from '../../src/fix-suggestions.js';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync, mkdirSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { registerSession } from '../../src/auth/session.js';
import { reportRoutes } from '../../src/routes/reports.js';
import type { LLMClient } from '../../src/llm-client.js';
import { loadTranslations, t } from '../../src/i18n/index.js';

loadTranslations();

const FAKE_AI_FIX = {
  fixedHtml: '<img src="logo.png" alt="Fabrikam logo">',
  explanation: 'Added descriptive alt text.',
  effort: 'low',
  wcagCriterion: '1.1.1',
  diff: '- <img src="logo.png">\n+ <img src="logo.png" alt="Fabrikam logo">',
};

const IMG_MESSAGE = 'Img element missing an alt attribute';
const NO_MATCH_MESSAGE = 'Zzz a message that no pattern in the table can match';

function contextWith(permissions: readonly string[]): ToolContext {
  return {
    orgId: 'org-fabrikam',
    userId: 'user-northwind',
    scopes: ['read'],
    permissions: new Set<string>(permissions),
    authType: 'jwt',
  };
}

const FIXER = contextWith(['issues.fix', 'mcp.use']);
const AI_CALLER = contextWith(['issues.fix', 'llm.view', 'mcp.use']);

async function makeClient(
  llmAccess: () => Promise<{ baseUrl: string; token: string } | null>,
): Promise<{ client: Client; close: () => Promise<void> }> {
  const server = new McpServer(
    { name: 'test', version: '0.0.0' },
    { capabilities: { tools: {} } },
  );
  registerFixTools(server, { llmAccess });
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, close: async () => { await client.close(); } };
}

type CallResult = Awaited<ReturnType<Client['callTool']>>;

function bodyOf(result: CallResult): Record<string, unknown> {
  return JSON.parse((result.content as Array<{ text: string }>)[0]!.text) as Record<string, unknown>;
}

describe('MCP dashboard_generate_fix entitlement', () => {
  let close: (() => Promise<void>) | undefined;
  let llmAccess: ReturnType<typeof vi.fn>;
  let fetchedUrls: string[];

  beforeEach(() => {
    fetchedUrls = [];
    llmAccess = vi.fn(async () => ({ baseUrl: 'http://llm.test', token: 'tok-fabrikam' }));
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      fetchedUrls.push(String(url));
      return { ok: true, json: async () => FAKE_AI_FIX };
    }));
  });

  afterEach(async () => {
    if (close !== undefined) await close();
    close = undefined;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function call(
    context: ToolContext | null,
    args: Record<string, unknown> = {
      wcagCriterion: '1.1.1',
      issueMessage: IMG_MESSAGE,
      htmlContext: '<img src="logo.png">',
    },
  ): Promise<CallResult> {
    const built = await makeClient(llmAccess as never);
    close = built.close;
    const run = () => built.client.callTool({ name: 'dashboard_generate_fix', arguments: args });
    return context === null ? run() : runInToolContext(context, run);
  }

  it('ENT-01 a fixer without llm.view gets the pattern hint and llmAccess is never invoked', async () => {
    const result = await call(FIXER);
    expect(result.isError).toBeFalsy();
    const body = bodyOf(result);
    expect(body['source']).toBe('pattern');
    const expected = getFixSuggestion('1.1.1', IMG_MESSAGE);
    expect(expected).not.toBeNull();
    expect(body['hint']).toEqual({
      title: expected!.title,
      description: expected!.description,
      codeExample: expected!.codeExample,
      effort: expected!.effort,
    });
    expect(body['disclaimer']).toBe(DRAFT_DISCLAIMER);
    expect(body['fixedHtml']).toBeUndefined();
    expect(llmAccess).not.toHaveBeenCalled();
  });

  it('ENT-01 a fixer without llm.view makes no request to the generate-fix endpoint', async () => {
    await call(FIXER);
    expect(fetchedUrls.filter((u) => u.includes('generate-fix'))).toEqual([]);
    expect(llmAccess).not.toHaveBeenCalled();
  });

  it('ENT-01 a caller holding issues.fix and llm.view gets the AI answer marked ai', async () => {
    const result = await call(AI_CALLER);
    expect(result.isError).toBeFalsy();
    const body = bodyOf(result);
    expect(body['source']).toBe('ai');
    expect(body['wcagCriterion']).toBe('1.1.1');
    expect(body['diff']).toBe(FAKE_AI_FIX.diff);
    expect(body['fixedHtml']).toBe(FAKE_AI_FIX.fixedHtml);
    expect(body['explanation']).toBe(FAKE_AI_FIX.explanation);
    expect(body['effort']).toBe('low');
    expect('legalContext' in body).toBe(true);
    expect(body['disclaimer']).toBe(DRAFT_DISCLAIMER);
    expect(llmAccess).toHaveBeenCalledTimes(1);
    expect(fetchedUrls.filter((u) => u.includes('generate-fix'))).toHaveLength(1);
  });

  it('ENT-01 a call with no tool context gets the pattern answer and never invokes llmAccess', async () => {
    const result = await call(null);
    expect(result.isError).toBeFalsy();
    expect(bodyOf(result)['source']).toBe('pattern');
    expect(llmAccess).not.toHaveBeenCalled();
    expect(fetchedUrls).toEqual([]);
  });

  it('ENT-02 an issue with no matching pattern gets source pattern, hint null and the no-match note', async () => {
    const result = await call(FIXER, {
      wcagCriterion: '1.1.1',
      issueMessage: NO_MATCH_MESSAGE,
      htmlContext: '<div></div>',
    });
    expect(result.isError).toBeFalsy();
    const body = bodyOf(result);
    expect(body['source']).toBe('pattern');
    expect(body['hint']).toBeNull();
    expect(body['note']).toBe(PATTERN_NO_MATCH_NOTE);
    expect(llmAccess).not.toHaveBeenCalled();
  });

  it('ENT-02 a criterion given as 1.1.1 Non-text Content finds the same hint as 1.1.1', async () => {
    const plain = bodyOf(await call(FIXER));
    if (close !== undefined) await close();
    const titled = bodyOf(await call(FIXER, {
      wcagCriterion: '1.1.1 Non-text Content',
      issueMessage: IMG_MESSAGE,
      htmlContext: '<img src="logo.png">',
    }));
    expect(plain['hint']).not.toBeNull();
    expect(titled['hint']).toEqual(plain['hint']);
    expect(titled['wcagCriterion']).toBe('1.1.1 Non-text Content');
  });

  it('ENT-02 the pattern answer note says it is a pattern-based hint and not an AI-generated fix', async () => {
    const body = bodyOf(await call(FIXER));
    const note = String(body['note']);
    expect(note).toBe(PATTERN_HINT_NOTE);
    expect(note.toLowerCase()).toContain('pattern-based hint');
    expect(note.toLowerCase()).toContain('not an ai-generated fix');
    expect(note).toContain('llm.view');
  });

  it('ENT-03 the dashboard_generate_fix description names llm.view and the pattern hint', async () => {
    const built = await makeClient(llmAccess as never);
    close = built.close;
    const listed = await built.client.listTools();
    const tool = listed.tools.find((t) => t.name === 'dashboard_generate_fix');
    expect(tool).toBeDefined();
    expect(tool!.description).toContain('llm.view');
    expect(tool!.description!.toLowerCase()).toContain('pattern');
  });

  it('ENT-01 mayReceiveAiFix is true only for a context holding llm.view', () => {
    expect(mayReceiveAiFix(AI_CALLER)).toBe(true);
    expect(mayReceiveAiFix(FIXER)).toBe(false);
    expect(mayReceiveAiFix(undefined)).toBe(false);
  });

  it('ENT-02 toDottedCriterion reads dotted, titled and underscore forms', () => {
    expect(toDottedCriterion('1.1.1')).toBe('1.1.1');
    expect(toDottedCriterion('1.1.1 Non-text Content')).toBe('1.1.1');
    expect(toDottedCriterion('WCAG2AA.Principle1.Guideline1_1.1_1_1.H37')).toBe('1.1.1');
    expect(toDottedCriterion('  something else ')).toBe('something else');
  });
});

// ---------------------------------------------------------------------------
// ENT-02 agreement: the report route and the MCP tool give a caller without llm.view the same hint.
// ---------------------------------------------------------------------------

const SESSION_SECRET = 'test-session-secret-at-least-32b';

interface RouteHarness {
  readonly server: FastifyInstance;
  readonly scanId: string;
  readonly generateFix: ReturnType<typeof vi.fn>;
  cleanup: () => void;
}

/** Grants exactly the permissions passed; a configured LLM client exists so absent AI is the permission. */
async function createRouteHarness(permissions: readonly string[]): Promise<RouteHarness> {
  const dbPath = join(tmpdir(), `test-fixagree-${randomUUID()}.db`);
  const reportsDir = join(tmpdir(), `test-fixagree-dir-${randomUUID()}`);
  mkdirSync(reportsDir, { recursive: true });

  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();

  const generateFix = vi.fn().mockResolvedValue({
    fixedHtml: '<img src="x.png" alt="ai-marker">',
    explanation: 'ai-marker-explanation',
  });
  const llm = { baseUrl: 'https://llm.test', generateFix, destroy: () => {} } as unknown as LLMClient;

  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));
  await registerSession(server, SESSION_SECRET);
  server.decorateReply('view', function (this: FastifyReply, template: string, data: unknown) {
    return this.code(200).header('content-type', 'application/json').send(JSON.stringify({ template, data }));
  });
  server.addHook('preHandler', async (request) => {
    request.user = { id: 'user-1', username: 'fixer', role: 'user', currentOrgId: 'system' };
    (request as unknown as Record<string, unknown>)['permissions'] = new Set(permissions);
  });
  await reportRoutes(server, storage, () => llm, { reportsDir });
  await server.ready();

  const scanId = randomUUID();
  await storage.scans.createScan({
    id: scanId,
    siteUrl: 'https://example.com',
    standard: 'WCAG2AA',
    jurisdictions: [],
    createdBy: 'fixer',
    createdAt: new Date().toISOString(),
    orgId: 'system',
  });

  return {
    server,
    scanId,
    generateFix,
    cleanup: () => {
      void storage.disconnect();
      if (existsSync(dbPath)) rmSync(dbPath);
      if (existsSync(reportsDir)) rmSync(reportsDir, { recursive: true });
      void server.close();
    },
  };
}

describe('ENT-02 report route and MCP tool agree', () => {
  let harness: RouteHarness | undefined;
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    harness?.cleanup();
    harness = undefined;
    if (close !== undefined) await close();
    close = undefined;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // The escaping the route applies to the hint text it renders.
  const esc = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  it('ENT-02 the report route and the MCP tool give the same pattern hint and the route never calls generateFix', async () => {
    const permissions = ['reports.view', 'issues.fix'];
    harness = await createRouteHarness(permissions);

    const route = await harness.server.inject({
      method: 'GET',
      url: `/reports/${harness.scanId}/fix-suggestion?criterion=1.1.1&message=${encodeURIComponent(IMG_MESSAGE)}`,
      headers: { 'hx-request': 'true' },
    });
    expect(route.statusCode).toBe(200);
    expect(harness.generateFix).toHaveBeenCalledTimes(0);
    expect(route.body).toContain(t('reportDetail.fixSourcePattern'));

    const llmAccess = vi.fn(async () => ({ baseUrl: 'http://llm.test', token: 'tok-fabrikam' }));
    const built = await makeClient(llmAccess);
    close = built.close;
    const mcp = await runInToolContext(contextWith([...permissions, 'mcp.use']), () =>
      built.client.callTool({
        name: 'dashboard_generate_fix',
        arguments: { wcagCriterion: '1.1.1', issueMessage: IMG_MESSAGE, htmlContext: '<img src="logo.png">' },
      }),
    );
    const body = bodyOf(mcp);
    const hint = body['hint'] as { codeExample: string; description: string } | null;

    expect(body['source']).toBe('pattern');
    expect(hint).not.toBeNull();
    expect(route.body).toContain(esc(hint!.codeExample));
    expect(route.body).toContain(esc(hint!.description));
    expect(llmAccess).not.toHaveBeenCalled();
  });
});
