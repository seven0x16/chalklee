import { describe, expect, it } from "vitest";
import {
  applyTheme,
  buildThemedLogoSvg,
  DEFAULT_THEME_PREFERENCE,
  getThemeVariant,
  isThemeColor,
  isThemeMode,
  loadThemePreference,
  resolveAppearance,
  THEME_COLOR_OPTIONS,
  THEME_COLOR_STORAGE_KEY,
  THEME_MODE_STORAGE_KEY
} from "./themes";

describe("appearance themes", () => {
  it("provides six colors with separate light and dark names", () => {
    expect(THEME_COLOR_OPTIONS.map((theme) => theme.light.name)).toEqual([
      "晴空蓝",
      "丹霞红",
      "松针绿",
      "落日橙",
      "银杏黄",
      "星云紫"
    ]);
    expect(THEME_COLOR_OPTIONS.map((theme) => theme.dark.name)).toEqual([
      "深海蓝",
      "熔岩红",
      "松林绿",
      "余晖橙",
      "星光黄",
      "夜幕紫"
    ]);
    expect(DEFAULT_THEME_PREFERENCE).toEqual({ mode: "light", color: "blue" });
  });

  it("resolves explicit and system appearance modes", () => {
    expect(resolveAppearance("light", true)).toBe("light");
    expect(resolveAppearance("dark", false)).toBe("dark");
    expect(resolveAppearance("system", false)).toBe("light");
    expect(resolveAppearance("system", true)).toBe("dark");
    expect(isThemeMode("system")).toBe(true);
    expect(isThemeMode("auto")).toBe(false);
    expect(isThemeColor("purple")).toBe(true);
    expect(isThemeColor("black")).toBe(false);
  });

  it("restores the independently saved mode and color", () => {
    const values = new Map([
      [THEME_MODE_STORAGE_KEY, "system"],
      [THEME_COLOR_STORAGE_KEY, "green"]
    ]);
    expect(loadThemePreference({ getItem: (key) => values.get(key) ?? null })).toEqual({
      mode: "system",
      color: "green"
    });

    const partialValues = new Map([[THEME_COLOR_STORAGE_KEY, "red"]]);
    expect(loadThemePreference({ getItem: (key) => partialValues.get(key) ?? null })).toEqual({
      mode: "light",
      color: "red"
    });
  });

  it("persists mode and color independently", () => {
    const values = new Map<string, string>();
    applyTheme(
      { mode: "system", color: "orange" },
      "dark",
      { setItem: (key, value) => values.set(key, value) }
    );
    expect(values).toEqual(new Map([
      [THEME_MODE_STORAGE_KEY, "system"],
      [THEME_COLOR_STORAGE_KEY, "orange"]
    ]));
  });

  it("recolors the complete SVG logo for all twelve color variants", () => {
    for (const theme of THEME_COLOR_OPTIONS) {
      for (const appearance of ["light", "dark"] as const) {
        const variant = getThemeVariant(theme, appearance);
        const svg = buildThemedLogoSvg(theme, appearance);
        expect(svg).toContain(variant.logo.core);
        expect(svg).toContain(variant.logo.inkStart);
        if (theme.id !== "blue" || appearance !== "light") expect(svg).not.toContain("#0869f7");
      }
    }
  });
});
