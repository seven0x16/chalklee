import { isChalkLeeBoxStyleShape, validateChalkLeeBoxStyleCss, type ChalkLeeBoxStyle } from "@chalklee/format";

/** How long a name in 我的样式 may be. */
export const CHALKLEE_BOX_STYLE_NAME_LIMIT = 20;

export interface ChalkLeeNamedBoxStyle { name: string; style: ChalkLeeBoxStyle }

export function normalizedChalkLeeBoxStyleName(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, CHALKLEE_BOX_STYLE_NAME_LIMIT) : "";
}

/** Why a value cannot be a box style, or null: checked as a minimal document's only box style would be. */
export function chalkLeeBoxStyleProblem(style: unknown): string | null {
  if (!style || typeof style !== "object" || Array.isArray(style)) return "不是盒子样式。";
  if (!isChalkLeeBoxStyleShape(style)) return "样式内容不完整或不正确。";
  const { css } = style;
  if (css) {
    try { validateChalkLeeBoxStyleCss(css); }
    catch (error) { return error instanceof Error ? error.message : String(error); }
  }
  return null;
}
