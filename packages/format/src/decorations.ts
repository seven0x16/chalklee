import { chalkLeeSvgIssues } from "./graphic";
import type { ChalkLeePageAppearance, ChalkLeePageDecoration } from "./types";

export const CHALKLEE_PAGE_DECORATION_LIMIT = 12;

/** The paper upright, in points; landscape turns it. */
export function chalkLeePortraitPageSize(page: Pick<ChalkLeePageAppearance, "size" | "widthPt" | "heightPt">) {
  const [width, height] = page.size === "A3" ? [841.89, 1190.55] : page.size === "Letter" ? [612, 792] : page.size === "slide" ? [540, 960]
    : page.size === "custom" ? [page.widthPt ?? 595.28, page.heightPt ?? 841.89] : [595.28, 841.89];
  return { width, height };
}

/** The page as laid out, in points. */
export function chalkLeePageSize(page: Pick<ChalkLeePageAppearance, "size" | "orientation" | "widthPt" | "heightPt">) {
  const { width, height } = chalkLeePortraitPageSize(page);
  return page.orientation === "landscape" ? { width: height, height: width } : { width, height };
}

/** Where each area sits on a page, in points from the page's top-left corner. */
export function chalkLeePageDecorationArea(page: ChalkLeePageAppearance, place: ChalkLeePageDecoration["place"]) {
  const { width, height } = chalkLeePageSize(page);
  const m = page.marginsPt;
  const top = m.top, bodyHeight = Math.max(0, height - m.top - m.bottom);
  if (place === "left") return { x: 0, y: top, width: m.left, height: bodyHeight };
  if (place === "right") return { x: width - m.right, y: top, width: m.right, height: bodyHeight };
  return { x: m.left, y: top, width: Math.max(0, width - m.left - m.right), height: bodyHeight };
}

export function chalkLeePageDecorationShows(decoration: ChalkLeePageDecoration, page: number) {
  const pages = decoration.pages ?? "all";
  return pages === "all" || pages === "first" && page === 1 || pages === "rest" && page > 1
    || pages === "odd" && page % 2 === 1 || pages === "even" && page % 2 === 0;
}

const escapeXml = (value: string) => value.replace(/[&<>"']/g, character => `&#${character.charCodeAt(0)};`);

/** Problems with a decoration a teacher's file or ChalkLee AI supplied; the drawing only ever shows as a picture. */
export function chalkLeePageDecorationIssues(decorations: readonly ChalkLeePageDecoration[] | undefined): string[] {
  const issues: string[] = [];
  if (!decorations) return issues;
  if (decorations.length > CHALKLEE_PAGE_DECORATION_LIMIT) issues.push(`页面装饰最多 ${CHALKLEE_PAGE_DECORATION_LIMIT} 个。`);
  decorations.forEach((decoration, index) => {
    const name = `第 ${index + 1} 个页面装饰`;
    if (decoration.place === "content" && ["odd", "even", "rest"].includes(decoration.pages ?? "all")) issues.push(`${name}放在正文区域时只能用于每页（all）或首页（first）。`);
    issues.push(...chalkLeeSvgIssues(decoration.svg).map(issue => `${name}${issue}`));
  });
  return issues;
}

/** One picture for an area: the chosen decorations stacked in order, sized to the area. */
export function chalkLeePageDecorationPicture(decorations: readonly ChalkLeePageDecoration[], area: { width: number; height: number }, title: string): string | null {
  if (!decorations.length || area.width <= 0 || area.height <= 0) return null;
  const layers = decorations.map(decoration => decoration.svg.trim()
    .replace(/\{title\}/g, escapeXml(title))
    // Each drawing fills the area; its own viewBox or percentages place what it draws.
    .replace(/^<svg\b([^>]*)>/i, (_, attributes: string) => `<svg${attributes.replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*')/gi, "")} width="100%" height="100%">`));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${area.width}pt" height="${area.height}pt" viewBox="0 0 ${area.width} ${area.height}">${layers.map(layer => layer.includes("xmlns=") ? layer : layer.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"')).join("")}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
