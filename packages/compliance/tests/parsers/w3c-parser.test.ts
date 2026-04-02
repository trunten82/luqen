import { describe, it, expect } from 'vitest';
import { parseW3cPolicyYaml } from '../../src/parsers/w3c-parser.js';

const SAMPLE_YAML = `---
title:
  en: "Germany"
updated: 2023-10-15
policies:
  - title:
      en: "BITV 2.0"
    url: "https://www.gesetze-im-internet.de/bitv_2_0/"
    wcagver: "WCAG 2.1"
    enactdate: 2019
    type: "Procurement law"
    scope: "Public sector"
    webonly: "yes"
  - title:
      en: "BGG"
    url: "https://www.gesetze-im-internet.de/bgg/"
    wcagver: "WCAG 2.1 derivative"
    enactdate: 2002
    type: "Non-discrimination law"
    scope: "Public sector"
    webonly: "no"
---`;

describe('parseW3cPolicyYaml', () => {
  it('extracts regulations from YAML frontmatter', () => {
    const result = parseW3cPolicyYaml(SAMPLE_YAML, 'DE');
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('BITV 2.0');
    expect(result[0].wcagVersion).toBe('2.1');
    expect(result[0].jurisdictionId).toBe('DE');
  });

  it('defaults to WCAG 2.1 AA when version not specified', () => {
    const yaml = `---\npolicies:\n  - title:\n      en: "Test"\n---`;
    const result = parseW3cPolicyYaml(yaml, 'XX');
    expect(result[0].wcagVersion).toBe('2.1');
    expect(result[0].wcagLevel).toBe('AA');
  });

  it('handles derivative WCAG versions', () => {
    const result = parseW3cPolicyYaml(SAMPLE_YAML, 'DE');
    const bgg = result.find(r => r.name === 'BGG');
    expect(bgg?.wcagVersion).toBe('2.1');
  });

  it('normalizes scope values', () => {
    const result = parseW3cPolicyYaml(SAMPLE_YAML, 'DE');
    expect(result[0].scope).toBe('public');
  });

  it('returns empty array for content without frontmatter', () => {
    expect(parseW3cPolicyYaml('no frontmatter here', 'XX')).toEqual([]);
  });

  it('parses explicit WCAG level', () => {
    const yaml = `---\npolicies:\n  - title:\n      en: "Test"\n    wcagver: "WCAG 2.0 Level A"\n---`;
    const result = parseW3cPolicyYaml(yaml, 'XX');
    expect(result[0].wcagVersion).toBe('2.0');
    expect(result[0].wcagLevel).toBe('A');
  });
});
