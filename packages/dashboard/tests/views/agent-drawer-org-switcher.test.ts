/**
 * Phase 38 Plan 02 — partial render contract for the agent-drawer org switcher.
 * Asserts the conditional rendering (showOrgSwitcher true/false branches), the
 * data-action="agentOrgSwitch" hook, option emission, i18n key resolution, and
 * the absence of inline scripts. UI scaffolding only — Plan 38-04 wires
 * the data-action handler in agent.js.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import handlebars from 'handlebars';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PARTIALS_DIR = join(__dirname, '..', '..', 'src', 'views', 'partials');

let switcherTemplate: ReturnType<typeof handlebars.compile>;
let drawerTemplate: ReturnType<typeof handlebars.compile>;

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

  // Register required partials so the drawer template can include them.
  const partialNames = [
    'agent-drawer-org-switcher',
    'agent-messages',
    'agent-history-panel',
    'agent-confirm-dialog',
    'agent-message',
    'agent-msg-actions',
    'agent-msg-edit',
    'agent-msg-stopped-chip',
  ];
  for (const name of partialNames) {
    try {
      const src = readFileSync(join(PARTIALS_DIR, `${name}.hbs`), 'utf8');
      handlebars.registerPartial(name, src);
    } catch {
      // Optional partials — ignore if missing.
    }
  }

  const switcherSource = readFileSync(
    join(PARTIALS_DIR, 'agent-drawer-org-switcher.hbs'),
    'utf8',
  );
  switcherTemplate = handlebars.compile(switcherSource);

  const drawerSource = readFileSync(
    join(PARTIALS_DIR, 'agent-drawer.hbs'),
    'utf8',
  );
  drawerTemplate = handlebars.compile(drawerSource);
});

describe('agent-drawer-org-switcher.hbs (standalone)', () => {
  it('renders nothing when showOrgSwitcher is false', () => {
    const html = switcherTemplate({ showOrgSwitcher: false, orgOptions: [] });
    expect(html.trim()).toBe('');
    expect(html).not.toContain('agent-drawer__org-switcher');
    expect(html).not.toContain('data-action="agentOrgSwitch"');
  });

  it('renders nothing when showOrgSwitcher is undefined', () => {
    const html = switcherTemplate({ orgOptions: [{ id: 'a', name: 'Alpha' }] });
    expect(html.trim()).toBe('');
  });

  it('renders the form, label, select, and toast container when showOrgSwitcher is true', () => {
    const html = switcherTemplate({
      showOrgSwitcher: true,
      orgOptions: [
        { id: 'org-a', name: 'Alpha', selected: true },
        { id: 'org-b', name: 'Beta', selected: false },
      ],
    });
    expect(html).toContain('class="agent-drawer__org-switcher"');
    expect(html).toContain('data-action="agentOrgSwitch"');
    expect(html).toContain('autocomplete="off"');
    expect(html).toContain('id="agent-org-select"');
    expect(html).toContain('name="orgId"');
    expect(html).toContain('Active org');
    expect(html).toContain('aria-label="Active org"');
    expect(html).toContain('data-role="orgToast"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('agent-drawer__toast--org');
  });

  it('emits an option for each org with selected attribute on the active one', () => {
    const html = switcherTemplate({
      showOrgSwitcher: true,
      orgOptions: [
        { id: 'org-a', name: 'Alpha', selected: false },
        { id: 'org-b', name: 'Beta', selected: true },
      ],
    });
    expect(html).toContain('value="org-a"');
    expect(html).toContain('value="org-b"');
    expect(html).toContain('>Alpha</option>');
    expect(html).toContain('>Beta</option>');
    // Selected attribute only on the active option.
    expect(html).toMatch(/value="org-b"\s+selected/);
    expect(html).not.toMatch(/value="org-a"\s+selected/);
  });

  it('contains no inline <script> blocks (CSP-strict)', () => {
    const html = switcherTemplate({
      showOrgSwitcher: true,
      orgOptions: [{ id: 'x', name: 'X', selected: true }],
    });
    expect(/<script/i.test(html)).toBe(false);
  });

  it('escapes org names rendered in <option> text (T-38-04)', () => {
    const html = switcherTemplate({
      showOrgSwitcher: true,
      orgOptions: [
        { id: 'evil', name: '<script>alert(1)</script>', selected: false },
      ],
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('agent-drawer.hbs (mounted switcher)', () => {
  function renderDrawer(extra: Record<string, unknown> = {}): string {
    return drawerTemplate({
      agentDisplayName: 'Luqen',
      conversationId: 'c1',
      csrfToken: 'csrf-x',
      messages: [],
      historyItems: [],
      locale: 'en',
      ...extra,
    });
  }

  it('renders the switcher inside the drawer header when showOrgSwitcher=true', () => {
    const html = renderDrawer({
      showOrgSwitcher: true,
      orgOptions: [
        { id: 'org-a', name: 'Alpha', selected: true },
        { id: 'org-b', name: 'Beta', selected: false },
      ],
    });
    expect(html).toContain('data-action="agentOrgSwitch"');
    expect(html).toContain('value="org-a"');
    expect(html).toContain('value="org-b"');
    // Header still has its existing controls.
    expect(html).toContain('data-action="newChat"');
    expect(html).toContain('data-action="closeAgentDrawer"');
  });

  it('does not render the switcher when showOrgSwitcher is false (AORG-04 UI side)', () => {
    const html = renderDrawer({
      showOrgSwitcher: false,
      orgOptions: [{ id: 'org-a', name: 'Alpha', selected: true }],
    });
    expect(html).not.toContain('data-action="agentOrgSwitch"');
    expect(html).not.toContain('agent-drawer__org-switcher');
    // Existing header controls still render.
    expect(html).toContain('data-action="newChat"');
    expect(html).toContain('data-action="closeAgentDrawer"');
  });

  it('does not render the switcher when showOrgSwitcher is absent (defensive default)', () => {
    const html = renderDrawer();
    expect(html).not.toContain('data-action="agentOrgSwitch"');
    expect(html).not.toContain('agent-drawer__org-switcher');
  });
});
