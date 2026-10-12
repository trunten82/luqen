/**
 * Recording stand-ins for the fix-PR surface (never real git hosts).
 *
 * The golden test file vi.mock()s '@luqen/core' so proposeFixesFromReport is
 * recordProposeFixesFromReport, and '../../src/git-hosts/registry.js' so
 * getGitHostPlugin returns fakeGitHostPlugin. The recorded report argument is
 * the observable "fix-PR proposer input". The recorder keeps four declared
 * parameters on purpose: the route only calls the proposer when its arity is
 * at least four.
 */
const captured: unknown[] = [];

function snapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function resetProposerCapture(): void {
  captured.length = 0;
}

export function capturedProposerCalls(): readonly unknown[] {
  return captured.map((c) => snapshot(c));
}

export async function recordProposeFixesFromReport(
  report: unknown,
  repoPath: string,
  overrides: Record<string, string>,
  _reader: unknown,
): Promise<{ fixes: [] }> {
  captured.push(snapshot({ report, repoPath, overrides }));
  return { fixes: [] };
}

/** Enough of GitHostPlugin for the route's construction of a RemoteFileReader. */
export const fakeGitHostPlugin = {
  type: 'github',
  displayName: 'Fabrikam Git',
  validateToken: async () => ({ valid: true, username: 'fabrikam-admin' }),
  readFile: async () => null,
  listFiles: async () => [],
  createPullRequest: async () => {
    throw new Error('golden: createPullRequest must not be reached');
  },
};
