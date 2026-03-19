import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { checkCompliance } from '../engine/checker.js';
import { listPendingUpdates, proposeUpdate } from '../engine/proposals.js';
import type { DbAdapter } from '../db/adapter.js';

// ---- Task types ----

export type TaskStatus = 'submitted' | 'working' | 'completed' | 'failed';

export interface A2ATask {
  readonly id: string;
  readonly skill: string;
  readonly input: unknown;
  status: TaskStatus;
  result?: unknown;
  error?: string;
  readonly createdAt: string;
  updatedAt: string;
}

// ---- Known skills ----

const KNOWN_SKILLS = new Set([
  'compliance-check',
  'regulation-lookup',
  'update-management',
  'source-monitoring',
]);

// ---- Plugin options ----

export interface A2ATasksPluginOptions extends FastifyPluginOptions {
  db: DbAdapter;
}

// ---- In-memory task store ----

const taskStore = new Map<string, A2ATask>();

// ---- Skill handlers ----

async function handleComplianceCheck(input: unknown, db: DbAdapter): Promise<unknown> {
  const { jurisdictions = [], issues = [], includeOptional, sectors } = input as {
    jurisdictions?: string[];
    issues?: unknown[];
    includeOptional?: boolean;
    sectors?: string[];
  };

  return checkCompliance(
    {
      jurisdictions,
      issues: issues as Parameters<typeof checkCompliance>[0]['issues'],
      includeOptional,
      sectors,
    },
    db,
  );
}

async function handleRegulationLookup(input: unknown, db: DbAdapter): Promise<unknown> {
  const { jurisdictionId, status, scope } = input as {
    jurisdictionId?: string;
    status?: 'active' | 'draft' | 'repealed';
    scope?: 'public' | 'private' | 'all';
  };

  const regulations = await db.listRegulations({ jurisdictionId, status, scope });
  return { regulations };
}

async function handleUpdateManagement(input: unknown, db: DbAdapter): Promise<unknown> {
  const { action } = input as { action?: string };

  if (action === 'list-pending') {
    return { proposals: await listPendingUpdates(db) };
  }

  if (action === 'propose') {
    const { proposal } = input as { proposal?: Parameters<typeof proposeUpdate>[1] };
    if (proposal == null) {
      throw new Error('proposal is required for propose action');
    }
    return proposeUpdate(db, proposal);
  }

  // Default: list all
  const proposals = await db.listUpdateProposals();
  return { proposals };
}

async function handleSourceMonitoring(input: unknown, db: DbAdapter): Promise<unknown> {
  const { action } = input as { action?: string };

  if (action === 'list' || action == null) {
    return { sources: await db.listSources() };
  }

  return { sources: await db.listSources() };
}

// ---- Execute skill async ----

async function executeSkill(task: A2ATask, db: DbAdapter): Promise<void> {
  task.status = 'working';
  task.updatedAt = new Date().toISOString();

  try {
    let result: unknown;

    switch (task.skill) {
      case 'compliance-check':
        result = await handleComplianceCheck(task.input, db);
        break;
      case 'regulation-lookup':
        result = await handleRegulationLookup(task.input, db);
        break;
      case 'update-management':
        result = await handleUpdateManagement(task.input, db);
        break;
      case 'source-monitoring':
        result = await handleSourceMonitoring(task.input, db);
        break;
      default:
        throw new Error(`Unknown skill: ${task.skill}`);
    }

    task.result = result;
    task.status = 'completed';
  } catch (err) {
    task.error = err instanceof Error ? err.message : String(err);
    task.status = 'failed';
  }

  task.updatedAt = new Date().toISOString();
}

// ---- Fastify plugin ----

export async function registerA2aTasksPlugin(
  app: FastifyInstance,
  opts: A2ATasksPluginOptions,
): Promise<void> {
  const { db } = opts;

  // POST /a2a/tasks — submit a new task
  app.post('/a2a/tasks', async (request, reply) => {
    const body = request.body as { skill?: string; input?: unknown } | null;

    if (body == null || typeof body.skill !== 'string') {
      return reply.status(400).send({ error: 'skill is required' });
    }

    const { skill, input = {} } = body;

    if (!KNOWN_SKILLS.has(skill)) {
      return reply.status(400).send({
        error: `Unknown skill "${skill}". Valid skills: ${[...KNOWN_SKILLS].join(', ')}`,
      });
    }

    const now = new Date().toISOString();
    const task: A2ATask = {
      id: randomUUID(),
      skill,
      input,
      status: 'submitted',
      createdAt: now,
      updatedAt: now,
    };

    taskStore.set(task.id, task);

    // Execute asynchronously (fire and forget — task updates in-place)
    void executeSkill(task, db);

    return reply.send({
      id: task.id,
      skill: task.skill,
      status: task.status,
      createdAt: task.createdAt,
    });
  });

  // GET /a2a/tasks/:id — get task status
  app.get<{ Params: { id: string } }>('/a2a/tasks/:id', async (request, reply) => {
    const task = taskStore.get(request.params.id);
    if (task == null) {
      return reply.status(404).send({ error: `Task not found: ${request.params.id}` });
    }
    return reply.send(task);
  });

  // GET /a2a/tasks/:id/stream — SSE stream for task progress
  app.get<{ Params: { id: string } }>('/a2a/tasks/:id/stream', async (request, reply) => {
    const task = taskStore.get(request.params.id);
    if (task == null) {
      return reply.status(404).send({ error: `Task not found: ${request.params.id}` });
    }

    const raw = reply.raw;
    raw.setHeader('Content-Type', 'text/event-stream');
    raw.setHeader('Cache-Control', 'no-cache');
    raw.setHeader('Connection', 'keep-alive');
    raw.flushHeaders();

    const sendEvent = (data: unknown): void => {
      raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    sendEvent({ id: task.id, status: task.status });

    if (task.status === 'completed' || task.status === 'failed') {
      sendEvent(task);
      raw.end();
      return reply;
    }

    // Poll until complete
    const interval = setInterval(() => {
      sendEvent({ id: task.id, status: task.status });
      if (task.status === 'completed' || task.status === 'failed') {
        sendEvent(task);
        clearInterval(interval);
        raw.end();
      }
    }, 200);

    // Clean up on client disconnect
    raw.on('close', () => {
      clearInterval(interval);
    });

    return reply;
  });

  // GET /a2a/agents — list known peer agents
  app.get('/a2a/agents', async (_request, reply) => {
    // Return empty list; peers can be configured via config in production
    return reply.send([]);
  });
}
