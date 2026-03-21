import { createTransport, type Transporter } from 'nodemailer';

export interface EmailClientConfig {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly username: string;
  readonly password: string;
}

export interface EmailMessage {
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly attachments?: readonly EmailAttachment[];
}

export interface EmailAttachment {
  readonly filename: string;
  readonly content: string | Buffer;
  readonly contentType: string;
}

export class EmailClient {
  private readonly transport: Transporter;

  constructor(config: EmailClientConfig) {
    this.transport = createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.username,
        pass: config.password,
      },
    });
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transport.sendMail({
      from: message.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      attachments: message.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    });
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.transport.verify();
      return true;
    } catch {
      return false;
    }
  }

  close(): void {
    this.transport.close();
  }
}
