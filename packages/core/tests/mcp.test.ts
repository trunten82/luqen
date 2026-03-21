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
    expect(server.toolNames).toContain('luqen_scan');
    expect(server.toolNames).toContain('luqen_get_issues');
    expect(server.toolNames).toContain('luqen_propose_fixes');
    expect(server.toolNames).toContain('luqen_apply_fix');
    expect(server.toolNames).toContain('luqen_raw');
    expect(server.toolNames).toContain('luqen_raw_batch');
  });
});
