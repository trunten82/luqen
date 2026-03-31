import { describe, it, expect } from 'vitest';
import { parseCSV } from '../../src/parser/csv-parser.js';

const SAMPLE_CSV = `type,name,value,usage,context
color,Primary Blue,#1E40AF,primary,"Headers, CTAs"
color,White,#FFFFFF,background,"Page backgrounds"
color,Dark Grey,#1F2937,text,"Body text"
font,Inter,400;600;700,body,"Body text, paragraphs"
font,Playfair Display,700,heading,"H1, H2 headings"
selector,.brand-header,,,Top navigation bar
selector,#hero-*,,,Hero banner sections
`;

describe('parseCSV', () => {
  it('parses colors from valid CSV', () => {
    const result = parseCSV(SAMPLE_CSV);
    expect(result.colors).toHaveLength(3);
    expect(result.colors[0]).toEqual({
      name: 'Primary Blue',
      hex: '#1E40AF',
      usage: 'primary',
      context: 'Headers, CTAs',
    });
    expect(result.colors[1]).toMatchObject({ name: 'White', hex: '#FFFFFF', usage: 'background' });
    expect(result.colors[2]).toMatchObject({ name: 'Dark Grey', hex: '#1F2937', usage: 'text' });
  });

  it('parses fonts from valid CSV', () => {
    const result = parseCSV(SAMPLE_CSV);
    expect(result.fonts).toHaveLength(2);
    expect(result.fonts[0]).toMatchObject({
      family: 'Inter',
      usage: 'body',
    });
  });

  it('splits font weights by semicolon', () => {
    const result = parseCSV(SAMPLE_CSV);
    expect(result.fonts[0].weights).toEqual(['400', '600', '700']);
    expect(result.fonts[1].weights).toEqual(['700']);
  });

  it('parses selectors from valid CSV', () => {
    const result = parseCSV(SAMPLE_CSV);
    expect(result.selectors).toHaveLength(2);
    expect(result.selectors[0]).toEqual({
      pattern: '.brand-header',
      description: 'Top navigation bar',
    });
    expect(result.selectors[1]).toEqual({
      pattern: '#hero-*',
      description: 'Hero banner sections',
    });
  });

  it('skips empty lines', () => {
    const csv = `type,name,value,usage,context
color,Red,#FF0000,primary,
\n
color,Blue,#0000FF,secondary,
`;
    const result = parseCSV(csv);
    expect(result.colors).toHaveLength(2);
  });

  it('skips rows with unknown type', () => {
    const csv = `type,name,value,usage,context
color,Red,#FF0000,primary,
unknown,Foo,bar,,
font,Inter,400,body,
`;
    const result = parseCSV(csv);
    expect(result.colors).toHaveLength(1);
    expect(result.fonts).toHaveLength(1);
    expect(result.selectors).toHaveLength(0);
  });

  it('skips malformed rows with insufficient fields', () => {
    const csv = `type,name,value,usage,context
color
color,Red,#FF0000,primary,
`;
    const result = parseCSV(csv);
    expect(result.colors).toHaveLength(1);
  });

  it('returns empty arrays for empty CSV', () => {
    const result = parseCSV('');
    expect(result.colors).toHaveLength(0);
    expect(result.fonts).toHaveLength(0);
    expect(result.selectors).toHaveLength(0);
  });

  it('handles CSV with only header row', () => {
    const result = parseCSV('type,name,value,usage,context');
    expect(result.colors).toHaveLength(0);
    expect(result.fonts).toHaveLength(0);
    expect(result.selectors).toHaveLength(0);
  });
});
