import axios from "axios";
import crypto from "node:crypto";
import { env } from "../../core/config/env";
import { ApiError } from "../../core/http/errorHandler";
import { AirtableBaseModel, AirtableIntegrationModel, AirtableOAuthStateModel, AirtableTableModel, AirtableTicketModel, AirtableUserModel } from "./airtable.schemas";
import { airtableApiRequest } from "../../utils/airtable/airtableApi";
import { fetchAllCursorPages } from "../../utils/airtable/cursorPagination";
import { generatePkce } from "../../utils/airtable/pkce";

async function getIntegration(integrationId?: string) {
  if (integrationId) {
    const found = await AirtableIntegrationModel.findOne({ integrationId });
    if (!found) throw new ApiError("Airtable integration not found", 404);
    return found;
  }

  const found = await AirtableIntegrationModel.findOne({ provider: "airtable" }).sort({ createdAt: -1 });
  if (!found) throw new ApiError("No Airtable integration found. Connect Airtable first.", 404);
  return found;
}

async function refreshAccessToken(integrationId: string, refreshToken: string) {
  const tokenUrl = `${env.airtableAuthorizeBaseUrl}/oauth2/v1/token`;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: env.airtableClientId,
    scope: env.airtableOAuthScopes,
  });

  const basicAuth =
    env.airtableClientSecret && env.airtableClientSecret.length > 0
      ? `Basic ${Buffer.from(`${env.airtableClientId}:${env.airtableClientSecret}`).toString("base64")}`
      : "";

  const response = await axios.post(
    tokenUrl,
    body.toString(),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...(basicAuth ? { Authorization: basicAuth } : {}),
      },
      timeout: 60_000,
    },
  );

  const accessToken = response.data.access_token as string;
  const newRefreshToken = (response.data.refresh_token as string | undefined) ?? refreshToken;
  const expiresIn = response.data.expires_in ? Number(response.data.expires_in) : 3600;

  const expiresAt = new Date(Date.now() + expiresIn * 1000);

  await AirtableIntegrationModel.updateOne(
    { integrationId },
    {
      accessToken,
      refreshToken: newRefreshToken,
      expiresAt,
    },
  );

  return { accessToken, refreshToken: newRefreshToken, expiresAt };
}

async function ensureFreshAccessToken(integration: Awaited<ReturnType<typeof getIntegration>>) {
  const now = Date.now();
  const expiresAtMs = integration.expiresAt.getTime();

  if (expiresAtMs - now > 2 * 60 * 1000) {
    return { accessToken: integration.accessToken, expiresAt: integration.expiresAt };
  }

  const refreshed = await refreshAccessToken(integration.integrationId, integration.refreshToken);
  return { accessToken: refreshed.accessToken, expiresAt: refreshed.expiresAt };
}

async function exchangeAuthorizationCode(code: string, codeVerifier: string) {
  const tokenUrl = `${env.airtableAuthorizeBaseUrl}/oauth2/v1/token`;

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: env.airtableRedirectUri,
    code_verifier: codeVerifier,
    client_id: env.airtableClientId,
  });

  const basicAuth =
    env.airtableClientSecret && env.airtableClientSecret.length > 0
      ? `Basic ${Buffer.from(`${env.airtableClientId}:${env.airtableClientSecret}`).toString("base64")}`
      : "";

  const response = await axios.post(
    tokenUrl,
    body.toString(),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...(basicAuth ? { Authorization: basicAuth } : {}),
      },
      timeout: 60_000,
    },
  );

  return {
    accessToken: response.data.access_token as string,
    refreshToken: response.data.refresh_token as string,
    expiresIn: response.data.expires_in ? Number(response.data.expires_in) : 3600,
    scope: response.data.scope as string | undefined,
  };
}

function normalizeRecordFields(record: { fields?: Record<string, unknown> }) {
  return record.fields ?? {};
}

export const airtableService = {
  async getOAuthUrl(integrationId?: string) {
    const pkce = generatePkce();
    const state = crypto.randomBytes(24).toString("hex");
    const resolvedIntegrationId = integrationId ?? crypto.randomUUID();

    await AirtableOAuthStateModel.create({
      state,
      integrationId: resolvedIntegrationId,
      codeVerifier: pkce.codeVerifier,
    });

    const authorizeUrl = new URL(`${env.airtableAuthorizeBaseUrl}/oauth2/v1/authorize`);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", env.airtableClientId);
    authorizeUrl.searchParams.set("redirect_uri", env.airtableRedirectUri);
    authorizeUrl.searchParams.set("scope", env.airtableOAuthScopes);
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("code_challenge", pkce.codeChallenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");

    return { url: authorizeUrl.toString(), state, integrationId: resolvedIntegrationId };
  },

  async handleOAuthCallback(code?: string, state?: string) {
    if (!code) throw new ApiError("Missing OAuth code", 400);
    if (!state) throw new ApiError("Missing OAuth state", 400);

    const oauthState = await AirtableOAuthStateModel.findOne({ state });
    if (!oauthState) throw new ApiError("Invalid or expired OAuth state", 400);

    const token = await exchangeAuthorizationCode(code, oauthState.codeVerifier);
    const expiresAt = new Date(Date.now() + token.expiresIn * 1000);

    await AirtableIntegrationModel.updateOne(
      { integrationId: oauthState.integrationId, provider: "airtable" },
      {
        provider: "airtable",
        integrationId: oauthState.integrationId,
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        expiresAt,
        scopes: token.scope,
      },
      { upsert: true },
    );

    await AirtableOAuthStateModel.deleteOne({ state });

    return { integrationId: oauthState.integrationId };
  },

  async sync(integrationId?: string) {
    const integration = await getIntegration(integrationId);
    const { accessToken } = await ensureFreshAccessToken(integration);
    const resolvedIntegrationId = integration.integrationId;

    const basesRes = await airtableApiRequest<{ bases: Array<{ id: string; name?: string }> }>(
      accessToken,
      "GET",
      "/meta/bases",
    );
    const bases = basesRes.bases ?? [];

    const tablesToFetch: Array<{ baseId: string; tables: Array<{ id: string; name?: string }> }> = [];
    for (const base of bases) {
      if (!base.id) continue;
      const tablesRes = await airtableApiRequest<{ tables: Array<{ id: string; name?: string }> }>(
        accessToken,
        "GET",
        `/meta/bases/${base.id}/tables`,
      );
      tablesToFetch.push({ baseId: base.id, tables: tablesRes.tables ?? [] });
    }

    for (const base of bases) {
      await AirtableBaseModel.updateOne(
        { integrationId: resolvedIntegrationId, airtableBaseId: base.id },
        { $set: { name: base.name ?? undefined } },
        { upsert: true },
      );
    }

    for (const group of tablesToFetch) {
      for (const table of group.tables) {
        await AirtableTableModel.updateOne(
          { integrationId: resolvedIntegrationId, baseId: group.baseId, airtableTableId: table.id },
          { $set: { name: table.name ?? undefined } },
          { upsert: true },
        );
      }
    }

    const ticketInsertPromises: Promise<unknown>[] = [];
    let totalTickets = 0;

    for (const group of tablesToFetch) {
      for (const table of group.tables) {
        await AirtableTicketModel.deleteMany({
          integrationId: resolvedIntegrationId,
          baseId: group.baseId,
          tableId: table.id,
        });

        const records = await fetchAllCursorPages<{ id: string; fields?: Record<string, unknown>; createdTime?: string; updatedTime?: string }>({
          fetchPage: async ({ pageSize, offset }) => {
            const res = await airtableApiRequest<{ records: any[]; offset?: string }>(
              accessToken,
              "GET",
              `/${group.baseId}/${table.id}`,
              { pageSize, offset },
            );

            return { items: res.records ?? [], offset: res.offset };
          },
        });

        const ticketDocs = records.map((r) => ({
          integrationId: resolvedIntegrationId,
          baseId: group.baseId,
          tableId: table.id,
          recordId: r.id,
          fields: normalizeRecordFields(r),
          ...(r.createdTime ? { createdTime: r.createdTime } : {}),
          ...(r.updatedTime ? { updatedTime: r.updatedTime } : {}),
        }));

        totalTickets += ticketDocs.length;

        ticketInsertPromises.push(
          AirtableTicketModel.insertMany(ticketDocs, { ordered: false }).catch(() => {}),
        );
      }
    }

    await Promise.all(ticketInsertPromises);

    let users: Array<{ id: string; name?: string; email?: string }> = [];
    try {
      const usersRes = await airtableApiRequest<{ users: Array<{ id: string; name?: string; email?: string }> }>(
        accessToken,
        "GET",
        "/Users",
      );
      users = usersRes.users ?? [];
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 404) {
        try {
          const usersRes = await airtableApiRequest<{ users: Array<{ id: string; name?: string; email?: string }> }>(
            accessToken,
            "GET",
            "/users",
          );
          users = usersRes.users ?? [];
        } catch {
          users = [];
        }
      } else {
        throw err;
      }
    }

    await AirtableUserModel.deleteMany({ integrationId: resolvedIntegrationId });

    const userDocs = users.map((u) => ({
      integrationId: resolvedIntegrationId,
      airtableUserId: u.id,
      name: u.name ?? undefined,
      email: u.email ?? undefined,
    }));
    if (userDocs.length > 0) {
      await AirtableUserModel.insertMany(userDocs, { ordered: false });
    }

    const tablesCount = tablesToFetch.reduce((acc, g) => acc + g.tables.length, 0);

    integration.lastSyncedAt = new Date();
    await integration.save();

    return {
      integrationId: resolvedIntegrationId,
      basesFetched: bases.length,
      tablesFetched: tablesCount,
      ticketsFetched: totalTickets,
      usersFetched: users.length,
    };
  },

  async listBases(integrationId?: string) {
    const integration = await getIntegration(integrationId);
    const bases = await AirtableBaseModel.find({ integrationId: integration.integrationId }).lean();
    return bases.map((b) => ({ baseId: b.airtableBaseId, name: b.name ?? "" }));
  },

  async listTables(baseId?: string, integrationId?: string) {
    const integration = await getIntegration(integrationId);
    const tables = await AirtableTableModel.find(
      baseId ? { integrationId: integration.integrationId, baseId } : { integrationId: integration.integrationId },
    ).lean();
    return tables.map((t) => ({ tableId: t.airtableTableId, baseId: t.baseId, name: t.name ?? "" }));
  },

  async listTickets(baseId?: string, tableId?: string, integrationId?: string) {
    if (!baseId) throw new ApiError("Missing baseId", 400);
    if (!tableId) throw new ApiError("Missing tableId", 400);

    const integration = await getIntegration(integrationId);
    const tickets = await AirtableTicketModel.find({
      integrationId: integration.integrationId,
      baseId,
      tableId,
    }).lean();

    return tickets.map((t) => ({
      recordId: t.recordId,
      ...(t.fields ?? {}),
    }));
  },

  async listUsers(integrationId?: string) {
    const integration = await getIntegration(integrationId);
    const users = await AirtableUserModel.find({ integrationId: integration.integrationId }).lean();
    return users.map((u) => ({ userId: u.airtableUserId, name: u.name ?? "", email: u.email ?? "" }));
  },
};

