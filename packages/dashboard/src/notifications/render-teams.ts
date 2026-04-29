// ---------------------------------------------------------------------------
// Microsoft Teams channel renderer (Phase 49-01)
//
// Builds an Adaptive Card 1.5 payload. The seed template body is either
// (a) a plain text string with `{{tokens}}` or (b) a JSON object of the
// shape `{"text": "..."}`. The renderer accepts either, expands tokens
// FIRST, then wraps in the card structure with TextBlock + optional
// Image (logo) + ActionSet for any event-specific URLs.
//
// `logoUrl` is passed through only when the brand context provides a
// fully-qualified http(s) URL — Teams renders Image elements remotely.
// ---------------------------------------------------------------------------

import type { NotificationTemplate } from '../db/types.js';
import { renderTemplate } from './render.js';
import type { BrandContext } from './brand-context.js';

export interface AdaptiveCard {
  readonly type: 'AdaptiveCard';
  readonly $schema: string;
  readonly version: string;
  readonly body: ReadonlyArray<AdaptiveCardElement>;
  readonly actions?: ReadonlyArray<AdaptiveCardAction>;
}

export type AdaptiveCardElement =
  | { type: 'TextBlock'; text: string; wrap: true; weight?: 'Bolder'; size?: 'Large' }
  | { type: 'Image'; url: string; altText: string; size?: 'Small' | 'Medium' };

export interface AdaptiveCardAction {
  readonly type: 'Action.OpenUrl';
  readonly title: string;
  readonly url: string;
}

export interface RenderedTeams {
  readonly subject: string;
  readonly body: string; // text/JSON (back-compat)
  readonly adaptiveCard: AdaptiveCard;
  readonly logoUrl?: string;
}

const URL_KEYS = ['reportUrl', 'regulationUrl', 'scanUrl', 'detailsUrl'] as const;

function pickActions(
  eventData: Readonly<Record<string, unknown>>,
): ReadonlyArray<AdaptiveCardAction> {
  const actions: AdaptiveCardAction[] = [];
  for (const key of URL_KEYS) {
    const value = eventData[key];
    if (typeof value === 'string' && /^https?:\/\//i.test(value)) {
      actions.push({
        type: 'Action.OpenUrl',
        title: actionTitle(key),
        url: value,
      });
    }
  }
  return actions;
}

function actionTitle(key: string): string {
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

function extractText(rawBody: string): string {
  const trimmed = rawBody.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { text?: unknown };
      if (typeof parsed.text === 'string') return parsed.text;
    } catch {
      // Fall through — treat as plain text.
    }
  }
  return rawBody;
}

export function renderTeams(
  template: NotificationTemplate,
  eventData: Readonly<Record<string, unknown>>,
  brand: BrandContext | null,
): RenderedTeams {
  const subject = renderTemplate(template.subjectTemplate, eventData);
  const body = renderTemplate(template.bodyTemplate, eventData);
  const text = extractText(body);

  const elements: AdaptiveCardElement[] = [];

  const logoUrl =
    brand?.logoSource !== undefined && /^https?:\/\//i.test(brand.logoSource)
      ? brand.logoSource
      : undefined;

  if (logoUrl !== undefined) {
    elements.push({
      type: 'Image',
      url: logoUrl,
      altText: '',
      size: 'Small',
    });
  }
  if (subject.trim() !== '') {
    elements.push({
      type: 'TextBlock',
      text: subject,
      wrap: true,
      weight: 'Bolder',
      size: 'Large',
    });
  }
  elements.push({
    type: 'TextBlock',
    text,
    wrap: true,
  });

  const actions = pickActions(eventData);

  const card: AdaptiveCard = {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.5',
    body: elements,
    ...(actions.length > 0 ? { actions } : {}),
  };

  const result: RenderedTeams = {
    subject,
    body,
    adaptiveCard: card,
    ...(logoUrl !== undefined ? { logoUrl } : {}),
  };
  return result;
}
