// A2A agent card for the regulatory monitor agent.

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
  name: 'pally-monitor',
  description:
    'Regulatory monitor agent — watches legal sources for accessibility regulation changes and proposes updates to the compliance service',
  url: process.env.MONITOR_URL ?? 'http://localhost:4200',
  version: '0.1.0',
  capabilities: {
    streaming: false,
    pushNotifications: false,
  },
  authentication: {
    schemes: ['oauth2'],
    tokenEndpoint: '/api/v1/oauth/token',
  },
  skills: [
    {
      id: 'source-scanning',
      description:
        'Fetch monitored legal source URLs, compute SHA-256 content hashes, and detect pages that have changed since the last scan',
    },
    {
      id: 'change-detection',
      description:
        'Analyse content diffs to identify added, removed, and modified sections, then create UpdateProposal records in the compliance service for human review',
    },
  ],
};
