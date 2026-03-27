import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Compute a deterministic SHA-256 checksum over all files in a directory.
 *
 * Files are sorted by relative path to ensure deterministic output regardless
 * of filesystem ordering. The hash covers both path names and file contents.
 *
 * Returns a hex-encoded SHA-256 hash string.
 */
export function computeDirectoryChecksum(dirPath: string): string {
  const files = collectFiles(dirPath);
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  const hash = createHash('sha256');
  for (const file of files) {
    // Include the path in the hash to detect renames/moves
    hash.update(file.relativePath);
    hash.update(file.content);
  }

  return hash.digest('hex');
}

interface FileEntry {
  readonly relativePath: string;
  readonly content: Buffer;
}

function collectFiles(dirPath: string, basePath?: string): FileEntry[] {
  const base = basePath ?? dirPath;
  const entries: FileEntry[] = [];

  for (const name of readdirSync(dirPath)) {
    // Skip node_modules and hidden dirs
    if (name === 'node_modules' || name.startsWith('.')) continue;

    const fullPath = join(dirPath, name);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      entries.push(...collectFiles(fullPath, base));
    } else if (stat.isFile()) {
      entries.push({
        relativePath: relative(base, fullPath),
        content: readFileSync(fullPath),
      });
    }
  }

  return entries;
}
