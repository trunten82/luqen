export interface TeamsMessageCard {
  readonly '@type': 'MessageCard';
  readonly '@context': 'http://schema.org/extensions';
  readonly summary: string;
  readonly themeColor: string;
  readonly title: string;
  readonly sections: readonly TeamsSection[];
}

export interface TeamsSection {
  readonly activityTitle?: string;
  readonly facts?: readonly TeamsFact[];
  readonly text?: string;
}

export interface TeamsFact {
  readonly name: string;
  readonly value: string;
}

export class TeamsClient {
  constructor(private readonly webhookUrl: string) {}

  async send(card: TeamsMessageCard): Promise<void> {
    const response = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(card),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Teams webhook failed: HTTP ${response.status} - ${body}`);
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const url = new URL(this.webhookUrl);
      return (
        url.hostname.includes('office.com') ||
        url.hostname.includes('webhook.office.com') ||
        url.hostname.includes('outlook.office.com')
      );
    } catch {
      return false;
    }
  }
}
