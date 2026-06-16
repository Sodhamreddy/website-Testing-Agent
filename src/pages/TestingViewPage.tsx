import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ClipboardList, Search, Plus, Download, Edit2, Trash2, X,
  CheckCircle2, Clock, Monitor, Smartphone, Tablet, Camera, ExternalLink, AlertCircle,
  AlertTriangle, Filter, ChevronRight, Image,
} from 'lucide-react';
import type { TestingIssue } from '../types';
import { exportIssueLogToExcel } from '../utils/export';

// ── Constants ────────────────────────────────────────────────────────────────
const TEAM_MEMBERS    = ['Sodham', 'Shilpa', 'AI Agent', 'QA Team', 'Dev Team'];
const STATUS_CYCLE    = ['open', 'in progress', 'verified', 'fixed', 'watching'];
const STATUS_OPTIONS  = STATUS_CYCLE;
const PRIORITY_OPTIONS = ['High', 'Medium', 'Low'] as const;
const TYPE_OPTIONS    = ['UI', 'Functionality', 'Performance', 'Content', 'Accessibility', 'SEO', 'Auto Audit'];
const DEVICE_OPTIONS  = ['website'];

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
  if (key === 'verified' || key === 'fixed') return { bg: '#f0fdf4', text: '#16a34a', dot: '#22c55e', border: '#bbf7d0', ring: 'rgba(34,197,94,0.2)' };
  if (key === 'in progress')                 return { bg: '#eff6ff', text: '#2563eb', dot: '#3b82f6', border: '#bfdbfe', ring: 'rgba(59,130,246,0.2)' };
  if (key === 'watching')                    return { bg: '#f5f3ff', text: '#7c3aed', dot: '#8b5cf6', border: '#ddd6fe', ring: 'rgba(139,92,246,0.2)' };
  return                                            { bg: '#fffbeb', text: '#d97706', dot: '#f59e0b', border: '#fde68a', ring: 'rgba(245,158,11,0.2)' };
}

function priorityStripe(p: string) {
  if (p === 'High')   return '#ef4444';
  if (p === 'Medium') return '#f59e0b';
  return '#3b82f6';
}

function priorityCfg(p: string) {
  if (p === 'High')   return { bg: '#fef2f2', text: '#dc2626', border: '#fecaca' };
  if (p === 'Medium') return { bg: '#fffbeb', text: '#d97706', border: '#fde68a' };
  return                     { bg: '#eff6ff', text: '#2563eb', border: '#bfdbfe' };
}

function domainOf(url: string) {
  try { return new URL(url.startsWith('http') ? url : 'https://' + url).hostname; }
  catch { return url; }
}

/**
 * Split an affected-page string like
 * "https://site.com/services/ @ Mobile (375px)" or "https://site.com › Header"
 * into { host, path, suffix } so long URLs never overflow the table cell.
 */
function pageParts(raw: string) {
  const suffix = raw.includes(' @ ') ? raw.split(' @ ')[1].trim()
    : raw.includes(' › ') ? raw.split(' › ')[1].trim() : '';
  const clean = raw.split(' @ ')[0].split(' › ')[0].trim();
  try {
    const u = new URL(clean.startsWith('http') ? clean : 'https://' + clean);
    const path = u.pathname === '/' || u.pathname === '' ? 'Home page' : decodeURIComponent(u.pathname).replace(/\/$/, '');
    return { host: u.hostname, path, suffix, full: raw };
  } catch {
    return { host: clean, path: '', suffix, full: raw };
  }
}

function openScreenshot(src: string) {
  if (src.startsWith('data:')) {
    const win = window.open('', '_blank');
    if (win) {
      win.document.write(
        `<html><body style="margin:0;background:#111;display:flex;align-items:center;justify-content:center;min-height:100vh">` +
        `<img src="${src}" style="max-width:100%;max-height:100vh;display:block;border-radius:8px"/></body></html>`
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

// ── Screenshot preview ───────────────────────────────────────────────────────
const ScreenshotPreview: React.FC<{ src: string; url?: string; title?: string; compact?: boolean }> = ({
  src, url = '', title = '', compact = false,
}) => {
  const [failed, setFailed] = useState(false);
  const domain = domainOf(url);
  if (!src) return null;
  if (failed) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer"
        className={`flex items-center gap-2.5 rounded-xl p-2.5 transition-colors ${compact ? 'mt-2' : 'mt-3'}`}
        style={{ background: '#f9fafb', border: '1px solid #e5e7eb' }}
      >
        <img src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`} alt="" className="w-5 h-5 rounded shrink-0" />
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-gray-700 truncate">{title || domain}</p>
          <p className="text-[10px] text-gray-400 truncate">{domain}</p>
        </div>
        <ExternalLink className="w-3 h-3 text-gray-400 ml-auto shrink-0" />
      </a>
    );
  }
  return (
    <div
      onClick={() => openScreenshot(src)}
      className={`relative rounded-xl overflow-hidden cursor-pointer group/ss ${compact ? 'mt-2' : 'mt-3'}`}
      style={{ maxHeight: compact ? 72 : 200, border: '1px solid #e5e7eb' }}
    >
      <img src={src} alt="Screenshot" className="w-full object-cover object-top"
        style={{ maxHeight: compact ? 72 : 200 }} onError={() => setFailed(true)} />
      <div className="absolute inset-0 bg-gray-900/0 group-hover/ss:bg-gray-900/25 flex items-center justify-center transition-all">
        <div className="opacity-0 group-hover/ss:opacity-100 transition-opacity bg-white/90 backdrop-blur rounded-lg px-2.5 py-1.5 flex items-center gap-1.5">
          <ExternalLink className="w-3 h-3 text-gray-600" />
          <span className="text-[10px] font-bold text-gray-700">Open full size</span>
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

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  background: '#f9fafb',
  border: '1.5px solid #e5e7eb',
  borderRadius: 9,
  fontSize: 13,
  color: '#111827',
  outline: 'none',
  transition: 'border-color 0.15s, box-shadow 0.15s',
  fontFamily: 'inherit',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 10,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  color: '#9ca3af',
  marginBottom: 6,
};

const IssueModal: React.FC<ModalProps> = ({ mode, issue, onSave, onClose }) => {
  const [form, setForm] = useState<TestingIssue>({ ...issue });
  const set = (k: keyof TestingIssue, v: string) => setForm(p => ({ ...p, [k]: v }));

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}
        onClick={e => e.target === e.currentTarget && onClose()}
      >
        <motion.div
          initial={{ scale: 0.97, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.97, opacity: 0, y: 10 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="bg-white w-full max-w-3xl max-h-[92vh] overflow-y-auto custom-scrollbar"
          style={{ borderRadius: 20, boxShadow: '0 32px 80px rgba(0,0,0,0.2)' }}
        >
          {/* Header */}
          <div
            className="sticky top-0 z-10 flex items-center justify-between px-8 py-5"
            style={{
              background: 'rgba(255,255,255,0.97)',
              borderBottom: '1px solid #f3f4f6',
              backdropFilter: 'blur(8px)',
              borderRadius: '20px 20px 0 0',
            }}
          >
            <div className="flex items-center gap-3">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center"
                style={{ background: mode === 'create' ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' : '#f3f4f6' }}
              >
                {mode === 'create'
                  ? <Plus className="w-4 h-4 text-white" />
                  : <Edit2 style={{ width: 16, height: 16, color: '#6b7280' }} />}
              </div>
              <div>
                <h2 className="text-[16px] font-bold text-gray-900">
                  {mode === 'create' ? 'Log New Issue' : `Edit — ${issue.testCaseId}`}
                </h2>
                <p className="section-label mt-0.5">
                  {mode === 'create' ? 'Create a new QA test case' : 'Update issue details & assignment'}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-xl transition-colors hover:bg-gray-100"
            >
              <X className="w-4 h-4 text-gray-400" />
            </button>
          </div>

          <form
            onSubmit={e => { e.preventDefault(); if (form.pageUrl.trim() && form.description.trim()) onSave(form); }}
            className="p-8 space-y-6"
          >
            {/* Basic Info */}
            <div className="space-y-4">
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <label style={labelStyle}>Case ID</label>
                  <input value={form.testCaseId} readOnly
                    style={{ ...inputStyle, background: '#f3f4f6', color: '#9ca3af', cursor: 'not-allowed' }} />
                </div>
                <div className="col-span-2">
                  <label style={labelStyle}>Page / Section *</label>
                  <input value={form.pageUrl} onChange={e => set('pageUrl', e.target.value)}
                    placeholder="e.g. Home Page / Contact Us" required style={inputStyle}
                    onFocus={e => { e.target.style.borderColor = '#6366f1'; e.target.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.1)'; }}
                    onBlur={e => { e.target.style.borderColor = '#e5e7eb'; e.target.style.boxShadow = 'none'; }} />
                </div>
                <div>
                  <label style={labelStyle}>Scope</label>
                  <select value={form.deviceType} onChange={e => set('deviceType', e.target.value)}
                    style={{ ...inputStyle, cursor: 'pointer' }}>
                    {DEVICE_OPTIONS.map(d => <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label style={labelStyle}>Issue Description *</label>
                <textarea value={form.description} onChange={e => set('description', e.target.value)}
                  placeholder={"Brief summary of the issue.\n1. Step one\n2. Step two\n3. Expected vs actual result"}
                  required rows={5}
                  style={{ ...inputStyle, resize: 'vertical' }}
                  onFocus={e => { e.target.style.borderColor = '#6366f1'; e.target.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.1)'; }}
                  onBlur={e => { e.target.style.borderColor = '#e5e7eb'; e.target.style.boxShadow = 'none'; }} />
              </div>
            </div>

            {/* Classification */}
            <div style={{ paddingTop: 4, borderTop: '1px solid #f3f4f6' }}>
              <p className="section-label mb-3">Classification</p>
              <div className="grid grid-cols-4 gap-3">
                {[
                  { lbl: 'Priority', field: 'priority', opts: PRIORITY_OPTIONS },
                  { lbl: 'Type',     field: 'type',     opts: TYPE_OPTIONS },
                  { lbl: 'Status',   field: 'status',   opts: STATUS_OPTIONS },
                ].map(({ lbl, field, opts }) => (
                  <div key={field}>
                    <label style={labelStyle}>{lbl}</label>
                    <select
                      value={form[field as keyof TestingIssue] as string}
                      onChange={e => set(field as keyof TestingIssue, e.target.value)}
                      style={{ ...inputStyle, cursor: 'pointer' }}
                    >
                      {(opts as readonly string[]).map(o => (
                        <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>
                      ))}
                    </select>
                  </div>
                ))}
                <div>
                  <label style={labelStyle}>Version</label>
                  <input value={form.version || ''} onChange={e => set('version', e.target.value)}
                    placeholder="v1.0" style={inputStyle}
                    onFocus={e => { e.target.style.borderColor = '#6366f1'; e.target.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.1)'; }}
                    onBlur={e => { e.target.style.borderColor = '#e5e7eb'; e.target.style.boxShadow = 'none'; }} />
                </div>
              </div>
            </div>

            {/* Assignment */}
            <div style={{ paddingTop: 4, borderTop: '1px solid #f3f4f6' }}>
              <p className="section-label mb-3">Assignment</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label style={labelStyle}>Logged By</label>
                  <input value={form.loggedBy} onChange={e => set('loggedBy', e.target.value)}
                    placeholder="Name" style={inputStyle}
                    onFocus={e => { e.target.style.borderColor = '#6366f1'; e.target.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.1)'; }}
                    onBlur={e => { e.target.style.borderColor = '#e5e7eb'; e.target.style.boxShadow = 'none'; }} />
                </div>
                <div>
                  <label style={labelStyle}>Assigned To</label>
                  <select value={form.assignedTo} onChange={e => set('assignedTo', e.target.value)}
                    style={{ ...inputStyle, cursor: 'pointer' }}>
                    <option value="">— Select member —</option>
                    {TEAM_MEMBERS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Reported On</label>
                  <input value={form.reportedOn} onChange={e => set('reportedOn', e.target.value)}
                    placeholder="MM/DD/YYYY" style={inputStyle}
                    onFocus={e => { e.target.style.borderColor = '#6366f1'; e.target.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.1)'; }}
                    onBlur={e => { e.target.style.borderColor = '#e5e7eb'; e.target.style.boxShadow = 'none'; }} />
                </div>
              </div>
            </div>

            {/* Notes & Evidence */}
            <div style={{ paddingTop: 4, borderTop: '1px solid #f3f4f6' }}>
              <p className="section-label mb-3">Notes & Evidence</p>
              <div className="space-y-3">
                <div>
                  <label style={labelStyle}>Remarks</label>
                  <textarea value={form.remarks} onChange={e => set('remarks', e.target.value)}
                    placeholder="Additional notes, context, or observations…" rows={2}
                    style={{ ...inputStyle, resize: 'vertical' }}
                    onFocus={e => { e.target.style.borderColor = '#6366f1'; e.target.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.1)'; }}
                    onBlur={e => { e.target.style.borderColor = '#e5e7eb'; e.target.style.boxShadow = 'none'; }} />
                </div>
                <div>
                  <label style={labelStyle}>Screenshot URL</label>
                  <input value={form.screenshot || ''} onChange={e => set('screenshot', e.target.value)}
                    placeholder="Paste image URL (or auto-filled from scan)" style={inputStyle}
                    onFocus={e => { e.target.style.borderColor = '#6366f1'; e.target.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.1)'; }}
                    onBlur={e => { e.target.style.borderColor = '#e5e7eb'; e.target.style.boxShadow = 'none'; }} />
                  {form.screenshot && (
                    <ScreenshotPreview src={form.screenshot} url={form.pageUrl} title={form.description.split('\n')[0]} />
                  )}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 pt-4" style={{ borderTop: '1px solid #f3f4f6' }}>
              <button type="button" onClick={onClose}
                style={{
                  padding: '10px 20px', background: '#f9fafb', border: '1.5px solid #e5e7eb',
                  borderRadius: 9, fontSize: 13, fontWeight: 600, color: '#374151', cursor: 'pointer',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = '#f3f4f6')}
                onMouseLeave={e => (e.currentTarget.style.background = '#f9fafb')}
              >
                Cancel
              </button>
              <button type="submit"
                style={{
                  display: 'flex', alignItems: 'center', gap: 7,
                  padding: '10px 22px',
                  background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                  color: '#fff', border: 'none', borderRadius: 9,
                  fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  boxShadow: '0 4px 14px rgba(99,102,241,0.35)',
                  transition: 'opacity 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.opacity = '0.9')}
                onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
              >
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
  const [search,        setSearch]   = useState('');
  const [statusFilter,  setStatusF]  = useState('all');
  const [priorityFilter,setPriorityF]= useState('all');
  const [modal, setModal]            = useState<{ mode: 'create' | 'edit'; issue: TestingIssue } | null>(null);

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
    onManualIssuesChange(manualIssues.map(i => i.testCaseId === id ? { ...i, status: nextStatus(current) } : i));
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
    { label: 'Total Issues',     value: stats.total,      bg: '#ffffff',  border: '#e5e7eb', numColor: '#111827', Icon: ClipboardList, iconBg: '#f9fafb',  iconColor: '#6b7280' },
    { label: 'Open',             value: stats.open,        bg: '#fffbeb',  border: '#fde68a', numColor: '#d97706', Icon: AlertCircle,   iconBg: '#fef3c7',  iconColor: '#d97706' },
    { label: 'In Progress',      value: stats.inProgress,  bg: '#eff6ff',  border: '#bfdbfe', numColor: '#2563eb', Icon: Clock,         iconBg: '#dbeafe',  iconColor: '#3b82f6' },
    { label: 'Verified / Fixed', value: stats.verified,    bg: '#f0fdf4',  border: '#bbf7d0', numColor: '#16a34a', Icon: CheckCircle2,  iconBg: '#dcfce7',  iconColor: '#22c55e' },
    { label: 'High Priority',    value: stats.high,        bg: '#fef2f2',  border: '#fecaca', numColor: '#dc2626', Icon: AlertTriangle, iconBg: '#fee2e2',  iconColor: '#ef4444' },
  ];

  return (
    <div className="h-full overflow-hidden flex flex-col" style={{ background: '#f4f5f7' }}>

      {/* ── Header ── */}
      <div style={{ background: '#ffffff', borderBottom: '1px solid #e5e7eb', padding: '20px 28px 16px', flexShrink: 0 }}>
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="flex items-center gap-3 mb-0.5">
              <div
                className="w-8 h-8 rounded-xl flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', boxShadow: '0 2px 8px rgba(99,102,241,0.3)' }}
              >
                <ClipboardList style={{ width: 16, height: 16, color: '#fff' }} />
              </div>
              <h1 className="text-[20px] font-bold text-gray-900 tracking-tight">Issue Tracker</h1>
            </div>
            <p className="section-label ml-11">QA Test Cases · Create · Edit · Assign</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => { if (window.confirm('Clear all issues?')) onManualIssuesChange([]); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 14px', background: '#fff', border: '1.5px solid #fecaca',
                borderRadius: 9, fontSize: 12, fontWeight: 600, color: '#dc2626', cursor: 'pointer',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#fef2f2')}
              onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
            >
              <Trash2 style={{ width: 13, height: 13 }} /> Clear All
            </button>
            <button
              onClick={handleExport}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 14px', background: '#fff', border: '1.5px solid #e5e7eb',
                borderRadius: 9, fontSize: 12, fontWeight: 600, color: '#374151', cursor: 'pointer',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#f9fafb')}
              onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
            >
              <Download style={{ width: 13, height: 13 }} /> Export CSV
            </button>
            <button
              onClick={() => exportIssueLogToExcel(manualIssues)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 14px', background: '#fff', border: '1.5px solid #a7f3d0',
                borderRadius: 9, fontSize: 12, fontWeight: 600, color: '#047857', cursor: 'pointer',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#ecfdf5')}
              onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
            >
              <Download style={{ width: 13, height: 13 }} /> Export Excel
            </button>
            <button
              onClick={openCreate}
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '8px 18px',
                background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                color: '#fff', border: 'none', borderRadius: 9,
                fontSize: 12, fontWeight: 700, cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(99,102,241,0.3)',
              }}
            >
              <Plus style={{ width: 15, height: 15 }} /> Create Issue
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-5 gap-3 mb-4">
          {statCards.map(s => (
            <div
              key={s.label}
              className="rounded-xl p-4 flex items-center justify-between"
              style={{ background: s.bg, border: `1px solid ${s.border}` }}
            >
              <div>
                <div className="stat-number" style={{ color: s.numColor }}>{s.value}</div>
                <div className="section-label mt-1">{s.label}</div>
              </div>
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center"
                style={{ background: s.iconBg }}
              >
                <s.Icon style={{ width: 17, height: 17, color: s.iconColor }} />
              </div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"
              style={{ width: 13, height: 13 }}
            />
            <input
              type="text" placeholder="Search ID, page, description, assignee…"
              value={search} onChange={e => setSearch(e.target.value)}
              style={{
                width: '100%', paddingLeft: 36, paddingRight: 14,
                paddingTop: 9, paddingBottom: 9,
                background: '#f9fafb', border: '1.5px solid #e5e7eb',
                borderRadius: 9, fontSize: 12.5, color: '#374151', outline: 'none',
                transition: 'border-color 0.15s, box-shadow 0.15s', fontFamily: 'inherit',
              }}
              onFocus={e => { e.target.style.borderColor = '#6366f1'; e.target.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.1)'; }}
              onBlur={e => { e.target.style.borderColor = '#e5e7eb'; e.target.style.boxShadow = 'none'; }}
            />
          </div>
          <Filter style={{ width: 13, height: 13, color: '#9ca3af' }} />
          {[
            { value: statusFilter,   setter: setStatusF,   options: [['all', 'All Status'], ...STATUS_OPTIONS.map(s => [s, s.charAt(0).toUpperCase() + s.slice(1)])] },
            { value: priorityFilter, setter: setPriorityF, options: [['all', 'All Priority'], ...PRIORITY_OPTIONS.map(p => [p, p])] },
          ].map(({ value, setter, options }, idx) => (
            <select
              key={idx}
              value={value}
              onChange={e => setter(e.target.value)}
              style={{
                padding: '9px 12px', background: '#f9fafb', border: '1.5px solid #e5e7eb',
                borderRadius: 9, fontSize: 12, fontWeight: 600, color: '#374151',
                cursor: 'pointer', outline: 'none', fontFamily: 'inherit',
              }}
            >
              {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          ))}
          <AnimatePresence>
            {filtered.length !== manualIssues.length && (
              <motion.span
                initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.85 }}
                style={{
                  fontSize: 11, fontWeight: 700, color: '#6366f1',
                  background: '#eef2ff', border: '1px solid #c7d2fe',
                  padding: '3px 10px', borderRadius: 20,
                }}
              >
                {filtered.length} / {manualIssues.length}
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── Table area ── */}
      <div className="flex-1 overflow-auto p-5 custom-scrollbar">
        {filtered.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
                style={{ background: '#ffffff', border: '1px solid #e5e7eb', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}
              >
                <ClipboardList style={{ width: 28, height: 28, color: '#d1d5db' }} />
              </div>
              <h3 className="text-[17px] font-bold text-gray-800 mb-1.5">
                {manualIssues.length === 0 ? 'No issues yet' : 'No matches'}
              </h3>
              <p className="text-sm text-gray-400 mb-5">
                {manualIssues.length === 0
                  ? 'Run a scan to auto-detect issues, or create one manually'
                  : 'Try adjusting your search or filters'}
              </p>
              {manualIssues.length === 0 && (
                <button onClick={openCreate}
                  style={{
                    padding: '10px 22px',
                    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                    color: '#fff', border: 'none', borderRadius: 9,
                    fontSize: 13, fontWeight: 700, cursor: 'pointer',
                    boxShadow: '0 4px 12px rgba(99,102,241,0.3)',
                  }}
                >
                  + Create First Issue
                </button>
              )}
            </div>
          </div>
        ) : (
          <div
            className="rounded-2xl overflow-hidden"
            style={{ background: '#ffffff', border: '1px solid #e5e7eb', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}
          >
            <div className="overflow-x-auto">
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1200 }}>
                <thead>
                  <tr style={{ background: '#f9fafb', borderBottom: '2px solid #f3f4f6' }}>
                    <th style={{ width: 4, padding: 0 }} />
                    {['ID', 'Page / Section', 'Issue Description', 'Scope', 'Status', 'Priority / Type', 'Assignment', 'Date', ''].map((h, i) => (
                      <th
                        key={i}
                        style={{
                          padding: '12px 16px',
                          fontSize: 10, fontWeight: 700, color: '#9ca3af',
                          textTransform: 'uppercase', letterSpacing: '0.1em',
                          textAlign: 'left', whiteSpace: 'nowrap',
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((issue, idx) => {
                    const sc   = statusCfg(issue.status);
                    const pc   = priorityCfg(issue.priority);
                    return (
                      <motion.tr
                        key={issue.testCaseId}
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.014 }}
                        style={{ borderBottom: '1px solid #f3f4f6' }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#fafafa')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        className="group transition-colors"
                      >
                        {/* Priority stripe */}
                        <td style={{ width: 4, padding: 0, background: priorityStripe(issue.priority) }} />

                        {/* ID */}
                        <td style={{ padding: '14px 16px', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                          <span
                            style={{
                              display: 'inline-flex',
                              fontSize: 11, fontWeight: 700,
                              padding: '3px 9px', borderRadius: 6,
                              background: issue.testCaseId.startsWith('AI_')
                                ? '#eef2ff'
                                : issue.testCaseId.startsWith('V_')
                                ? '#f0fdf4'
                                : '#f9fafb',
                              color: issue.testCaseId.startsWith('AI_')
                                ? '#6366f1'
                                : issue.testCaseId.startsWith('V_')
                                ? '#16a34a'
                                : '#6b7280',
                              border: `1px solid ${
                                issue.testCaseId.startsWith('AI_') ? '#c7d2fe'
                                  : issue.testCaseId.startsWith('V_') ? '#bbf7d0'
                                  : '#e5e7eb'
                              }`,
                            }}
                          >
                            {issue.testCaseId}
                          </span>
                        </td>

                        {/* Page */}
                        <td style={{ padding: '14px 16px', verticalAlign: 'top', width: 170, maxWidth: 170, overflow: 'hidden' }}>
                          {(() => {
                            const p = pageParts(issue.pageUrl);
                            return (
                              <div title={p.full}>
                                <p style={{
                                  fontSize: 12.5, fontWeight: 600, color: '#1f2937', lineHeight: 1.4,
                                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                }}>
                                  {p.path || p.host}
                                </p>
                                {p.path && (
                                  <p style={{
                                    fontSize: 10.5, color: '#9ca3af', lineHeight: 1.4, marginTop: 2,
                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                  }}>
                                    {p.host}
                                  </p>
                                )}
                                {p.suffix && (
                                  <span style={{
                                    display: 'inline-block', marginTop: 4,
                                    fontSize: 9.5, fontWeight: 700,
                                    color: '#4f46e5', background: '#eef2ff',
                                    border: '1px solid #c7d2fe',
                                    padding: '1px 7px', borderRadius: 5,
                                    whiteSpace: 'nowrap',
                                  }}>
                                    {p.suffix}
                                  </span>
                                )}
                              </div>
                            );
                          })()}
                        </td>

                        {/* Description */}
                        <td style={{ padding: '14px 16px', verticalAlign: 'top', maxWidth: 300, overflowWrap: 'anywhere' }}>
                          <div style={{ marginBottom: 2 }}>
                            {issue.description.split('\n').filter(l => l.trim()).slice(0, 8).map((line, i) => {
                              const isDetail = /^(\d+\.|• )/.test(line);
                              const isHeader = /^(Exact locations|Steps to fix|Findings):/.test(line);
                              return (
                                <div
                                  key={i}
                                  style={{
                                    fontSize: isHeader ? 10 : isDetail ? 11 : 12.5,
                                    color: isHeader ? '#6366f1' : isDetail ? '#6b7280' : '#374151',
                                    fontWeight: isHeader ? 700 : isDetail ? 400 : 500,
                                    textTransform: isHeader ? 'uppercase' : 'none',
                                    letterSpacing: isHeader ? '0.06em' : 'normal',
                                    paddingLeft: isDetail ? 10 : 0,
                                    marginTop: isHeader ? 6 : 0,
                                    lineHeight: 1.5,
                                    overflowWrap: 'anywhere',
                                  }}
                                >
                                  {line}
                                </div>
                              );
                            })}
                            {issue.description.split('\n').filter(l => l.trim()).length > 8 && (
                              <button
                                onClick={() => openEdit(issue)}
                                style={{
                                  fontSize: 10.5, fontWeight: 600, color: '#6366f1',
                                  background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginTop: 2,
                                }}
                              >
                                Show all details…
                              </button>
                            )}
                          </div>
                          {issue.remarks && (
                            <span
                              style={{
                                display: 'inline-block', marginTop: 6,
                                fontSize: 10, fontWeight: 600,
                                color: '#d97706', background: '#fffbeb',
                                border: '1px solid #fde68a',
                                padding: '2px 8px', borderRadius: 5,
                              }}
                            >
                              {issue.remarks}
                            </span>
                          )}
                          {issue.screenshot ? (
                            <button
                              onClick={() => openScreenshot(issue.screenshot!)}
                              style={{
                                display: 'flex', alignItems: 'center', gap: 5,
                                marginTop: 6, fontSize: 10.5, fontWeight: 600,
                                color: '#6366f1', background: 'none', border: 'none', cursor: 'pointer',
                              }}
                            >
                              <Camera style={{ width: 10, height: 10 }} />
                              View Screenshot
                              <ChevronRight style={{ width: 9, height: 9 }} />
                            </button>
                          ) : (
                            <button
                              onClick={() => openEdit(issue)}
                              style={{
                                display: 'flex', alignItems: 'center', gap: 4,
                                marginTop: 6, fontSize: 10, color: '#d1d5db',
                                background: 'none', border: 'none', cursor: 'pointer',
                                transition: 'color 0.15s',
                              }}
                              onMouseEnter={e => (e.currentTarget.style.color = '#9ca3af')}
                              onMouseLeave={e => (e.currentTarget.style.color = '#d1d5db')}
                            >
                              <Image style={{ width: 10, height: 10 }} /> Add screenshot
                            </button>
                          )}
                        </td>

                        {/* Scope */}
                        <td style={{ padding: '14px 16px', verticalAlign: 'top' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {issue.deviceType === 'mobile'
                              ? <Smartphone style={{ width: 13, height: 13, color: '#d1d5db' }} />
                              : issue.deviceType === 'tablet'
                              ? <Tablet style={{ width: 13, height: 13, color: '#d1d5db' }} />
                              : <Monitor style={{ width: 13, height: 13, color: '#d1d5db' }} />}
                            <span style={{ fontSize: 11.5, fontWeight: 500, color: '#6b7280', textTransform: 'capitalize' }}>
                              {issue.deviceType}
                            </span>
                          </div>
                        </td>

                        {/* Status */}
                        <td style={{ padding: '14px 16px', verticalAlign: 'top' }}>
                          <button
                            onClick={() => handleQuickStatus(issue.testCaseId, issue.status)}
                            title="Click to change status"
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: 6,
                              padding: '5px 10px', borderRadius: 20,
                              fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
                              background: sc.bg, color: sc.text,
                              border: `1px solid ${sc.border}`,
                              cursor: 'pointer', transition: 'box-shadow 0.15s',
                            }}
                            onMouseEnter={e => (e.currentTarget.style.boxShadow = `0 0 0 3px ${sc.ring}`)}
                            onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}
                          >
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: sc.dot, flexShrink: 0 }} />
                            {issue.status.charAt(0).toUpperCase() + issue.status.slice(1)}
                          </button>
                          <p style={{ fontSize: 9, color: '#d1d5db', marginTop: 3, paddingLeft: 2, fontWeight: 500 }}>
                            click to advance
                          </p>
                        </td>

                        {/* Priority / Type */}
                        <td style={{ padding: '14px 16px', verticalAlign: 'top' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                            <span
                              style={{
                                display: 'inline-flex', alignItems: 'center',
                                padding: '3px 10px', borderRadius: 20,
                                fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                                background: pc.bg, color: pc.text, border: `1px solid ${pc.border}`,
                                width: 'fit-content',
                              }}
                            >
                              {issue.priority}
                            </span>
                            <span style={{ fontSize: 10, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                              {issue.type}
                            </span>
                            {issue.version && (
                              <span style={{ fontSize: 9, fontWeight: 600, color: '#d1d5db' }}>{issue.version}</span>
                            )}
                          </div>
                        </td>

                        {/* Assignment */}
                        <td style={{ padding: '14px 16px', verticalAlign: 'top' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {[
                              { label: 'Logged', name: issue.loggedBy, color: '#f3f4f6', textColor: '#6b7280', border: '#e5e7eb' },
                              { label: 'Assigned', name: issue.assignedTo, color: '#eef2ff', textColor: '#6366f1', border: '#c7d2fe' },
                            ].map(({ label, name, color, textColor, border }) => (
                              <div key={label}>
                                <p style={{ fontSize: 9, fontWeight: 700, color: '#d1d5db', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 3 }}>
                                  {label}
                                </p>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <div
                                    style={{
                                      width: 22, height: 22, borderRadius: '50%',
                                      background: color, border: `1px solid ${border}`,
                                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                                      fontSize: 9, fontWeight: 800, color: textColor, flexShrink: 0,
                                    }}
                                  >
                                    {(name || '?').charAt(0).toUpperCase()}
                                  </div>
                                  <span style={{ fontSize: 11.5, fontWeight: 500, color: '#374151', maxWidth: 72, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {name || '—'}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </td>

                        {/* Date */}
                        <td style={{ padding: '14px 16px', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <Clock style={{ width: 11, height: 11, color: '#d1d5db' }} />
                            <span style={{ fontSize: 11.5, fontWeight: 500, color: '#6b7280' }}>{issue.reportedOn}</span>
                          </div>
                        </td>

                        {/* Actions */}
                        <td style={{ padding: '14px 12px', verticalAlign: 'top' }}>
                          <div
                            style={{ display: 'flex', alignItems: 'center', gap: 2, opacity: 0, transition: 'opacity 0.15s' }}
                            className="group-hover:!opacity-100"
                          >
                            <button
                              onClick={() => openEdit(issue)}
                              title="Edit"
                              style={{ padding: 7, borderRadius: 8, cursor: 'pointer', transition: 'background 0.15s', color: '#9ca3af' }}
                              onMouseEnter={e => { e.currentTarget.style.background = '#eef2ff'; e.currentTarget.style.color = '#6366f1'; }}
                              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#9ca3af'; }}
                            >
                              <Edit2 style={{ width: 13, height: 13 }} />
                            </button>
                            <button
                              onClick={() => handleDelete(issue.testCaseId)}
                              title="Delete"
                              style={{ padding: 7, borderRadius: 8, cursor: 'pointer', transition: 'background 0.15s', color: '#9ca3af' }}
                              onMouseEnter={e => { e.currentTarget.style.background = '#fef2f2'; e.currentTarget.style.color = '#ef4444'; }}
                              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#9ca3af'; }}
                            >
                              <Trash2 style={{ width: 13, height: 13 }} />
                            </button>
                          </div>
                        </td>
                      </motion.tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div
              style={{
                padding: '10px 20px',
                borderTop: '1px solid #f3f4f6',
                background: '#fafafa',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}
            >
              <span style={{ fontSize: 11, fontWeight: 500, color: '#9ca3af' }}>
                Showing {filtered.length} of {manualIssues.length} issues
              </span>
              <span style={{ fontSize: 11, fontWeight: 500, color: '#9ca3af' }}>
                Tip: click a status badge to cycle through states
              </span>
            </div>
          </div>
        )}
      </div>

      {modal && (
        <IssueModal mode={modal.mode} issue={modal.issue} onSave={handleSave} onClose={() => setModal(null)} />
      )}
    </div>
  );
};

export default TestingViewPage;
