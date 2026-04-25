/**
 * Phase 37 Plan 02 Task 1 — partial render contract for agent-msg-actions,
 * agent-msg-edit, agent-msg-stopped-chip, and the extended agent-message
 * partial. UI scaffolding only — no behavior wiring (that lands in Plan 04).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import handlebars from 'handlebars';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PARTIALS_DIR = join(__dirname, '..', '..', 'src', 'views', 'partials');

let messageTemplate: ReturnType<typeof handlebars.compile>;
let actionsTemplate: ReturnType<typeof handlebars.compile>;
let editTemplate: ReturnType<typeof handlebars.compile>;
let stoppedChipTemplate: ReturnType<typeof handlebars.compile>;

beforeAll(async () => {
  const { loadTranslations, t: translateKey } = await import(
    '../../src/i18n/index.js'
  );
  loadTranslations();

  if (!handlebars.helpers['eq']) {
    handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);
  }
  if (!handlebars.helpers['t']) {
    handlebars.registerHelper('t', function (
      key: string,
      options: {
        hash?: Record<string, unknown>;
        data?: { root?: { locale?: string } };
      },
    ) {
      const locale = (options?.data?.root?.locale ?? 'en') as 'en';
      const params: Record<string, string> = {};
      if (options?.hash) {
        for (const [k, v] of Object.entries(options.hash)) params[k] = String(v);
      }
      return translateKey(key, locale, params);
    });
  }

  // Register partials so the message partial can include them.
  const actionsSource = readFileSync(
    join(PARTIALS_DIR, 'agent-msg-actions.hbs'),
    'utf8',
  );
  const editSource = readFileSync(
    join(PARTIALS_DIR, 'agent-msg-edit.hbs'),
    'utf8',
  );
  const stoppedChipSource = readFileSync(
    join(PARTIALS_DIR, 'agent-msg-stopped-chip.hbs'),
    'utf8',
  );
  handlebars.registerPartial('agent-msg-actions', actionsSource);
  handlebars.registerPartial('agent-msg-edit', editSource);
  handlebars.registerPartial('agent-msg-stopped-chip', stoppedChipSource);

  actionsTemplate = handlebars.compile(actionsSource);
  editTemplate = handlebars.compile(editSource);
  stoppedChipTemplate = handlebars.compile(stoppedChipSource);

  const messageSource = readFileSync(
    join(PARTIALS_DIR, 'agent-message.hbs'),
    'utf8',
  );
  messageTemplate = handlebars.compile(messageSource);
});

describe('agent-msg-actions.hbs', () => {
  it('renders all three assistant action buttons (retry, copy, share) when role=assistant', () => {
    const html = actionsTemplate({ id: 'm1', role: 'assistant' });
    expect(html).toContain('data-action="retryAssistant"');
    expect(html).toContain('data-action="copyAssistant"');
    expect(html).toContain('data-action="shareAssistant"');
    expect(html).toContain('agent-msg__action--retry');
    expect(html).toContain('agent-msg__action--copy');
    expect(html).toContain('agent-msg__action--share');
  });

  it('each assistant action button carries data-message-id and aria-label', () => {
    const html = actionsTemplate({ id: 'msg-42', role: 'assistant' });
    const occurrences = (html.match(/data-message-id="msg-42"/g) ?? []).length;
    expect(occurrences).toBe(3);
    expect(html).toContain('aria-label="Retry response"');
    expect(html).toContain('aria-label="Copy message"');
    expect(html).toContain('aria-label="Share message"');
  });

  it('renders edit pencil only when role=user AND isMostRecentUserMessage=true', () => {
    const html = actionsTemplate({
      id: 'u1',
      role: 'user',
      isMostRecentUserMessage: true,
    });
    expect(html).toContain('data-action="editUserMessage"');
    expect(html).toContain('data-message-id="u1"');
    expect(html).toContain('agent-msg__action--edit');
    expect(html).not.toContain('retryAssistant');
  });

  it('renders no action row when role=user AND isMostRecentUserMessage=false', () => {
    const html = actionsTemplate({
      id: 'u0',
      role: 'user',
      isMostRecentUserMessage: false,
    });
    expect(html).not.toContain('agent-msg__action');
    expect(html).not.toContain('data-action=');
  });

  it('renders no action row when role=user and isMostRecentUserMessage is undefined', () => {
    const html = actionsTemplate({ id: 'u0', role: 'user' });
    expect(html).not.toContain('agent-msg__action');
  });
});

describe('agent-msg-stopped-chip.hbs', () => {
  it('renders the stopped chip with localized text and aria-live', () => {
    const html = stoppedChipTemplate({});
    expect(html).toContain('agent-msg__stopped-chip');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Stopped by user');
  });
});

describe('agent-msg-edit.hbs', () => {
  it('renders edit form with prefilled textarea, save and cancel', () => {
    const html = editTemplate({ id: 'u1', content: 'hello world' });
    expect(html).toContain('data-action="submitEditUserMessage"');
    expect(html).toContain('data-message-id="u1"');
    expect(html).toContain('id="agent-msg-edit-u1"');
    expect(html).toContain('hello world');
    expect(html).toContain('data-action="cancelEditUserMessage"');
    expect(html).toContain('Save and resend');
    expect(html).toContain('Cancel');
  });

  it('escapes user-supplied content in the textarea (T-37-06)', () => {
    const html = editTemplate({
      id: 'u1',
      content: '<script>alert(1)</script>',
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('agent-message.hbs (extended)', () => {
  function render(ctx: Record<string, unknown>, parent: Record<string, unknown> = {}): string {
    return messageTemplate(
      { ...ctx },
      { data: { root: { locale: 'en', ...parent } } },
    );
  }

  it('renders stopped chip when status=stopped on assistant message', () => {
    const html = messageTemplate({
      id: 'a1',
      role: 'assistant',
      content: 'partial answer',
      status: 'stopped',
    });
    expect(html).toContain('agent-msg__stopped-chip');
    expect(html).toContain('Stopped by user');
    expect(html).toContain('agent-msg--stopped');
  });

  it('does NOT render stopped chip when status=final on assistant message', () => {
    const html = messageTemplate({
      id: 'a1',
      role: 'assistant',
      content: 'final answer',
      status: 'final',
    });
    expect(html).not.toContain('agent-msg__stopped-chip');
  });

  it('renders assistant action row inside the bubble', () => {
    const html = messageTemplate({
      id: 'a2',
      role: 'assistant',
      content: 'hi',
      status: 'final',
    });
    expect(html).toContain('data-action="retryAssistant"');
    expect(html).toContain('data-action="copyAssistant"');
    expect(html).toContain('data-action="shareAssistant"');
  });

  it('renders edit pencil on most-recent user message only', () => {
    const html = messageTemplate({
      id: 'u9',
      role: 'user',
      content: 'edit me',
      isMostRecentUserMessage: true,
    });
    expect(html).toContain('data-action="editUserMessage"');
    expect(html).toContain('data-message-id="u9"');
  });

  it('renders no action row on prior user messages', () => {
    const html = messageTemplate({
      id: 'u1',
      role: 'user',
      content: 'older message',
      isMostRecentUserMessage: false,
    });
    expect(html).not.toContain('data-action="editUserMessage"');
  });

  it('superseded modifier class added when status=superseded (defensive)', () => {
    const html = messageTemplate({
      id: 'a-super',
      role: 'assistant',
      content: 'old reply',
      status: 'superseded',
    });
    expect(html).toContain('agent-msg--superseded');
  });
});
