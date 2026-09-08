import type { Page, BrowserContext } from 'playwright';
import type { Reporter } from '../audit/reporter.js';

export type LogType = 'info' | 'success' | 'warning' | 'error';

/** A page the agent visited and screenshotted. */
export interface PageRef {
  url: string;
  title: string;
  loadMs: number;
  screenshot: string; // data URL, full-page
}

/** Shared state passed to every helper during an audit run. */
export interface AuditContext {
  page: Page;
  context: BrowserContext;
  rootUrl: string;
  origin: string;
  pages: PageRef[];
  report: Reporter;
  log: (msg: string, type?: LogType) => void;
  progress: (pct: number) => void;
}
