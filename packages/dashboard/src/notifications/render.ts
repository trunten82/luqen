// ---------------------------------------------------------------------------
// Notification rendering (Phase 47 + Phase 49)
//
// Phase 47 introduced the minimal `renderTemplate` token replacer used by
// the dispatcher to fill `{{token}}` placeholders. Phase 49 keeps that
// function unchanged (every renderer still calls it) and adds
// `renderForChannel`, the single entry-point the dispatcher consults to
// produce a channel-specific payload.
//
// Channel-specific shapes (HTML/CID for email, Block Kit for Slack,
// Adaptive Card for Teams) live in their own modules — this file just
// dispatches to them so the rest of the codebase has one import surface.
// ---------------------------------------------------------------------------

import type { NotificationTemplate, NotificationChannel } from '../db/types.js';
import type { BrandContext } from './brand-context.js';
import type { LogoCache } from './logo-cache.js';
import { renderEmail } from './render-email.js';
import type { RenderedEmail } from './render-email.js';
import { renderSlack } from './render-slack.js';
import type { RenderedSlack } from './render-slack.js';
import { renderTeams } from './render-teams.js';
import type { RenderedTeams } from './render-teams.js';

const TOKEN_RE = /\{\{(\w+)\}\}/g;

export function renderTemplate(
  template: string,
  data: Readonly<Record<string, unknown>>,
): string {
  return template.replace(TOKEN_RE, (_match, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(data, key)) {
      // Unknown token — leave visible so the editor preview can flag it.
      return `{{${key}}}`;
    }
    const value = data[key];
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch {
        return '';
      }
    }
    return String(value);
  });
}

// ---------------------------------------------------------------------------
// renderForChannel — Phase 49
// ---------------------------------------------------------------------------

export interface RenderedForChannel {
  readonly subject: string;
  /** Raw token-rendered body — kept for backwards compat with existing plugins. */
  readonly body: string;
  // Email-only
  readonly html?: string;
  readonly plaintext?: string;
  readonly brandColor?: string;
  readonly logoCid?: string;
  readonly logoAttachment?: RenderedEmail['logoAttachment'];
  // Slack-only
  readonly blocks?: RenderedSlack['blocks'];
  readonly iconUrl?: string;
  // Teams-only
  readonly adaptiveCard?: RenderedTeams['adaptiveCard'];
  readonly logoUrl?: string;
}

export interface RenderForChannelDeps {
  readonly logoCache?: LogoCache;
}

export async function renderForChannel(
  template: NotificationTemplate,
  eventData: Readonly<Record<string, unknown>>,
  channel: NotificationChannel,
  brand: BrandContext | null,
  deps: RenderForChannelDeps = {},
): Promise<RenderedForChannel> {
  switch (channel) {
    case 'email': {
      const email = await renderEmail(template, eventData, brand, {
        ...(deps.logoCache !== undefined ? { logoCache: deps.logoCache } : {}),
      });
      return {
        subject: email.subject,
        body: email.body,
        html: email.html,
        plaintext: email.plaintext,
        brandColor: email.brandColor,
        ...(email.logoAttachment !== undefined ? { logoAttachment: email.logoAttachment } : {}),
        ...(email.logoCid !== undefined ? { logoCid: email.logoCid } : {}),
      };
    }
    case 'slack': {
      const slack = renderSlack(template, eventData, brand);
      return {
        subject: slack.subject,
        body: slack.body,
        blocks: slack.blocks,
        ...(slack.iconUrl !== undefined ? { iconUrl: slack.iconUrl } : {}),
      };
    }
    case 'teams': {
      const teams = renderTeams(template, eventData, brand);
      return {
        subject: teams.subject,
        body: teams.body,
        adaptiveCard: teams.adaptiveCard,
        ...(teams.logoUrl !== undefined ? { logoUrl: teams.logoUrl } : {}),
      };
    }
    default: {
      const _exhaustive: never = channel;
      throw new Error(`Unsupported notification channel: ${String(_exhaustive)}`);
    }
  }
}
