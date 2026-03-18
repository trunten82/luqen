import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createComplianceMcpServer } from '../../src/mcp/server.js';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';

describe('MCP Server Tools (via Client)', () => {
  let client: Client;
  let db: SqliteAdapter;

  beforeAll(async () => {
    db = new SqliteAdapter(':memory:');
    await db.initialize();

    const { server } = await createComplianceMcpServer({ db });
    client = new Client({ name: 'test-client', version: '1.0.0' });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
    await db.close();
  });

  it('compliance_list_jurisdictions returns empty list', async () => {
    const result = await client.callTool({ name: 'compliance_list_jurisdictions', arguments: {} });
    expect(result.content).toHaveLength(1);
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(Array.isArray(parsed)).toBe(true);
  });

  it('compliance_seed seeds baseline data', async () => {
    const result = await client.callTool({ name: 'compliance_seed', arguments: {} });
    expect(result.isError).toBeFalsy();
    const text = (result.content[0] as { text: string }).text;
    const parsed = JSON.parse(text) as { success: boolean; counts: { jurisdictions: number; regulations: number } };
    expect(parsed.success).toBe(true);
    expect(typeof parsed.counts.jurisdictions).toBe('number');
    expect(typeof parsed.counts.regulations).toBe('number');
  });

  it('compliance_list_jurisdictions returns seeded jurisdictions', async () => {
    const result = await client.callTool({ name: 'compliance_list_jurisdictions', arguments: {} });
    const parsed = JSON.parse((result.content[0] as { text: string }).text) as unknown[];
    expect(parsed.length).toBeGreaterThan(0);
  });

  it('compliance_list_jurisdictions filters by type', async () => {
    const result = await client.callTool({
      name: 'compliance_list_jurisdictions',
      arguments: { type: 'country' },
    });
    const parsed = JSON.parse((result.content[0] as { text: string }).text) as Array<{ type: string }>;
    for (const j of parsed) {
      expect(j.type).toBe('country');
    }
  });

  it('compliance_list_regulations returns regulations', async () => {
    const result = await client.callTool({ name: 'compliance_list_regulations', arguments: {} });
    const parsed = JSON.parse((result.content[0] as { text: string }).text) as unknown[];
    expect(parsed.length).toBeGreaterThan(0);
  });

  it('compliance_list_requirements returns requirements', async () => {
    const result = await client.callTool({ name: 'compliance_list_requirements', arguments: {} });
    const parsed = JSON.parse((result.content[0] as { text: string }).text) as unknown[];
    expect(parsed.length).toBeGreaterThan(0);
  });

  it('compliance_get_regulation returns regulation with requirements', async () => {
    // Get a regulation ID from the list
    const listResult = await client.callTool({ name: 'compliance_list_regulations', arguments: {} });
    const regulations = JSON.parse((listResult.content[0] as { text: string }).text) as Array<{ id: string }>;
    const id = regulations[0].id;

    const result = await client.callTool({ name: 'compliance_get_regulation', arguments: { id } });
    const parsed = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    expect(parsed.id).toBe(id);
    expect(Array.isArray(parsed.requirements)).toBe(true);
  });

  it('compliance_get_regulation returns error for missing id', async () => {
    const result = await client.callTool({
      name: 'compliance_get_regulation',
      arguments: { id: 'nonexistent-id' },
    });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    expect(parsed.error).toBeDefined();
  });

  it('compliance_check returns results', async () => {
    const result = await client.callTool({
      name: 'compliance_check',
      arguments: {
        jurisdictions: ['EU'],
        issues: [
          {
            code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
            type: 'error',
            message: 'Img element missing alt attribute',
            selector: 'img',
            context: '<img src="test.png">',
          },
        ],
      },
    });

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    expect(parsed).toBeDefined();
  });

  it('compliance_list_sources returns empty list initially', async () => {
    const result = await client.callTool({ name: 'compliance_list_sources', arguments: {} });
    const parsed = JSON.parse((result.content[0] as { text: string }).text) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
  });

  it('compliance_add_source creates a source', async () => {
    const result = await client.callTool({
      name: 'compliance_add_source',
      arguments: {
        name: 'W3C News',
        url: 'https://www.w3.org/news',
        type: 'html',
        schedule: 'weekly',
      },
    });

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    expect(parsed.name).toBe('W3C News');
  });

  it('compliance_propose_update creates a proposal', async () => {
    const result = await client.callTool({
      name: 'compliance_propose_update',
      arguments: {
        source: 'https://example.com/change',
        type: 'amendment',
        summary: 'A test amendment',
        proposedChanges: {
          action: 'update',
          entityType: 'regulation',
          entityId: 'some-id',
          after: { status: 'archived' },
        },
      },
    });

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    expect(parsed.source).toBe('https://example.com/change');
    expect(parsed.status).toBe('pending');
  });

  it('compliance_get_pending lists pending proposals', async () => {
    const result = await client.callTool({ name: 'compliance_get_pending', arguments: {} });
    const parsed = JSON.parse((result.content[0] as { text: string }).text) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
  });

  it('compliance_approve_update uses default reviewer when not provided', async () => {
    // Create a proposal to approve without reviewedBy
    const propResult = await client.callTool({
      name: 'compliance_propose_update',
      arguments: {
        source: 'https://example.com/default-reviewer-test',
        type: 'new_jurisdiction',
        summary: 'New jurisdiction default reviewer',
        proposedChanges: {
          action: 'create',
          entityType: 'jurisdiction',
          after: { id: 'MCP-DEFAULT', name: 'MCP Default', type: 'country' },
        },
      },
    });
    const proposal = JSON.parse((propResult.content[0] as { text: string }).text) as { id: string };

    const result = await client.callTool({
      name: 'compliance_approve_update',
      arguments: { id: proposal.id },
    });

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    expect(parsed.reviewedBy).toBe('mcp');
  });

  it('compliance_approve_update approves a proposal', async () => {
    // Create a proposal to approve
    const propResult = await client.callTool({
      name: 'compliance_propose_update',
      arguments: {
        source: 'https://example.com/approve-test',
        type: 'new_jurisdiction',
        summary: 'New jurisdiction proposal',
        proposedChanges: {
          action: 'create',
          entityType: 'jurisdiction',
          after: { id: 'MCP-TEST', name: 'MCP Test', type: 'country' },
        },
      },
    });
    const proposal = JSON.parse((propResult.content[0] as { text: string }).text) as { id: string };

    const result = await client.callTool({
      name: 'compliance_approve_update',
      arguments: { id: proposal.id, reviewedBy: 'test-reviewer' },
    });

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    expect(parsed.status).toBe('approved');
  });
});
