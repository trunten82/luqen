export interface SlackMessage {
  readonly text: string;
  readonly channel?: string;
  readonly username?: string;
  readonly icon_emoji?: string;
  readonly blocks?: readonly SlackBlock[];
}

export interface SlackBlock {
  readonly type: string;
  readonly text?: { readonly type: string; readonly text: string };
  readonly fields?: readonly { readonly type: string; readonly text: string }[];
}

export class SlackClient {
  constructor(
    private readonly webhookUrl: string,
    private readonly defaultChannel?: string,
    private readonly defaultUsername?: string,
  ) {}

  async send(message: SlackMessage): Promise<void> {
    const payload = {
      ...message,
      channel: message.channel ?? this.defaultChannel,
      username: message.username ?? this.defaultUsername,
    };

    const response = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Slack webhook failed: HTTP ${response.status} - ${body}`);
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const url = new URL(this.webhookUrl);
      return url.hostname.includes('slack.com') || url.hostname.includes('hooks.slack.com');
    } catch {
      return false;
    }
  }
}
