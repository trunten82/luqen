/**
 * Abstraction for file system operations used by the source mapper.
 * Implementations exist for local filesystem and remote git host APIs.
 */
export interface FileReader {
  /** Check if a file exists at the given path (relative to repo root). */
  exists(path: string): Promise<boolean>;
  /** Read file content as UTF-8 string. Returns null if not found. */
  read(path: string): Promise<string | null>;
  /** List entries in a directory. Returns filenames (not full paths). */
  list(path: string): Promise<readonly string[]>;
}

/**
 * FileReader backed by the local filesystem.
 * Paths are resolved relative to `repoPath`.
 */
export class LocalFileReader implements FileReader {
  constructor(private readonly repoPath: string) {}

  async exists(path: string): Promise<boolean> {
    const { access } = await import('node:fs/promises');
    const { join } = await import('node:path');
    try {
      await access(join(this.repoPath, path));
      return true;
    } catch {
      return false;
    }
  }

  async read(path: string): Promise<string | null> {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    try {
      return await readFile(join(this.repoPath, path), 'utf-8');
    } catch {
      return null;
    }
  }

  async list(path: string): Promise<readonly string[]> {
    const { readdir } = await import('node:fs/promises');
    const { join } = await import('node:path');
    try {
      const entries = await readdir(join(this.repoPath, path));
      return entries;
    } catch {
      return [];
    }
  }
}
