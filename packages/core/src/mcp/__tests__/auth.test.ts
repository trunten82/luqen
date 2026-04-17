import { describe, it, expect } from 'vitest';
import { extractToolContext } from '../auth.js';

// Fastify request shape is large; tests only need tokenPayload/orgId/authType/permissions.
// We cast a plain object to the minimum structural type expected by extractToolContext.
type FakeRequest = {
  tokenPayload?: {
    readonly sub: string;
    readonly scopes: readonly string[];
    readonly orgId?: string;
  };
  orgId?: string;
  authType?: string;
  permissions?: Set<string>;
};

function makeRequest(overrides: Partial<FakeRequest>): FakeRequest {
  return { ...overrides };
}

describe('extractToolContext', () => {
  it('Test 5: throws documented error when tokenPayload is absent', () => {
    const req = makeRequest({});
    expect(() => extractToolContext(req as never)).toThrowError(
      'MCP request reached tool dispatch without authenticated tokenPayload — check preHandler order',
    );
  });

  it('Test 6: JWT request returns orgId=request.orgId, userId=tokenPayload.sub, authType=jwt', () => {
    const req = makeRequest({
      tokenPayload: { sub: 'user-123', scopes: ['read', 'write'], orgId: 'org-ignored-in-favour-of-request-orgId' },
      orgId: 'org-resolved-by-middleware',
      authType: 'jwt',
    });
    const ctx = extractToolContext(req as never);
    expect(ctx.orgId).toBe('org-resolved-by-middleware');
    expect(ctx.userId).toBe('user-123');
    expect(ctx.authType).toBe('jwt');
    expect([...ctx.scopes]).toEqual(['read', 'write']);
  });

  it('Test 7: copies tokenPayload.scopes so payload mutation does not leak through context', () => {
    const originalScopes = ['read'];
    const req = makeRequest({
      tokenPayload: { sub: 'user-42', scopes: originalScopes, orgId: 'org-42' },
      orgId: 'org-42',
      authType: 'jwt',
    });
    const ctx = extractToolContext(req as never);
    expect([...ctx.scopes]).toEqual(['read']);
    // Attempt to mutate the underlying scopes array through its non-readonly reference.
    // The context's copy must stay intact.
    (originalScopes as string[]).push('admin');
    expect([...ctx.scopes]).toEqual(['read']);
  });

  it("defaults orgId to 'system' when request.orgId is missing", () => {
    const req = makeRequest({
      tokenPayload: { sub: 'api-key', scopes: ['read', 'write', 'admin'] },
      authType: 'apikey',
    });
    const ctx = extractToolContext(req as never);
    expect(ctx.orgId).toBe('system');
    expect(ctx.authType).toBe('apikey');
  });

  it('propagates permissions set from request.permissions', () => {
    const perms = new Set<string>(['compliance.view', 'reports.view']);
    const req = makeRequest({
      tokenPayload: { sub: 'user-9', scopes: ['read'], orgId: 'org-9' },
      orgId: 'org-9',
      authType: 'jwt',
      permissions: perms,
    });
    const ctx = extractToolContext(req as never);
    expect(ctx.permissions.has('compliance.view')).toBe(true);
    expect(ctx.permissions.has('reports.view')).toBe(true);
    expect(ctx.permissions.size).toBe(2);
  });

  it('returns empty permissions set when request.permissions is absent', () => {
    const req = makeRequest({
      tokenPayload: { sub: 'user-10', scopes: ['read'], orgId: 'org-10' },
      orgId: 'org-10',
      authType: 'jwt',
    });
    const ctx = extractToolContext(req as never);
    expect(ctx.permissions.size).toBe(0);
  });
});
