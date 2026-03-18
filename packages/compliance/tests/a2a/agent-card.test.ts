import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { agentCard, registerAgentCardPlugin } from '../../src/a2a/agent-card.js';

describe('A2A Agent Card', () => {
  describe('agentCard object', () => {
    it('has a name field', () => {
      expect(agentCard.name).toBe('luqen-compliance');
    });

    it('has a description field', () => {
      expect(typeof agentCard.description).toBe('string');
      expect(agentCard.description.length).toBeGreaterThan(0);
    });

    it('has a url field', () => {
      expect(typeof agentCard.url).toBe('string');
    });

    it('has a version field', () => {
      expect(agentCard.version).toBe('1.0.0');
    });

    it('has capabilities with streaming', () => {
      expect(agentCard.capabilities.streaming).toBe(true);
    });

    it('has capabilities with pushNotifications', () => {
      expect(agentCard.capabilities.pushNotifications).toBe(true);
    });

    it('has authentication with oauth2 scheme', () => {
      expect(agentCard.authentication.schemes).toContain('oauth2');
    });

    it('has authentication tokenEndpoint', () => {
      expect(typeof agentCard.authentication.tokenEndpoint).toBe('string');
    });

    it('has 4 skills', () => {
      expect(agentCard.skills).toHaveLength(4);
    });

    it('has compliance-check skill', () => {
      const skill = agentCard.skills.find(s => s.id === 'compliance-check');
      expect(skill).toBeDefined();
      expect(typeof skill!.description).toBe('string');
    });

    it('has regulation-lookup skill', () => {
      const skill = agentCard.skills.find(s => s.id === 'regulation-lookup');
      expect(skill).toBeDefined();
    });

    it('has update-management skill', () => {
      const skill = agentCard.skills.find(s => s.id === 'update-management');
      expect(skill).toBeDefined();
    });

    it('has source-monitoring skill', () => {
      const skill = agentCard.skills.find(s => s.id === 'source-monitoring');
      expect(skill).toBeDefined();
    });
  });

  describe('Fastify plugin', () => {
    let app: ReturnType<typeof Fastify>;

    beforeAll(async () => {
      app = Fastify({ logger: false });
      await app.register(registerAgentCardPlugin);
      await app.ready();
    });

    afterAll(async () => {
      await app.close();
    });

    it('serves agent card at /.well-known/agent.json', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/.well-known/agent.json',
      });

      expect(response.statusCode).toBe(200);
    });

    it('returns JSON content-type', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/.well-known/agent.json',
      });

      expect(response.headers['content-type']).toContain('application/json');
    });

    it('returns the agent card data', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/.well-known/agent.json',
      });

      const body = JSON.parse(response.payload);
      expect(body.name).toBe('luqen-compliance');
      expect(body.version).toBe('1.0.0');
      expect(Array.isArray(body.skills)).toBe(true);
    });
  });
});
