import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import { bootstrapAgentConversation } from '../../src/api/server.js';

type FakeLog = {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
};

function makeLog(): FakeLog {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe('bootstrapAgentConversation', () => {
  let tmpDir: string;
  let dbPath: string;
  let db: SqliteAdapter;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'llm-bootstrap-test-'));
    dbPath = join(tmpDir, 'test.db');
    db = new SqliteAdapter(dbPath);
    await db.initialize();
  });

  afterEach(async () => {
    await db.close();
    if (existsSync(dbPath)) unlinkSync(dbPath);
  });

  // B1 — Anthropic Haiku present → seed assignment exists
  it('B1: seeds agent-conversation → claude-haiku-4-5-20251001 at priority 1 when Anthropic available', async () => {
    const provider = await db.createProvider({
      type: 'anthropic',
      name: 'Anthropic',
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'sk-ant-test',
    });
    await db.createModel({
      providerId: provider.id,
      modelId: 'claude-haiku-4-5-20251001',
      displayName: 'Claude Haiku 4.5',
      capabilities: ['agent-conversation'],
    });

    const log = makeLog();
    await bootstrapAgentConversation(db, log);

    const assignments = await db.listCapabilityAssignments();
    const agentAssignments = assignments.filter(
      (a) => a.capability === 'agent-conversation',
    );
    expect(agentAssignments.length).toBeGreaterThanOrEqual(1);
    const seed = agentAssignments[0];
    expect(seed?.priority).toBe(1);
  });

  // B2 — getModelsForCapability resolves to the seeded model
  it('B2: after bootstrap, getModelsForCapability returns Haiku at priority 1', async () => {
    const provider = await db.createProvider({
      type: 'anthropic',
      name: 'Anthropic',
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'sk-ant-test',
    });
    const model = await db.createModel({
      providerId: provider.id,
      modelId: 'claude-haiku-4-5-20251001',
      displayName: 'Claude Haiku 4.5',
      capabilities: ['agent-conversation'],
    });

    const log = makeLog();
    await bootstrapAgentConversation(db, log);

    const models = await db.getModelsForCapability('agent-conversation', undefined);
    expect(models.length).toBeGreaterThanOrEqual(1);
    expect(models[0]?.id).toBe(model.id);
    expect(models[0]?.modelId).toBe('claude-haiku-4-5-20251001');
  });

  // B3 — Idempotency: running twice does not create a duplicate
  it('B3: running bootstrap twice leaves exactly ONE agent-conversation assignment', async () => {
    const provider = await db.createProvider({
      type: 'anthropic',
      name: 'Anthropic',
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'sk-ant-test',
    });
    await db.createModel({
      providerId: provider.id,
      modelId: 'claude-haiku-4-5-20251001',
      displayName: 'Claude Haiku 4.5',
      capabilities: ['agent-conversation'],
    });

    const log = makeLog();
    await bootstrapAgentConversation(db, log);
    await bootstrapAgentConversation(db, log);

    const assignments = await db.listCapabilityAssignments();
    const agentAssignments = assignments.filter(
      (a) => a.capability === 'agent-conversation',
    );
    expect(agentAssignments.length).toBe(1);
  });

  // B4a — Fallback to gpt-4o-mini when Haiku missing, OpenAI present
  it('B4a: falls back to gpt-4o-mini when no Anthropic, OpenAI available', async () => {
    const provider = await db.createProvider({
      type: 'openai',
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com',
      apiKey: 'sk-openai-test',
    });
    await db.createModel({
      providerId: provider.id,
      modelId: 'gpt-4o-mini',
      displayName: 'GPT-4o mini',
      capabilities: ['agent-conversation'],
    });

    const log = makeLog();
    await bootstrapAgentConversation(db, log);

    const models = await db.getModelsForCapability('agent-conversation', undefined);
    expect(models.length).toBeGreaterThanOrEqual(1);
    expect(models[0]?.modelId).toBe('gpt-4o-mini');
  });

  // B4b — Fallback to first supportsTools model when neither Haiku nor gpt-4o-mini present
  // NOTE: The current Model type has no `supportsTools` flag — plan allows
  // either using a flag if present or falling through to "first model".
  // We test the first-model-at-all behaviour which is the stable contract.
  it('B4b: falls back to first model in listModels when neither preferred model is registered', async () => {
    const provider = await db.createProvider({
      type: 'ollama',
      name: 'Ollama',
      baseUrl: 'http://localhost:11434',
    });
    const firstModel = await db.createModel({
      providerId: provider.id,
      modelId: 'llama3.2',
      displayName: 'Llama 3.2',
      capabilities: ['agent-conversation'],
    });

    const log = makeLog();
    await bootstrapAgentConversation(db, log);

    const models = await db.getModelsForCapability('agent-conversation', undefined);
    expect(models.length).toBeGreaterThanOrEqual(1);
    expect(models[0]?.id).toBe(firstModel.id);
  });

  // B5 — No-op when assignment already exists (even at priority 2 / different model)
  it('B5: does NOT overwrite when an agent-conversation assignment already exists', async () => {
    // Seed an Ollama model assigned at priority 2 manually
    const ollama = await db.createProvider({
      type: 'ollama',
      name: 'Ollama',
      baseUrl: 'http://localhost:11434',
    });
    const ollamaModel = await db.createModel({
      providerId: ollama.id,
      modelId: 'llama3.2',
      displayName: 'Llama',
      capabilities: ['agent-conversation'],
    });
    await db.assignCapability({
      capability: 'agent-conversation',
      modelId: ollamaModel.id,
      priority: 2,
    });

    // Also create an Anthropic provider with Haiku to ensure it is NOT
    // auto-preferred over the existing assignment.
    const anthropic = await db.createProvider({
      type: 'anthropic',
      name: 'Anthropic',
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'sk-ant-test',
    });
    await db.createModel({
      providerId: anthropic.id,
      modelId: 'claude-haiku-4-5-20251001',
      displayName: 'Claude Haiku 4.5',
      capabilities: ['agent-conversation'],
    });

    const log = makeLog();
    await bootstrapAgentConversation(db, log);

    const assignments = await db.listCapabilityAssignments();
    const agent = assignments.filter((a) => a.capability === 'agent-conversation');
    // Exactly one pre-existing assignment remains — NOT two
    expect(agent.length).toBe(1);
    expect(agent[0]?.modelId).toBe(ollamaModel.id);
    expect(agent[0]?.priority).toBe(2);
  });

  // B6 — No-models branch: warn and proceed
  it('B6: logs a warning and returns without throwing when no models are registered', async () => {
    const log = makeLog();
    await expect(bootstrapAgentConversation(db, log)).resolves.not.toThrow();

    expect(log.warn).toHaveBeenCalled();
    const warnArgs = log.warn.mock.calls[0];
    // Pino logger shape: ({obj}, 'message') — message is the second arg
    const warnMessage = warnArgs?.[1] ?? warnArgs?.[0];
    expect(String(warnMessage)).toContain('agent-conversation');
    expect(String(warnMessage).toLowerCase()).toContain('no models');
  });

  // B7 — Acceptance fixture: fresh-install invariant
  it('B7: fresh install → db.getModelsForCapability(agent-conversation, undefined) ≥ 1 after bootstrap', async () => {
    const provider = await db.createProvider({
      type: 'anthropic',
      name: 'Anthropic',
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'sk-ant-test',
    });
    await db.createModel({
      providerId: provider.id,
      modelId: 'claude-haiku-4-5-20251001',
      displayName: 'Claude Haiku 4.5',
      capabilities: ['agent-conversation'],
    });

    // Acceptance gate: no admin UI interaction, just startup bootstrap
    const log = makeLog();
    await bootstrapAgentConversation(db, log);

    const models = await db.getModelsForCapability('agent-conversation', undefined);
    expect(models.length).toBeGreaterThanOrEqual(1);
  });
});
