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
  getUserOrgs(userId: string): Promise<Organization[]>;
}
