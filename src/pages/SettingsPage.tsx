import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Mail, RefreshCw, Settings } from 'lucide-react';
import type { AppSettings } from '../types';

interface SettingsPageProps {
  settings: AppSettings;
  onSettingsChange: (s: AppSettings) => void;
}

const browsers: { id: AppSettings['browser']; label: string; desc: string; emoji: string }[] = [
  { id: 'chrome', label: 'Chrome', desc: 'Google Chrome', emoji: '🟢' },
  { id: 'firefox', label: 'Firefox', desc: 'Mozilla Firefox', emoji: '🟠' },
  { id: 'edge', label: 'Edge', desc: 'Microsoft Edge', emoji: '🔵' },
  { id: 'safari', label: 'Safari', desc: 'Apple Safari', emoji: '⚪' },
];

const SettingsPage: React.FC<SettingsPageProps> = ({ settings, onSettingsChange }) => {
  const [local, setLocal] = useState<AppSettings>(settings);
  const [saved, setSaved] = useState(false);

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    setLocal(prev => ({ ...prev, [key]: value }));

  const handleSave = () => {
    onSettingsChange(local);
    setSaved(true);
    setTimeout(() => setSaved(false), 2200);
  };

  const card = 'bg-white rounded-2xl border border-slate-100 shadow-sm p-6';

  return (
    <div className="h-full overflow-y-auto bg-slate-50 custom-scrollbar">
      {/* Header */}
      <div className="bg-white border-b border-slate-100 px-8 py-5 flex items-center gap-3">
        <div className="p-2 bg-slate-100 rounded-xl">
          <Settings className="w-4 h-4 text-slate-600" />
        </div>
        <div>
          <h1 className="text-[14px] font-[900] text-slate-900">Settings</h1>
          <p className="text-[11px] text-slate-400 font-medium">Configure your testing preferences</p>
        </div>
      </div>

      <div className="max-w-xl mx-auto px-8 py-8 space-y-5">

        {/* Browser Selection */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          className={card}
        >
          <h2 className="text-[12px] font-[900] text-slate-800 mb-0.5">Browser</h2>
          <p className="text-[10px] text-slate-400 font-medium mb-4">
            Simulated browser environment for testing
          </p>
          <div className="grid grid-cols-2 gap-2">
            {browsers.map(b => {
              const active = local.browser === b.id;
              return (
                <button
                  key={b.id}
                  onClick={() => update('browser', b.id)}
                  className={`p-4 rounded-xl border text-left transition-all ${
                    active
                      ? 'border-indigo-300 bg-indigo-50 shadow-sm'
                      : 'border-slate-100 hover:border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span>{b.emoji}</span>
                    <span
                      className={`text-[12px] font-[900] ${active ? 'text-indigo-700' : 'text-slate-800'}`}
                    >
                      {b.label}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-400 font-medium">{b.desc}</p>
                  {active && (
                    <div className="flex items-center gap-1 mt-2">
                      <div className="w-1.5 h-1.5 bg-indigo-600 rounded-full" />
                      <span className="text-[8px] font-[900] text-indigo-600 uppercase tracking-wider">
                        Selected
                      </span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </motion.div>

        {/* Toggle Options */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className={card}
        >
          <h2 className="text-[12px] font-[900] text-slate-800 mb-4">Options</h2>

          <div className="space-y-5">
            {/* Auto Screenshots */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-indigo-50 rounded-xl flex items-center justify-center shrink-0">
                  <span className="text-base">📸</span>
                </div>
                <div>
                  <p className="text-[12px] font-bold text-slate-800">Auto Screenshots</p>
                  <p className="text-[10px] text-slate-400 font-medium">
                    Capture page screenshots during testing
                  </p>
                </div>
              </div>
              <ToggleSwitch
                checked={local.autoScreenshots}
                onChange={v => update('autoScreenshots', v)}
              />
            </div>

            <div className="border-t border-slate-100" />

            {/* Email Report */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-violet-50 rounded-xl flex items-center justify-center shrink-0">
                  <Mail className="w-4 h-4 text-violet-500" />
                </div>
                <div>
                  <p className="text-[12px] font-bold text-slate-800">Email Report</p>
                  <p className="text-[10px] text-slate-400 font-medium">
                    Send audit results to your email
                  </p>
                </div>
              </div>
              <ToggleSwitch
                checked={local.emailReport}
                onChange={v => update('emailReport', v)}
              />
            </div>

            {local.emailReport && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <input
                    type="email"
                    value={local.email}
                    onChange={e => update('email', e.target.value)}
                    placeholder="your@email.com"
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[12px] font-semibold text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 transition-all"
                  />
                </div>
              </motion.div>
            )}
          </div>
        </motion.div>

        {/* Save */}
        <motion.button
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.14 }}
          onClick={handleSave}
          className={`w-full py-3.5 rounded-xl text-[11px] font-[900] uppercase tracking-widest flex items-center justify-center gap-2 transition-all active:scale-95 shadow-lg ${
            saved
              ? 'bg-emerald-600 text-white shadow-emerald-200'
              : 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-indigo-200 hover:shadow-xl'
          }`}
        >
          {saved ? (
            <>
              <RefreshCw className="w-3.5 h-3.5" />
              Settings Saved!
            </>
          ) : (
            'Save Settings'
          )}
        </motion.button>

        {/* Version info */}
        <p className="text-center text-[10px] text-slate-400 font-medium">
          WebAuditPro v2.5 &middot; Checklist QA &middot; HTML Analysis
        </p>
      </div>
    </div>
  );
};

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (v: boolean) => void;
}

const ToggleSwitch: React.FC<ToggleSwitchProps> = ({ checked, onChange }) => (
  <button
    onClick={() => onChange(!checked)}
    className={`w-11 h-6 rounded-full transition-all duration-300 relative shrink-0 focus:outline-none ${
      checked ? 'bg-indigo-600' : 'bg-slate-200'
    }`}
  >
    <div
      className={`w-4 h-4 bg-white rounded-full shadow-sm absolute top-1 transition-all duration-300 ${
        checked ? 'left-6' : 'left-1'
      }`}
    />
  </button>
);

export default SettingsPage;
