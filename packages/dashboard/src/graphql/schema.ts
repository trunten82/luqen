/**
 * GraphQL SDL schema for the Luqen dashboard.
 *
 * Covers scans, issues, assignments, trends, compliance, users, teams,
 * organizations, roles, audit log, and system health.
 */

export const schema = `
  # ── Pagination helpers ──────────────────────────────────────────────

  type PageInfo {
    totalCount: Int!
    limit: Int!
    offset: Int!
    hasNextPage: Boolean!
  }

  # ── Scans ───────────────────────────────────────────────────────────

  type Scan {
    id: ID!
    siteUrl: String!
    status: String!
    standard: String!
    jurisdictions: [String!]!
    createdBy: String!
    createdAt: String!
    completedAt: String
    pagesScanned: Int
    totalIssues: Int
    errors: Int
    warnings: Int
    notices: Int
    confirmedViolations: Int
    orgId: String!
  }

  type ScanConnection {
    nodes: [Scan!]!
    totalCount: Int!
    pageInfo: PageInfo!
  }

  input CreateScanInput {
    siteUrl: String!
    standard: String
    jurisdictions: [String!]
    includeWarnings: Boolean
    includeNotices: Boolean
  }

  # ── Issues (from JSON report) ──────────────────────────────────────

  type Issue {
    type: String!
    code: String!
    message: String!
    selector: String!
    context: String
    wcagCriterion: String
    wcagTitle: String
    pageUrl: String
  }

  type IssueConnection {
    nodes: [Issue!]!
    totalCount: Int!
    pageInfo: PageInfo!
  }

  # ── Assignments ─────────────────────────────────────────────────────

  type Assignment {
    id: ID!
    scanId: String!
    issueFingerprint: String!
    wcagCriterion: String
    wcagTitle: String
    severity: String!
    message: String!
    selector: String
    pageUrl: String
    status: String!
    assignedTo: String
    notes: String
    createdBy: String!
    createdAt: String!
    updatedAt: String!
    orgId: String!
  }

  input AssignIssueInput {
    scanId: String!
    issueFingerprint: String!
    wcagCriterion: String
    wcagTitle: String
    severity: String!
    message: String!
    selector: String
    pageUrl: String
    assignedTo: String
    notes: String
  }

  # ── Trends ──────────────────────────────────────────────────────────

  type TrendPoint {
    scanId: ID!
    siteUrl: String!
    completedAt: String!
    totalIssues: Int!
    errors: Int!
    warnings: Int!
    notices: Int!
  }

  # ── Compliance ──────────────────────────────────────────────────────

  type ComplianceEntry {
    siteUrl: String!
    latestScanId: ID!
    totalIssues: Int!
    errors: Int!
    warnings: Int!
    notices: Int!
    completedAt: String!
  }

  # ── Users ───────────────────────────────────────────────────────────

  type DashboardUser {
    id: ID!
    username: String!
    role: String!
    active: Boolean!
    createdAt: String!
  }

  # ── Teams ───────────────────────────────────────────────────────────

  type TeamMember {
    userId: String!
    username: String!
    role: String!
  }

  type Team {
    id: ID!
    name: String!
    description: String!
    orgId: String!
    createdAt: String!
    memberCount: Int
    members: [TeamMember!]
  }

  # ── Organizations ──────────────────────────────────────────────────

  type Organization {
    id: ID!
    name: String!
    slug: String!
    createdAt: String!
  }

  # ── Roles ───────────────────────────────────────────────────────────

  type Role {
    id: ID!
    name: String!
    description: String!
    isSystem: Boolean!
    orgId: String!
    createdAt: String!
    permissions: [String!]!
  }

  # ── Audit log ──────────────────────────────────────────────────────

  type AuditEntry {
    id: ID!
    timestamp: String!
    actor: String!
    actorId: String
    action: String!
    resourceType: String!
    resourceId: String
    details: String
    ipAddress: String
    orgId: String!
  }

  type AuditConnection {
    nodes: [AuditEntry!]!
    totalCount: Int!
    pageInfo: PageInfo!
  }

  # ── Branding ────────────────────────────────────────────────────────

  type BrandColor {
    id: ID!
    name: String!
    hexValue: String!
    usage: String
    context: String
  }

  type BrandFont {
    id: ID!
    family: String!
    weights: [String!]
    usage: String
    context: String
  }

  type BrandSelector {
    id: ID!
    pattern: String!
    description: String
  }

  type BrandGuideline {
    id: ID!
    orgId: String!
    name: String!
    description: String
    version: Int!
    active: Boolean!
    imagePath: String
    createdAt: String!
    updatedAt: String!
    colors: [BrandColor!]!
    fonts: [BrandFont!]!
    selectors: [BrandSelector!]!
    sites: [String!]!
  }

  type RetagResult {
    retagged: Int!
  }

  input CreateBrandGuidelineInput {
    name: String!
    description: String
  }

  input AddBrandColorInput {
    name: String!
    hexValue: String!
    usage: String
    context: String
  }

  input AddBrandFontInput {
    family: String!
    weights: [String!]
    usage: String
    context: String
  }

  input AddBrandSelectorInput {
    pattern: String!
    description: String
  }

  # ── System ──────────────────────────────────────────────────────────

  type HealthStatus {
    status: String!
    version: String!
  }

  # ── Root Query ──────────────────────────────────────────────────────

  type Query {
    """List scans with optional filters and pagination."""
    scans(siteUrl: String, from: String, to: String, limit: Int, offset: Int): ScanConnection!

    """Fetch a single scan by ID."""
    scan(id: ID!): Scan

    """List issues from a scan's JSON report."""
    scanIssues(scanId: ID!, severity: String, criterion: String, limit: Int, offset: Int): IssueConnection!

    """List issue assignments with optional filters."""
    assignments(scanId: ID, status: String, assignedTo: String): [Assignment!]!

    """Get trend data for a given site URL."""
    trends(siteUrl: String!): [TrendPoint!]!

    """Get a compliance summary across completed scans."""
    complianceSummary: [ComplianceEntry!]!

    """List all dashboard users (requires users.* permission)."""
    dashboardUsers: [DashboardUser!]!

    """List all teams."""
    teams: [Team!]!

    """Fetch a single team by ID."""
    team(id: ID!): Team

    """List all organizations."""
    organizations: [Organization!]!

    """List all roles."""
    roles: [Role!]!

    """Query the audit log (requires audit.view permission)."""
    auditLog(actor: String, action: String, resourceType: String, from: String, to: String, limit: Int, offset: Int): AuditConnection!

    """System health check."""
    health: HealthStatus!

    """List branding guidelines for the current org."""
    brandingGuidelines: [BrandGuideline!]!

    """Fetch a single branding guideline by ID."""
    brandingGuideline(id: ID!): BrandGuideline

    """Get the branding guideline assigned to a site URL."""
    brandingGuidelineForSite(siteUrl: String!): BrandGuideline
  }

  # ── Root Mutation ──────────────────────────────────────────────────

  type Mutation {
    """Create a new scan."""
    createScan(input: CreateScanInput!): Scan!

    """Delete a scan by ID."""
    deleteScan(id: ID!): Boolean!

    """Assign an issue."""
    assignIssue(input: AssignIssueInput!): Assignment!

    """Update an existing assignment."""
    updateAssignment(id: ID!, status: String, assignedTo: String, notes: String): Assignment!

    """Delete an assignment."""
    deleteAssignment(id: ID!): Boolean!

    """Create a new dashboard user (requires users.create)."""
    createUser(username: String!, password: String!, role: String): DashboardUser!

    """Delete a dashboard user (requires users.delete)."""
    deleteUser(id: ID!): Boolean!

    """Activate a user account (requires users.activate)."""
    activateUser(id: ID!): DashboardUser!

    """Deactivate a user account (requires users.activate)."""
    deactivateUser(id: ID!): DashboardUser!

    """Reset a user's password (requires users.reset_password)."""
    resetPassword(id: ID!, newPassword: String!): Boolean!

    """Create a branding guideline (requires branding.manage)."""
    createBrandingGuideline(input: CreateBrandGuidelineInput!): BrandGuideline!

    """Delete a branding guideline (requires branding.manage)."""
    deleteBrandingGuideline(id: ID!): Boolean!

    """Toggle a branding guideline active/inactive."""
    toggleBrandingGuideline(id: ID!): BrandGuideline!

    """Add a color to a branding guideline."""
    addBrandColor(guidelineId: ID!, input: AddBrandColorInput!): BrandColor!

    """Remove a color from a branding guideline."""
    removeBrandColor(id: ID!): Boolean!

    """Add a font to a branding guideline."""
    addBrandFont(guidelineId: ID!, input: AddBrandFontInput!): BrandFont!

    """Remove a font from a branding guideline."""
    removeBrandFont(id: ID!): Boolean!

    """Add a selector rule to a branding guideline."""
    addBrandSelector(guidelineId: ID!, input: AddBrandSelectorInput!): BrandSelector!

    """Remove a selector rule from a branding guideline."""
    removeBrandSelector(id: ID!): Boolean!

    """Assign a branding guideline to a site URL."""
    assignBrandingToSite(guidelineId: ID!, siteUrl: String!): Boolean!

    """Unassign branding from a site URL."""
    unassignBrandingFromSite(siteUrl: String!): Boolean!

    """Retag existing scans for a site with current branding guideline."""
    retagBrandingScans(siteUrl: String!): RetagResult!
  }
`;
