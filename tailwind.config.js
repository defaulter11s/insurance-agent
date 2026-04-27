/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Fraunces"', "serif"],
        sans: ['"Plus Jakarta Sans"', "system-ui", "sans-serif"],
      },
      animation: {
        breathe: "breathe 3s ease-in-out infinite",
        "listen-pulse": "listen-pulse 1.4s ease-in-out infinite",
        wave: "wave 0.8s ease-in-out infinite",
        "fade-up": "fadeUp 0.4s ease-out",
      },
      keyframes: {
        breathe: {
          "0%, 100%": {
            transform: "scale(1)",
            boxShadow: "0 0 0 0 rgba(184, 153, 103, 0.4)",
          },
          "50%": {
            transform: "scale(1.04)",
            boxShadow: "0 0 0 14px rgba(184, 153, 103, 0)",
          },
        },
        "listen-pulse": {
          "0%, 100%": {
            transform: "scale(1)",
            boxShadow: "0 0 0 0 rgba(15, 46, 71, 0.5)",
          },
          "50%": {
            transform: "scale(1.06)",
            boxShadow: "0 0 0 24px rgba(15, 46, 71, 0)",
          },
        },
        wave: {
          "0%, 100%": { transform: "scaleY(0.3)" },
          "50%": { transform: "scaleY(1)" },
        },
        fadeUp: {
          from: { transform: "translateY(8px)", opacity: "0" },
          to: { transform: "translateY(0)", opacity: "1" },
        },
      },
    },
  },
  plugins: [],
};
