/**
 * Brand score composite weights — LOCKED CONSTANTS.
 *
 * DO NOT change these values at runtime or per-org. Weight changes corrupt
 * historical trend data. If weights need to change in a future milestone,
 * bump the brand_scores schema version instead of mutating these constants.
 *
 * Locked by CONTEXT decision D-05. Every composite calculation in the
 * dashboard MUST import this object and read it verbatim.
 */

export type WeightKey = 'color' | 'typography' | 'components';

export const WEIGHTS: Readonly<Record<WeightKey, number>> = Object.freeze({
  color: 0.50,
  typography: 0.30,
  components: 0.20,
} as const);
