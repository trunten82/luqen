import { describe, it, expect } from 'vitest';
import { normalizeHex, extractColorsFromContext } from '../../src/utils/color-utils.js';

describe('normalizeHex', () => {
  it('uppercases and ensures # prefix', () => {
    expect(normalizeHex('#ff5722')).toBe('#FF5722');
    expect(normalizeHex('FF5722')).toBe('#FF5722');
    expect(normalizeHex('#FF5722')).toBe('#FF5722');
  });

  it('expands 3-digit hex', () => {
    expect(normalizeHex('#f00')).toBe('#FF0000');
    expect(normalizeHex('abc')).toBe('#AABBCC');
  });

  it('returns empty string for invalid input', () => {
    expect(normalizeHex('')).toBe('');
    expect(normalizeHex('not-a-color')).toBe('');
  });
});

describe('extractColorsFromContext', () => {
  it('extracts inline color styles from HTML context', () => {
    const context = '<span style="color: #FF5722; background-color: #FFFFFF;">text</span>';
    const colors = extractColorsFromContext(context);
    expect(colors).toContain('#FF5722');
    expect(colors).toContain('#FFFFFF');
  });

  it('extracts rgb colors and converts to hex', () => {
    const context = '<div style="color: rgb(255, 87, 34);">text</div>';
    const colors = extractColorsFromContext(context);
    expect(colors).toContain('#FF5722');
  });

  it('returns empty array for context without colors', () => {
    const context = '<img src="photo.jpg" alt="">';
    expect(extractColorsFromContext(context)).toEqual([]);
  });
});
