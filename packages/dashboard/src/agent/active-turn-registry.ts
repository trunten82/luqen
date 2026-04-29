/**
 * Phase 43 Plan 02 (AGENT-02) — active-turn registry.
 *
 * Single-process map of `conversationId → AbortController` used by the
 * agent cancel route to interrupt an in-flight `runTurn` loop. The
 * registry is intentionally minimal:
 *
 *   - `register(conversationId)` mints a fresh AbortController, stores it
 *     under the conversation id, and returns it. If a controller is
 *     already registered for that id (rare race: a second SSE stream
 *     opens before the first cleans up), the previous one is aborted +
 *     replaced so cancel calls always hit the most-recent turn. Without
 *     this the second turn would leak its controller and a cancel from
 *     the user would target the dead first turn.
 *
 *   - `cancel(conversationId)` aborts the registered controller and
 *     evicts it. Returns `true` when an active turn was cancelled,
 *     `false` when no entry was present. Idempotent: a second cancel
 *     for the same id is a no-op false.
 *
 *   - `cleanup(conversationId)` evicts the entry without aborting.
 *     `runTurn` calls this from its `finally` block on natural
 *     completion so the next turn's registration starts clean.
 *
 *   - `isActive(conversationId)` is a read-only probe used by tests
 *     and future diagnostics.
 *
 * Scope: per-process. Multi-instance dashboards (e.g. behind a load
 * balancer) need a shared cancel channel — out of scope for v3.3.0;
 * tracked under future requirement AGENT-CANCEL-DISTRIBUTED.
 */
export class ActiveTurnRegistry {
  private readonly turns = new Map<string, AbortController>();

  register(conversationId: string): AbortController {
    const existing = this.turns.get(conversationId);
    if (existing !== undefined) {
      // Race-safety: a second runTurn for the same conversation arrived
      // before the first cleaned up. Abort the prior controller so any
      // dangling work (LLM stream, in-flight tool fetch) is cancelled,
      // then replace with a fresh one.
      existing.abort();
    }
    const ctrl = new AbortController();
    this.turns.set(conversationId, ctrl);
    return ctrl;
  }

  cancel(conversationId: string): boolean {
    const ctrl = this.turns.get(conversationId);
    if (ctrl === undefined) return false;
    ctrl.abort();
    this.turns.delete(conversationId);
    return true;
  }

  cleanup(conversationId: string): void {
    this.turns.delete(conversationId);
  }

  isActive(conversationId: string): boolean {
    return this.turns.has(conversationId);
  }
}

/**
 * Default singleton — wired into AgentService.runTurn and the
 * `POST /agent/cancel/:conversationId` route. Tests construct fresh
 * `ActiveTurnRegistry` instances directly and inject them where
 * isolation is needed.
 */
export const activeTurnRegistry = new ActiveTurnRegistry();
