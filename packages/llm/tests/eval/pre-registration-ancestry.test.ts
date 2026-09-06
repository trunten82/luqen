/**
 * `pre-registration-ancestry.test.ts` — Phase 86 Task 3: the checkable
 * ordering invariant the bar file itself specifies, proven non-vacuous
 * against this repository's OWN real history (not only a happy-path
 * fixture) — a check that has never returned "violated" has an unknown
 * failure state.
 *
 * MEASURED FACT, established with the command below, kept separate from any
 * conclusion drawn from it: this worktree's local git checkout is ITSELF a
 * shallow clone (`.git/shallow` present, one boundary commit) — an
 * environmental fact of this dev checkout, unrelated to the CI shallow
 * clone this plan's Task 3 fixes (`actions/checkout@v4` defaulting to
 * `fetch-depth: 1`). CONCLUDED: this lets the "throws on shallow" test
 * below exercise the REAL `isShallowRepository` implementation (not only an
 * injected stub) for its true-returning branch, as a side effect of the
 * environment this suite happens to run in; every other test below still
 * uses dependency injection to force `isShallowRepository` to return
 * `false`, so those tests hold regardless of whether the executing
 * environment happens to be shallow.
 *
 * Measured with:
 *   `git rev-parse --is-shallow-repository` -> `true` (in this worktree)
 *   `ls .git/shallow` in the main repo -> present, one boundary commit
 *
 * SHALLOW-SIMULATION METHOD CHOSEN: dependency injection
 * (`CheckPreRegistrationAncestryDeps.isShallowRepository`), not a real
 * throwaway shallow clone under the OS temp directory. This proves the
 * THROW-vs-CONTINUE control flow is unconditionally correct (the function
 * throws BEFORE calling either of the other two injected dependencies, which
 * the test also asserts) but does NOT by itself prove that
 * `git rev-parse --is-shallow-repository`'s real output correctly detects an
 * arbitrary shallow clone on every host/git-version combination — that
 * narrower claim is additionally covered here because THIS repository's own
 * checkout happens to be genuinely shallow (see above), giving the real,
 * non-injected code path a true-branch exercise for free, without this
 * suite needing to construct and tear down a second git repository.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  checkPreRegistrationAncestry,
  ShallowCloneCannotAnswerAncestryError,
  NoIntroducingCommitFoundError,
} from '../../src/eval/pre-registration-ancestry.js';

const BAR_FILE_PATH = 'packages/llm/tests/eval/bars/decision-bars.v1.json';

/** Resolves the repository toplevel dynamically -- works whether vitest's cwd is the repo root or a package subdirectory (e.g. `packages/llm`, as this suite runs under). */
function repoRoot(): string {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf-8' }).trim();
}

/** Resolves a path's introducing commit directly via git -- the SAME procedure the module under test implements, used here only to construct known-good/known-bad candidate commits for the assertions below, never to duplicate the module's own logic. */
function introducingCommitOf(cwd: string, path: string): string {
  return execFileSync('git', ['log', '--diff-filter=A', '--format=%H', '--reverse', '--', path], {
    cwd,
    encoding: 'utf-8',
  })
    .trim()
    .split('\n')[0]!;
}

describe('checkPreRegistrationAncestry -- the negative control (a check that never reports "violated" has an unknown failure state)', () => {
  it('reports a VIOLATION for a Phase 83 reference-set file, whose introducing commit long precedes the bar file', () => {
    const cwd = repoRoot();
    // Any Phase 83 file will do (per <behavior>) -- the committed wcag-fixes
    // reference set was added well before Phase 85's bar file.
    const phase83Path = 'packages/llm/tests/eval/sets/wcag-fixes.v1.json';
    const phase83Commit = introducingCommitOf(cwd, phase83Path);

    const result = checkPreRegistrationAncestry(cwd, BAR_FILE_PATH, phase83Commit, {
      isShallowRepository: () => false,
    });

    expect(result.holds).toBe(false);
    expect(result.artifactCommit).toBe(phase83Commit);
    expect(result.path).toBe(BAR_FILE_PATH);
    expect(result.introducingCommit).not.toBe(phase83Commit);
  });
});

describe('checkPreRegistrationAncestry -- the positive control (a genuinely post-bar-file commit)', () => {
  it('reports the invariant HOLDS for a file introduced after the bar file (86-01\'s instability.ts)', () => {
    const cwd = repoRoot();
    // instability.ts (86-01) was committed well after the bar file
    // (Phase 85) -- a genuinely post-bar-file path, not the "eval guide"
    // doc named in the plan's own read_first list, which turned out
    // (measured directly, see SUMMARY.md) to PRECEDE the bar file.
    const postBarFilePath = 'packages/llm/src/eval/instability.ts';
    const postBarFileCommit = introducingCommitOf(cwd, postBarFilePath);

    const result = checkPreRegistrationAncestry(cwd, BAR_FILE_PATH, postBarFileCommit, {
      isShallowRepository: () => false,
    });

    expect(result.holds).toBe(true);
    expect(result.artifactCommit).toBe(postBarFileCommit);
  });

  it('the bar file is trivially an ancestor of itself (introducingCommit === artifactCommit)', () => {
    const cwd = repoRoot();
    const barCommit = introducingCommitOf(cwd, BAR_FILE_PATH);
    const result = checkPreRegistrationAncestry(cwd, BAR_FILE_PATH, barCommit, {
      isShallowRepository: () => false,
    });
    expect(result.holds).toBe(true);
    expect(result.introducingCommit).toBe(barCommit);
  });
});

describe('checkPreRegistrationAncestry -- shallow clone: THROWS, never skips, never answers "holds"', () => {
  it('throws ShallowCloneCannotAnswerAncestryError when isShallowRepository reports true, BEFORE calling either other git-backed step', () => {
    const cwd = repoRoot();
    let findIntroducingCommitCalled = false;
    let isAncestorCalled = false;

    expect(() =>
      checkPreRegistrationAncestry(cwd, BAR_FILE_PATH, 'irrelevant-commit-sha', {
        isShallowRepository: () => true,
        findIntroducingCommit: () => {
          findIntroducingCommitCalled = true;
          return 'never-reached';
        },
        isAncestor: () => {
          isAncestorCalled = true;
          return true;
        },
      }),
    ).toThrow(ShallowCloneCannotAnswerAncestryError);

    // The check must not proceed past the shallow-clone gate -- a check that
    // answers ANYTHING (holds true, holds false, or silently continues) on
    // an unanswerable input is worse than one that throws.
    expect(findIntroducingCommitCalled).toBe(false);
    expect(isAncestorCalled).toBe(false);
  });

  it('the thrown error names both the cause and the remedy', () => {
    const cwd = repoRoot();
    let caught: unknown;
    try {
      checkPreRegistrationAncestry(cwd, BAR_FILE_PATH, 'irrelevant-commit-sha', {
        isShallowRepository: () => true,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ShallowCloneCannotAnswerAncestryError);
    const message = (caught as Error).message;
    expect(message).toMatch(/shallow/i);
    expect(message).toMatch(/fetch-depth: 0|git fetch --unshallow/);
  });

  it('the REAL (non-injected) isShallowRepository throws in THIS worktree, which is itself a genuine shallow clone (measured fact, see file header)', () => {
    const cwd = repoRoot();
    expect(() => checkPreRegistrationAncestry(cwd, BAR_FILE_PATH, 'irrelevant-commit-sha')).toThrow(
      ShallowCloneCannotAnswerAncestryError,
    );
  });
});

describe('checkPreRegistrationAncestry -- never mutates, never writes', () => {
  it('leaves HEAD and the working tree unchanged after a real (non-injected-shallow) run', () => {
    const cwd = repoRoot();
    const headBefore = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf-8' }).trim();
    const statusBefore = execFileSync('git', ['status', '--short'], { cwd, encoding: 'utf-8' });

    const postBarFileCommit = introducingCommitOf(cwd, 'packages/llm/src/eval/instability.ts');
    checkPreRegistrationAncestry(cwd, BAR_FILE_PATH, postBarFileCommit, {
      isShallowRepository: () => false,
    });

    const headAfter = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf-8' }).trim();
    const statusAfter = execFileSync('git', ['status', '--short'], { cwd, encoding: 'utf-8' });
    expect(headAfter).toBe(headBefore);
    expect(statusAfter).toBe(statusBefore);
  });
});

describe('checkPreRegistrationAncestry -- a mistyped/never-committed path is refused, never treated as "holds"', () => {
  it('throws NoIntroducingCommitFoundError for a path with no introducing commit', () => {
    const cwd = repoRoot();
    expect(() =>
      checkPreRegistrationAncestry(cwd, 'packages/llm/does/not/exist.json', 'HEAD', {
        isShallowRepository: () => false,
      }),
    ).toThrow(NoIntroducingCommitFoundError);
  });
});
