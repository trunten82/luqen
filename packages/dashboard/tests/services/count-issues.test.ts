import { describe, it, expect } from 'vitest';
import { countIssues } from '../../src/services/count-issues.js';
import { flattenIssueOccurrences } from '../../src/services/issue-occurrences.js';

// Every fixture is a factory: a mutation in one test can never leak into another.

const URLS = ['https://example.com/a', 'https://example.com/b', 'https://example.com/c'];

interface Iss {
  type?: string;
  code: string;
  message: string;
  selector: string;
  context: string;
}

function iss(code: string, type?: string, selector = '#x', context = `<${code}>`): Iss {
  return { ...(type !== undefined ? { type } : {}), code, message: code, selector, context };
}

/** The finding that sits on 3 pages and is therefore a template issue. */
function templateFinding(): Iss {
  return iss('TPL', 'warning', '.nav a', '<a class="nav">');
}

function ownIssues(): Iss[][] {
  return [
    [iss('E1', 'error'), iss('N1', 'notice')],
    [iss('E2', 'error')],
    [iss('W1', 'warning'), iss('I1', 'info')],
  ];
}

/** Un-deduplicated report: the template finding on every page, no templateIssues. */
function plainReport() {
  return {
    pages: URLS.map((url, i) => ({
      url,
      issueCount: ownIssues()[i].length + 1,
      issues: [...ownIssues()[i], templateFinding()],
    })),
  };
}

function templateIssues() {
  return [{ ...templateFinding(), affectedPages: [...URLS] }];
}

/** Core shape: pages keep every occurrence AND templateIssues lists the fingerprint. */
function coreShapeReport() {
  return { ...plainReport(), templateIssues: templateIssues() };
}

/** Dashboard dedup shape: template occurrences STRIPPED from pages, held in templateIssues. */
function dedupShapeReport() {
  return {
    pages: URLS.map((url, i) => ({ url, issueCount: ownIssues()[i].length, issues: ownIssues()[i] })),
    templateIssues: templateIssues(),
  };
}

// plain report: errors 2, warnings 1 + 3 template, notices 1 info + 1 notice = 2
const EXPECTED = { errors: 2, warnings: 4, notices: 2, total: 8 };

describe('countIssues', () => {
  it('counts a plain report with no templateIssues', () => {
    expect(countIssues(plainReport())).toEqual(EXPECTED);
  });

  it('core shape (pages whole + templateIssues) does not double count the template occurrences', () => {
    expect(countIssues(coreShapeReport())).toEqual(EXPECTED);
  });

  it('dashboard dedup shape (pages stripped + templateIssues) does not drop the template occurrences', () => {
    expect(countIssues(dedupShapeReport())).toEqual(EXPECTED);
  });

  it('equals flattenIssueOccurrences(...).length per level for both shapes', () => {
    for (const report of [coreShapeReport(), dedupShapeReport()]) {
      const rows = flattenIssueOccurrences(report.pages, report.templateIssues);
      const counts = countIssues(report);
      expect(rows.filter((r) => r.issue.type === 'error')).toHaveLength(counts.errors);
      expect(rows.filter((r) => r.issue.type === 'warning')).toHaveLength(counts.warnings);
      expect(rows.filter((r) => r.issue.type !== 'error' && r.issue.type !== 'warning')).toHaveLength(counts.notices);
      expect(rows).toHaveLength(counts.total);
    }
  });

  it('counts unknown and missing types as notices', () => {
    const counts = countIssues({
      pages: [{ url: 'u', issues: [iss('A', 'info'), iss('B'), iss('C', 'notice'), iss('D', 'ERROR')] }],
    });
    expect(counts).toEqual({ errors: 0, warnings: 0, notices: 4, total: 4 });
  });

  it('total is the sum of the three levels', () => {
    const counts = countIssues(plainReport());
    expect(counts.total).toBe(counts.errors + counts.warnings + counts.notices);
  });

  describe('malformed input never throws', () => {
    const ZERO = { errors: 0, warnings: 0, notices: 0, total: 0 };

    it.each([
      ['null', null],
      ['undefined', undefined],
      ['a string', 'not a report'],
      ['a number', 42],
      ['an array', []],
      ['an empty object', {}],
      ['pages not an array', { pages: 'nope' }],
      ['pages containing non-objects', { pages: [null, 7, 'x'] }],
      ['a page without issues', { pages: [{ url: 'u' }] }],
      ['a page whose issues is not an array', { pages: [{ url: 'u', issues: 'nope' }] }],
      ['templateIssues not an array', { pages: [], templateIssues: 'nope' }],
    ])('%s -> zeros', (_name, input) => {
      expect(countIssues(input)).toEqual(ZERO);
    });

    it('drops null / non-object issues and counts the rest', () => {
      const counts = countIssues({ pages: [{ url: 'u', issues: [null, 'x', iss('E', 'error'), 5] }] });
      expect(counts).toEqual({ errors: 1, warnings: 0, notices: 0, total: 1 });
    });

    it('a page without a url still counts its issues', () => {
      expect(countIssues({ pages: [{ issues: [iss('E', 'error')] }] }).errors).toBe(1);
    });
  });
});
