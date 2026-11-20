import { chalkLeePageSize } from "./decorations";
import { chalkLeeSvgIssues } from "./graphic";
import type { ChalkLeeAppearance, ChalkLeeCover, ChalkLeeCoverStyle } from "./types";

/** The cover's text fields in the order they appear, the title first. */
export const CHALKLEE_COVER_FIELDS = ["title", "subtitle", "subject", "author", "date"] as const;
export type ChalkLeeCoverField = typeof CHALKLEE_COVER_FIELDS[number];
export const CHALKLEE_COVER_FIELD_MAX_LENGTH: Record<ChalkLeeCoverField, number> = { title: 60, subtitle: 60, subject: 40, author: 40, date: 40 };

const DEFAULT_LOOK = { align: "center", titleTop: .34, titleSizePt: 30, titleWeight: "bold", titleColor: "#1c2024", color: "#60646c" } as const;

/** A cover's look with every choice made. */
export function chalkLeeCoverLook(style: ChalkLeeCoverStyle | undefined) {
  return {
    align: style?.align ?? DEFAULT_LOOK.align,
    titleTop: style?.titleTop ?? DEFAULT_LOOK.titleTop,
    titleSizePt: style?.titleSizePt ?? DEFAULT_LOOK.titleSizePt,
    titleWeight: style?.titleWeight ?? DEFAULT_LOOK.titleWeight,
    titleColor: style?.titleColor ?? DEFAULT_LOOK.titleColor,
    color: style?.color ?? DEFAULT_LOOK.color,
    fontFamilies: style?.fontFamilies
  };
}

/** The text a field shows: the cover's own, or for the title the document title. */
export function chalkLeeCoverText(cover: ChalkLeeCover, field: ChalkLeeCoverField, documentTitle: string): string {
  if (field === "title") return (cover.title ?? documentTitle).trim();
  return cover[field]?.trim() ?? "";
}

/** The cover's drawing over the whole sheet, as a picture; null when it has none. */
export function chalkLeeCoverPicture(appearance: Pick<ChalkLeeAppearance, "page" | "cover">, title: string): string | null {
  const drawing = appearance.cover?.style?.svg?.trim();
  if (!drawing) return null;
  const { width, height } = chalkLeePageSize(appearance.page);
  const escaped = title.replace(/[&<>"']/g, character => `&#${character.charCodeAt(0)};`);
  const layer = drawing.replace(/\{title\}/g, escaped)
    .replace(/^<svg\b([^>]*)>/i, (_, attributes: string) => `<svg${attributes.replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*')/gi, "")} width="100%" height="100%">`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}pt" height="${height}pt" viewBox="0 0 ${width} ${height}">${layer.includes("xmlns=") ? layer : layer.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"')}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function chalkLeeCoverIssues(cover: ChalkLeeCover | undefined): string[] {
  if (!cover) return [];
  const issues: string[] = [];
  for (const field of CHALKLEE_COVER_FIELDS) {
    const value = cover[field];
    if (value !== undefined && value.length > CHALKLEE_COVER_FIELD_MAX_LENGTH[field]) issues.push(`封面的${FIELD_NAMES[field]}最多 ${CHALKLEE_COVER_FIELD_MAX_LENGTH[field]} 个字。`);
  }
  const style = cover.style;
  if (style?.titleTop !== undefined && !(style.titleTop >= .08 && style.titleTop <= .8)) issues.push("封面标题的位置在页面高度的 0.08–0.8 之间。");
  if (style?.titleSizePt !== undefined && !(style.titleSizePt >= 12 && style.titleSizePt <= 72)) issues.push("封面标题字号在 12–72pt 之间。");
  if (style?.svg) issues.push(...chalkLeeSvgIssues(style.svg).map(issue => `封面的底图${issue}`));
  return issues;
}

const FIELD_NAMES: Record<ChalkLeeCoverField, string> = { title: "标题", subtitle: "副标题", subject: "学科年级", author: "学校或教师", date: "日期" };
