/**
 * Phase 35 Plan 02 — conversation-title-generator.
 *
 * Generates a 3–5 word conversation title after the first assistant response
 * completes (see 35-CONTEXT.md D-02 / D-03). The LLM transport is a
 * constructor-style dependency (structurally typed) so tests can stub the
 * network boundary without monkey-patching imports.
 *
 * Failure policy (D-03): any LLM error / empty output / malformed response
 * resolves to `fallbackTitle(userMessage)` — a whitespace-collapsed, 50-char
 * truncation of the user's first message. No retry, no re-throw. This runs
 * fire-and-forget from AgentService (wired in Plan 03), so we MUST NOT leak
 * errors upward; the caller has no recovery path.
 *
 * Threat T-35-05: LLM output is untrusted. `sanitiseTitle` applies a hard
 * 80-char ceiling and strips untrusted formatting (quotes, prefixes, trailing
 * punctuation) before the string is persisted as `agent_conversations.title`.
 *
 * Immutability: every helper returns a new string; no input mutation.
 */

import type {
  AgentStreamInput,
  AgentStreamOptions,
  AgentStreamTurn,
} from './agent-service.js';

/**
 * Structural LLM dependency — mirrors `LlmAgentTransport` in `agent-service.ts`
 * so AgentService's existing `llm` field can be injected verbatim in Plan 03.
 * Re-declared structurally here to keep the title generator importable in
 * tests without pulling the AgentService class itself.
 */
export interface TitleGeneratorLLM {
  readonly streamAgentConversation: (
    input: AgentStreamInput,
    opts: AgentStreamOptions,
  ) => Promise<AgentStreamTurn>;
}

export interface GenerateTitleArgs {
  readonly llm: TitleGeneratorLLM;
  readonly orgId: string;
  readonly userId: string;
  readonly agentDisplayName: string;
  readonly userMessage: string;
  readonly assistantReply: string;
  readonly signal?: AbortSignal;
}

const TITLE_HARD_CEILING = 80;
const FALLBACK_MAX_CHARS = 50;

/**
 * Build the summarisation prompt sent to the LLM. Deliberately explicit about
 * the output format so the majority of responses need no sanitisation.
 */
export function buildTitlePrompt(userMessage: string, assistantReply: string): string {
  return (
    'Summarise this exchange in 3 to 5 words. Return ONLY the title — ' +
    'no quotes, no trailing punctuation, no preface.\n\n' +
    `User: ${userMessage}\n` +
    `Assistant: ${assistantReply}`
  );
}

/**
 * Defence-in-depth cleanup for untrusted LLM output before persistence.
 * Order matters: prefix/quote strip happens BEFORE whitespace collapse so a
 * leading `"Title: "` is removed as a unit.
 */
export function sanitiseTitle(raw: string): string {
  let out = raw.trim();
  if (out.length === 0) return '';
  // Strip a single leading "Title:" / "Subject:" (case-insensitive).
  out = out.replace(/^(title|subject)\s*:\s*/i, '');
  // Strip surrounding quotes (straight + curly).
  out = out.replace(/^["'\u201C\u201D\u2018\u2019]+/, '').replace(/["'\u201C\u201D\u2018\u2019]+$/, '');
  // Strip trailing sentence punctuation.
  out = out.replace(/[.!?]+$/, '');
  // Collapse internal whitespace.
  out = out.replace(/\s+/g, ' ').trim();
  // Hard ceiling (defence in depth — model is asked for ≤5 words).
  if (out.length > TITLE_HARD_CEILING) {
    out = out.slice(0, TITLE_HARD_CEILING).trim();
  }
  return out;
}

/**
 * Deterministic fallback: first user message, whitespace collapsed, truncated
 * to 50 characters. Used whenever LLM generation fails or returns empty.
 */
export function fallbackTitle(userMessage: string): string {
  return userMessage.replace(/\s+/g, ' ').trim().slice(0, FALLBACK_MAX_CHARS);
}

/**
 * Main entry point. Invokes the LLM once with a bounded prompt and returns
 * a sanitised title or the deterministic fallback. Never throws.
 *
 * Caller (AgentService in Plan 03) invokes this fire-and-forget after the
 * first assistant turn completes. No logging here: the caller owns telemetry.
 */
export async function generateConversationTitle(args: GenerateTitleArgs): Promise<string> {
  const prompt = buildTitlePrompt(args.userMessage, args.assistantReply);
  const signal = args.signal ?? new AbortController().signal;
  try {
    const turn = await args.llm.streamAgentConversation(
      {
        messages: [{ role: 'user', content: prompt }],
        tools: [],
        orgId: args.orgId,
        userId: args.userId,
        agentDisplayName: args.agentDisplayName,
        contextHintsBlock: '',
      },
      {
        signal,
        onFrame: () => {
          /* title generation ignores intermediate frames */
        },
      },
    );
    const text = typeof turn.text === 'string' ? turn.text : '';
    const sanitised = sanitiseTitle(text);
    return sanitised.length > 0 ? sanitised : fallbackTitle(args.userMessage);
  } catch {
    // D-03: any failure falls back silently. No retry.
    return fallbackTitle(args.userMessage);
  }
}
