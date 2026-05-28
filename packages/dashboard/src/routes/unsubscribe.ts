import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { StorageAdapter } from '../db/index.js';
import { verifyUnsubscribeToken } from '../notifications/unsubscribe-token.js';

/**
 * Phase 71 — Public unsubscribe endpoint.
 *
 * GET /u/:token — stateless HMAC verification, then marks the
 * (recipient, channel, org) tuple as unsubscribed. The handler is
 * idempotent: a recipient who is already unsubscribed simply sees the
 * same confirmation page. No auth required — the token IS the
 * authorisation.
 *
 * Note: this endpoint mutates on GET. That is a deliberate design
 * choice (the prompt's design) so the link works as a single click
 * from an email client. Mail-scanner prefetches are harmless because
 * the operation is idempotent.
 */

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c] ?? c));
}

function renderPage(opts: {
  readonly title: string;
  readonly heading: string;
  readonly bodyHtml: string;
}): string {
  const safeTitle = escapeHtml(opts.title);
  const safeHeading = escapeHtml(opts.heading);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<style>
:root { color-scheme: light dark; }
body { font: 16px/1.5 system-ui, -apple-system, sans-serif; margin: 0; padding: 2rem; max-width: 32rem; margin-inline: auto; }
h1 { font-size: 1.4rem; margin-top: 0; }
.card { border: 1px solid color-mix(in srgb, currentColor 20%, transparent); border-radius: 10px; padding: 1.25rem 1.5rem; }
.ok { border-left: 4px solid #206a44; }
.err { border-left: 4px solid #a52822; }
p { margin: 0.5rem 0; }
small { opacity: 0.75; }
</style>
</head>
<body>
<main class="card ok">
<h1>${safeHeading}</h1>
${opts.bodyHtml}
</main>
</body>
</html>`;
}

function renderErrorPage(): string {
  return renderPage({
    title: 'Invalid unsubscribe link',
    heading: 'Invalid unsubscribe link',
    bodyHtml: `<p>This link is not valid or has been tampered with.</p>
<p><small>If you keep seeing this, contact the sender directly to be removed from their list.</small></p>`,
  }).replace('class="card ok"', 'class="card err"');
}

export async function unsubscribeRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
): Promise<void> {
  // Wildcard match — fastify's default maxParamLength is 100, and the
  // base64url-encoded token comfortably exceeds that. The wildcard
  // bypasses the param-length cap without forcing a global Fastify config
  // change. The token itself is opaque from a routing perspective.
  server.get(
    '/u/*',
    {
      schema: {
        tags: ['html-page', 'unsubscribe'],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const token = (request.params as { '*': string })['*'];
      const payload = verifyUnsubscribeToken(token);
      reply.header('Content-Type', 'text/html; charset=utf-8');
      reply.header('Cache-Control', 'no-store');
      if (payload === null) {
        reply.code(400);
        return reply.send(renderErrorPage());
      }
      await storage.notificationUnsubscribes.unsubscribe(
        payload.recipient,
        payload.channel,
        payload.orgId,
      );
      const safeRecipient = escapeHtml(payload.recipient);
      return reply.send(
        renderPage({
          title: 'Unsubscribed',
          heading: 'You have been unsubscribed',
          bodyHtml: `<p><strong>${safeRecipient}</strong> will no longer receive
scheduled email reports from this organisation.</p>
<p><small>If this was a mistake, ask the report owner to re-add you on the
Notifications admin page.</small></p>`,
        }),
      );
    },
  );
}
