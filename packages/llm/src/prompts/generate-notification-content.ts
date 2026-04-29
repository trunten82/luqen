/**
 * Phase 50-01 — Notification content generation prompt.
 *
 * Produces a system+user prompt asking the LLM to rewrite a deterministic
 * notification template for a given channel/voice/brand context. The prompt
 * REQUIRES JSON output `{ "subject": string, "body": string }` so the
 * capability can deterministic-fall-back when parsing fails.
 */

const MAX_BODY_LENGTH = 4000;

export interface NotificationPromptInput {
  readonly templateSubject: string;
  readonly templateBody: string;
  readonly voice?: string | null;
  readonly signature?: string | null;
  readonly brandName?: string | null;
  readonly brandVoice?: string | null;
  readonly eventData: Record<string, unknown>;
  readonly channel: 'email' | 'slack' | 'teams';
  readonly outputFormat: 'subject' | 'body' | 'both';
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n[... truncated]`;
}

export function buildNotificationPrompt(input: NotificationPromptInput): string {
  const voice = input.voice && input.voice.trim().length > 0 ? input.voice.trim() : 'professional, concise';
  const brandName = input.brandName && input.brandName.trim().length > 0 ? input.brandName.trim() : 'the platform';
  const brandVoice = input.brandVoice && input.brandVoice.trim().length > 0 ? input.brandVoice.trim() : '';
  const signature = input.signature && input.signature.trim().length > 0 ? input.signature.trim() : '';
  const channelGuidance = channelStyle(input.channel);
  const eventJson = JSON.stringify(input.eventData ?? {}, null, 2);
  const body = clip(input.templateBody, MAX_BODY_LENGTH);

  return `You write notification copy for an accessibility-compliance platform. Match the requested voice and brand context exactly.

<!-- LOCKED:variable-injection -->
## Brand
- Name: ${brandName}
- Voice: ${brandVoice || '(unspecified)'}

## Tone / Voice
${voice}

## Channel
${input.channel} — ${channelGuidance}

## Default (deterministic) version — use as reference, you may rewrite
Subject: ${input.templateSubject}

Body:
${body}

${signature ? `Signature:\n${signature}\n` : ''}## Event Data (JSON)
\`\`\`json
${eventJson}
\`\`\`
<!-- /LOCKED -->

## Instructions
Rewrite the subject and/or body for this notification using the event data. Keep the meaning of the default version, do not invent facts. Output format: ${input.outputFormat}. Adjust tone for the channel and voice. Do NOT add a salutation or closing if the channel is slack or teams.

<!-- LOCKED:output-format -->
## Response Format
Respond ONLY with valid JSON, no markdown fences, no commentary:
{
  "subject": "<rewritten subject line>",
  "body": "<rewritten body>"
}
<!-- /LOCKED -->`;
}

function channelStyle(channel: 'email' | 'slack' | 'teams'): string {
  switch (channel) {
    case 'email':
      return 'full HTML/markdown body with subject; salutation + closing acceptable';
    case 'slack':
      return 'short plain-text body with optional markdown; no salutation; subject is the headline';
    case 'teams':
      return 'short adaptive-card style body; no salutation; subject is the headline';
  }
}
