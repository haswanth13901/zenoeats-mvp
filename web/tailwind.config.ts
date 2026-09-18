import type { Config } from "tailwindcss";

/**
 * Every value here reads a CSS variable declared in src/styles/globals.css,
 * which is where the design tokens live (design/…/design-tokens.json). The
 * variables hold bare RGB channels so opacity modifiers such as `bg-brick/5`
 * keep working: Tailwind substitutes `<alpha-value>` for them.
 *
 * Names are kept where the codebase already used them -- `brick` is the brand
 * colour, `hairline` the divider -- so the retheme changes values, not every
 * class in the app. The new semantic roles (danger, warning, success, focus)
 * are additions, because the old palette used brick for both "primary" and
 * "error" and the design separates them.
 */
const channel = (name: string) => `rgb(var(--ze-${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./login/**/*.{html,ts}", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // The design's breakpoints are 640 / 768 / 1024 / 1200. Tailwind's
      // defaults match the first three; xl moves from 1280 to 1200.
      screens: {
        xl: "1200px",
      },
      colors: {
        paper: channel("paper"),
        surface: channel("surface"),
        ink: channel("ink"),
        muted: channel("muted"),
        hairline: channel("line"),
        // The input boundary: deliberately stronger than a decorative divider.
        fieldline: channel("field-line"),
        brick: channel("brand"),
        brickDark: channel("brand-hover"),
        brickSoft: channel("brand-soft"),
        danger: channel("error"),
        dangerSoft: channel("error-soft"),
        warning: channel("warning"),
        warningSoft: channel("warning-soft"),
        success: channel("success"),
        successSoft: channel("success-soft"),
        focus: channel("focus"),
        // Customer surface only (revision 06).
        gold: channel("gold"),
        hero: channel("hero"),
        accent: channel("accent"),
        sage: channel("sage"),
        cream: channel("cream"),
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-body)", "system-ui", "sans-serif"],
      },
      fontSize: {
        eyebrow: ["11px", { lineHeight: "16px", letterSpacing: "0.12em", fontWeight: "650" }],
        caption: ["12px", { lineHeight: "18px" }],
        body: ["15px", { lineHeight: "1.55" }],
      },
      borderRadius: {
        status: "6px",
        chip: "8px",
        field: "9px",
        button: "10px",
        ticket: "14px",
        panel: "16px",
        dialog: "22px",
        // Customer surface: food banner and product card.
        banner: "20px",
        product: "15px",
      },
      boxShadow: {
        card: "var(--ze-elevation-card)",
        raised: "var(--ze-elevation-raised)",
        dialog: "var(--ze-elevation-dialog)",
      },
      zIndex: {
        section: "1",
        card: "2",
        cart: "25",
        nav: "35",
        dialog: "40",
        toast: "80",
      },
      transitionDuration: {
        color: "var(--ze-motion-color)",
        tab: "var(--ze-motion-tab)",
        disclose: "var(--ze-motion-disclose)",
        confirm: "var(--ze-motion-confirm)",
        stage: "var(--ze-motion-stage)",
        cart: "var(--ze-motion-cart)",
        sheet: "var(--ze-motion-sheet)",
        pin: "var(--ze-motion-pin)",
        ticket: "var(--ze-motion-ticket)",
        stock: "var(--ze-motion-stock)",
      },
      transitionTimingFunction: {
        standard: "var(--ze-ease)",
      },
      maxWidth: {
        customer: "1120px",
        // Customer homepage content, inside a 1336px container.
        home: "1256px",
        operator: "1280px",
        auth: "440px",
        payment: "480px",
        dialog: "560px",
      },
      keyframes: {
        rise: { from: { transform: "translateY(16px)", opacity: "0" }, to: { transform: "none", opacity: "1" } },
        "cart-in": { from: { transform: "translateY(8px)", opacity: "0" }, to: { transform: "none", opacity: "1" } },
        arrive: { from: { transform: "translateY(8px)", opacity: "0" }, to: { transform: "none", opacity: "1" } },
        fade: { from: { opacity: "0" }, to: { opacity: "1" } },
        "status-reveal": { from: { transform: "translateY(5px)", opacity: ".5" }, to: { transform: "none", opacity: "1" } },
        "hero-enter": { from: { transform: "translateY(10px)", opacity: "0" }, to: { transform: "none", opacity: "1" } },
        pending: { "50%": { opacity: ".35" } },
      },
      animation: {
        sheet: "rise var(--ze-motion-sheet) var(--ze-ease) both",
        cart: "cart-in var(--ze-motion-cart) var(--ze-ease) both",
        arrive: "arrive 160ms var(--ze-ease) both",
        fade: "fade var(--ze-motion-tab) var(--ze-ease) both",
        disclose: "fade var(--ze-motion-disclose) var(--ze-ease) both",
        confirm: "fade var(--ze-motion-confirm) var(--ze-ease) both",
        reveal: "status-reveal var(--ze-motion-pin) var(--ze-ease) both",
        hero: "hero-enter 520ms var(--ze-ease) both",
        pending: "pending 1.8s ease-in-out infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
