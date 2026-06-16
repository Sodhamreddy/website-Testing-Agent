import React from 'react';
import { ShieldCheck, LayoutDashboard, FileText, Settings, ClipboardList } from 'lucide-react';
import type { Page } from '../types';

interface SidebarProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
  hasReport: boolean;
}

const navItems: { id: Page; icon: React.ElementType; label: string }[] = [
  { id: 'dashboard',    icon: LayoutDashboard, label: 'Dashboard' },
  { id: 'testing_view', icon: ClipboardList,   label: 'Issue Tracker' },
  { id: 'report',       icon: FileText,        label: 'Audit Report' },
  { id: 'settings',     icon: Settings,        label: 'Settings' },
];

const Sidebar: React.FC<SidebarProps> = ({ currentPage, onNavigate, hasReport }) => (
  <aside
    className="flex flex-col shrink-0"
    style={{
      width: 230,
      background: '#101828',
      borderRight: '1px solid rgba(255,255,255,0.07)',
    }}
  >
    {/* Brand */}
    <div className="px-5 pt-6 pb-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
      <div className="flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: '#4f46e5' }}
        >
          <ShieldCheck className="w-[18px] h-[18px] text-white" />
        </div>
        <div>
          <p className="text-[14px] font-bold text-white leading-tight tracking-tight">
            TestingAgent
          </p>
          <p className="text-[10px] font-medium" style={{ color: 'rgba(255,255,255,0.4)', letterSpacing: '0.08em' }}>
            WEBSITE QA PLATFORM
          </p>
        </div>
      </div>
    </div>

    {/* Navigation */}
    <div className="px-3 pt-5">
      <p className="text-[10px] font-bold uppercase px-3 mb-2" style={{ color: 'rgba(255,255,255,0.3)', letterSpacing: '0.12em' }}>
        Menu
      </p>
      <nav className="space-y-1">
        {navItems.map(item => {
          const disabled = item.id === 'report' && !hasReport;
          const active = currentPage === item.id;
          return (
            <button
              key={item.id}
              onClick={() => !disabled && onNavigate(item.id)}
              disabled={disabled}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 11,
                padding: '10px 12px',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: active ? 600 : 500,
                textAlign: 'left',
                position: 'relative',
                transition: 'all 0.15s ease',
                background: active ? 'rgba(79,70,229,0.18)' : 'transparent',
                color: active
                  ? '#ffffff'
                  : disabled
                  ? 'rgba(255,255,255,0.22)'
                  : 'rgba(255,255,255,0.6)',
                cursor: disabled ? 'not-allowed' : 'pointer',
              }}
              onMouseEnter={e => {
                if (!active && !disabled) {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                  e.currentTarget.style.color = 'rgba(255,255,255,0.9)';
                }
              }}
              onMouseLeave={e => {
                if (!active && !disabled) {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = 'rgba(255,255,255,0.6)';
                }
              }}
            >
              {/* Active accent bar */}
              {active && (
                <span
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 8,
                    bottom: 8,
                    width: 3,
                    borderRadius: 2,
                    background: '#6366f1',
                  }}
                />
              )}
              <item.icon style={{ width: 15, height: 15, flexShrink: 0 }} />
              <span style={{ flex: 1 }}>{item.label}</span>
              {disabled && (
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: 'rgba(255,255,255,0.25)',
                    background: 'rgba(255,255,255,0.07)',
                    padding: '2px 6px',
                    borderRadius: 4,
                  }}
                >
                  Soon
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </div>

    {/* Status footer */}
    <div className="p-4 mt-auto">
      <div
        className="rounded-lg px-3.5 py-3"
        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
      >
        <div className="flex items-center gap-2">
          <span
            className="w-1.5 h-1.5 rounded-full animate-pulse shrink-0"
            style={{ background: '#34d399', boxShadow: '0 0 6px #34d399' }}
          />
          <span className="text-[11px] font-semibold text-white">Test engine online</span>
        </div>
        <p className="text-[10px] mt-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
          60 automated checks · 10 categories
        </p>
      </div>

      <p className="text-[10px] font-medium text-center mt-4" style={{ color: 'rgba(255,255,255,0.25)' }}>
        TestingAgent v3.0
      </p>
      <p className="text-[10px] italic text-center mt-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>
        Engineered by Kleza Solutions
      </p>
    </div>
  </aside>
);

export default Sidebar;
