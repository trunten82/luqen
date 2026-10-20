/**
 * Secret arguments never reach the agent audit log.
 *
 * Tool arguments come from the model and are stored with every agent audit row (the assistant loop,
 * a refused call and a confirmed action all write one). Any object key whose name matches
 * {@link SECRET_ARGUMENT_KEY}, at any depth and inside arrays, has its value stored as
 * {@link REDACTED}, whatever that value is. Arguments without such a key are stored exactly as given.
 *
 * The repository applies this on write, so every writer is covered by the one place that stores a row.
 * The conversation repository applies the same rule to every stored tool call (agent_messages); a
 * paused action's row keeps its arguments until the write that confirms or declines it.
 */

/** Argument names whose values the agent audit never stores. */
export const SECRET_ARGUMENT_KEY = /pass(word)?|secret|token|api[_-]?key|authorization|credential/i;

/** What a secret argument's value is stored as. */
export const REDACTED = '[redacted]';

/** Does `value` hold a secret-named key anywhere? */
function holdsSecret(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(holdsSecret);
  if (value === null || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, child]) => SECRET_ARGUMENT_KEY.test(key) || holdsSecret(child));
}

/** A copy of `value` with every secret-named key's value replaced by {@link REDACTED}. */
export function redactSecretArguments(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecretArguments);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, SECRET_ARGUMENT_KEY.test(key) ? REDACTED : redactSecretArguments(child)]),
  );
}

/**
 * The stored form of an audit row's arguments: unchanged when no key has a secret name (or when the
 * text is not JSON, which no writer produces), otherwise the redacted copy as JSON.
 */
export function redactArgumentsJson(argsJson: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(argsJson);
  } catch {
    return argsJson;
  }
  return holdsSecret(parsed) ? JSON.stringify(redactSecretArguments(parsed)) : argsJson;
}

/**
 * The key paths in `args` whose value holds {@link REDACTED} under a secret-named key, at any depth and
 * inside arrays (`headers.Authorization`, `items[0].token`). A string under a secret-named key counts
 * wherever it sits below that key. The marker in a key whose name is not secret is ordinary text and is
 * not reported. Paths only: the function never returns a value.
 *
 * Stored conversations show the model its own earlier calls with secret values redacted, so a call the
 * model copies from that history carries the marker where a value belongs; the dispatcher refuses it.
 */
export function redactedArgumentPaths(args: unknown): readonly string[] {
  const found: string[] = [];
  const walk = (value: unknown, path: string, underSecretKey: boolean): void => {
    if (typeof value === 'string') {
      if (underSecretKey && value.includes(REDACTED)) found.push(path);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((child, index) => walk(child, `${path}[${index}]`, underSecretKey));
      return;
    }
    if (value === null || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      walk(child, path === '' ? key : `${path}.${key}`, underSecretKey || SECRET_ARGUMENT_KEY.test(key));
    }
  };
  walk(args, '', false);
  return found;
}
