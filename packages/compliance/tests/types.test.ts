import { describe, it, expect } from 'vitest';
import type {
  Jurisdiction,
  Regulation,
  Requirement,
  UpdateProposal,
  ProposedChange,
  Webhook,
  MonitoredSource,
  OAuthClient,
  User,
  ComplianceCheckRequest,
  ComplianceCheckResponse,
  JurisdictionResult,
  RegulationResult,
  AnnotatedIssue,
  PaginatedResponse,
  WebhookPayload,
  JurisdictionFilters,
  RegulationFilters,
  RequirementFilters,
  CreateJurisdictionInput,
  CreateRegulationInput,
  CreateRequirementInput,
  CreateUpdateProposalInput,
  CreateSourceInput,
  CreateClientInput,
  CreateUserInput,
  CreateWebhookInput,
  RequirementWithRegulation,
  ComplianceConfig,
} from '../src/types.js';

describe('Types', () => {
  it('Jurisdiction satisfies the interface contract', () => {
    const j: Jurisdiction = {
      id: 'EU',
      name: 'European Union',
      type: 'supranational',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    expect(j.id).toBe('EU');
    expect(j.type).toBe('supranational');
  });

  it('Jurisdiction with parentId satisfies the interface', () => {
    const j: Jurisdiction = {
      id: 'DE',
      name: 'Germany',
      type: 'country',
      parentId: 'EU',
      iso3166: 'DE',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    expect(j.parentId).toBe('EU');
  });

  it('Regulation satisfies the interface contract', () => {
    const r: Regulation = {
      id: 'eu-eaa',
      jurisdictionId: 'EU',
      name: 'European Accessibility Act',
      shortName: 'EAA',
      reference: 'Directive (EU) 2019/882',
      url: 'https://example.com',
      enforcementDate: '2025-06-28',
      status: 'active',
      scope: 'all',
      sectors: ['e-commerce', 'banking'],
      description: 'Requires accessible products and services',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    expect(r.status).toBe('active');
    expect(r.sectors).toContain('banking');
  });

  it('Requirement satisfies the interface contract', () => {
    const req: Requirement = {
      id: 'req-1',
      regulationId: 'eu-eaa',
      wcagVersion: '2.1',
      wcagLevel: 'AA',
      wcagCriterion: '*',
      obligation: 'mandatory',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    expect(req.wcagCriterion).toBe('*');
  });

  it('UpdateProposal satisfies the interface contract', () => {
    const p: UpdateProposal = {
      id: 'prop-1',
      source: 'https://example.com/news',
      detectedAt: '2026-01-01T00:00:00Z',
      type: 'new_regulation',
      summary: 'New regulation detected',
      proposedChanges: {
        action: 'create',
        entityType: 'regulation',
        after: { name: 'New Reg' },
      },
      status: 'pending',
      createdAt: '2026-01-01T00:00:00Z',
    };
    expect(p.status).toBe('pending');
  });

  it('ComplianceCheckRequest satisfies the interface contract', () => {
    const req: ComplianceCheckRequest = {
      jurisdictions: ['EU', 'US'],
      issues: [
        {
          code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
          type: 'error',
          message: 'Missing alt text',
          selector: 'img',
          context: '<img src="test.png">',
        },
      ],
    };
    expect(req.jurisdictions).toHaveLength(2);
  });

  it('PaginatedResponse satisfies the interface contract', () => {
    const res: PaginatedResponse<Jurisdiction> = {
      data: [],
      total: 0,
      limit: 50,
      offset: 0,
    };
    expect(res.total).toBe(0);
  });

  it('ComplianceConfig satisfies the interface contract', () => {
    const cfg: ComplianceConfig = {
      port: 4000,
      host: '0.0.0.0',
      dbAdapter: 'sqlite',
      dbPath: './compliance.db',
      jwtKeyPair: {
        publicKeyPath: './keys/public.pem',
        privateKeyPath: './keys/private.pem',
      },
      tokenExpiry: '1h',
      refreshTokenExpiry: '30d',
      rateLimit: { read: 100, write: 20, windowMs: 60000 },
      cors: { origin: ['http://localhost:3000'], credentials: true },
      a2a: { enabled: true, peers: [] },
    };
    expect(cfg.port).toBe(4000);
  });

  it('RequirementWithRegulation extends Requirement with regulation data', () => {
    const rwr: RequirementWithRegulation = {
      id: 'req-1',
      regulationId: 'eu-eaa',
      wcagVersion: '2.1',
      wcagLevel: 'AA',
      wcagCriterion: '*',
      obligation: 'mandatory',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      regulationName: 'European Accessibility Act',
      regulationShortName: 'EAA',
      jurisdictionId: 'EU',
      enforcementDate: '2025-06-28',
    };
    expect(rwr.regulationName).toBe('European Accessibility Act');
  });
});
