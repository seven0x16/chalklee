import { THEME_COLORS, THEME_COLOR_OPTIONS, type AppearanceVariant, type ThemeAppearance, type ThemeColor, type ThemeColorOption } from "./palette";
import { getThemeCssVariables } from "./tokens";
import chalkLeeLogoSvg from "../assets/logo.svg?raw";

export { THEME_COLORS, THEME_COLOR_OPTIONS, type ThemeColor, type ThemeColorOption } from "./palette";

export const THEME_MODE_STORAGE_KEY = "chalklee.appearance.mode";
export const THEME_COLOR_STORAGE_KEY = "chalklee.appearance.color";

export const THEME_MODES = ["light", "dark", "system"] as const;

export type ThemeMode = typeof THEME_MODES[number];
export type EffectiveAppearance = ThemeAppearance;

export interface ThemePreference {
  mode: ThemeMode;
  color: ThemeColor;
}

export const DEFAULT_THEME_PREFERENCE: ThemePreference = {
  mode: "light",
  color: "blue"
};

const THEME_COLOR_BY_ID = new Map<ThemeColor, ThemeColorOption>(
  THEME_COLOR_OPTIONS.map((theme) => [theme.id, theme])
);

export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === "string" && THEME_MODES.includes(value as ThemeMode);
}

export function isThemeColor(value: unknown): value is ThemeColor {
  return typeof value === "string" && THEME_COLOR_BY_ID.has(value as ThemeColor);
}

export function getThemeColorOption(color: ThemeColor): ThemeColorOption {
  return THEME_COLOR_BY_ID.get(color) ?? THEME_COLOR_BY_ID.get(DEFAULT_THEME_PREFERENCE.color)!;
}

export function getThemeVariant(theme: ThemeColorOption, appearance: EffectiveAppearance): AppearanceVariant {
  return theme[appearance];
}

export function resolveAppearance(mode: ThemeMode, systemPrefersDark: boolean): EffectiveAppearance {
  return mode === "system" ? (systemPrefersDark ? "dark" : "light") : mode;
}

export function loadThemePreference(storage?: Pick<Storage, "getItem">): ThemePreference {
  try {
    const targetStorage = storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
    const storedMode = targetStorage?.getItem(THEME_MODE_STORAGE_KEY);
    const storedColor = targetStorage?.getItem(THEME_COLOR_STORAGE_KEY);

    return {
      mode: isThemeMode(storedMode) ? storedMode : DEFAULT_THEME_PREFERENCE.mode,
      color: isThemeColor(storedColor) ? storedColor : DEFAULT_THEME_PREFERENCE.color
    };
  } catch {
    // A blocked storage backend falls through to the default preference.
  }

  return { ...DEFAULT_THEME_PREFERENCE };
}

export function applyTheme(
  preference: ThemePreference,
  appearance: EffectiveAppearance,
  storage?: Pick<Storage, "setItem">
) {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.appearance = appearance;
    document.documentElement.dataset.appearanceMode = preference.mode;
    document.documentElement.dataset.themeColor = preference.color;
    delete document.documentElement.dataset.theme;
    document.documentElement.style.colorScheme = appearance;
    for (const [name, value] of Object.entries(getThemeCssVariables(preference.color, appearance))) {
      document.documentElement.style.setProperty(name, value);
    }
  }

  try {
    const targetStorage = storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
    targetStorage?.setItem(THEME_MODE_STORAGE_KEY, preference.mode);
    targetStorage?.setItem(THEME_COLOR_STORAGE_KEY, preference.color);
  } catch {
    // A blocked storage backend should not prevent the visual theme from applying.
  }
}

export function buildThemedLogoSvg(theme: ThemeColorOption, appearance: EffectiveAppearance): string {
  const palette = getThemeVariant(theme, appearance).logo;
  const replacements: ReadonlyArray<readonly [string, string]> = [
    ["#0875ff", palette.core],
    ["#0869f7", palette.core],
    ["#075cf0", palette.deep],
    ["#4a9bff", palette.light],
    ["#2879f5", palette.core],
    ["#1362ee", palette.deep],
    ["#0874f9", palette.core],
    ["#0762ee", palette.deep],
    ["#031d50", palette.inkStart],
    ["#00143f", palette.inkEnd],
    ["#89a9ff", palette.pale],
    ["#718df7", palette.light],
    ["#4d8bf9", palette.light],
    ["#1766ef", palette.deep],
    ["#0b4ec5", palette.deep],
    ["#9762ef", palette.spark]
  ];

  return replacements.reduce(
    (svg, [sourceColor, themedColor]) => svg.replaceAll(sourceColor, themedColor),
    chalkLeeLogoSvg
  );
}

export function getThemedLogoSource(theme: ThemeColorOption, appearance: EffectiveAppearance, variant: "full" | "mark" = "full"): string {
  const svg = buildThemedLogoSvg(theme, appearance);
  // Keep the complete document mark and sparks, cropping out the wordmark.
  const source = variant === "mark"
    ? svg.replace('width="510" height="140" viewBox="-10 0 510 140"', 'width="126" height="140" viewBox="-10 0 126 140"')
    : svg;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
}
