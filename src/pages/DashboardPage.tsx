import React from 'react';
import { motion } from 'framer-motion';
import {
  Camera, Link, FileText, ClipboardList, Image, Smartphone, Zap, Search,
  Heart, Globe, CheckSquare, ArrowRight, Activity, CheckCircle2, XCircle,
  ListChecks, History, ExternalLink, Sparkles,
} from 'lucide-react';
import type { RecentReport, ChecklistStatus } from '../types';

interface DashboardPageProps {
  url: string;
  setUrl: (url: string) => void;
  onStartTest: () => void;
  recentReports: RecentReport[];
  onViewReport: () => void;
  isTesting: boolean;
  checklistStatus: ChecklistStatus;
}

const TEST_CATEGORIES = [
  { id: 'branding',    icon: Camera,        label: 'Branding & Header',        key: 'Branding & header' },
  { id: 'navigation',  icon: Link,          label: 'Navigation & Links',        key: 'Navigation & link' },
  { id: 'content',     icon: FileText,      label: 'Content, Spelling & Fonts', key: 'Content & layout' },
  { id: 'forms',       icon: ClipboardList, label: 'Forms & Validation',        key: 'Forms & validation' },
  { id: 'buttons',     icon: CheckSquare,   label: 'Buttons & UI Standards',    key: 'Buttons & UI' },
  { id: 'images',      icon: Image,         label: 'Images & Media',            key: 'Images & media' },
  { id: 'social',      icon: Heart,         label: 'Social Media & Footer',     key: 'Social media & footer' },
  { id: 'responsive',  icon: Smartphone,    label: 'Responsive / Resolutions',  key: 'Responsive / Viewport' },
  { id: 'performance', icon: Zap,           label: 'Performance & Usability',   key: 'Performance & usability' },
  { id: 'seo',         icon: Search,        label: 'SEO & Meta Tags',           key: 'SEO & meta tags' },
];

const DEFAULT_CHECK_COUNTS: Record<string, number> = {
  'Branding & header': 7, 'Navigation & link': 6, 'Content & layout': 5,
  'Forms & validation': 11, 'Buttons & UI': 5, 'Images & media': 3,
  'Social media & footer': 6, 'Responsive / Viewport': 10,
  'Performance & usability': 3, 'SEO & meta tags': 4,
};

type CatStatus = 'pass' | 'fail' | 'warning' | 'pending' | 'partial';

const statusTheme: Record<CatStatus, { bg: string; text: string; border: string; bar: string; label: string }> = {
  pass:    { bg: '#ecfdf5', text: '#047857', border: '#a7f3d0', bar: '#10b981', label: 'Pass' },
  fail:    { bg: '#fef2f2', text: '#b91c1c', border: '#fecaca', bar: '#ef4444', label: 'Fail' },
  warning: { bg: '#fffbeb', text: '#b45309', border: '#fde68a', bar: '#f59e0b', label: 'Warning' },
  partial: { bg: '#eef2ff', text: '#4338ca', border: '#c7d2fe', bar: '#6366f1', label: 'Mixed' },
  pending: { bg: '#f1f5f9', text: '#64748b', border: '#e2e8f0', bar: '#cbd5e1', label: 'Pending' },
};

const DashboardPage: React.FC<DashboardPageProps> = ({
  url, setUrl, onStartTest, isTesting, checklistStatus, recentReports, onViewReport,
}) => {
  const catData = (key: string) => {
    const items = checklistStatus[key];
    const total = items ? Object.keys(items).length : DEFAULT_CHECK_COUNTS[key] ?? 0;
    if (!items) return { status: 'pending' as CatStatus, passed: 0, failed: 0, total, done: 0 };
    const vals = Object.values(items);
    const passed = vals.filter(s => s === 'pass').length;
    const failed = vals.filter(s => s === 'fail').length;
    const warned = vals.filter(s => s === 'warning').length;
    const done = passed + failed + warned;
    let status: CatStatus = 'pending';
    if (done > 0) {
      if (failed > 0) status = 'fail';
      else if (warned > 0) status = 'warning';
      else if (passed === vals.length) status = 'pass';
      else status = 'partial';
    }
    return { status, passed, failed, total: vals.length, done };
  };

  const totals = TEST_CATEGORIES.reduce(
    (acc, c) => {
      const d = catData(c.key);
      acc.total += d.total; acc.passed += d.passed; acc.failed += d.failed; acc.done += d.done;
      return acc;
    },
    { total: 0, passed: 0, failed: 0, done: 0 },
  );
  const hasRun = totals.done > 0;
  const healthScore = hasRun ? Math.round((totals.passed / Math.max(1, totals.passed + totals.failed)) * 100) : null;

  const stats = [
    { label: 'Test checks', value: totals.total, icon: ListChecks, color: '#4338ca', bg: '#eef2ff' },
    { label: 'Passed', value: hasRun ? totals.passed : '—', icon: CheckCircle2, color: '#047857', bg: '#ecfdf5' },
    { label: 'Failed', value: hasRun ? totals.failed : '—', icon: XCircle, color: '#b91c1c', bg: '#fef2f2' },
    { label: 'Audits run', value: recentReports.length, icon: Activity, color: '#9333ea', bg: '#faf5ff' },
  ];

  return (
    <div
      className="h-full overflow-y-auto custom-scrollbar"
      style={{ background: 'radial-gradient(1200px 400px at 80% -120px, #eef2ff 0%, rgba(238,242,255,0) 70%), #f6f7fb' }}
    >
      {/* ── Top bar ── */}
      <div style={{ background: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(10px)', borderBottom: '1px solid #e9ebf2', padding: '14px 32px', position: 'sticky', top: 0, zIndex: 20 }}>
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
              <Sparkles className="w-3.5 h-3.5 text-white" />
            </div>
            <div>
              <h1 className="text-[15px] font-extrabold text-slate-900 tracking-tight leading-none">Dashboard</h1>
              <p className="text-[11px] text-slate-400 mt-0.5">Automated website QA · {totals.total} checks · {TEST_CATEGORIES.length} categories</p>
            </div>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full" style={{ background: '#ecfdf5', border: '1px solid #bbf7d0' }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#22c55e', boxShadow: '0 0 8px #22c55e' }} />
            <span className="text-[11px] font-bold" style={{ color: '#15803d' }}>Engine ready</span>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-8 py-7 space-y-6">

        {/* ── Hero launcher ── */}
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
          className="relative overflow-hidden rounded-3xl"
          style={{
            background: 'linear-gradient(135deg,#4f46e5 0%,#6d28d9 55%,#7c3aed 100%)',
            boxShadow: '0 18px 40px -12px rgba(79,70,229,0.5), 0 4px 12px rgba(79,70,229,0.25)',
          }}
        >
          {/* decorative glows */}
          <div style={{ position: 'absolute', top: -80, right: -40, width: 260, height: 260, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,255,255,0.18), transparent 70%)' }} />
          <div style={{ position: 'absolute', bottom: -100, left: '40%', width: 280, height: 280, borderRadius: '50%', background: 'radial-gradient(circle, rgba(167,139,250,0.35), transparent 70%)' }} />

          <div className="relative p-8">
            <h2 className="text-white font-extrabold tracking-tight leading-tight" style={{ fontSize: 26, maxWidth: 560 }}>
              Audit any website in one click.
            </h2>
            <p className="mt-2 text-[13px]" style={{ color: 'rgba(255,255,255,0.8)', maxWidth: 540 }}>
              Enter a URL — the engine crawls every page, runs ~60 test cases at six screen sizes, and returns a
              page-by-page bug report with marked-up evidence screenshots.
            </p>

            <div className="flex gap-3 mt-6" style={{ maxWidth: 720 }}>
              <div className="flex-1 relative">
                <Globe className="absolute left-4 top-1/2 -translate-y-1/2" style={{ width: 16, height: 16, color: '#94a3b8' }} />
                <input
                  type="text"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !isTesting && onStartTest()}
                  placeholder="https://example.com"
                  style={{
                    width: '100%', padding: '14px 16px 14px 44px', background: '#ffffff',
                    border: '1px solid transparent', borderRadius: 13, fontSize: 14, fontWeight: 600,
                    color: '#0f172a', outline: 'none', boxShadow: '0 8px 20px rgba(15,23,42,0.18)',
                  }}
                />
              </div>
              <button
                onClick={onStartTest}
                disabled={isTesting || !url.trim()}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '0 28px',
                  background: isTesting || !url.trim() ? 'rgba(255,255,255,0.25)' : '#ffffff',
                  color: isTesting || !url.trim() ? '#ffffff' : '#4f46e5',
                  border: 'none', borderRadius: 13, fontSize: 14, fontWeight: 800,
                  cursor: isTesting || !url.trim() ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
                  boxShadow: isTesting || !url.trim() ? 'none' : '0 8px 20px rgba(15,23,42,0.2)',
                  transition: 'transform 0.12s ease',
                }}
                onMouseDown={e => { if (!isTesting && url.trim()) e.currentTarget.style.transform = 'scale(0.97)'; }}
                onMouseUp={e => { e.currentTarget.style.transform = 'scale(1)'; }}
              >
                {isTesting ? 'Audit running…' : 'Run audit'}
                {!isTesting && <ArrowRight style={{ width: 15, height: 15 }} />}
              </button>
            </div>

            <div className="flex items-center gap-5 mt-5 text-[11.5px] font-medium" style={{ color: 'rgba(255,255,255,0.75)' }}>
              <span className="flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" /> No API keys</span>
              <span className="flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" /> Every page &amp; screen size</span>
              <span className="flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" /> Evidence screenshots</span>
            </div>
          </div>
        </motion.div>

        {/* ── Stats row ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 + i * 0.04 }}
              className="rounded-2xl p-5 flex items-center gap-4"
              style={{ background: '#ffffff', border: '1px solid #eaecf3', boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 10px 24px -16px rgba(16,24,40,0.12)' }}
            >
              <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: s.bg }}>
                <s.icon style={{ width: 19, height: 19, color: s.color }} />
              </div>
              <div>
                <p className="text-[24px] font-extrabold text-slate-900 leading-none tracking-tight">{s.value}</p>
                <p className="text-[11.5px] font-medium text-slate-400 mt-1.5">{s.label}</p>
              </div>
              {s.label === 'Passed' && healthScore !== null && (
                <span className="ml-auto text-[11px] font-bold px-2 py-1 rounded-lg" style={{ background: '#ecfdf5', color: '#047857' }}>{healthScore}%</span>
              )}
            </motion.div>
          ))}
        </div>

        {/* ── Category grid ── */}
        <div>
          <div className="flex items-center justify-between mb-3.5">
            <h2 className="text-[13px] font-extrabold text-slate-800 uppercase tracking-wide">Test Categories</h2>
            <div className="flex items-center gap-4">
              {(['pass', 'fail', 'warning', 'pending'] as CatStatus[]).map(k => (
                <span key={k} className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
                  <span className="w-2 h-2 rounded-full" style={{ background: statusTheme[k].bar }} /> {statusTheme[k].label}
                </span>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {TEST_CATEGORIES.map((cat, i) => {
              const d = catData(cat.key);
              const theme = statusTheme[d.status];
              const pct = d.total ? Math.round((d.passed / d.total) * 100) : 0;
              return (
                <motion.div
                  key={cat.id}
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.025 }}
                  whileHover={{ y: -3 }}
                  className="rounded-2xl p-4"
                  style={{ background: '#ffffff', border: '1px solid #eaecf3', boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 12px 24px -18px rgba(16,24,40,0.14)' }}
                >
                  <div className="flex items-center gap-3 mb-3.5">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: theme.bg, border: `1px solid ${theme.border}` }}>
                      <cat.icon style={{ width: 17, height: 17, color: theme.text }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-[13px] font-bold text-slate-900 truncate leading-tight">{cat.label}</h3>
                      <p className="text-[11px] text-slate-400 mt-0.5">{d.done > 0 ? `${d.passed}/${d.total} passed` : `${d.total} checks`}</p>
                    </div>
                    <span className="text-[10px] font-extrabold px-2 py-1 rounded-md uppercase tracking-wide shrink-0" style={{ background: theme.bg, color: theme.text, border: `1px solid ${theme.border}` }}>
                      {theme.label}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#eef0f5' }}>
                    <motion.div
                      className="h-full rounded-full"
                      initial={{ width: 0 }} animate={{ width: `${d.done > 0 ? pct : 0}%` }} transition={{ duration: 0.7, delay: 0.15 + i * 0.025 }}
                      style={{ background: theme.bar }}
                    />
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* ── Recent audits ── */}
        {recentReports.length > 0 && (
          <div className="rounded-2xl overflow-hidden pb-1" style={{ background: '#ffffff', border: '1px solid #eaecf3', boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 12px 24px -18px rgba(16,24,40,0.14)' }}>
            <div className="flex items-center gap-2 px-5 py-4" style={{ borderBottom: '1px solid #eef0f5' }}>
              <History style={{ width: 15, height: 15, color: '#6366f1' }} />
              <h2 className="text-[12.5px] font-extrabold text-slate-800 uppercase tracking-wide">Recent Audits</h2>
            </div>
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid #eef0f5' }}>
                  {['Website', 'Date', 'Checks', 'Passed', 'Issues', ''].map(h => (
                    <th key={h} className="text-left text-[10.5px] font-extrabold text-slate-400 uppercase tracking-wider px-5 py-2.5">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentReports.map((r, i) => (
                  <tr key={i} style={{ borderBottom: i < recentReports.length - 1 ? '1px solid #f4f6f9' : 'none' }} className="transition-colors hover:bg-slate-50/60">
                    <td className="px-5 py-3.5 text-[12.5px] font-bold text-slate-800">{r.url.replace(/^https?:\/\//, '')}</td>
                    <td className="px-5 py-3.5 text-[12px] text-slate-500">{r.date}</td>
                    <td className="px-5 py-3.5 text-[12px] text-slate-500">{r.checkedCount}</td>
                    <td className="px-5 py-3.5 text-[12px] font-bold" style={{ color: '#047857' }}>{r.passedCount}</td>
                    <td className="px-5 py-3.5">
                      <span className="text-[11px] font-extrabold px-2.5 py-1 rounded-md" style={r.issueCount > 0 ? { background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' } : { background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0' }}>
                        {r.issueCount}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <button onClick={onViewReport} className="inline-flex items-center gap-1 text-[11.5px] font-bold" style={{ color: '#4f46e5' }}>
                        View <ExternalLink style={{ width: 11, height: 11 }} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="text-center py-2">
          <p className="text-[10.5px] text-slate-300 font-medium">TestingAgent v3.0 · Engineered by Kleza Solutions</p>
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;
