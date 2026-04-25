import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { collectPartials } from '../src/server.js';

const viewsDir = resolve(join(__dirname, '..', 'src', 'views'));

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (entry.endsWith('.hbs')) out.push(p);
  }
  return out;
}

const PARTIAL_REF_RE = /\{\{>\s*([a-z][a-z0-9-]*)/gi;

describe('handlebars partials integrity', () => {
  it('auto-discovery registers every .hbs from partials directories', () => {
    const partials = collectPartials(viewsDir);
    expect(partials['agent-drawer']).toBe('partials/agent-drawer.hbs');
    expect(partials['agent-history-panel']).toBe('partials/agent-history-panel.hbs');
    expect(partials['service-connection-row']).toBe('admin/partials/service-connection-row.hbs');
    const onDisk = readdirSync(join(viewsDir, 'partials'))
      .filter((f) => f.endsWith('.hbs'))
      .map((f) => f.slice(0, -'.hbs'.length));
    for (const name of onDisk) {
      expect(partials, `partial '${name}' missing from auto-discovery`).toHaveProperty(name);
    }
  });

  it('every {{> partial}} reference in views resolves to a registered partial', () => {
    const partials = collectPartials(viewsDir);
    const referenced = new Set<string>();
    for (const file of walk(viewsDir)) {
      const src = readFileSync(file, 'utf-8');
      let m: RegExpExecArray | null;
      while ((m = PARTIAL_REF_RE.exec(src)) !== null) {
        referenced.add(m[1]);
      }
    }
    const missing: string[] = [];
    for (const name of referenced) {
      if (!(name in partials)) missing.push(name);
    }
    expect(
      missing,
      `Templates reference partials that do not exist on disk: ${missing.join(', ')}`,
    ).toEqual([]);
  });
});
