export const SCOPES = ['read', 'write', 'admin'] as const;
export type Scope = (typeof SCOPES)[number];

const SCOPE_HIERARCHY: Record<Scope, readonly Scope[]> = {
  admin: ['read', 'write', 'admin'],
  write: ['read', 'write'],
  read: ['read'],
};

export function hasScope(
  tokenScopes: readonly string[],
  required: string,
): boolean {
  return tokenScopes.includes(required);
}

export function scopeCoversEndpoint(
  tokenScopes: readonly string[],
  requiredScope: Scope,
): boolean {
  for (const scope of tokenScopes) {
    const covered = SCOPE_HIERARCHY[scope as Scope];
    if (covered && covered.includes(requiredScope)) {
      return true;
    }
  }
  return false;
}

export function validateScopes(scopes: readonly string[]): boolean {
  if (scopes.length === 0) {
    return false;
  }
  return scopes.every((s) => (SCOPES as readonly string[]).includes(s));
}
