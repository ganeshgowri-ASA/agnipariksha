import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'agni-orange': '#f97316',
        'agni-dark': '#030712',
      },
      fontFamily: {
        mono: ['Courier New', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
