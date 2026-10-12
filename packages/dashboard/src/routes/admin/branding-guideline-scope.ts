/**
 * Org-scope preHandlers for the admin branding routes addressed by guideline id
 * (routes/admin/branding-guidelines.ts).
 *
 * A global admin (bypassesOrgScope) may act on any guideline; anyone else only
 * on a guideline of their current org — the same partition the router's list
 * view applies. 'read' access additionally admits the shared 'system' library,
 * which org users browse and link to their own sites. Anything else answers
 * 404 exactly like a missing guideline (as /api/v1/branding does), so another
 * org's guideline ids are not even confirmed to exist.
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import { bypassesOrgScope } from '../../permissions.js';
import type { StorageAdapter } from '../../db/adapter.js';
import { toastHtml } from './helpers.js';
import { guidelineHasChild, type BrandingChildKind } from '../../services/branding-child.js';

export type GuidelineAccess = 'edit' | 'read';
export type GuidelineChildKind = BrandingChildKind;

type Actor = FastifyRequest['user'];

export function guidelineInScope(actor: Actor, guidelineOrgId: string, access: GuidelineAccess): boolean {
  if (bypassesOrgScope(actor)) return true;
  // The shared 'system' library is readable/linkable by everyone but editable
  // only by a global admin — including by a caller with no current org, whose
  // org would otherwise default to 'system'.
  if (guidelineOrgId === 'system') return access === 'read';
  return guidelineOrgId === actor?.currentOrgId;
}

function notFound(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(404).header('content-type', 'text/html').send(toastHtml(message, 'error'));
}

/** preHandler: the `:id` guideline must exist and be in the caller's scope. */
export function requireGuidelineScope(storage: StorageAdapter, access: GuidelineAccess) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined> => {
    const { id } = request.params as { id: string };
    const guideline = await storage.branding.getGuideline(id);
    if (guideline === null || !guidelineInScope(request.user, guideline.orgId, access)) {
      return notFound(reply, 'Guideline not found.');
    }
    return undefined;
  };
}

const CHILD_PARAM: Record<GuidelineChildKind, string> = { color: 'colorId', font: 'fontId', selector: 'selectorId' };
const CHILD_LABEL: Record<GuidelineChildKind, string> = { color: 'Color', font: 'Font', selector: 'Selector' };

/**
 * preHandler: the child named in the URL must belong to the `:id` guideline.
 * Runs after requireGuidelineScope, so a child of an in-scope guideline is in
 * scope too.
 */
export function requireGuidelineChild(storage: StorageAdapter, kind: GuidelineChildKind) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined> => {
    const params = request.params as Record<string, string>;
    const guidelineId = params['id'] ?? '';
    const childId = params[CHILD_PARAM[kind]];
    if (!await guidelineHasChild(storage, kind, guidelineId, childId ?? '')) {
      return notFound(reply, `${CHILD_LABEL[kind]} not found.`);
    }
    return undefined;
  };
}
