"use client";

import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";

import { persistPreference } from "@/lib/preferences/preferences-storage";
import { THEME_PRESET_OPTIONS, type ThemeMode, type ThemePreset } from "@/lib/preferences/theme";
import { applyThemePreset } from "@/lib/preferences/theme-utils";
import { cn } from "@/lib/utils";
import { usePreferencesStore } from "@/stores/preferences/preferences-provider";

/**
 * Theme and mode, on a phone — inside the Menu hub.
 *
 * The desktop keeps these in the layout panel of the top bar, which does not
 * exist below md, so a phone could switch light and dark and nothing else. Here
 * the presets are swatches a thumb can hit, each drawn in its own primary colour
 * for the mode on screen, and the mode is three segments instead of a toggle
 * that could not reach "follow the system".
 *
 * ⚠️ The same three steps as the desktop picker — apply to the document, update
 * the store, persist the cookie — so the two cannot drift into choosing a theme
 * two different ways.
 */
/** White on a dark swatch, near-black on a light one: the check must show on every theme. */
function checkColour(oklch: string) {
  const l = Number(/oklch\(\s*([\d.]+)/.exec(oklch)?.[1] ?? 0.5);
  return l < 0.62 ? "#fff" : "#111";
}

export function MobileThemePicker() {
  const t = useTranslations("layoutControls");
  const themeMode = usePreferencesStore((s) => s.themeMode);
  const resolvedThemeMode = usePreferencesStore((s) => s.resolvedThemeMode);
  const setThemeMode = usePreferencesStore((s) => s.setThemeMode);
  const themePreset = usePreferencesStore((s) => s.themePreset);
  const setThemePreset = usePreferencesStore((s) => s.setThemePreset);

  const choosePreset = (preset: ThemePreset) => {
    applyThemePreset(preset);
    setThemePreset(preset);
    persistPreference("theme_preset", preset);
  };
  const chooseMode = (mode: ThemeMode) => {
    setThemeMode(mode);
    persistPreference("theme_mode", mode);
  };

  const modes: { value: ThemeMode; icon: typeof Sun }[] = [
    { value: "light", icon: Sun },
    { value: "dark", icon: Moon },
    { value: "system", icon: Monitor },
  ];
  const dark = (resolvedThemeMode ?? "light") === "dark";

  return (
    <div className="space-y-3 px-3 py-3">
      <div role="radiogroup" aria-label={t("themeMode")} className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
        {modes.map(({ value, icon: Icon }) => {
          const active = themeMode === value;
          return (
            // biome-ignore lint/a11y/useSemanticElements: a segmented control, styled as one
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => chooseMode(value)}
              className={cn(
                "flex min-h-10 items-center justify-center gap-1.5 rounded-md font-medium text-xs transition-colors",
                active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden />
              {t(value)}
            </button>
          );
        })}
      </div>

      <div role="radiogroup" aria-label={t("themePreset")} className="grid grid-cols-4 gap-2">
        {THEME_PRESET_OPTIONS.map((preset) => {
          const active = themePreset === preset.value;
          const swatch = dark ? preset.primary.dark : preset.primary.light;
          const name = t.has(`presets.${preset.value}`) ? t(`presets.${preset.value}`) : preset.label;
          return (
            // biome-ignore lint/a11y/useSemanticElements: a swatch grid, styled as one
            <button
              key={preset.value}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={name}
              onClick={() => choosePreset(preset.value)}
              className={cn(
                "flex min-h-18 flex-col items-center justify-center gap-1.5 rounded-xl border p-1.5 transition-colors",
                active ? "border-primary bg-primary/5" : "bg-card active:bg-muted",
              )}
            >
              <span
                className="flex size-8 items-center justify-center rounded-full shadow-sm ring-1 ring-foreground/10"
                style={{ backgroundColor: swatch }}
                aria-hidden
              >
                {active && <Check className="size-4" style={{ color: checkColour(swatch) }} />}
              </span>
              <span className="line-clamp-1 max-w-full font-medium text-[11px] leading-tight">{name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
