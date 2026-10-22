/**
 * D-04 (phase 93): the LLM fix capability has exactly three source files that name it, and each
 * has an entitlement test. A fourth file turns this test red.
 *
 * The three files, and where the llm.view rule is pinned for each:
 *   - src/llm-client.ts       the definition (LLMClient.generateFix and its generate-fix URL);
 *                             not an entry point itself.
 *   - src/routes/reports.ts   GET /reports/:id/fix-suggestion; pinned by
 *                             tests/routes/fix-suggestion-permissions.test.ts.
 *   - src/mcp/tools/fix.ts    MCP dashboard_generate_fix, reached directly and by the assistant;
 *                             pinned by tests/mcp/fix-entitlement.test.ts and
 *                             tests/integration/agent-fix-entitlement.test.ts.
 *
 * Whoever turns this red: add the llm.view rule and a test for the new path BEFORE adding the file
 * to the list below. The pattern-only paths (repos, fix-pr, REST fixes) call getFixSuggestion and
 * never name the LLM capability, so they do not belong here.
 *
 * The matcher is textual and also matches comments: a file that merely mentions the call fails the
 * test too, which is the conservative direction.
 */
import { describe, it, expect } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSources } from '../helpers/source-walk.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(HERE, '..', '..', 'src');

const LLM_FIX_CALL = /generateFix\(|\/api\/v1\/generate-fix/;

const INVENTORIED = [
  'llm-client.ts',
  'mcp/tools/fix.ts',
  'routes/reports.ts',
];

function filesNamingTheLlmFixCapability(): string[] {
  return [...readSources(SRC_ROOT)]
    .filter(([, text]) => LLM_FIX_CALL.test(text))
    .map(([path]) => path.split('\\').join('/'))
    .sort();
}

describe('D-04 AI fix entry points', () => {
  it('D-04 the LLM fix capability is called from exactly the inventoried files', () => {
    expect(filesNamingTheLlmFixCapability()).toEqual([...INVENTORIED].sort());
  });

  it('D-04 the inventory matcher finds the known call sites', () => {
    const found = filesNamingTheLlmFixCapability();
    expect(found.length).toBeGreaterThan(0);
    expect(found).toContain('routes/reports.ts');
  });
});
