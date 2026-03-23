import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { StorageAdapter, IssueAssignmentStatus } from '../db/index.js';
import { hasPermission } from '../permissions.js';

const VALID_STATUSES = new Set<IssueAssignmentStatus>([
  'open',
  'assigned',
  'in-progress',
  'fixed',
  'verified',
]);

interface CreateAssignmentBody {
  issueFingerprint?: string;
  wcagCriterion?: string;
  wcagTitle?: string;
  severity?: string;
  message?: string;
  selector?: string;
  pageUrl?: string;
  assignedTo?: string;
  notes?: string;
}

interface UpdateAssignmentBody {
  status?: string;
  assignedTo?: string;
  notes?: string;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(str: string, len: number): string {
  if (str.length <= len) return str;
  return str.slice(0, len) + '...';
}

export async function assignmentRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
): Promise<void> {
  // GET /reports/:id/assignments — render assignments page
  server.get(
    '/reports/:id/assignments',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!hasPermission(request, 'issues.assign')) {
        return reply.code(403).send({ error: 'Insufficient permissions' });
      }

      const { id } = request.params as { id: string };
      const scan = await storage.scans.getScan(id);

      if (scan === null) {
        return reply.code(404).send({ error: 'Report not found' });
      }

      const orgId = request.user?.currentOrgId ?? 'system';
      if (scan.orgId !== orgId && scan.orgId !== 'system') {
        return reply.code(404).send({ error: 'Report not found' });
      }

      const query = request.query as { status?: string };
      const filterStatus = query.status !== undefined && query.status !== '' && query.status !== 'all'
        ? query.status as IssueAssignmentStatus
        : undefined;

      const assignments = await storage.assignments.listAssignments({
        scanId: id,
        ...(filterStatus !== undefined ? { status: filterStatus } : {}),
      });
      const stats = await storage.assignments.getAssignmentStats(id);

      // Build assignees list (users + teams) for the assignment picker
      const dashboardUsers = await storage.users.listUsers();
      const teams = await storage.teams.listTeams(orgId);
      const assignees = [
        ...dashboardUsers.filter((u) => u.active).map((u) => ({ type: 'user', id: u.username, label: u.username })),
        ...teams.map((t) => ({ type: 'team', id: `team:${t.id}`, label: `Team: ${t.name}` })),
      ];

      return reply.view('assignments.hbs', {
        pageTitle: `Assignments — ${scan.siteUrl}`,
        currentPath: `/reports/${id}/assignments`,
        user: request.user,
        scan: {
          ...scan,
          jurisdictions: scan.jurisdictions.join(', '),
          createdAtDisplay: new Date(scan.createdAt).toLocaleString(),
        },
        assignments,
        stats,
        activeFilter: filterStatus ?? 'all',
        assignees,
      });
    },
  );

  // POST /reports/:id/assignments — create assignment (HTMX)
  server.post(
    '/reports/:id/assignments',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!hasPermission(request, 'issues.assign')) {
        return reply.code(403).send({ error: 'Insufficient permissions' });
      }

      const { id } = request.params as { id: string };
      const body = request.body as CreateAssignmentBody;

      const scan = await storage.scans.getScan(id);
      if (scan === null) {
        return reply.code(404).send({ error: 'Report not found' });
      }

      const orgId = request.user?.currentOrgId ?? 'system';
      if (scan.orgId !== orgId && scan.orgId !== 'system') {
        return reply.code(404).send({ error: 'Report not found' });
      }

      // Validate required fields
      const issueFingerprint = (body.issueFingerprint ?? '').trim();
      const severity = (body.severity ?? '').trim();
      const message = (body.message ?? '').trim();

      if (issueFingerprint === '') {
        return reply.code(400).send({ error: 'issueFingerprint is required' });
      }
      if (severity === '') {
        return reply.code(400).send({ error: 'severity is required' });
      }
      if (message === '') {
        return reply.code(400).send({ error: 'message is required' });
      }

      // Check if assignment already exists for this fingerprint
      const existing = await storage.assignments.getAssignmentByFingerprint(id, issueFingerprint);
      if (existing !== null) {
        // Return the existing assignment as confirmation
        return reply.type('text/html').send(
          `<div class="asgn-toast asgn-toast--info">Already assigned (${escapeHtml(existing.status)})</div>`
        );
      }

      const createdBy = request.user?.username ?? 'unknown';

      const now = new Date().toISOString();
      const assignment = await storage.assignments.createAssignment({
        id: `asgn-${randomUUID()}`,
        scanId: id,
        issueFingerprint,
        wcagCriterion: body.wcagCriterion?.trim() || undefined,
        wcagTitle: body.wcagTitle?.trim() || undefined,
        severity,
        message,
        selector: body.selector?.trim() || undefined,
        pageUrl: body.pageUrl?.trim() || undefined,
        assignedTo: body.assignedTo?.trim() || undefined,
        notes: body.notes?.trim() || undefined,
        createdBy,
        createdAt: now,
        updatedAt: now,
        orgId,
      });

      const stats = await storage.assignments.getAssignmentStats(id);

      // JSON response for programmatic callers (Issues tab JS)
      const accept = request.headers['accept'] ?? '';
      if (accept.includes('application/json')) {
        return reply.send({
          id: assignment.id,
          status: assignment.status,
          assignedTo: assignment.assignedTo,
          stats,
        });
      }

      // HTMX HTML response for assignments page
      const html = `<div class="asgn-toast asgn-toast--success">Assigned: ${escapeHtml(truncate(assignment.message, 60))}</div>
<span hidden data-asgn-stats data-open="${stats.open}" data-assigned="${stats.assigned}" data-in-progress="${stats.inProgress}" data-fixed="${stats.fixed}" data-verified="${stats.verified}" data-total="${stats.total}"></span>`;

      return reply.type('text/html').send(html);
    },
  );

  // PATCH /assignments/:id — update status/assignee/notes (HTMX)
  server.patch(
    '/assignments/:id',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as UpdateAssignmentBody;

      const assignment = await storage.assignments.getAssignment(id);
      if (assignment === null) {
        return reply.code(404).send({ error: 'Assignment not found' });
      }

      const orgId = request.user?.currentOrgId ?? 'system';
      if (assignment.orgId !== orgId && assignment.orgId !== 'system') {
        return reply.code(404).send({ error: 'Assignment not found' });
      }

      // Validate status if provided
      const status = body.status?.trim() as IssueAssignmentStatus | undefined;
      if (status !== undefined && !VALID_STATUSES.has(status)) {
        return reply.code(400).send({ error: 'Invalid status value' });
      }

      await storage.assignments.updateAssignment(id, {
        ...(status !== undefined ? { status } : {}),
        ...(body.assignedTo !== undefined ? { assignedTo: body.assignedTo } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
      });

      const updated = await storage.assignments.getAssignment(id);
      if (updated === null) {
        return reply.code(500).send({ error: 'Failed to retrieve updated assignment' });
      }

      const stats = await storage.assignments.getAssignmentStats(assignment.scanId);

      // Return updated card HTML
      const html = renderAssignmentCard(updated) +
        `\n<span hidden data-asgn-stats data-open="${stats.open}" data-assigned="${stats.assigned}" data-in-progress="${stats.inProgress}" data-fixed="${stats.fixed}" data-verified="${stats.verified}" data-total="${stats.total}"></span>`;

      return reply.type('text/html').send(html);
    },
  );

  // DELETE /assignments/:id — remove an assignment
  server.delete(
    '/assignments/:id',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!hasPermission(request, 'issues.assign')) {
        return reply.code(403).send({ error: 'Insufficient permissions' });
      }

      const { id } = request.params as { id: string };
      const assignment = await storage.assignments.getAssignment(id);
      if (assignment === null) {
        return reply.code(404).send({ error: 'Assignment not found' });
      }

      const orgId = request.user?.currentOrgId ?? 'system';
      if (assignment.orgId !== orgId && assignment.orgId !== 'system') {
        return reply.code(404).send({ error: 'Assignment not found' });
      }

      const scanId = assignment.scanId;
      await storage.assignments.deleteAssignment(id);

      const stats = await storage.assignments.getAssignmentStats(scanId);

      // Return empty content + updated stats for HTMX swap
      return reply.type('text/html').send(
        `<span hidden data-asgn-stats data-open="${stats.open}" data-assigned="${stats.assigned}" data-in-progress="${stats.inProgress}" data-fixed="${stats.fixed}" data-verified="${stats.verified}" data-total="${stats.total}"></span>`
      );
    },
  );
}

function renderAssignmentCard(a: {
  id: string;
  severity: string;
  wcagCriterion: string | null;
  wcagTitle: string | null;
  message: string;
  selector: string | null;
  pageUrl: string | null;
  status: string;
  assignedTo: string | null;
  notes: string | null;
  createdBy: string;
  updatedAt: string;
}): string {
  const severityClass = a.severity === 'error' ? 'asgn-sev--error'
    : a.severity === 'warning' ? 'asgn-sev--warning'
    : 'asgn-sev--notice';

  const statusOptions = ['open', 'assigned', 'in-progress', 'fixed', 'verified']
    .map((s) => `<option value="${s}"${s === a.status ? ' selected' : ''}>${s}</option>`)
    .join('');

  const escapedNotes = escapeHtml(a.notes ?? '');
  const escapedAssignee = escapeHtml(a.assignedTo ?? '');
  const escapedMessage = escapeHtml(truncate(a.message, 120));
  const criterion = a.wcagCriterion
    ? `<span class="asgn-card__criterion">${escapeHtml(a.wcagCriterion)}${a.wcagTitle ? ' &mdash; ' + escapeHtml(a.wcagTitle) : ''}</span>`
    : '';

  return `<div class="asgn-card" id="asgn-card-${a.id}" data-status="${a.status}">
  <div class="asgn-card__header">
    <span class="asgn-sev ${severityClass}">${escapeHtml(a.severity)}</span>
    ${criterion}
    <span class="asgn-card__message">${escapedMessage}</span>
  </div>
  ${a.selector ? `<div class="asgn-card__selector"><code>${escapeHtml(a.selector)}</code></div>` : ''}
  ${a.pageUrl ? `<div class="asgn-card__url">${escapeHtml(a.pageUrl)}</div>` : ''}
  <div class="asgn-card__controls">
    <label class="asgn-label">Status
      <select class="asgn-select" data-field="status">${statusOptions}</select>
    </label>
    <label class="asgn-label">Assigned To
      <select class="asgn-select" data-field="assignedTo" data-current-value="${escapedAssignee}">
        <option value="">Unassigned</option>
      </select>
    </label>
    <label class="asgn-label asgn-label--wide">Notes
      <textarea class="asgn-textarea" data-field="notes" rows="2" placeholder="Notes...">${escapedNotes}</textarea>
    </label>
    <button type="button" class="btn btn--sm btn--primary asgn-save-btn" onclick="asgnSave('${a.id}', this)">Save</button>
    <button type="button" class="btn btn--sm btn--ghost asgn-delete-btn" onclick="asgnDelete('${a.id}', this)" title="Remove assignment">Remove</button>
  </div>
  <div class="asgn-card__meta">
    Created by ${escapeHtml(a.createdBy)} &middot; Updated ${new Date(a.updatedAt).toLocaleString()}
  </div>
</div>`;
}
