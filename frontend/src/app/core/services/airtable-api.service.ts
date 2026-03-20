import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { backendConfig } from '../config/backend-config';

export type OAuthUrlResponse = {
  url: string;
  state: string;
  integrationId: string;
};

export type AirtableBase = {
  baseId: string;
  name: string;
};

export type AirtableTable = {
  tableId: string;
  baseId: string;
  name: string;
};

export type AirtableTicketRow = {
  recordId: string;
  [key: string]: unknown;
};

export type RevisionHistoryActivity = {
  uuid: string;
  issueId: string;
  columnType: string;
  oldValue: string;
  newValue: string;
  createdDate: string;
  authoredBy: string;
};

export type RevisionHistorySessionStatus = {
  integrationId: string;
  hasStoredSession: boolean;
  hasRequestContext?: boolean;
  cookieCount: number;
  valid: boolean | null;
  expiresAt?: string;
  message: string;
};

@Injectable({ providedIn: 'root' })
export class AirtableApiService {
  private readonly baseUrl = backendConfig.baseUrl;

  constructor(private http: HttpClient) {}

  async getOAuthUrl(integrationId?: string): Promise<OAuthUrlResponse> {
    const params = integrationId ? new HttpParams().set('integrationId', integrationId) : undefined;
    return firstValueFrom(this.http.get<OAuthUrlResponse>(`${this.baseUrl}/api/airtable/oauth/url`, { params }));
  }

  async sync(integrationId?: string): Promise<unknown> {
    const body: { integrationId?: string } = integrationId ? { integrationId } : {};
    return firstValueFrom(this.http.post(`${this.baseUrl}/api/airtable/sync`, body));
  }

  async getBases(integrationId?: string): Promise<AirtableBase[]> {
    const params = integrationId ? new HttpParams().set('integrationId', integrationId) : undefined;
    const res = await firstValueFrom(
      this.http.get<{ bases: AirtableBase[] }>(`${this.baseUrl}/api/airtable/bases`, { params }),
    );
    return res.bases;
  }

  async getTables(baseId?: string, integrationId?: string): Promise<AirtableTable[]> {
    let params = new HttpParams();
    if (baseId) params = params.set('baseId', baseId);
    if (integrationId) params = params.set('integrationId', integrationId);

    const res = await firstValueFrom(
      this.http.get<{ tables: AirtableTable[] }>(`${this.baseUrl}/api/airtable/tables`, { params }),
    );
    return res.tables;
  }

  async getTickets(baseId: string, tableId: string, integrationId?: string): Promise<AirtableTicketRow[]> {
    let params = new HttpParams().set('baseId', baseId).set('tableId', tableId);
    if (integrationId) params = params.set('integrationId', integrationId);

    const res = await firstValueFrom(
      this.http.get<{ tickets: AirtableTicketRow[] }>(`${this.baseUrl}/api/airtable/tickets`, { params }),
    );
    return res.tickets;
  }

  async scrapeRevisionHistory(args: {
    baseId: string;
    tableId: string;
    integrationId?: string;
    limit?: number;
  }): Promise<unknown> {
    const body: {
      baseId: string;
      tableId: string;
      integrationId?: string;
      limit?: number;
    } = {
      baseId: args.baseId,
      tableId: args.tableId,
      ...(args.integrationId ? { integrationId: args.integrationId } : {}),
      ...(typeof args.limit === 'number' ? { limit: args.limit } : {}),
    };

    return firstValueFrom(this.http.post(`${this.baseUrl}/api/airtable/revision-history/scrape`, body));
  }

  async importRevisionWebSession(args: { integrationId?: string; cookieHeader: string }): Promise<unknown> {
    const body: { integrationId?: string; cookieHeader: string } = {
      cookieHeader: args.cookieHeader,
      ...(args.integrationId ? { integrationId: args.integrationId } : {}),
    };
    return firstValueFrom(this.http.post(`${this.baseUrl}/api/airtable/revision-history/session/import`, body));
  }

  async getRevisionWebSessionStatus(args: {
    integrationId?: string;
    baseId?: string;
    tableId?: string;
  }): Promise<RevisionHistorySessionStatus> {
    let params = new HttpParams();
    if (args.integrationId) params = params.set('integrationId', args.integrationId);
    if (args.baseId) params = params.set('baseId', args.baseId);
    if (args.tableId) params = params.set('tableId', args.tableId);

    return firstValueFrom(
      this.http.get<RevisionHistorySessionStatus>(`${this.baseUrl}/api/airtable/revision-history/session/status`, {
        params,
      }),
    );
  }

  async getRevisionActivities(args: {
    baseId: string;
    tableId: string;
    integrationId?: string;
    limit?: number;
  }): Promise<{ activities: RevisionHistoryActivity[]; integrationId: string }> {
    let params = new HttpParams()
      .set('baseId', args.baseId)
      .set('tableId', args.tableId)
      .set('limit', String(args.limit ?? 100));

    if (args.integrationId) params = params.set('integrationId', args.integrationId);

    return firstValueFrom(
      this.http.get<{ activities: RevisionHistoryActivity[]; integrationId: string }>(
        `${this.baseUrl}/api/airtable/revision-history/activities`,
        { params },
      ),
    );
  }
}

