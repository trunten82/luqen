/**
 * CSV parser for brand guideline files.
 * Expected header row: type,name,value,usage,context
 */

export interface ParsedColor {
  readonly name: string;
  readonly hex: string;
  readonly usage?: string;
  readonly context?: string;
}

export interface ParsedFont {
  readonly family: string;
  readonly weights?: readonly string[];
  readonly usage?: string;
  readonly context?: string;
}

export interface ParsedSelector {
  readonly pattern: string;
  readonly description?: string;
}

export interface ParsedCSVResult {
  readonly colors: readonly ParsedColor[];
  readonly fonts: readonly ParsedFont[];
  readonly selectors: readonly ParsedSelector[];
}

/**
 * Split a CSV line respecting quoted fields.
 */
function splitCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

export function parseCSV(csvContent: string): ParsedCSVResult {
  const lines = csvContent.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  if (lines.length === 0) {
    return { colors: [], fonts: [], selectors: [] };
  }

  // Skip header row
  const dataLines = lines.slice(1);

  const colors: ParsedColor[] = [];
  const fonts: ParsedFont[] = [];
  const selectors: ParsedSelector[] = [];

  for (const line of dataLines) {
    const fields = splitCSVLine(line);

    if (fields.length < 2) {
      continue;
    }

    const [type, name, value, usage, context] = fields;
    const trimmedType = type.trim();
    const trimmedName = name.trim();

    if (!trimmedType || !trimmedName) {
      continue;
    }

    if (trimmedType === 'color') {
      const trimmedValue = (value ?? '').trim();
      if (!trimmedValue) continue;
      colors.push({
        name: trimmedName,
        hex: trimmedValue,
        ...(usage?.trim() ? { usage: usage.trim() } : {}),
        ...(context?.trim() ? { context: context.trim() } : {}),
      });
    } else if (trimmedType === 'font') {
      const rawWeights = (value ?? '').trim();
      const weights = rawWeights
        ? rawWeights.split(';').map(w => w.trim()).filter(w => w.length > 0)
        : undefined;
      fonts.push({
        family: trimmedName,
        ...(weights && weights.length > 0 ? { weights } : {}),
        ...(usage?.trim() ? { usage: usage.trim() } : {}),
        ...(context?.trim() ? { context: context.trim() } : {}),
      });
    } else if (trimmedType === 'selector') {
      // name column = pattern, context column = description
      const trimmedContext = context?.trim();
      selectors.push({
        pattern: trimmedName,
        ...(trimmedContext ? { description: trimmedContext } : {}),
      });
    }
    // Skip unknown types
  }

  return { colors, fonts, selectors };
}
