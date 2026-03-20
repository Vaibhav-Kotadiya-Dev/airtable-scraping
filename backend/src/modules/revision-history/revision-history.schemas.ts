import mongoose, { Schema } from "mongoose";

export type RevisionHistoryActivity = {
  uuid: string;
  issueId: string;
  columnType: string;
  oldValue: string;
  newValue: string;
  createdDate: Date;
  authoredBy: string;
};

export type RevisionHistoryActivityDoc = RevisionHistoryActivity & {
  integrationId: string;
  source: "airtable-web";
};

const RevisionHistoryActivitySchema = new Schema<RevisionHistoryActivityDoc>(
  {
    integrationId: { type: String, required: true, index: true },
    source: { type: String, enum: ["airtable-web"], required: true, default: "airtable-web" },
    uuid: { type: String, required: true },
    issueId: { type: String, required: true, index: true },
    columnType: { type: String, required: true },
    oldValue: { type: String, required: true },
    newValue: { type: String, required: true },
    createdDate: { type: Date, required: true },
    authoredBy: { type: String, required: true },
  },
  { timestamps: true },
);

RevisionHistoryActivitySchema.index({ integrationId: 1, issueId: 1, uuid: 1 }, { unique: true });

export const RevisionHistoryActivityModel =
  (mongoose.models.RevisionHistoryActivity as mongoose.Model<RevisionHistoryActivityDoc> | undefined) ??
  mongoose.model<RevisionHistoryActivityDoc>(
    "RevisionHistoryActivity",
    RevisionHistoryActivitySchema,
  );

export type AirtableWebSessionDoc = {
  integrationId: string;
  cookies: Array<{ name: string; value: string; domain: string; path: string; expires?: number }>;
  requestContext?: {
    referer?: string;
    viewId?: string;
    userAgent?: string;
    acceptLanguage?: string;
    userLocale?: string;
    timeZone?: string;
    secChUa?: string;
    secChUaMobile?: string;
    secChUaPlatform?: string;
    pageLoadId?: string;
    codeVersion?: string;
    secretSocketId?: string;
  };
  expiresAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
};

type AirtableWebCookie = { name: string; value: string; domain: string; path: string; expires?: number };
const AirtableWebCookieSchema = new Schema<AirtableWebCookie>(
  {
    name: { type: String, required: true },
    value: { type: String, required: true },
    domain: { type: String, required: true },
    path: { type: String, required: true },
    expires: { type: Number, required: false },
  },
  { _id: false },
);

type AirtableWebRequestContext = NonNullable<AirtableWebSessionDoc["requestContext"]>;
const AirtableWebRequestContextSchema = new Schema<AirtableWebRequestContext>(
  {
    referer: { type: String },
    viewId: { type: String },
    userAgent: { type: String },
    acceptLanguage: { type: String },
    userLocale: { type: String },
    timeZone: { type: String },
    secChUa: { type: String },
    secChUaMobile: { type: String },
    secChUaPlatform: { type: String },
    pageLoadId: { type: String },
    codeVersion: { type: String },
    secretSocketId: { type: String },
  },
  { _id: false },
);

const AirtableWebSessionSchema = new Schema<AirtableWebSessionDoc>(
  {
    integrationId: { type: String, required: true, unique: true, index: true },
    cookies: { type: [AirtableWebCookieSchema], required: true },
    requestContext: { type: AirtableWebRequestContextSchema, required: false },
    expiresAt: { type: Date },
  },
  { timestamps: true },
);

export const AirtableWebSessionModel =
  (mongoose.models.AirtableWebSession as mongoose.Model<AirtableWebSessionDoc> | undefined) ??
  mongoose.model<AirtableWebSessionDoc>("AirtableWebSession", AirtableWebSessionSchema);

