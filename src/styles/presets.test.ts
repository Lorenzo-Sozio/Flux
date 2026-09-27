/**
 * The themes, measured.
 *
 * A theme changes nothing a test of behaviour would notice — every page still
 * renders, every button still works — and can still make the product unusable:
 * a label grey too close to the card behind it, link text that disappears in the
 * dark. That fails the people who most need the contrast and nobody else, which
 * is how it ships. So each preset's text/background pairs are turned into WCAG
 * 2.1 contrast ratios (src/lib/theme-contrast.ts) and held to AA.
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { THEME_PRESET_VALUES } from "@/lib/preferences/theme";
import { contrast, contrastFailures, readVariables } from "@/lib/theme-contrast";

const PRESETS = path.resolve(__dirname, "presets");
const globals = fs.readFileSync(path.resolve(__dirname, "../app/globals.css"), "utf8");

// A preset overrides the defaults; whatever it does not set, it inherits.
const defaults = {
  light: readVariables(globals, /:root\s*\{/),
  dark: readVariables(globals, /\n\.dark\s*\{/),
};

/**
 * The variables in force in each mode, layered as the cascade layers them:
 * `.dark` beats `:root`, a preset's `:root[data-theme-preset]` beats `.dark`
 * (one more selector), and `.dark:root[data-theme-preset]` beats everything.
 */
function theme(value: string) {
  const css = value === "default" ? "" : fs.readFileSync(path.join(PRESETS, `${value}.css`), "utf8");
  const presetLight = readVariables(css, /:root\[data-theme-preset="[^"]+"\]\s*\{/);
  const presetDark = readVariables(css, /\.dark:root\[data-theme-preset="[^"]+"\]\s*\{/);
  return {
    light: { ...defaults.light, ...presetLight },
    dark: { ...defaults.light, ...defaults.dark, ...presetLight, ...presetDark },
  };
}

const describeFailures = (vars: Record<string, string>) =>
  contrastFailures(vars).map((f) => `${f.pair} ${f.ratio}:1 < ${f.min}:1 (${f.why})`);

describe("the contrast calculation", () => {
  it("agrees with the reference points it is built on", () => {
    expect(contrast("oklch(1 0 0)", "oklch(0 0 0)")).toBeCloseTo(21, 0);
    expect(contrast("oklch(0.5 0 0)", "oklch(0.5 0 0)")).toBeCloseTo(1, 5);
    // #767676 on white is the classic 4.54:1.
    expect(contrast("oklch(0.5659 0 0)", "oklch(1 0 0)")).toBeCloseTo(4.54, 1);
  });
});

/**
 * Held to every pair, light and dark: every theme the picker offers. A new theme
 * joins this list, and a test that fails here names the pair, the ratio and what
 * the pair is used for.
 *
 * The four older themes were brought here on 26 September 2026. The worst of
 * what they had was the default theme in the dark, where primary-coloured text
 * (links, active tabs) was 2.2:1; in the dark the primary is now a lighter blue
 * with dark text on it, because a colour dark enough to carry white text is too
 * dark to read as text on a dark page.
 */
const ACCESSIBLE = ["default", "brutalist", "soft-pop", "tangerine", "aurora", "atelier", "orchid"] as const;

describe("⚠️ every theme keeps every text readable", () => {
  for (const value of ACCESSIBLE) {
    it(`${value}, light`, () => expect(describeFailures(theme(value).light)).toEqual([]));
    it(`${value}, dark`, () => expect(describeFailures(theme(value).dark)).toEqual([]));
  }

  it("covers every theme the picker offers", () => {
    expect([...ACCESSIBLE].sort()).toEqual([...THEME_PRESET_VALUES].sort());
  });
});

describe("the registry", () => {
  it("offers every preset file, and nothing that has no file", () => {
    const files = fs
      .readdirSync(PRESETS)
      .filter((f) => f.endsWith(".css"))
      .map((f) => f.replace(".css", ""))
      .sort();
    expect(THEME_PRESET_VALUES.filter((v) => v !== "default").sort()).toEqual(files);
    for (const f of files) expect(globals, `${f}.css is not imported by globals.css`).toContain(`presets/${f}.css`);
  });
});
