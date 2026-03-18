import { createTransport } from 'nodemailer';

export interface EmailAttachment {
  readonly filename: string;
  readonly content: string | Buffer;
  readonly contentType: string;
}

export interface SmtpOptions {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly username: string;
  readonly password: string;
  readonly fromAddress: string;
  readonly fromName: string;
}

export interface SendEmailOptions {
  readonly smtp: SmtpOptions;
  readonly to: readonly string[];
  readonly subject: string;
  readonly html: string;
  readonly attachments?: readonly EmailAttachment[];
}

export async function sendEmail(options: SendEmailOptions): Promise<void> {
  const transport = createTransport({
    host: options.smtp.host,
    port: options.smtp.port,
    secure: options.smtp.secure,
    auth: {
      user: options.smtp.username,
      pass: options.smtp.password,
    },
  });

  await transport.sendMail({
    from: `"${options.smtp.fromName}" <${options.smtp.fromAddress}>`,
    to: options.to.join(', '),
    subject: options.subject,
    html: options.html,
    attachments: options.attachments?.map((a) => ({
      filename: a.filename,
      content: a.content,
      contentType: a.contentType,
    })),
  });
}

export async function testSmtpConnection(smtp: SmtpOptions): Promise<boolean> {
  try {
    const transport = createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: {
        user: smtp.username,
        pass: smtp.password,
      },
    });
    await transport.verify();
    return true;
  } catch {
    return false;
  }
}
