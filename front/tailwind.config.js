/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'cohere-black': '#000000',
        'near-black': '#212121',
        'deep-dark': '#17171c',
        'interaction-green': '#166534',
        'ring-green': '#14532d',
        'focus-purple': '#9b60aa',
        'pure-white': '#ffffff',
        'snow': '#fafafa',
        'lightest-gray': '#f2f2f2',
        'muted-slate': '#93939f',
        'border-cool': '#d9d9dd',
        'border-light': '#e5e7eb',
        'canvas-bg': 'var(--canvas-bg)',
        'olive-accent': 'var(--olive-accent)',
        'olive-highlight': 'var(--olive-highlight)',
        'olive-dark': 'var(--olive-dark)',
        'olive-light-text': 'var(--olive-light-text)',
      },
      fontFamily: {
        'display': ['Merriweather', 'LXGW WenKai TC', 'serif'],
        'body': ['Inter', 'LXGW WenKai TC', 'Noto Sans SC', 'sans-serif'],
        'mono': ['Source Code Pro', 'monospace'],
      },
      borderRadius: {
        'cohere': '22px',
        'card': '10px',
        'card-sm': '8px',
        'pill': '99px',
      },
      boxShadow: {
        'node': '0 1px 3px 0px hsl(0 0% 0% / 0.06), 0 1px 2px -1px hsl(0 0% 0% / 0.04)',
        'float': '0 4px 16px -2px hsl(0 0% 0% / 0.08), 0 2px 6px -1px hsl(0 0% 0% / 0.04)',
        'panel': '0 8px 32px -4px hsl(0 0% 0% / 0.10), 0 2px 8px -2px hsl(0 0% 0% / 0.04)',
        'overlay': '0 20px 60px -12px hsl(0 0% 0% / 0.12), 0 0 0 1px hsl(0 0% 0% / 0.03)',
        'menu': '0 12px 40px -8px hsl(0 0% 0% / 0.10), 0 0 0 1px hsl(0 0% 0% / 0.03)',
        'btn': '0 2px 8px -1px hsl(0 0% 0% / 0.12)',
        'btn-hover': '0 4px 12px -1px hsl(0 0% 0% / 0.16)',
      },
      spacing: {
        '22': '5.5rem',
      }
    },
  },
  plugins: [],
}
