/**
 * HARD-19 wiring: the in-process agent decides from the same stored-caller rule as the MCP endpoint.
 *
 * In src/server.ts the agent's tool manifest (AgentService `resolvePermissions`) and the scopes of the
 * token minted per tool dispatch (ToolDispatcher `resolveScopes`) are closures inside createServer, so
 * no unit test can call them. This test finds each closure by its construction call expression (never a
 * line number), reads its body without comment lines, and requires a call to storedPermissionsOrNone
 * and no other resolution path; and it requires storedPermissionsOrNone itself to ask
 * resolveStoredCaller. tests/auth/stored-caller.test.ts covers what that rule answers.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');
const SERVER = readFileSync(join(SRC, 'server.ts'), 'utf8');
const STORED_CALLER = readFileSync(join(SRC, 'auth', 'stored-caller.ts'), 'utf8');

const withoutComments = (code: string): string =>
  code
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
    })
    .join('\n');

/** The source from `start` to the brace that closes the first `{` at or after it. */
function balancedFrom(code: string, start: number): string {
  const open = code.indexOf('{', start);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') {
      depth--;
      if (depth === 0) return code.slice(start, i + 1);
    }
  }
  return '';
}

/** The body of `property: async (...) => { ... }` inside the single `new <ctor>({` call in server.ts. */
function closureIn(ctor: string, property: string): string {
  const anchor = `new ${ctor}({`;
  const at = SERVER.indexOf(anchor);
  expect(at, `${anchor} not found in server.ts`).toBeGreaterThanOrEqual(0);
  expect(SERVER.indexOf(anchor, at + 1), `${anchor} occurs more than once in server.ts`).toBe(-1);
  const call = balancedFrom(SERVER, at);
  const prop = call.indexOf(`${property}:`);
  expect(prop, `${property}: not found in ${anchor}`).toBeGreaterThanOrEqual(0);
  const arrow = call.indexOf('=>', prop);
  return withoutComments(balancedFrom(call, arrow));
}

describe('HARD-19 agent stored caller wiring', () => {
  it('HARD-19 the agent tool manifest and the agent token scopes come from the stored caller rule', () => {
    const closures = {
      'ToolDispatcher resolveScopes': closureIn('ToolDispatcher', 'resolveScopes'),
      'AgentService resolvePermissions': closureIn('AgentService', 'resolvePermissions'),
    };
    for (const [name, body] of Object.entries(closures)) {
      expect(body, name).toMatch(/\bstoredPermissionsOrNone\s*\(\s*storage\s*,\s*userId\s*,\s*orgId\s*\)/);
      expect(body, name).not.toMatch(/\bresolveEffectivePermissions\s*\(/);
      expect(body, name).not.toMatch(/\bgetUserById\s*\(/);
    }
    const helper = withoutComments(balancedFrom(STORED_CALLER, STORED_CALLER.indexOf('export async function storedPermissionsOrNone(')));
    expect(helper).toMatch(/\bresolveStoredCaller\s*\(\s*storage\s*,\s*userId\s*,\s*orgId\s*\)/);
  });
});
