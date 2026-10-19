/**
 * What the dismissals list API withholds from a viewer who may open a scan's report but may not
 * touch the scan's org (an org user on a 'system' scan). The report page's Dismissed section shows
 * such a viewer the generic "API key" label and never an actor id; the list API says the same.
 *
 * Pure: every function returns a new object. Whether an actor was an API key is decided from the
 * server-set actor id (`isApiKeyActor`), BEFORE the id is dropped.
 */
import type { Static } from '@sinclair/typebox';
import { isApiKeyActor } from '../../services/issue-dismissals/dismissals-view.js';
import type { DismissalWithEventsSchema } from './issue-dismissals-schemas.js';

type DismissalJson = Static<typeof DismissalWithEventsSchema>;

/** The generic name shown for any API-key actor: no key id, no per-key distinction. */
export const GENERIC_API_KEY_ACTOR = 'api-key';

function publicName(actor: string, actorId: string | null): string {
  return isApiKeyActor(actor, actorId) ? GENERIC_API_KEY_ACTOR : actor;
}

export function redactDismissalJson(d: DismissalJson): DismissalJson {
  return {
    ...d,
    created_by: publicName(d.created_by, d.created_by_id),
    created_by_id: null,
    revoked_by: d.revoked_by === null ? null : publicName(d.revoked_by, d.revoked_by_id),
    revoked_by_id: null,
    events: d.events.map((e) => ({ ...e, actor: publicName(e.actor, e.actor_id), actor_id: null })),
  };
}
