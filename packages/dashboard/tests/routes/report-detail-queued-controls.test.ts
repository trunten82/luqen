/**
 * The queued branch of the report page wraps its retry and cancel buttons in one
 * `scanControls` block. Reads the template source: the rendered output is the same
 * either way, so the structure is the thing under test.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const TEMPLATE = join(__dirname, '..', '..', 'src', 'views', 'report-detail.hbs');

function queuedBranch(source: string): string {
  const start = source.indexOf("{{else if (eq scan.status 'queued')}}");
  expect(start, 'the queued branch must be found').toBeGreaterThanOrEqual(0);
  const end = source.indexOf('{{else}}', start + 1);
  expect(end, 'the queued branch must end at the next else').toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('report page queued branch', () => {
  it('report page: the queued branch has one scanControls block holding both buttons', () => {
    const branch = queuedBranch(readFileSync(TEMPLATE, 'utf8'));

    expect(branch.match(/\{\{#if scanControls\}\}/g) ?? []).toHaveLength(1);
    const block = branch.slice(branch.indexOf('{{#if scanControls}}'), branch.indexOf('{{/if}}'));
    expect(block).toContain('/retry"');
    expect(block).toContain('/cancel"');
  });

  it('report page: the queued branch matcher can see a split block', () => {
    const split = "{{else if (eq scan.status 'queued')}}{{#if scanControls}}a{{/if}}{{#if scanControls}}b{{/if}}{{else}}";
    expect(queuedBranch(split).match(/\{\{#if scanControls\}\}/g) ?? []).toHaveLength(2);
  });
});
