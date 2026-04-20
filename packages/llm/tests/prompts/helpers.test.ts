import { describe, it, expect } from 'vitest';
import { interpolateTemplate } from '../../src/prompts/helpers.js';

describe('interpolateTemplate', () => {
  it('replaces a present token', () => {
    const out = interpolateTemplate('Hello {name}!', { name: 'Luna' });
    expect(out).toBe('Hello Luna!');
  });

  it('leaves missing tokens as literal {key}', () => {
    const out = interpolateTemplate('Hello {name}, your {role} is ready.', {
      name: 'Luna',
    });
    expect(out).toBe('Hello Luna, your {role} is ready.');
  });

  it('replaces ALL occurrences of a repeated token', () => {
    const out = interpolateTemplate('{x}-{x}-{x}', { x: 'a' });
    expect(out).toBe('a-a-a');
  });

  it('returns template unchanged when vars is empty', () => {
    const tmpl = 'Hello {name}!';
    expect(interpolateTemplate(tmpl, {})).toBe(tmpl);
  });

  it('explicit empty-string value blanks the token', () => {
    const out = interpolateTemplate('[{prefix}]value', { prefix: '' });
    expect(out).toBe('[]value');
  });

  it('does NOT touch Handlebars-style {{double-braces}}', () => {
    // Single-brace only so it does not collide with existing prompts that
    // use {{...}} for a different templating layer.
    const out = interpolateTemplate('{{name}}', { name: 'Luna' });
    expect(out).toBe('{{name}}');
  });
});
