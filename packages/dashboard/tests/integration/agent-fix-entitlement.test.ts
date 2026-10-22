/**
 * D-03 (phase 93): the in-dashboard assistant reaches MCP dashboard_generate_fix with the stored
 * user's permissions, so the llm.view rule holds on that path too.
 *
 * Every test drives the real in-process chain (tests/helpers/agent-chain.ts): the dashboard McpServer
 * with the fix tool registered, the agent bridge, the ToolDispatcher and AgentService. Only the model
 * is scripted. The LLM service is a spied llmAccess plus a stubbed global fetch.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildAgentChain, type AgentChain } from '../helpers/agent-chain.js';
import { getFixSuggestion } from '../../src/fix-suggestions.js';

const ISSUE_MESSAGE = 'Img element missing an alt attribute';
const FAKE_AI_FIX = {
  fixedHtml: '<img src="logo.png" alt="Fabrikam logo">',
  explanation: 'Added descriptive alt text.',
  effort: 'low',
  wcagCriterion: '1.1.1',
  diff: '- <img src="logo.png">\n+ <img src="logo.png" alt="Fabrikam logo">',
};

const FIX_CALL = {
  id: 't1',
  name: 'dashboard_generate_fix',
  args: { wcagCriterion: '1.1.1', issueMessage: ISSUE_MESSAGE, htmlContext: '<img src="logo.png">' },
};

function resultBody(result: string | null): Record<string, unknown> {
  const payload = JSON.parse(result ?? '{}') as { content?: Array<{ text?: string }> };
  return JSON.parse(payload.content?.[0]?.text ?? '{}') as Record<string, unknown>;
}

describe('D-03 the assistant gives AI fix output only to a stored user holding llm.view', () => {
  let chain: AgentChain;
  let orgId: string;
  let llmAccess: ReturnType<typeof vi.fn>;
  let fetchedUrls: string[];

  beforeEach(async () => {
    fetchedUrls = [];
    llmAccess = vi.fn(async () => ({ baseUrl: 'http://llm.test', token: 'tok-fabrikam' }));
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      fetchedUrls.push(String(url));
      if (String(url).includes('generate-fix')) return { ok: true, json: async () => FAKE_AI_FIX };
      return { ok: true, json: async () => ({}) };
    }));
    chain = await buildAgentChain({ llmAccess: llmAccess as never });
    orgId = await chain.createOrg('Fabrikam Fixes');
    await chain.storage.roles.createRole({
      name: 'Fixer',
      description: 'issues.fix without llm.view',
      permissions: ['reports.view', 'issues.fix'],
      orgId,
    });
  });

  afterEach(async () => {
    await chain.cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function runFix(userId: string) {
    chain.script([
      { text: 'Drafting a fix.', toolCalls: [FIX_CALL] },
      { text: 'Here it is.', toolCalls: [] },
    ]);
    const turn = await chain.runTurn(userId, orgId, 'fix the missing alt text');
    return { turn, rows: chain.toolRows(turn.conversationId) };
  }

  it('D-03 the assistant offers dashboard_generate_fix to a stored user holding issues.fix without llm.view', async () => {
    const fixer = await chain.addOrgUser(orgId, 'northwind-fixer', 'user', 'Fixer');
    chain.script([{ text: 'Hello.', toolCalls: [] }]);
    await chain.runTurn(fixer.userId, orgId, 'hello');
    expect(chain.offered[0]).toContain('dashboard_generate_fix');
  });

  it('D-03 a user without llm.view gets the pattern hint and the LLM is never reached', async () => {
    const fixer = await chain.addOrgUser(orgId, 'northwind-fixer', 'user', 'Fixer');

    const { rows } = await runFix(fixer.userId);

    expect(rows.map((r) => [r.name, r.status])).toEqual([['dashboard_generate_fix', 'sent']]);
    const body = resultBody(rows[0]?.result ?? null);
    const expected = getFixSuggestion('1.1.1', ISSUE_MESSAGE);
    expect(expected).not.toBeNull();
    expect(body['source']).toBe('pattern');
    expect((body['hint'] as Record<string, unknown>)['title']).toBe(expected!.title);
    expect(body['fixedHtml']).toBeUndefined();
    expect(llmAccess).not.toHaveBeenCalled();
    expect(fetchedUrls.filter((u) => u.includes('generate-fix'))).toEqual([]);
  });

  it('D-03 the org Owner gets the AI answer through the same chain', async () => {
    const owner = await chain.addOrgUser(orgId, 'fabrikam-owner', 'user', 'Owner');

    const { rows } = await runFix(owner.userId);

    expect(rows.map((r) => [r.name, r.status])).toEqual([['dashboard_generate_fix', 'sent']]);
    const body = resultBody(rows[0]?.result ?? null);
    expect(body['source']).toBe('ai');
    expect(body['fixedHtml']).toBe(FAKE_AI_FIX.fixedHtml);
    expect(llmAccess).toHaveBeenCalledTimes(1);
    expect(fetchedUrls.filter((u) => u.includes('generate-fix'))).toHaveLength(1);
  });
});
