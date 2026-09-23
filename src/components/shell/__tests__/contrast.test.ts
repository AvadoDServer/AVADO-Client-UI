// @vitest-environment node
// Contrast for the shell's own surfaces (banners, strip), both themes. Same
// method as src/theme/__tests__/contrast.test.ts, kept separate to avoid
// merge conflicts with the other tasks.
import fs from "node:fs";
import path from "node:path";

const css = fs.readFileSync(path.resolve(__dirname, "../../../theme.css"), "utf8");
type RGB = [number, number, number];

function tokens(selector: string): Record<string, RGB> {
  const start = css.indexOf(selector);
  const block = css.slice(start, css.indexOf("}", start));
  const out: Record<string, RGB> = {};
  for (const m of block.matchAll(/--([a-z-]+):\s*(\d+)\s+(\d+)\s+(\d+)\s*;/g)) out[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])];
  return out;
}
const lum = (c: RGB) =>
  c
    .map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a: RGB, b: RGB) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe.each([
  ["dark", '[data-theme="dark"]'],
  ["light", '[data-theme="light"]'],
])("%s theme: shell surfaces", (_, selector) => {
  const t = tokens(selector);
  it.each([
    // Banner body text and titles on the tinted banner planes.
    ["fg", "danger-subtle", 4.5],
    ["fg", "warning-subtle", 4.5],
    ["fg", "accent-subtle", 4.5],
    ["danger-text", "danger-subtle", 4.5],
    ["warning-text", "warning-subtle", 4.5],
    // The fix button (secondary: fg on surface) sits on those planes; the dot needs 3:1.
    ["danger", "danger-subtle", 3],
    ["warning", "warning-subtle", 3],
    ["accent", "accent-subtle", 3],
    // Status strip on the chrome plane.
    ["warning-text", "chrome", 4.5],
    ["danger-text", "chrome", 4.5],
    ["fg-muted", "chrome", 4.5],
    // The "Start it in Advanced" link in the not-ready hint.
    ["accent", "chrome", 4.5],
    // Sidebar (surface): inactive items and the active pill.
    ["fg-muted", "surface", 4.5],
    ["accent-fg", "accent", 4.5],
  ] as const)("%s on %s ≥ %s", (fg, bg, min) => {
    expect(t[fg]).toBeDefined();
    expect(t[bg]).toBeDefined();
    expect(ratio(t[fg], t[bg])).toBeGreaterThanOrEqual(min);
  });
});
