import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  AlertCircle, Bug, Camera, CheckCircle2, Clock, ExternalLink, FileSpreadsheet,
  ListChecks, Search, ShieldCheck, XCircle,
} from 'lucide-react';
import type { ChecklistStatus, TestIssue, TestResult } from '../types';
import { exportToExcel } from '../utils/export';

interface ReportPageProps {
  testResult: TestResult;
  issues: TestIssue[];
  checklistStatus: ChecklistStatus;
  testedUrl: string;
  onIssueStatusChange: (id: string, status: 'Open' | 'Fixed') => void;
  onViewIssues: () => void;
}

const severityStyle: Record<string, string> = {
  Critical: 'bg-rose-100 text-rose-700 border-rose-200',
  Major: 'bg-amber-100 text-amber-700 border-amber-200',
  Minor: 'bg-sky-100 text-sky-700 border-sky-200',
};

function openScreenshot(src: string) {
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(
    `<html><body style="margin:0;background:#0f172a;display:flex;align-items:flex-start;justify-content:center;min-height:100vh;padding:24px">` +
    `<img src="${src}" style="max-width:100%;height:auto;display:block;border-radius:10px;box-shadow:0 24px 80px rgba(0,0,0,.45)"/>` +
    `</body></html>`
  );
  win.document.close();
}

const ReportPage: React.FC<ReportPageProps> = ({
  testResult, issues, checklistStatus, testedUrl, onViewIssues,
}) => {
  const [search, setSearch] = useState('');

  const filteredIssues = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return issues;
    return issues.filter(i =>
      [i.name, i.category, i.affectedPage, i.description, ...(i.details ?? [])]
        .some(v => v.toLowerCase().includes(q))
    );
  }, [issues, search]);

  const checklistRows = useMemo(() => Object.entries(checklistStatus).flatMap(([category, items]) =>
    Object.entries(items).map(([item, status]) => ({ category, item, status }))
  ), [checklistStatus]);

  const stats = {
    issues: issues.length,
    critical: issues.filter(i => i.severity === 'Critical').length,
    failed: checklistRows.filter(i => i.status === 'fail').length,
    passed: checklistRows.filter(i => i.status === 'pass').length,
    pending: checklistRows.filter(i => i.status === 'pending').length,
  };

  const statCards = [
    { label: 'Issues Found', value: stats.issues, icon: Bug, style: 'bg-slate-900 text-white' },
    { label: 'Critical Bugs', value: stats.critical, icon: AlertCircle, style: 'bg-rose-50 text-rose-700 border border-rose-100' },
    { label: 'Checklist Pass', value: stats.passed, icon: CheckCircle2, style: 'bg-emerald-50 text-emerald-700 border border-emerald-100' },
    { label: 'Needs Review', value: stats.failed + stats.pending, icon: ListChecks, style: 'bg-amber-50 text-amber-700 border border-amber-100' },
  ];

  return (
    <div className="flex-1 bg-[#f8fafc] overflow-y-auto custom-scrollbar h-full">
      <header className="sticky top-0 bg-white/90 backdrop-blur-md border-b border-slate-200/60 px-8 py-4 flex items-center justify-between z-10 shrink-0">
        <div className="flex-1 max-w-xl relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search bugs, pages, broken links, or checklist notes"
            className="w-full pl-11 pr-4 py-2 bg-slate-100/70 border border-transparent rounded-xl text-sm focus:bg-white focus:border-indigo-500/30 transition-all outline-none"
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => exportToExcel(issues, testResult, checklistStatus, testedUrl)}
            className="flex items-center gap-2 px-5 py-2.5 bg-white border border-slate-200 rounded-xl text-[12px] font-black text-slate-700 hover:bg-slate-50 transition-all shadow-sm"
          >
            <FileSpreadsheet className="w-4 h-4" /> Export Excel
          </button>
          <button
            onClick={onViewIssues}
            className="flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-xl text-[12px] font-black hover:bg-slate-800 transition-all shadow-lg shadow-slate-200"
          >
            <Bug className="w-4 h-4" /> Issue Tracker
          </button>
        </div>
      </header>

      <main className="max-w-[1500px] mx-auto p-8 space-y-8 pb-20">
        <section className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm">
          <div className="flex items-start justify-between gap-6">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-indigo-50 border border-indigo-100 rounded-full mb-4">
                <ShieldCheck className="w-3.5 h-3.5 text-indigo-600" />
                <span className="text-[10px] font-black uppercase tracking-widest text-indigo-700">Checklist QA Report</span>
              </div>
              <h2 className="text-[24px] font-black text-slate-900 tracking-tight">Bug Report Dashboard</h2>
              <p className="text-[12px] text-slate-500 font-semibold mt-1 break-all">{testedUrl}</p>
            </div>
            <div className="flex items-center gap-2 text-[11px] font-bold text-slate-400">
              <Clock className="w-3.5 h-3.5" />
              Generated {new Date().toLocaleString()}
            </div>
          </div>

          <div className="grid grid-cols-4 gap-3 mt-6">
            {statCards.map(({ label, value, icon: Icon, style }) => (
              <div key={label} className={`rounded-2xl p-4 flex items-center justify-between ${style}`}>
                <div>
                  <p className="text-3xl font-black leading-none">{value}</p>
                  <p className="text-[10px] font-black uppercase tracking-widest opacity-70 mt-2">{label}</p>
                </div>
                <Icon className="w-5 h-5 opacity-70" />
              </div>
            ))}
          </div>
        </section>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
          <section className="xl:col-span-2 bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-[16px] font-black text-slate-900">Bugs With Evidence</h3>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                  Screenshot preview included for every auto-detected bug
                </p>
              </div>
              <span className="text-[11px] font-black text-slate-500">{filteredIssues.length} shown</span>
            </div>

            <div className="divide-y divide-slate-100">
              {filteredIssues.length === 0 ? (
                <div className="p-16 text-center">
                  <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-3" />
                  <p className="text-sm font-black text-slate-700">No matching bugs found</p>
                </div>
              ) : filteredIssues.map((issue, idx) => (
                <motion.article
                  key={issue.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.02 }}
                  className="p-5 grid grid-cols-[1fr_220px] gap-5 hover:bg-slate-50/70 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[10px] font-black text-slate-400">BUG-{issue.id.padStart(3, '0')}</span>
                      <span className={`px-2 py-0.5 rounded-full border text-[9px] font-black uppercase tracking-wider ${severityStyle[issue.severity]}`}>
                        {issue.severity}
                      </span>
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{issue.category}</span>
                    </div>
                    <h4 className="text-[14px] font-black text-slate-900 leading-snug">{issue.name}</h4>
                    <p className="text-[12px] text-slate-600 font-medium leading-relaxed mt-2">{issue.description}</p>
                    <p className="text-[11px] text-slate-400 font-semibold mt-2 break-all">{issue.affectedPage}</p>
                    {issue.details?.length ? (
                      <div className="mt-3 bg-slate-50 border border-slate-100 rounded-xl p-3 space-y-1">
                        {issue.details.slice(0, 6).map(detail => (
                          <p key={detail} className="text-[11px] font-semibold text-slate-500 break-all">{detail}</p>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="min-w-0">
                    {issue.screenshot ? (
                      <button onClick={() => openScreenshot(issue.screenshot!)} className="w-full text-left group">
                        <div className="aspect-[4/3] rounded-xl overflow-hidden border border-slate-200 bg-slate-100 shadow-inner">
                          <img src={issue.screenshot} alt="Bug screenshot" className="w-full h-full object-cover object-top group-hover:scale-[1.02] transition-transform" />
                        </div>
                        <span className="mt-2 flex items-center justify-center gap-1.5 text-[10px] font-black text-indigo-600 uppercase tracking-widest">
                          <Camera className="w-3 h-3" /> Open clear screenshot <ExternalLink className="w-3 h-3" />
                        </span>
                      </button>
                    ) : (
                      <div className="aspect-[4/3] rounded-xl border border-dashed border-slate-200 bg-slate-50 flex items-center justify-center text-[11px] font-bold text-slate-400">
                        No screenshot
                      </div>
                    )}
                  </div>
                </motion.article>
              ))}
            </div>
          </section>

          <section className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-100">
              <h3 className="text-[16px] font-black text-slate-900">Checklist Status</h3>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Workbook parameters</p>
            </div>
            <div className="max-h-[760px] overflow-y-auto custom-scrollbar divide-y divide-slate-50">
              {checklistRows.map(row => (
                <div key={`${row.category}-${row.item}`} className="p-4 flex items-start gap-3">
                  {row.status === 'pass'
                    ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                    : row.status === 'fail'
                    ? <XCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                    : <Clock className="w-4 h-4 text-slate-300 shrink-0 mt-0.5" />}
                  <div className="min-w-0">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{row.category}</p>
                    <p className="text-[12px] font-bold text-slate-700 leading-snug mt-0.5">{row.item}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
};

export default ReportPage;
