/**
 * `pre-registration-ancestry.ts` — the checkable ordering invariant the bar
 * file itself specifies (Phase 86 Task 3).
 *
 * `packages/llm/tests/eval/bars/decision-bars.v1.json`'s own
 * `preRegistrationGuarantee.verificationProcedure` records the procedure
 * this module implements EXACTLY, so the invariant is checkable by anyone,
 * in CI, without trusting a claim in any file:
 *
 *   1. Find the bar file's introducing commit:
 *      `git log --diff-filter=A --format=%H --reverse -- <bar path> | head -1`
 *   2. For any candidate baseline/verdict artifact commit, run
 *      `git merge-base --is-ancestor <introducing-commit> <candidate-commit>`
 *      and read the exit code — 0 means the invariant holds, non-zero (1)
 *      means it was violated (the bar was edited or created after a
 *      measurement, and must no longer be trusted as a pre-registration).
 *
 * A CHECK THAT CANNOT ANSWER MUST NOT ANSWER. `.github/workflows/ci.yml`'s
 * `actions/checkout@v4` step carries no `fetch-depth`, so the default of 1
 * applies and CI runs against a SHALLOW clone by default — a shallow clone
 * cannot answer `git merge-base --is-ancestor` (the object graph it needs is
 * simply not present) and would otherwise produce a confident wrong answer
 * or, worse, silently skip the check. This module detects a shallow
 * repository FIRST and THROWS a named error naming the cause and the fix,
 * rather than returning "holds" or quietly doing nothing — a skipped guard
 * and a passing guard are the same observation from the outside, and this
 * codebase has already been bitten by a check that could not fail (see
 * `run-manifest.ts`'s recorded warning against an inert exhaustiveness
 * guard).
 *
 * Uses `node:child_process`'s `execFileSync` with an EXPLICIT argument array
 * and an EXPLICIT `cwd` — never a shell string a path could be interpolated
 * into. Every git subcommand this module runs is READ-ONLY
 * (`rev-parse --is-shallow-repository`, `log --diff-filter=A`,
 * `merge-base --is-ancestor`); it never mutates the repository and never
 * runs a git subcommand that writes.
 *
 * CONTRACT: `cwd` must be the git repository's TOPLEVEL directory (e.g. the
 * result of `git rev-parse --show-toplevel`), and `barFilePath` must be a
 * path RELATIVE TO THAT TOPLEVEL — exactly the form the bar file's own
 * `verificationProcedure` documents and exactly what a maintainer would type
 * running the procedure by hand from the repository root. This module does
 * not resolve `cwd` itself; that is the caller's responsibility (dependency
 * injection point — see `CheckPreRegistrationAncestryDeps`).
 */
import { execFileSync } from 'node:child_process';
import type { SpawnSyncReturns } from 'node:child_process';

/**
 * Thrown when the repository at `cwd` is a shallow clone. The message names
 * both the cause (the specific git commands that cannot answer on a shallow
 * clone) and the remedy (fetch full history, or set `fetch-depth: 0` in CI).
 */
export class ShallowCloneCannotAnswerAncestryError extends Error {
  constructor() {
    super(
      'This is a shallow git clone (`git rev-parse --is-shallow-repository` returned true) and cannot answer a pre-registration ancestry question -- `git log --diff-filter=A` and `git merge-base --is-ancestor` both require full object history to answer correctly, not merely to exit successfully. Fix: run `git fetch --unshallow` locally, or set `fetch-depth: 0` on the `actions/checkout` step in CI.',
    );
    this.name = 'ShallowCloneCannotAnswerAncestryError';
  }
}

/** Thrown when `git log --diff-filter=A --reverse -- <path>` finds no commit that adds `path` -- a mistyped or never-committed path, never silently treated as "holds". */
export class NoIntroducingCommitFoundError extends Error {
  constructor(public readonly path: string) {
    super(
      `No commit was found that adds "${path}" -- \`git log --diff-filter=A --reverse -- ${path}\` returned nothing.`,
    );
    this.name = 'NoIntroducingCommitFoundError';
  }
}

export interface PreRegistrationAncestryResult {
  /** The bar file's own introducing commit -- found dynamically, never hardcoded (a self-referential SHA would be wrong the moment it was written, per the bar file's own `noSelfReferentialShaNote`). */
  readonly introducingCommit: string;
  /** The candidate baseline/verdict artifact commit the caller is checking. */
  readonly artifactCommit: string;
  readonly path: string;
  /** `true` iff the introducing commit is an ancestor of the artifact commit -- the invariant HOLDS. `false` means it was VIOLATED. */
  readonly holds: boolean;
}

function isShallowRepository(cwd: string): boolean {
  const out = execFileSync('git', ['rev-parse', '--is-shallow-repository'], {
    cwd,
    encoding: 'utf-8',
  }).trim();
  return out === 'true';
}

function findIntroducingCommit(cwd: string, path: string): string {
  const out = execFileSync(
    'git',
    ['log', '--diff-filter=A', '--format=%H', '--reverse', '--', path],
    { cwd, encoding: 'utf-8' },
  ).trim();
  const first = out.split('\n')[0];
  if (!first) {
    throw new NoIntroducingCommitFoundError(path);
  }
  return first;
}

/**
 * `git merge-base --is-ancestor A B` exits 0 when A is an ancestor of B, 1
 * when it is NOT (a NORMAL, expected outcome -- this IS the check's negative
 * control, not an execution failure), and something else entirely if the
 * command itself could not run (e.g. an unresolvable object). Only status 1
 * is treated as "does not hold"; any other non-zero exit re-throws, so a
 * genuine execution failure is never silently read as "violated".
 */
function isAncestor(cwd: string, ancestorCommit: string, descendantCommit: string): boolean {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestorCommit, descendantCommit], { cwd });
    return true;
  } catch (err) {
    const status = (err as Partial<SpawnSyncReturns<Buffer>>)?.status;
    if (status === 1) return false;
    throw err;
  }
}

/**
 * Dependency-injection point for tests -- lets the shallow-clone THROW be
 * exercised without requiring an actual throwaway shallow git clone (see
 * `pre-registration-ancestry.test.ts` for which choice was made and what it
 * does and does not prove). Defaults to the real git-backed implementations
 * for every field; a caller (or test) overriding one field still exercises
 * the real ones for the others.
 */
export interface CheckPreRegistrationAncestryDeps {
  readonly isShallowRepository?: (cwd: string) => boolean;
  readonly findIntroducingCommit?: (cwd: string, path: string) => string;
  readonly isAncestor?: (cwd: string, ancestorCommit: string, descendantCommit: string) => boolean;
}

/**
 * Implements the bar file's own `preRegistrationGuarantee.verificationProcedure`
 * exactly. Detects a shallow clone FIRST and throws rather than proceeding
 * (see this module's own doc comment); never mutates the repository.
 */
export function checkPreRegistrationAncestry(
  cwd: string,
  barFilePath: string,
  artifactCommit: string,
  deps: CheckPreRegistrationAncestryDeps = {},
): PreRegistrationAncestryResult {
  const shallowCheck = deps.isShallowRepository ?? isShallowRepository;
  const introducingCommitFinder = deps.findIntroducingCommit ?? findIntroducingCommit;
  const ancestorChecker = deps.isAncestor ?? isAncestor;

  if (shallowCheck(cwd)) {
    throw new ShallowCloneCannotAnswerAncestryError();
  }

  const introducingCommit = introducingCommitFinder(cwd, barFilePath);
  const holds = ancestorChecker(cwd, introducingCommit, artifactCommit);

  return { introducingCommit, artifactCommit, path: barFilePath, holds };
}
