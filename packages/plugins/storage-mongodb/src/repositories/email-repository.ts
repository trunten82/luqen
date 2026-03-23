import type { Collection, Db } from 'mongodb';

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

interface SmtpConfig {
  readonly id: string;
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly username: string;
  readonly password: string;
  readonly fromAddress: string;
  readonly fromName: string;
  readonly orgId: string;
}

interface SmtpConfigInput {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly username: string;
  readonly password: string;
  readonly fromAddress: string;
  readonly fromName?: string;
  readonly orgId?: string;
}

interface EmailReport {
  readonly id: string;
  readonly name: string;
  readonly siteUrl: string;
  readonly recipients: string;
  readonly frequency: string;
  readonly format: string;
  readonly includeCsv: boolean;
  readonly nextSendAt: string;
  readonly lastSentAt: string | null;
  readonly enabled: boolean;
  readonly createdBy: string;
  readonly orgId: string;
}

interface CreateEmailReportInput {
  readonly id: string;
  readonly name: string;
  readonly siteUrl: string;
  readonly recipients: string;
  readonly frequency: string;
  readonly format?: string;
  readonly includeCsv?: boolean;
  readonly nextSendAt: string;
  readonly createdBy: string;
  readonly orgId?: string;
}

// ---------------------------------------------------------------------------
// MongoDB document types
// ---------------------------------------------------------------------------

interface SmtpDoc {
  _id: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  fromAddress: string;
  fromName: string;
  orgId: string;
}

interface EmailReportDoc {
  _id: string;
  name: string;
  siteUrl: string;
  recipients: string;
  frequency: string;
  format: string;
  includeCsv: boolean;
  nextSendAt: string;
  lastSentAt: string | null;
  enabled: boolean;
  createdBy: string;
  orgId: string;
  createdAtTs: string;
}

function smtpDocToRecord(doc: SmtpDoc): SmtpConfig {
  return {
    id: doc._id,
    host: doc.host,
    port: doc.port,
    secure: doc.secure,
    username: doc.username,
    password: doc.password,
    fromAddress: doc.fromAddress,
    fromName: doc.fromName,
    orgId: doc.orgId,
  };
}

function emailReportDocToRecord(doc: EmailReportDoc): EmailReport {
  return {
    id: doc._id,
    name: doc.name,
    siteUrl: doc.siteUrl,
    recipients: doc.recipients,
    frequency: doc.frequency,
    format: doc.format,
    includeCsv: doc.includeCsv,
    nextSendAt: doc.nextSendAt,
    lastSentAt: doc.lastSentAt,
    enabled: doc.enabled,
    createdBy: doc.createdBy,
    orgId: doc.orgId,
  };
}

// ---------------------------------------------------------------------------
// MongoEmailRepository
// ---------------------------------------------------------------------------

export class MongoEmailRepository {
  private readonly smtpCollection: Collection<SmtpDoc>;
  private readonly reportCollection: Collection<EmailReportDoc>;

  constructor(db: Db) {
    this.smtpCollection = db.collection<SmtpDoc>('smtp_config');
    this.reportCollection = db.collection<EmailReportDoc>('email_reports');
  }

  async getSmtpConfig(orgId = 'system'): Promise<SmtpConfig | null> {
    const doc = await this.smtpCollection.findOne({ orgId });
    return doc !== null ? smtpDocToRecord(doc) : null;
  }

  async upsertSmtpConfig(data: SmtpConfigInput): Promise<void> {
    const orgId = data.orgId ?? 'system';
    const id = data.orgId ?? 'default';

    await this.smtpCollection.updateOne(
      { _id: id },
      {
        $set: {
          host: data.host,
          port: data.port,
          secure: data.secure,
          username: data.username,
          password: data.password,
          fromAddress: data.fromAddress,
          fromName: data.fromName ?? 'Luqen',
          orgId,
        },
        $setOnInsert: { _id: id },
      },
      { upsert: true },
    );
  }

  async listEmailReports(orgId?: string): Promise<EmailReport[]> {
    const query = orgId !== undefined ? { orgId } : {};
    const docs = await this.reportCollection
      .find(query)
      .sort({ createdAtTs: -1 })
      .toArray();
    return docs.map(emailReportDocToRecord);
  }

  async getEmailReport(id: string): Promise<EmailReport | null> {
    const doc = await this.reportCollection.findOne({ _id: id });
    return doc !== null ? emailReportDocToRecord(doc) : null;
  }

  async createEmailReport(data: CreateEmailReportInput): Promise<EmailReport> {
    const doc: EmailReportDoc = {
      _id: data.id,
      name: data.name,
      siteUrl: data.siteUrl,
      recipients: data.recipients,
      frequency: data.frequency,
      format: data.format ?? 'pdf',
      includeCsv: data.includeCsv ?? false,
      nextSendAt: data.nextSendAt,
      lastSentAt: null,
      enabled: true,
      createdBy: data.createdBy,
      orgId: data.orgId ?? 'system',
      createdAtTs: new Date().toISOString(),
    };

    await this.reportCollection.insertOne(doc);

    const created = await this.getEmailReport(data.id);
    if (created === null) {
      throw new Error(`Failed to retrieve email report after creation: ${data.id}`);
    }
    return created;
  }

  async updateEmailReport(id: string, data: Partial<{
    name: string;
    siteUrl: string;
    recipients: string;
    frequency: string;
    format: string;
    includeCsv: boolean;
    nextSendAt: string;
    lastSentAt: string;
    enabled: boolean;
  }>): Promise<void> {
    const setFields: Record<string, unknown> = {};

    if (data.name !== undefined) setFields['name'] = data.name;
    if (data.siteUrl !== undefined) setFields['siteUrl'] = data.siteUrl;
    if (data.recipients !== undefined) setFields['recipients'] = data.recipients;
    if (data.frequency !== undefined) setFields['frequency'] = data.frequency;
    if (data.format !== undefined) setFields['format'] = data.format;
    if (data.includeCsv !== undefined) setFields['includeCsv'] = data.includeCsv;
    if (data.nextSendAt !== undefined) setFields['nextSendAt'] = data.nextSendAt;
    if (data.lastSentAt !== undefined) setFields['lastSentAt'] = data.lastSentAt;
    if (data.enabled !== undefined) setFields['enabled'] = data.enabled;

    if (Object.keys(setFields).length === 0) return;

    await this.reportCollection.updateOne({ _id: id }, { $set: setFields });
  }

  async deleteEmailReport(id: string): Promise<void> {
    await this.reportCollection.deleteOne({ _id: id });
  }

  async getDueEmailReports(): Promise<EmailReport[]> {
    const now = new Date().toISOString();
    const docs = await this.reportCollection
      .find({ nextSendAt: { $lte: now }, enabled: true })
      .toArray();
    return docs.map(emailReportDocToRecord);
  }
}
