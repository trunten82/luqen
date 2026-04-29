// ---------------------------------------------------------------------------
// Slack channel renderer (Phase 49-01)
//
// Produces a minimal Block Kit payload from the rendered template body. We
// don't try to *parse* the markdown into rich blocks — Slack's `mrkdwn`
// section already renders bold/links/emoji. We just split on blank lines
// and emit one `section` block per paragraph, plus a `header` for the
// (rendered) subject when it's non-empty, and a separator + actions block
// for any `{{...Url}}` link the template referenced via `eventData`.
//
// `iconUrl` is passed straight through from `BrandContext.logoSource` only
// when it's a fully-qualified http(s) URL — Slack pulls it remotely; CIDs
// are not supported on that channel.
// ---------------------------------------------------------------------------

import type { NotificationTemplate } from '../db/types.js';
import { renderTemplate } from './render.js';
import type { BrandContext } from './brand-context.js';

export type BlockKitBlock =
  | { type: 'header'; text: { type: 'plain_text'; text: string } }
  | { type: 'section'; text: { type: 'mrkdwn'; text: string } }
  | { type: 'divider' }
  | {
      type: 'actions';
      elements: ReadonlyArray<{
        type: 'button';
        text: { type: 'plain_text'; text: string };
        url: string;
        style?: 'primary' | 'danger';
      }>;
    };

export interface RenderedSlack {
  readonly subject: string;
  readonly body: string; // markdown (back-compat)
  readonly blocks: readonly BlockKitBlock[];
  readonly iconUrl?: string;
}

const URL_KEYS = ['reportUrl', 'regulationUrl', 'scanUrl', 'detailsUrl'] as const;

function pickActionLinks(
  eventData: Readonly<Record<string, unknown>>,
): ReadonlyArray<{ label: string; url: string }> {
  const links: Array<{ label: string; url: string }> = [];
  for (const key of URL_KEYS) {
    const value = eventData[key];
    if (typeof value === 'string' && /^https?:\/\//i.test(value)) {
      links.push({ label: labelForUrlKey(key), url: value });
    }
  }
  return links;
}

function labelForUrlKey(key: string): string {
  switch (key) {
    case 'reportUrl':
      return 'View report';
    case 'regulationUrl':
      return 'View regulation';
    case 'scanUrl':
      return 'View scan';
    default:
      return 'Open';
  }
}

export function renderSlack(
  template: NotificationTemplate,
  eventData: Readonly<Record<string, unknown>>,
  brand: BrandContext | null,
): RenderedSlack {
  const subject = renderTemplate(template.subjectTemplate, eventData);
  const body = renderTemplate(template.bodyTemplate, eventData);

  const blocks: BlockKitBlock[] = [];
  if (subject.trim() !== '') {
    blocks.push({
      type: 'header',
      text: { type: 'plain_text', text: subject },
    });
  }

  // Split body on blank lines so paragraphs read cleanly in Slack.
  const paragraphs = body.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p !== '');
  for (const para of paragraphs.length > 0 ? paragraphs : [body]) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: para },
    });
  }

  const links = pickActionLinks(eventData);
  if (links.length > 0) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'actions',
      elements: links.map((l) => ({
        type: 'button',
        text: { type: 'plain_text', text: l.label },
        url: l.url,
        style: 'primary',
      })),
    });
  }

  const iconUrl =
    brand?.logoSource !== undefined && /^https?:\/\//i.test(brand.logoSource)
      ? brand.logoSource
      : undefined;

  const result: RenderedSlack = {
    subject,
    body,
    blocks,
    ...(iconUrl !== undefined ? { iconUrl } : {}),
  };
  return result;
}
