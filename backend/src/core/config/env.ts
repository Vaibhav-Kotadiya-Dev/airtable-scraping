import type { ParsedUrlQuery } from "node:querystring";

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getEnv(key: string): string | undefined {
  return process.env[key];
}

export const env = {
  nodeEnv: getEnv("NODE_ENV") ?? "development",
  port: Number(getEnv("PORT") ?? 4000),
  mongoUri: requireEnv("MONGODB_URI"),
  airtableClientId: requireEnv("AIRTABLE_CLIENT_ID"),
  airtableClientSecret: getEnv("AIRTABLE_CLIENT_SECRET") ?? "",
  airtableRedirectUri: requireEnv("AIRTABLE_REDIRECT_URI"),
  airtableAuthorizeBaseUrl: getEnv("AIRTABLE_AUTHORIZE_BASE_URL") ?? "https://airtable.com",
  airtableApiBaseUrl: getEnv("AIRTABLE_API_BASE_URL") ?? "https://api.airtable.com/v0",
  airtableOAuthScopes:
    getEnv("AIRTABLE_OAUTH_SCOPES") ?? "schema.bases:read data.records:read",
  frontendRedirectUrl: getEnv("FRONTEND_OAUTH_SUCCESS_URL") ?? "",
  frontendOrigin: getEnv("FRONTEND_ORIGIN") ?? "http://localhost:4200",
  airtableRevisionHistoryUrlTemplate:
    getEnv("AIRTABLE_REVISION_HISTORY_URL_TEMPLATE") ??
    "",
};

export type CallbackQuery = ParsedUrlQuery & {
  code?: string;
  state?: string;
};

