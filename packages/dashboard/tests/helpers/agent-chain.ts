/**
 * The dashboard assistant's in-process tool chain, assembled from the production parts over a real
 * SqliteStorageAdapter:
 *
 *   createDashboardMcpServer -> bridgeMcpToolsForAgent(DASHBOARD_TOOL_METADATA) -> ToolDispatcher
 *   (resolveScopes = storedPermissionsOrNone, the real OAuth signer) -> AgentService
 *   (resolvePermissions = storedPermissionsOrNone)
 *
 * Only the model is scripted: each step returns text and tool calls, and the model records the tool
 * list it was offered and the context hints block it received. The service-connection repository is a spy on every method, and the scan
 * service is a real ScanService over a spy storage and orchestrator with its own start limiter, so a
 * test can see whether a scan start was attempted, created and metered.
 *
 * Users are seeded through storage with placeholder names.
 */
import { vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { setEncryptionSalt } from '../../src/plugins/crypto.js';
import { ensureInitialSigningKey } from '../../src/auth/oauth-key-bootstrap.js';
import { createDashboardSigner } from '../../src/auth/oauth-signer.js';
import { storedPermissionsOrNone } from '../../src/auth/stored-caller.js';
import { createDashboardMcpServer } from '../../src/mcp/server.js';
import { DASHBOARD_TOOL_METADATA } from '../../src/mcp/metadata.js';
import { bridgeMcpToolsForAgent } from '../../src/agent/mcp-bridge.js';
import { ToolDispatcher, type ToolCallInput } from '../../src/agent/tool-dispatch.js';
import { AgentService, type AgentStreamInput, type AgentStreamTurn } from '../../src/agent/agent-service.js';
import { ActiveTurnRegistry } from '../../src/agent/active-turn-registry.js';
import { ScanService, createScanStartLimiter } from '../../src/services/scan-service.js';
import type { ScanOrchestrator } from '../../src/scanner/orchestrator.js';
import type { DashboardConfig } from '../../src/config.js';
import type { ServiceConnectionsRepository } from '../../src/db/service-connections-repository.js';
import type { SseFrame } from '../../src/agent/sse-frames.js';

const SIGNING_SECRET = 'agent-chain-signing-secret-0123456789';
export const AGENT_CHAIN_AUDIENCE = 'https://dashboard.example.com/api/v1/mcp';

export interface ScriptStep {
  readonly text: string;
  readonly toolCalls: readonly ToolCallInput[];
}

export interface ToolRow {
  readonly status: string;
  readonly name: string | null;
  readonly result: string | null;
}

export interface AuditRow {
  readonly userId: string;
  readonly toolName: string;
  readonly outcome: string;
  readonly outcomeDetail: string | null;
  readonly conversationId: string | null;
}

export interface TurnResult {
  readonly conversationId: string;
  readonly frames: readonly SseFrame[];
}

export interface AgentChain {
  readonly storage: SqliteStorageAdapter;
  readonly dispatcher: ToolDispatcher;
  readonly service: AgentService;
  /** Tool names offered to the model, one entry per model call (in call order). */
  readonly offered: string[][];
  /** The context hints block the model received, one entry per model call (in call order). */
  readonly hints: string[];
  readonly serviceConnections: {
    readonly list: ReturnType<typeof vi.fn>;
    readonly get: ReturnType<typeof vi.fn>;
    readonly upsert: ReturnType<typeof vi.fn>;
    readonly clearSecret: ReturnType<typeof vi.fn>;
  };
  readonly scanService: ScanService;
  /** The scan entry dashboard_scan_site calls. */
  readonly scanStart: ReturnType<typeof vi.spyOn>;
  /** The scan row writer behind the scan service. */
  readonly createScan: ReturnType<typeof vi.fn>;
  /** The scan service's start-limiter store: key -> start timestamps. */
  readonly startStore: Map<string, readonly number[]>;
  /** Queue the model's next steps. */
  script(steps: readonly ScriptStep[]): void;
  createOrg(name: string): Promise<string>;
  /** A user with `globalRole`, in a team of `orgId` bound to the org role named `orgRoleName`. */
  addOrgUser(orgId: string, username: string, globalRole: string, orgRoleName: string): Promise<{ userId: string; teamId: string }>;
  addUser(username: string, globalRole: string): Promise<string>;
  bindTeamToOrgRole(teamId: string, orgId: string, orgRoleName: string): Promise<void>;
  runTurn(userId: string, orgId: string, message: string, conversationId?: string): Promise<TurnResult>;
  toolRows(conversationId: string): ToolRow[];
  auditRows(conversationId: string): AuditRow[];
  cleanup(): Promise<void>;
}

export async function buildAgentChain(): Promise<AgentChain> {
  setEncryptionSalt('agent-chain-salt');
  const dbPath = join(tmpdir(), `test-agent-chain-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  await ensureInitialSigningKey(storage, SIGNING_SECRET);
  const signer = await createDashboardSigner(storage, SIGNING_SECRET);

  const serviceConnections = {
    list: vi.fn(async () => []),
    get: vi.fn(async () => null),
    upsert: vi.fn(async (input: Record<string, unknown>) => ({
      serviceId: input['serviceId'], url: input['url'] ?? '', clientId: input['clientId'] ?? '',
      clientSecret: '', hasSecret: false, updatedAt: '', updatedBy: null, source: 'db',
    })),
    clearSecret: vi.fn(async () => undefined),
  };

  const startStore = new Map<string, readonly number[]>();
  const createScan = vi.fn().mockImplementation((input: Record<string, unknown>) =>
    Promise.resolve({ ...input, status: 'queued' }));
  const scanService = new ScanService(
    { scans: { createScan }, organizations: { getDeepScanDefault: vi.fn().mockResolvedValue(false) } } as never,
    { startScan: vi.fn() } as unknown as ScanOrchestrator,
    {
      maxConcurrentScans: 2,
      maxPages: 100,
      runner: 'htmlcs',
      complianceUrl: 'http://compliance.invalid',
      allowPrivateScanTargets: false,
    } as unknown as DashboardConfig,
    undefined,
    createScanStartLimiter({ store: startStore }),
  );
  const scanStart = vi.spyOn(scanService, 'initiateScanRateLimited');

  const { server } = await createDashboardMcpServer({
    storage,
    scanService,
    serviceConnections: serviceConnections as unknown as ServiceConnectionsRepository,
  });
  const { catalog, manifest } = bridgeMcpToolsForAgent(server, DASHBOARD_TOOL_METADATA);
  const dispatcher = new ToolDispatcher({
    tools: manifest,
    signer,
    dashboardMcpAudience: AGENT_CHAIN_AUDIENCE,
    resolveScopes: async (userId, orgId) => [...(await storedPermissionsOrNone(storage, userId, orgId))],
  });

  const queue: ScriptStep[] = [];
  const offered: string[][] = [];
  const hints: string[] = [];
  const llm = {
    streamAgentConversation: async (input: AgentStreamInput): Promise<AgentStreamTurn> => {
      offered.push(input.tools.map((t) => t.name));
      hints.push(input.contextHintsBlock ?? '');
      const next = queue.shift() ?? { text: 'done', toolCalls: [] };
      return { text: next.text, toolCalls: [...next.toolCalls] } as AgentStreamTurn;
    },
  };
  const service = new AgentService({
    storage,
    llm: llm as never,
    allTools: DASHBOARD_TOOL_METADATA,
    toolCatalog: catalog,
    dispatcher,
    resolvePermissions: (userId, orgId) => storedPermissionsOrNone(storage, userId, orgId),
    config: { agentDisplayNameDefault: 'Assistant' },
    titleGenerator: async () => {
      throw new Error('no title in the agent chain');
    },
    turnRegistry: new ActiveTurnRegistry(),
  });

  const raw = storage.getRawDatabase();

  const roleIdOf = async (orgId: string, orgRoleName: string): Promise<string> => {
    const role = await storage.roles.getRoleByNameAndOrg(orgRoleName, orgId);
    if (role === null) throw new Error(`agent-chain: no org role ${orgRoleName}`);
    return role.id;
  };

  return {
    storage,
    dispatcher,
    service,
    offered,
    hints,
    serviceConnections,
    scanService,
    scanStart,
    createScan,
    startStore,
    script(steps) {
      queue.push(...steps);
    },
    async createOrg(name) {
      const org = await storage.organizations.createOrg({ name, slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${randomUUID().slice(0, 6)}` });
      return org.id;
    },
    async addUser(username, globalRole) {
      const user = await storage.users.createUser(username, 'Pass-word-123!', globalRole);
      return user.id;
    },
    async addOrgUser(orgId, username, globalRole, orgRoleName) {
      const user = await storage.users.createUser(username, 'Pass-word-123!', globalRole);
      const team = await storage.teams.createTeam({ name: `${username}-team`, description: '', orgId, roleId: await roleIdOf(orgId, orgRoleName) });
      await storage.teams.addTeamMember(team.id, user.id);
      await storage.organizations.addMember(orgId, user.id, 'member');
      return { userId: user.id, teamId: team.id };
    },
    async bindTeamToOrgRole(teamId, orgId, orgRoleName) {
      await storage.teams.updateTeam(teamId, { roleId: await roleIdOf(orgId, orgRoleName) });
    },
    async runTurn(userId, orgId, message, conversationId) {
      const convId = conversationId ?? (await storage.conversations.createConversation({ userId, orgId })).id;
      const frames: SseFrame[] = [];
      await service.runTurn({
        conversationId: convId,
        userId,
        orgId,
        userMessage: message,
        emit: (f: SseFrame) => frames.push(f),
        signal: new AbortController().signal,
      });
      return { conversationId: convId, frames };
    },
    toolRows(conversationId) {
      const rows = raw
        .prepare(`SELECT status, tool_call_json, tool_result_json FROM agent_messages
                  WHERE conversation_id = ? AND role = 'tool' ORDER BY created_at, rowid`)
        .all(conversationId) as Array<{ status: string; tool_call_json: string | null; tool_result_json: string | null }>;
      return rows.map((r) => {
        let name: string | null = null;
        try {
          const call = JSON.parse(r.tool_call_json ?? 'null') as { name?: unknown } | null;
          name = call !== null && typeof call.name === 'string' ? call.name : null;
        } catch {
          name = null;
        }
        return { status: r.status, name, result: r.tool_result_json };
      });
    },
    auditRows(conversationId) {
      const rows = raw
        .prepare(`SELECT user_id, tool_name, outcome, outcome_detail, conversation_id FROM agent_audit_log
                  WHERE conversation_id = ? ORDER BY created_at, rowid`)
        .all(conversationId) as Array<{ user_id: string; tool_name: string; outcome: string; outcome_detail: string | null; conversation_id: string | null }>;
      return rows.map((r) => ({
        userId: r.user_id, toolName: r.tool_name, outcome: r.outcome, outcomeDetail: r.outcome_detail, conversationId: r.conversation_id,
      }));
    },
    async cleanup() {
      await storage.disconnect();
      for (const suffix of ['', '-wal', '-shm']) {
        if (existsSync(dbPath + suffix)) rmSync(dbPath + suffix);
      }
    },
  };
}
