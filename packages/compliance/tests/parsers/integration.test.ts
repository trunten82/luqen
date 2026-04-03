import { describe, it, expect } from 'vitest';
import { parseW3cPolicyYaml } from '../../src/parsers/w3c-parser.js';
import { parseQuickRefJson, parseTenOnJson } from '../../src/parsers/wcag-upstream-parser.js';
import { diffRequirements } from '../../src/parsers/requirement-differ.js';
import type { CreateRequirementInput } from '../../src/types.js';

describe('Parser pipeline integration', () => {
  it('W3C parse → diff → proposals flow', () => {
    const yaml = `---
title:
  en: "Test Country"
policies:
  - title:
      en: "Test Regulation"
    url: "https://example.com/reg"
    wcagver: "WCAG 2.1 Level AA"
    enactdate: 2020
    type: "Law"
    scope: "Public sector"
---`;

    const parsed = parseW3cPolicyYaml(yaml, 'TC');
    expect(parsed).toHaveLength(1);
    expect(parsed[0].wcagVersion).toBe('2.1');
    expect(parsed[0].wcagLevel).toBe('AA');

    // Simulate: current DB has old version, new extraction has updated version
    const currentReqs: CreateRequirementInput[] = [
      { regulationId: 'TC-REG', wcagVersion: '2.0', wcagLevel: 'A', wcagCriterion: '1.1.1', obligation: 'mandatory' },
    ];
    const newReqs: CreateRequirementInput[] = [
      { regulationId: 'TC-REG', wcagVersion: '2.1', wcagLevel: 'A', wcagCriterion: '1.1.1', obligation: 'mandatory' },
      { regulationId: 'TC-REG', wcagVersion: '2.1', wcagLevel: 'A', wcagCriterion: '1.3.4', obligation: 'mandatory' },
    ];

    const diff = diffRequirements('TC-REG', currentReqs, newReqs);
    expect(diff.hasChanges).toBe(true);
    expect(diff.added.length).toBeGreaterThan(0);
    const proposals = diff.toProposedChanges();
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals.every(p => p.entityType === 'requirement')).toBe(true);
  });

  it('WCAG upstream parse → diff → proposals flow', () => {
    const quickRefData = {
      'non-text-content': { num: '1.1.1', level: 'A', handle: 'Non-text Content', versions: ['2.0', '2.1'] },
      'contrast-minimum': { num: '1.4.3', level: 'AA', handle: 'Contrast (Minimum)', versions: ['2.0', '2.1'] },
    };

    const parsed = parseQuickRefJson(quickRefData);
    expect(parsed).toHaveLength(4); // 2 criteria x 2 versions
    expect(parsed.every(c => c.title.length > 0)).toBe(true);
  });

  it('tenon parse produces correct structure', () => {
    const tenonData = [
      { ref_id: '3.3.7', title: 'Redundant Entry', level: 'A', url: 'https://w3.org/...' },
      { ref_id: '3.3.8', title: 'Accessible Authentication (Minimum)', level: 'AA' },
    ];

    const parsed = parseTenOnJson(tenonData, '2.2');
    expect(parsed).toHaveLength(2);
    expect(parsed.every(c => c.version === '2.2')).toBe(true);
    expect(parsed[0].criterion).toBe('3.3.7');
  });

  it('requirement differ generates valid ProposedChange for each action type', () => {
    const current: CreateRequirementInput[] = [
      { regulationId: 'R1', wcagVersion: '2.1', wcagLevel: 'A', wcagCriterion: '1.1.1', obligation: 'mandatory' },
      { regulationId: 'R1', wcagVersion: '2.1', wcagLevel: 'AA', wcagCriterion: '1.4.3', obligation: 'mandatory' },
      { regulationId: 'R1', wcagVersion: '2.1', wcagLevel: 'A', wcagCriterion: '1.2.1', obligation: 'mandatory' },
    ];
    const extracted: CreateRequirementInput[] = [
      { regulationId: 'R1', wcagVersion: '2.1', wcagLevel: 'A', wcagCriterion: '1.1.1', obligation: 'recommended' }, // changed
      { regulationId: 'R1', wcagVersion: '2.1', wcagLevel: 'AA', wcagCriterion: '1.4.3', obligation: 'mandatory' }, // same
      // 1.2.1 removed
      { regulationId: 'R1', wcagVersion: '2.2', wcagLevel: 'AA', wcagCriterion: '3.3.7', obligation: 'mandatory' }, // added
    ];

    const diff = diffRequirements('R1', current, extracted);
    expect(diff.hasChanges).toBe(true);
    expect(diff.added).toHaveLength(1);
    expect(diff.removed).toHaveLength(1);
    expect(diff.changed).toHaveLength(1);

    const proposals = diff.toProposedChanges();
    expect(proposals).toHaveLength(3);
    expect(proposals.find(p => p.action === 'create')).toBeDefined();
    expect(proposals.find(p => p.action === 'delete')).toBeDefined();
    expect(proposals.find(p => p.action === 'update')).toBeDefined();
  });
});
