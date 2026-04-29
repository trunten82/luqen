/**
 * Phase 48 Plan 02 — render-smoke for the notification template views.
 *
 * Verifies:
 *   1. /admin/notifications page references the notifications-tab partial.
 *   2. The notifications-tab partial lives in views/admin/partials/.
 *   3. The form template surfaces the LLM toggle as disabled with a
 *      "Phase 50" tooltip (not yet wired to runtime).
 *   4. The view modal advertises Phase 50 wiring for the LLM flag.
 *   5. The history modal renders chronological entries when given a list.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const VIEWS = join(process.cwd(), 'src', 'views', 'admin');

describe('Phase 48 Plan 02 — admin notification views', () => {
  it('main page references the notifications-tab partial', () => {
    const hbs = readFileSync(join(VIEWS, 'notifications.hbs'), 'utf-8');
    expect(hbs).toContain('{{> notifications-tab}}');
    expect(hbs).toContain('Notification Templates');
    // Tab nav for the three channels.
    expect(hbs).toContain('hx-get="/admin/notifications?channel=');
  });

  it('notifications-tab partial is on disk in admin/partials/', () => {
    const hbs = readFileSync(join(VIEWS, 'partials', 'notifications-tab.hbs'), 'utf-8');
    expect(hbs).toContain('System templates');
    expect(hbs).toContain('Your org templates');
    expect(hbs).toContain('id="org-templates-body"'); // override target
  });

  it('form template enables LLM toggle (Phase 50-03) and exposes preview/test-send actions', () => {
    const hbs = readFileSync(join(VIEWS, 'notification-form.hbs'), 'utf-8');
    expect(hbs).toContain('id="ntpl-llm"');
    expect(hbs).toContain('name="llmEnabled"');
    // Phase 50-03 removed the `disabled` attribute on the LLM toggle.
    expect(hbs).not.toMatch(/id="ntpl-llm"[^>]*disabled/);
    // Preview + test-send actions are wired.
    expect(hbs).toContain('hx-post="/admin/notifications/{{template.id}}/preview"');
    expect(hbs).toContain('hx-post="/admin/notifications/{{template.id}}/test-send"');
    // Field max-length attributes are bound to limits.* values.
    expect(hbs).toContain('maxlength="{{limits.subject}}"');
    expect(hbs).toContain('maxlength="{{limits.body}}"');
    expect(hbs).toContain('maxlength="{{limits.voice}}"');
    expect(hbs).toContain('maxlength="{{limits.signature}}"');
    // PATCH wiring.
    expect(hbs).toContain('hx-patch="/admin/notifications/{{template.id}}"');
  });

  it('view modal advertises Phase 50 LLM wiring', () => {
    const hbs = readFileSync(join(VIEWS, 'notification-view.hbs'), 'utf-8');
    expect(hbs).toContain('LLM-assisted');
    expect(hbs).toContain('Phase 50');
    expect(hbs).toContain('Subject');
    expect(hbs).toContain('Body');
  });

  it('history modal lists prior versions', () => {
    const hbs = readFileSync(join(VIEWS, 'notification-history.hbs'), 'utf-8');
    expect(hbs).toContain('History');
    expect(hbs).toContain('{{#each history}}');
    expect(hbs).toContain('No prior versions yet');
  });
});
