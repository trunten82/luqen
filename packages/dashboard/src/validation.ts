export interface ValidationResult {
  readonly valid: boolean;
  readonly error?: string;
}

/**
 * Quick 261013-dr7 (WR-04): names starting with "api-key" (any case) are reserved. API keys are
 * recorded as the actor `api-key` / `api-key:<key id>`; an account named like that would read as a
 * key wherever only the display name is shown. Shared by every user-create path (REST, setup,
 * GraphQL, MCP dashboard_create_user).
 */
export function isReservedUsername(username: string): boolean {
  return username.toLowerCase().startsWith('api-key');
}

export const RESERVED_USERNAME_ERROR = 'Usernames starting with "api-key" are reserved.';

export function validateUsername(username: string): ValidationResult {
  if (username.length < 3) return { valid: false, error: 'Username must be at least 3 characters.' };
  if (username.length > 64) return { valid: false, error: 'Username must be at most 64 characters.' };
  if (!/^[a-zA-Z0-9._-]+$/.test(username)) return { valid: false, error: 'Username may only contain letters, numbers, dots, underscores, and hyphens.' };
  if (/^[._-]/.test(username)) return { valid: false, error: 'Username must start with a letter or number.' };
  if (isReservedUsername(username)) return { valid: false, error: RESERVED_USERNAME_ERROR };
  return { valid: true };
}

export function validatePassword(password: string): ValidationResult {
  if (password.length < 8) return { valid: false, error: 'Password must be at least 8 characters.' };
  if (!/[A-Z]/.test(password)) return { valid: false, error: 'Password must contain at least one uppercase letter.' };
  if (!/[a-z]/.test(password)) return { valid: false, error: 'Password must contain at least one lowercase letter.' };
  if (!/[0-9]/.test(password)) return { valid: false, error: 'Password must contain at least one number.' };
  if (!/[^a-zA-Z0-9]/.test(password)) return { valid: false, error: 'Password must contain at least one special character.' };
  return { valid: true };
}
