/**
 * GuidelineParser — facade for CSV, JSON, and PDF brand guideline parsers.
 */

import type { IBrandingLLMProvider, ExtractedBrandData } from '../types.js';
import { parseCSV, type ParsedCSVResult } from './csv-parser.js';
import { parseJSON, type ParsedJSONResult } from './json-parser.js';
import { parsePDF } from './pdf-parser.js';
import { parseCSS as parseCSSFn, type ParsedCSSResult } from './css-parser.js';

// Template content embedded as constants to avoid runtime file I/O.
const CSV_TEMPLATE = `type,name,value,usage,context
color,Primary Blue,#1E40AF,primary,"Headers, CTAs"
color,White,#FFFFFF,background,"Page backgrounds"
color,Dark Grey,#1F2937,text,"Body text"
font,Inter,400;600;700,body,"Body text, paragraphs"
font,Playfair Display,700,heading,"H1, H2 headings"
selector,.brand-header,,,Top navigation bar
selector,#hero-*,,,Hero banner sections
`;

const JSON_TEMPLATE = JSON.stringify(
  {
    name: 'Brand Guide Name',
    description: 'Optional description',
    colors: [
      { name: 'Primary Blue', hex: '#1E40AF', usage: 'primary', context: 'Headers, CTAs' },
      { name: 'White', hex: '#FFFFFF', usage: 'background', context: 'Page backgrounds' },
    ],
    fonts: [
      { family: 'Inter', weights: ['400', '600', '700'], usage: 'body', context: 'Body text' },
    ],
    selectors: [{ pattern: '.brand-header', description: 'Top navigation bar' }],
  },
  null,
  2,
);

export class GuidelineParser {
  async parseCSV(csvContent: string): Promise<ParsedCSVResult> {
    return parseCSV(csvContent);
  }

  async parseJSON(jsonContent: string): Promise<ParsedJSONResult> {
    return parseJSON(jsonContent);
  }

  async parsePDF(
    text: string,
    options?: { llmProvider?: IBrandingLLMProvider },
  ): Promise<ExtractedBrandData> {
    return parsePDF(text, options?.llmProvider);
  }

  async parseCSS(cssContent: string): Promise<ParsedCSSResult> {
    return parseCSSFn(cssContent);
  }

  static generateCSVTemplate(): string {
    return CSV_TEMPLATE;
  }

  static generateJSONTemplate(): string {
    return JSON_TEMPLATE;
  }
}

export { parseCSV } from './csv-parser.js';
export { parseJSON } from './json-parser.js';
export { parsePDF } from './pdf-parser.js';
export { parseCSS } from './css-parser.js';
export type { ParsedCSVResult, ParsedColor, ParsedFont, ParsedSelector } from './csv-parser.js';
export type { ParsedJSONResult } from './json-parser.js';
export type { ParsedCSSResult } from './css-parser.js';
