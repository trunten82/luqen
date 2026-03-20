/**
 * Synthetic scenario tests for the compliance package.
 *
 * Scenario 5: Compliance Check Consistency
 * Scenario 6: OAuth Token Lifecycle
 * Scenario 7: Database Adapter Consistency
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '../src/db/sqlite-adapter.js';
import type { DbAdapter } from '../src/db/adapter.js';
import { checkCompliance } from '../src/engine/checker.js';
import { parseIssueCode, extractCriterion, extractLevel } from '../src/engine/matcher.js';
import {
  createTokenSigner,
  createTokenVerifier,
  hashPassword,
  verifyPassword,
  generateClientCredentials,
  hashClientSecret,
  verifyClientSecret,
} from '../src/auth/oauth.js';
import { hasScope, scopeCoversEndpoint, validateScopes } from '../src/auth/scopes.js';
import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose';

// ============================================================================
// Scenario 5: Compliance Check Consistency
// ============================================================================

describe('Scenario 5: Compliance Check Consistency', () => {
  let db: DbAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await db.initialize();
  });

  afterEach(async () => {
    await db.close();
  });

  async function seedJurisdictionWithRegulation(options: {
    jurisdictionId: string;
    jurisdictionName: string;
    regulationId: string;
    regulationName: string;
    shortName: string;
    wcagCriteria: Array<{
      criterion: string;
      level: 'A' | 'AA' | 'AAA';
      obligation: 'mandatory' | 'recommended' | 'optional';
    }>;
  }): Promise<void> {
    await db.createJurisdiction({
      id: options.jurisdictionId,
      name: options.jurisdictionName,
      type: 'country',
    });

    await db.createRegulation({
      id: options.regulationId,
      jurisdictionId: options.jurisdictionId,
      name: options.regulationName,
      shortName: options.shortName,
      reference: 'REF-001',
      url: 'https://example.com/regulation',
      enforcementDate: '2025-01-01',
      status: 'active',
      scope: 'all',
      sectors: [],
      description: 'Test regulation',
    });

    for (const req of options.wcagCriteria) {
      await db.createRequirement({
        regulationId: options.regulationId,
        wcagVersion: '2.1',
        wcagLevel: req.level,
        wcagCriterion: req.criterion,
        obligation: req.obligation,
      });
    }
  }

  it('maps WCAG violations to correct jurisdictions', async () => {
    await seedJurisdictionWithRegulation({
      jurisdictionId: 'EU',
      jurisdictionName: 'European Union',
      regulationId: 'EAA',
      regulationName: 'European Accessibility Act',
      shortName: 'EAA',
      wcagCriteria: [
        { criterion: '1.1.1', level: 'A', obligation: 'mandatory' },
        { criterion: '1.3.1', level: 'A', obligation: 'mandatory' },
      ],
    });

    await seedJurisdictionWithRegulation({
      jurisdictionId: 'US',
      jurisdictionName: 'United States',
      regulationId: 'ADA',
      regulationName: 'Americans with Disabilities Act',
      shortName: 'ADA',
      wcagCriteria: [
        { criterion: '1.1.1', level: 'AA', obligation: 'mandatory' },
      ],
    });

    const result = await checkCompliance(
      {
        jurisdictions: ['EU', 'US'],
        issues: [
          {
            code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
            type: 'error',
            message: 'Missing alt on img',
            selector: 'img.hero',
            context: '<img src="hero.jpg">',
          },
          {
            code: 'WCAG2AA.Principle1.Guideline1_3.1_3_1.H42',
            type: 'error',
            message: 'Missing heading structure',
            selector: 'div.content',
            context: '<div class="content">',
          },
        ],
      },
      db,
    );

    // EU should fail due to both 1.1.1 and 1.3.1 violations
    expect(result.matrix['EU'].status).toBe('fail');
    expect(result.matrix['EU'].mandatoryViolations).toBeGreaterThanOrEqual(2);

    // US should fail due to 1.1.1 violation
    expect(result.matrix['US'].status).toBe('fail');
    expect(result.matrix['US'].mandatoryViolations).toBeGreaterThanOrEqual(1);
  });

  it('classifies confirmed vs needs-review based on issue codes', async () => {
    await seedJurisdictionWithRegulation({
      jurisdictionId: 'UK',
      jurisdictionName: 'United Kingdom',
      regulationId: 'PSBAR',
      regulationName: 'Public Sector Bodies Accessibility Regulations',
      shortName: 'PSBAR',
      wcagCriteria: [
        { criterion: '1.1.1', level: 'A', obligation: 'mandatory' },
        { criterion: '2.4.1', level: 'A', obligation: 'recommended' },
      ],
    });

    const result = await checkCompliance(
      {
        jurisdictions: ['UK'],
        issues: [
          {
            code: 'WCAG2A.Principle1.Guideline1_1.1_1_1.H37',
            type: 'error',
            message: 'Missing alt',
            selector: 'img',
            context: '<img>',
          },
          {
            code: 'WCAG2A.Principle2.Guideline2_4.2_4_1.G1',
            type: 'warning',
            message: 'Bypass blocks',
            selector: 'body',
            context: '<body>',
          },
        ],
      },
      db,
    );

    // 1.1.1 is mandatory, should count as violation
    expect(result.matrix['UK'].mandatoryViolations).toBe(1);
    // 2.4.1 is recommended, should count as recommended
    expect(result.matrix['UK'].recommendedViolations).toBe(1);
    expect(result.matrix['UK'].status).toBe('fail');
  });

  it('returns pass when no issues match any jurisdiction requirements', async () => {
    await seedJurisdictionWithRegulation({
      jurisdictionId: 'JP',
      jurisdictionName: 'Japan',
      regulationId: 'JIS',
      regulationName: 'JIS X 8341-3',
      shortName: 'JIS',
      wcagCriteria: [
        { criterion: '4.1.1', level: 'A', obligation: 'mandatory' },
      ],
    });

    const result = await checkCompliance(
      {
        jurisdictions: ['JP'],
        issues: [
          {
            code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
            type: 'error',
            message: 'Missing alt',
            selector: 'img',
            context: '<img>',
          },
        ],
      },
      db,
    );

    // 1.1.1 is not in Japan's requirements (only 4.1.1 is)
    expect(result.matrix['JP'].status).toBe('pass');
    expect(result.matrix['JP'].mandatoryViolations).toBe(0);
  });

  it('handles issues with unparseable codes gracefully', async () => {
    await seedJurisdictionWithRegulation({
      jurisdictionId: 'DE',
      jurisdictionName: 'Germany',
      regulationId: 'BFSG',
      regulationName: 'Barrierefreiheitsstaerkungsgesetz',
      shortName: 'BFSG',
      wcagCriteria: [
        { criterion: '1.1.1', level: 'A', obligation: 'mandatory' },
      ],
    });

    const result = await checkCompliance(
      {
        jurisdictions: ['DE'],
        issues: [
          {
            code: 'custom-check-no-wcag-pattern',
            type: 'error',
            message: 'Custom check failed',
            selector: '.custom',
            context: '<div>',
          },
        ],
      },
      db,
    );

    // Unparseable code should not match any requirements
    expect(result.matrix['DE'].mandatoryViolations).toBe(0);
    expect(result.matrix['DE'].status).toBe('pass');
    // Issue should still appear in annotated issues
    expect(result.annotatedIssues).toHaveLength(1);
  });
});

// ============================================================================
// Scenario 6: OAuth Token Lifecycle
// ============================================================================

describe('Scenario 6: OAuth Token Lifecycle', () => {
  let privateKeyPem: string;
  let publicKeyPem: string;

  beforeEach(async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256', {
      extractable: true,
    });
    privateKeyPem = await exportPKCS8(privateKey);
    publicKeyPem = await exportSPKI(publicKey);
  });

  it('generates, signs, and verifies a token', async () => {
    const signer = await createTokenSigner(privateKeyPem);
    const verifier = await createTokenVerifier(publicKeyPem);

    const token = await signer({
      sub: 'user-123',
      scopes: ['read', 'write'],
      expiresIn: '1h',
    });

    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3); // JWT format

    const payload = await verifier(token);
    expect(payload.sub).toBe('user-123');
    expect(payload.scopes).toEqual(['read', 'write']);
    expect(payload.iat).toBeDefined();
    expect(payload.exp).toBeDefined();
  });

  it('rejects an expired token', async () => {
    const signer = await createTokenSigner(privateKeyPem);
    const verifier = await createTokenVerifier(publicKeyPem);

    // Create token that expires in 1 second
    const token = await signer({
      sub: 'user-456',
      scopes: ['read'],
      expiresIn: '1s',
    });

    // Wait for expiry
    await new Promise((resolve) => setTimeout(resolve, 1500));

    await expect(verifier(token)).rejects.toThrow();
  });

  it('rejects a token signed with a different key', async () => {
    const { privateKey: otherKey } = await generateKeyPair('RS256', {
      extractable: true,
    });
    const otherPrivatePem = await exportPKCS8(otherKey);

    const signer = await createTokenSigner(otherPrivatePem);
    const verifier = await createTokenVerifier(publicKeyPem);

    const token = await signer({
      sub: 'user-789',
      scopes: ['admin'],
      expiresIn: '1h',
    });

    await expect(verifier(token)).rejects.toThrow();
  });

  it('scope-based access control works correctly', () => {
    // hasScope is a direct check
    expect(hasScope(['read', 'write'], 'read')).toBe(true);
    expect(hasScope(['read'], 'write')).toBe(false);

    // scopeCoversEndpoint respects hierarchy
    expect(scopeCoversEndpoint(['admin'], 'read')).toBe(true);
    expect(scopeCoversEndpoint(['admin'], 'write')).toBe(true);
    expect(scopeCoversEndpoint(['write'], 'read')).toBe(true);
    expect(scopeCoversEndpoint(['read'], 'write')).toBe(false);
    expect(scopeCoversEndpoint(['read'], 'admin')).toBe(false);
  });

  it('validates scope arrays', () => {
    expect(validateScopes(['read'])).toBe(true);
    expect(validateScopes(['read', 'write'])).toBe(true);
    expect(validateScopes(['admin'])).toBe(true);
    expect(validateScopes([])).toBe(false);
    expect(validateScopes(['invalid'])).toBe(false);
    expect(validateScopes(['read', 'invalid'])).toBe(false);
  });

  it('hashes and verifies passwords', async () => {
    const password = 'S3cur3P@ssw0rd!';
    const hash = await hashPassword(password);

    expect(hash).not.toBe(password);
    expect(await verifyPassword(password, hash)).toBe(true);
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
  });

  it('generates unique client credentials', () => {
    const creds1 = generateClientCredentials();
    const creds2 = generateClientCredentials();

    expect(creds1.clientId).toBeTruthy();
    expect(creds1.clientSecret).toBeTruthy();
    expect(creds1.clientId).not.toBe(creds2.clientId);
    expect(creds1.clientSecret).not.toBe(creds2.clientSecret);
  });

  it('hashes and verifies client secrets', async () => {
    const secret = 'my-client-secret';
    const hash = await hashClientSecret(secret);

    expect(await verifyClientSecret(secret, hash)).toBe(true);
    expect(await verifyClientSecret('wrong-secret', hash)).toBe(false);
  });
});

// ============================================================================
// Scenario 7: Database Adapter Consistency
// ============================================================================

describe('Scenario 7: Database Adapter Consistency', () => {
  let db: DbAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await db.initialize();
  });

  afterEach(async () => {
    await db.close();
  });

  describe('Jurisdictions CRUD', () => {
    it('creates, reads, updates, and deletes a jurisdiction', async () => {
      const created = await db.createJurisdiction({
        id: 'TEST-J1',
        name: 'Test Jurisdiction',
        type: 'country',
      });
      expect(created.id).toBe('TEST-J1');
      expect(created.name).toBe('Test Jurisdiction');

      const fetched = await db.getJurisdiction('TEST-J1');
      expect(fetched).not.toBeNull();
      expect(fetched!.name).toBe('Test Jurisdiction');

      const updated = await db.updateJurisdiction('TEST-J1', {
        name: 'Updated Jurisdiction',
      });
      expect(updated.name).toBe('Updated Jurisdiction');

      await db.deleteJurisdiction('TEST-J1');
      expect(await db.getJurisdiction('TEST-J1')).toBeNull();
    });

    it('lists with filters returning correct subsets', async () => {
      await db.createJurisdiction({ id: 'EU', name: 'EU', type: 'supranational' });
      await db.createJurisdiction({ id: 'DE', name: 'Germany', type: 'country', parentId: 'EU' });
      await db.createJurisdiction({ id: 'US', name: 'United States', type: 'country' });

      const countries = await db.listJurisdictions({ type: 'country' });
      expect(countries).toHaveLength(2);
      expect(countries.every((j) => j.type === 'country')).toBe(true);

      const supranational = await db.listJurisdictions({ type: 'supranational' });
      expect(supranational).toHaveLength(1);

      const all = await db.listJurisdictions();
      expect(all).toHaveLength(3);
    });

    it('lists all jurisdictions when no filter applied', async () => {
      for (let i = 0; i < 5; i++) {
        await db.createJurisdiction({ id: `J${i}`, name: `J ${i}`, type: 'country' });
      }

      const all = await db.listJurisdictions();
      expect(all).toHaveLength(5);

      // Each has a unique id
      const allIds = all.map((j) => j.id);
      expect(new Set(allIds).size).toBe(5);
    });
  });

  describe('Regulations CRUD', () => {
    beforeEach(async () => {
      await db.createJurisdiction({ id: 'EU', name: 'EU', type: 'supranational' });
    });

    it('creates, reads, updates, and deletes a regulation', async () => {
      const created = await db.createRegulation({
        id: 'REG-1',
        jurisdictionId: 'EU',
        name: 'Test Regulation',
        shortName: 'TR',
        reference: 'REF-001',
        url: 'https://example.com/reg',
        enforcementDate: '2025-01-01',
        status: 'active',
        scope: 'all',
        sectors: ['public'],
        description: 'A test regulation',
      });
      expect(created.id).toBe('REG-1');

      const fetched = await db.getRegulation('REG-1');
      expect(fetched).not.toBeNull();
      expect(fetched!.name).toBe('Test Regulation');
      expect(fetched!.sectors).toEqual(['public']);

      const updated = await db.updateRegulation('REG-1', {
        name: 'Updated Regulation',
        status: 'draft',
      });
      expect(updated.name).toBe('Updated Regulation');
      expect(updated.status).toBe('draft');

      await db.deleteRegulation('REG-1');
      expect(await db.getRegulation('REG-1')).toBeNull();
    });

    it('filters regulations by jurisdiction and status', async () => {
      await db.createJurisdiction({ id: 'US', name: 'US', type: 'country' });

      await db.createRegulation({
        id: 'R1', jurisdictionId: 'EU', name: 'Reg EU Active', shortName: 'REU',
        reference: 'R', url: 'http://x', enforcementDate: '2025-01-01',
        status: 'active', scope: 'all', sectors: [], description: '',
      });
      await db.createRegulation({
        id: 'R2', jurisdictionId: 'US', name: 'Reg US Active', shortName: 'RUS',
        reference: 'R', url: 'http://x', enforcementDate: '2025-01-01',
        status: 'active', scope: 'all', sectors: [], description: '',
      });
      await db.createRegulation({
        id: 'R3', jurisdictionId: 'EU', name: 'Reg EU Draft', shortName: 'RED',
        reference: 'R', url: 'http://x', enforcementDate: '2026-01-01',
        status: 'draft', scope: 'all', sectors: [], description: '',
      });

      const euRegs = await db.listRegulations({ jurisdictionId: 'EU' });
      expect(euRegs).toHaveLength(2);

      const activeRegs = await db.listRegulations({ status: 'active' });
      expect(activeRegs).toHaveLength(2);
    });
  });

  describe('Requirements CRUD', () => {
    beforeEach(async () => {
      await db.createJurisdiction({ id: 'EU', name: 'EU', type: 'supranational' });
      await db.createRegulation({
        id: 'REG-1', jurisdictionId: 'EU', name: 'Reg', shortName: 'R',
        reference: 'R', url: 'http://x', enforcementDate: '2025-01-01',
        status: 'active', scope: 'all', sectors: [], description: '',
      });
    });

    it('creates, reads, updates, and deletes a requirement', async () => {
      const created = await db.createRequirement({
        regulationId: 'REG-1',
        wcagVersion: '2.1',
        wcagLevel: 'AA',
        wcagCriterion: '1.1.1',
        obligation: 'mandatory',
      });
      expect(created.regulationId).toBe('REG-1');
      expect(created.wcagCriterion).toBe('1.1.1');

      const fetched = await db.getRequirement(created.id);
      expect(fetched).not.toBeNull();

      const updated = await db.updateRequirement(created.id, {
        obligation: 'recommended',
      });
      expect(updated.obligation).toBe('recommended');

      await db.deleteRequirement(created.id);
      expect(await db.getRequirement(created.id)).toBeNull();
    });

    it('bulk creates requirements and finds them by criteria', async () => {
      await db.bulkCreateRequirements([
        { regulationId: 'REG-1', wcagVersion: '2.1', wcagLevel: 'A', wcagCriterion: '1.1.1', obligation: 'mandatory' },
        { regulationId: 'REG-1', wcagVersion: '2.1', wcagLevel: 'AA', wcagCriterion: '1.3.1', obligation: 'mandatory' },
        { regulationId: 'REG-1', wcagVersion: '2.1', wcagLevel: 'A', wcagCriterion: '2.4.1', obligation: 'recommended' },
      ]);

      const found = await db.findRequirementsByCriteria(['EU'], ['1.1.1', '1.3.1']);
      expect(found.length).toBeGreaterThanOrEqual(2);
      expect(found.some((r) => r.wcagCriterion === '1.1.1')).toBe(true);
      expect(found.some((r) => r.wcagCriterion === '1.3.1')).toBe(true);
    });

    it('lists requirements with regulation filter', async () => {
      await db.createRegulation({
        id: 'REG-2', jurisdictionId: 'EU', name: 'Reg 2', shortName: 'R2',
        reference: 'R', url: 'http://x', enforcementDate: '2025-01-01',
        status: 'active', scope: 'all', sectors: [], description: '',
      });

      for (let i = 0; i < 3; i++) {
        await db.createRequirement({
          regulationId: 'REG-1',
          wcagVersion: '2.1',
          wcagLevel: 'AA',
          wcagCriterion: `${i + 1}.1.1`,
          obligation: 'mandatory',
        });
      }
      await db.createRequirement({
        regulationId: 'REG-2',
        wcagVersion: '2.1',
        wcagLevel: 'A',
        wcagCriterion: '4.1.1',
        obligation: 'recommended',
      });

      const reg1Reqs = await db.listRequirements({ regulationId: 'REG-1' });
      expect(reg1Reqs).toHaveLength(3);
      expect(reg1Reqs.every((r) => r.regulationId === 'REG-1')).toBe(true);

      const reg2Reqs = await db.listRequirements({ regulationId: 'REG-2' });
      expect(reg2Reqs).toHaveLength(1);

      const allReqs = await db.listRequirements();
      expect(allReqs).toHaveLength(4);
    });
  });
});
