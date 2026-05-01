import React from 'react';
import { motion } from 'framer-motion';
import {
  Camera, Link, FileText, ClipboardList, Image, Smartphone, Zap, Search,
  Minus, Heart, Globe, CheckSquare, Mail, Lock, ArrowUpRight,
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
  { id: 'branding', icon: Camera, label: 'Branding & header', checks: 7, tags: ['auto', 'manual'], key: 'Branding & header' },
  { id: 'navigation', icon: Link, label: 'Navigation & link', checks: 8, tags: ['auto'], key: 'Navigation & link' },
  { id: 'content', icon: FileText, label: 'Content & layout', checks: 8, tags: ['manual'], key: 'Content & layout' },
  { id: 'forms', icon: ClipboardList, label: 'Forms & validation', checks: 10, tags: ['auto', 'manual'], key: 'Forms & validation' },
  { id: 'images', icon: Image, label: 'Images & media', checks: 6, tags: ['auto'], key: 'Images & media' },
  { id: 'responsive', icon: Smartphone, label: 'Responsive / Viewport', checks: 7, tags: ['auto'], key: 'Responsive / Viewport' },
  { id: 'performance', icon: Zap, label: 'Performance & vitals', checks: 6, tags: ['auto'], key: 'Performance & vitals' },
  { id: 'seo', icon: Search, label: 'SEO & meta tags', checks: 9, tags: ['auto', 'seo'], key: 'SEO & meta tags' },
  { id: 'grammar', icon: Minus, label: 'Grammar & spelling', checks: 6, tags: ['auto', 'grammar'], key: 'Grammar & spelling' },
  { id: 'broken_links', icon: Heart, label: 'Broken links & 404s', checks: 6, tags: ['auto'], key: 'Broken links & 404s' },
  { id: 'sitemap', icon: Globe, label: 'Sitemap & robots.txt', checks: 5, tags: ['auto', 'seo'], key: 'Sitemap & robots.txt' },
  { id: 'thank_you', icon: CheckSquare, label: 'Thank you page', checks: 7, tags: ['manual'], key: 'Thank you page' },
  { id: 'email', icon: Mail, label: 'Email notification', checks: 8, tags: ['manual'], key: 'Email notification' },
  { id: 'security', icon: Lock, label: 'Security & HTTPS', checks: 5, tags: ['auto'], key: 'Security & HTTPS' },
];

const tagStyles: Record<string, string> = {
  auto: 'bg-sky-50 text-sky-600 border-sky-100',
  manual: 'bg-slate-100 text-slate-500 border-slate-200',
  seo: 'bg-pink-50 text-pink-500 border-pink-100',
  grammar: 'bg-emerald-50 text-emerald-600 border-emerald-100',
};

const statusStyles: Record<string, string> = {
  pass: 'bg-emerald-50 text-emerald-600 border-emerald-100',
  fail: 'bg-rose-50 text-rose-600 border-rose-100',
  warning: 'bg-amber-50 text-amber-600 border-amber-100',
  info: 'bg-blue-50 text-blue-600 border-blue-100',
  pending: 'bg-slate-100 text-slate-500 border-slate-200',
};

const DashboardPage: React.FC<DashboardPageProps> = ({
  url, setUrl, onStartTest, isTesting, checklistStatus,
}) => {
  const getCategoryStatus = (key: string) => {
    const items = checklistStatus[key];
    if (!items) return 'pending';
    
    const statuses = Object.values(items);
    if (statuses.length === 0) return 'pending';
    if (statuses.every(s => s === 'pending')) return 'pending';
    if (statuses.some(s => s === 'fail')) return 'fail';
    if (statuses.some(s => s === 'warning')) return 'warning';
    if (statuses.every(s => s === 'pass')) return 'pass';
    return 'info';
  };

  return (
    <div className="h-full overflow-y-auto bg-[#F9FAFB] custom-scrollbar p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header Section */}
        <div className="space-y-4">
          <h1 className="text-[28px] font-bold text-slate-900 tracking-tight">Website testing agent</h1>
          <p className="text-slate-500 text-[15px] max-w-3xl leading-relaxed">
            Enter a URL to run automated + AI-powered checks across all test categories — branding, navigation, SEO,
            content quality, broken links, Grammarly-style grammar, sitemap, performance, and more.
          </p>

          <div className="flex gap-4 pt-4">
            <div className="flex-1 max-w-xl">
              <input
                type="text"
                value={url}
                onChange={e => setUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !isTesting && onStartTest()}
                placeholder="https://example.com"
                className="w-full px-5 py-4 bg-white border border-slate-200 rounded-xl text-[15px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-slate-900/5 focus:border-slate-300 transition-all"
              />
            </div>
            <button
              onClick={onStartTest}
              disabled={isTesting || !url.trim()}
              className="px-8 py-4 bg-white border border-slate-200 rounded-xl text-[15px] font-bold text-slate-900 hover:bg-slate-50 transition-all flex items-center gap-2 shadow-sm active:scale-[0.98]"
            >
              {isTesting ? 'Running Audit...' : 'Run full audit'}
              <ArrowUpRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center flex-wrap gap-x-6 gap-y-3 pt-2 pb-2">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            <span className="text-[13px] text-slate-600">pass</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-rose-500" />
            <span className="text-[13px] text-slate-600">fail</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
            <span className="text-[13px] text-slate-600">warning</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
            <span className="text-[13px] text-slate-600">info</span>
          </div>

          <div className="w-px h-4 bg-slate-200 mx-2" />

          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded bg-sky-50 text-sky-600 border border-sky-100 text-[11px] font-bold">auto</span>
            <span className="text-[13px] text-slate-500">automated check</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200 text-[11px] font-bold">manual</span>
            <span className="text-[13px] text-slate-500">requires review</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded bg-pink-50 text-pink-500 border border-pink-100 text-[11px] font-bold">seo</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-600 border border-emerald-100 text-[11px] font-bold">grammar</span>
          </div>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-20">
          {TEST_CATEGORIES.map((cat) => {
            const status = getCategoryStatus(cat.key);
            return (
              <motion.div
                key={cat.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white border border-slate-200 rounded-2xl p-5 flex items-center gap-4 group hover:border-slate-300 hover:shadow-md transition-all duration-300"
              >
                <div className="w-12 h-12 bg-slate-50 rounded-xl flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                  <cat.icon className="w-5 h-5 text-slate-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="text-[15px] font-bold text-slate-900 truncate pr-2">{cat.label}</h3>
                    <span className={`px-2 py-1 rounded-lg text-[11px] font-bold whitespace-nowrap border ${statusStyles[status]}`}>
                      {status}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] text-slate-500">{cat.checks} checks</span>
                    <div className="flex gap-1.5 ml-1">
                      {cat.tags.map(tag => (
                        <span key={tag} className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider border ${tagStyles[tag]}`}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Usage Warning */}
        <div className="bg-[#F3F4F6] border border-slate-200 rounded-2xl p-4 text-[14px] text-slate-600">
          Your org is out of extra usage for the month. We let your admin know.
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;


