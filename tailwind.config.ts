import type { Config } from "tailwindcss";

/**
 * Every colour resolves through a CSS variable defined in src/app/globals.css,
 * never through a fixed hex here.
 *
 * The `gray`, `emerald`, `red`, `amber` and `yellow` scales deliberately
 * OVERRIDE Tailwind's built-in palettes rather than sitting beside them. That
 * is what makes the ~400 existing `text-gray-400`-style classes across 76
 * component files switch with the theme without any of those files being
 * edited — the class name stays, the value behind it moves.
 *
 * Only the shades the app actually uses are defined. An undefined shade (say
 * `text-gray-700`) stops compiling rather than silently rendering a
 * theme-blind colour, which is the failure mode worth having: it surfaces at
 * build time instead of as an unreadable label in one theme.
 *
 * `rgb(var(--x) / <alpha-value>)` is what keeps Tailwind's opacity syntax
 * working — `bg-brand/20`, `bg-gray-500/20` and friends all still compile.
 */
const withAlpha = (variable: string) => `rgb(var(${variable}) / <alpha-value>)`;

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: withAlpha("--brand"),
          dark: withAlpha("--brand-dark"),
          bg: withAlpha("--bg"),
          card: withAlpha("--card"),
          border: withAlpha("--border"),
        },
        /** Text/icons that sit on top of the brand colour — black on dark, white on light. */
        "on-brand": withAlpha("--on-brand"),
        surface: withAlpha("--surface"),

        gray: {
          100: withAlpha("--gray-100"),
          200: withAlpha("--gray-200"),
          300: withAlpha("--gray-300"),
          400: withAlpha("--gray-400"),
          500: withAlpha("--gray-500"),
          600: withAlpha("--gray-600"),
        },
        emerald: {
          300: withAlpha("--emerald-300"),
          500: withAlpha("--emerald-500"),
        },
        red: {
          300: withAlpha("--red-300"),
          400: withAlpha("--red-400"),
          500: withAlpha("--red-500"),
        },
        amber: {
          200: withAlpha("--amber-200"),
          300: withAlpha("--amber-300"),
          400: withAlpha("--amber-400"),
        },
        yellow: {
          300: withAlpha("--yellow-300"),
          400: withAlpha("--yellow-400"),
          500: withAlpha("--yellow-500"),
        },

        vip: withAlpha("--vip"),
        premium: withAlpha("--premium"),
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Inter", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
