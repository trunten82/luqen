import type { FastifyRequest } from 'fastify';

/**
 * Get the compliance API token for this request.
 *
 * Priority:
 * 1. User's OAuth session token (team/enterprise mode)
 * 2. Pre-fetched service token (set by preHandler hook via ServiceTokenManager)
 * 3. DASHBOARD_COMPLIANCE_API_KEY env var (manual fallback)
 */
export function getToken(request: FastifyRequest): string {
  const session = request.session as { token?: string };
  if (session.token) return session.token;

  // The preHandler hook in server.ts sets this on every request
  const serviceToken = (request as unknown as { _serviceToken?: string })._serviceToken;
  if (serviceToken) return serviceToken;

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
