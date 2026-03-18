export interface ValidationResult {
  readonly valid: boolean;
  readonly error?: string;
}

export function validateUsername(username: string): ValidationResult {
  if (username.length < 3) return { valid: false, error: 'Username must be at least 3 characters.' };
  if (username.length > 64) return { valid: false, error: 'Username must be at most 64 characters.' };
  if (!/^[a-zA-Z0-9._-]+$/.test(username)) return { valid: false, error: 'Username may only contain letters, numbers, dots, underscores, and hyphens.' };
  if (/^[._-]/.test(username)) return { valid: false, error: 'Username must start with a letter or number.' };
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
