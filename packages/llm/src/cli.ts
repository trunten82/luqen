#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteAdapter } from './db/sqlite-adapter.js';
import { loadConfig } from './config.js';
import { VERSION } from './version.js';
import { runHarness, type RunHarnessProvider, type RunHarnessResult } from './eval/harness.js';
import { createFixtureAdapter } from './eval/fixture-adapter.js';
import { assertComparable, RunFunctionMismatchError, type RunFunction, type RunMode } from './eval/run-manifest.js';
import { createAdapter } from './providers/registry.js';
import type { ProviderType } from './types.js';
import { loadDecisionBars } from './eval/decision-bars.js';
import { compareGenerateFix, serialiseVerdict, describeInsufficiencyReason } from './eval/verdict.js';
import type { GenerateFixVerdict, PowerAssessment, RunToRunInstability } from './eval/verdict-types.js';
import { compareAnalyseVisual, serialiseAnalyseVisualVerdict, type AnalyseVisualVerdict } from './eval/verdict-analyse-visual.js';
import type { GenerateFixReport, AnalyseVisualReport } from './eval/report.js';

function createDbAdapter(dbPath?: string): SqliteAdapter {
  const config = loadConfig();
  const resolvedPath = dbPath ?? process.env.LLM_DB_PATH ?? config.dbPath ?? './llm.db';
  return new SqliteAdapter(resolvedPath);
}

// ---------------------------------------------------------------------------
// eval (Phase 84, HARNESS-01/HARNESS-02/HARNESS-04/HARNESS-06)
// ---------------------------------------------------------------------------

/**
 * Resolved once, from the file's OWN location, never from `process.cwd()` —
 * a maintainer can invoke `luqen-llm` from any directory. Two levels up from
 * this file's directory (`src/` at dev time, `dist/` once built) is the
 * `@luqen/llm` package root, where `tests/eval/sets/` and
 * `tests/eval/fixtures/` live.
 */
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const EVAL_CAPABILITIES = ['generate-fix', 'analyse-visual'] as const;
type EvalCapability = (typeof EVAL_CAPABILITIES)[number];

function isEvalCapability(value: string): value is EvalCapability {
  return (EVAL_CAPABILITIES as readonly string[]).includes(value);
}

/**
 * The committed, labelled-synthetic fixture file for each capability
 * (Task 2). Replay is the default mode and needs no `--fixtures` override
 * for the ordinary case.
 */
const REPLAY_FIXTURE_FILES: Record<EvalCapability, string> = {
  'generate-fix': 'tests/eval/fixtures/wcag-fixes.replay.json',
  'analyse-visual': 'tests/eval/fixtures/image-alt.replay.json',
};

/**
 * The ONLY place a live run's provider credential may come from. Never a
 * CLI argument — a credential passed on the command line lands in shell
 * history and process listings. T-84-12.
 */
const EVAL_LIVE_API_KEY_ENV = 'EVAL_HARNESS_API_KEY';

/** Strips the `_synthetic` label out of a committed replay fixture file, returning the item-id-to-response-text map the fixture adapter looks up. */
function loadReplayResponses(path: string): Readonly<Record<string, string>> {
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, string>;
  const { _synthetic: _label, ...responses } = raw;
  return responses;
}

function printEvalSummary(result: RunHarnessResult): void {
  console.log(`Capability: ${result.capability}`);
  console.log(`Mode: ${result.report.runFunction.mode}`);
  console.log(
    `Model: ${result.report.runFunction.modelDisplayName} (${result.report.runFunction.modelId})`,
  );
  console.log(
    `Set: ${result.report.runFunction.setName}@${result.report.runFunction.setVersion} (${result.report.runFunction.itemCount} items)`,
  );
  console.log(`Failed: ${result.report.failedCount}`);

  if (result.capability === 'generate-fix') {
    const a = result.report.aggregate;
    console.log(`Exact match: ${a.exactMatchCount}/${a.total}`);
    console.log(`Unchanged from input: ${a.unchangedFromInputCount}/${a.total}`);
    console.log(`Empty fix: ${a.emptyFixCount}/${a.total}`);
    console.log(`Missing mentions: ${a.missingMentionsCount}/${a.total}`);
    console.log(`Effort match: ${a.effortMatchCount}/${a.total}`);
    console.log(`Filename-shaped alt: ${a.filenameShapedAltCount}/${a.total}`);
  } else {
    const a = result.report.aggregate;
    console.log(`Correct: ${a.correct}/${a.total}`);
    // HARNESS-03/anti-fusion: false-PASS and false-ISSUE are printed as TWO
    // SEPARATE lines, never one blended figure. This is one of the two
    // surfaces a human actually reads (the other is the serialised report).
    console.log(`False-PASS: ${a.falsePass}/${a.total}`);
    console.log(`False-ISSUE: ${a.falseIssue}/${a.total}`);
    console.log(`Uncertain: ${a.uncertain}/${a.total}`);
    console.log(`Alt classification mismatch: ${a.altClassificationMismatchCount}/${a.total}`);
    console.log(`Suggested-alt filename-shaped: ${a.suggestedAltFilenameShapedCount}/${a.total}`);
    console.log(
      `Suggested-alt empty-despite-informational: ${a.suggestedAltEmptyDespiteInformationalCount}/${a.total}`,
    );
  }
}

// ---------------------------------------------------------------------------
// eval verdict (Phase 85, BARS-02/BARS-03, D-85-1, D-85-7) — a THIN wrapper
// over the library comparators (verdict.ts / verdict-analyse-visual.ts).
// This command never dials a provider, never spends, and accepts no live
// mode — it reads two report files a maintainer already has and judges them
// against the pre-registered bar (see the structural option-list test,
// cli-verdict.test.ts).
// ---------------------------------------------------------------------------

/** Prints a power assessment's sufficiency and, if insufficient, every named reason -- shared by both capabilities' print functions so the shape stays identical. */
function printPowerAssessment(label: string, power: PowerAssessment): void {
  console.log(`${label} power sufficient: ${power.sufficient}`);
  if (!power.sufficient) {
    for (const reason of power.reasons) {
      console.log(`${label} power insufficiency reason: ${describeInsufficiencyReason(reason)}`);
    }
  }
}

function printGenerateFixVerdictSummary(verdict: GenerateFixVerdict): void {
  console.log(`Capability: generate-fix`);
  console.log(`Outcome: ${verdict.outcome}`);
  console.log(`Gating axis: ${verdict.gatingAxis.counterName}`);
  console.log(`Baseline-better count: ${verdict.gatingAxis.baselineBetterCount}`);
  console.log(`Candidate-better count: ${verdict.gatingAxis.candidateBetterCount}`);
  console.log(`Margin items: ${verdict.gatingAxis.marginItems}`);
  printPowerAssessment('Non-inferiority clause', verdict.power);
  console.log(`Licence: ${verdict.licence}`);
}

/**
 * `analyse-visual`'s two mechanisms are printed as SEPARATE lines, always,
 * with the derived overall word never standing alone (D-85-1). This is the
 * CLI-layer half of the same anti-fusion discipline `printEvalSummary`
 * already applies to the harness's own False-PASS/False-ISSUE counters —
 * see cli-verdict.test.ts's positive label-set pin, which fails the moment
 * these two clause lines are replaced by one blended figure.
 */
function printAnalyseVisualVerdictSummary(verdict: AnalyseVisualVerdict): void {
  console.log(`Capability: analyse-visual`);
  console.log(`False-PASS gate: ${verdict.falsePassGate.outcome}`);
  console.log(`False-PASS gate licence: ${verdict.falsePassGate.licence}`);
  console.log(`Non-inferiority clause: ${verdict.nonInferiorityClause.outcome}`);
  printPowerAssessment('Non-inferiority clause', verdict.nonInferiorityClause.power);
  console.log(`Non-inferiority clause licence: ${verdict.nonInferiorityClause.licence}`);
  console.log(`Overall: ${verdict.overallVerdict.outcome}`);
  console.log(`Overall note: ${verdict.overallVerdict.derivedNote}`);
  console.log(`Overall licence: ${verdict.overallVerdict.licence}`);
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name('luqen-llm')
    .description('Luqen LLM Service CLI')
    .version(VERSION);

  // ---- serve ----
  program
    .command('serve')
    .description('Start the LLM provider management service')
    .option('--port <number>', 'Port to listen on', '4200')
    .action(async (opts: { port: string }) => {
      const port = parseInt(opts.port, 10);
      const config = loadConfig();
      const db = createDbAdapter();
      await db.initialize();

      const { createServer } = await import('./api/server.js');
      const { createTokenSigner, createTokenVerifier } = await import('./auth/oauth.js');

      let signToken: import('./auth/oauth.js').TokenSigner;
      let verifyToken: import('./auth/oauth.js').TokenVerifier;
      try {
        const privateKeyPem = readFileSync(resolve(config.jwtKeyPair.privateKeyPath), 'utf-8');
        const publicKeyPem = readFileSync(resolve(config.jwtKeyPair.publicKeyPath), 'utf-8');
        signToken = await createTokenSigner(privateKeyPem);
        verifyToken = await createTokenVerifier(publicKeyPem);
      } catch {
        console.error('Warning: JWT key files not found. Run "luqen-llm keys generate" first.');
        process.exit(1);
      }

      const app = await createServer({
        db,
        signToken,
        verifyToken,
        tokenExpiry: config.tokenExpiry,
        corsOrigins: config.cors.origin,
        rateLimitRead: config.rateLimit.read,
        rateLimitWindowMs: config.rateLimit.windowMs,
        logger: true,
      });

      await app.listen({ port, host: config.host });
      console.log(`LLM service running on port ${port}`);
    });

  // ---- clients create ----
  const clients = program.command('clients').description('Manage OAuth2 clients');

  clients
    .command('create')
    .description('Create a new OAuth2 client')
    .requiredOption('--name <name>', 'Client display name')
    .option('--scopes <scopes>', 'Comma-separated scopes', 'read')
    .option('--org <orgId>', 'Organization ID', 'system')
    .action(async (opts: { name: string; scopes: string; org: string }) => {
      const db = createDbAdapter();
      await db.initialize();
      const { hashClientSecret, generateClientCredentials } = await import('./auth/oauth.js');
      const { clientId, clientSecret } = generateClientCredentials();
      const secretHash = await hashClientSecret(clientSecret);
      const scopes = opts.scopes.split(',').map((s) => s.trim());
      const client = await db.createClient({
        name: opts.name,
        secretHash,
        scopes,
        grantTypes: ['client_credentials'],
        orgId: opts.org,
      });
      console.log('Client created:');
      console.log(`  ID:     ${client.id}`);
      console.log(`  Secret: ${clientSecret}`);
      console.log(`  Scopes: ${scopes.join(', ')}`);
      await db.close();
    });

  clients
    .command('list')
    .description('List all OAuth2 clients')
    .action(async () => {
      const db = createDbAdapter();
      await db.initialize();
      const list = await db.listClients();
      if (list.length === 0) {
        console.log('No clients configured.');
      } else {
        for (const c of list) {
          console.log(`  ${c.id} -- ${c.name} [${c.scopes.join(', ')}] org:${c.orgId}`);
        }
      }
      await db.close();
    });

  // ---- users create ----
  const users = program.command('users').description('Manage users');

  users
    .command('create')
    .description('Create a new user')
    .requiredOption('--username <username>', 'Username')
    .requiredOption('--password <password>', 'Password')
    .option('--role <role>', 'Role (viewer|editor|admin)', 'admin')
    .action(async (opts: { username: string; password: string; role: string }) => {
      const db = createDbAdapter();
      await db.initialize();
      const { hashPassword } = await import('./auth/oauth.js');
      const passwordHash = await hashPassword(opts.password);
      const user = await db.createUser({
        username: opts.username,
        passwordHash,
        role: opts.role,
      });
      console.log(`User created: ${user.username} (${user.role})`);
      await db.close();
    });

  // ---- keys generate ----
  program
    .command('keys')
    .command('generate')
    .description('Generate RS256 key pair for JWT')
    .option('--dir <dir>', 'Output directory', './keys')
    .action(async (opts: { dir: string }) => {
      const { generateKeyPair, exportPKCS8, exportSPKI } = await import('jose');
      const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
      const privatePem = await exportPKCS8(privateKey);
      const publicPem = await exportSPKI(publicKey);
      mkdirSync(opts.dir, { recursive: true });
      writeFileSync(resolve(opts.dir, 'private.pem'), privatePem);
      writeFileSync(resolve(opts.dir, 'public.pem'), publicPem);
      console.log(`Keys written to ${opts.dir}/`);
    });

  // ---- providers ----
  const providers = program.command('providers').description('Manage LLM providers');

  providers
    .command('create')
    .description('Register a new LLM provider')
    .requiredOption('--name <name>', 'Provider display name')
    .requiredOption('--type <type>', 'Provider type: ollama | openai | anthropic | gemini')
    .requiredOption('--url <url>', 'Provider base URL')
    .option('--api-key <key>', 'API key (required for openai/anthropic/gemini)')
    .option('--timeout <ms>', 'Request timeout in milliseconds', '30000')
    .option('--db <path>', 'Path to database file')
    .action(async (opts: { name: string; type: string; url: string; apiKey?: string; timeout: string; db?: string }) => {
      const db = createDbAdapter(opts.db);
      await db.initialize();
      const provider = await db.createProvider({
        name: opts.name,
        type: opts.type as import('./types.js').ProviderType,
        baseUrl: opts.url,
        apiKey: opts.apiKey,
        timeout: parseInt(opts.timeout, 10),
      });
      console.log(JSON.stringify(provider));
      await db.close();
    });

  providers
    .command('list')
    .description('List all providers')
    .option('--db <path>', 'Path to database file')
    .action(async (opts: { db?: string }) => {
      const db = createDbAdapter(opts.db);
      await db.initialize();
      const list = await db.listProviders();
      if (list.length === 0) {
        console.log('No providers configured.');
      } else {
        for (const p of list) {
          console.log(`  ${p.id} -- ${p.name} [${p.type}] ${p.baseUrl} status:${p.status}`);
        }
      }
      await db.close();
    });

  // ---- models ----
  const models = program.command('models').description('Manage registered models');

  models
    .command('register')
    .description('Register a model under a provider')
    .requiredOption('--name <name>', 'Model display name')
    .requiredOption('--provider-id <id>', 'Provider ID')
    .option('--model-id <id>', 'Model identifier on the provider (defaults to --name)')
    .option('--db <path>', 'Path to database file')
    .action(async (opts: { name: string; providerId: string; modelId?: string; db?: string }) => {
      const db = createDbAdapter(opts.db);
      await db.initialize();
      const model = await db.createModel({
        providerId: opts.providerId,
        modelId: opts.modelId ?? opts.name,
        displayName: opts.name,
      });
      console.log(JSON.stringify(model));
      await db.close();
    });

  models
    .command('list')
    .description('List registered models')
    .option('--provider-id <id>', 'Filter by provider ID')
    .option('--db <path>', 'Path to database file')
    .action(async (opts: { providerId?: string; db?: string }) => {
      const db = createDbAdapter(opts.db);
      await db.initialize();
      const list = await db.listModels(opts.providerId);
      if (list.length === 0) {
        console.log('No models registered.');
      } else {
        for (const m of list) {
          console.log(`  ${m.id} -- ${m.displayName} [${m.modelId}] provider:${m.providerId}`);
        }
      }
      await db.close();
    });

  // ---- capabilities ----
  const capabilities = program.command('capabilities').description('Manage capability assignments');

  capabilities
    .command('assign')
    .description('Assign a model to a capability')
    .requiredOption('--capability <name>', 'Capability name (extract-requirements | generate-fix | analyse-report | discover-branding | agent-conversation)')
    .requiredOption('--model-id <id>', 'Model ID to assign')
    .option('--priority <n>', 'Assignment priority (lower = higher priority)', '10')
    .option('--org <orgId>', 'Organisation ID (default: system)', 'system')
    .option('--db <path>', 'Path to database file')
    .action(async (opts: { capability: string; modelId: string; priority: string; org: string; db?: string }) => {
      const db = createDbAdapter(opts.db);
      await db.initialize();
      const assignment = await db.assignCapability({
        capability: opts.capability as import('./types.js').CapabilityName,
        modelId: opts.modelId,
        priority: parseInt(opts.priority, 10),
        orgId: opts.org,
      });
      console.log(`Assigned ${assignment.capability} → model ${assignment.modelId} (priority ${assignment.priority})`);
      await db.close();
    });

  capabilities
    .command('list')
    .description('List all capability assignments')
    .option('--db <path>', 'Path to database file')
    .action(async (opts: { db?: string }) => {
      const db = createDbAdapter(opts.db);
      await db.initialize();
      const list = await db.listCapabilityAssignments();
      if (list.length === 0) {
        console.log('No capability assignments.');
      } else {
        for (const a of list) {
          console.log(`  ${a.capability} → model ${a.modelId} priority:${a.priority} org:${a.orgId}`);
        }
      }
      await db.close();
    });

  // ---- eval (Phase 84 scoring harness — measurement, no verdict) ----
  const evalGroup = program
    .command('eval')
    .description('Run the Phase 84 scoring harness against a reference set (measurement only — no bar, no verdict)');

  evalGroup
    .command('run')
    .description('Run a reference set through a capability and score it. Replay mode is the default: free, deterministic, no credentials.')
    .requiredOption('--capability <name>', `Capability to score (${EVAL_CAPABILITIES.join(' | ')})`)
    .option('--mode <mode>', 'replay (default) or live', 'replay')
    .option('--set-version <version>', 'Reference set version', 'v1')
    .option('--fixtures <path>', 'Override the replay fixture file (defaults to the committed synthetic fixture for the chosen capability)')
    .option('--provider-type <type>', 'LIVE MODE ONLY: ollama | openai | anthropic | gemini')
    .option('--endpoint <url>', 'LIVE MODE ONLY: provider base URL')
    .option('--model-id <id>', 'LIVE MODE ONLY: provider-native model id')
    .option('--i-acknowledge-spend', 'LIVE MODE ONLY: explicit acknowledgement that this run spends money against a real provider and is non-deterministic', false)
    .option('--out <path>', 'Write the full JSON report to this path')
    .action(async (opts: {
      capability: string;
      mode: string;
      setVersion: string;
      fixtures?: string;
      providerType?: string;
      endpoint?: string;
      modelId?: string;
      iAcknowledgeSpend?: boolean;
      out?: string;
    }) => {
      // Validate the capability BEFORE anything else runs — mirrors the
      // strict enum checks the routes already do (capabilities-exec.ts).
      if (!isEvalCapability(opts.capability)) {
        console.error(`error: --capability must be one of: ${EVAL_CAPABILITIES.join(', ')} (got "${opts.capability}")`);
        process.exitCode = 1;
        return;
      }
      const capability = opts.capability;

      if (opts.mode !== 'replay' && opts.mode !== 'live') {
        console.error(`error: --mode must be "replay" or "live" (got "${opts.mode}")`);
        process.exitCode = 1;
        return;
      }
      const mode: RunMode = opts.mode;

      let provider: RunHarnessProvider | undefined;
      let modelIdOnProvider: string | undefined;
      let adapterFactoryFor: (itemId: string) => (type: string) => import('./providers/types.js').LLMProviderAdapter;

      if (mode === 'live') {
        // Every one of these is required, and the refusal below runs BEFORE
        // any adapter is built or any db is seeded — no network call is
        // ever attempted when any one of them is missing (T-84-11).
        const missing: string[] = [];
        if (!opts.providerType) missing.push('--provider-type');
        if (!opts.endpoint) missing.push('--endpoint');
        if (!opts.modelId) missing.push('--model-id');
        if (!opts.iAcknowledgeSpend) missing.push('--i-acknowledge-spend');
        const apiKey = process.env[EVAL_LIVE_API_KEY_ENV];
        if (!apiKey) missing.push(`${EVAL_LIVE_API_KEY_ENV} environment variable`);
        if (missing.length > 0) {
          console.error(
            `error: live mode requires all of the following, missing: ${missing.join(', ')}`,
          );
          process.exitCode = 1;
          return;
        }

        provider = {
          type: opts.providerType as ProviderType,
          baseUrl: opts.endpoint as string,
          apiKey,
          timeout: 30000,
        };
        modelIdOnProvider = opts.modelId;
        // The REAL createAdapter from providers/registry.ts — the identical
        // factory the HTTP route and the MCP tools hand to
        // executeGenerateFix/executeAnalyseVisual. Never a re-implemented
        // dialing path.
        adapterFactoryFor = () => (type: string) => createAdapter(type as ProviderType);
      } else {
        const fixturesPath = opts.fixtures ?? join(PACKAGE_ROOT, REPLAY_FIXTURE_FILES[capability]);
        const responsesByItemId = loadReplayResponses(fixturesPath);
        adapterFactoryFor = (itemId: string) => () =>
          createFixtureAdapter({ responsesByItemId, currentItemId: () => itemId });
      }

      const result: RunHarnessResult =
        capability === 'generate-fix'
          ? await runHarness({
              capability: 'generate-fix',
              mode,
              packageRoot: PACKAGE_ROOT,
              setVersion: opts.setVersion,
              adapterFactoryFor,
              provider,
              modelIdOnProvider,
            })
          : await runHarness({
              capability: 'analyse-visual',
              mode,
              packageRoot: PACKAGE_ROOT,
              setVersion: opts.setVersion,
              adapterFactoryFor,
              provider,
              modelIdOnProvider,
            });

      printEvalSummary(result);

      if (opts.out) {
        // Same pretty-printed shape as report.ts's serialiseReport(); called
        // via JSON.stringify directly here because result.report is a
        // discriminated union (GenerateFixReport | AnalyseVisualReport) and
        // serialiseReport's generic signature does not narrow across it.
        writeFileSync(opts.out, JSON.stringify(result.report, null, 2));
        console.log(`Report written to ${opts.out}`);
      }
    });

  evalGroup
    .command('compare')
    .description('Compare two written eval reports; refuses when their run functions differ on anything but timestamp')
    .requiredOption('--a <path>', 'First report JSON path')
    .requiredOption('--b <path>', 'Second report JSON path')
    .action((opts: { a: string; b: string }) => {
      const reportA = JSON.parse(readFileSync(opts.a, 'utf-8')) as { runFunction: RunFunction };
      const reportB = JSON.parse(readFileSync(opts.b, 'utf-8')) as { runFunction: RunFunction };
      try {
        assertComparable(reportA.runFunction, reportB.runFunction);
        console.log('Run functions are comparable (identical apart from timestamp).');
      } catch (err) {
        if (err instanceof RunFunctionMismatchError) {
          console.error(`error: reports are not comparable — differing fields: ${err.differingFields.join(', ')}`);
          process.exitCode = 1;
          return;
        }
        throw err;
      }
    });

  evalGroup
    .command('verdict')
    .description(
      'Judge two written eval reports against the Phase 85 pre-registered decision bar. Reads two files a maintainer already has -- never dials a provider, never spends, never accepts a live mode (D-85-7).',
    )
    .requiredOption('--baseline <path>', 'Baseline report JSON path')
    .requiredOption('--candidate <path>', 'Candidate report JSON path')
    .option('--out <path>', 'Write the full JSON verdict to this path')
    .action((opts: { baseline: string; candidate: string; out?: string }) => {
      let capability: string;
      try {
        const probe = JSON.parse(readFileSync(opts.baseline, 'utf-8')) as { runFunction?: { capability?: string } };
        capability = probe.runFunction?.capability ?? '';
      } catch (err) {
        console.error(
          `error: could not read/parse --baseline "${opts.baseline}": ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exitCode = 1;
        return;
      }

      try {
        const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');

        // The CLI has no replication artifact to read yet (86-03 wires the
        // measured value in) -- an explicit honest literal at the call site
        // is the point of this required parameter: the fact that no
        // instability has been measured now has to be written down by
        // whoever calls, instead of being supplied silently by the callee.
        const runToRunInstability: RunToRunInstability = { state: 'not-yet-measured' };

        if (capability === 'generate-fix') {
          const baseline = JSON.parse(readFileSync(opts.baseline, 'utf-8')) as GenerateFixReport;
          const candidate = JSON.parse(readFileSync(opts.candidate, 'utf-8')) as GenerateFixReport;
          const verdict = compareGenerateFix(bar, baseline, candidate, runToRunInstability);
          printGenerateFixVerdictSummary(verdict);
          if (opts.out) {
            writeFileSync(opts.out, serialiseVerdict(verdict));
            console.log(`Verdict written to ${opts.out}`);
          }
          if (verdict.outcome === 'FAIL') process.exitCode = 1;
        } else if (capability === 'analyse-visual') {
          const baseline = JSON.parse(readFileSync(opts.baseline, 'utf-8')) as AnalyseVisualReport;
          const candidate = JSON.parse(readFileSync(opts.candidate, 'utf-8')) as AnalyseVisualReport;
          const verdict = compareAnalyseVisual(bar, baseline, candidate, runToRunInstability);
          printAnalyseVisualVerdictSummary(verdict);
          if (opts.out) {
            writeFileSync(opts.out, serialiseAnalyseVisualVerdict(verdict));
            console.log(`Verdict written to ${opts.out}`);
          }
          if (verdict.overallVerdict.outcome === 'FAIL') process.exitCode = 1;
        } else {
          console.error(
            `error: --baseline report's runFunction.capability must be "generate-fix" or "analyse-visual" (found ${JSON.stringify(capability)})`,
          );
          process.exitCode = 1;
        }
      } catch (err) {
        console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
      }
    });

  return program;
}

// Auto-run when invoked directly
const isMain = process.argv[1] && (
  process.argv[1].endsWith('/cli.js') || process.argv[1].endsWith('/cli.ts')
);

if (isMain) {
  const program = createProgram();
  program.parseAsync(process.argv).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
