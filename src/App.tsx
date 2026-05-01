import React, { useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { TestingAgent } from './agent/tester';
import type { TestIssue, TestResult, ChecklistStatus, Page, AppSettings, RecentReport, TestingIssue } from './types';
import { TESTING_ISSUES } from './constants/testingData';
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

  const [settings, setSettings] = useState<AppSettings>({
    browser: 'chrome',
    mode: 'desktop',
    autoScreenshots: true,
    emailReport: false,
    email: '',
  });

  const addLog = useCallback((message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') => {
    setLogs(prev => [...prev, { message, type }]);

    const lower = message.toLowerCase();
    if (lower.includes('https') || lower.includes('ssl')) setCurrentPhase('Security Check');
    else if (lower.includes('html') || lower.includes('fetch')) setCurrentPhase('HTML Fetch');
    else if (lower.includes('analyzing')) setCurrentPhase('HTML Analysis');
    else if (lower.includes('pagespeed')) setCurrentPhase('Performance Audit');
    else if (lower.includes('seo')) setCurrentPhase('SEO Analysis');
    else if (lower.includes('initializ')) setCurrentPhase('Initializing');
    else if (lower.includes('complete') || lower.includes('audit complete')) setCurrentPhase('Complete');

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
    const { issues: foundIssues, result, checklistStatus: checks } = await agent.runFullAudit();

    const safeResult: TestResult = result ?? { mobile: EMPTY_SCORE_SET, foundData: {} };

    setIssues(foundIssues);
    setTestResult(safeResult);
    setChecklistStatus(checks);
    setIsTesting(false);

    // Merge scanned issues into the issue tracker (replace previous AI_ entries)
    const scannedMapped: TestingIssue[] = foundIssues.map(i => ({
      testCaseId: `AI_${i.id.slice(0, 4).toUpperCase()}`,
      pageUrl: i.affectedPage || 'Current Page',
      description: `${i.name}: ${i.description}${i.steps ? '\n\nSteps:\n' + i.steps : ''}`,
      deviceType: 'website',
      status: 'open',
      loggedBy: 'AI Agent',
      assignedTo: 'Sodham',
      remarks: i.category,
      reportedOn: new Date().toLocaleDateString(),
      priority: i.severity === 'Critical' ? 'High' : i.severity === 'Major' ? 'Medium' : 'Low',
      type: 'Auto Audit',
      version: '',
      screenshot: i.screenshot,
    }));
    setManualIssues(prev => [
      ...prev.filter(i => !i.testCaseId.startsWith('AI_')),
      ...scannedMapped,
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
      className="flex h-screen overflow-hidden bg-slate-50"
      style={{ fontFamily: "'Mulish', sans-serif" }}
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
                issuesFound={issuesFoundCount}
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
