// @vitest-environment node
// Reads theme.css off disk and checks WCAG contrast for the token pairs the
// components use, in both themes (ported from the Admin's contrast test).
import fs from "node:fs";
import path from "node:path";

const css = fs.readFileSync(path.resolve(__dirname, "../../theme.css"), "utf8");

type RGB = [number, number, number];

function tokens(selector: string): Record<string, RGB> {
  const start = css.indexOf(selector);
  if (start < 0) throw Error(`selector ${selector} not found`);
  const block = css.slice(start, css.indexOf("}", start));
  const out: Record<string, RGB> = {};
  for (const m of block.matchAll(/--([a-z-]+):\s*(\d+)\s+(\d+)\s+(\d+)\s*;/g))
    out[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])];
  return out;
}

function luminance([r, g, b]: RGB): number {
  const c = [r, g, b].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const ratio = (a: RGB, b: RGB) => {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

const THEMES = { dark: '[data-theme="dark"]', light: '[data-theme="light"]' };

describe.each(Object.entries(THEMES))("%s theme contrast", (_, selector) => {
  const t = tokens(selector);
  it.each([
    ["fg", "bg", 4.5],
    ["fg", "surface", 4.5],
    ["fg", "surface-raised", 4.5],
    ["fg-muted", "surface", 4.5],
    ["fg-muted", "bg", 4.5],
    ["fg-muted", "surface-raised", 4.5],
    ["fg-subtle", "surface", 4.5],
    ["fg-subtle", "bg", 4.5],
    ["accent-fg", "accent", 4.5],
    ["accent", "surface", 3],
    ["accent", "bg", 3],
    ["success", "surface", 3],
    ["warning", "surface", 3],
    ["danger", "surface", 3],
    ["brand", "surface", 3],
    ["success", "verdict-ok", 3],
    ["warning", "verdict-warn", 3],
    ["danger", "verdict-crit", 3],
    ["success-text", "surface", 4.5],
    ["success-text", "bg", 4.5],
    ["success-text", "surface-raised", 4.5],
    ["success-text", "success-subtle", 4.5],
    ["warning-text", "surface", 4.5],
    ["warning-text", "bg", 4.5],
    ["warning-text", "surface-raised", 4.5],
    ["warning-text", "warning-subtle", 4.5],
    ["danger-text", "surface", 4.5],
    ["danger-text", "bg", 4.5],
    ["danger-text", "surface-raised", 4.5],
    ["danger-text", "danger-subtle", 4.5],
    ["danger-fg", "danger-solid", 4.5],
    ["success-fg", "success-solid", 4.5],
    ["warning-fg", "warning-solid", 4.5],
    // Modal / ConfirmDialog panels sit on --surface-raised: every text token
    // used in them (title, body, labels, hints, errors) must clear AA.
    ["accent", "surface-raised", 3],
    ["danger", "surface-raised", 3],
    // Sidebar and its footer (Admin: --bg-subtle plane, --chrome top bar;
    // the dark selected segment sits on --border).
    ["fg", "bg-subtle", 4.5],
    ["fg-muted", "bg-subtle", 4.5],
    ["fg", "chrome", 4.5],
    ["fg-muted", "chrome", 4.5],
    ["accent", "bg-subtle", 3],
    ["fg", "border", 4.5],
    // fg-subtle is NOT AA text on --surface-raised (dark, 4.0:1) or on
    // --bg-subtle (light, 4.46:1). Components use it there only for icons
    // (Modal close, Select chevron), which need 3:1.
    ["fg-subtle", "surface-raised", 3],
    ["fg-subtle", "bg-subtle", 3],
  ] as const)("%s on %s ≥ %s", (fg, bg, min) => {
    expect(t[fg]).toBeDefined();
    expect(t[bg]).toBeDefined();
    expect(ratio(t[fg], t[bg])).toBeGreaterThanOrEqual(min);
  });

  // Tinted surfaces: a token at some opacity over a plane, then text on it.
  it.each([
    // Sidebar active item / avatar: accent text on accent/15 over bg-subtle.
    ["accent", "accent", 0.15, "bg-subtle", 4.5],
    // Badge accent: accent text on accent/0.12 over a card.
    ["accent", "accent", 0.12, "surface", 4.5],
    // Tabs selected: fg on accent/10 over the canvas.
    ["fg", "accent", 0.1, "bg", 4.5],
  ] as const)("%s on %s/%s over %s ≥ %s", (fg, tint, alpha, base, min) => {
    expect(ratio(t[fg], blend(t[tint], alpha, t[base]))).toBeGreaterThanOrEqual(min);
  });
});

function blend(top: RGB, alpha: number, base: RGB): RGB {
  return [0, 1, 2].map((i) => Math.round(top[i] * alpha + base[i] * (1 - alpha))) as RGB;
}

describe("text colour rules the components follow", () => {
  it("no component uses text-fg-subtle for text on raised panels (Input hints use fg-muted)", () => {
    const input = fs.readFileSync(path.resolve(__dirname, "../../components/ui/Input.tsx"), "utf8");
    const hintLine = input.split("\n").find((l) => l.includes("-hint`} className="));
    expect(hintLine).toContain("text-fg-muted");
  });
});

describe("components use tokens only", () => {
  it("no raw hex colours in src/components", () => {
    const dir = path.resolve(__dirname, "../../components");
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) && /#[0-9a-fA-F]{3,8}\b/.test(fs.readFileSync(p, "utf8")))
          offenders.push(p);
      }
    };
    walk(dir);
    expect(offenders).toEqual([]);
  });
});
