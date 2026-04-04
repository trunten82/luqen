import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';

const TEST_DB_PATH = '/tmp/llm-test.db';

function cleanup() {
  if (existsSync(TEST_DB_PATH)) {
    unlinkSync(TEST_DB_PATH);
  }
}

describe('SqliteAdapter', () => {
  let adapter: SqliteAdapter;

  beforeEach(async () => {
    cleanup();
    adapter = new SqliteAdapter(TEST_DB_PATH);
    await adapter.initialize();
  });

  afterEach(async () => {
    await adapter.close();
    cleanup();
  });

  // 1. Creates and retrieves a provider
  it('creates and retrieves a provider', async () => {
    const provider = await adapter.createProvider({
      name: 'Ollama Local',
      type: 'ollama',
      baseUrl: 'http://localhost:11434',
    });

    expect(provider.id).toBeDefined();
    expect(provider.name).toBe('Ollama Local');
    expect(provider.type).toBe('ollama');
    expect(provider.baseUrl).toBe('http://localhost:11434');
    expect(provider.status).toBe('active');
    expect(provider.createdAt).toBeDefined();
    expect(provider.updatedAt).toBeDefined();
    expect(provider.apiKey).toBeUndefined();

    const fetched = await adapter.getProvider(provider.id);
    expect(fetched).toEqual(provider);
  });

  // 2. Lists all providers
  it('lists all providers', async () => {
    await adapter.createProvider({ name: 'Provider A', type: 'ollama', baseUrl: 'http://a.com' });
    await adapter.createProvider({ name: 'Provider B', type: 'openai', baseUrl: 'http://b.com', apiKey: 'sk-test' });

    const providers = await adapter.listProviders();
    expect(providers).toHaveLength(2);
    expect(providers[0].name).toBe('Provider A');
    expect(providers[1].name).toBe('Provider B');
    expect(providers[1].apiKey).toBe('sk-test');
  });

  // 3. Updates a provider
  it('updates a provider', async () => {
    const provider = await adapter.createProvider({
      name: 'Old Name',
      type: 'ollama',
      baseUrl: 'http://old.com',
    });

    const updated = await adapter.updateProvider(provider.id, {
      name: 'New Name',
      status: 'inactive',
    });

    expect(updated).toBeDefined();
    expect(updated!.name).toBe('New Name');
    expect(updated!.status).toBe('inactive');
    expect(updated!.baseUrl).toBe('http://old.com');
    expect(updated!.updatedAt).toBeDefined();
    expect(updated!.id).toBe(provider.id);
  });

  // 4. Deletes a provider and cascades to models
  it('deletes a provider and cascades to models', async () => {
    const provider = await adapter.createProvider({
      name: 'To Delete',
      type: 'ollama',
      baseUrl: 'http://delete.com',
    });
    const model = await adapter.createModel({
      providerId: provider.id,
      modelId: 'llama3',
      displayName: 'Llama 3',
    });

    expect(await adapter.getModel(model.id)).toBeDefined();

    const deleted = await adapter.deleteProvider(provider.id);
    expect(deleted).toBe(true);

    expect(await adapter.getProvider(provider.id)).toBeUndefined();
    expect(await adapter.getModel(model.id)).toBeUndefined();
  });

  // 5. Creates and lists models for a provider
  it('creates and lists models for a provider', async () => {
    const providerA = await adapter.createProvider({ name: 'A', type: 'ollama', baseUrl: 'http://a.com' });
    const providerB = await adapter.createProvider({ name: 'B', type: 'openai', baseUrl: 'http://b.com' });

    await adapter.createModel({ providerId: providerA.id, modelId: 'llama3', displayName: 'Llama 3', capabilities: ['generate-fix'] });
    await adapter.createModel({ providerId: providerA.id, modelId: 'llama3:70b', displayName: 'Llama 3 70B' });
    await adapter.createModel({ providerId: providerB.id, modelId: 'gpt-4o', displayName: 'GPT-4o' });

    const allModels = await adapter.listModels();
    expect(allModels).toHaveLength(3);

    const aModels = await adapter.listModels(providerA.id);
    expect(aModels).toHaveLength(2);
    expect(aModels[0].capabilities).toEqual(['generate-fix']);
    expect(aModels[1].capabilities).toEqual([]);

    const bModels = await adapter.listModels(providerB.id);
    expect(bModels).toHaveLength(1);
    expect(bModels[0].modelId).toBe('gpt-4o');
  });

  // 6. Deletes a model
  it('deletes a model', async () => {
    const provider = await adapter.createProvider({ name: 'P', type: 'ollama', baseUrl: 'http://p.com' });
    const model = await adapter.createModel({ providerId: provider.id, modelId: 'm1', displayName: 'M1' });

    expect(await adapter.getModel(model.id)).toBeDefined();

    const deleted = await adapter.deleteModel(model.id);
    expect(deleted).toBe(true);
    expect(await adapter.getModel(model.id)).toBeUndefined();

    const notFound = await adapter.deleteModel('nonexistent');
    expect(notFound).toBe(false);
  });

  // 7. Assigns and retrieves capability
  it('assigns and retrieves a capability assignment', async () => {
    const provider = await adapter.createProvider({ name: 'P', type: 'ollama', baseUrl: 'http://p.com' });
    const model = await adapter.createModel({ providerId: provider.id, modelId: 'm1', displayName: 'M1' });

    const assignment = await adapter.assignCapability({
      capability: 'generate-fix',
      modelId: model.id,
      priority: 1,
    });

    expect(assignment.capability).toBe('generate-fix');
    expect(assignment.modelId).toBe(model.id);
    expect(assignment.priority).toBe(1);
    expect(assignment.orgId).toBe('');

    const assignments = await adapter.listCapabilityAssignments();
    expect(assignments).toHaveLength(1);
    expect(assignments[0]).toEqual(assignment);
  });

  // 8. getModelForCapability returns best priority model
  it('getModelForCapability returns lowest priority model', async () => {
    const provider = await adapter.createProvider({ name: 'P', type: 'ollama', baseUrl: 'http://p.com' });
    const modelA = await adapter.createModel({ providerId: provider.id, modelId: 'mA', displayName: 'Model A' });
    const modelB = await adapter.createModel({ providerId: provider.id, modelId: 'mB', displayName: 'Model B' });

    await adapter.assignCapability({ capability: 'analyse-report', modelId: modelA.id, priority: 10 });
    await adapter.assignCapability({ capability: 'analyse-report', modelId: modelB.id, priority: 1 });

    const best = await adapter.getModelForCapability('analyse-report');
    expect(best).toBeDefined();
    expect(best!.id).toBe(modelB.id);
  });

  // 9. getModelForCapability respects org-scoped override
  it('getModelForCapability prefers org-scoped over system assignment', async () => {
    const provider = await adapter.createProvider({ name: 'P', type: 'ollama', baseUrl: 'http://p.com' });
    const systemModel = await adapter.createModel({ providerId: provider.id, modelId: 'sys', displayName: 'System Model' });
    const orgModel = await adapter.createModel({ providerId: provider.id, modelId: 'org', displayName: 'Org Model' });

    // System-level assignment
    await adapter.assignCapability({ capability: 'extract-requirements', modelId: systemModel.id, priority: 0 });
    // Org-scoped assignment
    await adapter.assignCapability({ capability: 'extract-requirements', modelId: orgModel.id, priority: 0, orgId: 'org-1' });

    const forOrg = await adapter.getModelForCapability('extract-requirements', 'org-1');
    expect(forOrg).toBeDefined();
    expect(forOrg!.id).toBe(orgModel.id);

    const systemFallback = await adapter.getModelForCapability('extract-requirements');
    expect(systemFallback).toBeDefined();
    expect(systemFallback!.id).toBe(systemModel.id);
  });

  // 10. Unassigns a capability
  it('unassigns a capability', async () => {
    const provider = await adapter.createProvider({ name: 'P', type: 'ollama', baseUrl: 'http://p.com' });
    const model = await adapter.createModel({ providerId: provider.id, modelId: 'm1', displayName: 'M1' });

    await adapter.assignCapability({ capability: 'discover-branding', modelId: model.id });

    const unassigned = await adapter.unassignCapability('discover-branding', model.id);
    expect(unassigned).toBe(true);

    const assignments = await adapter.listCapabilityAssignments();
    expect(assignments).toHaveLength(0);

    const notFound = await adapter.unassignCapability('discover-branding', model.id);
    expect(notFound).toBe(false);
  });

  // 11. Creates and retrieves a client
  it('creates and retrieves an OAuth client', async () => {
    const client = await adapter.createClient({
      name: 'Test App',
      secretHash: 'hashed-secret',
      scopes: ['providers:read', 'models:write'],
      grantTypes: ['client_credentials'],
      orgId: 'org-abc',
    });

    expect(client.id).toBeDefined();
    expect(client.name).toBe('Test App');
    expect(client.secretHash).toBe('hashed-secret');
    expect(client.scopes).toEqual(['providers:read', 'models:write']);
    expect(client.grantTypes).toEqual(['client_credentials']);
    expect(client.orgId).toBe('org-abc');
    expect(client.createdAt).toBeDefined();

    const fetched = await adapter.getClientById(client.id);
    expect(fetched).toEqual(client);

    const listed = await adapter.listClients();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toEqual(client);
  });

  // 12. Creates provider with custom timeout
  it('creates provider with custom timeout', async () => {
    const provider = await adapter.createProvider({
      name: 'Custom Timeout Provider',
      type: 'ollama',
      baseUrl: 'http://localhost:11434',
      timeout: 30,
    });
    expect(provider.timeout).toBe(30);
  });

  // 13. Creates provider with default timeout
  it('creates provider with default timeout of 120', async () => {
    const provider = await adapter.createProvider({
      name: 'Default Timeout Provider',
      type: 'openai',
      baseUrl: 'http://api.openai.com',
    });
    expect(provider.timeout).toBe(120);
  });

  // 14. Updates provider timeout
  it('updates provider timeout', async () => {
    const provider = await adapter.createProvider({
      name: 'Updatable Provider',
      type: 'ollama',
      baseUrl: 'http://localhost:11434',
    });
    expect(provider.timeout).toBe(120);

    const updated = await adapter.updateProvider(provider.id, { timeout: 60 });
    expect(updated).toBeDefined();
    expect(updated!.timeout).toBe(60);
  });

  // 15. Sets and gets a prompt override
  it('sets and gets a prompt override', async () => {
    const override = await adapter.setPromptOverride('generate-fix', 'Fix this: {{issue}}');
    expect(override.capability).toBe('generate-fix');
    expect(override.orgId).toBe('system');
    expect(override.template).toBe('Fix this: {{issue}}');
    expect(override.createdAt).toBeDefined();
    expect(override.updatedAt).toBeDefined();

    const fetched = await adapter.getPromptOverride('generate-fix');
    expect(fetched).toEqual(override);
  });

  // 16. Gets org-scoped prompt override
  it('gets org-scoped prompt override separately from system', async () => {
    await adapter.setPromptOverride('analyse-report', 'System template');
    await adapter.setPromptOverride('analyse-report', 'Org template', 'org-1');

    const systemOverride = await adapter.getPromptOverride('analyse-report');
    expect(systemOverride?.template).toBe('System template');
    expect(systemOverride?.orgId).toBe('system');

    const orgOverride = await adapter.getPromptOverride('analyse-report', 'org-1');
    expect(orgOverride?.template).toBe('Org template');
    expect(orgOverride?.orgId).toBe('org-1');
  });

  // 17. Deletes a prompt override
  it('deletes a prompt override', async () => {
    await adapter.setPromptOverride('discover-branding', 'My template');

    const deleted = await adapter.deletePromptOverride('discover-branding');
    expect(deleted).toBe(true);

    const fetched = await adapter.getPromptOverride('discover-branding');
    expect(fetched).toBeUndefined();

    const notFound = await adapter.deletePromptOverride('discover-branding');
    expect(notFound).toBe(false);
  });

  // 18. Lists all prompt overrides
  it('lists all prompt overrides', async () => {
    await adapter.setPromptOverride('generate-fix', 'Template A');
    await adapter.setPromptOverride('analyse-report', 'Template B');
    await adapter.setPromptOverride('generate-fix', 'Org Template A', 'org-1');

    const all = await adapter.listPromptOverrides();
    expect(all).toHaveLength(3);
  });

  // 19. getModelsForCapability returns all models ordered by priority
  it('getModelsForCapability returns all models ordered by priority', async () => {
    const provider = await adapter.createProvider({ name: 'P', type: 'ollama', baseUrl: 'http://p.com' });
    const modelA = await adapter.createModel({ providerId: provider.id, modelId: 'mA', displayName: 'Model A' });
    const modelB = await adapter.createModel({ providerId: provider.id, modelId: 'mB', displayName: 'Model B' });
    const modelC = await adapter.createModel({ providerId: provider.id, modelId: 'mC', displayName: 'Model C' });

    await adapter.assignCapability({ capability: 'analyse-report', modelId: modelA.id, priority: 10 });
    await adapter.assignCapability({ capability: 'analyse-report', modelId: modelB.id, priority: 1 });
    await adapter.assignCapability({ capability: 'analyse-report', modelId: modelC.id, priority: 5 });

    const models = await adapter.getModelsForCapability('analyse-report');
    expect(models).toHaveLength(3);
    expect(models[0].id).toBe(modelB.id); // priority 1
    expect(models[1].id).toBe(modelC.id); // priority 5
    expect(models[2].id).toBe(modelA.id); // priority 10
  });

  // 20. Creates and retrieves a user
  it('creates and retrieves a user', async () => {
    const user = await adapter.createUser({
      username: 'admin',
      passwordHash: 'bcrypt-hash',
      role: 'admin',
    });

    expect(user.id).toBeDefined();
    expect(user.username).toBe('admin');
    expect(user.passwordHash).toBe('bcrypt-hash');
    expect(user.role).toBe('admin');
    expect(user.active).toBe(true);
    expect(user.createdAt).toBeDefined();

    const fetched = await adapter.getUserByUsername('admin');
    expect(fetched).toEqual(user);

    const notFound = await adapter.getUserByUsername('nobody');
    expect(notFound).toBeUndefined();
  });
});
