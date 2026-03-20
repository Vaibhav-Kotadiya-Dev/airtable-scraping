import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import type { ColDef, GridApi, GridReadyEvent } from 'ag-grid-community';
import { AgGridAngular } from 'ag-grid-angular';
import {
  AirtableApiService,
  type AirtableBase,
  type AirtableTable,
  type AirtableTicketRow,
  type RevisionHistoryActivity,
  type RevisionHistorySessionStatus,
} from '../../../core/services/airtable-api.service';

type EntityOption = {
  label: string;
  value: string;
  baseId: string;
  tableId: string;
};

@Component({
  selector: 'airtable-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatSelectModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    AgGridAngular,
  ],
  templateUrl: './airtable-dashboard.component.html',
  styleUrl: './airtable-dashboard.component.scss',
})
export class AirtableDashboardComponent implements OnInit {
  connectLoading = false;
  syncLoading = false;
  errorMessage = '';

  integrationId: string | null = null;

  bases: AirtableBase[] = [];
  tables: AirtableTable[] = [];
  entities: EntityOption[] = [];
  selectedEntity: EntityOption | null = null;

  searchText = '';
  gridApi: GridApi | null = null;
  revisionGridApi: GridApi | null = null;

  columnDefs: ColDef[] = [];
  rowData: AirtableTicketRow[] = [];

  cookieHeaderImport = '';
  importLoading = false;
  importResultMessage = '';
  importResultIsError = false;
  revisionSessionStatus: RevisionHistorySessionStatus | null = null;
  revisionSessionLoading = false;
  revisionLoading = false;
  revisionErrorMessage = '';
  revisionSummaryMessage = '';
  revisionActivities: RevisionHistoryActivity[] = [];
  revisionColumnDefs: ColDef[] = [];

  readonly recordsOverlayNoRowsTemplate =
    `<div class="grid-empty">
      <div class="grid-empty-title">No records found</div>
      <div class="grid-empty-subtitle">Try syncing, changing entity, or clearing the search filter.</div>
    </div>`;

  readonly revisionOverlayNoRowsTemplate =
    `<div class="grid-empty">
      <div class="grid-empty-title">No revision history yet</div>
      <div class="grid-empty-subtitle">Save a session and run “Fetch Revision History (200)”.</div>
    </div>`;

  defaultColDef: ColDef = {
    sortable: true,
    filter: true,
    resizable: true,
    minWidth: 140,
    valueFormatter: (params) => {
      const value = params.value as unknown;
      if (value === null || value === undefined) return '';
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value);
    },
  };

  constructor(
    private readonly api: AirtableApiService,
    private readonly snackBar: MatSnackBar,
  ) {}

  private toastSuccess(message: string): void {
    this.snackBar.open(message, 'OK', { duration: 3500, panelClass: ['toast-success'] });
  }

  private toastError(message: string): void {
    this.snackBar.open(message, 'Dismiss', { duration: 6000, panelClass: ['toast-error'] });
  }

  ngOnInit(): void {
    const params = new URLSearchParams(window.location.search);
    const success = params.get('success');
    const incomingIntegrationId = params.get('integrationId');

    if (incomingIntegrationId) {
      this.integrationId = incomingIntegrationId;
    }

    if (success === 'true' && this.integrationId) {
      void this.syncNow();
    } else if (this.integrationId) {
      void this.loadEntitiesAndMaybeTickets();
    }
  }

  async connectToAirtable(): Promise<void> {
    this.errorMessage = '';
    this.connectLoading = true;
    try {
      const result = await this.api.getOAuthUrl();
      this.integrationId = result.integrationId;

      window.open(result.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : 'Failed to start OAuth';
    } finally {
      this.connectLoading = false;
    }
  }

  async syncNow(): Promise<void> {
    this.errorMessage = '';
    this.syncLoading = true;
    try {
      await this.api.sync(this.integrationId ?? undefined);
      await this.loadEntitiesAndMaybeTickets();
      this.toastSuccess('Sync completed.');
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : 'Sync failed';
      this.toastError(this.errorMessage);
    } finally {
      this.syncLoading = false;
    }
  }

  private async loadEntitiesAndMaybeTickets(): Promise<void> {
    this.errorMessage = '';

    this.bases = await this.api.getBases(this.integrationId ?? undefined);
    this.tables = await this.api.getTables(undefined, this.integrationId ?? undefined);

    const baseNameById = new Map(this.bases.map((b) => [b.baseId, b.name || b.baseId]));

    this.entities = this.tables
      .map((t) => {
        const baseName = baseNameById.get(t.baseId) ?? t.baseId;
        const label = `${baseName} / ${t.name || t.tableId}`;
        return {
          label,
          value: `${t.baseId}:${t.tableId}`,
          baseId: t.baseId,
          tableId: t.tableId,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));

    if (!this.selectedEntity && this.entities.length > 0) {
      this.selectedEntity = this.entities[0];
    }

    if (this.selectedEntity) {
      await this.loadTickets(this.selectedEntity);
      await this.loadRevisionSessionStatus();
    }
  }

  async onEntitySelected(value: string): Promise<void> {
    this.errorMessage = '';
    const found = this.entities.find((e) => e.value === value) ?? null;
    this.selectedEntity = found;
    if (found) {
      await this.loadTickets(found);
      await this.loadRevisionSessionStatus();
    }
  }

  private buildColumnsFromRows(rows: AirtableTicketRow[]): ColDef[] {
    if (!rows || rows.length === 0) return [];

    const keys = new Set<string>();
    for (const row of rows) {
      Object.keys(row).forEach((k) => keys.add(k));
    }

    const orderedKeys = Array.from(keys).sort((a, b) => a.localeCompare(b));

    const recordIdCol: ColDef = {
      headerName: 'recordId',
      field: 'recordId',
      pinned: 'left',
      minWidth: 200,
    };

    const dataKeys = orderedKeys.filter((k) => k !== 'recordId');
    return [
      recordIdCol,
      ...dataKeys.map((k) => ({
        headerName: k,
        field: k,
      })),
    ];
  }

  private async loadTickets(entity: EntityOption): Promise<void> {
    const tickets = await this.api.getTickets(
      entity.baseId,
      entity.tableId,
      this.integrationId ?? undefined,
    );

    this.rowData = tickets;
    this.columnDefs = this.buildColumnsFromRows(tickets);

    this.applyQuickFilter();
  }

  onGridReady(event: GridReadyEvent): void {
    this.gridApi = event.api;
    this.applyQuickFilter();
    this.updateRecordsOverlay();
  }

  onRevisionGridReady(event: GridReadyEvent): void {
    this.revisionGridApi = event.api;
    this.updateRevisionOverlay();
  }

  onRecordsFilterChanged(): void {
    this.updateRecordsOverlay();
  }

  onRevisionFilterChanged(): void {
    this.updateRevisionOverlay();
  }

  onSearchTextChanged(): void {
    this.applyQuickFilter();
  }

  private applyQuickFilter(): void {
    if (!this.gridApi) return;
    if (this.gridApi.isDestroyed()) return;

    requestAnimationFrame(() => {
      if (!this.gridApi || this.gridApi.isDestroyed()) return;
      this.gridApi.setGridOption('quickFilterText', this.searchText ?? '');
      this.updateRecordsOverlay();
    });
  }

  private updateRecordsOverlay(): void {
    if (!this.gridApi || this.gridApi.isDestroyed()) return;
    const displayed = this.gridApi.getDisplayedRowCount();
    if (displayed === 0) this.gridApi.showNoRowsOverlay();
    else this.gridApi.hideOverlay();
  }

  private updateRevisionOverlay(): void {
    if (!this.revisionGridApi || this.revisionGridApi.isDestroyed()) return;
    const displayed = this.revisionGridApi.getDisplayedRowCount();
    if (displayed === 0) this.revisionGridApi.showNoRowsOverlay();
    else this.revisionGridApi.hideOverlay();
  }

  async fetchRevisionHistoryForSelectedEntity(): Promise<void> {
    if (!this.selectedEntity) return;
    this.revisionErrorMessage = '';
    this.revisionSummaryMessage = '';
    this.revisionLoading = true;

    try {
      const result = (await this.api.scrapeRevisionHistory({
        baseId: this.selectedEntity.baseId,
        tableId: this.selectedEntity.tableId,
        integrationId: this.integrationId ?? undefined,
        limit: 200,
      })) as {
        ticketsProcessed?: number;
        parsedActivities?: number;
        cookieSource?: string;
      };

      const activitiesRes = await this.api.getRevisionActivities({
        baseId: this.selectedEntity.baseId,
        tableId: this.selectedEntity.tableId,
        integrationId: this.integrationId ?? undefined,
        limit: 200,
      });

      this.revisionActivities = activitiesRes.activities ?? [];
      this.revisionColumnDefs = this.buildRevisionColumnDefs();
      const processed = result.ticketsProcessed ?? 0;
      const parsed = result.parsedActivities ?? 0;
      const cookieSource = result.cookieSource ? ` using ${result.cookieSource} session` : '';
      this.revisionSummaryMessage = `Processed ${processed} records and stored ${parsed} revision changes${cookieSource}.`;
      this.toastSuccess('Revision history fetched successfully.');
      await this.loadRevisionSessionStatus();
      this.updateRevisionOverlay();
    } catch (err) {
      this.revisionErrorMessage = err instanceof Error ? err.message : 'Failed to fetch revision history';
      this.toastError(this.revisionErrorMessage);
    } finally {
      this.revisionLoading = false;
    }
  }

  async importWebSessionCookies(): Promise<void> {
    this.importResultMessage = '';
    this.importResultIsError = false;
    this.revisionErrorMessage = '';
    const cookieHeader = this.cookieHeaderImport.trim();
    if (!cookieHeader) {
      this.importResultMessage = 'Paste either the Airtable Cookie header value or the full Copy as cURL request first.';
      this.importResultIsError = true;
      return;
    }
    this.importLoading = true;
    try {
      const result = (await this.api.importRevisionWebSession({
        integrationId: this.integrationId ?? undefined,
        cookieHeader,
      })) as { cookiesSaved?: number; requestContextSaved?: boolean };
      const cookiesSaved = result.cookiesSaved ?? 0;
      this.importResultMessage = result.requestContextSaved
        ? `Session saved successfully with ${cookiesSaved} cookies and request context.`
        : `Session saved successfully with ${cookiesSaved} cookies.`;
      this.importResultIsError = false;
      this.toastSuccess('Revision history session saved.');
      await this.loadRevisionSessionStatus();
    } catch (err) {
      this.importResultMessage = err instanceof Error ? err.message : 'Failed to import cookies';
      this.importResultIsError = true;
      this.toastError(this.importResultMessage);
    } finally {
      this.importLoading = false;
    }
  }

  async refreshRevisionSessionStatus(): Promise<void> {
    await this.loadRevisionSessionStatus();
  }

  get selectedEntityLabel(): string {
    return this.selectedEntity?.label ?? 'No entity selected';
  }

  get ticketCount(): number {
    return this.rowData.length;
  }

  get revisionCount(): number {
    return this.revisionActivities.length;
  }

  get hasIntegration(): boolean {
    return Boolean(this.integrationId);
  }

  get canFetchRevisionHistory(): boolean {
    return Boolean(this.selectedEntity) && !this.revisionLoading && !this.connectLoading && !this.syncLoading;
  }

  get sessionStatusLabel(): string {
    if (!this.revisionSessionStatus) return 'Unknown';
    if (!this.revisionSessionStatus.hasStoredSession) return 'Missing';
    if (this.revisionSessionStatus.valid === true) return 'Ready';
    if (this.revisionSessionStatus.valid === false) return 'Needs refresh';
    return 'Saved';
  }

  get sessionStatusClass(): string {
    if (!this.revisionSessionStatus) return 'status-pill status-neutral';
    if (!this.revisionSessionStatus.hasStoredSession) return 'status-pill status-warning';
    if (this.revisionSessionStatus.valid === true) return 'status-pill status-success';
    if (this.revisionSessionStatus.valid === false) return 'status-pill status-danger';
    return 'status-pill status-neutral';
  }

  formatDisplayDate(value?: string | null): string {
    if (!value) return 'N/A';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
  }

  private async loadRevisionSessionStatus(): Promise<void> {
    if (!this.integrationId) {
      this.revisionSessionStatus = null;
      return;
    }

    this.revisionSessionLoading = true;
    try {
      this.revisionSessionStatus = await this.api.getRevisionWebSessionStatus({
        integrationId: this.integrationId ?? undefined,
        ...(this.selectedEntity ? { baseId: this.selectedEntity.baseId, tableId: this.selectedEntity.tableId } : {}),
      });
    } catch (err) {
      this.revisionSessionStatus = null;
      this.revisionErrorMessage = err instanceof Error ? err.message : 'Failed to load revision session status';
    } finally {
      this.revisionSessionLoading = false;
    }
  }

  private buildRevisionColumnDefs(): ColDef[] {
    return [
      { headerName: 'Record ID', field: 'issueId', minWidth: 170, pinned: 'left' },
      { headerName: 'Field', field: 'columnType', minWidth: 140 },
      { headerName: 'Previous Value', field: 'oldValue', minWidth: 220 },
      { headerName: 'New Value', field: 'newValue', minWidth: 220 },
      {
        headerName: 'Changed At',
        field: 'createdDate',
        minWidth: 200,
        sort: 'desc',
        valueFormatter: (p) => this.formatDisplayDate(p.value ? String(p.value) : ''),
      },
      { headerName: 'Changed By', field: 'authoredBy', minWidth: 180 },
    ];
  }
}

