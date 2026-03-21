import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ScanDb } from '../db/scans.js';
import {
  MANUAL_CRITERIA,
  getGroupedCriteria,
  type ManualTestStatus,
} from '../manual-criteria.js';

const VALID_STATUSES = new Set<ManualTestStatus>([
  'untested',
  'pass',
  'fail',
  'na',
]);

interface ManualTestBody {
  criterionId?: string;
  status?: string;
  notes?: string;
}

/**
 * Compute completion stats for a scan's manual tests.
 */
function computeStats(
  results: ReadonlyArray<{ readonly status: string }>,
  totalCriteria: number,
): {
  readonly tested: number;
  readonly passed: number;
  readonly failed: number;
  readonly na: number;
  readonly untested: number;
  readonly percentage: number;
} {
  let passed = 0;
  let failed = 0;
  let na = 0;

  for (const r of results) {
    if (r.status === 'pass') passed++;
    else if (r.status === 'fail') failed++;
    else if (r.status === 'na') na++;
  }

  const tested = passed + failed + na;
  const untested = totalCriteria - tested;
  const percentage =
    totalCriteria > 0 ? Math.round((tested / totalCriteria) * 100) : 0;

  return { tested, passed, failed, na, untested, percentage };
}

export async function manualTestRoutes(
  server: FastifyInstance,
  db: ScanDb,
): Promise<void> {
  // GET /reports/:id/manual — render manual testing checklist
  server.get(
    '/reports/:id/manual',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const scan = db.getScan(id);

      if (scan === null) {
        return reply.code(404).send({ error: 'Report not found' });
      }

      const orgId = request.user?.currentOrgId ?? 'system';
      if (scan.orgId !== orgId && scan.orgId !== 'system') {
        return reply.code(404).send({ error: 'Report not found' });
      }

      // Load saved results for this scan
      const savedResults = db.getManualTests(id);
      const resultMap = new Map(
        savedResults.map((r) => [r.criterionId, r]),
      );

      const { manual, partial } = getGroupedCriteria();

      // Merge criteria with saved results
      const buildItems = (
        criteria: readonly (typeof MANUAL_CRITERIA)[number][],
      ) =>
        criteria.map((c) => {
          const saved = resultMap.get(c.id);
          return {
            ...c,
            status: saved?.status ?? 'untested',
            notes: saved?.notes ?? '',
            testedBy: saved?.testedBy ?? null,
            testedAt: saved?.testedAt
              ? new Date(saved.testedAt).toLocaleString()
              : null,
          };
        });

      const manualItems = buildItems(manual);
      const partialItems = buildItems(partial);

      const stats = computeStats(
        savedResults,
        MANUAL_CRITERIA.length,
      );

      return reply.view('manual-tests.hbs', {
        pageTitle: `Manual Testing — ${scan.siteUrl}`,
        currentPath: `/reports/${id}/manual`,
        user: request.user,
        scan: {
          ...scan,
          jurisdictions: scan.jurisdictions.join(', '),
          createdAtDisplay: new Date(scan.createdAt).toLocaleString(),
        },
        manualItems,
        partialItems,
        stats,
      });
    },
  );

  // POST /reports/:id/manual — save a single manual test result (HTMX)
  server.post(
    '/reports/:id/manual',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as ManualTestBody;

      const scan = db.getScan(id);
      if (scan === null) {
        return reply.code(404).send({ error: 'Report not found' });
      }

      const orgId = request.user?.currentOrgId ?? 'system';
      if (scan.orgId !== orgId && scan.orgId !== 'system') {
        return reply.code(404).send({ error: 'Report not found' });
      }

      // Validate inputs
      const criterionId = (body.criterionId ?? '').trim();
      const status = (body.status ?? '').trim() as ManualTestStatus;
      const notes = (body.notes ?? '').trim();

      if (criterionId === '') {
        return reply.code(400).send({ error: 'criterionId is required' });
      }

      if (!VALID_STATUSES.has(status)) {
        return reply.code(400).send({ error: 'Invalid status value' });
      }

      // Verify criterion exists in our list
      const criterion = MANUAL_CRITERIA.find((c) => c.id === criterionId);
      if (criterion === undefined) {
        return reply.code(400).send({ error: 'Unknown criterion ID' });
      }

      const testedBy = request.user?.username ?? 'unknown';

      const result = db.upsertManualTest({
        scanId: id,
        criterionId,
        status,
        notes: notes !== '' ? notes : undefined,
        testedBy,
        orgId,
      });

      // Compute updated stats
      const allResults = db.getManualTests(id);
      const stats = computeStats(allResults, MANUAL_CRITERIA.length);

      // Return updated row HTML for HTMX swap
      const statusLabel =
        status === 'pass'
          ? 'Pass'
          : status === 'fail'
            ? 'Fail'
            : status === 'na'
              ? 'N/A'
              : 'Untested';
      const statusClass =
        status === 'pass'
          ? 'mt-badge--pass'
          : status === 'fail'
            ? 'mt-badge--fail'
            : status === 'na'
              ? 'mt-badge--na'
              : 'mt-badge--untested';

      const testedAtDisplay = result.testedAt
        ? new Date(result.testedAt).toLocaleString()
        : '';

      const escapedNotes = (result.notes ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

      const escapedTitle = criterion.title
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      const checkItems = criterion.whatToCheck
        .map(
          (item) =>
            `<li>${item.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</li>`,
        )
        .join('');

      const escapedInstructions = criterion.testInstructions
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      // Build buttons — mark active one
      const makeBtn = (s: ManualTestStatus, label: string, cls: string) => {
        const active = s === status ? ' mt-btn--active' : '';
        return `<button type="button" class="mt-btn ${cls}${active}" onclick="mtSave('${id}','${criterionId}','${s}',this)">${label}</button>`;
      };

      const html = `<div class="mt-criterion" id="mt-row-${criterionId}" data-status="${status}">
  <div class="mt-criterion__header">
    <span class="mt-badge ${statusClass}">${statusLabel}</span>
    <strong>${criterionId}</strong> &mdash; ${escapedTitle}
    <span class="mt-level mt-level--${criterion.level}">${criterion.level}</span>
    <button type="button" class="mt-toggle" onclick="mtToggle(this)" aria-label="Toggle details" aria-expanded="false">&#9660;</button>
  </div>
  <div class="mt-criterion__body mt-criterion__body--collapsed">
    <p class="mt-instructions">${escapedInstructions}</p>
    <ul class="mt-checklist">${checkItems}</ul>
    <div class="mt-actions">
      ${makeBtn('pass', 'Pass', 'mt-btn--pass')}
      ${makeBtn('fail', 'Fail', 'mt-btn--fail')}
      ${makeBtn('na', 'N/A', 'mt-btn--na')}
    </div>
    <div class="mt-notes-wrap">
      <label for="mt-notes-${criterionId}">Notes</label>
      <textarea id="mt-notes-${criterionId}" class="mt-notes" rows="2" placeholder="Optional notes...">${escapedNotes}</textarea>
    </div>
    ${result.testedBy ? `<div class="mt-tested-info">Tested by ${result.testedBy} on ${testedAtDisplay}</div>` : ''}
  </div>
</div>
<span hidden data-mt-tested="${stats.tested}" data-mt-passed="${stats.passed}" data-mt-failed="${stats.failed}" data-mt-na="${stats.na}" data-mt-untested="${stats.untested}" data-mt-pct="${stats.percentage}"></span>`;

      return reply.type('text/html').send(html);
    },
  );
}
