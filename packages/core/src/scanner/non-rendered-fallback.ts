/**
 * NON-RENDERED-FALLBACK-1: drop colour-contrast findings on content the
 * browser never paints.
 *
 * - `<noscript>`: the scanner runs Chromium with scripting ON, so the HTML
 *   parser stores a noscript's content as one raw TEXT node (e.g. the literal
 *   string `<img class="..." src="...">` of a lazy-load fallback). HTMLCS then
 *   measures that string's "text" contrast. It is never rendered.
 * - `<video>` / `<audio>`: their child text ("Sorry, your browser doesn't
 *   support embedded videos.") is fallback content, shown only by browsers
 *   that cannot play media at all.
 *
 * Measured 2026-10-08 on a customer scan: 4 of 4 reported errors were G18 at
 * 1.23:1 on exactly these elements. Scope is deliberately narrow: ONLY
 * contrast codes are dropped, so a real finding on a media element (e.g. axe
 * `video-caption`) is kept, and only when the flagged element IS, or sits
 * INSIDE (child/descendant combinator), one of these elements — a sibling
 * (`+` / `~`) of a `<video>` is ordinary rendered content.
 */

const FALLBACK_TAGS = new Set(['noscript', 'video', 'audio']);

/** HTMLCS 1.4.3 (AA) / 1.4.6 (AAA) contrast techniques, and axe's rules. */
const HTMLCS_CONTRAST = /\.1_4_[36]\./;
const AXE_CONTRAST = new Set(['color-contrast', 'color-contrast-enhanced']);

interface IssueLike {
  readonly code: string;
  readonly selector?: string;
}

function isContrastCode(code: string): boolean {
  return HTMLCS_CONTRAST.test(code) || AXE_CONTRAST.has(code);
}

/**
 * Tag names of the flagged element and its ancestors as the selector names
 * them. Walking right to left, a compound reached through `+`/`~` is a
 * sibling, not a container, so it is skipped (its own ancestors still count).
 */
function containingTags(selector: string): string[] {
  const tokens = selector.trim().split(/\s*([>+~])\s*|\s+/).filter((t) => t !== undefined && t !== '');
  const tags: string[] = [];
  let skipNext = false;
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const token = tokens[i];
    if (token === '+' || token === '~') {
      skipNext = true;
      continue;
    }
    if (token === '>') continue;
    if (skipNext) {
      skipNext = false;
      continue;
    }
    const tag = /^[a-zA-Z][a-zA-Z0-9-]*/.exec(token);
    if (tag) tags.push(tag[0].toLowerCase());
  }
  return tags;
}

export function isNonRenderedFallbackIssue(issue: IssueLike): boolean {
  if (!issue.selector || !isContrastCode(issue.code)) return false;
  return containingTags(issue.selector).some((tag) => FALLBACK_TAGS.has(tag));
}

export function withoutNonRenderedFallbackIssues<T extends IssueLike>(issues: readonly T[]): T[] {
  return issues.filter((issue) => !isNonRenderedFallbackIssue(issue));
}
