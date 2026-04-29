/**
 * Phase 43 Plan 01 (AGENT-01) — multi-step plan block parser.
 *
 * The agent system prompt instructs the LLM to emit a `<plan>...</plan>`
 * block at the start of any multi-step response (>=2 tool calls). The
 * server parses that block out of the assistant text, emits an SSE `plan`
 * frame, and persists the assistant message MINUS the block.
 *
 * Single-step turns produce no `<plan>` block; this parser returns null
 * for that case and the runTurn loop proceeds unchanged.
 *
 * Parsing is deterministic and line-based - no LLM-driven interpretation
 * of plan content.
 *
 * Format the LLM is instructed to emit:
 *
 *     <plan>
 *     1. Look up scan history -- User asked about a recent scan
 *     2. Generate executive summary -- Once scan picked, summarise findings
 *     </plan>
 *
 * Each step line: `<n>. <label> -- <rationale>` (em-dash separator). The
 * rationale is optional and defaults to an empty string. Malformed lines
 * (no leading `n.` numbering) are skipped, never thrown on.
 */

export interface PlanStep {
  readonly n: number;
  readonly label: string;
  readonly rationale: string;
}

export interface ParsedPlan {
  readonly steps: readonly PlanStep[];
  readonly textWithoutBlock: string;
}

const PLAN_BLOCK_RE = /<plan>([\s\S]*?)<\/plan>/i;

/**
 * Step line shape. Separator can be em-dash (—), en-dash (–), or
 * hyphen-with-spaces - all tolerated. Rationale group is optional.
 */
const STEP_LINE_RE = /^\s*(\d+)\.\s*(.+?)(?:\s*(?:—|–|-)\s*(.+))?\s*$/;

/**
 * Parse a `<plan>...</plan>` block out of LLM-emitted text.
 *
 * - Returns `null` when no `<plan>` block is present (single-step turn).
 * - On match, returns the parsed steps AND the original text with the
 *   block (and any surrounding whitespace it leaves behind) removed.
 * - Malformed step lines are silently skipped.
 */
export function parsePlanBlock(text: string): ParsedPlan | null {
  if (typeof text !== 'string' || text.length === 0) return null;
  const match = PLAN_BLOCK_RE.exec(text);
  if (match === null) return null;

  const inner = match[1] ?? '';
  const steps: PlanStep[] = [];
  for (const rawLine of inner.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const m = STEP_LINE_RE.exec(line);
    if (m === null) continue;
    const n = Number.parseInt(m[1], 10);
    if (!Number.isFinite(n)) continue;
    const label = (m[2] ?? '').trim();
    if (label.length === 0) continue;
    const rationale = (m[3] ?? '').trim();
    steps.push({ n, label, rationale });
  }

  const before = text.slice(0, match.index);
  const after = text.slice(match.index + match[0].length);
  const stripped = `${before}${after}`
    .replace(/^\s+/, '')
    .replace(/\s+$/, '')
    .replace(/\n{3,}/g, '\n\n');

  return { steps, textWithoutBlock: stripped };
}
