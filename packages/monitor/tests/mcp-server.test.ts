import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---- Mocks ----

// Track registerTool calls via a captured mock
const registerToolMock = vi.fn();

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => {
  // Use a real class so `new McpServer(...)` works
  class MockMcpServer {
    registerTool: typeof registerToolMock;
    constructor(public readonly config: unknown) {
      this.registerTool = registerToolMock;
    }
  }
  return { McpServer: MockMcpServer };
});

vi.mock('../src/config.js', () => ({
  loadConfig: vi.fn(() => ({
    complianceUrl: 'https://compliance.test',
    complianceClientId: 'test-id',
    complianceClientSecret: 'test-secret',
    checkInterval: 'manual',
    userAgent: 'test-agent/1.0',
  })),
}));

vi.mock('../src/agent.js', () => ({
  runScan: vi.fn(),
  getStatus: vi.fn(),
}));

vi.mock('../src/compliance-client.js', () => ({
  getToken: vi.fn(),
  listProposals: vi.fn(),
  addSource: vi.fn(),
}));

vi.mock('../src/version.js', () => ({
  VERSION: '1.0.0-test',
}));

import { createMonitorMcpServer, MONITOR_TOOL_NAMES } from '../src/mcp/server.js';
import { runScan, getStatus } from '../src/agent.js';
import { getToken, addSource } from '../src/compliance-client.js';
import { loadConfig } from '../src/config.js';

beforeEach(() => {
  registerToolMock.mockClear();

  vi.mocked(runScan).mockResolvedValue({
    scanned: 3,
    changed: 1,
    unchanged: 2,
    errors: 0,
    proposalsCreated: [],
    errorDetails: [],
    scannedAt: '2025-06-01T00:00:00Z',
  });

  vi.mocked(getStatus).mockResolvedValue({
    sourcesCount: 5,
    pendingProposals: 2,
    lastScanAt: '2025-06-01T00:00:00Z',
    complianceUrl: 'https://compliance.test',
  });

  vi.mocked(getToken).mockResolvedValue('test-token');

  vi.mocked(addSource).mockResolvedValue({
    id: 'src-new',
    name: 'New Source',
    url: 'https://example.com/new',
    type: 'html',
    schedule: 'weekly',
    createdAt: '2025-06-01T00:00:00Z',
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---- MONITOR_TOOL_NAMES ----

describe('MONITOR_TOOL_NAMES', () => {
  it('exports the expected tool names', () => {
    expect(MONITOR_TOOL_NAMES).toContain('monitor_scan_sources');
    expect(MONITOR_TOOL_NAMES).toContain('monitor_status');
    expect(MONITOR_TOOL_NAMES).toContain('monitor_add_source');
    expect(MONITOR_TOOL_NAMES).toHaveLength(3);
  });
});

// ---- createMonitorMcpServer ----

describe('createMonitorMcpServer', () => {
  it('creates an McpServer with correct name and version', () => {
    const server = createMonitorMcpServer();

    // The mock class stores config in the constructor
    expect((server as unknown as { config: unknown }).config).toEqual({
      name: 'luqen-monitor',
      version: '1.0.0-test',
    });
  });

  it('returns the McpServer instance', () => {
    const server = createMonitorMcpServer();
    expect(server).toBeDefined();
    expect(server.registerTool).toBeDefined();
  });

  it('registers exactly three tools', () => {
    createMonitorMcpServer();

    expect(registerToolMock).toHaveBeenCalledTimes(3);

    const toolNames = registerToolMock.mock.calls.map(
      (call: unknown[]) => call[0],
    );
    expect(toolNames).toContain('monitor_scan_sources');
    expect(toolNames).toContain('monitor_status');
    expect(toolNames).toContain('monitor_add_source');
  });

  // Helper to extract a specific tool handler
  function getToolHandler(toolName: string): Function {
    createMonitorMcpServer();
    const call = registerToolMock.mock.calls.find(
      (c: unknown[]) => c[0] === toolName,
    );
    if (!call) throw new Error(`Tool "${toolName}" not registered`);
    return call[2] as Function;
  }

  // ---- monitor_scan_sources ----

  describe('monitor_scan_sources handler', () => {
    it('calls runScan and returns JSON text content', async () => {
      const handler = getToolHandler('monitor_scan_sources');

      const result = await handler({});

      expect(runScan).toHaveBeenCalledOnce();
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.scanned).toBe(3);
      expect(parsed.changed).toBe(1);
      expect(parsed.unchanged).toBe(2);
    });

    it('propagates errors from runScan', async () => {
      vi.mocked(runScan).mockRejectedValueOnce(new Error('Scan failed'));
      const handler = getToolHandler('monitor_scan_sources');

      await expect(handler({})).rejects.toThrow('Scan failed');
    });
  });

  // ---- monitor_status ----

  describe('monitor_status handler', () => {
    it('calls getStatus and returns JSON text content', async () => {
      const handler = getToolHandler('monitor_status');

      const result = await handler({});

      expect(getStatus).toHaveBeenCalledOnce();
      expect(result.content).toHaveLength(1);

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.sourcesCount).toBe(5);
      expect(parsed.pendingProposals).toBe(2);
      expect(parsed.lastScanAt).toBe('2025-06-01T00:00:00Z');
    });

    it('propagates errors from getStatus', async () => {
      vi.mocked(getStatus).mockRejectedValueOnce(new Error('Status error'));
      const handler = getToolHandler('monitor_status');

      await expect(handler({})).rejects.toThrow('Status error');
    });
  });

  // ---- monitor_add_source ----

  describe('monitor_add_source handler', () => {
    const sourceInput = {
      name: 'New Source',
      url: 'https://example.com/new',
      type: 'html',
      schedule: 'weekly',
    };

    it('authenticates and adds source', async () => {
      const handler = getToolHandler('monitor_add_source');

      const result = await handler(sourceInput);

      expect(loadConfig).toHaveBeenCalled();
      expect(getToken).toHaveBeenCalledWith(
        'https://compliance.test',
        'test-id',
        'test-secret',
      );
      expect(addSource).toHaveBeenCalledWith(
        'https://compliance.test',
        'test-token',
        sourceInput,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.id).toBe('src-new');
      expect(parsed.name).toBe('New Source');
    });

    it('propagates authentication errors', async () => {
      vi.mocked(getToken).mockRejectedValueOnce(new Error('Auth failed'));
      const handler = getToolHandler('monitor_add_source');

      await expect(handler(sourceInput)).rejects.toThrow('Auth failed');
    });

    it('propagates addSource errors', async () => {
      vi.mocked(addSource).mockRejectedValueOnce(new Error('Duplicate'));
      const handler = getToolHandler('monitor_add_source');

      await expect(handler(sourceInput)).rejects.toThrow('Duplicate');
    });
  });

  // ---- Tool descriptions ----

  describe('tool descriptions', () => {
    it('each tool has a description', () => {
      createMonitorMcpServer();

      for (const call of registerToolMock.mock.calls) {
        const options = call[1] as { description: string };
        expect(options.description).toBeTruthy();
        expect(typeof options.description).toBe('string');
      }
    });

    it('monitor_add_source has input schema with required fields', () => {
      createMonitorMcpServer();

      const addSourceCall = registerToolMock.mock.calls.find(
        (c: unknown[]) => c[0] === 'monitor_add_source',
      );
      const options = addSourceCall[1] as { inputSchema: { shape: Record<string, unknown> } };
      expect(options.inputSchema).toBeDefined();
    });
  });
});
