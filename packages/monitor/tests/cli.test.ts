import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const CLI_PATH = resolve(import.meta.dirname ?? __dirname, '../src/cli.ts');

// ---- CLI structure tests (static) ----
// We test the CLI by inspecting the source rather than spawning a process,
// since the package may not be built during test runs.

describe('CLI source structure', () => {
  it('cli.ts file exists', () => {
    expect(existsSync(CLI_PATH)).toBe(true);
  });

  it('registers the scan command', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(CLI_PATH, 'utf8');
    expect(src).toContain(".command('scan')");
  });

  it('registers the status command', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(CLI_PATH, 'utf8');
    expect(src).toContain(".command('status')");
  });

  it('registers the mcp command', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(CLI_PATH, 'utf8');
    expect(src).toContain(".command('mcp')");
  });

  it('registers the serve command', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(CLI_PATH, 'utf8');
    expect(src).toContain(".command('serve')");
  });

  it('includes --port option for the serve command', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(CLI_PATH, 'utf8');
    expect(src).toContain('--port');
  });

  it('imports runScan from agent module', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(CLI_PATH, 'utf8');
    expect(src).toContain('runScan');
  });

  it('imports getStatus from agent module', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(CLI_PATH, 'utf8');
    expect(src).toContain('getStatus');
  });

  it('imports createMonitorMcpServer from mcp/server module', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(CLI_PATH, 'utf8');
    expect(src).toContain('createMonitorMcpServer');
  });

  it('imports agentCard from a2a/agent-card module', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(CLI_PATH, 'utf8');
    expect(src).toContain('agentCard');
  });
});

// ---- MCP tool names ----

describe('MCP server tool names', () => {
  it('exports MONITOR_TOOL_NAMES with 3 tools', async () => {
    const { MONITOR_TOOL_NAMES } = await import('../src/mcp/server.js');
    expect(MONITOR_TOOL_NAMES).toHaveLength(3);
    expect(MONITOR_TOOL_NAMES).toContain('monitor_scan_sources');
    expect(MONITOR_TOOL_NAMES).toContain('monitor_status');
    expect(MONITOR_TOOL_NAMES).toContain('monitor_add_source');
  });
});

// ---- Agent card ----

describe('A2A agent card', () => {
  it('has the correct agent name', async () => {
    const { agentCard } = await import('../src/a2a/agent-card.js');
    expect(agentCard.name).toBe('pally-monitor');
  });

  it('has source-scanning skill', async () => {
    const { agentCard } = await import('../src/a2a/agent-card.js');
    const ids = agentCard.skills.map((s) => s.id);
    expect(ids).toContain('source-scanning');
  });

  it('has change-detection skill', async () => {
    const { agentCard } = await import('../src/a2a/agent-card.js');
    const ids = agentCard.skills.map((s) => s.id);
    expect(ids).toContain('change-detection');
  });

  it('has oauth2 authentication scheme', async () => {
    const { agentCard } = await import('../src/a2a/agent-card.js');
    expect(agentCard.authentication.schemes).toContain('oauth2');
  });
});

// ---- Config loading ----

describe('loadConfig', () => {
  it('returns default values when env vars are absent', async () => {
    const { loadConfig } = await import('../src/config.js');
    const config = loadConfig();
    expect(config.complianceUrl).toBe('http://localhost:4000');
    expect(config.checkInterval).toBe('manual');
    expect(config.userAgent).toContain('pally-monitor');
  });

  it('respects MONITOR_COMPLIANCE_URL env var', async () => {
    process.env.MONITOR_COMPLIANCE_URL = 'http://compliance:9000';
    const mod = await import('../src/config.js?t=' + Date.now());
    const config = mod.loadConfig();
    expect(config.complianceUrl).toBe('http://compliance:9000');
    delete process.env.MONITOR_COMPLIANCE_URL;
  });
});
