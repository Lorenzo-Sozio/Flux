/**
 * theme-contrast.ts — what a theme's colours do to legibility, measured.
 *
 * A theme is a file of CSS variables, and "the text stays readable" is a claim
 * about pairs of them: the muted grey that labels nearly every field (used some
 * 1,600 times) on the page, on a card, on a muted panel; the primary colour as
 * link text; the label on a primary button. This turns each pair into the
 * WCAG 2.1 contrast ratio, so a theme is checked by a test rather than by eye.
 *
 * Pure: OKLCH → OKLab → linear sRGB → relative luminance, no dependencies.
 */

export type Rgb = { r: number; g: number; b: number };

/** Parses `oklch(L C H)` or `oklch(L C H / a)`; L as 0–1 or a percentage. */
export function parseOklch(value: string): { l: number; c: number; h: number } | null {
  const m = /oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*(?:\/\s*[\d.%]+\s*)?\)/i.exec(value.trim());
  if (!m) return null;
  const l = m[2] === "%" ? Number(m[1]) / 100 : Number(m[1]);
  return { l, c: Number(m[3]), h: Number(m[4]) };
}

/** Linear-light sRGB, each channel clamped to the displayable 0–1 range. */
export function oklchToLinearSrgb({ l, c, h }: { l: number; c: number; h: number }): Rgb {
  const hr = (h * Math.PI) / 180;
  const a = c * Math.cos(hr);
  const b = c * Math.sin(hr);
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const L = l_ ** 3;
  const M = m_ ** 3;
  const S = s_ ** 3;
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  return {
    r: clamp(4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S),
    g: clamp(-1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S),
    b: clamp(-0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S),
  };
}

/** WCAG relative luminance of a colour. */
export function luminance(value: string): number {
  const parsed = parseOklch(value);
  if (!parsed) throw new Error(`Not an oklch() colour: ${value}`);
  const { r, g, b } = oklchToLinearSrgb(parsed);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 contrast ratio between two colours, 1–21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The variables a preset sets for one selector: `--name: value;` pairs. */
export function readVariables(css: string, selector: RegExp): Record<string, string> {
  const block = selector.exec(css);
  if (!block) return {};
  const start = css.indexOf("{", block.index) + 1;
  const end = css.indexOf("}", start);
  const vars: Record<string, string> = {};
  for (const m of css.slice(start, end).matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  return vars;
}

/**
 * The pairs that carry text or a boundary, with the ratio each must reach:
 * 4.5 for text (WCAG AA, normal size), 3 for large text and for the edge of a
 * control a person has to find (WCAG 1.4.11).
 */
export const CONTRAST_PAIRS: { fg: string; bg: string; min: number; why: string }[] = [
  { fg: "foreground", bg: "background", min: 4.5, why: "body text" },
  { fg: "card-foreground", bg: "card", min: 4.5, why: "text on a card" },
  { fg: "popover-foreground", bg: "popover", min: 4.5, why: "menus and dialogs" },
  { fg: "muted-foreground", bg: "background", min: 4.5, why: "labels and hints on the page" },
  { fg: "muted-foreground", bg: "card", min: 4.5, why: "labels and hints on a card" },
  { fg: "muted-foreground", bg: "muted", min: 4.5, why: "labels on a muted panel" },
  { fg: "primary-foreground", bg: "primary", min: 4.5, why: "the label of a primary button" },
  { fg: "primary", bg: "background", min: 4.5, why: "links and active items on the page" },
  { fg: "primary", bg: "card", min: 4.5, why: "links and active items on a card" },
  { fg: "secondary-foreground", bg: "secondary", min: 4.5, why: "secondary buttons" },
  { fg: "accent-foreground", bg: "accent", min: 4.5, why: "a hovered or selected menu item" },
  { fg: "destructive", bg: "background", min: 4.5, why: "error messages" },
  { fg: "destructive", bg: "card", min: 4.5, why: "errors and delete buttons on a card" },
  { fg: "sidebar-foreground", bg: "sidebar", min: 4.5, why: "the navigation" },
  { fg: "sidebar-primary-foreground", bg: "sidebar-primary", min: 4.5, why: "quick create in the sidebar" },
  { fg: "sidebar-accent-foreground", bg: "sidebar-accent", min: 4.5, why: "the current page in the sidebar" },
  { fg: "ring", bg: "background", min: 3, why: "the keyboard focus ring" },
];

export type ContrastFailure = { pair: string; ratio: number; min: number; why: string };

/** Every pair a set of variables fails, with its ratio. */
export function contrastFailures(vars: Record<string, string>): ContrastFailure[] {
  const out: ContrastFailure[] = [];
  for (const { fg, bg, min, why } of CONTRAST_PAIRS) {
    if (!vars[fg] || !vars[bg]) continue;
    const ratio = contrast(vars[fg], vars[bg]);
    if (ratio < min) out.push({ pair: `${fg} on ${bg}`, ratio: Math.round(ratio * 100) / 100, min, why });
  }
  return out;
}
