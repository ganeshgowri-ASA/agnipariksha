import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
    './hooks/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        panel: {
          DEFAULT: '#0b0f14',
          raised: '#11161d',
          inset: '#070a0e',
        },
        steel: {
          50: '#f2f4f7',
          100: '#e3e7ed',
          200: '#c0c7d1',
          300: '#8b95a3',
          400: '#5e6878',
          500: '#3d4655',
          600: '#2a323f',
          700: '#1d242f',
          800: '#141a23',
          900: '#0b0f14',
        },
        agni: {
          orange: '#ff7a18',
          amber: '#f9a825',
          ember: '#d84315',
        },
        signal: {
          ok: '#22c55e',
          warn: '#f59e0b',
          fault: '#ef4444',
          info: '#38bdf8',
        },
        estop: '#dc2626',
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      boxShadow: {
        'inset-panel': 'inset 0 1px 0 0 rgba(255,255,255,0.04), inset 0 -1px 0 0 rgba(0,0,0,0.6)',
        'led-ok': '0 0 6px rgba(34,197,94,0.85)',
        'led-fault': '0 0 6px rgba(239,68,68,0.85)',
        estop: '0 0 0 1px rgba(255,255,255,0.08), 0 4px 12px rgba(220,38,38,0.45)',
      },
      keyframes: {
        'pulse-led': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.45' },
        },
      },
      animation: {
        'pulse-led': 'pulse-led 1.4s ease-in-out infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
