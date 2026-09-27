export const THEME_MODE_OPTIONS = [
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
  { label: "System", value: "system" },
] as const;

export const THEME_MODE_VALUES = THEME_MODE_OPTIONS.map((o) => o.value);
export type ThemeMode = (typeof THEME_MODE_VALUES)[number];
export type ResolvedThemeMode = "light" | "dark";

// --- generated:themePresets:start ---

export const THEME_PRESET_OPTIONS = [
  {
    label: "Default",
    value: "default",
    primary: {
      light: "oklch(0.488 0.243 264.376)",
      dark: "oklch(0.7 0.15 262)",
    },
  },
  {
    label: "Atelier",
    value: "atelier",
    primary: {
      light: "oklch(0.25 0.012 60)",
      dark: "oklch(0.82 0.11 82)",
    },
  },
  {
    label: "Aurora",
    value: "aurora",
    primary: {
      light: "oklch(0.49 0.1 188)",
      dark: "oklch(0.78 0.12 178)",
    },
  },
  {
    label: "Brutalist",
    value: "brutalist",
    primary: {
      light: "oklch(0.56 0.22 27)",
      dark: "oklch(0.74 0.17 23.2)",
    },
  },
  {
    label: "Orchid",
    value: "orchid",
    primary: {
      light: "oklch(0.52 0.2 346)",
      dark: "oklch(0.76 0.15 346)",
    },
  },
  {
    label: "Soft Pop",
    value: "soft-pop",
    primary: {
      light: "oklch(0.5106 0.2301 276.9656)",
      dark: "oklch(0.6801 0.1583 276.9349)",
    },
  },
  {
    label: "Tangerine",
    value: "tangerine",
    primary: {
      light: "oklch(0.53 0.16 38)",
      dark: "oklch(0.76 0.14 42)",
    },
  },
] as const;

export const THEME_PRESET_VALUES = THEME_PRESET_OPTIONS.map((p) => p.value);

export type ThemePreset = (typeof THEME_PRESET_OPTIONS)[number]["value"];

// --- generated:themePresets:end ---
