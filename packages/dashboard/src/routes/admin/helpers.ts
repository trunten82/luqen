import type { FastifyRequest } from 'fastify';

/**
 * Get the compliance API token for this request.
 *
 * Priority:
 * 1. User's OAuth session token (team/enterprise mode)
 * 2. Per-org service token (set by preHandler hook when org has stored credentials)
 * 3. Global service token (set by preHandler hook via ServiceTokenManager)
 * 4. DASHBOARD_COMPLIANCE_API_KEY env var (manual fallback)
 */
export function getToken(request: FastifyRequest): string {
  const session = request.session as { token?: string };
  if (session.token) return session.token;

  const reqExt = request as unknown as { _orgServiceToken?: string; _serviceToken?: string };

  // Global system admins always use the global service token, even when
  // an org-switcher selection has populated _orgServiceToken. The per-org
  // token's JWT carries the org's id (not 'system') and only read+write
  // scopes — it cannot act on system-owned compliance data, which is
  // exactly what global admins need to do (acknowledge official
  // regulatory proposals, edit system regulations, etc.). The global
  // token has scope=admin and orgId=system, so reads stay org-scoped via
  // X-Org-Id when the route opts in.
  if (request.user?.role === 'admin' && reqExt._serviceToken) {
    return reqExt._serviceToken;
  }

  // Per-org token takes priority over global token for org-scoped users
  if (reqExt._orgServiceToken) return reqExt._orgServiceToken;

  if (reqExt._serviceToken) return reqExt._serviceToken;

  return process.env['DASHBOARD_COMPLIANCE_API_KEY'] ?? '';
}

export function getOrgId(request: FastifyRequest): string | undefined {
  return request.user?.currentOrgId;
}

export function toastHtml(message: string, type: 'success' | 'error' = 'success'): string {
  return `<div id="toast-container" hx-swap-oob="innerHTML" role="region" aria-label="Notifications" aria-live="polite"><div class="toast toast--${type}" role="alert" aria-live="assertive">${escapeHtml(message)}</div></div>`;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
