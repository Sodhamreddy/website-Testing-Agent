import type { TestIssue, TestResult, ChecklistStatus } from '../../src/types/index.js';

type LogType = 'info' | 'success' | 'warning' | 'error';
type LogCallback = (msg: string, type?: LogType) => void;

/**
 * Findings bookkeeping shared by both engines. Lifted verbatim from
 * TestCaseAuditAgent (initChecklist / setChecklist / addIssue / buildResult /
 * pathLabel / normalize) so the agentic coordinator emits the exact same
 * TestIssue[] / ChecklistStatus / TestResult contract the frontend consumes.
 */
export class Reporter {
  issues: TestIssue[] = [];
  checklistStatus: ChecklistStatus;
  foundData: { title?: string; h1?: string; description?: string } = {};
  private counter = 1;
  private pageLoads: number[] = [];

  constructor(private onLog: LogCallback) {
    this.checklistStatus = this.initChecklist();
  }

  recordLoad(ms: number) {
    this.pageLoads.push(ms);
  }

  // ─── Checklist ──────────────────────────────────────────────────────────────

  setChecklist(category: string, item: string, status: 'pass' | 'fail' | 'warning' | 'pending') {
    if (this.checklistStatus[category]?.[item] !== undefined) {
      this.checklistStatus[category][item] = status;
    }
  }

  /** 0–95 based on how much of the checklist is no longer pending. */
  progress(): number {
    const all = Object.values(this.checklistStatus).flatMap((c) => Object.values(c));
    if (!all.length) return 5;
    const done = all.filter((s) => s !== 'pending').length;
    return 5 + Math.round((done / all.length) * 90);
  }

  // ─── Issues ─────────────────────────────────────────────────────────────────

  addIssue(
    name: string,
    category: string,
    severity: 'Critical' | 'Major' | 'Minor',
    steps: string,
    browser: string,
    description: string,
    details?: string[],
    affectedPage?: string,
    screenshot?: string,
  ): string {
    const emoji = severity === 'Critical' ? '🔴' : severity === 'Major' ? '🟡' : '🟢';
    this.onLog(`${emoji} [${severity}] ${name}`, severity === 'Critical' ? 'error' : severity === 'Major' ? 'warning' : 'info');
    const id = String(this.counter++);
    this.issues.push({
      id,
      name,
      category,
      severity,
      steps,
      browser,
      affectedPage: affectedPage ?? '',
      status: 'Open',
      description,
      details,
      screenshot: screenshot ?? '',
    });
    return id;
  }

  // ─── Result ─────────────────────────────────────────────────────────────────

  build(): { issues: TestIssue[]; result: TestResult; checklistStatus: ChecklistStatus } {
    return { issues: this.issues, result: this.buildResult(), checklistStatus: this.checklistStatus };
  }

  private buildResult(): TestResult {
    const pct = (cat: string) => {
      const items = Object.values(this.checklistStatus[cat] ?? {}).filter((s) => s !== 'pending');
      if (!items.length) return 0.5;
      const score = items.reduce((a, s) => a + (s === 'pass' ? 1 : s === 'warning' ? 0.5 : 0), 0);
      return score / items.length;
    };
    const to100 = (x: number) => Math.min(100, Math.max(0, Math.round(x * 100)));

    const avgLoad = this.pageLoads.length
      ? this.pageLoads.reduce((a, b) => a + b, 0) / this.pageLoads.length
      : 4000;
    const perfBase = avgLoad < 1200 ? 95 : avgLoad < 2000 ? 88 : avgLoad < 3000 ? 78 : avgLoad < 5000 ? 58 : 40;
    const performance = Math.round((perfBase + to100(pct('Performance & usability'))) / 2);

    const critCount = this.issues.filter((i) => i.severity === 'Critical').length;
    const majorCount = this.issues.filter((i) => i.severity === 'Major').length;
    const minorCount = this.issues.filter((i) => i.severity === 'Minor').length;
    const penalty = Math.min(70, critCount * 12 + majorCount * 5 + Math.round(minorCount * 1.5));

    return {
      mobile: {
        performance,
        accessibility: to100((pct('Images & media') + pct('Buttons & UI') + pct('Forms & validation')) / 3),
        seo: to100(pct('SEO & meta tags')),
        bestPractices: to100((pct('Content & layout') + pct('Branding & header') + pct('Responsive / Viewport')) / 3),
        vitals: {},
      },
      foundData: this.foundData,
      isEstimated: false,
      testingScore: Math.max(10, 100 - penalty),
    };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  normalize(url: string): string {
    try {
      const u = new URL(url);
      return u.origin + u.pathname.replace(/\/$/, '');
    } catch {
      return url;
    }
  }

  pathLabel(url: string): string {
    try {
      const p = new URL(url).pathname;
      return p === '/' || p === '' ? 'Home page' : decodeURIComponent(p).replace(/\/$/, '');
    } catch {
      return url;
    }
  }

  private initChecklist(): ChecklistStatus {
    return {
      'Branding & header': {
        'Logo visible and clear': 'pending',
        'Logo navigates to homepage': 'pending',
        'Header menu displayed': 'pending',
        'Menu items visible and clickable': 'pending',
        'Header contact info present': 'pending',
        'Favicon present': 'pending',
        'Page title on every page': 'pending',
      },
      'Navigation & link': {
        'Menu items navigate correctly': 'pending',
        'Home link on every page': 'pending',
        'No broken links': 'pending',
        'External links open in new tab': 'pending',
        'Anchors work correctly': 'pending',
        'Smooth navigation between pages': 'pending',
      },
      'Content & layout': {
        'No spelling errors': 'pending',
        'No grammatical errors': 'pending',
        'Fonts consistent across pages': 'pending',
        'Text properly aligned': 'pending',
        'Lists properly formatted': 'pending',
      },
      'Forms & validation': {
        'Form fields have labels': 'pending',
        'Tooltip text on every field': 'pending',
        'Required fields show error messages': 'pending',
        'Error messages match field labels': 'pending',
        'Error messages spelled correctly': 'pending',
        'Email/phone validation working': 'pending',
        'Form data preserved on error': 'pending',
        'Fields properly aligned': 'pending',
        'Spacing between fields adequate': 'pending',
        'Dropdown data not truncated': 'pending',
        'Confirmation message on submit': 'pending',
      },
      'Buttons & UI': {
        'Buttons standard format and size': 'pending',
        'Button text not truncated': 'pending',
        'Buttons clickable (not overlapped)': 'pending',
        'Buttons aligned properly': 'pending',
        'Keyboard accessible controls': 'pending',
      },
      'Images & media': {
        'No broken images': 'pending',
        'Images have alt text': 'pending',
        'Images load correctly': 'pending',
      },
      'Social media & footer': {
        'Social media links present': 'pending',
        'Social links work correctly': 'pending',
        'Social links open in new tab': 'pending',
        'Footer links present': 'pending',
        'Privacy & terms links in footer': 'pending',
        'Footer contact info & copyright': 'pending',
      },
      'Responsive / Viewport': {
        'Layout intact at 640×480': 'pending',
        'Layout intact at 800×600': 'pending',
        'Layout intact at 1366×768': 'pending',
        'Layout intact at 1920×1080': 'pending',
        'Layout intact at Tablet (768px)': 'pending',
        'Layout intact at Mobile (375px)': 'pending',
        'Scrollbar only when required': 'pending',
        'Mobile layout intact (375px)': 'pending',
        'Tablet layout intact (768px)': 'pending',
        'Viewport meta tag set': 'pending',
      },
      'Performance & usability': {
        'Pages load within 3 seconds': 'pending',
        'Images optimized': 'pending',
        'Page weight reasonable': 'pending',
      },
      'SEO & meta tags': {
        'Page title optimized': 'pending',
        'Meta description present': 'pending',
        'Single H1 per page': 'pending',
        'Search-friendly URLs': 'pending',
      },
      'Security': {
        'Served over HTTPS': 'pending',
        'HTTP redirects to HTTPS': 'pending',
        'HSTS header set': 'pending',
        'Content-Security-Policy set': 'pending',
        'Clickjacking protection set': 'pending',
        'X-Content-Type-Options nosniff': 'pending',
        'No mixed (http) content': 'pending',
        'Cookies Secure + HttpOnly': 'pending',
        'Server/tech version not disclosed': 'pending',
        'No sensitive files exposed': 'pending',
      },
    };
  }
}
