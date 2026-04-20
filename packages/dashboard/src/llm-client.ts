// ── LLM Service Client ──────────────────────────────────────────────────────
// Proxies dashboard requests to the @luqen/llm service.
// Authentication: OAuth2 client_credentials (same pattern as compliance/branding).

import { ServiceTokenManager } from './auth/service-token.js';
import type { OrgRepository } from './db/interfaces/org-repository.js';
import { SseFrameSchema, type SseFrame } from './agent/sse-frames.js';
import type {
  AgentStreamInput,
  AgentStreamOptions,
  AgentStreamTurn,
} from './agent/agent-service.js';

function unwrapList<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result != null && typeof result === 'object' && 'data' in result) {
    return (result as { data: T[] }).data;
  }
  return [];
}

/**
 * Parse a single SSE frame (block of lines separated from the next by \n\n).
 * Validates via SseFrameSchema so downstream code gets a typed frame — a
 * malformed chunk from the wire is treated as "skip unknown" rather than a
 * hard error (defence-in-depth against transport corruption).
 */
function parseSseFrame(block: string): SseFrame | null {
  const dataLine = block
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('data:'));
  if (dataLine === undefined) return null;
  const json = dataLine.slice('data:'.length).trim();
  if (json.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    const result = SseFrameSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

// ── Provider types ──────────────────────────────────────────────────────────

export interface LLMProvider {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly baseUrl?: string;
  readonly status: 'active' | 'inactive' | 'error';
  readonly timeout: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateProviderInput {
  readonly name: string;
  readonly type: string;
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly timeout?: number;
}

export interface UpdateProviderInput {
  readonly name?: string;
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly status?: 'active' | 'inactive';
}

// ── Model types ─────────────────────────────────────────────────────────────

export interface LLMModel {
  readonly id: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly displayName: string;
  readonly status: 'active' | 'inactive';
  readonly capabilities: readonly string[];
  readonly createdAt: string;
}

export interface CreateModelInput {
  readonly providerId: string;
  readonly modelId: string;
  readonly displayName: string;
  readonly capabilities?: readonly string[];
}

// ── Capability types ────────────────────────────────────────────────────────

export interface LLMCapability {
  readonly name: string;
  readonly assignments: ReadonlyArray<{
    readonly capability: string;
    readonly modelId: string;
    readonly priority: number;
    readonly orgId: string;
  }>;
}

export interface AssignCapabilityInput {
  readonly modelId: string;
  readonly priority?: number;
}

// ── Prompt types ────────────────────────────────────────────────────────────

export interface LLMPrompt {
  readonly capability: string;
  readonly template: string;
  readonly isOverride: boolean;
  readonly updatedAt?: string;
}

/**
 * Thrown by LLMClient.setPrompt when the LLM service returns 422.
 * Each violation includes the locked section name, the reason it was rejected,
 * and an optional explanation string sourced from LOCKED_SECTION_EXPLANATIONS
 * in the LLM service.
 */
export class LLMValidationError extends Error {
  readonly violations: ReadonlyArray<{ name: string; reason: string; explanation?: string }>;

  constructor(message: string, violations: ReadonlyArray<{ name: string; reason: string; explanation?: string }> = []) {
    super(message);
    this.name = 'LLMValidationError';
    this.violations = violations;
  }
}

// ── Health / Status types ───────────────────────────────────────────────────

export interface LLMHealth {
  readonly status: string;
  readonly version?: string;
}

export interface LLMStatus {
  readonly providers: number;
  readonly models: number;
  readonly capabilities: readonly string[];
}

// ── Remote model (from provider API) ───────────────────────────────────────

export interface RemoteModel {
  readonly id: string;
  readonly name?: string;
}

// ── Client class ────────────────────────────────────────────────────────────

export class LLMClient {
  private readonly _baseUrl: string;
  private readonly tokenManager: ServiceTokenManager;

  constructor(baseUrl: string, clientId: string, clientSecret: string) {
    this._baseUrl = baseUrl.replace(/\/$/, '');
    this.tokenManager = new ServiceTokenManager(baseUrl, clientId, clientSecret);
  }

  /** Destroy the underlying token refresh timer. */
  destroy(): void {
    this.tokenManager.destroy();
  }

  /** The base URL of the LLM service (for standalone provisioning calls). */
  get baseUrl(): string {
    return this._baseUrl;
  }

  /** Obtain the current admin bearer token (for standalone provisioning calls). */
  async getToken(): Promise<string | null> {
    return this.tokenManager.getToken();
  }

  private async apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
    const token = await this.tokenManager.getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const response = await fetch(url, { ...options, headers });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: ${body}`);
    }

    return response.json() as Promise<T>;
  }

  private async deleteRequest(url: string): Promise<void> {
    const token = await this.tokenManager.getToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const response = await fetch(url, {
      method: 'DELETE',
      headers,
      body: '{}',
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: ${body}`);
    }
  }

  // -- Providers ──────────────────────────────────────────────────────────

  async listProviders(): Promise<LLMProvider[]> {
    const result = await this.apiFetch<unknown>(`${this._baseUrl}/api/v1/providers`);
    return unwrapList<LLMProvider>(result);
  }

  async createProvider(data: CreateProviderInput): Promise<LLMProvider> {
    return this.apiFetch<LLMProvider>(`${this._baseUrl}/api/v1/providers`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateProvider(id: string, data: UpdateProviderInput): Promise<LLMProvider> {
    return this.apiFetch<LLMProvider>(`${this._baseUrl}/api/v1/providers/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteProvider(id: string): Promise<void> {
    await this.deleteRequest(`${this._baseUrl}/api/v1/providers/${encodeURIComponent(id)}`);
  }

  async testProvider(id: string): Promise<{ ok: boolean; status: string }> {
    return this.apiFetch<{ ok: boolean; status: string }>(
      `${this._baseUrl}/api/v1/providers/${encodeURIComponent(id)}/test`,
      { method: 'POST', body: '{}' },
    );
  }

  async listRemoteModels(providerId: string): Promise<RemoteModel[]> {
    const result = await this.apiFetch<unknown>(
      `${this._baseUrl}/api/v1/providers/${encodeURIComponent(providerId)}/models`,
    );
    return unwrapList<RemoteModel>(result);
  }

  // -- Models ─────────────────────────────────────────────────────────────

  async listModels(): Promise<LLMModel[]> {
    const result = await this.apiFetch<unknown>(`${this._baseUrl}/api/v1/models`);
    return unwrapList<LLMModel>(result);
  }

  async createModel(data: CreateModelInput): Promise<LLMModel> {
    return this.apiFetch<LLMModel>(`${this._baseUrl}/api/v1/models`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async deleteModel(id: string): Promise<void> {
    await this.deleteRequest(`${this._baseUrl}/api/v1/models/${encodeURIComponent(id)}`);
  }

  // -- Capabilities ───────────────────────────────────────────────────────

  async listCapabilities(): Promise<LLMCapability[]> {
    const result = await this.apiFetch<unknown>(`${this._baseUrl}/api/v1/capabilities`);
    return unwrapList<LLMCapability>(result);
  }

  async assignCapability(name: string, data: AssignCapabilityInput): Promise<void> {
    await this.apiFetch<unknown>(
      `${this._baseUrl}/api/v1/capabilities/${encodeURIComponent(name)}/assign`,
      { method: 'PUT', body: JSON.stringify(data) },
    );
  }

  async unassignCapability(name: string, modelId: string): Promise<void> {
    await this.deleteRequest(
      `${this._baseUrl}/api/v1/capabilities/${encodeURIComponent(name)}/assign/${encodeURIComponent(modelId)}`,
    );
  }

  async updateCapabilityPriority(capability: string, modelId: string, priority: number): Promise<void> {
    await this.apiFetch<unknown>(
      `${this._baseUrl}/api/v1/capabilities/${encodeURIComponent(capability)}/assign/${encodeURIComponent(modelId)}`,
      { method: 'PATCH', body: JSON.stringify({ priority }) },
    );
  }

  // -- Prompts ────────────────────────────────────────────────────────────

  async listPrompts(): Promise<LLMPrompt[]> {
    const result = await this.apiFetch<unknown>(`${this._baseUrl}/api/v1/prompts`);
    return unwrapList<LLMPrompt>(result);
  }

  async getPrompt(capability: string): Promise<LLMPrompt> {
    return this.apiFetch<LLMPrompt>(
      `${this._baseUrl}/api/v1/prompts/${encodeURIComponent(capability)}`,
    );
  }

  async setPrompt(capability: string, template: string): Promise<LLMPrompt> {
    const token = await this.tokenManager.getToken();
    const res = await fetch(
      `${this._baseUrl}/api/v1/prompts/${encodeURIComponent(capability)}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ template }),
      },
    );
    if (res.status === 422) {
      const body = await res.json().catch(() => ({})) as Record<string, unknown>;
      const violations = (body['violations'] as ReadonlyArray<{ name: string; reason: string; explanation?: string }>) ?? [];
      throw new LLMValidationError(
        typeof body['error'] === 'string' ? body['error'] : 'Validation failed',
        violations,
      );
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    return res.json() as Promise<LLMPrompt>;
  }

  /**
   * Fetch the default prompt for a capability (without any org override).
   * Uses a synthetic orgId that will never match a real override, forcing
   * the LLM service to return the built-in default template.
   */
  async getDefaultPrompt(capability: string): Promise<LLMPrompt> {
    return this.apiFetch<LLMPrompt>(
      `${this._baseUrl}/api/v1/prompts/${encodeURIComponent(capability)}?orgId=__force_default__`,
    );
  }

  async deletePrompt(capability: string): Promise<void> {
    await this.deleteRequest(
      `${this._baseUrl}/api/v1/prompts/${encodeURIComponent(capability)}`,
    );
  }

  // -- Generate Fix ───────────────────────────────────────────────────────

  async generateFix(input: {
    readonly wcagCriterion: string;
    readonly issueMessage: string;
    readonly htmlContext: string;
    readonly cssContext?: string;
    readonly orgId?: string;
  }): Promise<{ fixedHtml: string; explanation: string; effort: string }> {
    return this.apiFetch<{ fixedHtml: string; explanation: string; effort: string }>(
      `${this._baseUrl}/api/v1/generate-fix`,
      { method: 'POST', body: JSON.stringify(input) },
    );
  }

  // -- Analyse Report ─────────────────────────────────────────────────────

  async analyseReport(input: {
    readonly siteUrl: string;
    readonly totalIssues: number;
    readonly issuesList: ReadonlyArray<{
      readonly criterion: string;
      readonly message: string;
      readonly count: number;
      readonly level: string;
    }>;
    readonly complianceSummary: string;
    readonly recurringPatterns: readonly string[];
    readonly orgId?: string;
  }): Promise<{
    executiveSummary: string;
    keyFindings: string[];
    patterns: string[];
    priorities: string[];
  }> {
    return this.apiFetch<{
      executiveSummary: string;
      keyFindings: string[];
      patterns: string[];
      priorities: string[];
    }>(`${this._baseUrl}/api/v1/analyse-report`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  // -- Discover Branding ──────────────────────────────────────────────────

  async discoverBranding(input: {
    readonly url: string;
    readonly orgId?: string;
  }): Promise<{
    colors: Array<{ name: string; hex: string; usage?: string }>;
    fonts: Array<{ family: string; usage?: string }>;
    logoUrl: string;
    brandName: string;
    description: string;
  }> {
    return this.apiFetch<{
      colors: Array<{ name: string; hex: string; usage?: string }>;
      fonts: Array<{ family: string; usage?: string }>;
      logoUrl: string;
      brandName: string;
      description: string;
    }>(`${this._baseUrl}/api/v1/discover-branding`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  // -- OAuth Clients (admin) ──────────────────────────────────────────────

  async listOAuthClients(): Promise<Array<{ id: string; name: string; scopes: string[]; grantTypes: string[]; orgId: string; createdAt: string }>> {
    const result = await this.apiFetch<unknown>(`${this._baseUrl}/api/v1/clients`);
    return unwrapList(result);
  }

  async createOAuthClient(
    name: string,
    scopes: string[],
    grantTypes: string[],
    orgId?: string,
  ): Promise<{ id: string; clientId: string; clientSecret: string; name: string; createdAt: string }> {
    return this.apiFetch(`${this._baseUrl}/api/v1/clients`, {
      method: 'POST',
      body: JSON.stringify({ name, scopes, grantTypes, orgId }),
    });
  }

  async deleteOAuthClient(id: string): Promise<void> {
    await this.deleteRequest(`${this._baseUrl}/api/v1/clients/${encodeURIComponent(id)}`);
  }

  // -- Agent Conversation (streaming) ─────────────────────────────────────

  /**
   * Phase 32 Plan 04 — streaming bridge to @luqen/llm's agent-conversation
   * capability. Used by the dashboard's AgentService to drive one model turn
   * of the tool-calling loop.
   *
   * POSTs to `/api/v1/capabilities/agent-conversation` with
   * `Accept: text/event-stream`, parses the SSE body frame-by-frame, forwards
   * `token` frames via `opts.onFrame`, and resolves with a summary
   * `{ text, toolCalls }` once the stream ends (on a `done` or `tool_calls`
   * terminator). Honors `opts.signal` for user-abort propagation.
   *
   * NOTE — the HTTP route is being introduced in a follow-on LLM-module plan;
   * this client-side implementation is the dashboard half of that contract.
   * Until the route lands on @luqen/llm, this method is only exercised via
   * the `LlmAgentTransport` structural-typing interface (tests stub the whole
   * client).
   */
  async streamAgentConversation(
    input: AgentStreamInput,
    opts: AgentStreamOptions,
  ): Promise<AgentStreamTurn> {
    const token = await this.tokenManager.getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const response = await fetch(
      `${this._baseUrl}/api/v1/capabilities/agent-conversation`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          messages: input.messages,
          tools: input.tools,
          orgId: input.orgId,
          userId: input.userId,
          agentDisplayName: input.agentDisplayName,
        }),
        signal: opts.signal,
      },
    );

    if (!response.ok || response.body === null) {
      const body = await response.text().catch(() => '');
      throw new Error(`agent-conversation HTTP ${response.status}: ${body}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let accumulatedText = '';
    let toolCalls: ReadonlyArray<{ id: string; name: string; args: Record<string, unknown> }> = [];

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE frame delimiter is a blank line (\n\n). Pull complete frames off
        // the head of the buffer; leave any partial tail for the next chunk.
        let sepIdx = buffer.indexOf('\n\n');
        while (sepIdx !== -1) {
          const rawFrame = buffer.slice(0, sepIdx);
          buffer = buffer.slice(sepIdx + 2);
          const parsed = parseSseFrame(rawFrame);
          if (parsed !== null) {
            if (parsed.type === 'token') {
              accumulatedText += parsed.text;
              opts.onFrame(parsed);
            } else if (parsed.type === 'tool_calls') {
              toolCalls = parsed.calls;
              opts.onFrame(parsed);
            } else if (parsed.type === 'done' || parsed.type === 'error') {
              opts.onFrame(parsed);
            }
          }
          sepIdx = buffer.indexOf('\n\n');
        }
      }
    } finally {
      reader.releaseLock();
    }

    return { text: accumulatedText, toolCalls };
  }

  // -- Health / Status ────────────────────────────────────────────────────

  async health(): Promise<LLMHealth> {
    return this.apiFetch<LLMHealth>(`${this._baseUrl}/api/v1/health`);
  }

  async status(): Promise<LLMStatus> {
    return this.apiFetch<LLMStatus>(`${this._baseUrl}/api/v1/status`);
  }
}

/** Create an LLMClient from the configured URL + credentials. Returns null if not configured. */
export function createLLMClient(
  llmUrl: string | undefined,
  clientId: string,
  clientSecret: string,
): LLMClient | null {
  if (!llmUrl) return null;
  return new LLMClient(llmUrl, clientId, clientSecret);
}

/**
 * Resolve the correct LLMClient for a request.
 * If the org has per-org LLM credentials, a short-lived per-org client is returned.
 * Otherwise the system client is returned as fallback.
 *
 * IMPORTANT: The caller MUST call `effectiveLlm.destroy()` after use when `isPerOrg` is true
 * to release the internal ServiceTokenManager timer.
 */
export async function resolveOrgLLMClient(
  systemClient: LLMClient | null,
  orgRepository: OrgRepository,
  orgId: string | undefined,
): Promise<{ client: LLMClient | null; isPerOrg: boolean }> {
  if (!systemClient) return { client: null, isPerOrg: false };
  if (!orgId) return { client: systemClient, isPerOrg: false };

  const creds = await orgRepository.getOrgLLMCredentials(orgId);
  if (!creds) return { client: systemClient, isPerOrg: false };

  const perOrgClient = createLLMClient(systemClient.baseUrl, creds.clientId, creds.clientSecret);
  return { client: perOrgClient, isPerOrg: true };
}

/**
 * Create a per-org LLM OAuth client (dashboard-{slug}) on the LLM service.
 * Follows the same pattern as createBrandingOrgClient in branding-client.ts.
 */
export async function createLLMOrgClient(
  llmUrl: string,
  adminToken: string,
  orgId: string,
  orgSlug: string,
): Promise<{ clientId: string; clientSecret: string }> {
  const base = llmUrl.replace(/\/$/, '');
  const expectedName = `dashboard-${orgSlug}`;
  const headers = {
    'Authorization': `Bearer ${adminToken}`,
    'Content-Type': 'application/json',
  };

  // Check if a client with this name already exists on the LLM service
  // to avoid creating duplicates on repeated backfill runs.
  const listRes = await fetch(`${base}/api/v1/clients`, { headers });
  if (listRes.ok) {
    // LLM service returns array directly (no data wrapper)
    const clients = await listRes.json() as Array<{ id: string; name: string }>;
    const duplicates = clients.filter((c) => c.name === expectedName);
    if (duplicates.length > 0) {
      // Keep the first, delete the rest
      for (let i = 1; i < duplicates.length; i++) {
        await fetch(`${base}/api/v1/clients/${encodeURIComponent(duplicates[i].id)}`, {
          method: 'DELETE', headers,
        }).catch(() => {/* best-effort cleanup */});
      }
      // Return the surviving client ID — secret is lost, but we store the ID
      // so subsequent restarts skip creation entirely.
      return { clientId: duplicates[0].id, clientSecret: '' };
    }
  }

  // No existing client — create a new one.
  const response = await fetch(`${base}/api/v1/clients`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: expectedName,
      scopes: ['read', 'write'],
      grantTypes: ['client_credentials'],
      orgId,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to create LLM client: ${response.status}`);
  }

  // LLM service returns { ...client, id: clientId, clientSecret } (no data wrapper)
  const data = await response.json() as { id: string; clientSecret: string };
  return { clientId: data.id, clientSecret: data.clientSecret };
}
