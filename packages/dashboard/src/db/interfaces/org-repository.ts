import type { Organization, OrgMember } from '../types.js';

export interface OrgRepository {
  createOrg(data: { name: string; slug: string }): Promise<Organization>;
  getOrg(id: string): Promise<Organization | null>;
  getOrgBySlug(slug: string): Promise<Organization | null>;
  listOrgs(): Promise<Organization[]>;
  deleteOrg(id: string): Promise<void>;
  addMember(orgId: string, userId: string, role: string): Promise<OrgMember>;
  removeMember(orgId: string, userId: string): Promise<void>;
  listMembers(orgId: string): Promise<OrgMember[]>;
  /** List direct members + members inherited from teams linked to this org */
  listAllMembers(orgId: string): Promise<OrgMember[]>;
  getUserOrgs(userId: string): Promise<Organization[]>;
  getOrgComplianceCredentials(orgId: string): Promise<{ clientId: string; clientSecret: string } | null>;
  updateOrgComplianceClient(orgId: string, clientId: string, clientSecret: string): Promise<void>;
  getOrgBrandingCredentials(orgId: string): Promise<{ clientId: string; clientSecret: string } | null>;
  updateOrgBrandingClient(orgId: string, clientId: string, clientSecret: string): Promise<void>;
}
