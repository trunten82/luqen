import { describe, it, expect } from 'vitest';
import { createComplianceMcpServer } from '../../src/mcp/server.js';

describe('MCP Server', () => {
  it('exports createComplianceMcpServer as a function', () => {
    expect(typeof createComplianceMcpServer).toBe('function');
  });

  it('returns an object with server and toolNames', async () => {
    const result = await createComplianceMcpServer({ dbPath: ':memory:' });
    expect(result).toHaveProperty('server');
    expect(result).toHaveProperty('toolNames');
  });

  it('has exactly 11 tool names', async () => {
    const { toolNames } = await createComplianceMcpServer({ dbPath: ':memory:' });
    expect(toolNames).toHaveLength(11);
  });

  it('includes all required tool names', async () => {
    const { toolNames } = await createComplianceMcpServer({ dbPath: ':memory:' });
    const expected = [
      'compliance_check',
      'compliance_list_jurisdictions',
      'compliance_list_regulations',
      'compliance_list_requirements',
      'compliance_get_regulation',
      'compliance_propose_update',
      'compliance_get_pending',
      'compliance_approve_update',
      'compliance_list_sources',
      'compliance_add_source',
      'compliance_seed',
    ];
    for (const name of expected) {
      expect(toolNames).toContain(name);
    }
  });

  it('server is an MCP Server instance with connect method', async () => {
    const { server } = await createComplianceMcpServer({ dbPath: ':memory:' });
    expect(typeof server.connect).toBe('function');
  });
});
