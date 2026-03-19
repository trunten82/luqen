import { describe, it, expect } from 'vitest';
import { matchSelectorToSource } from '../../src/source-mapper/element-matcher.js';

describe('matchSelectorToSource', () => {
  it('matches a single img element with high confidence', () => {
    const source = `
<html>
  <body>
    <img src="logo.png" alt="Logo" />
  </body>
</html>`;
    const result = matchSelectorToSource('img', source);
    expect(result.confidence).toBe('high');
    expect(result.line).toBeDefined();
  });

  it('returns low confidence when multiple candidates exist', () => {
    const source = `
<html>
  <body>
    <img src="logo.png" alt="Logo" />
    <img src="banner.png" alt="Banner" />
  </body>
</html>`;
    const result = matchSelectorToSource('img', source);
    expect(result.confidence).toBe('low');
    expect(result.line).toBeDefined();
  });

  it('matches input with high confidence', () => {
    const source = `
<form>
  <label for="name">Name</label>
  <input type="text" id="name" />
</form>`;
    const result = matchSelectorToSource('input#name', source);
    expect(result.confidence).toBe('high');
    expect(result.line).toBeDefined();
  });

  it('returns none when selector element not found in source', () => {
    const source = `
<html>
  <body>
    <p>Hello world</p>
  </body>
</html>`;
    const result = matchSelectorToSource('table', source);
    expect(result.confidence).toBe('none');
    expect(result.line).toBeUndefined();
  });

  it('extracts element from complex CSS selector', () => {
    const source = `
<nav>
  <ul>
    <li><a href="/home">Home</a></li>
  </ul>
</nav>`;
    const result = matchSelectorToSource('div > ul > li > a', source);
    expect(result.confidence).toBe('high');
    expect(result.line).toBeDefined();
  });
});
