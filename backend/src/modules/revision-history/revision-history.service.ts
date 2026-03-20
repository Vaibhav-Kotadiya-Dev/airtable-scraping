import axios from "axios";
import type { RevisionHistoryActivityDoc } from "./revision-history.schemas";
import { AirtableIntegrationModel, AirtableTicketModel } from "../airtable/airtable.schemas";
import { AirtableWebSessionModel, type AirtableWebSessionDoc, RevisionHistoryActivityModel } from "./revision-history.schemas";
import { ApiError } from "../../core/http/errorHandler";
import { env } from "../../core/config/env";
import crypto from "node:crypto";
import { normalizeStatus, parseDiffRowHtml } from "./revision-history.parsers";

type ScrapeRevisionHistoryArgs = {
  integrationId?: string;
  baseId?: string;
  tableId?: string;
  limit: number;
};

type V03Response = {
  msg?: string;
  data?: {
    orderedActivityAndCommentIds?: string[];
    rowActivityInfoById?: Record<
      string,
      { createdTime?: string; originatingUserId?: string; diffRowHtml?: string; groupType?: string }
    >;
    rowActivityOrCommentUserObjById?: Record<string, { id?: string; name?: string; email?: string }>;
  };
};

type AirtableRevisionRequestContext = NonNullable<AirtableWebSessionDoc["requestContext"]>;

type AirtableCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
};

const REV_HISTORY_STRINGIFIED_OBJECT_PARAMS = {
  limit: 10,
  offsetV2: null,
  shouldReturnDeserializedActivityItems: true,
  shouldIncludeRowActivityOrCommentUserObjById: true,
} as const;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function parseCookieHeader(cookieHeader: string): AirtableCookie[] {
  const parts = cookieHeader.split(";").map((p) => p.trim()).filter(Boolean);
  const cookies: AirtableCookie[] = [];
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!name) continue;
    cookies.push({ name, value, domain: ".airtable.com", path: "/" });
  }
  return cookies;
}

function isAuthExpired(body: unknown): boolean {
  const s = typeof body === "string" ? body : JSON.stringify(body ?? "");
  const lowered = s.toLowerCase();
  return lowered.includes("\"errortype\":\"auth\"") || lowered.includes("login expired") || lowered.includes("re-login");
}

function isAirtableLoginUrl(url: string): boolean {
  return /https:\/\/airtable\.com\/login(?:\?|$)/i.test(url);
}

function containsAirtableSecurityCheck(body: string): boolean {
  const lowered = body.toLowerCase();
  return (
    lowered.includes("verify it's you") ||
    lowered.includes("verify it’s you") ||
    lowered.includes("unusual traffic") ||
    lowered.includes("press and hold")
  );
}

function buildRecordUrl(baseId: string, tableId: string, recordId: string): string {
  return `https://airtable.com/${baseId}/${tableId}/${recordId}?blocks=hide`;
}

function buildRecordRefererUrl(baseId: string, tableId: string, recordId: string, viewId?: string): string {
  return viewId
    ? `https://airtable.com/${baseId}/${tableId}/${viewId}/${recordId}?blocks=hide`
    : buildRecordUrl(baseId, tableId, recordId);
}

function buildRevisionHistoryUrl(recordId: string): string {
  if (env.airtableRevisionHistoryUrlTemplate) {
    return env.airtableRevisionHistoryUrlTemplate.replace(/\$\{recordId\}/g, recordId);
  }
  return `https://airtable.com/v0.3/row/${recordId}/readRowActivitiesAndComments?stringifiedObjectParams=${encodeURIComponent(JSON.stringify(REV_HISTORY_STRINGIFIED_OBJECT_PARAMS))}`;
}

function toCookieHeader(cookies: AirtableCookie[]): string {
  return cookies
    .filter((c) => typeof c?.name === "string" && c.name && typeof c?.value === "string")
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

function isLoginRedirect(status: number, locationHeader: unknown, sourceUrl: string): boolean {
  if (status < 300 || status >= 400 || typeof locationHeader !== "string" || !locationHeader) return false;
  try {
    return isAirtableLoginUrl(new URL(locationHeader, sourceUrl).toString());
  } catch {
    return false;
  }
}

function extractCurlToken(command: string, flag: string): string | undefined {
  const escaped = flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = command.match(new RegExp(`${escaped}\\s+'([^']*)'`));
  return match?.[1];
}

function extractHeaderMapFromCurl(command: string): Record<string, string> {
  const out: Record<string, string> = {};
  const matches = command.matchAll(/-H\s+'([^']*)'/g);
  for (const match of matches) {
    const raw = match[1] ?? "";
    const idx = raw.indexOf(":");
    if (idx <= 0) continue;
    const name = raw.slice(0, idx).trim().toLowerCase();
    const value = raw.slice(idx + 1).trim();
    if (!name || !value) continue;
    out[name] = value;
  }
  return out;
}

function parseRequestContextFromCurl(command: string): AirtableRevisionRequestContext | undefined {
  const url = extractCurlToken(command, "curl");
  const cookieHeader = extractCurlToken(command, "-b");
  const headers = extractHeaderMapFromCurl(command);
  const referer = headers["referer"];
  let viewId: string | undefined;
  let secretSocketId: string | undefined;

  if (url) {
    try {
      const parsedUrl = new URL(url);
      const socketId = parsedUrl.searchParams.get("secretSocketId");
      if (socketId) secretSocketId = socketId;
    } catch {
    }
  }

  if (referer) {
    const parts = referer.split("?")[0]?.split("/").filter(Boolean) ?? [];
    const maybeViewId = parts[parts.length - 2];
    if (maybeViewId?.startsWith("viw")) viewId = maybeViewId;
  }

  const hasUsefulContext =
    Boolean(referer) ||
    Boolean(secretSocketId) ||
    Boolean(headers["x-airtable-page-load-id"]) ||
    Boolean(headers["x-airtable-inter-service-client-code-version"]) ||
    Boolean(cookieHeader);
  if (!hasUsefulContext) return undefined;

  return {
    ...(referer ? { referer } : {}),
    ...(viewId ? { viewId } : {}),
    ...(headers["user-agent"] ? { userAgent: headers["user-agent"] } : {}),
    ...(headers["accept-language"] ? { acceptLanguage: headers["accept-language"] } : {}),
    ...(headers["x-user-locale"] ? { userLocale: headers["x-user-locale"] } : {}),
    ...(headers["x-time-zone"] ? { timeZone: headers["x-time-zone"] } : {}),
    ...(headers["sec-ch-ua"] ? { secChUa: headers["sec-ch-ua"] } : {}),
    ...(headers["sec-ch-ua-mobile"] ? { secChUaMobile: headers["sec-ch-ua-mobile"] } : {}),
    ...(headers["sec-ch-ua-platform"] ? { secChUaPlatform: headers["sec-ch-ua-platform"] } : {}),
    ...(headers["x-airtable-page-load-id"] ? { pageLoadId: headers["x-airtable-page-load-id"] } : {}),
    ...(headers["x-airtable-inter-service-client-code-version"]
      ? { codeVersion: headers["x-airtable-inter-service-client-code-version"] }
      : {}),
    ...(secretSocketId ? { secretSocketId } : {}),
  };
}

function parseImportedSessionInput(raw: string): {
  cookieHeader: string;
  requestContext?: AirtableRevisionRequestContext;
} {
  const trimmed = raw.trim();
  if (!trimmed) return { cookieHeader: "" };
  if (!trimmed.startsWith("curl ")) return { cookieHeader: trimmed };

  const cookieHeader = extractCurlToken(trimmed, "-b") ?? "";
  const requestContext = parseRequestContextFromCurl(trimmed);
  return {
    cookieHeader,
    ...(requestContext ? { requestContext } : {}),
  };
}

async function ensureIntegration(integrationId?: string) {
  if (integrationId) {
    const found = await AirtableIntegrationModel.findOne({ integrationId });
    if (!found) throw new ApiError("Airtable integration not found", 404);
    return found;
  }
  const found = await AirtableIntegrationModel.findOne({ provider: "airtable" }).sort({ createdAt: -1 });
  if (!found) throw new ApiError("No Airtable integration found. Connect Airtable first.", 404);
  return found;
}

async function loadSessionCookies(integrationId: string): Promise<AirtableCookie[] | null> {
  const session = await AirtableWebSessionModel.findOne({ integrationId }).lean();
  if (!session?.cookies?.length) return null;
  return session.cookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    ...(typeof c.expires === "number" ? { expires: c.expires } : {}),
  }));
}

async function loadSessionRequestContext(integrationId: string): Promise<AirtableRevisionRequestContext | undefined> {
  const session = await AirtableWebSessionModel.findOne({ integrationId }).lean();
  return session?.requestContext;
}

async function saveSessionCookies(
  integrationId: string,
  cookies: AirtableCookie[],
  requestContext?: AirtableRevisionRequestContext,
) {
  const expiresAtMs = cookies.map((c) => c.expires).filter((x): x is number => typeof x === "number");
  const maxExpires = expiresAtMs.length ? Math.max(...expiresAtMs) : undefined;
  const expiresAt = maxExpires ? new Date(maxExpires * 1000) : undefined;

  await AirtableWebSessionModel.updateOne(
    { integrationId },
    {
      integrationId,
      cookies: cookies.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain ?? ".airtable.com",
        path: c.path ?? "/",
        ...(typeof c.expires === "number" ? { expires: c.expires } : {}),
      })),
      ...(requestContext ? { requestContext } : {}),
      ...(expiresAt ? { expiresAt } : {}),
    },
    { upsert: true },
  );
}

async function validateCookies(params: {
  cookies: AirtableCookie[];
  baseId: string;
  tableId: string;
  recordId: string;
}): Promise<boolean> {
  try {
    const url = buildRecordUrl(params.baseId, params.tableId, params.recordId);
    const response = await axios.get<string>(url, {
      headers: {
        Cookie: toCookieHeader(params.cookies),
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      timeout: 60_000,
      maxRedirects: 0,
      validateStatus: () => true,
    });
    const status = response.status;
    const location = response.headers.location;
    const body = typeof response.data === "string" ? response.data : JSON.stringify(response.data ?? "");

    console.log("🔐 Cookie validation check...");
    console.log("Validation status:", status);
    console.log("Redirect location:", location ?? "(none)");
    console.log("Contains login page:", body.toLowerCase().includes("sign in to airtable"));
    if (isLoginRedirect(status, location, url)) return false;
    if (status >= 400) return false;
    if (body.toLowerCase().includes("sign in to airtable")) return false;
    if (containsAirtableSecurityCheck(body)) return false;
    return true;
  } catch (err) {
    console.log("⚠️ Cookie validation error:", err instanceof Error ? err.message : String(err));
    return false;
  }
}

async function fetchRevisionHistory(
  cookies: AirtableCookie[],
  baseId: string,
  tableId: string,
  recordId: string,
  requestContext?: AirtableRevisionRequestContext,
): Promise<V03Response> {
  console.log("➡️ Fetching revision history for:", recordId);
  const startedAt = Date.now();
  const recordUrl = buildRecordRefererUrl(baseId, tableId, recordId, requestContext?.viewId);
  const revisionUrlBase = buildRevisionHistoryUrl(recordId);
  const revisionUrl = new URL(revisionUrlBase);
  revisionUrl.searchParams.set("requestId", `req${crypto.randomBytes(8).toString("hex")}`);
  if (requestContext?.secretSocketId) {
    revisionUrl.searchParams.set("secretSocketId", requestContext.secretSocketId);
  }
  const response = await axios.get<V03Response | string>(revisionUrl.toString(), {
    headers: {
      Cookie: toCookieHeader(cookies),
      "User-Agent":
        requestContext?.userAgent ??
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
      Accept: "application/json, text/javascript, */*; q=0.01",
      ...(requestContext?.acceptLanguage ? { "Accept-Language": requestContext.acceptLanguage } : {}),
      Referer: recordUrl,
      Origin: "https://airtable.com",
      "X-Airtable-Application-Id": baseId,
      "X-Airtable-Inter-Service-Client": "webClient",
      ...(requestContext?.codeVersion
        ? { "X-Airtable-Inter-Service-Client-Code-Version": requestContext.codeVersion }
        : {}),
      ...(requestContext?.pageLoadId ? { "X-Airtable-Page-Load-Id": requestContext.pageLoadId } : {}),
      "X-Requested-With": "XMLHttpRequest",
      ...(requestContext?.timeZone ? { "X-Time-Zone": requestContext.timeZone } : {}),
      ...(requestContext?.userLocale ? { "X-User-Locale": requestContext.userLocale } : {}),
      ...(requestContext?.secChUa ? { "Sec-CH-UA": requestContext.secChUa } : {}),
      ...(requestContext?.secChUaMobile ? { "Sec-CH-UA-Mobile": requestContext.secChUaMobile } : {}),
      ...(requestContext?.secChUaPlatform ? { "Sec-CH-UA-Platform": requestContext.secChUaPlatform } : {}),
    },
    timeout: 45_000,
    maxRedirects: 0,
    validateStatus: () => true,
  });

  if (isLoginRedirect(response.status, response.headers.location, revisionUrl.toString())) {
    throw new ApiError(
      `Airtable redirected the revision-history request to login. recordUrl=${recordUrl} revisionUrl=${revisionUrl.toString()}`,
      401,
    );
  }

  let bodyText = "";
  if (typeof response.data === "string") {
    bodyText = response.data;
  } else {
    bodyText = JSON.stringify(response.data ?? "");
  }

  if (response.status !== 200) {
    const truncated = bodyText.length > 500 ? `${bodyText.slice(0, 500)}…` : bodyText;
    throw new ApiError(
      `Airtable revision-history API returned ${response.status} after ${Date.now() - startedAt}ms. url=${revisionUrl.toString()} body=${truncated || "(empty)"}`,
      response.status === 401 || response.status === 403 ? 401 : 502,
    );
  }

  if (containsAirtableSecurityCheck(bodyText) || bodyText.toLowerCase().includes("sign in to airtable")) {
    throw new ApiError(
      `Airtable returned a login/security-check page instead of revision-history JSON. recordUrl=${recordUrl}`,
      401,
    );
  }

  const json =
    typeof response.data === "string"
      ? (JSON.parse(response.data) as V03Response)
      : ((response.data ?? null) as V03Response | null);
  if (!json) {
    throw new ApiError("Airtable revision-history response was empty", 502);
  }

  if (isAuthExpired(json)) {
    throw new ApiError("Airtable web session appears expired (auth error)", 401);
  }

  console.log("✅ Retrieved Airtable revision-history response:", revisionUrl.toString());
  return json;
}

function collectAssigneeRecordIdsWithTicketMap(
  tickets: Array<{ recordId?: string; fields?: Record<string, unknown> }>,
): { assigneeIds: string[]; ticketIdsByAssigneeId: Map<string, string[]> } {
  const assigneeIds = new Set<string>();
  const ticketIdsByAssigneeId = new Map<string, Set<string>>();
  const keys = ["Assigned To", "Assigned to", "Assignee", "assignee", "AssignedTo"];
  for (const t of tickets) {
    const ticketId = t.recordId;
    if (!ticketId) continue;
    const fields = t.fields ?? {};
    for (const key of keys) {
      const v = fields[key];
      const ids: string[] = [];
      if (Array.isArray(v)) {
        for (const item of v) if (typeof item === "string" && item.startsWith("rec")) ids.push(item);
      } else if (typeof v === "string" && v.startsWith("rec")) {
        ids.push(v);
      }
      for (const id of ids) {
        assigneeIds.add(id);
        const set = ticketIdsByAssigneeId.get(id) ?? new Set<string>();
        set.add(ticketId);
        ticketIdsByAssigneeId.set(id, set);
      }
    }
  }
  return {
    assigneeIds: Array.from(assigneeIds),
    ticketIdsByAssigneeId: new Map(Array.from(ticketIdsByAssigneeId.entries()).map(([k, v]) => [k, Array.from(v)])),
  };
}

function buildActivitiesFromV03(params: {
  response: V03Response;
  integrationId: string;
  issueId: string;
  onlyColumnTypes: Array<"Status" | "Assignee">;
}): RevisionHistoryActivityDoc[] {
  const out: RevisionHistoryActivityDoc[] = [];
  if (params.response.msg !== "SUCCESS") return out;
  const data = params.response.data;
  if (!data) return out;
  const ordered = data.orderedActivityAndCommentIds ?? [];
  const infoById = data.rowActivityInfoById ?? {};
  const userById = data.rowActivityOrCommentUserObjById ?? {};

  for (const activityId of ordered) {
    const info = infoById[activityId];
    if (!info?.diffRowHtml) continue;
    const createdDate = info.createdTime ? new Date(info.createdTime) : new Date();
    const authoredBy =
      (info.originatingUserId ? userById?.[info.originatingUserId]?.name : undefined) ??
      info.originatingUserId ??
      "unknown";

    const changes = parseDiffRowHtml(info.diffRowHtml);
    for (const ch of changes) {
      const columnType: "Status" | "Assignee" | null =
        ch.columnLabel === "Status"
          ? "Status"
          : ch.columnLabel === "Assigned To" || ch.columnLabel === "Name"
            ? "Assignee"
            : null;
      if (!columnType) continue;
      if (!params.onlyColumnTypes.includes(columnType)) continue;

      const oldValue = columnType === "Status" ? normalizeStatus(ch.oldValue) : ch.oldValue;
      const newValue = columnType === "Status" ? normalizeStatus(ch.newValue) : ch.newValue;
      if (!oldValue && !newValue) continue;
      if (oldValue === newValue) continue;

      const uuid =
        activityId && activityId.length >= 8
          ? activityId
          : crypto
              .createHash("sha1")
              .update(`${params.issueId}|${oldValue}|${newValue}|${createdDate.toISOString()}`)
              .digest("hex");

      out.push({
        integrationId: params.integrationId,
        source: "airtable-web",
        uuid,
        issueId: params.issueId,
        columnType,
        oldValue: oldValue || "(empty)",
        newValue: newValue || "(empty)",
        createdDate,
        authoredBy,
      });
    }
  }

  return out;
}

export const revisionHistoryService = {
  async importWebSession(args: { integrationId?: string; cookieHeader: string }): Promise<unknown> {
    const integration = await ensureIntegration(args.integrationId);
    const imported = parseImportedSessionInput(args.cookieHeader);
    const cookies = parseCookieHeader(imported.cookieHeader);
    if (cookies.length === 0) throw new ApiError("No cookies found in cookieHeader", 400);
    await saveSessionCookies(integration.integrationId, cookies, imported.requestContext);
    return {
      integrationId: integration.integrationId,
      cookiesSaved: cookies.length,
      requestContextSaved: Boolean(imported.requestContext),
    };
  },

  async getWebSessionStatus(args: {
    integrationId?: string;
    baseId?: string;
    tableId?: string;
  }): Promise<unknown> {
    const integration = await ensureIntegration(args.integrationId);
    const integrationId = integration.integrationId;
    const storedCookies = (await loadSessionCookies(integrationId)) ?? [];
    const requestContext = await loadSessionRequestContext(integrationId);
    const sessionDoc = await AirtableWebSessionModel.findOne({ integrationId }).lean();

    if (!storedCookies.length) {
      return {
        integrationId,
        hasStoredSession: false,
        cookieCount: 0,
        valid: false,
        hasRequestContext: false,
        message:
          "No Airtable revision-history web session is stored. Import a valid Airtable Copy as cURL request or Cookie header before scraping on AWS.",
      };
    }

    if (!args.baseId || !args.tableId) {
      return {
        integrationId,
        hasStoredSession: true,
        cookieCount: storedCookies.length,
        hasRequestContext: Boolean(requestContext),
        ...(sessionDoc?.expiresAt ? { expiresAt: sessionDoc.expiresAt } : {}),
        valid: null,
        message: requestContext
          ? "Stored Airtable web session and request context found. Select an entity to validate it against a real record."
          : "Stored Airtable web session found, but no Airtable request context was imported yet. Paste Copy as cURL from the working Airtable revision-history request for best results.",
      };
    }

    const sampleTicket = await AirtableTicketModel.findOne(
      { integrationId, baseId: args.baseId, tableId: args.tableId },
      { recordId: 1 },
    ).lean();

    if (!sampleTicket?.recordId) {
      return {
        integrationId,
        hasStoredSession: true,
        cookieCount: storedCookies.length,
        hasRequestContext: Boolean(requestContext),
        ...(sessionDoc?.expiresAt ? { expiresAt: sessionDoc.expiresAt } : {}),
        valid: null,
        message: "Stored Airtable web session found, but there is no synced record yet to validate against.",
      };
    }

    const valid = await validateCookies({
      cookies: storedCookies,
      baseId: args.baseId,
      tableId: args.tableId,
      recordId: sampleTicket.recordId,
    });

    return {
      integrationId,
      hasStoredSession: true,
      cookieCount: storedCookies.length,
      hasRequestContext: Boolean(requestContext),
      ...(sessionDoc?.expiresAt ? { expiresAt: sessionDoc.expiresAt } : {}),
      valid,
      message: valid
        ? "Stored Airtable web session is valid for the selected entity."
        : "Stored Airtable web session exists but is invalid or expired for the selected entity. Import a fresh Airtable Copy as cURL request or Cookie header.",
    };
  },

  async scrapeRevisionHistory(args: ScrapeRevisionHistoryArgs): Promise<unknown> {
    console.log('STARTING ************')
    const integration = await ensureIntegration(args.integrationId);
    const integrationId = integration.integrationId;
    if (!args.baseId || !args.tableId) throw new ApiError("baseId and tableId are required", 400);

    const tickets = await AirtableTicketModel.find({ integrationId, baseId: args.baseId, tableId: args.tableId })
      .limit(args.limit)
      .lean();
    if (!tickets.length) return { integrationId, scraped: 0, parsedActivities: 0, ticketsProcessed: 0 };

    const firstRecordId = tickets[0]?.recordId;
    if (!firstRecordId) throw new ApiError("No recordId found for tickets", 400);
    const cookies = (await loadSessionCookies(integrationId)) ?? [];
    if (!cookies.length) {
      throw new ApiError(
        "No Airtable revision-history web session is stored. Save a session (Copy as cURL or Cookie header) before scraping.",
        401,
      );
    }
    const cookiesOk = await validateCookies({
      cookies,
      baseId: args.baseId,
      tableId: args.tableId,
      recordId: firstRecordId,
    });
    if (!cookiesOk) {
      throw new ApiError(
        "Stored Airtable revision-history web session is invalid or expired. Save a fresh session before scraping.",
        401,
      );
    }

    let requestContext = await loadSessionRequestContext(integrationId);
    let parsedActivities = 0;

      for (const t of tickets) {
        if (!t?.recordId) continue;

        console.log("\n===============================");
        console.log("📄 Processing Ticket:", t.recordId);

        const resp = await fetchRevisionHistory(cookies, args.baseId, args.tableId, t.recordId, requestContext);

        console.log("📦 Raw response msg:", resp.msg);

        const activities = buildActivitiesFromV03({
          response: resp,
          integrationId,
          issueId: t.recordId,
          onlyColumnTypes: ["Status", "Assignee"],
        });

        console.log("🔍 Parsed activities:", activities.length);

        const statusActivities = activities.filter((a) => a.columnType === "Status");

        console.log("✅ Status activities:", statusActivities.length);

        if (statusActivities.length) {
          try {
            await RevisionHistoryActivityModel.insertMany(statusActivities, { ordered: false });
          } catch (e) {
            console.log("⚠️ Insert error (likely duplicates)");
          }
        }
      }

      const { assigneeIds, ticketIdsByAssigneeId } = collectAssigneeRecordIdsWithTicketMap(tickets as any);
      for (const assigneeId of assigneeIds) {
        const resp = await fetchRevisionHistory(cookies, args.baseId, args.tableId, assigneeId, requestContext);

        const assigneeActivities = buildActivitiesFromV03({
          response: resp,
          integrationId,
          issueId: assigneeId,
          onlyColumnTypes: ["Assignee"],
        }).filter((a) => a.columnType === "Assignee");

        const ticketIds = ticketIdsByAssigneeId.get(assigneeId) ?? [];
        const duplicated: RevisionHistoryActivityDoc[] = [];
        for (const ticketId of ticketIds) {
          for (const a of assigneeActivities) {
            duplicated.push({
              ...a,
              issueId: ticketId,
              uuid: crypto.createHash("sha1").update(`${ticketId}|${assigneeId}|${a.uuid}`).digest("hex"),
            });
          }
        }

        if (duplicated.length) {
          parsedActivities += duplicated.length;
          try {
            await RevisionHistoryActivityModel.insertMany(duplicated, { ordered: false });
          } catch {
          }
        }

      }

      return {
        integrationId,
        ticketsProcessed: tickets.length,
        parsedActivities,
      };
  },

  async listRevisionActivities(args: { integrationId?: string; baseId?: string; tableId?: string; limit: number }): Promise<unknown> {
    const integration = await ensureIntegration(args.integrationId);
    const integrationId = integration.integrationId;
    if (!args.baseId || !args.tableId) throw new ApiError("baseId and tableId are required", 400);

    const tickets = await AirtableTicketModel.find(
      { integrationId, baseId: args.baseId, tableId: args.tableId },
      { recordId: 1 },
    )
      .limit(500)
      .lean();
    const recordIds = tickets.map((t) => t.recordId).filter((id): id is string => Boolean(id));
    if (!recordIds.length) return { integrationId, activities: [] };

    const activities = await RevisionHistoryActivityModel.find({ integrationId, issueId: { $in: recordIds } })
      .sort({ createdDate: -1 })
      .limit(args.limit)
      .lean();

    return { integrationId, activities };
  },
};

