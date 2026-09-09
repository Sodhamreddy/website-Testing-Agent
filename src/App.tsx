import React, { useState, useCallback, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { TestingAgent } from './agent/tester';
import type { TestIssue, TestResult, ChecklistStatus, Page, AppSettings, RecentReport, TestingIssue, RunComparison } from './types';
import { TESTING_ISSUES } from './constants/testingData';
import { loadSession, saveSession } from './utils/session';
import Sidebar from './components/Sidebar';
import DashboardPage from './pages/DashboardPage';
import LiveTestingPage from './pages/LiveTestingPage';
import ReportPage from './pages/ReportPage';
import SettingsPage from './pages/SettingsPage';
import TestingViewPage from './pages/TestingViewPage';

const pageVariants = {
  initial: { opacity: 0, x: 16 },
  animate: { opacity: 1, x: 0, transition: { duration: 0.22, ease: 'easeOut' } },
  exit: { opacity: 0, x: -12, transition: { duration: 0.15 } },
};

const EMPTY_SCORE_SET = {
  performance: 0, accessibility: 0, seo: 0, bestPractices: 0, vitals: {},
};

const App: React.FC = () => {
  const [page, setPage] = useState<Page>('dashboard');
  const [url, setUrl] = useState('');
  const [testedUrl, setTestedUrl] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<{ message: string; type: 'info' | 'success' | 'warning' | 'error' }[]>([]);
  const [currentPhase, setCurrentPhase] = useState('');
  const [issuesFoundCount, setIssuesFoundCount] = useState(0);

  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [issues, setIssues] = useState<TestIssue[]>([]);
  const [checklistStatus, setChecklistStatus] = useState<ChecklistStatus>({});
  const [recentReports, setRecentReports] = useState<RecentReport[]>([]);
  const [manualIssues, setManualIssues] = useState<TestingIssue[]>([...TESTING_ISSUES]);
  const [comparison, setComparison] = useState<RunComparison | null>(null);

  const [settings, setSettings] = useState<AppSettings>({
    browser: 'chrome',
    mode: 'desktop',
    autoScreenshots: true,
    emailReport: false,
    email: '',
  });

  // ── Session persistence: restore the last audit on load, save on change ──
  const hydrated = useRef(false);
  useEffect(() => {
    loadSession().then(s => {
      if (s) {
        setTestedUrl(s.testedUrl);
        setTestResult(s.testResult);
        setIssues(s.issues ?? []);
        setChecklistStatus(s.checklistStatus ?? {});
        setRecentReports(s.recentReports ?? []);
        setComparison(s.comparison ?? null);
        if (s.manualIssues?.length) setManualIssues(s.manualIssues);
      }
      hydrated.current = true;
    });
  }, []);

  useEffect(() => {
    if (!hydrated.current || isTesting) return;
    saveSession({
      testedUrl, testResult, issues, checklistStatus, recentReports, manualIssues, comparison,
      savedAt: new Date().toISOString(),
    });
  }, [testedUrl, testResult, issues, checklistStatus, recentReports, manualIssues, comparison, isTesting]);

  const addLog = useCallback((message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') => {
    setLogs(prev => [...prev, { message, type }]);

    const lower = message.toLowerCase();
    if (lower.includes('branding')) setCurrentPhase('Branding & Header');
    else if (lower.includes('crawling') || lower.includes('visiting')) setCurrentPhase('Page Crawl');
    else if (lower.includes('validating every link') || lower.includes('checking') && lower.includes('link')) setCurrentPhase('Link Integrity');
    else if (lower.includes('spelling') || lower.includes('analyzing content')) setCurrentPhase('Content & Spelling');
    else if (lower.includes('form')) setCurrentPhase('Forms & Validation');
    else if (lower.includes('button') || lower.includes('keyboard')) setCurrentPhase('Buttons & UI');
    else if (lower.includes('social')) setCurrentPhase('Social & Footer');
    else if (lower.includes('resolution') || lower.includes('scanning layout')) setCurrentPhase('Responsive Testing');
    else if (lower.includes('performance') || lower.includes('seo')) setCurrentPhase('Performance & SEO');
    else if (lower.includes('initializ') || lower.includes('starting')) setCurrentPhase('Initializing');
    else if (lower.includes('audit complete')) setCurrentPhase('Complete');

    if (message.includes('[Critical]') || message.includes('[Major]') || message.includes('[Minor]')) {
      setIssuesFoundCount(prev => prev + 1);
    }
  }, []);

  const runTests = useCallback(async () => {
    if (!url.trim()) return;

    let targetUrl = url.trim();
    if (!targetUrl.startsWith('http')) targetUrl = 'https://' + targetUrl;

    setTestedUrl(targetUrl);
    setIsTesting(true);
    setPage('testing');
    setProgress(0);
    setLogs([]);
    setIssuesFoundCount(0);
    setCurrentPhase('Initializing...');

    const agent = new TestingAgent(targetUrl, addLog, pct => setProgress(pct));

    let foundIssues: TestIssue[];
    let result: TestResult | null;
    let checks: ChecklistStatus;
    let cmp: RunComparison | null | undefined;
    try {
      ({ issues: foundIssues, result, checklistStatus: checks, comparison: cmp } = await agent.runFullAudit());
    } catch (err) {
      // The stream failed (backend down, wrong API origin, CORS, mid-audit error).
      // Surface it instead of leaving the UI stuck at 0% "Initializing" forever.
      const msg = err instanceof Error ? err.message : String(err);
      addLog(`❌ Audit failed: ${msg}`, 'error');
      addLog('Check the audit backend is reachable — locally: npm run dev:full; deployed: the API host in VITE_API_BASE.', 'warning');
      setCurrentPhase('Failed');
      setIsTesting(false);
      return;
    }
    setComparison(cmp ?? null);

    const safeResult: TestResult = result ?? { mobile: EMPTY_SCORE_SET, foundData: {} };

    setIssues(foundIssues);
    setTestResult(safeResult);
    setChecklistStatus(checks);
    setIsTesting(false);

    // Key a page by its path so an issue and its page's SEO suggestion line up
    // regardless of " @ Mobile" / " › Header" suffixes on affectedPage.
    const pageKey = (s: string) => {
      const clean = (s || '').split(' @ ')[0].split(' › ')[0].trim();
      try { return new URL(clean.startsWith('http') ? clean : 'https://' + clean).pathname.replace(/\/$/, '') || '/'; }
      catch { return clean; }
    };
    const isSeoRecName = (n: string) => /^SEO recommendations for/i.test(n);
    const isGeoRecName = (n: string) => /^AI-search \(GEO\) recommendations for/i.test(n);
    const isRecName = (n: string) => isSeoRecName(n) || isGeoRecName(n);

    // Per-page SEO (classic) and GEO recommendations — full text for the dedicated
    // row, a compact version for every other issue on that page.
    const mapRecs = (match: (n: string) => boolean, compactFilter: (d: string) => boolean, compactN: number) => {
      const m = new Map<string, { full: string; compact: string }>();
      for (const i of foundIssues) {
        if (i.category === 'SEO' && match(i.name) && i.details?.length) {
          const full = i.details.join('\n');
          const compact = i.details.filter(compactFilter).slice(0, compactN).join('\n') || full;
          m.set(pageKey(i.affectedPage), { full, compact });
        }
      }
      return m;
    };
    const seoByPage = mapRecs(isSeoRecName, d => /^Suggested (title|meta description)/i.test(d), 2);
    const geoByPage = mapRecs(isGeoRecName, d => d.trim().startsWith('•'), 2);
    const fallbackSeo = seoByPage.get('/') ?? [...seoByPage.values()][0];
    const fallbackGeo = geoByPage.get('/') ?? [...geoByPage.values()][0];

    // ── Site-wide security posture — shown in the Security column on every row ──
    const secItems = checks['Security'] ?? {};
    const secMark = (s: string) => (s === 'pass' ? '✓' : s === 'fail' ? '✗' : s === 'warning' ? '⚠' : '–');
    const securityFull = Object.entries(secItems).map(([k, v]) => `${secMark(v)} ${k}`).join('\n');

    // Merge scanned issues into the issue tracker
    const scannedMapped: TestingIssue[] = foundIssues.map(i => {
      const isSeoRec = i.category === 'SEO' && isSeoRecName(i.name);
      const isGeoRec = i.category === 'SEO' && isGeoRecName(i.name);
      const isRec = isRecName(i.name);
      const isSecurity = i.category === 'Security';
      const pageSeo = seoByPage.get(pageKey(i.affectedPage)) ?? fallbackSeo;
      const pageGeo = geoByPage.get(pageKey(i.affectedPage)) ?? fallbackGeo;
      const own = i.details?.length ? i.details.join('\n') : undefined;

      // Classic SEO goes INLINE in the description (a short "SEO (this page)"
      // block). GEO and Security stay in their own columns only.
      const seoBlock = !isRec && !isSecurity && pageSeo?.compact
        ? '\n\nSEO (this page):\n' + pageSeo.compact
        : '';
      const description = isRec
        ? i.name + (isSeoRec && own ? '\n\n' + own : '')
        : `${i.name}: ${i.description}`
          + (i.details?.length ? '\n\nExact locations:\n' + i.details.map(d => '• ' + d).join('\n') : '')
          + (i.steps ? '\n\nSteps to fix:\n' + i.steps : '')
          + seoBlock;

      return {
        testCaseId: `QA_${i.id.padStart(3, '0')}`,
        pageUrl: i.affectedPage || 'Current Page',
        description,
        geoSuggestion: isGeoRec ? own : pageGeo?.compact,
        securityNote: isSecurity
          ? [i.description, ...(i.details ?? [])].filter(Boolean).join('\n')
          : (securityFull || undefined),
        deviceType: /mobile/i.test(i.browser) ? 'mobile' : /tablet|pad/i.test(i.browser) ? 'tablet' : 'website',
        status: 'open',
        loggedBy: 'Test Engine',
        assignedTo: 'Sodham',
        remarks: i.category,
        reportedOn: new Date().toLocaleDateString(),
        priority: i.severity === 'Critical' ? 'High' : i.severity === 'Major' ? 'Medium' : 'Low',
        type: isSeoRec ? 'SEO' : isGeoRec ? 'GEO' : isSecurity ? 'Security' : 'Auto Audit',
        version: '',
        screenshot: i.screenshot,
      };
    });

    // Bugs that were open in the previous audit but are gone now → tracked as
    // VERIFIED rows so each fix is recorded and auditable.
    const prevRanAt = cmp?.previousRanAt ? new Date(cmp.previousRanAt).toLocaleDateString() : 'the previous audit';
    const resolvedMapped: TestingIssue[] = (cmp?.resolved ?? []).map((r, n) => ({
      testCaseId: `V_${String(n + 1).padStart(3, '0')}`,
      pageUrl: r.affectedPage || 'Site Audit',
      description: `${r.name}\n\nStatus: FIXED — this issue was open on ${prevRanAt} and is no longer detected in this audit.`,
      deviceType: 'website',
      status: 'verified',
      loggedBy: 'Test Engine',
      assignedTo: 'Sodham',
      remarks: r.category,
      reportedOn: new Date().toLocaleDateString(),
      priority: r.severity === 'Critical' ? 'High' : r.severity === 'Major' ? 'Medium' : 'Low',
      type: 'Auto Audit',
      version: '',
    }));

    setManualIssues(prev => [
      ...prev.filter(i => !i.testCaseId.startsWith('AI_') && !i.testCaseId.startsWith('QA_') && !i.testCaseId.startsWith('V_')),
      ...scannedMapped,
      ...resolvedMapped,
    ]);

    const passedCount = Object.values(checks).reduce(
      (acc, cat) => acc + Object.values(cat).filter(s => s === 'pass').length,
      0
    );
    const checkedCount = Object.values(checks).reduce(
      (acc, cat) => acc + Object.values(cat).filter(s => s !== 'pending').length,
      0
    );

    setRecentReports(prev => [
      { url: targetUrl, date: new Date().toLocaleDateString(), issueCount: foundIssues.length, passedCount, checkedCount },
      ...prev.slice(0, 4),
    ]);

    setPage('testing_view');
  }, [url, addLog]);

  const handleIssueStatusChange = useCallback((id: string, newStatus: 'Open' | 'Fixed') => {
    setIssues(prev => prev.map(i => (i.id === id ? { ...i, status: newStatus } : i)));
  }, []);

  return (
    <div
      className="flex h-screen overflow-hidden"
      style={{ fontFamily: "'Inter', system-ui, sans-serif", background: '#f6f7f9' }}
    >
      <Sidebar
        currentPage={page}
        onNavigate={setPage}
        hasReport={testResult !== null}
      />

      <main className="flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          {page === 'dashboard' && (
            <motion.div
              key="dashboard"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="h-full"
            >
              <DashboardPage
                url={url}
                setUrl={setUrl}
                onStartTest={runTests}
                recentReports={recentReports}
                onViewReport={() => setPage('testing_view')}
                isTesting={isTesting}
                checklistStatus={checklistStatus}
              />
            </motion.div>
          )}

          {page === 'testing' && (
            <motion.div
              key="testing"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="h-full"
            >
              <LiveTestingPage
                progress={progress}
                logs={logs}
                currentPhase={currentPhase}

                testedUrl={testedUrl}
                isTesting={isTesting}
                onViewReport={() => setPage('testing_view')}
              />
            </motion.div>
          )}

          {page === 'report' && testResult && (
            <motion.div
              key="report"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="h-full"
            >
              <ReportPage
                testResult={testResult}
                issues={issues}
                checklistStatus={checklistStatus}
                testedUrl={testedUrl}
                onIssueStatusChange={handleIssueStatusChange}
                onViewIssues={() => setPage('testing_view')}
              />
            </motion.div>
          )}

          {page === 'testing_view' && (
            <motion.div
              key="testing_view"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="h-full"
            >
              <TestingViewPage
                manualIssues={manualIssues}
                onManualIssuesChange={setManualIssues}
                comparison={comparison}
                testedUrl={testedUrl}
              />
            </motion.div>
          )}

          {page === 'settings' && (
            <motion.div
              key="settings"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="h-full"
            >
              <SettingsPage settings={settings} onSettingsChange={setSettings} />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
};

export default App;
