/**
 * `decision-bars.ts` — the Phase 85 seam: loads the pre-registered bar file
 * (`tests/eval/bars/decision-bars.v1.json`) and refuses to misapply it.
 *
 * This module does NOT judge a run. No comparator, no PASS/FAIL, no verdict
 * is implemented here — that is 85-02's job. This module's only two
 * responsibilities are (1) reading the committed pre-registration into a
 * fully-typed, fully-required record, carrying a raw-bytes digest so a later
 * edit to the bar file is LOUD, and (2) refusing to apply a loaded bar to a
 * run it was not registered for.
 *
 * Every field on every type in this module is REQUIRED. There is no `?`
 * anywhere below — the same discipline `RunFunction`'s fourteen fields
 * already carry (run-manifest.ts), and the defence against 85-RESEARCH.md's
 * Pitfall 2 (a required field quietly decaying into "optional but always
 * populated in practice").
 *
 * Kept SELF-CONTAINED: this module does not extend Phase 83's `schema.ts` —
 * that module's seam belongs to the reference sets, not the bars.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Type, type TSchema, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { CapabilityName } from '../types.js';
import type { RunFunction } from './run-manifest.js';

// ---------------------------------------------------------------------------
// Named error classes — one per refusal reason, following Phase 83's
// convention (types.ts) rather than a bare `Error`. Every error names the
// values that made the load/apply fail.
// ---------------------------------------------------------------------------

export class InvalidDecisionBarsFileError extends Error {
  constructor(
    public readonly filePath: string,
    public readonly detail: string,
  ) {
    super(`Invalid decision bars file at "${filePath}": ${detail}`);
    this.name = 'InvalidDecisionBarsFileError';
  }
}

export class DecisionBarsVersionMismatchError extends Error {
  constructor(
    public readonly expected: string,
    public readonly found: string,
  ) {
    super(`Decision bars version mismatch: expected "${expected}", found "${found}"`);
    this.name = 'DecisionBarsVersionMismatchError';
  }
}

export class UnknownCapabilityBarError extends Error {
  constructor(
    public readonly requestedCapability: string,
    public readonly knownCapabilities: readonly string[],
  ) {
    super(
      `No bar recorded for capability "${requestedCapability}" -- known capabilities: ${knownCapabilities.join(', ')}`,
    );
    this.name = 'UnknownCapabilityBarError';
  }
}

export class BarSetNameMismatchError extends Error {
  constructor(
    public readonly barSetName: string,
    public readonly runSetName: string,
  ) {
    super(
      `Bar was registered for set "${barSetName}" but the run's set is "${runSetName}" -- refusing to apply`,
    );
    this.name = 'BarSetNameMismatchError';
  }
}

export class BarSetVersionMismatchError extends Error {
  constructor(
    public readonly barSetVersion: string,
    public readonly runSetVersion: string,
  ) {
    super(
      `Bar was registered for set version "${barSetVersion}" but the run's set version is "${runSetVersion}" -- refusing to apply`,
    );
    this.name = 'BarSetVersionMismatchError';
  }
}

export class BarItemCountMismatchError extends Error {
  constructor(
    public readonly barItemCount: number,
    public readonly runItemCount: number,
  ) {
    super(
      `Bar was registered for n=${barItemCount} items but the run scored ${runItemCount} items -- refusing to apply a margin recorded as an item count against a different-sized set`,
    );
    this.name = 'BarItemCountMismatchError';
  }
}

export class InvalidMarginError extends Error {
  constructor(
    public readonly fieldPath: string,
    public readonly value: unknown,
  ) {
    super(
      `Margin at "${fieldPath}" must be a whole positive item count -- found ${JSON.stringify(value)} (a percentage or fraction cannot be substituted for the item count D-85-3 requires)`,
    );
    this.name = 'InvalidMarginError';
  }
}

export class FalsePassGateToleranceFieldError extends Error {
  constructor(public readonly unexpectedKey: string) {
    super(
      `False-PASS screening gate carries an unexpected key "${unexpectedKey}" -- this gate is zero-tolerance by design (D-85-4) and the loader refuses any field outside its fixed, known shape`,
    );
    this.name = 'FalsePassGateToleranceFieldError';
  }
}

// ---------------------------------------------------------------------------
// Package-relative path constant — same convention as set-paths.ts, and for
// the same reason: the same constant must be correct whether resolved from
// `src/` under vitest or from `dist/` under the built CLI.
// ---------------------------------------------------------------------------

export const DECISION_BARS_FILES = Object.freeze({
  v1: 'tests/eval/bars/decision-bars.v1.json',
} as const);

export type DecisionBarsVersion = keyof typeof DECISION_BARS_FILES;

export function resolveDecisionBarsPath(packageRoot: string, barsVersion: string): string {
  const relative = (DECISION_BARS_FILES as Record<string, string | undefined>)[barsVersion];
  if (relative === undefined) {
    throw new DecisionBarsVersionMismatchError(
      Object.keys(DECISION_BARS_FILES).join('|'),
      barsVersion,
    );
  }
  return join(packageRoot, relative);
}

// ---------------------------------------------------------------------------
// TypeBox schema — mirrors the committed JSON exactly. No Type.Optional
// anywhere: every field the committed file carries is required here too.
// ---------------------------------------------------------------------------

const CapabilityLiteral = Type.Union([Type.Literal('generate-fix'), Type.Literal('analyse-visual')]);

const PreRegistrationGuaranteeSchema = Type.Object({
  statement: Type.String(),
  reCheckableInvariant: Type.String(),
  verificationProcedure: Type.String(),
  noSelfReferentialShaNote: Type.String(),
  measurementStateAtWriteTime: Type.String(),
});

const NonGatingAxisSchema = Type.Object({
  counterName: Type.String(),
  status: Type.String(),
});

const PercentageEquivalentWithNoteSchema = Type.Object({
  value: Type.Number(),
  unit: Type.String(),
  denominator: Type.Integer(),
  note: Type.String(),
});

const PercentageEquivalentPlainSchema = Type.Object({
  value: Type.Number(),
  unit: Type.String(),
  denominator: Type.Integer(),
});

const RejectedAlternativeSchema = Type.Object({
  marginItems: Type.Number(),
  percentageEquivalent: Type.Number(),
  reason: Type.String(),
});

const WorkedCounterexampleRowSchema = Type.Object({
  candidateImprovesItems: Type.Integer(),
  bound: Type.Number(),
  certifies: Type.Boolean(),
});

const HistoryLayer1Schema = Type.Object({
  label: Type.String(),
  value: Type.String(),
  text: Type.String(),
});

const HistoryLayer2Schema = Type.Object({
  label: Type.String(),
  value: Type.String(),
  text: Type.String(),
});

const HistoryLayer3Schema = Type.Object({
  label: Type.String(),
  value: Type.String(),
  cause: Type.String(),
  workedCounterexample: Type.Object({
    configuration: Type.String(),
    underRejectedBonferroniSplitMethod: Type.Array(WorkedCounterexampleRowSchema),
    finding: Type.String(),
  }),
  replacementMethod: Type.String(),
  underReplacementMethod: Type.Object({
    resultAtN17: Type.Integer(),
    resultAtN13: Type.Integer(),
    statement: Type.String(),
  }),
  whatWasWrongAndWhen: Type.String(),
  crossCheckOfCoordinatorsFigures: Type.Object({
    note: Type.String(),
  }),
});

const MarginHistorySchema = Type.Object({
  recordingPolicy: Type.String(),
  layer1Original: HistoryLayer1Schema,
  layer2Amendment: HistoryLayer2Schema,
  layer3Retraction: HistoryLayer3Schema,
});

const BehaviourallyInertSchema = Type.Object({
  finding: Type.String(),
  whatMoves: Type.String(),
  conclusion: Type.String(),
});

const NonInferiorityMarginSchema = Type.Object({
  axis: Type.String(),
  kind: Type.String(),
  marginItems: Type.Number(),
  percentageEquivalent: PercentageEquivalentWithNoteSchema,
  rejectedAlternatives: Type.Array(RejectedAlternativeSchema),
  history: MarginHistorySchema,
  channel: Type.String(),
  behaviourallyInert: BehaviourallyInertSchema,
  haltConditionRule: Type.String(),
});

const GatingAxisSchema = Type.Object({
  counterName: Type.String(),
  sourceDecision: Type.String(),
  reason: Type.String(),
});

const GenerateFixBarSchema = Type.Object({
  setName: Type.String(),
  setVersion: Type.String(),
  n: Type.Integer(),
  gatingAxis: GatingAxisSchema,
  nonGatingAxes: Type.Array(NonGatingAxisSchema),
  nonInferiorityMargin: NonInferiorityMarginSchema,
});

const OpportunityDenominatorSchema = Type.Object({
  value: Type.Integer(),
  measuredFrom: Type.String(),
  note: Type.String(),
});

const FalsePassScreeningGateSchema = Type.Object({
  sourceDecision: Type.String(),
  mechanism: Type.String(),
  counterName: Type.String(),
  rule: Type.String(),
  opportunityDenominator: OpportunityDenominatorSchema,
  toleranceField: Type.Null(),
  toleranceFieldNote: Type.String(),
});

const AnalyseVisualNonInferiorityClauseSchema = Type.Object({
  sourceDecision: Type.String(),
  mechanism: Type.String(),
  axis: Type.String(),
  counterName: Type.String(),
  n: Type.Integer(),
  marginItems: Type.Number(),
  percentageEquivalent: PercentageEquivalentPlainSchema,
  provenance: Type.String(),
  whyNotTightenedBelowGenerateFix: Type.String(),
  haltConditionRule: Type.String(),
});

const AnalyseVisualBarSchema = Type.Object({
  setName: Type.String(),
  setVersion: Type.String(),
  n: Type.Integer(),
  falsePassScreeningGate: FalsePassScreeningGateSchema,
  nonInferiorityClause: AnalyseVisualNonInferiorityClauseSchema,
});

const CapabilityBarsSchema = Type.Object({
  'generate-fix': GenerateFixBarSchema,
  'analyse-visual': AnalyseVisualBarSchema,
});

const VarianceQuantitySchema = Type.Object({
  quantity: Type.String(),
  quantityDefinition: Type.String(),
  assumedValue: Type.Number(),
  label: Type.String(),
  measurementState: Type.String(),
});

const VarianceAssumptionSchema = Type.Object({
  sourceDecision: Type.String(),
  'generate-fix': VarianceQuantitySchema,
  'analyse-visual': VarianceQuantitySchema,
  runToRunInstability: Type.Object({
    quantity: Type.String(),
    isDifferentQuantityFromDiscordanceAbove: Type.Boolean(),
    note: Type.String(),
  }),
});

const DecisionRuleSchema = Type.Object({
  sourceDecision: Type.String(),
  method: Type.String(),
  derivation: Type.String(),
  closedFormAtZero: Type.String(),
  generalFormula: Type.String(),
});

const ExactWorstCaseEntrySchema = Type.Object({
  n: Type.Integer(),
  marginItems: Type.Integer(),
  worstCaseFalseReassuranceRate: Type.Number(),
  asPercentage: Type.String(),
});

const CrossCheckEntrySchema = Type.Object({
  n: Type.Integer(),
  marginItems: Type.Integer(),
  worstCaseFalseReassuranceRate: Type.Number(),
  asPercentage: Type.String(),
  note: Type.String(),
});

const ValidityStatementSchema = Type.Object({
  guarantee: Type.String(),
  whyThisMethodWasChosen: Type.String(),
  leastFavourableConfiguration: Type.String(),
  exactWorstCaseValues: Type.Object({
    generateFix: ExactWorstCaseEntrySchema,
    analyseVisualCorrect: ExactWorstCaseEntrySchema,
    crossCheckAgainstTheRejectedFourItemDigit: CrossCheckEntrySchema,
    howComputed: Type.String(),
  }),
});

const PowerFigureSchema = Type.Object({
  value: Type.Number(),
  howComputed: Type.String(),
});

const WorstCaseNoteSchema = Type.Object({
  value: Type.Number(),
  note: Type.String(),
});

const TwoFiguresPerCapabilitySchema = Type.Object({
  assumedDiscordantPairRateUsedHere: Type.Number(),
  generateFix: Type.Object({
    n: Type.Integer(),
    powerToCertifyGenuinelyIdenticalCandidate: PowerFigureSchema,
    worstCaseFalseReassuranceRate: WorstCaseNoteSchema,
  }),
  analyseVisualCorrect: Type.Object({
    n: Type.Integer(),
    powerToCertifyGenuinelyIdenticalCandidate: PowerFigureSchema,
    worstCaseFalseReassuranceRate: WorstCaseNoteSchema,
  }),
  readerNote: Type.String(),
});

const SensitivityRowSchema = Type.Object({
  assumedDiscordantPairRate: Type.Number(),
  generateFixPowerToCertifyIdentical_n17: Type.Number(),
  analyseVisualPowerToCertifyIdentical_n13: Type.Number(),
});

const SensitivityTableSchema = Type.Object({
  sourceDecision: Type.String(),
  axis: Type.String(),
  purposeNote: Type.String(),
  worstCaseFalseReassuranceInvarianceNote: Type.String(),
  rows: Type.Array(SensitivityRowSchema),
});

const CheckedCountSchema = Type.Object({
  m: Type.Integer(),
  proportion: Type.Number(),
  reachable: Type.Boolean(),
});

const ReachabilityForNSchema = Type.Object({
  n: Type.Integer(),
  closedFormBoundAtZero: Type.Number(),
  checkedCounts: Type.Array(CheckedCountSchema),
  smallestReachableMarginItems: Type.Integer(),
  haltCheck: Type.String(),
});

const ReachabilityDerivationSchema = Type.Object({
  rule: Type.String(),
  generateFix: ReachabilityForNSchema,
  analyseVisualCorrect: ReachabilityForNSchema,
});

const CertifyingEntrySchema = Type.Object({
  n: Type.Integer(),
  marginItems: Type.Integer(),
  largestCertifyingBaselineBetterCount: Type.Integer(),
  derivation: Type.String(),
});

const ObservedResultsThatCanCertifySchema = Type.Object({
  sourceDecision: Type.String(),
  warningLabel: Type.String(),
  warning: Type.String(),
  generateFix: CertifyingEntrySchema,
  analyseVisualCorrect: CertifyingEntrySchema,
});

const NamedLimitationSchema = Type.Object({
  id: Type.String(),
  title: Type.String(),
  text: Type.String(),
});

const AchievedPowerSchema = Type.Object({
  framingNote: Type.String(),
  decisionRule: DecisionRuleSchema,
  validityStatement: ValidityStatementSchema,
  twoFiguresPerCapability: TwoFiguresPerCapabilitySchema,
  sensitivityTable: SensitivityTableSchema,
  reachabilityDerivation: ReachabilityDerivationSchema,
  observedResultsThatCanCertify: ObservedResultsThatCanCertifySchema,
  namedLimitations: Type.Array(NamedLimitationSchema),
});

const VerdictOrderRowSchema = Type.Object({
  rank: Type.Integer(),
  rule: Type.String(),
});

const VerdictPrecedenceSchema = Type.Object({
  sourceDecision: Type.String(),
  sourceReasoning: Type.String(),
  order: Type.Array(VerdictOrderRowSchema),
  structuralRule: Type.String(),
  expectedOutcomeNote: Type.String(),
});

const FalsePassGateLicenceSchema = Type.Object({
  pass: Type.Object({
    verbatimFromD854: Type.String(),
    sourceDecision: Type.String(),
    doNotModify: Type.String(),
    additionalCaveatRequiredOnEveryPass: Type.String(),
  }),
  fail: Type.Object({
    text: Type.String(),
  }),
});

const NonInferiorityLicenceEntrySchema = Type.Object({
  pass: Type.Object({ text: Type.String() }),
  fail: Type.Object({ text: Type.String() }),
  underpowered: Type.Object({ text: Type.String() }),
});

const OverallVerdictLicenceSchema = Type.Object({
  note: Type.String(),
  pass: Type.Object({ text: Type.String() }),
  fail: Type.Object({ text: Type.String() }),
  underpowered: Type.Object({ text: Type.String() }),
});

const LicenceStringsSchema = Type.Object({
  falsePassGate: FalsePassGateLicenceSchema,
  nonInferiorityClause: Type.Object({
    generateFix: NonInferiorityLicenceEntrySchema,
    analyseVisualCorrect: NonInferiorityLicenceEntrySchema,
  }),
  overallVerdict: OverallVerdictLicenceSchema,
});

const ExplicitExclusionsSchema = Type.Object({
  noBlendedScore: Type.String(),
  noToleranceOnFalsePassGate: Type.String(),
});

const LessonRecordedSchema = Type.Object({
  id: Type.String(),
  generalisesPastThisPhase: Type.Boolean(),
  text: Type.String(),
});

/** The full bar-file schema. Every field required -- no Type.Optional anywhere. */
const DecisionBarsFileSchema = Type.Object({
  barsVersion: Type.String(),
  recordedAt: Type.String(),
  capabilities: Type.Array(CapabilityLiteral),
  preRegistrationGuarantee: PreRegistrationGuaranteeSchema,
  capabilityBars: CapabilityBarsSchema,
  varianceAssumption: VarianceAssumptionSchema,
  achievedPower: AchievedPowerSchema,
  verdictPrecedence: VerdictPrecedenceSchema,
  licenceStrings: LicenceStringsSchema,
  explicitExclusions: ExplicitExclusionsSchema,
  lessonRecorded: LessonRecordedSchema,
});

export type DecisionBarsFile = Static<typeof DecisionBarsFileSchema>;
export type GenerateFixBar = Static<typeof GenerateFixBarSchema>;
export type AnalyseVisualBar = Static<typeof AnalyseVisualBarSchema>;

/** `loadDecisionBars`'s return: the fully-typed, fully-required bar record,
 * plus the raw-bytes digest that travels onto every verdict 85-02 emits so a
 * reader can tell whether the bar in front of them is the bar that judged a
 * result. */
export type LoadedDecisionBars = DecisionBarsFile & {
  readonly digestSha256: string;
};

// ---------------------------------------------------------------------------
// Post-schema refusals -- exported so both the loader and the committed
// break-test can exercise them directly against a SCRATCH record.
// ---------------------------------------------------------------------------

/** Refuses a margin that is not a whole positive item count (D-85-3). */
export function assertWholePositiveItemCount(fieldPath: string, value: unknown): void {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new InvalidMarginError(fieldPath, value);
  }
}

const FALSE_PASS_GATE_ALLOWED_KEYS = new Set([
  'sourceDecision',
  'mechanism',
  'counterName',
  'rule',
  'opportunityDenominator',
  'toleranceField',
  'toleranceFieldNote',
]);

/** Refuses a false-PASS gate object carrying any field outside its fixed,
 * known shape -- including `toleranceField` itself carrying a non-null
 * value (D-85-4's zero-tolerance clause must never be quietly widened). */
export function assertNoToleranceShapedField(gate: Record<string, unknown>): void {
  for (const key of Object.keys(gate)) {
    if (!FALSE_PASS_GATE_ALLOWED_KEYS.has(key)) {
      throw new FalsePassGateToleranceFieldError(key);
    }
  }
  if (gate.toleranceField !== null) {
    throw new FalsePassGateToleranceFieldError('toleranceField');
  }
}

function firstSchemaErrorDetail(schema: TSchema, value: unknown): string {
  const errors = [...Value.Errors(schema, value)];
  const first = errors[0];
  if (first == null) return 'failed schema validation';
  return `${first.path} ${first.message}`;
}

// ---------------------------------------------------------------------------
// The loader
// ---------------------------------------------------------------------------

/**
 * Loads the committed decision-bars file at `barsVersion`, validates its
 * FULL shape (no field is optional), runs the margin-type and
 * tolerance-shaped-field refusals over both capability bars, and returns the
 * fully-typed record with a raw-bytes sha256 digest attached.
 *
 * Refuses loudly at every step -- never catches and defaults, matching
 * `load-reference-set.ts`'s convention.
 */
export function loadDecisionBars(packageRoot: string, barsVersion: string): LoadedDecisionBars {
  const filePath = resolveDecisionBarsPath(packageRoot, barsVersion);

  let raw: Buffer;
  try {
    raw = readFileSync(filePath);
  } catch (err) {
    throw new InvalidDecisionBarsFileError(
      filePath,
      `could not read file: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Digest the RAW bytes, not a canonical re-serialisation -- any edit at
  // all, including a whitespace edit, must change it.
  const digestSha256 = createHash('sha256').update(raw).digest('hex');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf-8'));
  } catch (err) {
    throw new InvalidDecisionBarsFileError(
      filePath,
      `invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new InvalidDecisionBarsFileError(filePath, 'top-level value is not an object');
  }

  const parsedBarsVersion = (parsed as Record<string, unknown>).barsVersion;
  if (typeof parsedBarsVersion !== 'string' || parsedBarsVersion !== barsVersion) {
    throw new DecisionBarsVersionMismatchError(
      barsVersion,
      typeof parsedBarsVersion === 'string' ? parsedBarsVersion : String(parsedBarsVersion),
    );
  }

  if (!Value.Check(DecisionBarsFileSchema, parsed)) {
    throw new InvalidDecisionBarsFileError(filePath, firstSchemaErrorDetail(DecisionBarsFileSchema, parsed));
  }

  const bar = parsed as DecisionBarsFile;

  // Margin-type refusal (D-85-3): both non-inferiority margins must be
  // whole positive item counts, never a percentage or fraction.
  assertWholePositiveItemCount(
    'capabilityBars.generate-fix.nonInferiorityMargin.marginItems',
    bar.capabilityBars['generate-fix'].nonInferiorityMargin.marginItems,
  );
  assertWholePositiveItemCount(
    'capabilityBars.analyse-visual.nonInferiorityClause.marginItems',
    bar.capabilityBars['analyse-visual'].nonInferiorityClause.marginItems,
  );

  // Tolerance-shaped-field refusal (D-85-4): the false-PASS gate's shape is
  // fixed and carries no tolerance/epsilon/margin field of any kind.
  assertNoToleranceShapedField(
    bar.capabilityBars['analyse-visual'].falsePassScreeningGate as unknown as Record<string, unknown>,
  );

  return { ...bar, digestSha256 };
}

// ---------------------------------------------------------------------------
// Capability lookup and the run-applicability guard
// ---------------------------------------------------------------------------

/** Returns the bar recorded for `capability`, refusing if the file does not
 * carry one (e.g. any of the five non-durable capabilities this milestone
 * deliberately did not build a bar for). */
export function getCapabilityBar(
  bar: DecisionBarsFile,
  capability: CapabilityName,
): GenerateFixBar | AnalyseVisualBar {
  if (capability === 'generate-fix') return bar.capabilityBars['generate-fix'];
  if (capability === 'analyse-visual') return bar.capabilityBars['analyse-visual'];
  throw new UnknownCapabilityBarError(capability, Object.keys(bar.capabilityBars));
}

/**
 * Refuses to apply `bar` to a run whose set name, set version, or item
 * count differs from the ones the bar was registered for. This is the guard
 * that enforces D-85-3's reason for recording the margin as an item count:
 * a bar registered against 17 items must be structurally incapable of being
 * applied to a set of a different size.
 */
export function assertBarAppliesTo(
  bar: DecisionBarsFile,
  runFunction: Pick<RunFunction, 'capability' | 'setName' | 'setVersion' | 'itemCount'>,
): void {
  const capabilityBar = getCapabilityBar(bar, runFunction.capability);

  if (capabilityBar.setName !== runFunction.setName) {
    throw new BarSetNameMismatchError(capabilityBar.setName, runFunction.setName);
  }
  if (capabilityBar.setVersion !== runFunction.setVersion) {
    throw new BarSetVersionMismatchError(capabilityBar.setVersion, runFunction.setVersion);
  }
  if (capabilityBar.n !== runFunction.itemCount) {
    throw new BarItemCountMismatchError(capabilityBar.n, runFunction.itemCount);
  }
}
