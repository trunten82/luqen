/**
 * HARD-21: the page a sign-in returns to (returnTo) is used only when it is a path of the dashboard.
 *
 * safeReturnTo answers `/` (the home page) for a value that is not a string or is empty, that holds an
 * ASCII control character or a backslash anywhere, that does not start with `/`, that resolves against a
 * fixed base to another origin, or whose resolved path starts with two slashes. Otherwise it answers
 * the resolved path with its query and fragment. Every answer is checked the way a browser reads a
 * Location: resolved against the dashboard's own sign-in page, it must stay on the dashboard's origin.
 */
import { describe, expect, it } from 'vitest';
import { safeReturnTo, staleSignInTarget } from '../../src/routes/auth.js';

const DASHBOARD = 'https://dashboard.example.com';
const SIGN_IN_PAGE = `${DASHBOARD}/login`;

/** The origin a browser reaches when it follows `location` from the dashboard's sign-in page. */
const originOf = (location: string): string => new URL(location, SIGN_IN_PAGE).origin;

function expectHome(values: readonly unknown[]): void {
  for (const value of values) {
    const answer = safeReturnTo(value);
    expect(answer, JSON.stringify(value)).toBe('/');
    expect(originOf(answer), JSON.stringify(value)).toBe(DASHBOARD);
  }
}

describe('HARD-21 sign in return targets', () => {
  it('HARD-21 a return target holding a control character goes to the home page', () => {
    expectHome(['/x\ty', '/reports\n', '/\t/evil.example/x', '/\n/evil.example/x', '/\r/evil.example/x', '/x\u0000y', '/x\u001fy', '/x\u007fy']);
  });

  it('HARD-21 a return target holding a backslash goes to the home page', () => {
    expectHome(['/\\evil.example/x', '/x\\y', '/reports\\']);
  });

  it('HARD-21 a return target that is not a path of the dashboard goes to the home page', () => {
    expectHome(['//evil.example/x', 'https://evil.example/x', 'evil.example/x', ' /account', '', undefined, 42]);
  });

  it('HARD-21 a return target whose resolved path names another host goes to the home page', () => {
    expectHome(['/..//evil.example/x', '/.//evil.example/x', '/%2e%2e//evil.example/x', '/a/..//evil.example/x']);
  });

  it('HARD-21 a return target that is a path of the dashboard keeps its query and fragment', () => {
    const kept = ['/', '/account', '/reports?x=1#h', '/oauth/authorize?client_id=xyz&scope=read', '/%09/evil.example/x'];
    for (const value of kept) {
      const answer = safeReturnTo(value);
      expect(answer, value).toBe(value);
      expect(safeReturnTo(answer), value).toBe(answer);
      expect(originOf(answer), value).toBe(DASHBOARD);
      expect(staleSignInTarget(true, value), value).toBe(value);
    }
    expect(staleSignInTarget(false, '/reports?x=1#h')).toBe('/login?stale=1&returnTo=%2Freports%3Fx%3D1%23h');
  });
});
