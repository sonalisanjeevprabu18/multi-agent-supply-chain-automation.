import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        forest: {
          50: "#F3F7F4",
          100: "#E4EDE7",
          200: "#CBDDD2",
          300: "#A6C7A9",
          400: "#7EAE8E",
          500: "#4C8763",
          600: "#315C49",
          700: "#26503F",
          800: "#1E4437",
          900: "#183D32",
        },
        ivory: "#F5F3EC",
        ink: "#242B28",
        stone: "#858D87",
        line: "#E6E8E1",
        warn: "#D89A39",
        danger: "#C65B55",
        ok: "#4C8763",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "Segoe UI", "sans-serif"],
        display: ["Manrope", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(24, 61, 50, 0.04), 0 14px 32px -28px rgba(24, 61, 50, 0.45)",
        lift: "0 2px 4px rgba(24, 61, 50, 0.05), 0 24px 48px -32px rgba(24, 61, 50, 0.35)",
      },
      borderRadius: {
        xl2: "1.125rem",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-480px 0" },
          "100%": { backgroundPosition: "480px 0" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.35s cubic-bezier(0.22, 1, 0.36, 1) both",
        "fade-in": "fade-in 0.25s ease-out both",
      },
    },
  },
  plugins: [],
};

export default config;
