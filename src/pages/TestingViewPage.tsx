import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ClipboardList, Search, Plus, Download, Edit2, Trash2, X,
  CheckCircle2, Clock, Monitor, Smartphone, Tablet, Camera, ExternalLink, AlertCircle,
  AlertTriangle, Filter, ChevronRight, Image,
} from 'lucide-react';
import type { TestingIssue } from '../types';

// ── Constants ────────────────────────────────────────────────────────────────
const TEAM_MEMBERS = ['Sodham', 'Shilpa', 'AI Agent', 'QA Team', 'Dev Team'];
const STATUS_CYCLE  = ['open', 'in progress', 'verified', 'fixed', 'watching'];
const STATUS_OPTIONS = STATUS_CYCLE;
const PRIORITY_OPTIONS = ['High', 'Medium', 'Low'] as const;
const TYPE_OPTIONS = ['UI', 'Functionality', 'Performance', 'Security', 'Content', 'Accessibility', 'SEO', 'Auto Audit'];
const DEVICE_OPTIONS = ['website'];

// ── Helpers ──────────────────────────────────────────────────────────────────
function getNextTcId(issues: TestingIssue[]): string {
  const nums = issues
    .filter(i => /^TC_\d+$/.test(i.testCaseId))
    .map(i => parseInt(i.testCaseId.slice(3)))
    .filter(n => !isNaN(n));
  return `TC_${String((nums.length ? Math.max(...nums) : 9) + 1).padStart(3, '0')}`;
}

function nextStatus(current: string): string {
  const idx = STATUS_CYCLE.indexOf(current.toLowerCase());
  return STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
}

function statusCfg(s: string) {
  const key = s.toLowerCase();
  if (key === 'verified' || key === 'fixed')  return { bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500', ring: 'hover:ring-emerald-300' };
  if (key === 'in progress')                  return { bg: 'bg-blue-100',    text: 'text-blue-700',    dot: 'bg-blue-500',    ring: 'hover:ring-blue-300' };
  if (key === 'watching')                     return { bg: 'bg-violet-100',  text: 'text-violet-700',  dot: 'bg-violet-500',  ring: 'hover:ring-violet-300' };
  return                                             { bg: 'bg-amber-100',   text: 'text-amber-700',   dot: 'bg-amber-500',   ring: 'hover:ring-amber-300' };
}

function priorityStripe(p: string) {
  if (p === 'High')   return '#f43f5e';
  if (p === 'Medium') return '#f59e0b';
  return '#60a5fa';
}

function priorityBadge(p: string) {
  if (p === 'High')   return 'bg-rose-100 text-rose-700';
  if (p === 'Medium') return 'bg-amber-100 text-amber-700';
  return 'bg-blue-100 text-blue-700';
}

function domainOf(url: string) {
  try { return new URL(url.startsWith('http') ? url : 'https://' + url).hostname; }
  catch { return url; }
}

function openScreenshot(src: string) {
  if (src.startsWith('data:')) {
    const win = window.open('', '_blank');
    if (win) {
      win.document.write(
        `<html><body style="margin:0;background:#111;display:flex;align-items:center;justify-content:center;min-height:100vh">` +
        `<img src="${src}" style="max-width:100%;max-height:100vh;display:block;border-radius:8px"/>` +
        `</body></html>`
      );
      win.document.close();
    }
  } else {
    window.open(src, '_blank', 'noopener,noreferrer');
  }
}

const EMPTY: Omit<TestingIssue, 'testCaseId'> = {
  pageUrl: '', description: '', deviceType: 'website', status: 'open',
  loggedBy: '', assignedTo: '', remarks: '', version: '',
  reportedOn: new Date().toLocaleDateString(), priority: 'Medium', type: 'UI',
  screenshot: '',
};

// ── Screenshot preview (with fallback page-info card) ────────────────────────
const ScreenshotPreview: React.FC<{ src: string; url?: string; title?: string; compact?: boolean }> = ({
  src, url = '', title = '', compact = false,
}) => {
  const [failed, setFailed] = useState(false);
  const domain = domainOf(url);

  if (!src) return null;

  if (failed) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer"
        className={`flex items-center gap-2.5 bg-slate-50 border border-slate-200 rounded-xl p-2.5 hover:border-indigo-300 transition-colors ${compact ? 'mt-2' : 'mt-3'}`}
      >
        <img src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`} alt="" className="w-5 h-5 rounded shrink-0" />
        <div className="min-w-0">
          <p className="text-[11px] font-bold text-slate-700 truncate">{title || domain}</p>
          <p className="text-[10px] text-slate-400 truncate">{domain}</p>
        </div>
        <ExternalLink className="w-3 h-3 text-slate-400 ml-auto shrink-0" />
      </a>
    );
  }

  return (
    <div
      onClick={() => openScreenshot(src)}
      className={`block relative rounded-xl overflow-hidden border border-slate-200 group/ss cursor-pointer ${compact ? 'mt-2' : 'mt-3'}`}
      style={{ maxHeight: compact ? 72 : 200 }}
    >
      <img
        src={src}
        alt="Screenshot"
        className="w-full object-cover object-top"
        style={{ maxHeight: compact ? 72 : 200 }}
        onError={() => setFailed(true)}
      />
      <div className="absolute inset-0 bg-slate-900/0 group-hover/ss:bg-slate-900/25 flex items-center justify-center transition-all">
        <div className="opacity-0 group-hover/ss:opacity-100 transition-opacity bg-white/90 backdrop-blur rounded-lg px-2.5 py-1.5 flex items-center gap-1.5">
          <ExternalLink className="w-3 h-3 text-slate-600" />
          <span className="text-[10px] font-bold text-slate-700">Open full size</span>
        </div>
      </div>
    </div>
  );
};

// ── Modal ────────────────────────────────────────────────────────────────────
interface ModalProps {
  mode: 'create' | 'edit';
  issue: TestingIssue;
  onSave: (issue: TestingIssue) => void;
  onClose: () => void;
}

const IssueModal: React.FC<ModalProps> = ({ mode, issue, onSave, onClose }) => {
  const [form, setForm] = useState<TestingIssue>({ ...issue });
  const set = (k: keyof TestingIssue, v: string) => setForm(p => ({ ...p, [k]: v }));

  const inp = 'w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[13px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/30 focus:border-indigo-400 transition-all';
  const lbl = 'block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5';

  const sc = statusCfg(form.status);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 backdrop-blur-[6px] z-50 flex items-center justify-center p-4"
        onClick={e => e.target === e.currentTarget && onClose()}
      >
        <motion.div
          initial={{ scale: 0.96, opacity: 0, y: 24 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.96, opacity: 0, y: 12 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          className="bg-white rounded-[28px] shadow-[0_32px_80px_rgba(0,0,0,0.18)] w-full max-w-3xl max-h-[92vh] overflow-y-auto"
        >
          {/* Modal Header */}
          <div className="sticky top-0 bg-white/96 backdrop-blur border-b border-slate-100 px-8 py-5 flex items-center justify-between rounded-t-[28px] z-10">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shadow-sm ${mode === 'create' ? 'bg-indigo-600' : 'bg-slate-100'}`}>
                {mode === 'create'
                  ? <Plus className="w-5 h-5 text-white" />
                  : <Edit2 className="w-4.5 h-4.5 text-slate-600" style={{ width: 18, height: 18 }} />}
              </div>
              <div>
                <h2 className="text-[17px] font-[900] text-slate-900 tracking-tight">
                  {mode === 'create' ? 'Log New Issue' : `Edit — ${issue.testCaseId}`}
                </h2>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
                  {mode === 'create' ? 'Create a new QA test case' : 'Update issue details & assignment'}
                </p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
              <X className="w-5 h-5 text-slate-400" />
            </button>
          </div>

          <form
            onSubmit={e => { e.preventDefault(); if (form.pageUrl.trim() && form.description.trim()) onSave(form); }}
            className="p-8 space-y-6"
          >
            {/* Section: Basic Info */}
            <div className="space-y-4">
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <label className={lbl}>Case ID</label>
                  <input value={form.testCaseId} readOnly className={inp + ' bg-slate-100 text-slate-500 cursor-not-allowed'} />
                </div>
                <div className="col-span-2">
                  <label className={lbl}>Page / Section *</label>
                  <input value={form.pageUrl} onChange={e => set('pageUrl', e.target.value)} placeholder="e.g. Home Page / Contact Us" required className={inp} />
                </div>
                <div>
                  <label className={lbl}>Scope</label>
                  <select value={form.deviceType} onChange={e => set('deviceType', e.target.value)} className={inp + ' cursor-pointer'}>
                    {DEVICE_OPTIONS.map(d => <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className={lbl}>Issue Description *</label>
                <textarea
                  value={form.description}
                  onChange={e => set('description', e.target.value)}
                  placeholder={"Brief summary of the issue.\n1. Step one\n2. Step two\n3. Expected result vs actual result"}
                  required rows={5}
                  className={inp + ' resize-y'}
                />
              </div>
            </div>

            {/* Section: Classification */}
            <div className="pt-1 border-t border-slate-50">
              <p className="text-[9px] font-black text-slate-300 uppercase tracking-widest mb-3">Classification</p>
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <label className={lbl}>Priority</label>
                  <select value={form.priority} onChange={e => set('priority', e.target.value as TestingIssue['priority'])} className={inp + ' cursor-pointer'}>
                    {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className={lbl}>Type</label>
                  <select value={form.type} onChange={e => set('type', e.target.value)} className={inp + ' cursor-pointer'}>
                    {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className={lbl}>Status</label>
                  <select value={form.status} onChange={e => set('status', e.target.value)} className={inp + ' cursor-pointer'}>
                    {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                  </select>
                </div>
                <div>
                  <label className={lbl}>Version</label>
                  <input value={form.version || ''} onChange={e => set('version', e.target.value)} placeholder="v1.0" className={inp} />
                </div>
              </div>
            </div>

            {/* Section: Assignment */}
            <div className="pt-1 border-t border-slate-50">
              <p className="text-[9px] font-black text-slate-300 uppercase tracking-widest mb-3">Assignment</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={lbl}>Logged By</label>
                  <input value={form.loggedBy} onChange={e => set('loggedBy', e.target.value)} placeholder="Name" className={inp} />
                </div>
                <div>
                  <label className={lbl}>Assigned To</label>
                  <select value={form.assignedTo} onChange={e => set('assignedTo', e.target.value)} className={inp + ' cursor-pointer'}>
                    <option value="">— Select member —</option>
                    {TEAM_MEMBERS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className={lbl}>Reported On</label>
                  <input value={form.reportedOn} onChange={e => set('reportedOn', e.target.value)} placeholder="MM/DD/YYYY" className={inp} />
                </div>
              </div>
            </div>

            {/* Section: Notes & Screenshot */}
            <div className="pt-1 border-t border-slate-50">
              <p className="text-[9px] font-black text-slate-300 uppercase tracking-widest mb-3">Notes & Evidence</p>
              <div className="space-y-3">
                <div>
                  <label className={lbl}>Remarks</label>
                  <textarea value={form.remarks} onChange={e => set('remarks', e.target.value)} placeholder="Additional notes, context, or observations…" rows={2} className={inp + ' resize-y'} />
                </div>
                <div>
                  <label className={lbl}>Screenshot URL</label>
                  <input
                    value={form.screenshot || ''}
                    onChange={e => set('screenshot', e.target.value)}
                    placeholder="Paste image URL (or auto-filled from scan)"
                    className={inp}
                  />
                  {form.screenshot && (
                    <ScreenshotPreview src={form.screenshot} url={form.pageUrl} title={form.description.split('\n')[0]} />
                  )}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
              <button type="button" onClick={onClose} className="px-6 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[13px] font-bold text-slate-600 hover:bg-slate-100 transition-all">
                Cancel
              </button>
              <button type="submit" className="px-8 py-2.5 bg-indigo-600 text-white rounded-xl text-[13px] font-bold hover:bg-indigo-700 active:scale-95 transition-all shadow-lg shadow-indigo-200/60 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                {mode === 'create' ? 'Create Issue' : 'Save Changes'}
              </button>
            </div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

// ── Page ─────────────────────────────────────────────────────────────────────
interface TestingViewPageProps {
  manualIssues: TestingIssue[];
  onManualIssuesChange: (issues: TestingIssue[]) => void;
}

const TestingViewPage: React.FC<TestingViewPageProps> = ({ manualIssues, onManualIssuesChange }) => {
  const [search, setSearch]            = useState('');
  const [statusFilter, setStatusF]     = useState('all');
  const [priorityFilter, setPriorityF] = useState('all');
  const [modal, setModal]              = useState<{ mode: 'create' | 'edit'; issue: TestingIssue } | null>(null);

  const filtered = useMemo(() => manualIssues.filter(i => {
    const q = search.toLowerCase();
    const matchQ = !q || [i.testCaseId, i.pageUrl, i.description, i.assignedTo, i.loggedBy].some(f => f.toLowerCase().includes(q));
    const matchS = statusFilter === 'all' || i.status.toLowerCase() === statusFilter;
    const matchP = priorityFilter === 'all' || i.priority === priorityFilter;
    return matchQ && matchS && matchP;
  }), [manualIssues, search, statusFilter, priorityFilter]);

  const stats = useMemo(() => ({
    total:      manualIssues.length,
    open:       manualIssues.filter(i => i.status === 'open').length,
    inProgress: manualIssues.filter(i => i.status === 'in progress').length,
    verified:   manualIssues.filter(i => ['verified', 'fixed'].includes(i.status)).length,
    high:       manualIssues.filter(i => i.priority === 'High').length,
  }), [manualIssues]);

  const openCreate = () => setModal({ mode: 'create', issue: { testCaseId: getNextTcId(manualIssues), ...EMPTY } as TestingIssue });
  const openEdit   = (issue: TestingIssue) => setModal({ mode: 'edit', issue: { ...issue } });

  const handleSave = (saved: TestingIssue) => {
    onManualIssuesChange(
      modal?.mode === 'create'
        ? [...manualIssues, saved]
        : manualIssues.map(i => i.testCaseId === saved.testCaseId ? saved : i)
    );
    setModal(null);
  };

  const handleDelete = (id: string) => {
    if (window.confirm('Delete this issue?'))
      onManualIssuesChange(manualIssues.filter(i => i.testCaseId !== id));
  };

  const handleQuickStatus = (id: string, current: string) => {
    onManualIssuesChange(
      manualIssues.map(i => i.testCaseId === id ? { ...i, status: nextStatus(current) } : i)
    );
  };

  const handleExport = () => {
    const hdr = ['Test Case #', 'Page/Section', 'Issue Description', 'Scope', 'Status', 'Logged By', 'Assigned To', 'Remarks', 'Reported On', 'Priority', 'Type', 'Version'];
    const rows = manualIssues.map(i => [
      i.testCaseId, `"${i.pageUrl}"`,
      `"${i.description.replace(/"/g, "'").replace(/\n/g, ' | ')}"`,
      i.deviceType, i.status, i.loggedBy, i.assignedTo,
      `"${(i.remarks || '').replace(/"/g, "'")}"`,
      i.reportedOn, i.priority, i.type, i.version || '',
    ]);
    const csv = [hdr.join(','), ...rows.map(r => r.join(','))].join('\n');
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' })),
      download: `TestLog_${new Date().toISOString().split('T')[0]}.csv`,
      style: 'display:none',
    });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const statCards = [
    { label: 'Total Issues',   value: stats.total,      bg: 'bg-white',       border: 'border-slate-200', num: 'text-slate-900',   Icon: ClipboardList, ic: 'bg-slate-100 text-slate-500' },
    { label: 'Open',           value: stats.open,        bg: 'bg-amber-50',    border: 'border-amber-200', num: 'text-amber-700',   Icon: AlertCircle,   ic: 'bg-amber-100 text-amber-600' },
    { label: 'In Progress',    value: stats.inProgress,  bg: 'bg-blue-50',     border: 'border-blue-200',  num: 'text-blue-700',    Icon: Clock,         ic: 'bg-blue-100 text-blue-600' },
    { label: 'Verified / Fixed', value: stats.verified,  bg: 'bg-emerald-50',  border: 'border-emerald-200', num: 'text-emerald-700', Icon: CheckCircle2, ic: 'bg-emerald-100 text-emerald-600' },
    { label: 'High Priority',  value: stats.high,        bg: 'bg-rose-50',     border: 'border-rose-200',  num: 'text-rose-700',    Icon: AlertTriangle, ic: 'bg-rose-100 text-rose-500' },
  ];

  return (
    <div className="h-full overflow-hidden flex flex-col" style={{ background: '#f6f8fb' }}>

      {/* ── Header ── */}
      <div className="bg-white border-b border-slate-100 px-8 pt-6 pb-5 shrink-0">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center shadow-md shadow-indigo-300/50">
                <ClipboardList className="text-white" style={{ width: 18, height: 18 }} />
              </div>
              <h1 className="text-[22px] font-[900] text-slate-900 tracking-tight">Issue Tracker</h1>
            </div>
            <p className="text-[11px] text-slate-400 font-bold uppercase tracking-[0.14em] pl-12">
              QA Test Cases · Create · Edit · Assign
            </p>
          </div>
          <div className="flex gap-2.5">
            <button onClick={handleExport}
              className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-[12px] font-bold text-slate-600 hover:border-slate-300 hover:bg-slate-50 transition-all shadow-sm">
              <Download style={{ width: 14, height: 14 }} /> Export CSV
            </button>
            <button onClick={openCreate}
              className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-[12px] font-black uppercase tracking-wider hover:bg-indigo-700 active:scale-95 transition-all shadow-lg shadow-indigo-300/40">
              <Plus style={{ width: 16, height: 16 }} /> Create Issue
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-5 gap-3 mb-5">
          {statCards.map(s => (
            <div key={s.label} className={`${s.bg} border ${s.border} rounded-2xl p-4 flex items-center justify-between group`}>
              <div>
                <div className={`text-[30px] font-[900] leading-none mb-1.5 ${s.num}`}>{s.value}</div>
                <div className="text-[9.5px] font-black uppercase tracking-[0.12em] text-slate-400">{s.label}</div>
              </div>
              <div className={`w-10 h-10 rounded-2xl flex items-center justify-center ${s.ic}`}>
                <s.Icon style={{ width: 18, height: 18 }} />
              </div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2.5">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" style={{ width: 14, height: 14 }} />
            <input
              type="text" placeholder="Search ID, page, description, assignee…"
              value={search} onChange={e => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[12.5px] text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/20 focus:border-indigo-400 transition-all"
            />
          </div>
          <Filter className="text-slate-400 ml-0.5" style={{ width: 14, height: 14 }} />
          <select value={statusFilter} onChange={e => setStatusF(e.target.value)}
            className="px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[12px] font-bold text-slate-600 focus:outline-none focus:border-indigo-400 cursor-pointer transition-all">
            <option value="all">All Status</option>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
          </select>
          <select value={priorityFilter} onChange={e => setPriorityF(e.target.value)}
            className="px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[12px] font-bold text-slate-600 focus:outline-none focus:border-indigo-400 cursor-pointer transition-all">
            <option value="all">All Priority</option>
            {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <AnimatePresence>
            {filtered.length !== manualIssues.length && (
              <motion.span
                initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.85 }}
                className="text-[11px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded-lg"
              >
                {filtered.length} / {manualIssues.length}
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── Table area ── */}
      <div className="flex-1 overflow-auto p-6">
        {filtered.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <div className="w-20 h-20 bg-white rounded-3xl flex items-center justify-center mx-auto mb-5 border border-slate-100 shadow-sm">
                <ClipboardList style={{ width: 32, height: 32 }} className="text-slate-200" />
              </div>
              <h3 className="text-[18px] font-[900] text-slate-800 mb-2">
                {manualIssues.length === 0 ? 'No issues yet' : 'No matches'}
              </h3>
              <p className="text-[13px] text-slate-400 mb-6">
                {manualIssues.length === 0
                  ? 'Run a scan to auto-detect issues, or create one manually'
                  : 'Try adjusting your search or filters'}
              </p>
              {manualIssues.length === 0 && (
                <button onClick={openCreate}
                  className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl text-[13px] font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200/60">
                  + Create First Issue
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left" style={{ borderCollapse: 'collapse', minWidth: 1220 }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid #f1f5f9' }}>
                    <th style={{ width: 4, padding: 0 }} />
                    {['ID', 'Page / Section', 'Issue Description', 'Scope', 'Status', 'Priority / Type', 'Assignment', 'Date', ''].map((h, i) => (
                      <th key={i} className="px-4 py-3.5 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((issue, idx) => {
                    const sc = statusCfg(issue.status);
                    return (
                      <motion.tr
                        key={issue.testCaseId}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.016 }}
                        className="group hover:bg-slate-50/70 transition-colors"
                        style={{ borderBottom: '1px solid #f1f5f9' }}
                      >
                        {/* Priority stripe */}
                        <td style={{ width: 4, padding: 0, background: priorityStripe(issue.priority) }} />

                        {/* ID */}
                        <td className="px-4 py-4 align-top whitespace-nowrap">
                          <span className={`inline-flex text-[11px] font-black px-2.5 py-1 rounded-lg ${
                            issue.testCaseId.startsWith('AI_')
                              ? 'bg-indigo-50 text-indigo-600 border border-indigo-100'
                              : 'bg-slate-100 text-slate-600'
                          }`}>
                            {issue.testCaseId}
                          </span>
                        </td>

                        {/* Page / Section */}
                        <td className="px-4 py-4 align-top" style={{ maxWidth: 130 }}>
                          <p className="text-[12.5px] font-bold text-slate-800 leading-snug">{issue.pageUrl}</p>
                        </td>

                        {/* Description */}
                        <td className="px-4 py-4 align-top" style={{ maxWidth: 320 }}>
                          <div className="space-y-0.5">
                            {issue.description.split('\n').slice(0, 4).map((line, i) => (
                              <div key={i} className={
                                /^\d+\./.test(line)
                                  ? 'text-[11px] text-slate-400 pl-3'
                                  : 'text-[12.5px] font-semibold text-slate-700'
                              }>{line}</div>
                            ))}
                          </div>
                          {issue.remarks && (
                            <span className="inline-block mt-2 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-lg">
                              {issue.remarks}
                            </span>
                          )}
                          {/* Screenshot link */}
                          {issue.screenshot ? (
                            <button
                              onClick={() => openScreenshot(issue.screenshot!)}
                              className="mt-2 inline-flex items-center gap-1.5 text-[10.5px] font-bold text-indigo-500 hover:text-indigo-700 transition-colors">
                              <Camera style={{ width: 11, height: 11 }} />
                              View Screenshot
                              <ChevronRight style={{ width: 10, height: 10 }} />
                            </button>
                          ) : (
                            <button onClick={() => openEdit(issue)}
                              className="mt-2 inline-flex items-center gap-1 text-[10px] text-slate-300 hover:text-slate-500 transition-colors">
                              <Image style={{ width: 10, height: 10 }} />
                              Add screenshot
                            </button>
                          )}
                        </td>

                        {/* Device */}
                        <td className="px-4 py-4 align-top">
                          <div className="flex items-center gap-1.5">
                            {issue.deviceType === 'mobile'
                              ? <Smartphone className="text-slate-300" style={{ width: 14, height: 14 }} />
                              : issue.deviceType === 'tablet'
                              ? <Tablet className="text-slate-300" style={{ width: 14, height: 14 }} />
                              : <Monitor className="text-slate-300" style={{ width: 14, height: 14 }} />}
                            <span className="text-[11.5px] font-semibold text-slate-500 capitalize">{issue.deviceType}</span>
                          </div>
                        </td>

                        {/* Status — click to cycle */}
                        <td className="px-4 py-4 align-top">
                          <button
                            onClick={() => handleQuickStatus(issue.testCaseId, issue.status)}
                            title="Click to change status"
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold whitespace-nowrap transition-all ring-2 ring-transparent ${sc.ring} ${sc.bg} ${sc.text}`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${sc.dot}`} />
                            {issue.status.charAt(0).toUpperCase() + issue.status.slice(1)}
                          </button>
                          <p className="text-[9px] text-slate-300 mt-1 font-medium pl-1">click to change</p>
                        </td>

                        {/* Priority / Type */}
                        <td className="px-4 py-4 align-top">
                          <div className="flex flex-col gap-1.5">
                            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider w-fit ${priorityBadge(issue.priority)}`}>
                              {issue.priority}
                            </span>
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{issue.type}</span>
                            {issue.version && <span className="text-[9px] text-slate-300 font-bold">{issue.version}</span>}
                          </div>
                        </td>

                        {/* Assignment */}
                        <td className="px-4 py-4 align-top">
                          <div className="space-y-2.5">
                            <div>
                              <p className="text-[9px] font-black text-slate-300 uppercase tracking-widest mb-1">Logged</p>
                              <div className="flex items-center gap-1.5">
                                <div className="w-6 h-6 bg-slate-100 rounded-full flex items-center justify-center text-[10px] font-black text-slate-500 shrink-0 border border-slate-200">
                                  {(issue.loggedBy || '?').charAt(0).toUpperCase()}
                                </div>
                                <span className="text-[11.5px] font-semibold text-slate-600 truncate" style={{ maxWidth: 78 }}>{issue.loggedBy || '—'}</span>
                              </div>
                            </div>
                            <div>
                              <p className="text-[9px] font-black text-slate-300 uppercase tracking-widest mb-1">Assigned</p>
                              <div className="flex items-center gap-1.5">
                                <div className="w-6 h-6 bg-indigo-100 rounded-full flex items-center justify-center text-[10px] font-black text-indigo-600 shrink-0 border border-indigo-200">
                                  {(issue.assignedTo || '?').charAt(0).toUpperCase()}
                                </div>
                                <span className="text-[11.5px] font-bold text-slate-800 truncate" style={{ maxWidth: 78 }}>{issue.assignedTo || '—'}</span>
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Date */}
                        <td className="px-4 py-4 align-top whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <Clock className="text-slate-300" style={{ width: 12, height: 12 }} />
                            <span className="text-[11.5px] font-semibold text-slate-500">{issue.reportedOn}</span>
                          </div>
                        </td>

                        {/* Actions */}
                        <td className="px-3 py-4 align-top">
                          <div className="flex items-center gap-0.5 opacity-40 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => openEdit(issue)}
                              className="p-2 hover:bg-indigo-50 rounded-lg transition-colors group/b"
                              title="Edit">
                              <Edit2 className="text-slate-400 group-hover/b:text-indigo-600 transition-colors" style={{ width: 14, height: 14 }} />
                            </button>
                            <button onClick={() => handleDelete(issue.testCaseId)}
                              className="p-2 hover:bg-rose-50 rounded-lg transition-colors group/b"
                              title="Delete">
                              <Trash2 className="text-slate-400 group-hover/b:text-rose-600 transition-colors" style={{ width: 14, height: 14 }} />
                            </button>
                          </div>
                        </td>
                      </motion.tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Footer count */}
            <div className="px-6 py-3 border-t border-slate-50 flex items-center justify-between bg-slate-50/50">
              <span className="text-[11px] font-bold text-slate-400">
                Showing {filtered.length} of {manualIssues.length} issues
              </span>
              <span className="text-[11px] font-bold text-slate-400">
                Tip: click a status badge to cycle it instantly
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Modal */}
      {modal && (
        <IssueModal
          mode={modal.mode}
          issue={modal.issue}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
};

export default TestingViewPage;
