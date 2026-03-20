import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

import { ModuleRegistry } from 'ag-grid-community';
import {
  ClientSideRowModelModule,
  TextFilterModule,
  NumberFilterModule,
  DateFilterModule,
  QuickFilterModule,
  _FilterCoreModule,
  _ColumnFilterModule,
} from 'ag-grid-community';

// AG Grid v33 modular build: register the minimal modules used by our UI.
ModuleRegistry.registerModules([
  ClientSideRowModelModule,
  TextFilterModule,
  NumberFilterModule,
  DateFilterModule,
  _FilterCoreModule,
  _ColumnFilterModule,
  QuickFilterModule,
]);

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));
