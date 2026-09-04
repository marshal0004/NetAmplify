/** @type {import('tailwindcss').Config} */
// /home/z/my-project/netamplify-app/apps/frontend/tailwind.config.cjs
// NetAmplify — Tailwind config per docs/06-FRONTEND-SPEC.md design system.
//
// Palette:
//   Primary: #4F46E5 (indigo-600), hover #4338CA
//   Primary-soft: #EEF2FF (indigo-50)
//   Success: #16A34A, bg #F0FDF4
//   Error: #DC2626, bg #FEF2F2
//   Warning: #D97706 (Setup-pending Tier B)
//   Text: #111827 / muted #6B7280
//   Surface: #FFFFFF, page #F9FAFB
//   Border: #E5E7EB
// Typography: Inter (UI), JetBrains Mono (tech tags, counters)
// Radius: 8px (cards 12px). Spacing 4px grid. Max-width 1200px.

module.exports = {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
