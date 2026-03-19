import { describe, it, expect } from 'vitest';

describe('MCP Server', () => {
  it('exports createServer function', async () => {
    const { createServer } = await import('../src/mcp.js');
    expect(typeof createServer).toBe('function');
  });

  it('creates a server with expected tool names', async () => {
    const { createServer } = await import('../src/mcp.js');
    const server = createServer();
    expect(server).toBeDefined();
    expect(server.toolNames).toContain('pally_scan');
    expect(server.toolNames).toContain('pally_get_issues');
    expect(server.toolNames).toContain('pally_propose_fixes');
    expect(server.toolNames).toContain('pally_apply_fix');
  });
});
