import { describe, it, expect } from 'vitest';
import { parseCSS } from '../../src/parser/css-parser.js';

describe('parseCSS', () => {
  it('extracts colors from CSS custom properties', () => {
    const css = `:root { --brand-primary: #1E40AF; --brand-secondary: #F59E0B; }`;
    const result = parseCSS(css);
    expect(result.colors).toHaveLength(2);
    expect(result.colors[0]).toMatchObject({ name: 'brand-primary', hex: '#1E40AF' });
    expect(result.colors[1]).toMatchObject({ name: 'brand-secondary', hex: '#F59E0B' });
  });

  it('expands 3-digit hex to 6-digit uppercase', () => {
    const css = `a { color: #F00; }`;
    const result = parseCSS(css);
    expect(result.colors).toHaveLength(1);
    expect(result.colors[0].hex).toBe('#FF0000');
  });

  it('extracts colors from 6-digit hex in regular properties', () => {
    const css = `body { background-color: #1F2937; }`;
    const result = parseCSS(css);
    expect(result.colors).toHaveLength(1);
    expect(result.colors[0].hex).toBe('#1F2937');
    expect(result.colors[0].name).toMatch(/background-color/);
  });

  it('extracts font-family declarations', () => {
    const css = `body { font-family: 'Inter', sans-serif; }`;
    const result = parseCSS(css);
    expect(result.fonts).toHaveLength(1);
    expect(result.fonts[0].family).toBe('Inter');
  });

  it('extracts font family from font shorthand', () => {
    const css = `h1 { font: 700 16px/1.5 "Playfair Display", serif; }`;
    const result = parseCSS(css);
    expect(result.fonts).toHaveLength(1);
    expect(result.fonts[0].family).toBe('Playfair Display');
  });

  it('deduplicates colors by hex value (case-insensitive)', () => {
    const css = `:root { --primary: #1E40AF; } a { color: #1e40af; }`;
    const result = parseCSS(css);
    // Both reference the same hex — only one should appear
    const hexes = result.colors.map((c) => c.hex.toUpperCase());
    const unique = new Set(hexes);
    expect(unique.size).toBe(hexes.length);
  });

  it('deduplicates fonts by family name', () => {
    const css = `body { font-family: 'Inter', sans-serif; } p { font-family: Inter, sans-serif; }`;
    const result = parseCSS(css);
    expect(result.fonts).toHaveLength(1);
    expect(result.fonts[0].family).toBe('Inter');
  });

  it('ignores generic font families', () => {
    const css = `body { font-family: serif, sans-serif, monospace, cursive, fantasy; }`;
    const result = parseCSS(css);
    expect(result.fonts).toHaveLength(0);
  });

  it('returns empty arrays for empty/whitespace input', () => {
    expect(parseCSS('')).toEqual({ colors: [], fonts: [] });
    expect(parseCSS('   ')).toEqual({ colors: [], fonts: [] });
  });

  it('strips CSS comments before parsing', () => {
    const css = `/* Brand colors */
:root {
  /* primary */
  --brand: #1E40AF;
}`;
    const result = parseCSS(css);
    expect(result.colors).toHaveLength(1);
    expect(result.colors[0]).toMatchObject({ name: 'brand', hex: '#1E40AF' });
  });

  it('handles custom properties taking priority over regular properties for the same hex', () => {
    const css = `:root { --primary: #ABC123; } div { color: #ABC123; }`;
    const result = parseCSS(css);
    // custom property comes first, deduplication keeps first occurrence
    const hex = result.colors.find((c) => c.hex === '#ABC123');
    expect(hex).toBeDefined();
    expect(result.colors.filter((c) => c.hex === '#ABC123')).toHaveLength(1);
  });

  it('normalizes hex values to uppercase', () => {
    const css = `:root { --color: #aabbcc; }`;
    const result = parseCSS(css);
    expect(result.colors[0].hex).toBe('#AABBCC');
  });
});
