/**
 * PDF parser stub for brand guideline files.
 * Requires an LLM provider plugin to extract structured data from PDF text.
 */

import type { IBrandingLLMProvider, ExtractedBrandData } from '../types.js';

export async function parsePDF(
  text: string,
  provider?: IBrandingLLMProvider,
): Promise<ExtractedBrandData> {
  if (!provider) {
    throw new Error(
      'LLM provider required for PDF parsing. Install an LLM plugin to enable this feature.',
    );
  }

  return provider.extractBrandData(text);
}
