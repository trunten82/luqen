import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebserviceClient } from '../../src/scanner/webservice-client.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('WebserviceClient', () => {
  const client = new WebserviceClient('http://pa11y:3000', {});
  const clientWithAuth = new WebserviceClient('http://pa11y:3000', { Authorization: 'Bearer token' });

  beforeEach(() => { vi.clearAllMocks(); });

  it('creates a task via POST /tasks', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: 'task-1', name: 'Test', url: 'https://example.com' }) });
    const task = await client.createTask({ name: 'Test', url: 'https://example.com', standard: 'WCAG2AA' });
    expect(mockFetch).toHaveBeenCalledWith('http://pa11y:3000/tasks', expect.objectContaining({ method: 'POST' }));
    expect(task.id).toBe('task-1');
  });

  it('sends webserviceHeaders with every request', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: 'task-1' }) });
    await clientWithAuth.createTask({ name: 'Test', url: 'https://example.com', standard: 'WCAG2AA' });
    const callArgs = mockFetch.mock.calls[0][1] as RequestInit;
    const headers = callArgs.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer token');
  });

  it('triggers a run via POST /tasks/{id}/run', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 202 });
    await client.runTask('task-1');
    expect(mockFetch).toHaveBeenCalledWith('http://pa11y:3000/tasks/task-1/run', expect.objectContaining({ method: 'POST' }));
  });

  it('fetches results via GET /tasks/{id}/results', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [{ date: '2026-03-18', issues: [] }] });
    const results = await client.getResults('task-1');
    expect(results).toHaveLength(1);
    expect(results[0].date).toBe('2026-03-18');
  });

  it('deletes a task via DELETE /tasks/{id}', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 204 });
    await client.deleteTask('task-1');
    expect(mockFetch).toHaveBeenCalledWith('http://pa11y:3000/tasks/task-1', expect.objectContaining({ method: 'DELETE' }));
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error' });
    await expect(client.createTask({ name: 'Test', url: 'https://example.com', standard: 'WCAG2AA' })).rejects.toThrow(/500/);
  });
});
