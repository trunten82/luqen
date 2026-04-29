// ---------------------------------------------------------------------------
// Email channel renderer (Phase 49-01)
//
// Wraps the rendered template body in a minimal, accessible HTML scaffold
// with a brand-coloured CTA style. Logo, when available, is referenced by
// CID so the email plugin can attach the buffer at send time.
//
// This module owns NO transport — it just produces the channel-specific
// payload that the dispatcher hands to the notification plugin.
// ---------------------------------------------------------------------------

import type { NotificationTemplate } from '../db/types.js';
import { renderTemplate } from './render.js';
import type { BrandContext } from './brand-context.js';
import { DEFAULT_BRAND_PRIMARY_COLOR } from './brand-context.js';
import type { LogoCache } from './logo-cache.js';

export interface EmailLogoAttachment {
  readonly filename: string;
  readonly content: Buffer;
  readonly contentType: string;
  readonly cid: string;
}

export interface RenderedEmail {
  readonly subject: string;
  readonly body: string; // raw token-rendered body (back-compat)
  readonly html: string;
  readonly plaintext: string;
  readonly brandColor: string;
  readonly logoAttachment?: EmailLogoAttachment;
  readonly logoCid?: string;
}

const LOGO_CID = 'luqen-org-logo';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function htmlToPlaintext(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function bodyContainsHtml(body: string): boolean {
  return /<[a-z][^>]*>/i.test(body);
}

/**
 * Strip script/style tags + on* attributes + javascript: URLs from
 * admin-authored template HTML. We trust most tags (templates live in the
 * notification editor behind admin auth) but defence-in-depth still bans
 * the obviously executable surface so a compromised admin or copy-pasted
 * marketing snippet can't smuggle JS through to a recipient's mail client.
 */
function sanitizeHtml(html: string): string {
  return html
    .replace(/<\s*script\b[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, '')
    .replace(/<\s*style\b[^>]*>[\s\S]*?<\s*\/\s*style\s*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
    .replace(/\bjavascript:/gi, 'about:blank#');
}

function wrapHtml(opts: {
  subject: string;
  bodyHtml: string;
  brandColor: string;
  logoCid?: string;
}): string {
  const logoBlock =
    opts.logoCid !== undefined
      ? `<img src="cid:${opts.logoCid}" alt="" style="max-height:48px;display:block;margin:0 0 16px 0" />`
      : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(opts.subject)}</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1f2937;background:#f8fafc;margin:0;padding:24px}
  .luqen-card{max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;padding:24px;border:1px solid #e5e7eb}
  .luqen-cta{display:inline-block;padding:10px 20px;border-radius:6px;background:${opts.brandColor};color:#ffffff !important;text-decoration:none;font-weight:600;margin-top:12px}
  a{color:${opts.brandColor}}
  p{line-height:1.5}
</style>
</head>
<body>
<div class="luqen-card" role="article">
${logoBlock}${opts.bodyHtml}
</div>
</body>
</html>`;
}

export interface RenderEmailDeps {
  readonly logoCache?: LogoCache;
}

export async function renderEmail(
  template: NotificationTemplate,
  eventData: Readonly<Record<string, unknown>>,
  brand: BrandContext | null,
  deps: RenderEmailDeps = {},
): Promise<RenderedEmail> {
  const subject = renderTemplate(template.subjectTemplate, eventData);
  const rawBody = renderTemplate(template.bodyTemplate, eventData);

  const brandColor = brand?.colors.primary ?? DEFAULT_BRAND_PRIMARY_COLOR;

  // Body content: if the template author embedded HTML, trust it; otherwise
  // wrap each line in a <p>.
  const bodyHtml = bodyContainsHtml(rawBody)
    ? sanitizeHtml(rawBody)
    : rawBody
        .split(/\n{2,}/)
        .map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br/>')}</p>`)
        .join('');

  let logoAttachment: EmailLogoAttachment | undefined;
  let logoCid: string | undefined;

  if (
    brand !== null &&
    brand.logoSource !== undefined &&
    deps.logoCache !== undefined
  ) {
    const entry = await deps.logoCache.fetch(brand.orgId, brand.logoSource);
    if (entry !== null) {
      logoAttachment = {
        filename: filenameFromSource(brand.logoSource, entry.contentType),
        content: entry.buffer,
        contentType: entry.contentType,
        cid: LOGO_CID,
      };
      logoCid = LOGO_CID;
    }
  }

  const html = wrapHtml({ subject, bodyHtml, brandColor, logoCid });
  const plaintext = htmlToPlaintext(bodyHtml);

  const result: RenderedEmail = {
    subject,
    body: rawBody,
    html,
    plaintext,
    brandColor,
    ...(logoAttachment !== undefined ? { logoAttachment } : {}),
    ...(logoCid !== undefined ? { logoCid } : {}),
  };
  return result;
}

function filenameFromSource(source: string, contentType: string): string {
  const tail = source.split(/[\\/]/).pop() ?? 'logo';
  if (/\.[a-z0-9]{2,4}$/i.test(tail)) return tail;
  const ext = contentType.split('/')[1] ?? 'bin';
  return `${tail}.${ext === 'svg+xml' ? 'svg' : ext}`;
}
