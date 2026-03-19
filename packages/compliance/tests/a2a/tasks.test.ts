import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { registerA2aTasksPlugin } from '../../src/a2a/tasks.js';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';

describe('A2A Tasks', () => {
  let app: ReturnType<typeof Fastify>;
  let db: SqliteAdapter;

  beforeAll(async () => {
    db = new SqliteAdapter(':memory:');
    await db.initialize();

    app = Fastify({ logger: false });
    await app.register(registerA2aTasksPlugin, { db });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  describe('POST /a2a/tasks', () => {
    it('returns 200 with task id and submitted status', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/a2a/tasks',
        payload: {
          skill: 'compliance-check',
          input: {
            jurisdictions: ['EU'],
            issues: [],
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(typeof body.id).toBe('string');
      expect(['submitted', 'working', 'completed']).toContain(body.status);
    });

    it('returns 400 for missing skill', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/a2a/tasks',
        payload: { input: {} },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 for unknown skill', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/a2a/tasks',
        payload: { skill: 'unknown-skill', input: {} },
      });

      expect(response.statusCode).toBe(400);
    });

    it('accepts regulation-lookup skill', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/a2a/tasks',
        payload: {
          skill: 'regulation-lookup',
          input: { jurisdictionId: 'EU' },
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('accepts update-management skill', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/a2a/tasks',
        payload: {
          skill: 'update-management',
          input: { action: 'list-pending' },
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('accepts source-monitoring skill', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/a2a/tasks',
        payload: {
          skill: 'source-monitoring',
          input: { action: 'list' },
        },
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('GET /a2a/tasks/:id', () => {
    let taskId: string;

    beforeAll(async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/a2a/tasks',
        payload: {
          skill: 'compliance-check',
          input: { jurisdictions: ['EU'], issues: [] },
        },
      });
      taskId = JSON.parse(res.payload).id;
    });

    it('returns task by id', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/a2a/tasks/${taskId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.id).toBe(taskId);
    });

    it('returns 404 for unknown task id', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/a2a/tasks/nonexistent-id-xyz',
      });

      expect(response.statusCode).toBe(404);
    });

    it('completed task has result', async () => {
      // Wait briefly to ensure the async task completes
      await new Promise(r => setTimeout(r, 100));

      const response = await app.inject({
        method: 'GET',
        url: `/a2a/tasks/${taskId}`,
      });

      const body = JSON.parse(response.payload);
      expect(body.status).toBe('completed');
      expect(body.result).toBeDefined();
    });
  });

  describe('GET /a2a/agents', () => {
    it('returns a list of agents', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/a2a/agents',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(Array.isArray(body)).toBe(true);
    });
  });
});
