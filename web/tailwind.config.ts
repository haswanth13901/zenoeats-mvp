import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./login/**/*.{html,ts}", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#F5F3EE",
        surface: "#FFFFFF",
        ink: "#1A1A17",
        muted: "#6E6A61",
        hairline: "#E2DED4",
        brick: "#B3341F",
        brickDark: "#8E2818",
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-body)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
