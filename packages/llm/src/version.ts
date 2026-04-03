import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function loadVersion(): string {
  try {
    const __dirname = fileURLToPath(new URL('.', import.meta.url));
    const pkgPath = resolve(join(__dirname, '..', 'package.json'));
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
      version?: string;
    };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const VERSION = loadVersion();
