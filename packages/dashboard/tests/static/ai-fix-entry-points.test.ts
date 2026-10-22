/**
 * D-04 (phase 93): the generate-fix capability (AI fix drafts) has exactly three source files that
 * call it, and each has an entitlement test. Scope: AI fix drafts only. The vision pass's suggested
 * alt text is not an AI fix draft, is not gated by llm.view, and is outside this inventory. A fourth file turns this test red.
 *
 * The three call-site files, and where the llm.view rule is pinned for each:
 *   - src/llm-client.ts       the definition (LLMClient.generateFix and its generate-fix URL);
 *                             not an entry point itself.
 *   - src/routes/reports.ts   GET /reports/:id/fix-suggestion; pinned by
 *                             tests/routes/fix-suggestion-permissions.test.ts.
 *   - src/mcp/tools/fix.ts    MCP dashboard_generate_fix, reached directly and by the assistant;
 *                             pinned by tests/mcp/fix-entitlement.test.ts and
 *                             tests/integration/agent-fix-entitlement.test.ts.
 *
 * Two matchers. LLM_FIX_CALL finds the direct forms (`generateFix(` and the literal
 * `/api/v1/generate-fix` URL). CAPABILITY_NAME_LITERAL finds the bare quoted capability name
 * ('generate-fix', "generate-fix" or `generate-fix`), which is what an INDIRECT call needs: the
 * name held in a variable and interpolated into a URL template never matches LLM_FIX_CALL. A file
 * that matches either matcher must be inventoried.
 *
 * NAME_ONLY lists the files that name the capability without calling it, each with its exact
 * count of bare-name literals. Those files may not match LLM_FIX_CALL, and a new literal in one of
 * them turns the count red: the place an indirect call would be added is exactly where it would
 * reuse the name.
 *
 * Whoever turns this red: add the llm.view rule and a test for the new path BEFORE adding the file
 * to a list below. The pattern-only paths (repos, fix-pr, REST fixes) call getFixSuggestion and
 * never name the LLM capability, so they do not belong here.
 *
 * Both matchers are textual and also match comments: a file that merely mentions the call or the
 * name fails the test too, which is the conservative direction. What they cannot see: a name
 * assembled from pieces (`generate-${kind}`), or a call that reads the name from a NAME_ONLY file's
 * existing literal (for example an element of an admin capability list).
 */
import { describe, it, expect } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSources } from '../helpers/source-walk.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(HERE, '..', '..', 'src');

const LLM_FIX_CALL = /generateFix\(|\/api\/v1\/generate-fix/;
const CAPABILITY_NAME_LITERAL = /(['"`])generate-fix\1/g;

/** Files that call the capability; each has an llm.view entitlement test (see the header). */
const INVENTORIED = [
  'llm-client.ts',
  'mcp/tools/fix.ts',
  'routes/reports.ts',
];

/** Files that name the capability without calling it, with their exact bare-name literal count. */
const NAME_ONLY: Readonly<Record<string, number>> = {
  // Migration 073's SQL comment names the credit-ledger reason value; shipped SQL, not a call.
  'db/sqlite/migrations.ts': 1,
  // Admin capability lists: the prompt-editor names and VALID_CAPABILITIES.
  'routes/admin/llm.ts': 2,
  // Admin LLM-usage page: the capability filter options.
  'routes/admin/llm-usage.ts': 1,
};

function normalise(path: string): string {
  return path.split('\\').join('/');
}

function capabilityNameCount(text: string): number {
  return [...text.matchAll(CAPABILITY_NAME_LITERAL)].length;
}

function filesCallingTheLlmFixCapability(): string[] {
  return [...readSources(SRC_ROOT)]
    .filter(([, text]) => LLM_FIX_CALL.test(text))
    .map(([path]) => normalise(path))
    .sort();
}

function filesNamingTheLlmFixCapability(): string[] {
  return [...readSources(SRC_ROOT)]
    .filter(([, text]) => LLM_FIX_CALL.test(text) || capabilityNameCount(text) > 0)
    .map(([path]) => normalise(path))
    .sort();
}

function nameLiteralCounts(paths: readonly string[]): Record<string, number> {
  const sources = new Map([...readSources(SRC_ROOT)].map(([path, text]) => [normalise(path), text] as const));
  return Object.fromEntries(paths.map((path) => [path, capabilityNameCount(sources.get(path) ?? '')]));
}

describe('D-04 generate-fix capability call sites (AI fix drafts)', () => {
  it('D-04 the generate-fix capability is named only by the inventoried files', () => {
    expect(filesNamingTheLlmFixCapability()).toEqual([...INVENTORIED, ...Object.keys(NAME_ONLY)].sort());
  });

  it('D-04 the generate-fix capability is called only from the call-site inventory', () => {
    expect(filesCallingTheLlmFixCapability()).toEqual([...INVENTORIED].sort());
  });

  it('D-04 the name-only files carry exactly their counted generate-fix literals', () => {
    expect(nameLiteralCounts(Object.keys(NAME_ONLY))).toEqual({ ...NAME_ONLY });
  });

  it('D-04 the generate-fix inventory matcher finds the known call sites', () => {
    const found = filesNamingTheLlmFixCapability();
    expect(found.length).toBeGreaterThan(0);
    expect(found).toContain('routes/reports.ts');
    expect(found).toContain('routes/admin/llm-usage.ts');
  });

  it('D-04 the bare-name matcher sees the indirect form and ignores longer names', () => {
    const indirect = "const cap = 'generate-fix';\nfetch(`${base}/api/v1/${cap}`);";
    expect(LLM_FIX_CALL.test(indirect)).toBe(false);
    expect(capabilityNameCount(indirect)).toBe(1);
    expect(capabilityNameCount('const cap = "generate-fix";')).toBe(1);
    expect(capabilityNameCount('const cap = `generate-fix`;')).toBe(1);
    expect(capabilityNameCount("const other = 'generate-fix-pr';")).toBe(0);
  });
});
