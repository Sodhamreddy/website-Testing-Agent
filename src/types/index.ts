export interface TestIssue {
  id: string;
  name: string;
  category: string;
  severity: 'Critical' | 'Major' | 'Minor';
  steps: string;
  browser: string;
  affectedPage: string;
  status: 'Open' | 'Fixed' | 'Watching';
  description: string;
  details?: string[];
  screenshot?: string;
  /** Stable identity across audit runs (server-assigned). */
  fp?: string;
}

export interface IssueDelta {
  fp: string;
  name: string;
  category: string;
  severity: string;
  affectedPage: string;
}

export interface RunComparison {
  previousRunId: string | null;
  previousRanAt: string | null;
  summary: { total: number; newCount: number; recurringCount: number; resolvedCount: number };
  resolved: IssueDelta[];
  recurring: string[];
  newFps: string[];
}

export interface AuditRunSummary {
  id: string;
  ranAt: string;
  score: number | null;
  counts: { total: number; critical: number; major: number; minor: number };
  comparison: RunComparison['summary'];
}

export interface TestingIssue {
  testCaseId: string;
  pageUrl: string;
  description: string;
  deviceType: string;
  status: string;
  loggedBy: string;
  assignedTo: string;
  remarks: string;
  reportedOn: string;
  priority: 'Low' | 'Medium' | 'High';
  type: string;
  version?: string;
  screenshot?: string;
  /** Classic SEO suggestion (title / meta / tips) for this row's page. */
  seoSuggestion?: string;
  /** GEO / AI-search recommendations for this row's page. */
  geoSuggestion?: string;
  /** Security posture for the site (or the finding's own detail on Security rows). */
  securityNote?: string;
}

export interface TestLog {
  time: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

export interface WebVitals {
  lcp?: string;
  cls?: string;
  fcp?: string;
  tbt?: string;
  si?: string;
}

export interface ScoreSet {
  performance: number;
  accessibility: number;
  seo: number;
  bestPractices: number;
  vitals: WebVitals;
}

export interface TestResult {
  mobile: ScoreSet;
  desktop?: ScoreSet;
  foundData?: { title?: string; h1?: string; description?: string };
  isEstimated?: boolean;
  testingScore?: number;
}

export interface ChecklistStatus {
  [category: string]: { [item: string]: 'pass' | 'fail' | 'warning' | 'pending' };
}

export type Page = 'dashboard' | 'testing' | 'report' | 'settings' | 'testing_view';

export interface AppSettings {
  browser: 'chrome' | 'firefox' | 'edge' | 'safari';
  mode: 'desktop' | 'mobile';
  autoScreenshots: boolean;
  emailReport: boolean;
  email: string;
}

export interface RecentReport {
  url: string;
  date: string;
  issueCount: number;
  passedCount: number;
  checkedCount: number;
}
