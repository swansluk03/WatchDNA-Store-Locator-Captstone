/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: '#0b0b0e',
          elevated: '#15151a',
          card: '#1a1a20'
        },
        border: {
          DEFAULT: '#242428',
          light: '#35353b'
        },
        gold: {
          DEFAULT: '#d4af37',
          light: '#f4e4a1',
          dark: '#8a7228'
        },
        fg: {
          DEFAULT: '#f5f5f7',
          muted: '#a1a1aa',
          dim: '#71717a'
        }
      },
      fontFamily: {
        serif: ['"Cormorant Garamond"', 'Cormorant', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace']
      }
    }
  },
  plugins: []
};
