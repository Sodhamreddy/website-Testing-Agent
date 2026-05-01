import React from 'react';
import { ShieldCheck, LayoutDashboard, FileText, Settings, ClipboardList } from 'lucide-react';
import type { Page } from '../types';

interface SidebarProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
  hasReport: boolean;
}

const navItems: { id: Page; icon: React.ElementType; label: string }[] = [
  { id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { id: 'testing_view', icon: ClipboardList, label: 'Issues' },
  { id: 'report', icon: FileText, label: 'Report' },
  { id: 'settings', icon: Settings, label: 'Settings' },
];

const Sidebar: React.FC<SidebarProps> = ({ currentPage, onNavigate, hasReport }) => (
  <aside className="w-56 bg-white border-r border-slate-100/80 flex flex-col shrink-0 shadow-sm">
    {/* Logo */}
    <div className="px-5 pt-7 pb-5">
      <div className="flex items-center gap-3 mb-8">
        <div className="p-2 bg-gradient-to-br from-indigo-600 to-violet-600 rounded-xl shadow-lg shadow-indigo-200/60 shrink-0">
          <ShieldCheck className="w-4 h-4 text-white" />
        </div>
        <div>
          <p className="text-[14px] font-[900] text-slate-900 leading-tight tracking-tight">
            Testing<span className="text-indigo-600">Agent</span>
          </p>
          <p className="text-[8px] font-bold uppercase tracking-[0.18em] text-slate-400">
            AI QA Agent
          </p>
        </div>
      </div>

      <p className="text-[8px] font-black uppercase tracking-widest text-slate-300 px-2 mb-2">
        Menu
      </p>

      <nav className="space-y-0.5">
        {navItems.map(item => {
          const disabled = item.id === 'report' && !hasReport;
          const active = currentPage === item.id;
          return (
            <button
              key={item.id}
              onClick={() => !disabled && onNavigate(item.id)}
              disabled={disabled}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[12.5px] font-bold transition-all duration-200 text-left ${
                active
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200/60'
                  : disabled
                  ? 'text-slate-300 cursor-not-allowed'
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
              }`}
            >
              <item.icon className="w-3.5 h-3.5 shrink-0" />
              {item.label}
              {disabled && (
                <span className="ml-auto text-[8px] font-black text-slate-300 uppercase tracking-wider">
                  Pending
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </div>

    {/* Divider */}
    <div className="mx-5 border-t border-slate-100" />

    {/* Agent Status */}
    <div className="p-5 mt-auto">
      <div className="bg-gradient-to-br from-indigo-50 to-violet-50/70 rounded-2xl p-4 border border-indigo-100/60">
        <div className="flex items-center gap-2 mb-2.5">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shadow shadow-emerald-300" />
          <span className="text-[8px] font-black text-slate-600 uppercase tracking-widest">
            Agent Online
          </span>
        </div>
        <div className="text-lg font-[900] text-slate-900 tracking-tight leading-none mb-1">
          Checklist
        </div>
        <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">
          Full QA Mode
        </div>
      </div>

      <p className="text-[9px] text-slate-400 font-medium text-center mt-3">
        Testing Agent v2.5
      </p>
    </div>
  </aside>
);

export default Sidebar;
