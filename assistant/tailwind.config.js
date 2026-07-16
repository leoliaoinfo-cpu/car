/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // 所有主題色走 CSS 變數（:root 淺色 / html.dark 深色），見 index.css
        bg: 'rgb(var(--c-bg) / <alpha-value>)',
        s1: 'rgb(var(--c-s1) / <alpha-value>)',
        s2: 'rgb(var(--c-s2) / <alpha-value>)',
        s3: 'rgb(var(--c-s3) / <alpha-value>)',
        bdr: 'rgb(var(--c-bdr) / <alpha-value>)',
        accent: {
          DEFAULT: 'rgb(var(--c-accent) / <alpha-value>)',
        },
        'on-accent': 'rgb(var(--c-on-accent) / <alpha-value>)',
        danger: {
          DEFAULT: 'rgb(var(--c-danger) / <alpha-value>)',
        },
        ok: {
          DEFAULT: 'rgb(var(--c-ok) / <alpha-value>)',
        },
        ink: {
          DEFAULT: 'rgb(var(--c-ink) / <alpha-value>)',
          2: 'rgb(var(--c-ink2) / <alpha-value>)',
          3: 'rgb(var(--c-ink3) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['"Noto Sans TC"', '"PingFang TC"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 4px rgba(0,0,0,0.15)',
        panel: '0 4px 20px rgba(0,0,0,0.3)',
      },
    },
  },
  plugins: [],
};
