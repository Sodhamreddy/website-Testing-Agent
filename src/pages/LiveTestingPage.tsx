import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, RefreshCw, ArrowRight, Cpu, Globe, Terminal } from 'lucide-react';

interface LogEntry {
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

interface LiveTestingPageProps {
  progress: number;
  logs: LogEntry[];
  currentPhase: string;
  testedUrl: string;
  isTesting: boolean;
  onViewReport: () => void;
}

const aiComments = [
  'Running branding & header test cases…',
  'Crawling menu pages and verifying titles & home links…',
  'Checking every link for 404s and bad redirects…',
  'Scanning copy for spelling and grammar errors…',
  'Testing form validation, tooltips and error messages…',
  'Measuring buttons, fonts and alignment consistency…',
  'Testing layout at 640×480 → 1920×1080, tablet & mobile…',
  'Compiling the bug report with evidence screenshots…',
];

const phaseSteps = [
  { label: 'Branding & Header',            threshold: 16 },
  { label: 'Page Crawl & Navigation',      threshold: 34 },
  { label: 'Broken Links & Anchors',       threshold: 48 },
  { label: 'Content, Spelling & Fonts',    threshold: 58 },
  { label: 'Forms & Validation',           threshold: 68 },
  { label: 'Buttons, Keyboard & Images',   threshold: 78 },
  { label: 'Resolutions & Responsive',     threshold: 93 },
  { label: 'Performance & SEO',            threshold: 98 },
];

const logStyle: Record<string, string> = {
  success: '#34d399',
  error:   '#f87171',
  warning: '#fbbf24',
  info:    '#94a3b8',
};

const LiveTestingPage: React.FC<LiveTestingPageProps> = ({
  progress, logs, currentPhase, testedUrl, isTesting, onViewReport,
}) => {
  const [commentIdx, setCommentIdx] = useState(0);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  useEffect(() => {
    if (!isTesting) return;
    const id = setInterval(() => setCommentIdx(p => (p + 1) % aiComments.length), 2800);
    return () => clearInterval(id);
  }, [isTesting]);

  const criticalCount = logs.filter(l => l.message.includes('[Critical]')).length;
  const majorCount    = logs.filter(l => l.message.includes('[Major]')).length;
  const minorCount    = logs.filter(l => l.message.includes('[Minor]')).length;

  const radius       = 60;
  const circumference = 2 * Math.PI * radius;
  const dashOffset    = circumference * (1 - progress / 100);

  return (
    <div className="h-full overflow-y-auto custom-scrollbar" style={{ background: '#f6f7f9' }}>

      {/* ── Top bar ── */}
      <div
        style={{
          background: '#ffffff',
          borderBottom: '1px solid #e7e9ee',
          padding: '14px 28px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-2 h-2 rounded-full shrink-0"
            style={{
              background: isTesting ? '#6366f1' : '#22c55e',
              boxShadow: isTesting ? '0 0 8px #6366f1' : '0 0 8px #22c55e',
              animation: isTesting ? 'pulse 1.5s infinite' : 'none',
            }}
          />
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-gray-900">
              {isTesting ? 'Live Audit Running' : 'Audit Complete'}
            </p>
            <p className="text-[11px] text-gray-400 truncate max-w-xs">{testedUrl}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span
            className="text-xs font-semibold px-3 py-1 rounded-full"
            style={{
              background: isTesting ? '#eef2ff' : '#f0fdf4',
              color: isTesting ? '#6366f1' : '#16a34a',
            }}
          >
            {Math.round(progress)}% complete
          </span>
          {!isTesting && (
            <motion.button
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              onClick={onViewReport}
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '9px 18px',
                background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                color: '#fff',
                border: 'none',
                borderRadius: 9,
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(99,102,241,0.35)',
              }}
            >
              View Issues <ArrowRight style={{ width: 13, height: 13 }} />
            </motion.button>
          )}
        </div>
      </div>

      {/* ── Main grid ── */}
      <div className="max-w-5xl mx-auto px-6 py-6">
        <div className="grid grid-cols-5 gap-5">

          {/* ── Left column ── */}
          <div className="col-span-2 space-y-4">

            {/* Progress ring */}
            <div
              className="rounded-2xl p-5 flex flex-col items-center"
              style={{ background: '#ffffff', border: '1px solid #e5e7eb' }}
            >
              <div className="relative mb-4">
                <svg width={148} height={148} style={{ transform: 'rotate(-90deg)' }}>
                  <circle cx={74} cy={74} r={radius} fill="none" stroke="#f1f5f9" strokeWidth={9} />
                  <circle
                    cx={74} cy={74} r={radius}
                    fill="none"
                    stroke="url(#liveGrad)"
                    strokeWidth={9}
                    strokeDasharray={circumference}
                    strokeLinecap="round"
                    style={{
                      strokeDashoffset: dashOffset,
                      transition: 'stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1)',
                    }}
                  />
                  <defs>
                    <linearGradient id="liveGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#6366f1" />
                      <stop offset="100%" stopColor="#8b5cf6" />
                    </linearGradient>
                  </defs>
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-extrabold text-gray-900 leading-none">
                    {isTesting ? Math.round(progress) : '✓'}
                  </span>
                  <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mt-0.5">
                    {isTesting ? 'percent' : 'done'}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                {isTesting
                  ? <RefreshCw style={{ width: 12, height: 12, color: '#6366f1', animation: 'spin 1s linear infinite' }} />
                  : <CheckCircle2 style={{ width: 12, height: 12, color: '#22c55e' }} />}
                <span
                  className="text-[11px] font-semibold"
                  style={{ color: isTesting ? '#6366f1' : '#16a34a' }}
                >
                  {isTesting ? (currentPhase || 'Initializing…') : 'Audit Complete'}
                </span>
              </div>
            </div>

            {/* Phase steps */}
            <div
              className="rounded-2xl p-4 space-y-2.5"
              style={{ background: '#ffffff', border: '1px solid #e5e7eb' }}
            >
              <p className="section-label mb-3">Audit Phases</p>
              {phaseSteps.map(step => {
                const done = progress >= step.threshold;
                return (
                  <div key={step.label} className="flex items-center gap-3">
                    <div
                      className="w-4 h-4 rounded-full flex items-center justify-center shrink-0 transition-all duration-500"
                      style={{ background: done ? '#6366f1' : '#f3f4f6' }}
                    >
                      {done && (
                        <svg width={8} height={8} viewBox="0 0 12 12" fill="none">
                          <path d="M2 6l3 3 5-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>
                    <span
                      className="text-[11px] font-medium transition-colors"
                      style={{ color: done ? '#374151' : '#9ca3af' }}
                    >
                      {step.label}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Issue counters */}
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Critical', count: criticalCount, bg: '#fef2f2', text: '#dc2626', border: '#fecaca' },
                { label: 'Major',    count: majorCount,    bg: '#fffbeb', text: '#d97706', border: '#fde68a' },
                { label: 'Minor',    count: minorCount,    bg: '#eff6ff', text: '#2563eb', border: '#bfdbfe' },
              ].map(({ label, count, bg, text, border }) => (
                <div
                  key={label}
                  className="rounded-xl p-3 text-center"
                  style={{ background: bg, border: `1px solid ${border}` }}
                >
                  <motion.div
                    key={count}
                    initial={{ scale: 1.3 }}
                    animate={{ scale: 1 }}
                    className="text-[22px] font-extrabold leading-none mb-0.5"
                    style={{ color: text }}
                  >
                    {count}
                  </motion.div>
                  <div className="text-[9px] font-bold uppercase tracking-wider text-gray-400">{label}</div>
                </div>
              ))}
            </div>

            {/* AI commentary */}
            <div
              className="rounded-2xl p-4"
              style={{
                background: '#101828',
                border: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              <div className="flex items-center gap-2 mb-2.5">
                <Cpu style={{ width: 12, height: 12, color: '#818cf8' }} />
                <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: '#818cf8' }}>
                  Test Engine
                </span>
              </div>
              <AnimatePresence mode="wait">
                <motion.p
                  key={isTesting ? commentIdx : 'done'}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  transition={{ duration: 0.25 }}
                  className="text-[12px] font-medium leading-relaxed"
                  style={{ color: 'rgba(255,255,255,0.75)' }}
                >
                  {isTesting
                    ? aiComments[commentIdx]
                    : 'Audit complete. All test cases executed. View the full issue report.'}
                </motion.p>
              </AnimatePresence>
            </div>
          </div>

          {/* ── Right column — log terminal ── */}
          <div className="col-span-3 space-y-4">
            <div
              className="rounded-2xl overflow-hidden flex flex-col"
              style={{ background: '#0d1117', border: '1px solid rgba(255,255,255,0.06)', minHeight: 480 }}
            >
              {/* Terminal bar */}
              <div
                className="flex items-center gap-3 px-5 py-3 shrink-0"
                style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
              >
                <div className="flex gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#ff5f57' }} />
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#febc2e' }} />
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#28c840' }} />
                </div>
                <Terminal style={{ width: 12, height: 12, color: 'rgba(255,255,255,0.3)' }} />
                <span
                  className="text-[10px] font-semibold uppercase tracking-widest"
                  style={{ color: 'rgba(255,255,255,0.3)' }}
                >
                  Audit Stream
                </span>
                <div className="ml-auto flex items-center gap-3">
                  {isTesting && (
                    <span
                      className="flex items-center gap-1.5 text-[10px] font-semibold"
                      style={{ color: '#818cf8' }}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ background: '#6366f1', animation: 'pulse 1.5s infinite' }}
                      />
                      Live
                    </span>
                  )}
                  {logs.length > 0 && (
                    <span className="text-[10px] font-medium" style={{ color: 'rgba(255,255,255,0.25)' }}>
                      {logs.length} entries
                    </span>
                  )}
                </div>
              </div>

              {/* Log stream */}
              <div
                className="flex-1 overflow-y-auto p-5 space-y-1 font-terminal text-[11.5px] custom-scrollbar"
                style={{ minHeight: 0 }}
              >
                {logs.length === 0 && (
                  <p style={{ color: 'rgba(255,255,255,0.2)', fontStyle: 'italic' }}>
                    Initializing audit engine…
                  </p>
                )}
                {logs.map((log, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -4 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.18 }}
                    className="flex gap-3"
                  >
                    <span
                      className="shrink-0 select-none"
                      style={{ color: 'rgba(255,255,255,0.18)', minWidth: 24, textAlign: 'right' }}
                    >
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span style={{ color: logStyle[log.type], lineHeight: 1.6 }}>
                      {log.message}
                    </span>
                  </motion.div>
                ))}
                <div ref={logEndRef} />
              </div>
            </div>

            {/* URL preview */}
            {testedUrl && (
              <div
                className="rounded-2xl overflow-hidden"
                style={{ background: '#ffffff', border: '1px solid #e5e7eb' }}
              >
                <div
                  className="flex items-center gap-3 px-4 py-3"
                  style={{ borderBottom: '1px solid #f3f4f6' }}
                >
                  <div className="flex gap-1">
                    <div className="w-2.5 h-2.5 rounded-full bg-gray-200" />
                    <div className="w-2.5 h-2.5 rounded-full bg-gray-200" />
                    <div className="w-2.5 h-2.5 rounded-full bg-gray-200" />
                  </div>
                  <Globe style={{ width: 12, height: 12, color: '#9ca3af' }} />
                  <span className="text-[11px] font-medium text-gray-400 truncate flex-1">{testedUrl}</span>
                </div>
                <div className="h-32 relative overflow-hidden bg-gray-50 flex items-center justify-center">
                  {isTesting && <div className="scanner-line" />}
                  <iframe
                    src={testedUrl}
                    title="Preview"
                    className="absolute inset-0 border-none pointer-events-none"
                    style={{
                      width: '200%', height: '200%',
                      transform: 'scale(0.5)', transformOrigin: 'top left',
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default LiveTestingPage;
