/**
 * JSON parser for brand guideline files.
 * Validates against the expected schema using zod.
 */

import { z } from 'zod';
import type { ParsedColor, ParsedFont, ParsedSelector } from './csv-parser.js';

const colorSchema = z.object({
  name: z.string(),
  hex: z.string(),
  usage: z.string().optional(),
  context: z.string().optional(),
});

const fontSchema = z.object({
  family: z.string(),
  weights: z.array(z.string()).optional(),
  usage: z.string().optional(),
  context: z.string().optional(),
});

const selectorSchema = z.object({
  pattern: z.string(),
  description: z.string().optional(),
});

const guidelineSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  colors: z.array(colorSchema).default([]),
  fonts: z.array(fontSchema).default([]),
  selectors: z.array(selectorSchema).default([]),
});

export interface ParsedJSONResult {
  readonly name: string;
  readonly description?: string;
  readonly colors: readonly ParsedColor[];
  readonly fonts: readonly ParsedFont[];
  readonly selectors: readonly ParsedSelector[];
}

export function parseJSON(jsonContent: string): ParsedJSONResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonContent);
  } catch (err) {
    throw new Error(`Invalid JSON: ${(err as Error).message}`);
  }

  const result = guidelineSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map(i => i.message).join('; ');
    throw new Error(`Invalid guideline JSON: ${issues}`);
  }

  const data = result.data;
  return {
    name: data.name,
    ...(data.description ? { description: data.description } : {}),
    colors: data.colors,
    fonts: data.fonts,
    selectors: data.selectors,
  };
}
