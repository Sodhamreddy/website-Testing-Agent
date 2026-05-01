/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Primary accents — support /opacity modifier
        'accent-primary':   'rgb(59 130 246 / <alpha-value>)',
        'accent-secondary': 'rgb(139 92 246 / <alpha-value>)',
        'success':          'rgb(16 185 129 / <alpha-value>)',
        'warning':          'rgb(245 158 11 / <alpha-value>)',
        'error':            'rgb(239 68 68 / <alpha-value>)',
        // Text colors (light theme — dark on white)
        'text-primary':   '#0f172a',
        'text-secondary': '#334155',
        'text-muted':     '#64748b',
        // Background colors (light theme)
        'bg-primary':   '#ffffff',
        'bg-secondary': '#f8fafc',
        'bg-tertiary':  '#f1f5f9',
        // Border (light theme — subtle dark)
        'border': 'rgba(0,0,0,0.08)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      animation: {
        glow:  'glow 3s ease-in-out infinite',
        pulse: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        glow: {
          '0%, 100%': { boxShadow: '0 0 5px rgba(59,130,246,0.5)' },
          '50%':      { boxShadow: '0 0 20px rgba(59,130,246,0.5)' },
        },
      },
    },
  },
  plugins: [],
};
