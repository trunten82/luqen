import { describe, it, expect, vi } from 'vitest';
import { parsePDF } from '../../src/parser/pdf-parser.js';
import type { IBrandingLLMProvider, ExtractedBrandData } from '../../src/types.js';

describe('parsePDF', () => {
  it('calls LLM provider with the PDF text and returns extracted data', async () => {
    const mockData: ExtractedBrandData = {
      colors: [{ name: 'Brand Blue', hex: '#1E40AF', usage: 'primary' }],
      fonts: [{ family: 'Inter', weights: ['400', '700'], usage: 'body' }],
    };

    const provider: IBrandingLLMProvider = {
      extractBrandData: vi.fn().mockResolvedValue(mockData),
    };

    const result = await parsePDF('some pdf text content', provider);

    expect(provider.extractBrandData).toHaveBeenCalledWith('some pdf text content');
    expect(result).toEqual(mockData);
  });

  it('throws if no LLM provider is given', async () => {
    await expect(parsePDF('some pdf text')).rejects.toThrow(
      'LLM provider required for PDF parsing',
    );
  });

  it('throws with install instructions when provider is missing', async () => {
    await expect(parsePDF('some pdf text')).rejects.toThrow(
      'Install an LLM plugin to enable this feature.',
    );
  });

  it('propagates errors thrown by the LLM provider', async () => {
    const provider: IBrandingLLMProvider = {
      extractBrandData: vi.fn().mockRejectedValue(new Error('Provider timeout')),
    };

    await expect(parsePDF('some pdf text', provider)).rejects.toThrow('Provider timeout');
  });
});
