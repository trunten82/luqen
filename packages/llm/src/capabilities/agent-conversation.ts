/**
 * Phase 32-02 — `agent-conversation` capability.
 *
 * Streaming LLM capability consumed by AgentService (Plan 04). Unlike the
 * four pre-existing capabilities (extract-requirements, generate-fix,
 * analyse-report, discover-branding) this returns an `AsyncIterable<StreamFrame>`
 * rather than a synchronous `CapabilityResult<T>` — the contract is
 * token-level streaming with provider-native tool calls.
 *
 * Contract invariants:
 *  - AGENT-02: all model turns route through the capability engine so per-org
 *    model overrides + provider fallback keep working.
 *  - D-10: input.messages is the rolling window; this capability does NOT
 *    maintain state across turns (caller owns the window).
 *  - D-13 + AI-SPEC §4b.3: system prompt is the `agent-system` template
 *    (default from `buildAgentSystemPrompt()` or the per-org override read
 *    path) with `{agentDisplayName}` interpolated. User message content is
 *    NEVER concatenated into the system parameter — it flows as a separate
 *    `role='user'` ChatMessage.
 *  - D-14 defence-in-depth: per-org override is still honoured on the READ
 *    path (we read whatever's in the DB) but WRITES are blocked at the PUT
 *    route in prompts.ts. The UI (Plan 05) also hides the control.
 *  - D-23: mid-stream provider errors are forwarded to the caller as an
 *    `error` StreamFrame, which then consumes the turn — the capability
 *    does NOT retry to the next provider. Only stream-OPEN failures
 *    (first `.next()` throws) trigger provider fallback.
 */

import type { DbAdapter } from '../db/adapter.js';
import type {
  ChatMessage,
  LLMProviderAdapter,
  StreamFrame,
  ToolDef,
} from '../providers/types.js';
import { CapabilityExhaustedError, CapabilityNotConfiguredError } from './types.js';
import { buildAgentSystemPrompt } from '../prompts/agent-system.js';
import { interpolateTemplate } from '../prompts/helpers.js';

export interface AgentConversationInput {
  readonly orgId: string;
  readonly userId: string;
  readonly messages: ReadonlyArray<ChatMessage>;
  readonly tools: ReadonlyArray<ToolDef>;
  readonly agentDisplayName: string;
  readonly signal?: AbortSignal;
}

/**
 * Defence-in-depth sanitisation for agentDisplayName (threat T-32-02-03).
 * Plan 08 validates the display name at write time (zod, no HTML, no URLs);
 * this capability treats incoming values as "already validated" but still
 * strips `<` / `>` to the safe fallback before interpolation so a bypass
 * in Plan 08's validator cannot escape into the system prompt unescaped.
 */
const SAFE_DISPLAY_NAME_FALLBACK = 'Luqen Assistant';

function sanitiseDisplayName(raw: string): string {
  if (raw.includes('<') || raw.includes('>')) {
    return SAFE_DISPLAY_NAME_FALLBACK;
  }
  return raw;
}

export async function* executeAgentConversation(
  db: DbAdapter,
  adapterFactory: (type: string) => LLMProviderAdapter,
  input: AgentConversationInput,
): AsyncIterable<StreamFrame> {
  const models = await db.getModelsForCapability('agent-conversation', input.orgId);
  if (models.length === 0) {
    throw new CapabilityNotConfiguredError('agent-conversation');
  }

  // Resolve system prompt: per-org override (read path only — PUT is blocked
  // in the route layer for agent-system per D-14) OR default template.
  const override = await db.getPromptOverride(
    'agent-system' as unknown as Parameters<typeof db.getPromptOverride>[0],
    input.orgId,
  );
  const rawTemplate = override != null ? override.template : buildAgentSystemPrompt();
  const safeDisplayName = sanitiseDisplayName(input.agentDisplayName);
  const systemContent = interpolateTemplate(rawTemplate, {
    agentDisplayName: safeDisplayName,
  });

  const fullMessages: ChatMessage[] = [
    { role: 'system', content: systemContent },
    ...input.messages,
  ];

  const errors: Error[] = [];

  for (const model of models) {
    const provider = await db.getProvider(model.providerId);
    if (provider == null) continue;

    const adapter = adapterFactory(provider.type);

    // Stream-open phase: any throw here triggers fallback to the next
    // provider. Once we successfully begin iteration (first .next()
    // resolves) we commit to this provider for the rest of the turn —
    // mid-stream errors are forwarded to the caller (D-23).
    let iter: AsyncIterator<StreamFrame> | undefined;
    try {
      const connectConfig: { baseUrl: string; apiKey?: string } =
        provider.apiKey != null
          ? { baseUrl: provider.baseUrl, apiKey: provider.apiKey }
          : { baseUrl: provider.baseUrl };
      await adapter.connect(connectConfig);

      if (typeof adapter.completeStream !== 'function') {
        throw new Error(
          `Provider ${provider.type} does not support streaming (completeStream not implemented)`,
        );
      }

      const iterable = adapter.completeStream(
        fullMessages,
        {
          model: model.modelId,
          temperature: 0.3,
          maxTokens: 2048,
          timeout: provider.timeout,
          tools: input.tools,
        },
        input.signal,
      );
      iter = iterable[Symbol.asyncIterator]();

      // Prime the iterator — this is the "stream-open" boundary. If the
      // provider fails here we fall through to the next provider.
      const first = await iter.next();

      if (!first.done) {
        yield first.value;
      }

      // After the first frame is in the hands of the caller, we're committed
      // — forward every subsequent frame verbatim (including mid-stream
      // error frames).
      while (true) {
        const step = await iter.next();
        if (step.done) break;
        yield step.value;
      }

      return;
    } catch (err) {
      errors.push(err instanceof Error ? err : new Error(String(err)));
      try {
        await adapter.disconnect();
      } catch {
        // ignore — adapter already failed; disconnect failure is secondary
      }
      // Try next provider
      continue;
    }
  }

  throw new CapabilityExhaustedError(
    'agent-conversation',
    models.length,
    errors[errors.length - 1],
  );
}
