import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, RefreshCw, ArrowRight, Activity, Globe } from 'lucide-react';

interface LogEntry {
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

interface LiveTestingPageProps {
  progress: number;
  logs: LogEntry[];
  currentPhase: string;
  issuesFound: number;
  testedUrl: string;
  isTesting: boolean;
  onViewReport: () => void;
}

const aiComments = [
  'Scanning HTML structure for semantic integrity...',
  'Validating meta tags and SEO fundamentals...',
  'Checking HTTPS and security configuration...',
  'Analyzing navigation links for broken references...',
  'Checking every discovered website link...',
  'Collecting screenshot evidence for bugs...',
  'Cross-referencing content quality signals...',
  'Compiling findings and generating report...',
];

const logColors: Record<string, string> = {
  success: 'text-emerald-400',
  error: 'text-rose-400',
  warning: 'text-amber-400',
  info: 'text-slate-400',
};

const LiveTestingPage: React.FC<LiveTestingPageProps> = ({
  progress, logs, currentPhase, issuesFound, testedUrl, isTesting, onViewReport,
}) => {
  const [commentIdx, setCommentIdx] = useState(0);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  useEffect(() => {
    if (!isTesting) return;
    const id = setInterval(() => setCommentIdx(p => (p + 1) % aiComments.length), 2800);
    return () => clearInterval(id);
  }, [isTesting]);

  const criticalCount = logs.filter(l => l.message.includes('[Critical]')).length;
  const majorCount = logs.filter(l => l.message.includes('[Major]')).length;
  const minorCount = logs.filter(l => l.message.includes('[Minor]')).length;

  const radius = 64;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - progress / 100);

  const phaseSteps = [
    { label: 'HTTPS & Security Headers', done: progress >= 10 },
    { label: 'Branding & UI Consistency', done: progress >= 25 },
    { label: 'Content Quality & Grammar', done: progress >= 40 },
    { label: 'Navigation & Link Integrity', done: progress >= 55 },
    { label: 'Form Behavior & Validation', done: progress >= 70 },
    { label: 'SEO & Performance Vitals', done: progress >= 85 },
    { label: 'Sitemap & Technical Files', done: progress >= 95 },
  ];

  return (
    <div className="h-full overflow-y-auto bg-slate-50 custom-scrollbar">
      {/* Top bar */}
      <div className="bg-white border-b border-slate-100 px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-2 h-2 rounded-full shrink-0 ${isTesting ? 'bg-indigo-500 animate-pulse' : 'bg-emerald-500'}`} />
          <div className="min-w-0">
            <p className="text-[13px] font-[900] text-slate-900">
              {isTesting ? 'Live Testing in Progress' : 'Audit Complete'}
            </p>
            <p className="text-[10px] text-slate-400 font-medium truncate max-w-xs">{testedUrl}</p>
          </div>
        </div>
        {!isTesting && (
          <motion.button
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={onViewReport}
            className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-xl text-[11px] font-[900] uppercase tracking-widest shadow-lg shadow-indigo-200 hover:shadow-xl transition-all active:scale-95"
          >
            View Full Report <ArrowRight className="w-3.5 h-3.5" />
          </motion.button>
        )}
      </div>

      <div className="max-w-4xl mx-auto px-8 py-8">
        <div className="grid grid-cols-5 gap-5">
          {/* Left column */}
          <div className="col-span-2 space-y-4">
            {/* Progress ring card */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 flex flex-col items-center">
              <div className="relative mb-4">
                <svg width={160} height={160} style={{ transform: 'rotate(-90deg)' }}>
                  {/* Track */}
                  <circle
                    cx={80} cy={80} r={radius}
                    fill="none" stroke="#f1f5f9" strokeWidth={10}
                  />
                  {/* Progress */}
                  <circle
                    cx={80} cy={80} r={radius}
                    fill="none" stroke="url(#liveGrad)" strokeWidth={10}
                    strokeDasharray={circumference}
                    strokeLinecap="round"
                    style={{
                      strokeDashoffset: dashOffset,
                      transition: 'stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1)',
                    }}
                  />
                  <defs>
                    <linearGradient id="liveGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#4f46e5" />
                      <stop offset="100%" stopColor="#7c3aed" />
                    </linearGradient>
                  </defs>
                </svg>

                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-3xl font-[900] text-slate-900 leading-none">
                    {isTesting ? logs.length : 'Done'}
                  </span>
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                    {isTesting ? 'log entries' : 'complete'}
                  </span>
                </div>
              </div>

              {/* Phase */}
              <div className="flex items-center gap-2">
                {isTesting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 text-indigo-600 animate-spin" />
                    <span className="text-[11px] font-black text-indigo-700">
                      {currentPhase || 'Initializing...'}
                    </span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="text-[11px] font-black text-emerald-700">Audit Complete</span>
                  </>
                )}
              </div>
            </div>

            {/* Phase checklist */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 space-y-2">
              {phaseSteps.map(step => (
                <div key={step.label} className="flex items-center gap-3">
                  <div className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 transition-all duration-500 ${step.done ? 'bg-emerald-500' : 'bg-slate-100'}`}>
                    {step.done && (
                      <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 12 12">
                        <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                  <span className={`text-[11px] font-bold transition-colors ${step.done ? 'text-slate-700' : 'text-slate-400'}`}>
                    {step.label}
                  </span>
                </div>
              ))}
            </div>

            {/* Issue counters */}
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Critical', count: criticalCount, style: 'bg-rose-50 border-rose-100 text-rose-600' },
                { label: 'Major', count: majorCount, style: 'bg-amber-50 border-amber-100 text-amber-600' },
                { label: 'Minor', count: minorCount, style: 'bg-blue-50 border-blue-100 text-blue-600' },
              ].map(({ label, count, style }) => (
                <div key={label} className={`rounded-xl border p-3 text-center ${style}`}>
                  <motion.div
                    key={count}
                    initial={{ scale: 1.3 }}
                    animate={{ scale: 1 }}
                    className="text-xl font-[900] leading-none mb-0.5"
                  >
                    {count}
                  </motion.div>
                  <div className="text-[9px] font-black text-slate-400 uppercase tracking-wider">{label}</div>
                </div>
              ))}
            </div>

            {/* AI Commentary */}
            <div className="bg-gradient-to-br from-indigo-600 to-violet-700 rounded-2xl p-5 text-white shadow-lg shadow-indigo-200/40">
              <div className="flex items-center gap-2 mb-3">
                <Activity className="w-3.5 h-3.5 text-indigo-300" />
                <span className="text-[9px] font-black uppercase tracking-widest text-indigo-300">
                  AI Commentary
                </span>
              </div>
              <AnimatePresence mode="wait">
                <motion.p
                  key={isTesting ? commentIdx : 'done'}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.3 }}
                  className="text-[12.5px] font-medium text-white/90 leading-relaxed"
                >
                  {isTesting
                    ? aiComments[commentIdx]
                    : 'Audit complete. All checks processed. View the full report for findings and recommendations.'}
                </motion.p>
              </AnimatePresence>
            </div>
          </div>

          {/* Right column — log stream */}
          <div className="col-span-3">
            <div className="bg-slate-900 rounded-2xl overflow-hidden flex flex-col" style={{ minHeight: 520 }}>
              {/* Terminal bar */}
              <div className="px-5 py-3.5 border-b border-slate-800/80 flex items-center gap-3 shrink-0">
                <div className="flex gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-rose-500/80" />
                  <div className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
                </div>
                <span className="text-[9px] font-black text-slate-600 uppercase tracking-widest">
                  Audit Stream
                </span>
                <div className="ml-auto flex items-center gap-2">
                  {isTesting && (
                    <span className="text-[9px] font-bold text-indigo-400 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
                      Live
                    </span>
                  )}
                  {logs.length > 0 && (
                    <span className="text-[9px] font-bold text-slate-600">
                      {logs.length} entries
                    </span>
                  )}
                </div>
              </div>

              {/* Log entries */}
              <div className="flex-1 overflow-y-auto p-5 space-y-1.5 font-mono text-[11px] custom-scrollbar">
                {logs.length === 0 && (
                  <p className="text-slate-600 italic">Initializing audit engine...</p>
                )}
                {logs.map((log, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.2 }}
                    className={`flex gap-3 ${logColors[log.type]}`}
                  >
                    <span className="text-slate-700 shrink-0 select-none">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="leading-relaxed">{log.message}</span>
                  </motion.div>
                ))}
                <div ref={logEndRef} />
              </div>
            </div>

            {/* Preview panel */}
            {testedUrl && (
              <div className="mt-4 bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-3">
                  <Globe className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-[11px] font-bold text-slate-500 truncate flex-1">{testedUrl}</span>
                  <div className="flex gap-1">
                    <div className="w-2 h-2 rounded-full bg-slate-200" />
                    <div className="w-2 h-2 rounded-full bg-slate-200" />
                    <div className="w-2 h-2 rounded-full bg-slate-200" />
                  </div>
                </div>
                <div className="h-36 relative overflow-hidden bg-slate-50 flex items-center justify-center">
                  {isTesting && (
                    <div className="scanner-line" />
                  )}
                  <iframe
                    src={testedUrl}
                    title="Preview"
                    className="absolute inset-0 w-full h-full border-none pointer-events-none"
                    style={{ transform: 'scale(0.5)', transformOrigin: 'top left', width: '200%', height: '200%' }}
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
