import yaml from 'js-yaml';

export interface W3cParsedRegulation {
  readonly name: string;
  readonly url: string;
  readonly wcagVersion: string;
  readonly wcagLevel: string;
  readonly scope: 'public' | 'private' | 'all';
  readonly enforcementYear: number;
  readonly type: string;
  readonly jurisdictionId: string;
}

interface W3cPolicy {
  title?: { en?: string };
  url?: string;
  wcagver?: string;
  enactdate?: number;
  type?: string;
  scope?: string;
  webonly?: string;
}

interface W3cYamlData {
  title?: { en?: string };
  updated?: string;
  policies?: W3cPolicy[];
}

function parseWcagVer(wcagver: string | undefined): { version: string; level: string } {
  if (wcagver == null) return { version: '2.1', level: 'AA' };
  const versionMatch = wcagver.match(/(\d+\.\d+)/);
  const version = versionMatch ? versionMatch[1] : '2.1';
  const levelMatch = wcagver.match(/Level\s+(AAA|AA|A)/i);
  const level = levelMatch ? levelMatch[1].toUpperCase() : 'AA';
  return { version, level };
}

function normalizeScope(scope: string | undefined): 'public' | 'private' | 'all' {
  if (scope == null) return 'all';
  const lower = scope.toLowerCase();
  if (lower.includes('public') && lower.includes('private')) return 'all';
  if (lower.includes('public')) return 'public';
  if (lower.includes('private')) return 'private';
  return 'all';
}

export function parseW3cPolicyYaml(content: string, jurisdictionId: string): W3cParsedRegulation[] {
  // Extract YAML frontmatter between --- markers
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return [];

  const data = yaml.load(fmMatch[1]) as W3cYamlData;
  if (!data?.policies) return [];

  return data.policies
    .filter((p): p is W3cPolicy & { title: { en: string } } =>
      p.title?.en != null && p.title.en.length > 0)
    .map((policy) => {
      const { version, level } = parseWcagVer(policy.wcagver);
      return {
        name: policy.title!.en!,
        url: policy.url ?? '',
        wcagVersion: version,
        wcagLevel: level,
        scope: normalizeScope(policy.scope),
        enforcementYear: policy.enactdate ?? 0,
        type: policy.type ?? 'law',
        jurisdictionId,
      };
    });
}

const W3C_POLICIES_BASE = 'https://raw.githubusercontent.com/w3c/wai-policies-prototype/master/_policies';

export async function fetchW3cPolicyIndex(): Promise<string[]> {
  const response = await fetch(
    'https://api.github.com/repos/w3c/wai-policies-prototype/contents/_policies',
    { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Luqen-Compliance/1.0' } },
  );
  if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);
  const entries = await response.json() as Array<{ name: string }>;
  return entries.filter(e => e.name.endsWith('.md')).map(e => e.name);
}

export async function fetchW3cPolicyFile(filename: string): Promise<string> {
  const url = `${W3C_POLICIES_BASE}/${filename}`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(10000),
    headers: { 'User-Agent': 'Luqen-Compliance/1.0' },
  });
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
  return response.text();
}
