import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#00c853",
          dark: "#00a344",
          bg: "#0a0f14",
          card: "#111820",
          border: "#1c2530",
        },
        vip: "#f5c518",
        premium: "#a855f7",
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Inter", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
