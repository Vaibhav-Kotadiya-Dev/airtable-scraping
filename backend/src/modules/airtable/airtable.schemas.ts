import mongoose, { Schema } from "mongoose";

export type AirtableIntegrationDoc = {
  provider: "airtable";
  integrationId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scopes?: string;
  lastSyncedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
};

const AirtableIntegrationSchema = new Schema<AirtableIntegrationDoc>(
  {
    provider: { type: String, enum: ["airtable"], required: true, default: "airtable" },
    integrationId: { type: String, required: true, index: true },
    accessToken: { type: String, required: true },
    refreshToken: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    scopes: { type: String },
    lastSyncedAt: { type: Date },
  },
  { timestamps: true },
);

AirtableIntegrationSchema.index({ integrationId: 1 }, { unique: true });

export type AirtableOAuthStateDoc = {
  state: string;
  integrationId: string;
  codeVerifier: string;
  createdAt?: Date;
};

const AirtableOAuthStateSchema = new Schema<AirtableOAuthStateDoc>(
  {
    state: { type: String, required: true, unique: true },
    integrationId: { type: String, required: true, index: true },
    codeVerifier: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// TTL: delete automatically after 15 minutes.
AirtableOAuthStateSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 15 });

export type AirtableBaseDoc = {
  integrationId: string;
  airtableBaseId: string;
  name?: string;
};

const AirtableBaseSchema = new Schema<AirtableBaseDoc>(
  {
    integrationId: { type: String, required: true, index: true },
    airtableBaseId: { type: String, required: true },
    name: { type: String },
  },
  { timestamps: true },
);

AirtableBaseSchema.index({ integrationId: 1, airtableBaseId: 1 }, { unique: true });

export type AirtableTableDoc = {
  integrationId: string;
  baseId: string;
  airtableTableId: string;
  name?: string;
};

const AirtableTableSchema = new Schema<AirtableTableDoc>(
  {
    integrationId: { type: String, required: true, index: true },
    baseId: { type: String, required: true, index: true },
    airtableTableId: { type: String, required: true },
    name: { type: String },
  },
  { timestamps: true },
);

AirtableTableSchema.index(
  { integrationId: 1, baseId: 1, airtableTableId: 1 },
  { unique: true },
);

export type AirtableTicketDoc = {
  integrationId: string;
  baseId: string;
  tableId: string;
  recordId: string;
  fields: Record<string, unknown>;
  createdTime?: string;
  updatedTime?: string;
};

const AirtableTicketSchema = new Schema<AirtableTicketDoc>(
  {
    integrationId: { type: String, required: true, index: true },
    baseId: { type: String, required: true, index: true },
    tableId: { type: String, required: true, index: true },
    recordId: { type: String, required: true },
    fields: { type: Schema.Types.Mixed, required: true },
    createdTime: { type: String },
    updatedTime: { type: String },
  },
  { timestamps: true },
);

AirtableTicketSchema.index(
  { integrationId: 1, baseId: 1, tableId: 1, recordId: 1 },
  { unique: true },
);

export type AirtableUserDoc = {
  integrationId: string;
  airtableUserId: string;
  name?: string;
  email?: string;
};

const AirtableUserSchema = new Schema<AirtableUserDoc>(
  {
    integrationId: { type: String, required: true, index: true },
    airtableUserId: { type: String, required: true, index: true },
    name: { type: String },
    email: { type: String },
  },
  { timestamps: true },
);

AirtableUserSchema.index(
  { integrationId: 1, airtableUserId: 1 },
  { unique: true },
);

export const AirtableIntegrationModel =
  (mongoose.models.AirtableIntegration as mongoose.Model<AirtableIntegrationDoc> | undefined) ??
  mongoose.model<AirtableIntegrationDoc>("AirtableIntegration", AirtableIntegrationSchema);

export const AirtableOAuthStateModel =
  (mongoose.models.AirtableOAuthState as mongoose.Model<AirtableOAuthStateDoc> | undefined) ??
  mongoose.model<AirtableOAuthStateDoc>("AirtableOAuthState", AirtableOAuthStateSchema);

export const AirtableBaseModel =
  (mongoose.models.AirtableBase as mongoose.Model<AirtableBaseDoc> | undefined) ??
  mongoose.model<AirtableBaseDoc>("AirtableBase", AirtableBaseSchema);

export const AirtableTableModel =
  (mongoose.models.AirtableTable as mongoose.Model<AirtableTableDoc> | undefined) ??
  mongoose.model<AirtableTableDoc>("AirtableTable", AirtableTableSchema);

export const AirtableTicketModel =
  (mongoose.models.AirtableTicket as mongoose.Model<AirtableTicketDoc> | undefined) ??
  mongoose.model<AirtableTicketDoc>("AirtableTicket", AirtableTicketSchema);

export const AirtableUserModel =
  (mongoose.models.AirtableUser as mongoose.Model<AirtableUserDoc> | undefined) ??
  mongoose.model<AirtableUserDoc>("AirtableUser", AirtableUserSchema);

