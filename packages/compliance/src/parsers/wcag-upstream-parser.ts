export interface ParsedWcagCriterion {
  readonly version: string;
  readonly level: string;
  readonly criterion: string;
  readonly title: string;
  readonly url?: string;
}

interface QuickRefEntry {
  num?: string;
  level?: string;
  handle?: string;
  versions?: string[];
}

interface TenOnEntry {
  ref_id?: string;
  title?: string;
  level?: string;
  url?: string;
}

export function parseQuickRefJson(data: Record<string, QuickRefEntry>): ParsedWcagCriterion[] {
  const results: ParsedWcagCriterion[] = [];
  for (const entry of Object.values(data)) {
    if (!entry.num || !entry.level || !entry.handle) continue;
    for (const version of entry.versions ?? ['2.1']) {
      results.push({
        version,
        level: entry.level,
        criterion: entry.num,
        title: entry.handle,
      });
    }
  }
  return results.sort((a, b) => a.criterion.localeCompare(b.criterion, undefined, { numeric: true }));
}

export function parseTenOnJson(data: TenOnEntry[], version: string): ParsedWcagCriterion[] {
  return data
    .filter(e => e.ref_id && e.title && e.level)
    .map(e => ({
      version,
      level: e.level!,
      criterion: e.ref_id!,
      title: e.title!,
      ...(e.url ? { url: e.url } : {}),
    }))
    .sort((a, b) => a.criterion.localeCompare(b.criterion, undefined, { numeric: true }));
}

const QUICK_REF_URL = 'https://raw.githubusercontent.com/w3c/wai-wcag-quickref/gh-pages/_data/wcag21.json';
const TENON_URL = 'https://raw.githubusercontent.com/nickakey/wcag-as-json/master/wcag.json';

export async function fetchQuickRefJson(): Promise<Record<string, QuickRefEntry>> {
  const response = await fetch(QUICK_REF_URL, {
    signal: AbortSignal.timeout(15000),
    headers: { 'User-Agent': 'Luqen-Compliance/1.0' },
  });
  if (!response.ok) throw new Error(`Failed to fetch WCAG Quick Ref: ${response.status}`);
  return response.json() as Promise<Record<string, QuickRefEntry>>;
}

export async function fetchTenOnJson(): Promise<TenOnEntry[]> {
  const response = await fetch(TENON_URL, {
    signal: AbortSignal.timeout(15000),
    headers: { 'User-Agent': 'Luqen-Compliance/1.0' },
  });
  if (!response.ok) throw new Error(`Failed to fetch tenon WCAG JSON: ${response.status}`);
  return response.json() as Promise<TenOnEntry[]>;
}
