import {
  amber,
  amberDark,
  green,
  greenDark,
  orange,
  orangeDark,
  pink,
  pinkDark,
  red,
  redDark,
  slate,
  slateDark,
  violet,
  violetDark
} from "@radix-ui/colors";

export const THEME_COLORS = ["blue", "red", "green", "orange", "yellow", "purple"] as const;

export type ThemeColor = typeof THEME_COLORS[number];
export type ThemeAppearance = "light" | "dark";
export type ThemeScale = readonly string[];

interface LogoPalette {
  light: string;
  core: string;
  deep: string;
  pale: string;
  inkStart: string;
  inkEnd: string;
  spark: string;
}

export interface AppearanceVariant {
  name: string;
  preview: readonly [string, string, string];
  logo: LogoPalette;
}

export interface ThemeColorOption {
  id: ThemeColor;
  light: AppearanceVariant;
  dark: AppearanceVariant;
}

type RadixScale = Record<string, string>;

function toScale(scale: RadixScale, name: string): ThemeScale {
  return Array.from({ length: 12 }, (_, index) => scale[`${name}${index + 1}`]);
}

const CHALKLEE_BLUE_SCALE = {
  light: ["#fbfdff", "#f4f8ff", "#edf4ff", "#dfeaff", "#c9ddff", "#b4cef9", "#91b3f6", "#6bacff", "#3574f0", "#2f6ded", "#0869f7", "#1f4a8f"],
  dark: ["#111927", "#162339", "#26374e", "#2d405c", "#354f70", "#425a79", "#5579a9", "#4a89e6", "#65a1ff", "#79adff", "#8bb8ff", "#eaf3ff"]
} as const;

const COLOR_SCALES = {
  blue: CHALKLEE_BLUE_SCALE,
  red: { light: toScale(red, "red"), dark: toScale(redDark, "red") },
  green: { light: toScale(green, "green"), dark: toScale(greenDark, "green") },
  orange: { light: toScale(orange, "orange"), dark: toScale(orangeDark, "orange") },
  amber: { light: toScale(amber, "amber"), dark: toScale(amberDark, "amber") },
  violet: { light: toScale(violet, "violet"), dark: toScale(violetDark, "violet") },
  pink: { light: toScale(pink, "pink"), dark: toScale(pinkDark, "pink") },
  slate: { light: toScale(slate, "slate"), dark: toScale(slateDark, "slate") }
} as const;

const THEME_SCALE_IDS = {
  blue: "blue",
  red: "red",
  green: "green",
  orange: "orange",
  yellow: "amber",
  purple: "violet"
} as const satisfies Record<ThemeColor, keyof typeof COLOR_SCALES>;

const SPARK_SCALE_IDS: Record<ThemeColor, keyof typeof COLOR_SCALES> = {
  blue: "violet",
  red: "orange",
  green: "amber",
  orange: "amber",
  yellow: "orange",
  purple: "pink"
};

const THEME_NAMES: Record<ThemeColor, Record<ThemeAppearance, string>> = {
  blue: { light: "晴空蓝", dark: "深海蓝" },
  red: { light: "丹霞红", dark: "熔岩红" },
  green: { light: "松针绿", dark: "松林绿" },
  orange: { light: "落日橙", dark: "余晖橙" },
  yellow: { light: "银杏黄", dark: "星光黄" },
  purple: { light: "星云紫", dark: "夜幕紫" }
};

export function getThemeScale(color: ThemeColor, appearance: ThemeAppearance): ThemeScale {
  return COLOR_SCALES[THEME_SCALE_IDS[color]][appearance];
}

/**
 * One-based steps for theme tints that must lift off the surface equally in every theme color: the selected-row
 * tint and the ChalkLee AI circle's tint over a raised card. Radix dark low steps sit at or below the dark
 * surfaces, so dark mode reaches further up the scale; ChalkLee Blue's dark low steps are already brighter.
 */
export function getTintSteps(color: ThemeColor, appearance: ThemeAppearance): { selected: number; raised: number } {
  if (appearance === "light" || THEME_SCALE_IDS[color] === "blue") return { selected: 2, raised: 3 };
  return { selected: 3, raised: 5 };
}

export function getNeutralScale(appearance: ThemeAppearance): ThemeScale {
  return COLOR_SCALES.slate[appearance];
}

export function getThemeSpark(color: ThemeColor, appearance: ThemeAppearance): string {
  const scale = COLOR_SCALES[SPARK_SCALE_IDS[color]][appearance];
  return scale[appearance === "light" ? 8 : 10];
}

function createVariant(color: ThemeColor, appearance: ThemeAppearance): AppearanceVariant {
  const scale = getThemeScale(color, appearance);
  const neutral = getNeutralScale(appearance);
  const light = appearance === "light";
  return {
    name: THEME_NAMES[color][appearance],
    preview: light
      ? [scale[7], scale[8], scale[2]]
      : [scale[10], scale[9], scale[2]],
    logo: {
      light: scale[light ? 7 : 10],
      core: scale[light ? 8 : 9],
      deep: scale[light ? 9 : 8],
      pale: scale[light ? 5 : 11],
      inkStart: light ? scale[11] : neutral[11],
      inkEnd: light ? neutral[11] : neutral[10],
      spark: getThemeSpark(color, appearance)
    }
  };
}

export const THEME_COLOR_OPTIONS: readonly ThemeColorOption[] = THEME_COLORS.map(id => ({
  id,
  light: createVariant(id, "light"),
  dark: createVariant(id, "dark")
}));
