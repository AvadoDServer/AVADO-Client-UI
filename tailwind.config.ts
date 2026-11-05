import type { Config } from "tailwindcss";

// Build a Tailwind colour from an RGB-channel CSS variable so opacity
// utilities (bg-accent/50, text-fg/70, ...) keep working. The token must be
// defined as channels, e.g. `--accent: 37 99 235;` (see src/theme.css).
// Same output as the Admin's function helper, via Tailwind's <alpha-value>.
const ch = (name: string) => `rgb(var(${name}) / <alpha-value>)`;

// Copied from the AVADO Admin's tailwind.config.js (same tokens, same look).
// Unlike the Admin there is no Bootstrap here, so preflight stays on.
const config: Config = {
  darkMode: ["selector", '[data-theme="dark"]'],
  // src/apps/* are other apps with their own Tailwind config: leaving them
  // out keeps the client app's CSS exactly as before they existed.
  content: ["./index.html", "./src/**/*.{ts,tsx}", "!./src/apps/**"],
  theme: {
    extend: {
      colors: {
        bg: { DEFAULT: ch("--bg"), subtle: ch("--bg-subtle"), inset: ch("--bg-inset") },
        chrome: { DEFAULT: ch("--chrome") },
        surface: { DEFAULT: ch("--surface"), hover: ch("--surface-hover"), raised: ch("--surface-raised") },
        border: { DEFAULT: ch("--border"), strong: ch("--border-strong") },
        fg: { DEFAULT: ch("--fg"), muted: ch("--fg-muted"), subtle: ch("--fg-subtle"), inverse: ch("--fg-inverse") },
        accent: {
          DEFAULT: ch("--accent"),
          hover: ch("--accent-hover"),
          active: ch("--accent-active"),
          fg: ch("--accent-fg"),
          subtle: ch("--accent-subtle"),
        },
        success: { DEFAULT: ch("--success"), subtle: ch("--success-subtle"), text: ch("--success-text"), solid: ch("--success-solid"), fg: ch("--success-fg") },
        warning: { DEFAULT: ch("--warning"), subtle: ch("--warning-subtle"), text: ch("--warning-text"), solid: ch("--warning-solid"), fg: ch("--warning-fg") },
        danger: { DEFAULT: ch("--danger"), subtle: ch("--danger-subtle"), text: ch("--danger-text"), solid: ch("--danger-solid"), fg: ch("--danger-fg") },
        brand: { DEFAULT: ch("--brand"), subtle: ch("--brand-subtle") },
        verdict: { ok: ch("--verdict-ok"), warn: ch("--verdict-warn"), crit: ch("--verdict-crit") },
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        DEFAULT: "var(--radius-md)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
        "2xl": "var(--radius-2xl)",
        full: "var(--radius-full)",
        tile: "var(--radius-tile)",
        control: "var(--radius-control)",
      },
      boxShadow: {
        xs: "var(--shadow-xs)",
        sm: "var(--shadow-sm)",
        DEFAULT: "var(--shadow-md)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        xl: "var(--shadow-xl)",
        focus: "0 0 0 3px rgb(var(--accent) / 0.35)",
      },
      // Tailwind 3's text sizes, whose line heights are fixed (rem), not a
      // ratio of the font size: text-sm next to text-[0.8125rem] stays 20px.
      fontSize: {
        xs: ["0.75rem", { lineHeight: "1rem" }],
        sm: ["0.875rem", { lineHeight: "1.25rem" }],
        base: ["1rem", { lineHeight: "1.5rem" }],
        lg: ["1.125rem", { lineHeight: "1.75rem" }],
        xl: ["1.25rem", { lineHeight: "1.75rem" }],
        "2xl": ["1.5rem", { lineHeight: "2rem" }],
        "3xl": ["1.875rem", { lineHeight: "2.25rem" }],
        "4xl": ["2.25rem", { lineHeight: "2.5rem" }],
        "5xl": ["3rem", { lineHeight: "1" }],
        "6xl": ["3.75rem", { lineHeight: "1" }],
      },
      spacing: {
        xs: "var(--space-xs)",
        sm: "var(--space-sm)",
        md: "var(--space-md)",
        lg: "var(--space-lg)",
        xl: "var(--space-xl)",
        "2xl": "var(--space-2xl)",
      },
      fontFamily: {
        sans: ['"Public Sans"', "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
        display: ["Sen", '"Public Sans"', "ui-sans-serif", "system-ui", "sans-serif"],
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        rise: { from: { opacity: "0", transform: "translateY(8px)" }, to: { opacity: "1", transform: "translateY(0)" } },
        "spin-slow": { to: { transform: "rotate(360deg)" } },
        "pulse-soft": { "0%, 100%": { opacity: "1" }, "50%": { opacity: "0.45" } },
        shimmer: { "100%": { transform: "translateX(100%)" } },
        "pulse-once": { "0%,100%": { opacity: "1" }, "50%": { opacity: ".35" } },
      },
      animation: {
        "fade-in": "fade-in 0.4s ease both",
        rise: "rise 0.5s cubic-bezier(0.16, 1, 0.3, 1) both",
        "spin-slow": "spin-slow 1s linear infinite",
        "pulse-soft": "pulse-soft 1.8s ease-in-out infinite",
        shimmer: "shimmer 1.6s infinite",
        "pulse-once": "pulse-once 1.2s ease-out 1",
      },
    },
  },
  plugins: [],
};

export default config;
