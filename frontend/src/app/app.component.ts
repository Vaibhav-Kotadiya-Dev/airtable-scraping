import { Component } from '@angular/core';
import { AppShellComponent } from './features/layout/app-shell/app-shell.component';

@Component({
  selector: 'app-root',
  imports: [AppShellComponent],
  template: '<app-shell></app-shell>',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  title = 'airtable-integration';
}
