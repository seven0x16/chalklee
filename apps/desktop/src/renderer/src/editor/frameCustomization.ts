import type { ChalkLeeQuestionFrame, ChalkLeeQuestionStyle } from "@chalklee/format";
import { THEME_COLOR_OPTIONS, type ThemeColor } from "../theme/palette";

const frameColorNames: Record<ThemeColor, string> = {
  blue: "蓝", red: "红", green: "绿", orange: "橙", yellow: "黄", purple: "紫"
};

// New document presets use the light UI accents; saved styles stay independent of UI appearance.
export const chalkLeeFrameColors = THEME_COLOR_OPTIONS.map(({ id, light }) => ({
  id, name: frameColorNames[id], color: light.preview[1]
}));

export type ChalkLeeFramePatch = {
  accentColor?: string;
  backgroundColor?: string | null;
  borderStyle?: "solid" | "dashed" | "dotted";
  borderWidthPt?: number;
  borderRadiusPt?: number;
  labelPosition?: ChalkLeeQuestionFrame["labelPosition"];
};

export function normalizeChalkLeeFrameColor(value: string) {
  const hex = value.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(hex)) return `#${[...hex].map(char => char + char).join("")}`.toLowerCase();
  return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex.toLowerCase()}` : null;
}

export function chalkLeeFrameTint(color: string, white = .84) {
  const hex = normalizeChalkLeeFrameColor(color) ?? chalkLeeFrameColors[0].color;
  return `#${[1, 3, 5].map(start => Math.round(parseInt(hex.slice(start, start + 2), 16) * (1 - white) + 255 * white).toString(16).padStart(2, "0")).join("")}`;
}

/** Bright yellow/orange can stay vivid on the border while plain titles remain readable. */
export function chalkLeeFrameLabelText(color: string, background = "#ffffff") {
  const accent = normalizeChalkLeeFrameColor(color);
  const surface = normalizeChalkLeeFrameColor(background);
  // Keep archived alpha colors intact; their contrast depends on the paper beneath them.
  if (!accent || !surface) return color;
  const target = frameColorContrast("#000000", surface) > frameColorContrast("#ffffff", surface) ? 0 : 255;
  for (let step = 0; step <= 20; step++) {
    const candidate = `#${[1, 3, 5].map(start => Math.round(parseInt(accent.slice(start, start + 2), 16) * (1 - step / 20) + target * step / 20).toString(16).padStart(2, "0")).join("")}`;
    if (frameColorContrast(candidate, surface) >= 4.5) return candidate;
  }
  return target === 0 ? "#000000" : "#ffffff";
}

function frameColorContrast(left: string, right: string) {
  const luminance = (value: string) => [1, 3, 5].reduce((sum, start, index) => {
    const channel = parseInt(value.slice(start, start + 2), 16) / 255;
    const linear = channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    return sum + linear * [.2126, .7152, .0722][index];
  }, 0);
  const [low, high] = [luminance(left), luminance(right)].sort((a, b) => a - b);
  return (high + .05) / (low + .05);
}

/** Full-color borders and labels pair with a readable, tinted paper surface. */
export function recolorChalkLeeFrame(style: ChalkLeeQuestionStyle, color: string): ChalkLeeQuestionStyle {
  const accentColor = normalizeChalkLeeFrameColor(color);
  if (!accentColor) return style;
  return {
    ...style,
    ...(style.border ? { border: { ...style.border, color: accentColor } } : {}),
    ...(style.backgroundColor && normalizeChalkLeeFrameColor(style.backgroundColor) !== "#ffffff" ? { backgroundColor: chalkLeeFrameTint(accentColor) } : {}),
    ...(style.frame ? { frame: { ...style.frame, accentColor } } : {})
  };
}

export function customizeChalkLeeFrameStyle(current: ChalkLeeQuestionStyle, patch: ChalkLeeFramePatch): ChalkLeeQuestionStyle | null {
  if (!current.frame && !current.border && !current.backgroundColor) return null;
  if (patch.accentColor !== undefined && !normalizeChalkLeeFrameColor(patch.accentColor)) return null;
  if (patch.backgroundColor != null && !normalizeChalkLeeFrameColor(patch.backgroundColor)) return null;
  if (patch.borderWidthPt !== undefined && (!Number.isFinite(patch.borderWidthPt) || patch.borderWidthPt < .25 || patch.borderWidthPt > 3)) return null;
  if (patch.borderRadiusPt !== undefined && (!Number.isFinite(patch.borderRadiusPt) || patch.borderRadiusPt < 0 || patch.borderRadiusPt > 24)) return null;
  if (patch.borderStyle !== undefined && !["solid", "dashed", "dotted"].includes(patch.borderStyle)) return null;
  if (patch.labelPosition !== undefined && !["top-left", "top-center", "left"].includes(patch.labelPosition)) return null;
  const next = structuredClone(patch.accentColor ? recolorChalkLeeFrame(current, patch.accentColor) : current);
  if (patch.backgroundColor === null) delete next.backgroundColor;
  else if (patch.backgroundColor !== undefined) next.backgroundColor = normalizeChalkLeeFrameColor(patch.backgroundColor)!;
  if (patch.borderStyle !== undefined || patch.borderWidthPt !== undefined) {
    next.border = { style: "solid", widthPt: .75, color: next.frame?.accentColor ?? chalkLeeFrameColors[0].color, ...next.border,
      ...(patch.borderStyle !== undefined ? { style: patch.borderStyle } : {}),
      ...(patch.borderWidthPt !== undefined ? { widthPt: patch.borderWidthPt } : {}) };
  }
  if (patch.borderRadiusPt !== undefined) next.borderRadiusPt = patch.borderRadiusPt;
  if (patch.labelPosition !== undefined && next.frame) {
    next.frame.labelPosition = patch.labelPosition;
    next.paddingPt = { top: 16, right: 18, bottom: 16, left: 18, ...next.paddingPt };
    next.paddingPt.left = patch.labelPosition === "left" ? Math.max(30, next.paddingPt.left) : 18;
  }
  return next;
}
