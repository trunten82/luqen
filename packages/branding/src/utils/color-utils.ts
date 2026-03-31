const HEX_6_RE = /^#?([0-9a-f]{6})$/i;
const HEX_3_RE = /^#?([0-9a-f]{3})$/i;
const INLINE_HEX_RE = /#[0-9a-f]{3,6}/gi;
const RGB_RE = /rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)/gi;

export function normalizeHex(hex: string): string {
  const trimmed = hex.trim();
  if (trimmed === '') return '';
  const match6 = trimmed.match(HEX_6_RE);
  if (match6) return `#${match6[1].toUpperCase()}`;
  const match3 = trimmed.match(HEX_3_RE);
  if (match3) {
    const expanded = match3[1].split('').map((c) => c + c).join('');
    return `#${expanded.toUpperCase()}`;
  }
  return '';
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number): number => Math.max(0, Math.min(255, n));
  const hex = [clamp(r), clamp(g), clamp(b)].map((c) => c.toString(16).padStart(2, '0')).join('');
  return `#${hex.toUpperCase()}`;
}

export function extractColorsFromContext(context: string): readonly string[] {
  const colors: string[] = [];
  const hexMatches = context.matchAll(INLINE_HEX_RE);
  for (const m of hexMatches) {
    const normalized = normalizeHex(m[0]);
    if (normalized !== '' && !colors.includes(normalized)) colors.push(normalized);
  }
  const rgbMatches = context.matchAll(RGB_RE);
  for (const m of rgbMatches) {
    const hex = rgbToHex(Number(m[1]), Number(m[2]), Number(m[3]));
    if (!colors.includes(hex)) colors.push(hex);
  }
  return colors;
}
