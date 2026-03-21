import type { FastifyInstance, FastifyPluginOptions } from 'fastify';

// ---- Agent card structure ----

export interface AgentSkill {
  readonly id: string;
  readonly description: string;
}

export interface AgentCard {
  readonly name: string;
  readonly description: string;
  readonly url: string;
  readonly version: string;
  readonly capabilities: {
    readonly streaming: boolean;
    readonly pushNotifications: boolean;
  };
  readonly authentication: {
    readonly schemes: readonly string[];
    readonly tokenEndpoint: string;
  };
  readonly skills: readonly AgentSkill[];
}

export const agentCard: AgentCard = {
  name: 'luqen-compliance',
  description:
    'Accessibility compliance rule engine — check WCAG issues against 60+ country-specific legal requirements, manage regulations, and monitor legal changes',
  url: process.env.COMPLIANCE_URL ?? 'http://localhost:4000',
  version: '1.0.0',
  capabilities: {
    streaming: true,
    pushNotifications: true,
  },
  authentication: {
    schemes: ['oauth2'],
    tokenEndpoint: '/api/v1/oauth/token',
  },
  skills: [
    {
      id: 'compliance-check',
      description:
        'Check accessibility issues against jurisdiction requirements and return compliance matrix',
    },
    {
      id: 'regulation-lookup',
      description:
        'Look up regulations and requirements by jurisdiction, sector, or WCAG criterion',
    },
    {
      id: 'update-management',
      description: 'Propose, review, approve, or reject updates to compliance rules',
    },
    {
      id: 'source-monitoring',
      description: 'Manage monitored legal sources and trigger scans for changes',
    },
  ],
};

// ---- Fastify plugin ----

export async function registerAgentCardPlugin(
  app: FastifyInstance,
  _opts: FastifyPluginOptions,
): Promise<void> {
  app.get('/.well-known/agent.json', async (_request, reply) => {
    return reply.send(agentCard);
  });
}
