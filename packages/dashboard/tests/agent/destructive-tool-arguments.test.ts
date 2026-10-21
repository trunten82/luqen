/**
 * HARD-21: a paused (destructive) assistant action keeps its arguments as given while it awaits
 * confirmation and is stored redacted once it is resolved (src/db/sqlite/repositories/
 * conversation-repository.ts). A destructive tool may carry a secret argument when it declares a
 * secret-named argument or takes an argument whose entry names the caller chooses (a record or an
 * open object); such a tool relies on that rule, so the set is pinned here over each destructive
 * tool's REGISTERED input schema (walked at every depth as JSON Schema):
 *
 *   - no destructive tool declares an argument whose name matches SECRET_ARGUMENT_KEY
 *   - the destructive tools that may carry a secret argument, and their caller-named arguments, are
 *     listed, so adding one is a reviewed decision
 *
 * Each test carries a positive control showing the walk can find what it looks for.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createDashboardMcpServer } from '../../src/mcp/server.js';
import { DASHBOARD_TOOL_METADATA } from '../../src/mcp/metadata.js';
import { SECRET_ARGUMENT_KEY } from '../../src/db/agent-audit-redaction.js';

type Json = unknown;

async function registeredSchemas(): Promise<Record<string, Json>> {
  const { server } = await createDashboardMcpServer({
    storage: {} as never,
    scanService: {} as never,
    serviceConnections: {} as never,
  });
  const tools = (server as unknown as { _registeredTools: Record<string, { inputSchema?: z.ZodTypeAny }> })._registeredTools;
  const out: Record<string, Json> = {};
  for (const [name, tool] of Object.entries(tools)) {
    if (tool.inputSchema !== undefined) {
      out[name] = z.toJSONSchema(tool.inputSchema, { unrepresentable: 'any', io: 'input' });
    }
  }
  return out;
}

/** Every declared argument path (`a`, `a.b`, ...) of a JSON Schema, at any depth. */
function declaredArguments(schema: Json): string[] {
  const out: string[] = [];
  const visit = (node: Json, at: string): void => {
    if (Array.isArray(node)) {
      for (const n of node) visit(n, at);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    for (const [key, child] of Object.entries(node)) {
      if (key === 'properties' && child !== null && typeof child === 'object' && !Array.isArray(child)) {
        for (const [name, sub] of Object.entries(child)) {
          out.push(`${at}${name}`);
          visit(sub, `${at}${name}.`);
        }
      } else {
        visit(child, at);
      }
    }
  };
  visit(schema, '');
  return out;
}

/** JSON Schema keywords that describe an argument without constraining it. */
const ANNOTATION_KEYS = new Set(['description', 'title', 'default', 'examples', 'deprecated', 'readOnly', 'writeOnly', '$comment', '$schema']);

/** An open value: a schema that constrains nothing (what zod emits for z.any() and z.unknown()). */
function isOpenValue(node: Json): boolean {
  return node !== null && typeof node === 'object' && !Array.isArray(node)
    && Object.keys(node as Record<string, Json>).every((k) => ANNOTATION_KEYS.has(k));
}

/**
 * The argument paths whose entry names the caller chooses, at any depth: a record or open object
 * (additionalProperties, propertyNames), a map named by patterns (patternProperties), and an open
 * value (an argument, or the items of an array, whose schema is empty).
 */
function callerNamedArguments(schema: Json): string[] {
  const out: string[] = [];
  const visit = (node: Json, at: string): void => {
    if (Array.isArray(node)) {
      for (const n of node) visit(n, at);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    const rec = node as Record<string, Json>;
    const open = ('additionalProperties' in rec && rec['additionalProperties'] !== false)
      || 'propertyNames' in rec
      || 'patternProperties' in rec
      || ('items' in rec && isOpenValue(rec['items']));
    if (open) out.push(at === '' ? '(root)' : at.slice(0, -1));
    for (const [key, child] of Object.entries(rec)) {
      if (key === 'properties' && child !== null && typeof child === 'object' && !Array.isArray(child)) {
        for (const [name, sub] of Object.entries(child)) {
          if (isOpenValue(sub)) out.push(`${at}${name}`);
          visit(sub, `${at}${name}.`);
        }
      } else {
        visit(child, at);
      }
    }
  };
  visit(schema, '');
  return out;
}

const DESTRUCTIVE = DASHBOARD_TOOL_METADATA.filter((t) => t.destructive === true).map((t) => t.name);

describe('HARD-21 destructive assistant tools and secret named arguments', () => {
  it('HARD-21 destructive tools that may carry a secret argument are listed', async () => {
    const schemas = await registeredSchemas();
    expect(DESTRUCTIVE.length).toBeGreaterThan(0);
    const secretNamed = (schema: Json): string[] =>
      declaredArguments(schema).filter((path) => SECRET_ARGUMENT_KEY.test(path.split('.').pop() ?? ''));
    for (const name of DESTRUCTIVE) {
      expect(declaredArguments(schemas[name]).length, `${name} has a registered input schema`).toBeGreaterThan(0);
      expect(secretNamed(schemas[name]), name).toEqual([]);
    }
    const mayCarry = DESTRUCTIVE.filter(
      (name) => secretNamed(schemas[name]).length > 0 || callerNamedArguments(schemas[name]).length > 0,
    ).sort();
    expect(mayCarry).toEqual(['dashboard_scan_site']);
    // Positive control: the same walk finds the password argument of dashboard_create_user.
    expect(secretNamed(schemas['dashboard_create_user'])).toEqual(['password']);
  });

  it('HARD-21 destructive tool arguments with caller chosen names are listed', async () => {
    const schemas = await registeredSchemas();
    const listed = DESTRUCTIVE.flatMap((name) => callerNamedArguments(schemas[name]).map((path) => `${name}.${path}`)).sort();
    // The scan's custom request headers are named by the caller.
    expect(listed).toEqual(['dashboard_scan_site.headers']);
  });

  it('HARD-21 the destructive tool schema walk sees pattern properties and open values', () => {
    // A map whose entries are named by a pattern.
    const patterned = { type: 'object', properties: { settings: { type: 'object', patternProperties: { '^x-': { type: 'string' } } } } };
    // zod emits an empty schema for an argument of any type (z.any / z.unknown).
    const open = z.toJSONSchema(z.object({ payload: z.unknown(), note: z.string() }), { unrepresentable: 'any', io: 'input' });
    const openItems = { type: 'object', properties: { list: { type: 'array', items: {} } } };
    expect(callerNamedArguments(patterned)).toEqual(['settings']);
    expect(callerNamedArguments(open)).toEqual(['payload']);
    expect(callerNamedArguments(openItems)).toEqual(['list']);
    // Controls: a closed object and a description-only argument that is typed report nothing.
    const closed = { type: 'object', properties: { a: { type: 'string', description: 'typed' } }, additionalProperties: false };
    expect(callerNamedArguments(closed)).toEqual([]);
  });
});
