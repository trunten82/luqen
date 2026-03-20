import type { FastifyRequest } from 'fastify';

export function getToken(request: FastifyRequest): string {
  const session = request.session as { token?: string };
  return session.token ?? '';
}

export function getOrgId(request: FastifyRequest): string | undefined {
  return request.user?.currentOrgId;
}

export function toastHtml(message: string, type: 'success' | 'error' = 'success'): string {
  return `<div id="toast" hx-swap-oob="true" role="alert" aria-live="assertive" class="toast toast--${type}">${message}</div>`;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
