import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx,js,jsx,mdx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        'surface-2': 'var(--surface-2)',
        'surface-3': 'var(--surface-3)',
        'bg-hover': 'var(--bg-hover)',
        border: 'var(--border)',
        'border-subtle': 'var(--border-subtle)',
        'border-strong': 'var(--border-strong)',
        text: 'var(--text)',
        'text-secondary': 'var(--text-secondary)',
        muted: 'var(--muted)',
        'text-disabled': 'var(--text-disabled)',
        accent: 'var(--accent)',
        'accent-hover': 'var(--accent-hover)',
        'accent-dim': 'var(--accent-dim)',
        'accent-subtle': 'var(--accent-subtle)',
        'accent-text': 'var(--accent-text)',
        cta: 'var(--cta)',
        'cta-hover': 'var(--cta-hover)',
        'cta-dim': 'var(--cta-dim)',
        success: 'var(--success)',
        'success-dim': 'var(--success-dim)',
        warning: 'var(--warning)',
        'warning-dim': 'var(--warning-dim)',
        danger: 'var(--danger)',
        'danger-dim': 'var(--danger-dim)',
        info: 'var(--info)',
        'info-dim': 'var(--info-dim)',
        violet: 'var(--violet)',
        'violet-dim': 'var(--violet-dim)',
      },
      fontFamily: {
        sans: 'var(--font-sans)',
        mono: 'var(--font-mono)',
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius-md)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
      },
      fontSize: {
        '10': ['10px', '14px'],
        '10.5': ['10.5px', '14px'],
        '11': ['11px', '15px'],
        '12': ['12px', '16px'],
        '12.5': ['12.5px', '17px'],
        '13': ['13px', '19.5px'],
        '14': ['14px', '20px'],
        '15': ['15px', '22px'],
      },
    },
  },
  plugins: [],
};

export default config;
