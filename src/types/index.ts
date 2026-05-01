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
  [category: string]: { [item: string]: 'pass' | 'fail' | 'pending' };
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
